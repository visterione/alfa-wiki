const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx-js-style');
const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const { GynecologyReportEntry } = require('../models');
const { authenticate } = require('../middleware/auth');
const { fullEntryChanges, editChanges, logReportHistory } = require('../utils/reportHistory');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Человекочитаемые названия полей записи — для описаний в журнале изменений страницы
const FIELD_LABELS = {
  stayPeriod:    'Период пребывания пациента',
  patientName:   'ФИО пациента',
  phone:         'Телефон',
  diagnosis:     'Диагноз',
  remarks:       'Замечания, особенности',
  referrals:     'Направления',
  doctorName:    'ФИО врача',
  examinations:  'Обследования',
  registrarMark: 'Регистратура отметка о записи'
};

function patientLabel(data) {
  const name = cleanText((data || {}).patientName);
  return name || 'без имени';
}

// Обёртка над общим журналлером — фиксирует source='gynecology'
function logGynecologyHistory(req, opts) {
  return logReportHistory(req, { source: 'gynecology', ...opts });
}

const COLUMNS = [
  { aliases: ['Период пребывания пациента', 'Период пребывания', 'Период'], field: 'stayPeriod' },
  { aliases: ['ФИО пациента', 'Пациент'], field: 'patientName' },
  { aliases: ['Телефон', 'Номер телефона', 'Тел'], field: 'phone' },
  { aliases: ['Диагноз'], field: 'diagnosis' },
  { aliases: ['Замечания, особенности', 'Замечания', 'Особенности'], field: 'remarks' },
  { aliases: ['Направления', 'Направление'], field: 'referrals' },
  { aliases: ['ФИО врача', 'Врач'], field: 'doctorName' },
  { aliases: ['Обследования', 'Обследование'], field: 'examinations' },
  { aliases: ['Регистратура отметка о записи', 'Регистратура', 'Отметка о записи'], field: 'registrarMark' }
];

function normalizeLookup(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
}

function isEmptyRow(row) {
  return !row || row.every(v => v === null || v === undefined || String(v).trim() === '');
}

function resolveColumnIndex(headerRow, aliases) {
  const normalized = aliases.map(normalizeLookup);
  const keys = headerRow.map(h => normalizeLookup(h));
  for (const a of normalized) {
    const idx = keys.findIndex(k => k === a);
    if (idx !== -1) return idx;
  }
  for (const a of normalized) {
    const idx = keys.findIndex(k => k.includes(a) || a.includes(k));
    if (idx !== -1) return idx;
  }
  return -1;
}

function cleanText(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function buildSearchText(data) {
  return Object.entries(data || {})
    .filter(([k, v]) => !k.startsWith('_') && v !== null && v !== undefined)
    .map(([, v]) => v)
    .join(' ')
    .trim();
}

function duplicateKey(row) {
  const stable = Object.keys(row.data || {}).sort().reduce((acc, k) => {
    acc[k] = row.data[k] === null || row.data[k] === undefined ? '' : String(row.data[k]).trim();
    return acc;
  }, {});
  return JSON.stringify({ entryDate: row.entryDate, data: stable });
}

function dedupeRows(rows) {
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  rows.forEach(row => {
    const key = duplicateKey(row);
    if (seen.has(key)) { duplicates++; return; }
    seen.add(key);
    unique.push(row);
  });
  return { rows: unique, duplicates };
}

const TARGET_SHEET = 'Гинекология';

function parseImportWorkbook(workbook, userId) {
  const imported = [];

  // Берём данные только с листа «Гинекология», остальные листы документа игнорируем
  const target = normalizeLookup(TARGET_SHEET);
  const sheetNames = workbook.SheetNames.filter(name => normalizeLookup(name) === target);

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (!rows.length) continue;

    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const colAliases = COLUMNS.flatMap(c => c.aliases).map(normalizeLookup);
      if ((rows[i] || []).some(v => {
        const k = normalizeLookup(v);
        return k && colAliases.some(a => k.includes(a) || a.includes(k));
      })) {
        headerRowIdx = i;
        break;
      }
    }

    const headerRow = rows[headerRowIdx] || [];
    const colIndexes = COLUMNS.map(col => resolveColumnIndex(headerRow, col.aliases));

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (isEmptyRow(row)) continue;

      const data = {};
      COLUMNS.forEach((col, ci) => {
        const idx = colIndexes[ci];
        const raw = idx !== -1 ? row[idx] : '';
        data[col.field] = cleanText(raw);
      });

      if (!data.patientName && !data.diagnosis) continue;

      imported.push({
        id: randomUUID(),
        entryDate: null,
        searchText: buildSearchText(data),
        data,
        createdBy: userId || null
      });
    }
  }

  return imported;
}

async function insertImportRows(rows) {
  const sequelize = GynecologyReportEntry.sequelize;
  const batchSize = 500;
  let inserted = 0;

  await sequelize.transaction(async transaction => {
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const replacements = {};
      const values = batch.map((row, index) => {
        const orderIndex = i + index;
        replacements[`id${index}`] = row.id || randomUUID();
        replacements[`entryDate${index}`] = row.entryDate || null;
        replacements[`searchText${index}`] = row.searchText || '';
        replacements[`data${index}`] = JSON.stringify(row.data || {});
        replacements[`createdBy${index}`] = row.createdBy || null;
        replacements[`orderIndex${index}`] = orderIndex;
        return `(
          CAST(:id${index} AS uuid),
          CAST(:entryDate${index} AS date),
          CAST(:searchText${index} AS text),
          CAST(:data${index} AS jsonb),
          CAST(:createdBy${index} AS uuid),
          NOW() + (:orderIndex${index} * INTERVAL '1 millisecond'),
          NOW() + (:orderIndex${index} * INTERVAL '1 millisecond')
        )`;
      }).join(',');

      const [insertedRows] = await sequelize.query(`
        INSERT INTO gynecology_report_entries (id, "entryDate", "searchText", data, "createdBy", "createdAt", "updatedAt")
        SELECT *
        FROM (VALUES ${values}) AS v(id, "entryDate", "searchText", data, "createdBy", "createdAt", "updatedAt")
        WHERE NOT EXISTS (
          SELECT 1 FROM gynecology_report_entries e
          WHERE COALESCE(e."entryDate"::text, '') = COALESCE(CAST(v."entryDate" AS date)::text, '')
            AND (e.data - '_source') = (v.data - '_source')
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `, { replacements, transaction });
      inserted += insertedRows.length;
    }
  });

  return inserted;
}

