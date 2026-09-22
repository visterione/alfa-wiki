#!/usr/bin/env node
'use strict';

/**
 * Runner миграции ver. 8.56 — доска отзывов = медцентр.
 *
 * Запуск из backend/:
 *   npm run migrate:8.56:check    посмотреть состояние, ничего не меняя
 *   npm run migrate:8.56          применить
 *
 * ЗАЧЕМ. Модуль отзывов делали раньше, чем в портале появился справочник
 * медцентров, поэтому доска была самостоятельной сущностью: её заводили руками,
 * называли по филиалу и филиал же вписывали в описание. Привязка medCenterId
 * (ver. 7.83) была заплаткой поверх этого — поле, которое надо не забыть
 * заполнить. Теперь наоборот: доска существует потому, что существует филиал.
 *
 * ЧТО ДЕЛАЕТ. Заводит доски филиалам, у которых их нет; убирает у доски
 * собственные название и описание (их даёт филиал) и закрепляет правило «одна
 * доска на филиал» ограничениями базы.
 *
 * ЧЕГО НЕ ДЕЛАЕТ. Не трогает существующие доски: у них остаются те же id,
 * отзывы, сценарии, названия колонок, настройки уведомлений, список доступа и
 * подключение к GetLoyalty. Ничего не пересоздаётся.
 *
 * ПОВТОРНЫЙ ЗАПУСК БЕЗОПАСЕН. Шаги идемпотентны и проверяют состояние сами,
 * поэтому общей транзакции здесь нет: если запуск прервётся между шагами, его
 * достаточно повторить. Код этого релиза колонками name и description уже не
 * пользуется, так что промежуточное состояние работоспособно.
 */

const { sequelize, ReviewBoard, User } = require('../models');
const reviewBoards = require('../services/reviewBoards');

sequelize.options.logging = false;

const MIGRATION_LOCK_ID = 856001;

async function state(connection) {
  const columns = await connection.query(`
    SELECT column_name, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'review_boards'
       AND column_name IN ('name', 'description', 'medCenterId')
  `);
  const byName = new Map(columns.rows.map(r => [r.column_name, r]));

  const unique = await connection.query(`
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'review_boards'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%medCenterId%'
  `);

  const orphans = await connection.query(
    'SELECT count(*)::int AS count FROM review_boards WHERE "medCenterId" IS NULL'
  );
  const duplicates = await connection.query(`
    SELECT "medCenterId", count(*)::int AS count
      FROM review_boards WHERE "medCenterId" IS NOT NULL
     GROUP BY "medCenterId" HAVING count(*) > 1
  `);
  const missing = await connection.query(`
    SELECT m.name FROM med_centers m
     WHERE m."isVirtual" = FALSE
       AND NOT EXISTS (SELECT 1 FROM review_boards b WHERE b."medCenterId" = m.id)
     ORDER BY m."sortOrder", m.name
  `);

  return {
    hasName:        byName.has('name'),
    hasDescription: byName.has('description'),
    medCenterRequired: byName.get('medCenterId')?.is_nullable === 'NO',
    medCenterUnique:   unique.rows.length > 0,
    orphans:    orphans.rows[0].count,
    duplicates: duplicates.rows,
    missing:    missing.rows.map(r => r.name)
  };
}

function printState(s) {
  console.log(`   ${s.hasName        ? '○' : '✓'} колонка review_boards.name${s.hasName ? ' — ещё на месте' : ' убрана'}`);
  console.log(`   ${s.hasDescription ? '○' : '✓'} колонка review_boards.description${s.hasDescription ? ' — ещё на месте' : ' убрана'}`);
  console.log(`   ${s.medCenterRequired ? '✓' : '○'} medCenterId обязателен`);
  console.log(`   ${s.medCenterUnique   ? '✓' : '○'} medCenterId уникален (одна доска на филиал)`);
  console.log(`   ${s.orphans ? '○' : '✓'} досок без филиала: ${s.orphans}`);
  console.log(`   ${s.duplicates.length ? '○' : '✓'} филиалов с двумя досками: ${s.duplicates.length}`);
  console.log(`   ${s.missing.length ? '○' : '✓'} филиалов без доски: ${s.missing.length}${s.missing.length ? ` (${s.missing.join(', ')})` : ''}`);
}

/**
 * Владелец для новых досок.
 *
 * Берём того, кто владеет большинством существующих досок: это человек,
 * который ведёт модуль, и новый филиал должен достаться ему же. Досок нет
 * вовсе (пустая база разработчика) — берём любого администратора.
 */
