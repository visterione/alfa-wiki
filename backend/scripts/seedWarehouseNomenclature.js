#!/usr/bin/env node
'use strict';

/**
 * Номенклатура из применённого снимка ведомости — до разметки по кабинетам.
 *
 * Из backend/:
 *   npm run warehouse:nomenclature:check   # посчитать, ничего не записывая
 *   npm run warehouse:nomenclature
 *
 * ── Зачем отдельно от разбора ────────────────────────────────────────────────
 *
 * Разбор ведомости (services/warehouse/osvMaterialize.js) заводит номенклатуру
 * попутно, но только для строк, у которых уже известен кабинет: он создаёт
 * вместе с ней остаток на полке, а полка есть только у размещённой строки.
 * Пока ветки не разнесены по кабинетам, справочник «Материалы → Номенклатура»
 * остаётся пустым — при том что для самого справочника кабинет не нужен ни на
 * что: позиции нужны название, категория и единица измерения.
 *
 * Отсюда порядок: сначала этот скрипт наполняет справочник целиком, потом люди
 * спокойно, без давления пустого экрана, размечают ветки, и разбор доводит уже
 * остатки. Повторного создания не будет: разбор ищет позицию по osvLineKey и
 * находит созданную здесь — код выводится из того же ключа той же формулой.
 *
 * ── Чего скрипт не делает ────────────────────────────────────────────────────
 *
 * Не создаёт карточек оборудования. Инвентарный номер содержит код
 * специальности кабинета и не меняется никогда, поэтому выдать его до
 * размещения — значит выдать неправильный (см. комментарий в osvMaterialize).
 * Не создаёт остатков: остаток без места хранения бессмыслен.
 */

const { Op } = require('sequelize');
const {
  sequelize, WhOsvImport, WhOsvLine, WhOsvMapping, WhNomenclature, WhItemRule, WhCategory,
} = require('../models');
const { compileRules, classify } = require('../services/warehouse/itemRules');
const { resolveMapping, effectiveKind } = require('../services/warehouse/osvMaterialize');

sequelize.options.logging = false;

const MEDICINE_CATEGORY = 'Лекарственные препараты';

/**
 * Код позиции. Повторяет codeFor() из osvMaterialize намеренно и дословно:
 * именно по совпадению кода и osvLineKey разбор узнаёт «эта позиция уже есть».
 * Экспортировать функцию оттуда было бы честнее, но тогда служебный скрипт
 * начал бы диктовать состав публичного интерфейса сервиса.
 */
const codeFor = lineKey => `ОСВ-${lineKey.slice(0, 10).toUpperCase()}`;

