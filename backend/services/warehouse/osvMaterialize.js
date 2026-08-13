/**
 * Разбор ведомости: превращение снимка 1С в объекты портала.
 *
 * Снимок сам по себе — только справка «что стоит на балансе». Работать с
 * имуществом портал начинает, когда из строк ведомости появились номенклатура,
 * карточки оборудования с инвентарными номерами и остатки на полках. Этим и
 * занимается этот сервис.
 *
 * ── Почему сопоставляются ветки, а не строки ─────────────────────────────────
 *
 * Строк-позиций 2992. Разобрать их по одной невозможно ни за какое разумное
 * время, поэтому решение принимается по ветке дерева 1С («Кабинет Хирурга»,
 * «Оргтехника Владимирская,93»), а строки его наследуют. Групп третьего уровня
 * всего 54, и половина названа прямо по кабинету.
 *
 * Но внутри одной ветки лежит и хирургический инструмент за 300 000 ₽, и
 * салфетки по рублю — одинаково обойтись с ними нельзя. Отсюда тип 'auto':
 * ветка сопоставляется целиком, а разделение идёт по цене за единицу. Дороже
 * порога — отдельная карточка с этикеткой, дешевле — количество на полке.
 *
 * ── Идемпотентность ──────────────────────────────────────────────────────────
 *
 * Материализацию будут запускать повторно: после правки сопоставлений, после
 * нового месяца, просто на всякий случай. Второй запуск обязан не создать
 * ничего лишнего, иначе каждый клик удваивал бы имущество сети. Опорой служат
 * обратные ссылки osvLineKey: номенклатура на строку одна, карточек столько,
 * сколько единиц в ведомости, и создаются только недостающие.
 *
 * Остатки материалов доводятся до количества из 1С, а не прибавляются: разница
 * между ведомостью и остатком портала оформляется приходом ровно на недостающее.
 * Излишек портала над ведомостью здесь не трогается — это расхождение учёта, и
 * закрывать его молча значило бы стирать предмет аудита.
 */

const { Op } = require('sequelize');
const {
  sequelize, WhOsvLine, WhOsvMapping, WhNomenclature, WhAsset, WhStock,
  WhStorage, WhRoom, WhDepartment, WhMovement,
} = require('../../models');
const { generateInventoryNumber } = require('./numbering');
const { createDocument } = require('./stock');
const qr = require('./qr');

// Порог по умолчанию. По августовской выгрузке даёт 3277 карточек и 79 %
// стоимости имущества под поштучным контролем — при 18 867 единицах всего.
const DEFAULT_ASSET_THRESHOLD = 10000;

/**
 * Сопоставление, действующее на строку. Точное правило по строке важнее
 * ветки — иначе исключение внутри ветки нечем было бы задать, — а из веток
 * выигрывает самая длинная: она конкретнее.
 */
function resolveMapping(line, byLineKey, byPrefix) {
  let branch = null;
  for (const mapping of byPrefix) {
    const prefix = mapping.pathPrefix;
    if (!matchesPrefix(line, prefix)) continue;
    if (!branch || weight(prefix) > weight(branch.pathPrefix)) branch = mapping;
  }

  const exact = byLineKey.get(line.lineKey);
  if (!exact) return branch ? { mapping: branch, scope: 'group' } : { mapping: null, scope: null };

  // Правило по строке не заменяет ветку, а дополняет её. Иначе переопределение
  // одного только типа («эту позицию всё-таки карточкой») отобрало бы у строки
  // кабинет, заданный ветке, — и строка молча выпала бы из разбора.
  return {
    scope: 'line',
    mapping: {
      id: exact.id,
      kind: exact.kind,
      assetThreshold: exact.assetThreshold ?? branch?.assetThreshold ?? null,
      unit: exact.unit || branch?.unit || null,
      roomId: exact.roomId || branch?.roomId || null,
      storageId: exact.storageId || branch?.storageId || null,
      categoryId: exact.categoryId || branch?.categoryId || null,
    },
  };
}

// ROOT_PREFIX — «весь счёт целиком». Нужен из-за позиций, лежащих прямо на счёте,
// без единой группы над ними: в августовской выгрузке таких 44 строки на 6,6 млн ₽.
// Путь у них пустой, и никакая ветка их не покрывает — значит разобрать их было бы
// нечем, а молча потерянные шесть миллионов хуже лишней строки в интерфейсе.
const ROOT_PREFIX = '*';

const matchesPrefix = (line, prefix) => (prefix === ROOT_PREFIX
  ? true
  : line.pathText === prefix || Boolean(line.pathText?.startsWith(`${prefix} / `)));

// Корень уступает любой настоящей ветке: он самое общее правило, какое бывает.
const weight = prefix => (prefix === ROOT_PREFIX ? -1 : prefix.length);

