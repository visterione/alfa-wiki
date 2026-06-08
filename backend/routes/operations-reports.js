const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx-js-style');
const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const { OperationsReportEntry } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const COLUMNS = [
  { aliases: ['Название', 'Наименование', 'Услуга'], field: 'serviceName' },
  { aliases: ['Кол-во пациентов', 'Количество пациентов', 'Пациентов'], field: 'patientCount' },
  { aliases: ['Кол-во услуг', 'Количество услуг', 'Услуг'], field: 'serviceCount' },
  { aliases: ['Сумма'], field: 'amount' },
  { aliases: ['Дата'], field: 'reportDate' }
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

function cleanNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s || s === '-') return null;

  const commaIdx = s.lastIndexOf(',');
  const dotIdx   = s.lastIndexOf('.');

  if (commaIdx !== -1 && dotIdx !== -1) {
    // Both separators: the rightmost one is decimal
    if (commaIdx > dotIdx) {
      s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
    } else {
      s = s.replace(/,/g, '');                    // 1,234.56
    }
  } else if (commaIdx !== -1) {
    // Only comma: thousand sep if exactly 3 digits follow, else decimal
    if (/,\d{3}$/.test(s)) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
  } else if (dotIdx !== -1) {
    // Only dot: thousand sep if all parts after splitting by dot have 3 digits (except maybe the first)
    const parts = s.split('.');
    const last  = parts[parts.length - 1];
    if (last.length === 3 && parts.slice(0, -1).every(p => /^\d+$/.test(p))) {
      s = s.replace(/\./g, ''); // 13.920 → 13920
    }
    // else decimal: 13.92 stays as-is
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function excelDateToIso(serial) {
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (!value && value !== 0) return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return '';
    return excelDateToIso(value);
  }
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (ru) {
    const year = ru[3].length === 2 ? `20${ru[3]}` : ru[3];
    let day = Number(ru[1]);
    let month = Number(ru[2]);
    // xlsx sometimes returns MM.DD.YYYY — detect by impossible month value
    if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  return '';
}

function isoToDMY(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

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

function parseImportWorkbook(workbook, userId) {
  const imported = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // raw: false — formatted display text, no Date objects or raw serial numbers
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (!rows.length) continue;

    // Find header row (first non-empty row that contains at least one column alias)
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
        if (col.field === 'reportDate') {
          // Store as-is (text); normalizeDate is used for entryDate DB column
          data[col.field] = cleanText(raw);
        } else if (col.field === 'patientCount' || col.field === 'serviceCount' || col.field === 'amount') {
          const n = cleanNumber(raw);
          data[col.field] = n !== null ? String(n) : cleanText(raw);
        } else {
          data[col.field] = cleanText(raw);
        }
      });

      if (!data.serviceName) continue;

      const entryDate = normalizeDate(data.reportDate) || null;
      if (entryDate) data.reportDate = isoToDMY(entryDate);

      imported.push({
        id: randomUUID(),
        entryDate,
        searchText: buildSearchText(data),
        data,
        createdBy: userId || null
      });
    }
  }

  return imported;
}

async function insertImportRows(rows) {
  const sequelize = OperationsReportEntry.sequelize;
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
        INSERT INTO operations_report_entries (id, "entryDate", "searchText", data, "createdBy", "createdAt", "updatedAt")
        SELECT *
        FROM (VALUES ${values}) AS v(id, "entryDate", "searchText", data, "createdBy", "createdAt", "updatedAt")
        WHERE NOT EXISTS (
          SELECT 1 FROM operations_report_entries e
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

    const result = await OperationsReportEntry.findAndCountAll({
      where,
      order: [['entryDate', 'DESC'], ['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({ rows: result.rows, total: result.count, page, limit });
  } catch (err) {
    console.error('GET /api/operations-reports error:', err);
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
    const rows = await OperationsReportEntry.findAll({
      where,
      order: [['entryDate', 'ASC'], ['createdAt', 'ASC']]
    });
    res.json(rows);
  } catch (err) {
    console.error('GET /api/operations-reports/export-data error:', err);
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
    console.log('[operations-import] Листы:', workbook.SheetNames);

    const parsed = parseImportWorkbook(workbook, req.user?.id || null);
    console.log('[operations-import] Распарсено строк:', parsed.length);

    const deduped = dedupeRows(parsed);
    if (deduped.duplicates > 0) console.log('[operations-import] Дублей внутри файла:', deduped.duplicates);

    if (!deduped.rows.length) {
      return res.status(400).json({ error: 'Не найдено строк для импорта. Проверьте заголовки столбцов.' });
    }

    const inserted = await insertImportRows(deduped.rows);
    console.log(`[operations-import] Вставлено=${inserted}, пропущено как дубли=${deduped.rows.length - inserted}`);

    res.json({
      success: true,
      total: inserted,
      parsed: parsed.length,
      skipped: parsed.length - inserted,
      duplicatesInFile: deduped.duplicates,
      sheetNames: workbook.SheetNames
    });
  } catch (err) {
    console.error('POST /api/operations-reports/import error:', err);
    res.status(500).json({ error: 'Ошибка импорта Excel' });
  }
});

// ── POST create ───────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const data = req.body.data || {};
    const reportDate = data.reportDate || '';
    const entryDate = normalizeDate(reportDate) || null;
    if (entryDate) data.reportDate = isoToDMY(entryDate);

    const row = await OperationsReportEntry.create({
      entryDate,
      searchText: buildSearchText(data),
      data,
      createdBy: req.user?.id || null
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/operations-reports error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── PUT update ────────────────────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const row = await OperationsReportEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });

    const data = req.body.data || {};
    const reportDate = data.reportDate || '';
    const entryDate = normalizeDate(reportDate) || null;
    if (entryDate) data.reportDate = isoToDMY(entryDate);

    await row.update({ entryDate, searchText: buildSearchText(data), data });
    res.json(row);
  } catch (err) {
    console.error('PUT /api/operations-reports/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── DELETE one ────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const row = await OperationsReportEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });
    await row.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/operations-reports/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── DELETE all ────────────────────────────────────────────────────────────────
router.delete('/', authenticate, async (req, res) => {
  try {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Нет доступа' });
    const deleted = await OperationsReportEntry.destroy({ where: {}, truncate: false });
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('DELETE /api/operations-reports error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
