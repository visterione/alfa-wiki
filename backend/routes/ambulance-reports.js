const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx-js-style');
const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const { AmbulanceReportEntry } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const ENTRY_TYPES = ['calls', 'refusals', 'caddy', 'patientCalls'];
const NUMBERED_TYPES = ['calls', 'refusals'];
const DATE_FIELDS = {
  calls: 'callDate',
  refusals: 'refusalDate',
  caddy: 'caddyDate',
  patientCalls: 'patientCallDate'
};
const TIME_FIELDS = {
  calls: 'callTime',
  refusals: 'callTime',
  caddy: 'caddyTime',
  patientCalls: ''
};
const DATE_DATA_FIELDS = {
  calls: ['callDate'],
  refusals: ['refusalDate'],
  caddy: ['caddyDate'],
  patientCalls: ['patientCallDate', 'callDate']
};

function normalizeEntry(entryType, body, userId) {
  const rawData = body.data && typeof body.data === 'object' ? body.data : body;
  const dateField = DATE_FIELDS[entryType];
  const timeField = TIME_FIELDS[entryType];

  // entryDate (DB date column) — читаем из сырых данных до нормализации, чтобы сохранить ISO
  const rawEntryDate = rawData[dateField] || rawData.callDate || body.entryDate || null;

  // Нормализуем дата-поля в data к формату ДД.ММ.ГГГГ для отображения
  const data = { ...rawData };
  for (const field of DATE_DATA_FIELDS[entryType] || []) {
    const val = data[field];
    if (val) {
      const iso = normalizeDate(String(val).trim());
      if (iso) data[field] = isoToDMY(iso);
    }
  }

  const searchText = Object.entries(data)
    .filter(([k, v]) => !k.startsWith('_') && v !== null && v !== undefined)
    .map(([, v]) => v)
    .join(' ')
    .trim();

  return {
    entryType,
    seqNumber: NUMBERED_TYPES.includes(entryType) && body.seqNumber
      ? Number(body.seqNumber)
      : null,
    entryDate: rawEntryDate ? (normalizeDate(String(rawEntryDate).trim()) || null) : null,
    entryTime: timeField ? (rawData[timeField] || body.entryTime || null) : null,
    patientName: data.patientName || data.patient || body.patientName || null,
    sourceCallId: entryType === 'patientCalls' && rawData.sourceCallId ? rawData.sourceCallId : null,
    searchText,
    data,
    createdBy: userId || null
  };
}

async function getNextNumber(entryType, excludeId) {
  if (!NUMBERED_TYPES.includes(entryType)) return 1;
  const where = { entryType, seqNumber: { [Op.not]: null } };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const last = await AmbulanceReportEntry.findOne({ where, order: [['createdAt', 'DESC']] });
  return last ? (Number(last.seqNumber) || 0) + 1 : 1;
}

function isEmptyRow(row) {
  return !row || row.every(value => value === null || value === undefined || String(value).trim() === '');
}