/** Во что превращается строка: карточки, остаток или ничего. */
function effectiveKind(line, mapping) {
  if (!mapping) return 'unmapped';
  if (mapping.kind !== 'auto') return mapping.kind;

  const threshold = Number(mapping.assetThreshold ?? DEFAULT_ASSET_THRESHOLD);
  const unitCost = Number(line.unitCost) || 0;
  const qty = Number(line.closingQty) || 0;

  // Дробное количество — это метры портьеры и миллилитры спирта. Инвентарный
  // номер на 2,02 метра ткани не выдаётся ни при какой цене.
  if (qty % 1 !== 0) return 'material';
  return unitCost >= threshold ? 'asset' : 'material';
}

/**
 * Расклад по строкам без изменения данных: что получится, если запустить.
 * Тот же расчёт используется и экраном разбора, и самой материализацией —
 * разойтись предпросмотру с результатом не на чем.
 */
async function planMaterialization(importId, account) {
  const [lines, mappings] = await Promise.all([
    WhOsvLine.findAll({ where: { importId, isGroup: false }, order: [['sortOrder', 'ASC']] }),
    WhOsvMapping.findAll({ where: { account } }),
  ]);

  const byLineKey = new Map(mappings.filter(m => m.lineKey).map(m => [m.lineKey, m]));
  const byPrefix = mappings.filter(m => m.pathPrefix);

  const plan = lines.map((row) => {
    const line = row.get({ plain: true });
    const { mapping, scope } = resolveMapping(line, byLineKey, byPrefix);
    return {
      line,
      mapping,
      scope,
      kind: effectiveKind(line, mapping),
      roomId: mapping?.roomId || null,
      storageId: mapping?.storageId || null,
      categoryId: mapping?.categoryId || null,
      unit: mapping?.unit || 'шт',
    };
  });

  const totals = { unmapped: 0, ignore: 0, material: 0, asset: 0, assetUnits: 0, sumMapped: 0 };
  for (const item of plan) {
    if (item.kind === 'unmapped') totals.unmapped += 1;
    else {
      totals.sumMapped += Number(item.line.closingSum) || 0;
      if (item.kind === 'ignore') totals.ignore += 1;
      else if (item.kind === 'asset') {
        totals.asset += 1;
        totals.assetUnits += Math.round(Number(item.line.closingQty) || 0);
      } else totals.material += 1;
    }
  }

  return { plan, totals };
}

/** Код номенклатуры выводится из ключа строки: тогда он не зависит от порядка
 *  запуска и повторный разбор не выдаёт той же позиции второй код. */
const codeFor = lineKey => `ОСВ-${lineKey.slice(0, 10).toUpperCase()}`;

/**
 * @param {string} importId  применённый снимок
 * @param {string} account   счёт (МЦ.04)
 * @param {object} user      кто запустил
 * @param {boolean} dryRun   только посчитать
 */
