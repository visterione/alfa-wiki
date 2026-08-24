/**
 * Оборотно-сальдовая ведомость 1С: загрузка файла, снимки, дерево, сравнение.
 *
 * Порядок работы намеренно в два шага. Загрузка разбирает файл и кладёт его
 * ЧЕРНОВИКОМ — вместе со сравнением с предыдущим применённым снимком. Только
 * после того, как человек увидел «появилось 12 строк, пропало 3, у 40 изменилось
 * количество», черновик становится снимком месяца.
 *
 * Одношаговый импорт был бы короче, но ошибку выгрузки (не тот период, не та
 * организация, половина номенклатуры) в нём замечают уже после того, как она
 * стала данными. Здесь она видна до.
 *
 * Файл после разбора не хранится: в базе лежат все его строки до последней, а
 * XLSX с ценами — лишний объект на диске, за которым надо следить. Хеш
 * содержимого сохраняется, чтобы узнать повторную загрузку того же файла.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const { Op } = require('sequelize');

const {
  sequelize, WhOsvImport, WhOsvLine, WhOsvMapping, WhCategory, WhAsset, WhNomenclature, User,
} = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse, requireReport } = require('../../services/warehouse/access');
const { parseOsv, diffSnapshots, OsvParseError } = require('../../services/warehouse/osv');
const {
  materializeOsv, planMaterialization, reviewGroups, decisionOf,
} = require('../../services/warehouse/osvMaterialize');

// Файл держим в памяти: он разбирается целиком и на диск не ложится. Предел в
// 25 МБ — с запасом: августовская выгрузка на 6202 строки весит 281 КБ.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.xlsx$/i.test(file.originalname);
    cb(ok ? null : new Error('Нужен файл .xlsx, выгруженный из 1С'), ok);
  },
});

const userAttrs = ['id', 'displayName', 'username', 'avatar'];

const importAttrs = [
  'id', 'account', 'organization', 'periodYear', 'periodMonth', 'periodLabel',
  'fileName', 'fileSize', 'fileHash', 'status', 'lineCount', 'groupCount', 'leafCount',
  'openingSum', 'openingQty', 'debitSum', 'debitQty', 'creditSum', 'creditQty',
  'closingSum', 'closingQty', 'warnings', 'appliedAt', 'createdAt',
];

/** Последний применённый снимок до указанного периода — база для сравнения. */
async function previousApplied(account, periodYear, periodMonth, exceptId = null) {
  const where = {
    account,
    status: 'applied',
    [Op.and]: [{
      [Op.or]: [
        { periodYear: { [Op.lt]: periodYear } },
        { periodYear, periodMonth: { [Op.lt]: periodMonth } },
      ],
    }],
  };
  if (exceptId) where.id = { [Op.ne]: exceptId };

  return WhOsvImport.findOne({
    where,
    order: [['periodYear', 'DESC'], ['periodMonth', 'DESC']],
    attributes: importAttrs,
  });
}

/**
 * Сравнение с предыдущим снимком. Возвращает не сами списки целиком, а счётчики
 * и первые строки каждого вида: «появилось 340 позиций» в выгрузке за первый
 * месяц — это нормально, и грузить их все на экран незачем.
 */
async function buildDiff(importRow, lines) {
  const base = await previousApplied(
    importRow.account, importRow.periodYear, importRow.periodMonth, importRow.id,
  );
  if (!base) return { base: null, added: [], removed: [], changed: [], counts: null };

  const baseLines = await WhOsvLine.findAll({
    where: { importId: base.id, isGroup: false },
    attributes: ['lineKey', 'name', 'pathText', 'closingQty', 'closingSum', 'isGroup'],
  });

  const diff = diffSnapshots(baseLines.map(l => l.get({ plain: true })), lines);
  const brief = list => list.slice(0, 50).map(l => ({
    lineKey: l.lineKey, name: l.name, pathText: l.pathText,
    closingQty: Number(l.closingQty), closingSum: Number(l.closingSum),
    previousQty: l.previousQty, previousSum: l.previousSum,
    qtyDelta: l.qtyDelta, sumDelta: l.sumDelta,
  }));

  return {
    base: {
      id: base.id, periodYear: base.periodYear, periodMonth: base.periodMonth,
      periodLabel: base.periodLabel, closingSum: Number(base.closingSum), closingQty: Number(base.closingQty),
    },
    counts: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length },
    added: brief(diff.added),
    removed: brief(diff.removed),
    changed: brief(diff.changed),
  };
}

