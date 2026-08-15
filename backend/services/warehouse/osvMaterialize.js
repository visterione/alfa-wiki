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
 * ── Откуда берётся категория и способ учёта (ver. 6.79) ──────────────────────
 *
 * Одной цены для этого мало. Она отвечает на вопрос «как учитывать», но не на
 * вопрос «что это»: ножницы за 522 ₽ и одеяло за 1350 ₽ по стоимости
 * неразличимы. На второй вопрос отвечает словарь предметов по названию
 * (services/warehouse/itemRules.js), и цепочка решений выглядит так:
 *
 *     правило по строке → правило ветки → СЛОВАРЬ → порог цены
 *
 * Явно заданное человеком сильнее словаря, словарь сильнее порога, порог
 * остаётся последним фолбэком. При пустом словаре разбор ведёт себя ровно так
 * же, как до ver. 6.79.
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
  WhStorage, WhRoom, WhDepartment, WhMovement, WhItemRule, WhCategory,
  WhOsvPlacement,
} = require('../../models');
const { generateInventoryNumber } = require('./numbering');
const { createDocument } = require('./stock');
const { compileRules, classify } = require('./itemRules');
const { splitName } = require('./nameParts');
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

/**
 * Во что превращается строка: карточки, остаток или ничего.
 *
 * Порядок ответов — от самого конкретного к самому общему: решение человека по
 * строке или ветке, затем словарь предметов по названию, затем порог цены.
 * Словарь стоит НИЖЕ человека сознательно: это правило по умолчанию для класса
 * вещей, а не начальство над тем, кто смотрит на конкретную ветку.
 */
function effectiveKind(line, mapping, rule = null) {
  if (!mapping) return 'unmapped';
  if (mapping.kind !== 'auto') return mapping.kind;

  if (rule?.accounting === 'ignore') return 'ignore';

  const qty = Number(line.closingQty) || 0;
  // Дробное количество — это метры портьеры и миллилитры спирта. Инвентарный
  // номер на 2,02 метра ткани не выдаётся ни при какой цене и ни по какому
  // правилу словаря, поэтому проверка стоит выше него.
  if (qty % 1 !== 0) return 'material';

  if (rule?.accounting === 'asset' || rule?.accounting === 'material') return rule.accounting;

  // Порог ветки сильнее порога словаря по той же причине: его задал человек,
  // глядя на эту ветку, а словарный — общий для класса предметов.
  const threshold = Number(
    mapping.assetThreshold ?? rule?.assetThreshold ?? DEFAULT_ASSET_THRESHOLD,
  );
  const unitCost = Number(line.unitCost) || 0;
  return unitCost >= threshold ? 'asset' : 'material';
}

/**
 * Расклад по строкам без изменения данных: что получится, если запустить.
 * Тот же расчёт используется и экраном разбора, и самой материализацией —
 * разойтись предпросмотру с результатом не на чем.
 */