function excelDateToJSDate(serial) {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

function dateToIso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function isoToDMY(iso) {
  if (!isValidIsoDate(iso)) return '';
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function isValidIsoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return dateToIso(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return '';
    return dateToIso(excelDateToJSDate(value));
  }

  const text = String(value).trim();
  if (!text || /^invalid date$/i.test(text) || /^nan$/i.test(text)) return '';
  if (/^\d{4,6}$/.test(text)) {
    return normalizeDate(Number(text));
  }
  if (/^\d{1,2}\s*-\s*\d{1,2}[./-]\d{1,2}/.test(text)) return '';
  if (/^\d{1,2}[./-]\d{1,2}\s*-\s*\d{1,2}[./-]\d{1,2}/.test(text)) return '';
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return isValidIsoDate(date) ? date : '';
  }
  const ru = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (ru) {
    const year = ru[3].length === 2 ? `20${ru[3]}` : ru[3];
    const date = `${year}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
    return isValidIsoDate(date) ? date : '';
  }
  return '';
}

function isDatePlaceholder(value) {
  return /^[-–—]+$/.test(cleanText(value));
}

function normalizeTime(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    if (value < 0 || value >= 1) return String(value);
    const totalMinutes = Math.round((value % 1) * 24 * 60);
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
  }
  const text = String(value).trim();
  if (/^\d{4,6}$/.test(text)) return text;
  const match = text.match(/(\d{1,2})[:.-](\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : text;
}

function cleanText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/\s/g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function hasAnyText(values) {
  return values.some(value => cleanText(value) !== '');
}

function normalizeLookup(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/g, '');
}

function getSheets(workbook, names, excludedNames) {
  const keys = names.map(normalizeLookup).filter(Boolean);
  const excluded = (excludedNames || []).map(normalizeLookup).filter(Boolean);
  const matched = workbook.SheetNames
    .filter(name => {
      const key = normalizeLookup(name);
      if (excluded.some(ex => key.includes(ex))) return false;
      return keys.some(k => key === k || key.includes(k));
    })
    .map(name => workbook.Sheets[name]);
  return matched;
}

// Returns an array of row-arrays, one per matching sheet, so each sheet
// can be parsed with its own header row.
function sheetRowsList(workbook, names, excludedNames) {
  const sheets = getSheets(workbook, names, excludedNames);
  return sheets.map(sheet => XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }));
}

function looksLikeHeaderRow(row, aliases) {
  const keys = (aliases || []).map(normalizeLookup).filter(Boolean);
  return (row || []).some(value => {
    const key = normalizeLookup(value);
    return key && keys.some(alias => key.includes(alias) || alias.includes(key));
  });
}

function dataRows(rows, aliases) {
  const start = looksLikeHeaderRow(rows[0], aliases) ? 1 : 0;
  return rows.slice(start).filter(row => !isEmptyRow(row));
}

function headerIndex(rows) {
  const headers = rows[0] || [];
  return headers.reduce((acc, header, index) => {
    const key = normalizeLookup(header);
    if (key && acc[key] === undefined) acc[key] = index;
    return acc;
  }, {});
}

function cell(row, index, aliases, fallbackIndex) {
  const normalizedAliases = aliases.map(normalizeLookup).filter(Boolean);
  const foundAlias = normalizedAliases.find(alias => index[alias] !== undefined);
  if (foundAlias) return row[index[foundAlias]];
  const fuzzyHeader = Object.keys(index).find(header => normalizedAliases.some(alias => header.includes(alias) || alias.includes(header)));
  if (fuzzyHeader) return row[index[fuzzyHeader]];
  return row[fallbackIndex];
}

function importDateValue(value) {
  if (isDatePlaceholder(value)) return cleanText(value);
  // Only normalize Excel-native date types (serial numbers, Date objects).
  // Text cells are stored verbatim — free-form dates entered by hand are unpredictable.
  if (value instanceof Date || typeof value === 'number') {
    return normalizeDate(value) || '';
  }
  return cleanText(value);
}

function toPayload(entryType, seqNumber, data, userId) {
  const normalized = normalizeEntry(entryType, { entryType, seqNumber, data }, userId);
  normalized.entryDate = sanitizeDateOnly(normalized.entryDate);
  return normalized;
}

function sanitizeDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return dateToIso(value) || null;
  const text = String(value).trim();
  if (isDatePlaceholder(text)) return null;
  return isValidIsoDate(text) ? text : null;
}

function sanitizeImportPayload(row) {
  if (!row.id) row.id = randomUUID();
  row.entryDate = sanitizeDateOnly(row.entryDate);
  row.entryTime = row.entryTime ? String(row.entryTime).trim() : null;
  if (row.entryTime && !/^\d{1,2}:\d{2}$/.test(row.entryTime)) row.entryTime = null;
  row.seqNumber = row.seqNumber === null || row.seqNumber === undefined || row.seqNumber === ''
    ? null
    : Number(row.seqNumber);
  if (!Number.isFinite(row.seqNumber)) row.seqNumber = null;
  row.patientName = row.patientName ? String(row.patientName).trim() : null;
  row.sourceCallId = row.sourceCallId || null;
  row.searchText = row.searchText ? String(row.searchText) : '';
  row.createdBy = row.createdBy || null;
  if (row.data && typeof row.data === 'object') {
    Object.keys(row.data).forEach(key => {
      if (row.data[key] instanceof Date) row.data[key] = dateToIso(row.data[key]) || cleanText(row.data[key]);
    });
  }
  return row;
}

function stableDataForDuplicate(data) {
  return Object.keys(data || {})
    .filter(key => key !== 'sourceCallId' && key !== '_source')
    .sort()
    .reduce((acc, key) => {
      acc[key] = data[key] === null || data[key] === undefined ? '' : String(data[key]).trim();
      return acc;
    }, {});
}

function duplicateKey(row) {
  return JSON.stringify({
    entryType: row.entryType,
    seqNumber: row.seqNumber || null,
    data: stableDataForDuplicate(row.data)
  });
}

function dedupeImportRows(rows) {
  const seen = new Set();
  const unique = [];
  let duplicates = 0;
  rows.forEach(row => {
    const key = duplicateKey(row);
    if (seen.has(key)) {
      duplicates++;
      return;
    }
    seen.add(key);
    unique.push(row);
  });
  return { rows: unique, duplicates };
}

async function insertImportRows(rows) {
  const sequelize = AmbulanceReportEntry.sequelize;
  const batchSize = 500;
  let inserted = 0;

  await sequelize.transaction(async transaction => {
    for (let i = 0; i < rows.length; i += batchSize) {
      const replacements = {};
      const values = rows.slice(i, i + batchSize).map((sourceRow, index) => {
        const row = sanitizeImportPayload(sourceRow);
        const orderIndex = i + index;
        replacements[`id${index}`] = row.id;
        replacements[`entryType${index}`] = row.entryType;
        replacements[`seqNumber${index}`] = row.seqNumber;
        replacements[`entryDate${index}`] = row.entryDate;
        replacements[`entryTime${index}`] = row.entryTime;
        replacements[`patientName${index}`] = row.patientName;
        replacements[`sourceCallId${index}`] = row.sourceCallId;
        replacements[`searchText${index}`] = row.searchText;
        replacements[`data${index}`] = JSON.stringify(row.data || {});
        replacements[`createdBy${index}`] = row.createdBy;
        replacements[`orderIndex${index}`] = orderIndex;

        return `(
          CAST(:id${index} AS uuid),
          CAST(:entryType${index} AS ambulance_report_entry_type),
          CAST(:seqNumber${index} AS integer),
          CAST(:entryDate${index} AS date),
          CAST(:entryTime${index} AS varchar(5)),
          CAST(:patientName${index} AS varchar(255)),
          CAST(:sourceCallId${index} AS uuid),
          CAST(:searchText${index} AS text),
          CAST(:data${index} AS jsonb),
          CAST(:createdBy${index} AS uuid),
          NOW() + (:orderIndex${index} * INTERVAL '1 millisecond'),
          NOW() + (:orderIndex${index} * INTERVAL '1 millisecond')
        )`;
      }).join(',');

      const [insertedRows] = await sequelize.query(`
        INSERT INTO ambulance_report_entries (
          id,
          "entryType",
          "seqNumber",
          "entryDate",
          "entryTime",
          "patientName",
          "sourceCallId",
          "searchText",
          data,
          "createdBy",
          "createdAt",
          "updatedAt"
        )
        SELECT *
        FROM (VALUES ${values}) AS v(
          id,
          "entryType",
          "seqNumber",
          "entryDate",
          "entryTime",
          "patientName",
          "sourceCallId",
          "searchText",
          data,
          "createdBy",
          "createdAt",
          "updatedAt"
        )
        WHERE NOT EXISTS (
          SELECT 1
          FROM ambulance_report_entries existing
          WHERE existing."entryType" = v."entryType"
            AND COALESCE(existing."seqNumber", -2147483648) = COALESCE(CAST(v."seqNumber" AS integer), -2147483648)
            AND (existing.data - 'sourceCallId' - '_source') = (v.data - 'sourceCallId' - '_source')
        )
        ON CONFLICT DO NOTHING
        RETURNING id, "entryType"
      `, { replacements, transaction });
      inserted += insertedRows.length;
    }
  });

  return inserted;
}

function patientKey(date, patientName) {
  if (!date || !patientName) return '';
  return `${date}|${String(patientName).trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

const IMPORT_COLUMNS = {
  calls: [
    { aliases: ['№', 'Номер'], field: 'seqNumber', isSeq: true },
    { aliases: ['Дата', 'Дата вызова'], field: 'callDate' },
    { aliases: ['Время вызова', 'Время'], field: 'callTime' },
    { aliases: ['ФИО пациента', 'Пациент'], field: 'patientName' },
    { aliases: ['Адрес'], field: 'address' },
    { aliases: ['№ бригады', 'Номер бригады'], field: 'brigadeNumber' },
    { aliases: ['Сумма'], field: 'amount' },
    { aliases: ['Время ожидания'], field: 'waitingTime' },
    { aliases: ['Комментарий'], field: 'comment' }
  ],
  refusals: [
    { aliases: ['№', 'Номер'], field: 'seqNumber', isSeq: true },
    { aliases: ['Дата'], field: 'refusalDate' },
    { aliases: ['Время звонка', 'Время'], field: 'callTime' },
    { aliases: ['Причина отказа'], field: 'reason' },
    { aliases: ['Время через которое отказались'], field: 'refusalDelay' },
    { aliases: ['Местные/приезжие', 'Местные приезжие'], field: 'localVisitor' }
  ],
  caddy: [
    { aliases: ['Дата'], field: 'caddyDate' },
    { aliases: ['Время вызова', 'Время'], field: 'caddyTime' },
    { aliases: ['Номер машины'], field: 'carNumber' },
    { aliases: ['Причина вызова'], field: 'reason' },
    { aliases: ['Наименование МЦ', 'Медцентр', 'МЦ'], field: 'medCenter' }
  ],
  patientCalls: [
    { aliases: ['Комментарий'], field: 'comment' },
    { aliases: ['Дата'], field: 'patientCallDate' },
    { aliases: ['Дата вызова'], field: 'callDate' },
    { aliases: ['Пациент', 'ФИО пациента'], field: 'patientName' },
    { aliases: ['Диагноз'], field: 'diagnosis' },
    { aliases: ['Направления', 'Направление'], field: 'direction' },
    { aliases: ['Фио врача', 'ФИО врача'], field: 'doctorName' },
    { aliases: ['Обследования', 'Обследование'], field: 'examination' },
    { aliases: ['Номер телефона пациента', 'Номер телефона', 'Телефон'], field: 'phone' },
    { aliases: ['Регистратура отметка о записи'], field: 'registrarMark' }
  ]
};

function resolveColumnIndex(headerRow, aliases) {
  const normalizedAliases = aliases.map(normalizeLookup);
  const headerKeys = headerRow.map(h => normalizeLookup(h));
  // exact match first, then fuzzy
  for (const alias of normalizedAliases) {
    const idx = headerKeys.findIndex(k => k === alias);
    if (idx !== -1) return idx;
  }
  for (const alias of normalizedAliases) {
    const idx = headerKeys.findIndex(k => k.includes(alias) || alias.includes(k));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseImportWorkbook(workbook, userId) {
  const imported = [];
  const counts = { calls: 0, refusals: 0, caddy: 0, patientCalls: 0 };

  const sheetMappings = [
    { names: ['Вызов', 'Вызовы', 'Звонки'], excludedNames: ['пациент'], type: 'calls' },
    { names: ['Отказ', 'Отказы'], excludedNames: [], type: 'refusals' },
    { names: ['Caddy'], excludedNames: [], type: 'caddy' },
    { names: ['Звонки пациентам'], excludedNames: [], type: 'patientCalls' }
  ];

  for (const { names, excludedNames, type } of sheetMappings) {
    const sheets = getSheets(workbook, names, excludedNames);
    const columns = IMPORT_COLUMNS[type];

    for (const sheet of sheets) {
      // raw: false — everything as formatted display text, no Date objects or raw numbers
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
      if (!rows.length) continue;

      const headerRow = rows[0] || [];
      // Resolve which column index each field maps to
      const colIndexes = columns.map(col => resolveColumnIndex(headerRow, col.aliases));

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (isEmptyRow(row)) continue;

        const data = {};
        let seqNumber = null;
        columns.forEach((col, ci) => {
          const idx = colIndexes[ci];
          const raw = idx !== -1 ? row[idx] : undefined;
          const val = raw !== null && raw !== undefined ? String(raw).trim() : '';
          if (col.isSeq) {
            const n = Number(val);
            seqNumber = Number.isFinite(n) && n > 0 ? n : null;
          } else {
            data[col.field] = val;
          }
        });

        const searchText = Object.entries(data)
          .filter(([k, v]) => !k.startsWith('_') && v !== '')
          .map(([, v]) => v)
          .join(' ');

        data._source = 'import';
        imported.push({
          id: randomUUID(),
          entryType: type,
          seqNumber,
          entryDate: null,
          entryTime: null,
          patientName: data.patientName || null,
          sourceCallId: null,
          searchText,
          data,
          createdBy: userId || null
        });
        counts[type]++;
      }
    }
  }

  return { imported, counts };
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { type, dateFrom, dateTo, search } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = (page - 1) * limit;
    const where = {};

    if (type && ENTRY_TYPES.includes(type)) where.entryType = type;
    if (dateFrom || dateTo) {
      where.entryDate = {};
      if (dateFrom) where.entryDate[Op.gte] = dateFrom;
      if (dateTo) where.entryDate[Op.lte] = dateTo;
    }
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      where[Op.or] = [
        { patientName: { [Op.iLike]: q } },
        { searchText: { [Op.iLike]: q } }
      ];
    }

    const result = await AmbulanceReportEntry.findAndCountAll({
      where,
      order: [
        ['createdAt', 'DESC']
      ],
      limit,
      offset
    });

    res.json({
      rows: result.rows,
      total: result.count,
      page,
      limit
    });
  } catch (err) {
    console.error('GET /api/ambulance-reports error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/stats', authenticate, async (_req, res) => {
  try {
    const grouped = await AmbulanceReportEntry.count({
      attributes: ['entryType'],
      group: ['entryType']
    });
    const stats = ENTRY_TYPES.reduce((acc, type) => {
      acc[type] = 0;
      return acc;
    }, {});
    grouped.forEach(row => {
      stats[row.entryType] = Number(row.count) || 0;
    });
    res.json(stats);
  } catch (err) {
    console.error('GET /api/ambulance-reports/stats error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/export-data', authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const where = {};
    if (dateFrom || dateTo) {
      where.entryDate = {};
      if (dateFrom) where.entryDate[Op.gte] = dateFrom;
      if (dateTo) where.entryDate[Op.lte] = dateTo;
    }

    const rows = await AmbulanceReportEntry.findAll({
      where,
      order: [
        ['entryType', 'ASC'],
        ['createdAt', 'ASC']
      ]
    });
    res.json(rows);
  } catch (err) {
    console.error('GET /api/ambulance-reports/export-data error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/whoami', authenticate, (req, res) => {
  res.json({ isAdmin: !!req.user.isAdmin });
});

router.get('/available-calls', authenticate, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const rows = await AmbulanceReportEntry.sequelize.query(`
      SELECT c.*
      FROM ambulance_report_entries c
      WHERE c."entryType" = 'calls'
        AND (c.data->>'_source' IS NULL OR c.data->>'_source' != 'import')
        AND NOT EXISTS (
          SELECT 1
          FROM ambulance_report_entries pc
          WHERE pc."entryType" = 'patientCalls'
            AND pc."sourceCallId" = c.id
        )
      ORDER BY c."createdAt" DESC
      LIMIT :limit
    `, {
      replacements: { limit },
      model: AmbulanceReportEntry,
      mapToModel: true
    });
    res.json(rows);
  } catch (err) {
    console.error('GET /api/ambulance-reports/available-calls error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/next-number', authenticate, async (req, res) => {
  try {
    const { type, excludeId } = req.query;
    if (!ENTRY_TYPES.includes(type)) return res.status(400).json({ error: 'Неверный тип вкладки' });
    const nextNumber = await getNextNumber(type, excludeId);
    res.json({ nextNumber });
  } catch (err) {
    console.error('GET /api/ambulance-reports/next-number error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/import', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;
    console.log('[Import] Листы файла:', sheetNames);

    const parsed = parseImportWorkbook(workbook, req.user?.id || null);
    console.log('[Import] Распарсено строк:', parsed.imported.length, 'по типам:', parsed.counts);
    parsed.imported.forEach((row, i) => {
      const d = row.data || {};
      const dateKey = Object.keys(d).find(k => k.toLowerCase().includes('date'));
      console.log(`[Import] #${i + 1} type=${row.entryType} seq=${row.seqNumber} date=${dateKey ? d[dateKey] : '?'} patient=${row.patientName}`);
    });

    const deduped = dedupeImportRows(parsed.imported.map(sanitizeImportPayload));
    if (deduped.duplicates > 0) console.log('[Import] Дублей внутри файла:', deduped.duplicates);
    const imported = deduped.rows;
    const counts = parsed.counts;

    if (!imported.length) {
      return res.status(400).json({ error: 'Не найдено строк для импорта', sheetNames });
    }

    const byType = ENTRY_TYPES.reduce((acc, type) => {
      const typeRows = imported.filter(row => row.entryType === type);
      acc[type] = {
        parsed: counts[type] || 0,
        unique: typeRows.length,
        inserted: 0,
        skipped: 0
      };
      return acc;
    }, {});

    let inserted = 0;
    for (const type of ENTRY_TYPES) {
      const typeRows = imported.filter(row => row.entryType === type);
      if (!typeRows.length) continue;
      const typeInserted = await insertImportRows(typeRows);
      byType[type].inserted = typeInserted;
      byType[type].skipped = Math.max(typeRows.length - typeInserted, 0);
      console.log(`[Import] ${type}: уникальных=${typeRows.length}, вставлено=${typeInserted}, пропущено как дубли БД=${typeRows.length - typeInserted}`);
      inserted += typeInserted;
    }

    res.json({
      success: true,
      total: inserted,
      parsed: parsed.imported.length,
      unique: imported.length,
      skipped: parsed.imported.length - inserted,
      duplicatesInFile: deduped.duplicates,
      counts,
      byType,
      sheetNames
    });
  } catch (err) {
    console.error('POST /api/ambulance-reports/import error:', err);
    res.status(500).json({ error: 'Ошибка импорта Excel' });
  }
});

router.delete('/', authenticate, async (_req, res) => {
  try {
    const deleted = await AmbulanceReportEntry.destroy({ where: {}, truncate: false });
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('DELETE /api/ambulance-reports error:', err);
    res.status(500).json({ error: 'Ошибка очистки данных' });
  }
});

router.post('/normalize-dates', authenticate, async (req, res) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Нет доступа' });
  const dryRun = req.query.dryRun === 'true';

  try {
    const allRows = await AmbulanceReportEntry.findAll();
    let updated = 0;
    let fieldsChanged = 0;
    let fieldsParseFailed = 0;
    let fieldsUnchanged = 0;
    const samples = [];

    for (const row of allRows) {
      const dateFields = DATE_DATA_FIELDS[row.entryType] || [];
      const data = { ...(row.data || {}) };
      let rowChanged = false;

      for (const field of dateFields) {
        const current = data[field];
        if (current === null || current === undefined) continue;
        const currentStr = String(current).trim();
        if (!currentStr) continue;

        const iso = normalizeDate(currentStr);
        if (!iso) {
          fieldsParseFailed++;
          continue;
        }

        const dmy = isoToDMY(iso);
        if (!dmy || dmy === currentStr) {
          fieldsUnchanged++;
          continue;
        }

        if (samples.length < 30) {
          samples.push({ id: row.id, type: row.entryType, field, from: currentStr, to: dmy });
        }
        data[field] = dmy;
        rowChanged = true;
        fieldsChanged++;
      }

      if (rowChanged) {
        updated++;
        if (!dryRun) {
          const searchText = Object.entries(data)
            .filter(([k, v]) => !k.startsWith('_') && v !== null && v !== undefined)
            .map(([, v]) => v)
            .join(' ')
            .trim();
          await row.update({ data, searchText });
        }
      }
    }

    res.json({ success: true, dryRun, updated, fieldsChanged, fieldsUnchanged, fieldsParseFailed, samples });
  } catch (err) {
    console.error('POST /api/ambulance-reports/normalize-dates error:', err);
    res.status(500).json({ error: 'Ошибка нормализации дат' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const entryType = req.body.entryType;
    if (!ENTRY_TYPES.includes(entryType)) return res.status(400).json({ error: 'Неверный тип вкладки' });

    const payload = normalizeEntry(entryType, req.body, req.user?.id);
    if (NUMBERED_TYPES.includes(entryType) && !payload.seqNumber) {
      payload.seqNumber = await getNextNumber(entryType);
    }

    const row = await AmbulanceReportEntry.create(payload);
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/ambulance-reports error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    const row = await AmbulanceReportEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });

    const entryType = req.body.entryType || row.entryType;
    if (!ENTRY_TYPES.includes(entryType)) return res.status(400).json({ error: 'Неверный тип вкладки' });

    const payload = normalizeEntry(entryType, req.body, row.createdBy);
    if (NUMBERED_TYPES.includes(entryType) && !payload.seqNumber) {
      payload.seqNumber = await getNextNumber(entryType, row.id);
    }

    await row.update(payload);
    res.json(row);
  } catch (err) {
    console.error('PUT /api/ambulance-reports/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const row = await AmbulanceReportEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });
    await row.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/ambulance-reports/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