// ── Список снимков ───────────────────────────────────────────────────────────
router.get('/imports', authenticate, requireWarehouse(), requireReport('RPT-OSV'), async (req, res) => {
  try {
    const rows = await WhOsvImport.findAll({
      attributes: importAttrs,
      include: [
        { model: User, as: 'uploader', attributes: userAttrs },
        { model: User, as: 'applier', attributes: userAttrs },
      ],
      order: [['periodYear', 'DESC'], ['periodMonth', 'DESC'], ['createdAt', 'DESC']],
      limit: 100,
    });
    res.json(rows);
  } catch (err) {
    console.error('GET warehouse/osv/imports error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Загрузка и разбор ────────────────────────────────────────────────────────
router.post('/imports', authenticate, requireWarehouse('canImportOsv'),
  upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

    let parsed;
    try {
      parsed = parseOsv(req.file.buffer);
    } catch (err) {
      if (err instanceof OsvParseError) return res.status(400).json({ error: err.message });
      console.error('OSV parse error:', err);
      return res.status(500).json({ error: 'Не удалось разобрать файл' });
    }

    // Период 1С пишет в заголовок листа, но выгрузить могут и за квартал, и за
    // произвольный интервал. Такой файл принимаем только с явно указанным
    // периодом: угадывать месяц по диапазону дат значит однажды заменить снимок
    // не того месяца.
    const periodYear = Number(req.body.periodYear) || parsed.header.periodYear;
    const periodMonth = Number(req.body.periodMonth) || parsed.header.periodMonth;
    if (!periodYear || !periodMonth) {
      return res.status(400).json({
        error: `Не удалось определить период по заголовку («${parsed.header.periodLabel || '—'}»). `
          + 'Укажите месяц и год вручную.',
        needsPeriod: true,
        header: parsed.header,
      });
    }

    const account = parsed.header.account || 'МЦ.04';
    // multer отдаёт имя в latin1 — без перекодировки русские названия ломаются.
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    try {
      const created = await sequelize.transaction(async (t) => {
        const row = await WhOsvImport.create({
          account,
          organization: parsed.header.organization,
          periodYear,
          periodMonth,
          periodLabel: parsed.header.periodLabel,
          fileName,
          fileSize: req.file.size,
          fileHash,
          status: 'draft',
          lineCount: parsed.totals.lineCount,
          groupCount: parsed.totals.groupCount,
          leafCount: parsed.totals.leafCount,
          openingSum: parsed.totals.openingSum,
          openingQty: parsed.totals.openingQty,
          debitSum: parsed.totals.debitSum,
          debitQty: parsed.totals.debitQty,
          creditSum: parsed.totals.creditSum,
          creditQty: parsed.totals.creditQty,
          closingSum: parsed.totals.closingSum,
          closingQty: parsed.totals.closingQty,
          warnings: parsed.warnings,
          uploadedBy: req.user.id,
        }, { transaction: t });

        await WhOsvLine.bulkCreate(parsed.lines.map((line, index) => ({
          importId: row.id,
          rowNumber: line.rowNumber,
          sortOrder: index,
          level: line.level,
          name: line.name.slice(0, 500),
          pathText: line.pathText,
          isGroup: line.isGroup,
          dupIndex: line.dupIndex,
          lineKey: line.lineKey,
          openingSum: line.openingSum,
          openingQty: line.openingQty,
          debitSum: line.debitSum,
          debitQty: line.debitQty,
          creditSum: line.creditSum,
          creditQty: line.creditQty,
          closingSum: line.closingSum,
          closingQty: line.closingQty,
          unitCost: line.unitCost,
        })), { transaction: t });

        return row;
      });

      const duplicate = await WhOsvImport.findOne({
        where: { fileHash, id: { [Op.ne]: created.id }, status: 'applied' },
        attributes: ['id', 'periodYear', 'periodMonth', 'createdAt'],
      });

      res.status(201).json({
        import: await WhOsvImport.findByPk(created.id, { attributes: importAttrs }),
        header: parsed.header,
        diff: await buildDiff(created, parsed.lines),
        // Тот же самый файл уже принят раньше — почти наверняка выгрузили не тот
        // месяц. Не запрещаем, но говорим прямо.
        sameFileAs: duplicate,
      });
    } catch (err) {
      console.error('POST warehouse/osv/imports error:', err);
      res.status(500).json({ error: 'Не удалось сохранить импорт' });
    }
  });

// ── Один снимок с деревом строк ──────────────────────────────────────────────
router.get('/imports/:id', authenticate, requireWarehouse(), requireReport('RPT-OSV'), async (req, res) => {
  try {
    const row = await WhOsvImport.findByPk(req.params.id, {
      attributes: importAttrs,
      include: [
        { model: User, as: 'uploader', attributes: userAttrs },
        { model: User, as: 'applier', attributes: userAttrs },
      ],
    });
    if (!row) return res.status(404).json({ error: 'Снимок не найден' });

    const { q, onlyLeaves } = req.query;
    const where = { importId: row.id };
    if (onlyLeaves === '1') where.isGroup = false;
    // Поиск отдаёт плоский список найденных позиций без групп: дерево, из
    // которого вырезали часть веток, читается хуже плоского списка с путём.
    if (q?.trim()) {
      where.name = { [Op.iLike]: `%${q.trim()}%` };
      where.isGroup = false;
    }

    const lines = await WhOsvLine.findAll({ where, order: [['sortOrder', 'ASC']] });

    res.json({
      import: row,
      lines,
      // Дерево целиком — 3100 строк; отдаём как есть, клиент сворачивает ветки
      // сам. Постраничная выдача дерева ломает подытоги: страница обрывается
      // посреди ветки, и её итог перестаёт сходиться с видимыми строками.
      isSearch: Boolean(q?.trim()),
    });
  } catch (err) {
    console.error('GET warehouse/osv/imports/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Сравнение с предыдущим снимком ───────────────────────────────────────────
router.get('/imports/:id/diff', authenticate, requireWarehouse(), requireReport('RPT-OSV'), async (req, res) => {
  try {
    const row = await WhOsvImport.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Снимок не найден' });

    const lines = await WhOsvLine.findAll({
      where: { importId: row.id, isGroup: false },
      attributes: ['lineKey', 'name', 'pathText', 'closingQty', 'closingSum', 'isGroup'],
    });
    res.json(await buildDiff(row, lines.map(l => l.get({ plain: true }))));
  } catch (err) {
    console.error('GET warehouse/osv/imports/:id/diff error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Принять черновик как снимок месяца ───────────────────────────────────────
router.post('/imports/:id/apply', authenticate, requireWarehouse('canImportOsv'), async (req, res) => {
  try {
    const row = await WhOsvImport.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Снимок не найден' });
    if (row.status === 'applied') return res.status(400).json({ error: 'Снимок уже применён' });

    await sequelize.transaction(async (t) => {
      // Снимок месяца ровно один: повторная выгрузка за тот же период заменяет
      // предыдущую. Хранить обе версии бессмысленно — вопрос «а какая из них
      // правильная» не имеет ответа, правильная всегда последняя.
      const replaced = await WhOsvImport.findOne({
        where: {
          account: row.account, periodYear: row.periodYear,
          periodMonth: row.periodMonth, status: 'applied', id: { [Op.ne]: row.id },
        },
        transaction: t,
      });
      if (replaced) await replaced.destroy({ transaction: t });

      await row.update(
        { status: 'applied', appliedAt: new Date(), appliedBy: req.user.id },
        { transaction: t },
      );
    });

    res.json(await WhOsvImport.findByPk(row.id, { attributes: importAttrs }));
  } catch (err) {
    console.error('POST warehouse/osv/imports/:id/apply error:', err);
    res.status(500).json({ error: 'Не удалось применить снимок' });
  }
});

// ── Удаление ─────────────────────────────────────────────────────────────────
router.delete('/imports/:id', authenticate, requireWarehouse('canImportOsv'), async (req, res) => {
  try {
    const row = await WhOsvImport.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Снимок не найден' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE warehouse/osv/imports/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Проверка перед прогоном: чем решено и что из этого выйдет ────────────────
/**
 * Расклад разбора, сгруппированный по причине решения.
 *
 * Считает сервер тем же кодом, которым потом создаёт объекты: если бы
 * предпросмотр считался на клиенте, он однажды разошёлся бы с результатом — и
 * разошёлся бы молча, потому что сверять их между собой некому. Для операции без
 * отката это условие, а не удобство.
 */
router.get('/review', authenticate, requireWarehouse(), requireReport('RPT-OSV'), async (req, res) => {
  try {
    const snapshot = req.query.importId
      ? await WhOsvImport.findByPk(req.query.importId)
      : await WhOsvImport.findOne({
        where: { status: 'applied' },
        order: [['periodYear', 'DESC'], ['periodMonth', 'DESC']],
      });
    if (!snapshot) return res.json({ import: null, groups: [], totals: null });

    const { plan, totals, brokenRules } = await planMaterialization(snapshot.id, snapshot.account);
    const groups = reviewGroups(plan);

    const categoryIds = [...new Set(groups.flatMap(g => g.categoryIds))];
    const keys = plan.map(item => item.line.lineKey);
    // Сколько по этому снимку уже создано. Прогон идемпотентен и второй раз
    // ничего не задвоит, но человек должен видеть, что снимок уже разобран:
    // отката нет, и «Создать объекты» на разобранном снимке — не то действие,
    // которое стоит совершать не глядя.
    const [categories, assetsDone, nomenclatureDone] = await Promise.all([
      WhCategory.findAll({ where: { id: { [Op.in]: categoryIds } }, attributes: ['id', 'name'] }),
      WhAsset.count({ where: { osvLineKey: { [Op.in]: keys } } }),
      WhNomenclature.count({ where: { osvLineKey: { [Op.in]: keys } } }),
    ]);
    const categoryName = new Map(categories.map(c => [c.id, c.name]));

    res.json({
      import: {
        id: snapshot.id, account: snapshot.account, periodYear: snapshot.periodYear,
        periodMonth: snapshot.periodMonth, leafCount: snapshot.leafCount,
        closingSum: Number(snapshot.closingSum),
      },
      totals,
      brokenRules,
      materialized: { assets: assetsDone, nomenclature: nomenclatureDone },
      groups: groups.map(g => ({
        ...g,
        categories: g.categoryIds.map(id => categoryName.get(id)).filter(Boolean),
      })),
    });
  } catch (err) {
    console.error('GET warehouse/osv/review error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Проверка: позиции одной группы ───────────────────────────────────────────
/**
 * Строки, по которым решение принято одной и той же причиной.
 *
 * Нужно потому, что решение принимает правило на класс вещей, а отвечать за
 * него будет карточка конкретной позиции: пока список не открыть, «правило
 * „стол“ → 47 строк карточками» — это утверждение, которое не на чем проверить.
 * Здесь же задаётся исключение по одной строке.
 */
router.get('/review/lines', authenticate, requireWarehouse(), requireReport('RPT-OSV'), async (req, res) => {
  try {
    const { importId, group } = req.query;
    if (!importId || !group) return res.status(400).json({ error: 'Нужны снимок и группа' });

    const snapshot = await WhOsvImport.findByPk(importId);
    if (!snapshot) return res.status(404).json({ error: 'Снимок не найден' });

    const { plan } = await planMaterialization(snapshot.id, snapshot.account);
    const own = plan.filter(item => decisionOf(item).key === group);

    res.json({
      group,
      lines: own.map(item => ({
        lineKey: item.line.lineKey,
        name: item.line.name,
        pathText: item.line.pathText,
        closingQty: Number(item.line.closingQty),
        closingSum: Number(item.line.closingSum),
        unitCost: item.line.unitCost === null ? null : Number(item.line.unitCost),
        kind: item.kind,
        scope: item.scope,
        placedQty: item.placedQty,
        unplacedQty: item.unplacedQty,
        // Переопределить можно только собственным правилом строки. Сопоставление
        // ветки сюда не годится: оно накрыло бы заодно соседние позиции, о
        // которых человек в этот момент не думает.
        mappingId: item.scope === 'line' ? item.mapping.id : null,
      })),
    });
  } catch (err) {
    console.error('GET warehouse/osv/review/lines error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Исключение по строке ─────────────────────────────────────────────────────
/**
 * Явное решение человека, которое сильнее словаря.
 *
 * Сопоставления по ветке (pathPrefix) эндпойнт по-прежнему принимает: они лежат
 * в базе с прошлых прогонов, ими созданы карточки, и отбирать у них способ
 * правки значило бы сделать старые данные нередактируемыми. Интерфейс их больше
 * не заводит — экран проверки задаёт исключения только по строке (ver. 7.14).
 */
router.put('/mapping', authenticate, requireWarehouse('canImportOsv'), async (req, res) => {
  try {
    const {
      account = 'МЦ.04', lineKey, pathPrefix, name,
      kind = 'auto', unit, roomId, storageId, categoryId, note,
    } = req.body;

    if (!lineKey && !pathPrefix) {
      return res.status(400).json({ error: 'Нужна строка или ветка ведомости' });
    }
    if (!['auto', 'material', 'asset', 'ignore'].includes(kind)) {
      return res.status(400).json({ error: 'Неизвестный тип сопоставления' });
    }

    const where = lineKey ? { account, lineKey } : { account, pathPrefix };
    const payload = {
      ...where,
      lineKey: lineKey || null,
      pathPrefix: pathPrefix || null,
      name: name || null,
      kind,
      unit: unit || null,
      roomId: roomId || null,
      storageId: storageId || null,
      categoryId: categoryId || null,
      note: note || null,
      mappedBy: req.user.id,
    };

    const existing = await WhOsvMapping.findOne({ where });
    if (existing) {
      await existing.update(payload);
      return res.json(existing);
    }
    res.status(201).json(await WhOsvMapping.create(payload));
  } catch (err) {
    console.error('PUT warehouse/osv/mapping error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/mapping/:id', authenticate, requireWarehouse('canImportOsv'), async (req, res) => {
  try {
    const row = await WhOsvMapping.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Сопоставление не найдено' });
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE warehouse/osv/mapping error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Создать объекты портала ──────────────────────────────────────────────────
router.post('/imports/:id/materialize', authenticate, requireWarehouse('canImportOsv'), async (req, res) => {
  try {
    const snapshot = await WhOsvImport.findByPk(req.params.id);
    if (!snapshot) return res.status(404).json({ error: 'Снимок не найден' });
    if (snapshot.status !== 'applied') {
      return res.status(400).json({ error: 'Сначала примите снимок — черновик разбирать нельзя' });
    }

    const report = await materializeOsv({
      importId: snapshot.id,
      account: snapshot.account,
      user: req.user,
      dryRun: req.body?.dryRun === true,
    });
    // Список заведённых карточек нужен только мобильной раскладке (там он
    // короткий и идёт сразу в печать этикеток). Общий прогон по всей ведомости
    // создаёт их тысячами, и в ответе вебу это лишние сотни килобайт.
    const { createdAssetIds, ...forWeb } = report;
    res.json(forWeb);
  } catch (err) {
    console.error('POST warehouse/osv/materialize error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Ошибки multer (не тот формат, превышен размер) без этого улетают в общий
// обработчик и возвращаются пятисоткой — человек видит «ошибка сервера» вместо
// «нужен файл .xlsx».
router.use((err, req, res, next) => {
  if (!err) return next();
  const tooBig = err.code === 'LIMIT_FILE_SIZE';
  res.status(400).json({ error: tooBig ? 'Файл больше 25 МБ' : err.message });
});

module.exports = router;