async function materializeOsv({ importId, account, user, dryRun = false }) {
  const { plan, totals } = await planMaterialization(importId, account);

  const report = {
    totals,
    nomenclatureCreated: 0,
    assetsCreated: 0,
    stockReceipts: 0,
    stockQty: 0,
    alreadyDone: 0,
    problems: [],
    documentNumber: null,
  };

  const work = plan.filter(item => item.kind === 'asset' || item.kind === 'material');
  if (!work.length) return report;

  // Место хранения обязательно и у карточки, и у остатка. Когда сопоставление
  // указывает только кабинет, берём первое место хранения этого кабинета:
  // требовать выбирать полку для каждой из 54 веток — работа без содержания.
  const roomIds = [...new Set(work.map(i => i.roomId).filter(Boolean))];
  const [storages, rooms] = await Promise.all([
    WhStorage.findAll({ where: { roomId: { [Op.in]: roomIds }, isActive: true },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']] }),
    WhRoom.findAll({ where: { id: { [Op.in]: roomIds } },
      include: [{ model: WhDepartment, as: 'department' }] }),
  ]);
  const firstStorage = new Map();
  for (const s of storages) if (!firstStorage.has(s.roomId)) firstStorage.set(s.roomId, s);
  const roomById = new Map(rooms.map(r => [r.id, r]));

  // Что уже создано прошлыми запусками.
  const keys = work.map(i => i.line.lineKey);
  const [existingNom, existingAssets] = await Promise.all([
    WhNomenclature.findAll({ where: { osvLineKey: { [Op.in]: keys } } }),
    WhAsset.findAll({ where: { osvLineKey: { [Op.in]: keys } }, attributes: ['id', 'osvLineKey'] }),
  ]);
  const nomByKey = new Map(existingNom.map(n => [n.osvLineKey, n]));
  const assetCount = new Map();
  for (const a of existingAssets) assetCount.set(a.osvLineKey, (assetCount.get(a.osvLineKey) || 0) + 1);

  const problem = (item, text) => report.problems.push({
    name: item.line.name, pathText: item.line.pathText, reason: text,
  });

  if (dryRun) {
    for (const item of work) {
      if (!item.roomId) problem(item, 'Не выбран кабинет');
      else if (!item.storageId && !firstStorage.has(item.roomId)) {
        problem(item, `В кабинете «${roomById.get(item.roomId)?.number || '?'}» нет мест хранения`);
      }
    }
    return report;
  }

  await sequelize.transaction(async (t) => {
    const receiptLines = [];

    for (const item of work) {
      const { line } = item;
      const storageId = item.storageId || firstStorage.get(item.roomId)?.id || null;

      if (!item.roomId) { problem(item, 'Не выбран кабинет'); continue; }
      if (!storageId) {
        problem(item, `В кабинете «${roomById.get(item.roomId)?.number || '?'}» нет мест хранения`);
        continue;
      }

      if (item.kind === 'asset') {
        const needed = Math.round(Number(line.closingQty) || 0);
        const have = assetCount.get(line.lineKey) || 0;
        if (have >= needed) { report.alreadyDone += 1; continue; }

        const room = roomById.get(item.roomId);
        const specialtyCode = room?.department?.specialtyCode || 'АХО';
        const unitCost = Number(line.unitCost) || 0;

        for (let i = have; i < needed; i++) {
          const inventoryNumber = await generateInventoryNumber({ specialtyCode, transaction: t });
          const asset = await WhAsset.create({
            inventoryNumber,
            name: line.name.slice(0, 300),
            categoryId: item.categoryId || null,
            roomId: item.roomId,
            storageId,
            responsibleUserId: room?.responsibleUserId || null,
            status: 'in_use',
            initialCost: unitCost,
            osvLineKey: line.lineKey,
            notes: `Создано разбором ведомости 1С. Ветка: ${line.pathText || '—'}`,
            publicToken: qr.generateToken(),
            lastActivityAt: new Date(),
            createdBy: user?.id || null,
          }, { transaction: t });

          // Постановка на учёт — тоже движение: без неё лента жизни актива
          // начинается с пустоты и приём не виден в отчёте о движении.
          await WhMovement.create({
            type: 'receipt',
            assetId: asset.id,
            quantity: 1,
            unitCost,
            amount: unitCost,
            toRoomId: item.roomId,
            toStorageId: storageId,
            toResponsibleId: room?.responsibleUserId || null,
            reasonCode: 'osv_import',
            reasonText: 'Постановка на учёт по ведомости 1С',
            initiatorUserId: user?.id || null,
            occurredAt: new Date(),
          }, { transaction: t });

          report.assetsCreated += 1;
        }
        continue;
      }

      // ── Материал ────────────────────────────────────────────────────────────
      let nomenclature = nomByKey.get(line.lineKey);
      if (!nomenclature) {
        nomenclature = await WhNomenclature.create({
          code: codeFor(line.lineKey),
          name: line.name.slice(0, 500),
          categoryId: item.categoryId || null,
          unit: item.unit || 'шт',
          // Партии по ведомости не отслеживаются: сроков годности и номеров
          // партий в файле нет, а пустая партия на каждую позицию только
          // засоряет FEFO. Появятся при первом реальном приходе.
          tracksBatch: false,
          osvLineKey: line.lineKey,
        }, { transaction: t });
        nomByKey.set(line.lineKey, nomenclature);
        report.nomenclatureCreated += 1;
      }

      const stock = await WhStock.findOne({
        where: { nomenclatureId: nomenclature.id, storageId, batchId: null }, transaction: t,
      });
      const have = Number(stock?.quantity) || 0;
      const need = Number(line.closingQty) || 0;
      const delta = need - have;
      if (delta <= 0.0005) { report.alreadyDone += 1; continue; }

      receiptLines.push({
        nomenclatureId: nomenclature.id,
        quantity: delta,
        unitCost: Number(line.unitCost) || 0,
        toStorageId: storageId,
      });
      report.stockReceipts += 1;
      report.stockQty += delta;
    }

    // Все материалы — одним приходным документом. Три тысячи документов по одной
    // строке сделали бы журнал операций нечитаемым, а постановка на учёт по
    // ведомости — это одно событие.
    if (receiptLines.length) {
      const { document } = await createDocument({
        type: 'receipt',
        lines: receiptLines,
        user,
        reasonCode: 'osv_import',
        reasonText: 'Постановка на учёт по ведомости 1С',
        comment: 'Создано разбором оборотно-сальдовой ведомости',
      }, { transaction: t });
      report.documentNumber = document.number;
    }
  });

  return report;
}

module.exports = {
  materializeOsv,
  planMaterialization,
  resolveMapping,
  effectiveKind,
  matchesPrefix,
  ROOT_PREFIX,
  DEFAULT_ASSET_THRESHOLD,
};