async function pickOwner() {
  const boards = await ReviewBoard.findAll({ attributes: ['ownerId'] });
  if (boards.length) {
    const counts = new Map();
    for (const b of boards) counts.set(b.ownerId, (counts.get(b.ownerId) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  const admin = await User.findOne({ where: { isAdmin: true }, order: [['createdAt', 'ASC']] });
  if (!admin) throw new Error('не нашёл, кого назначить владельцем новых досок: в базе нет администраторов');
  return admin.id;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  let connection;
  let lockHeld = false;

  console.log('\n▶ Миграция ver. 8.56 — доска отзывов = медцентр\n');

  try {
    await sequelize.authenticate();
    connection = await sequelize.connectionManager.getConnection();
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);

    console.log('   Состояние:');
    let now = await state(connection);
    printState(now);

    const complete = !now.hasName && !now.hasDescription && now.medCenterRequired
      && now.medCenterUnique && now.missing.length === 0;

    if (checkOnly) {
      console.log(complete ? '\n✅ Миграция 8.56 применена\n' : '\n⚠️  Миграция 8.56 не применена или применена частично\n');
      if (!complete) process.exitCode = 2;
      return;
    }
    if (complete) {
      console.log('\n✅ Уже применена, ничего делать не нужно\n');
      return;
    }

    // Две ситуации миграция решить не может, потому что это вопрос к человеку:
    // доска без филиала (какому она принадлежит?) и две доски на один филиал
    // (какую из них оставить и куда деть отзывы второй).
    if (now.orphans > 0 || now.duplicates.length > 0) {
      // Доску показываем по id и числу отзывов: своего названия у неё может уже
      // не быть, если прошлый запуск успел снять колонку.
      const { rows } = await connection.query(`
        SELECT b.id, m.name AS med_center,
               (SELECT count(*)::int FROM reviews r WHERE r."boardId" = b.id) AS reviews
          FROM review_boards b LEFT JOIN med_centers m ON m.id = b."medCenterId"
         WHERE b."medCenterId" IS NULL
            OR b."medCenterId" IN (
              SELECT "medCenterId" FROM review_boards
               WHERE "medCenterId" IS NOT NULL GROUP BY "medCenterId" HAVING count(*) > 1)
         ORDER BY m.name NULLS FIRST, b.id
      `);
      console.log('\n   Разобрать руками, миграция не применена:');
      for (const r of rows) {
        console.log(`      ${r.id} → ${r.med_center || 'филиал не выбран'}, отзывов: ${r.reviews}`);
      }
      console.log('\n   Привяжите эти доски к филиалам в настройках доски, по одной на филиал,');
      console.log('   и запустите миграцию снова.\n');
      process.exitCode = 2;
      return;
    }

    await connection.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    lockHeld = true;

    // 1. Собственные название и описание доски. Уходят прежде создания новых
    //    досок: модель их уже не знает, и INSERT без name не прошёл бы.
    //    Описание — это адрес, вписанный руками; он есть в карточке филиала, и
    //    у «3К» две записи давно разошлись. Верной считаем карточку.
    if (now.hasName || now.hasDescription) {
      console.log('\n   Убираю собственные название и описание доски...');
      // Колонки могли уйти по одной, если прошлый запуск прервался посередине.
      const columns = [
        now.hasName        ? 'name'        : `'—'::text AS name`,
        now.hasDescription ? 'description' : 'NULL::text AS description'
      ].join(', ');
      const { rows } = await connection.query(`SELECT ${columns} FROM review_boards ORDER BY 1`);
      for (const r of rows) {
        console.log(`      «${r.name}»${r.description ? ` — описание «${r.description}» отброшено` : ''}`);
      }
      await connection.query('ALTER TABLE review_boards DROP COLUMN IF EXISTS name');
      await connection.query('ALTER TABLE review_boards DROP COLUMN IF EXISTS description');
    }

    // 2. Доски филиалам, у которых их нет.
    if (now.missing.length) {
      console.log('\n   Завожу доски:');
      const ownerId = await pickOwner();
      const created = await reviewBoards.ensureBoardsForMedCenters(ownerId);
      for (const board of created) console.log(`      ${board.name}`);
      if (!created.length) console.log('      нечего заводить');
    }

    // 3. Правило «одна доска на филиал» — ограничениями, а не договорённостью.
    console.log('\n   Закрепляю связь с филиалом...');
    await connection.query('ALTER TABLE review_boards ALTER COLUMN "medCenterId" SET NOT NULL');
    await connection.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS review_boards_med_center_unique
        ON review_boards ("medCenterId")
    `);
    // SET NULL больше не годится: без филиала доска не существует. Удаление
    // филиала теперь останавливается внешним ключом, а пустую доску уносит
    // вместе с ним обработчик справочника медцентров.
    await connection.query('ALTER TABLE review_boards DROP CONSTRAINT IF EXISTS "review_boards_medCenterId_fkey"');
    await connection.query(`
      ALTER TABLE review_boards
        ADD CONSTRAINT "review_boards_medCenterId_fkey"
        FOREIGN KEY ("medCenterId") REFERENCES med_centers(id) ON DELETE RESTRICT
    `);

    now = await state(connection);
    console.log('\n   Состояние после:');
    printState(now);
    console.log('\n✅ Миграция 8.56 применена\n');
  } finally {
    if (connection) {
      if (lockHeld) await connection.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
      sequelize.connectionManager.releaseConnection(connection);
    }
    await sequelize.close();
  }
}

main().catch(error => {
  console.error(`\n❌ ${error.message}\n`);
  process.exitCode = 1;
});