async function planMaterialization(importId, account) {
  const [lines, mappings, rules, placements] = await Promise.all([
    WhOsvLine.findAll({ where: { importId, isGroup: false }, order: [['sortOrder', 'ASC']] }),
    WhOsvMapping.findAll({ where: { account } }),
    WhItemRule.findAll({ where: { isActive: true } }),
    WhOsvPlacement.findAll({ where: { account } }),
  ]);

  const byLineKey = new Map(mappings.filter(m => m.lineKey).map(m => [m.lineKey, m]));
  const byPrefix = mappings.filter(m => m.pathPrefix);
  // Выражения компилируются один раз на весь расчёт: строк три тысячи, и
  // собирать RegExp на каждую значило бы делать это по разу на правило и строку.
  const { compiled, broken } = compileRules(rules);

  const placedByLine = new Map();
  for (const row of placements) {
    const plain = row.get({ plain: true });
    if (!placedByLine.has(plain.lineKey)) placedByLine.set(plain.lineKey, []);
    placedByLine.get(plain.lineKey).push(plain);
  }

  const plan = lines.map((row) => {
    const line = row.get({ plain: true });
    const { mapping, scope } = resolveMapping(line, byLineKey, byPrefix);
    const rule = classify(line.name, compiled);
    const own = placedByLine.get(line.lineKey) || [];
    const placedQty = own.reduce((sum, p) => sum + Number(p.quantity), 0);
    const totalQty = Number(line.closingQty) || 0;

    return {
      line,
      mapping,
      scope,
      rule,
      kind: effectiveKind(line, mapping, rule),
      placements: own,
      placedQty,
      // Сколько единиц ещё нигде не лежит. Строка без единого размещения едет в
      // кабинет своей ветки целиком (запасной путь ver. 6.73), и нераспределённого
      // у неё нет; если ветка кабинета не задаёт — не размещено всё.
      unplacedQty: own.length
        ? Math.max(0, totalQty - placedQty)
        : (mapping?.roomId ? 0 : totalQty),
      roomId: mapping?.roomId || null,
      storageId: mapping?.storageId || null,
      // Категория и единица берутся из словаря, когда ветка их не задаёт: у
      // ветки они и не задаются — «Кабинет Хирурга» это место, а не класс вещей.
      categoryId: mapping?.categoryId || rule?.categoryId || null,
      unit: mapping?.unit || rule?.unit || 'шт',
    };
  });

  const totals = {
    unmapped: 0, ignore: 0, material: 0, asset: 0, assetUnits: 0, sumMapped: 0,
    // Сколько строк решил словарь, а сколько досталось порогу цены. Это мера
    // того, насколько словарь заполнен, и она нужна на экране разметки.
    byDictionary: 0, byThreshold: 0, withCategory: 0,
    // Размещение: сколько единиц уже разложено по кабинетам и сколько ждёт.
    placedUnits: 0, unplacedUnits: 0, linesWithPlacement: 0,
  };
  for (const item of plan) {
    if (item.kind === 'unmapped') totals.unmapped += 1;
    else {
      totals.sumMapped += Number(item.line.closingSum) || 0;
      if (item.kind === 'ignore') totals.ignore += 1;
      else if (item.kind === 'asset') {
        totals.asset += 1;
        totals.assetUnits += Math.round(Number(item.line.closingQty) || 0);
      } else totals.material += 1;

      if (item.rule) totals.byDictionary += 1; else totals.byThreshold += 1;
      if (item.categoryId) totals.withCategory += 1;
      if (item.placements.length) totals.linesWithPlacement += 1;
      totals.placedUnits += item.placedQty;
      totals.unplacedUnits += item.unplacedQty;
    }
  }

  return { plan, totals, brokenRules: broken };
}

/** Код номенклатуры выводится из ключа строки: тогда он не зависит от порядка
 *  запуска и повторный разбор не выдаёт той же позиции второй код. */
const codeFor = lineKey => `ОСВ-${lineKey.slice(0, 10).toUpperCase()}`;

/**
 * Куда именно едет строка и в каком количестве.
 *
 * Основной путь — размещения (ver. 6.80): «из этой строки три стула стоят в 305,
 * два в 307». Одна строка раскладывается на сколько угодно кабинетов, и то, что
 * не разложено, разбор не трогает — карточки на неразмещённое не создаются, и
 * это не недоделка, а условие правильного инвентарного номера.
 *
 * Запасной путь — кабинет ветки, как было до ver. 6.80. Он применяется только к
 * строкам, у которых нет ни одного размещения: во-первых, чтобы не осиротить
 * карточки, созданные раньше, во-вторых, потому что ветка, честно равная одному
 * кабинету, бывает — и раскладывать её поштучно было бы работой без содержания.
 */