// ── GET list ──────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo, search } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = (page - 1) * limit;
    const where = {};

    if (dateFrom || dateTo) {
      where.entryDate = {};
      if (dateFrom) where.entryDate[Op.gte] = dateFrom;
      if (dateTo) where.entryDate[Op.lte] = dateTo;
    }
    if (search && search.trim()) {
      where.searchText = { [Op.iLike]: `%${search.trim()}%` };
    }

    const result = await GynecologyReportEntry.findAndCountAll({
      where,
      order: [['entryDate', 'DESC'], ['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({ rows: result.rows, total: result.count, page, limit });
  } catch (err) {
    console.error('GET /api/gynecology-reports error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET export-data ───────────────────────────────────────────────────────────
router.get('/export-data', authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const where = {};
    if (dateFrom || dateTo) {
      where.entryDate = {};
      if (dateFrom) where.entryDate[Op.gte] = dateFrom;
      if (dateTo) where.entryDate[Op.lte] = dateTo;
    }
    const rows = await GynecologyReportEntry.findAll({
      where,
      order: [['entryDate', 'ASC'], ['createdAt', 'ASC']]
    });
    await logGynecologyHistory(req, {
      event: 'export',
      summary: `Экспорт в Excel: выгружено записей — ${rows.length}`
    });
    res.json(rows);
  } catch (err) {
    console.error('GET /api/gynecology-reports/export-data error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET whoami ────────────────────────────────────────────────────────────────
router.get('/whoami', authenticate, (req, res) => {
  res.json({ isAdmin: !!req.user.isAdmin });
});

// ── POST import ───────────────────────────────────────────────────────────────
router.post('/import', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    console.log('[gynecology-import] Листы:', workbook.SheetNames);

    const hasTargetSheet = workbook.SheetNames.some(name => normalizeLookup(name) === normalizeLookup(TARGET_SHEET));
    if (!hasTargetSheet) {
      return res.status(400).json({ error: `В файле не найден лист «${TARGET_SHEET}». Листы: ${workbook.SheetNames.join(', ')}` });
    }

    const parsed = parseImportWorkbook(workbook, req.user?.id || null);
    console.log('[gynecology-import] Распарсено строк:', parsed.length);

    const deduped = dedupeRows(parsed);
    if (deduped.duplicates > 0) console.log('[gynecology-import] Дублей внутри файла:', deduped.duplicates);

    if (!deduped.rows.length) {
      return res.status(400).json({ error: 'Не найдено строк для импорта. Проверьте заголовки столбцов.' });
    }

    const inserted = await insertImportRows(deduped.rows);
    console.log(`[gynecology-import] Вставлено=${inserted}, пропущено как дубли=${deduped.rows.length - inserted}`);

    await logGynecologyHistory(req, {
      event: 'import',
      summary: `Импорт из Excel: добавлено ${inserted}, пропущено ${parsed.length - inserted} (обработано строк: ${parsed.length})`
    });

    res.json({
      success: true,
      total: inserted,
      parsed: parsed.length,
      skipped: parsed.length - inserted,
      duplicatesInFile: deduped.duplicates,
      sheetNames: workbook.SheetNames
    });
  } catch (err) {
    console.error('POST /api/gynecology-reports/import error:', err);
    res.status(500).json({ error: 'Ошибка импорта Excel' });
  }
});

// ── POST create ───────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const data = req.body.data || {};

    const row = await GynecologyReportEntry.create({
      entryDate: null,
      searchText: buildSearchText(data),
      data,
      createdBy: req.user?.id || null
    });
    await logGynecologyHistory(req, {
      event: 'create',
      summary: `Добавлена запись: ${patientLabel(data)}`,
      changes: fullEntryChanges(data, 'to', FIELD_LABELS)
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/gynecology-reports error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── PUT update ────────────────────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const row = await GynecologyReportEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });

    const data = req.body.data || {};
    const oldData = row.data || {};

    await row.update({ searchText: buildSearchText(data), data });
    await logGynecologyHistory(req, {
      event: 'update',
      summary: `Изменена запись: ${patientLabel(data)}`,
      changes: editChanges(oldData, data, FIELD_LABELS)
    });
    res.json(row);
  } catch (err) {
    console.error('PUT /api/gynecology-reports/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── DELETE one ────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const row = await GynecologyReportEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });
    const removedData = row.data || {};
    await row.destroy();
    await logGynecologyHistory(req, {
      event: 'delete',
      summary: `Удалена запись: ${patientLabel(removedData)}`,
      changes: fullEntryChanges(removedData, 'from', FIELD_LABELS)
    });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/gynecology-reports/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── DELETE all ────────────────────────────────────────────────────────────────
router.delete('/', authenticate, async (req, res) => {
  try {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Нет доступа' });
    const deleted = await GynecologyReportEntry.destroy({ where: {}, truncate: false });
    await logGynecologyHistory(req, {
      event: 'clear',
      summary: `Удалены все данные (записей: ${deleted})`
    });
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('DELETE /api/gynecology-reports error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