async function main() {
  const checkOnly = process.argv.includes('--check');

  try {
    await sequelize.authenticate();
    console.log('\n▶ Номенклатура из ведомости');
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}`);

    const snapshot = await WhOsvImport.findOne({
      where: { status: 'applied' },
      order: [['periodYear', 'DESC'], ['periodMonth', 'DESC'], ['createdAt', 'DESC']],
    });
    if (!snapshot) throw new Error('нет ни одного применённого снимка ведомости');
    console.log(`   Снимок: ${snapshot.periodLabel}, счёт ${snapshot.account}\n`);

    const [lines, mappings, rules, categories] = await Promise.all([
      WhOsvLine.findAll({ where: { importId: snapshot.id, isGroup: false }, order: [['sortOrder', 'ASC']] }),
      WhOsvMapping.findAll({ where: { account: snapshot.account } }),
      WhItemRule.findAll({ where: { isActive: true } }),
      WhCategory.findAll(),
    ]);

    const { compiled, broken } = compileRules(rules);
    if (broken.length) {
      console.log('   ⚠ выражения словаря не разобрались и выключены из расчёта:');
      for (const item of broken) console.log(`     ${item.pattern} — ${item.reason}`);
      console.log('');
    }
    if (!compiled.length) throw new Error('словарь предметов пуст — сначала npm run migrate:7.13');

    const byLineKey = new Map(mappings.filter(m => m.lineKey).map(m => [m.lineKey, m]));
    const byPrefix = mappings.filter(m => m.pathPrefix);
    const medicineId = categories.find(c => c.name === MEDICINE_CATEGORY)?.id || null;

    const existing = new Map(
      (await WhNomenclature.findAll({
        attributes: ['id', 'osvLineKey', 'categoryId'],
        where: { osvLineKey: { [Op.ne]: null } },
      })).map(row => [row.osvLineKey, row]),
    );

    const planned = [];
    // Позиции, заведённые разбором ДО появления словаря: категории у них нет,
    // потому что подставлять её было неоткуда. Проставляем задним числом —
    // но только там, где поле пустое: заполненное мог выбрать человек.
    const backfill = [];
    const stat = { asset: 0, ignore: 0, unmapped: 0, already: 0, noCategory: 0 };

    for (const row of lines) {
      const line = row.get({ plain: true });
      const { mapping } = resolveMapping(line, byLineKey, byPrefix);
      const rule = classify(line.name, compiled);
      // Подпорка `mapping || { kind: 'auto' }` здесь стояла до ver. 7.14: без
      // неё effectiveKind отказывалась спрашивать словарь у строки без
      // сопоставления, а справочнику никакая разметка веток не нужна. Теперь
      // словарь спрашивается сам, и подпорка не нужна.
      const kind = effectiveKind(line, mapping, rule);

      if (kind === 'asset') { stat.asset += 1; continue; }
      if (kind === 'ignore') { stat.ignore += 1; continue; }
      if (kind === 'unmapped') { stat.unmapped += 1; continue; }

      const categoryId = mapping?.categoryId || rule?.categoryId || null;

      const known = existing.get(line.lineKey);
      if (known) {
        stat.already += 1;
        if (!known.categoryId && categoryId) {
          backfill.push({
            id: known.id,
            categoryId,
            isMedicine: Boolean(medicineId) && categoryId === medicineId,
          });
        }
        continue;
      }

      if (!categoryId) stat.noCategory += 1;

      planned.push({
        code: codeFor(line.lineKey),
        name: line.name.slice(0, 500),
        categoryId,
        unit: mapping?.unit || rule?.unit || 'шт',
        // Партии по ведомости не отслеживаются: сроков годности и номеров партий
        // в файле нет, а пустая партия на каждую позицию только засоряет FEFO.
        tracksBatch: false,
        isMedicine: Boolean(medicineId) && categoryId === medicineId,
        // lastPrice ОСТАЁТСЯ ПУСТЫМ. Цена в ведомости балансовая, а не
        // закупочная, и подставить её сюда значит однажды увидеть её в запросе
        // котировок как «нашу последнюю цену» — с расхождением, которое никто
        // не сможет объяснить поставщику. Заполнится первым реальным приходом.
        osvLineKey: line.lineKey,
      });
    }

    console.log(`   Строк в снимке:            ${lines.length}`);
    console.log(`   Уйдут карточками:          ${stat.asset}`);
    console.log(`   Не разобраны словарём:     ${stat.unmapped}`);
    if (stat.ignore) console.log(`   Помечены «не заводить»:    ${stat.ignore}`);
    console.log(`   Уже есть в справочнике:    ${stat.already}`);
    console.log(`   К созданию:                ${planned.length}`);
    if (stat.noCategory) console.log(`   ⚠ из них без категории:    ${stat.noCategory}`);
    if (backfill.length) console.log(`   Проставить категорию:      ${backfill.length}`);

    if (checkOnly || (!planned.length && !backfill.length)) {
      console.log(planned.length || backfill.length
        ? '\n   Запуск: npm run warehouse:nomenclature\n'
        : '\n✅ Справочник уже полон\n');
      return;
    }

    await sequelize.transaction(async (transaction) => {
      // Пачками по 500: три тысячи отдельных INSERT — это три тысячи обращений
      // к базе там, где хватает шести.
      for (let i = 0; i < planned.length; i += 500) {
        await WhNomenclature.bulkCreate(planned.slice(i, i + 500), { transaction });
      }
      // Категории проставляются одним UPDATE на категорию, а не построчно: их
      // двенадцать, а позиций тысячи.
      const byCategory = new Map();
      for (const row of backfill) {
        if (!byCategory.has(row.categoryId)) byCategory.set(row.categoryId, []);
        byCategory.get(row.categoryId).push(row.id);
      }
      for (const [categoryId, ids] of byCategory) {
        await WhNomenclature.update(
          { categoryId, isMedicine: Boolean(medicineId) && categoryId === medicineId },
          { where: { id: { [Op.in]: ids } }, transaction },
        );
      }
    });

    const total = await WhNomenclature.count();
    console.log(`\n✅ Создано позиций: ${planned.length}, проставлено категорий: ${backfill.length}.`);
    console.log(`   Всего в справочнике: ${total}\n`);
  } finally {
    await sequelize.close().catch(() => {});
  }
}

main().catch(error => {
  const message = error?.original?.message || error?.parent?.message || error?.message
    || error?.original?.code || error?.name || String(error);
  console.error(`\n❌ Номенклатура не заполнена: ${message}\n`);
  process.exitCode = 1;
});
