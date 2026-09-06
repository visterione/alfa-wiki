'use strict';

/**
 * Запуск SQL-миграции по номеру версии (ver. 7.84).
 *
 * Часть миграций в проекте — скрипты на node, часть — просто .sql, которые до сих
 * пор запускались руками через psql с выкачиванием паролей из .env. Команда
 * длинная, имена файлов с пробелами и точками, и каждый раз это переписывалось
 * заново. Здесь то же самое делается одной строкой и без psql: подключаемся тем
 * же pg, что и приложение, поэтому работает везде, где работает бэкенд.
 *
 * Запуск из каталога backend:
 *   npm run migrate:7.84              применить
 *   npm run migrate:7.84:check        посмотреть, что уже на месте
 *   npm run migrate:sql -- 7.42       любая другая версия, без записи в package.json
 *   npm run migrate:sql -- --list     какие вообще есть
 *
 * Файл выполняется целиком в одной транзакции: миграция либо применяется вся,
 * либо не применяется вовсе, и на середине база не остаётся.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const target = args.find(a => !a.startsWith('--'));
const isCheck = flags.includes('--check');

function allMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.toLowerCase().endsWith('.sql'))
    .sort();
}

/**
 * Ищет файлы версии. Совпадение по началу имени: «7.84» находит
 * «ver. 7.84 messenger-bots.sql». Версий с несколькими файлами почти нет, но
 * если такая встретится — применим по порядку имён.
 */
function resolveFiles(version) {
  const files = allMigrations();

  const exact = files.filter(f => f === version || f === `${version}.sql`);
  if (exact.length) return exact;

  const byVersion = files.filter(f => new RegExp(`^ver\\.\\s*${version.replace('.', '\\.')}\\b`, 'i').test(f));
  if (byVersion.length) return byVersion;

  return files.filter(f => f.toLowerCase().includes(version.toLowerCase()));
}

// ── Что миграция создаёт: для --check ─────────────────────────────────────

/**
 * Вытаскивает из текста миграции объекты, по которым видно, применена она или
 * нет. Это не разбор SQL, а намеренно грубое чтение по шаблонам: миграции в
 * проекте однотипные (таблица, колонка, индекс), и большего тут не нужно.
 */
function objectsOf(sql) {
  const out = [];
  const clean = (s) => s.replace(/"/g, '').trim();

  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)/gi)) {
    out.push({ kind: 'таблица', name: clean(m[1]) });
  }
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w".]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/gi)) {
    out.push({ kind: 'колонка', name: `${clean(m[1])}.${clean(m[2])}` });
  }
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)/gi)) {
    out.push({ kind: 'индекс', name: clean(m[1]) });
  }
  return out;
}

async function exists(client, obj) {
  if (obj.kind === 'таблица') {
    const { rows } = await client.query('SELECT to_regclass($1) AS r', [obj.name]);
    return rows[0].r !== null;
  }
  if (obj.kind === 'колонка') {
    const [table, column] = obj.name.split('.');
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column]
    );
    return rows.length > 0;
  }
  const { rows } = await client.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [obj.name]);
  return rows.length > 0;
}

// ── Работа ────────────────────────────────────────────────────────────────

function connect() {
  return new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
}

async function check(client, files) {
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const objects = objectsOf(sql);
    console.log(`\n${file}`);

    if (!objects.length) {
      console.log('  в файле нет CREATE TABLE / ADD COLUMN / CREATE INDEX — проверять нечего, смотри глазами');
      continue;
    }
    for (const obj of objects) {
      const ok = await exists(client, obj);
      console.log(`  ${ok ? '✓' : '·'} ${obj.kind} ${obj.name}${ok ? '' : ' — нет'}`);
    }
  }
}

async function apply(client, files) {
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`${file} ... `);

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
      console.log('применена');
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('ОШИБКА');
      throw err;
    }
  }
}

(async () => {
  if (flags.includes('--list')) {
    console.log(allMigrations().join('\n'));
    return;
  }

  if (!target) {
    console.error('Укажи версию миграции, например:  npm run migrate:sql -- 7.84');
    console.error('Список всех:                      npm run migrate:sql -- --list');
    process.exit(1);
  }

  const files = resolveFiles(target);
  if (!files.length) {
    console.error(`Миграция «${target}» не найдена. Список: npm run migrate:sql -- --list`);
    process.exit(1);
  }

  const client = connect();
  await client.connect();
  try {
    if (isCheck) await check(client, files);
    else await apply(client, files);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