function targetsOf(item) {
  if (item.placements?.length) {
    return item.placements.map(p => ({
      placementId: p.id,
      roomId: p.roomId,
      storageId: p.storageId || null,
      quantity: Number(p.quantity) || 0,
    }));
  }
  if (!item.roomId) return [];
  return [{
    placementId: null,
    roomId: item.roomId,
    storageId: item.storageId || null,
    quantity: Number(item.line.closingQty) || 0,
  }];
}

/**
 * Под каким ключом считать уже созданные карточки. У размещения это оно само, у
 * запасного пути — строка ведомости: так старые карточки (созданные до 6.80, без
 * ссылки на размещение) продолжают считаться по-старому и не дублируются.
 */
const countKey = (placementId, lineKey) => placementId || `line:${lineKey}`;

/**
 * @param {string} importId  применённый снимок
 * @param {string} account   счёт (МЦ.04)
 * @param {object} user      кто запустил
 * @param {boolean} dryRun   только посчитать
 */
async function materializeOsv({ importId, account, user, dryRun = false }) {
  const { plan, totals, brokenRules } = await planMaterialization(importId, account);

  const report = {
    totals,
    nomenclatureCreated: 0,
    assetsCreated: 0,
    stockReceipts: 0,
    stockQty: 0,
    alreadyDone: 0,
    problems: [],
    documentNumber: null,
    // Сломанное выражение в словаре не роняет разбор, но и молчать о нём нельзя:
    // правило просто не сработало, и без этого списка человек считал бы, что
    // оно применилось.
    brokenRules,
  };

  const work = plan.filter(item => item.kind === 'asset' || item.kind === 'material');
  if (!work.length) return report;

  const targets = new Map(work.map(item => [item.line.lineKey, targetsOf(item)]));
  const allTargets = [...targets.values()].flat();

  // Место хранения обязательно и у карточки, и у остатка. Когда назначение
  // указывает только кабинет, берём первое место хранения этого кабинета:
  // требовать выбирать полку для каждой из тысяч позиций — работа без содержания.
  const roomIds = [...new Set(allTargets.map(x => x.roomId).filter(Boolean))];
  const categoryIds = [...new Set(work.map(i => i.categoryId).filter(Boolean))];
  const [storages, rooms, categories] = await Promise.all([
    WhStorage.findAll({ where: { roomId: { [Op.in]: roomIds }, isActive: true },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']] }),
    WhRoom.findAll({ where: { id: { [Op.in]: roomIds } },
      include: [{ model: WhDepartment, as: 'department' }] }),
    WhCategory.findAll({ where: { id: { [Op.in]: categoryIds } } }),
  ]);
  const firstStorage = new Map();
  for (const s of storages) if (!firstStorage.has(s.roomId)) firstStorage.set(s.roomId, s);
  const roomById = new Map(rooms.map(r => [r.id, r]));
  // ОКОФ, амортизационная группа и срок службы — свойства класса вещей, а не
  // отдельной единицы, поэтому они живут на категории и переносятся в карточку
  // при создании. Пока бухгалтерия их не назвала, поля у категорий пустые и
  // переносится пустота — это ожидаемо и лучше правдоподобной догадки.
  const categoryById = new Map(categories.map(c => [c.id, c]));

  // Что уже создано прошлыми запусками.
  const keys = work.map(i => i.line.lineKey);
  const [existingNom, existingAssets] = await Promise.all([
    WhNomenclature.findAll({ where: { osvLineKey: { [Op.in]: keys } } }),
    WhAsset.findAll({
      where: { osvLineKey: { [Op.in]: keys } },
      attributes: ['id', 'osvLineKey', 'osvPlacementId'],
    }),
  ]);
  const nomByKey = new Map(existingNom.map(n => [n.osvLineKey, n]));
  const assetCount = new Map();
  for (const a of existingAssets) {
    const key = countKey(a.osvPlacementId, a.osvLineKey);
    assetCount.set(key, (assetCount.get(key) || 0) + 1);
  }

  const problem = (item, text) => report.problems.push({
    name: item.line.name, pathText: item.line.pathText, reason: text,
  });

  const storageFor = target => target.storageId || firstStorage.get(target.roomId)?.id || null;

  if (dryRun) {
    for (const item of work) {
      const own = targets.get(item.line.lineKey);
      if (!own.length) { problem(item, 'Не размещено: не выбран кабинет'); continue; }
      for (const target of own) {
        if (!storageFor(target)) {
          problem(item, `В кабинете «${roomById.get(target.roomId)?.number || '?'}» нет мест хранения`);
        }
      }
      // Остаток строки, который ещё нигде не лежит, — не ошибка, но человек
      // должен знать, что часть количества разбор не тронет.
      if (item.unplacedQty > 0.0005 && item.placements.length) {
        problem(item, `Размещено ${item.placedQty} из ${Number(item.line.closingQty)} — остальное пропущено`);
      }
    }
    return report;
  }

  await sequelize.transaction(async (t) => {
    const receiptLines = [];

    for (const item of work) {
      const { line } = item;
      const own = targets.get(line.lineKey);
      if (!own.length) { problem(item, 'Не размещено: не выбран кабинет'); continue; }

      for (const target of own) {
        const storageId = storageFor(target);
        if (!storageId) {
          problem(item, `В кабинете «${roomById.get(target.roomId)?.number || '?'}» нет мест хранения`);
          continue;
        }

        if (item.kind === 'asset') {
          const needed = Math.round(target.quantity || 0);
          const key = countKey(target.placementId, line.lineKey);
          const have = assetCount.get(key) || 0;
          if (have >= needed) { report.alreadyDone += 1; continue; }

          const room = roomById.get(target.roomId);
          // Код специальности берётся из отделения кабинета, в котором вещь
          // РАЗМЕЩЕНА, — и именно поэтому карточка не создаётся, пока кабинет
          // неизвестен: номер отражает специальность на момент постановки на
          // учёт и не меняется никогда. Создать её раньше значит выдать три
          // тысячи номеров с кодом АХО навсегда.
          const specialtyCode = room?.department?.specialtyCode || 'АХО';
          const unitCost = Number(line.unitCost) || 0;
          const category = item.categoryId ? categoryById.get(item.categoryId) : null;
          // Модель и производитель вытаскиваются из названия (ver. 6.80). Само
          // НАЗВАНИЕ при этом не меняется: по нему сходится сверка с
          // бухгалтерией, и переписать его значит однажды не найти позицию в
          // ведомости. Разбор эвристический и находит модель примерно у трети
          // позиций — заполнить пустое поле там, где получилось, лучше, чем
          // оставить пустыми все.
          const parts = splitName(line.name);

          for (let i = have; i < needed; i++) {
            const inventoryNumber = await generateInventoryNumber({ specialtyCode, transaction: t });
            const asset = await WhAsset.create({
              inventoryNumber,
              name: line.name.slice(0, 300),
              model: parts.model ? parts.model.slice(0, 200) : null,
              manufacturer: parts.manufacturer ? parts.manufacturer.slice(0, 200) : null,
              categoryId: item.categoryId || null,
              okof: category?.okof || null,
              depreciationGroup: category?.depreciationGroup ?? null,
              usefulLifeMonths: category?.defaultUsefulMonths ?? null,
              roomId: target.roomId,
              storageId,
              responsibleUserId: room?.responsibleUserId || null,
              status: 'in_use',
              initialCost: unitCost,
              osvLineKey: line.lineKey,
              osvPlacementId: target.placementId,
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
              toRoomId: target.roomId,
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

        // ── Материал ──────────────────────────────────────────────────────────
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
        const delta = target.quantity - have;
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
  targetsOf,
  matchesPrefix,
  ROOT_PREFIX,
  DEFAULT_ASSET_THRESHOLD,
};
