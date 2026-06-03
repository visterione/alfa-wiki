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

function normalizeEntry(entryType, body, userId) {
  const data = body.data && typeof body.data === 'object' ? body.data : body;
  const dateField = DATE_FIELDS[entryType];
  const timeField = TIME_FIELDS[entryType];
  const searchText = Object.values(data)
    .filter(v => v !== null && v !== undefined)
    .join(' ')
    .trim();

  return {
    entryType,
    seqNumber: NUMBERED_TYPES.includes(entryType) && body.seqNumber
      ? Number(body.seqNumber)
      : null,
    entryDate: data[dateField] || data.callDate || body.entryDate || null,
    entryTime: timeField ? (data[timeField] || body.entryTime || null) : null,
    patientName: data.patientName || data.patient || body.patientName || null,
    sourceCallId: entryType === 'patientCalls' && data.sourceCallId ? data.sourceCallId : null,
    searchText,
    data,
    createdBy: userId || null
  };
}

async function getNextNumber(entryType, entryDate, excludeId) {
  if (!NUMBERED_TYPES.includes(entryType) || !entryDate) return null;
  const where = { entryType, entryDate };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const max = await AmbulanceReportEntry.max('seqNumber', { where });
  return (Number(max) || 0) + 1;
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

function getSheet(workbook, names, excludedNames) {
  const keys = names.map(normalizeLookup).filter(Boolean);
  const excluded = (excludedNames || []).map(normalizeLookup).filter(Boolean);
  const normalized = workbook.SheetNames.map(name => ({ name, key: normalizeLookup(name) }))
    .filter(sheet => !excluded.some(ex => sheet.key.includes(ex)));
  const exact = normalized.find(sheet => keys.some(key => sheet.key === key));
  if (exact) return workbook.Sheets[exact.name];
  const found = normalized.find(sheet => keys.some(key => sheet.key.includes(key)));
  return found ? workbook.Sheets[found.name] : null;
}

function sheetRows(workbook, names, excludedNames) {
  const sheet = getSheet(workbook, names, excludedNames);
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
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
  return normalizeDate(value) || cleanText(value);
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
    .filter(key => key !== 'sourceCallId')
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
            AND (existing.data - 'sourceCallId') = (v.data - 'sourceCallId')
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

function parseImportWorkbook(workbook, userId) {
  const imported = [];
  const counts = { calls: 0, refusals: 0, caddy: 0, patientCalls: 0 };
  const callIdsByPatient = new Map();

  const callRows = sheetRows(workbook, ['Вызов', 'Вызовы', 'Звонки'], ['пациент']);
  const callAliases = ['№', 'Номер', 'Дата', 'Дата вызова', 'Время вызова', 'ФИО пациента', 'Адрес', '№ бригады', 'Сумма', 'Комментарий', 'Время ожидания'];
  const callHeader = headerIndex(callRows);
  dataRows(callRows, callAliases).forEach(row => {
    const data = {
      callDate: importDateValue(cell(row, callHeader, ['Дата', 'Дата вызова'], 1)),
      callTime: normalizeTime(cell(row, callHeader, ['Время вызова', 'Время'], 2)),
      patientName: cleanText(cell(row, callHeader, ['ФИО пациента', 'Пациент'], 3)),
      address: cleanText(cell(row, callHeader, ['Адрес'], 4)),
      brigadeNumber: cleanText(cell(row, callHeader, ['№ бригады', 'Номер бригады'], 5)),
      amount: cleanText(cell(row, callHeader, ['Сумма'], 6)),
      comment: cleanText(cell(row, callHeader, ['Комментарий'], 7)),
      waitingTime: cleanText(cell(row, callHeader, ['Время ожидания'], 8))
    };
    if (!hasAnyText([data.callDate, data.callTime, data.patientName, data.address, data.brigadeNumber, data.amount, data.comment, data.waitingTime])) return;
    const payload = toPayload('calls', cleanNumber(cell(row, callHeader, ['№', 'Номер'], 0)), data, userId);
    payload.id = randomUUID();
    const key = patientKey(normalizeDate(data.callDate), data.patientName);
    if (key && !callIdsByPatient.has(key)) callIdsByPatient.set(key, payload.id);
    imported.push(payload);
    counts.calls++;
  });

  const refusalRows = sheetRows(workbook, ['Отказ', 'Отказы']);
  const refusalAliases = ['№', 'Номер', 'Дата', 'Время звонка', 'Причина отказа', 'Время через которое отказались', 'Местные/приезжие'];
  const refusalHeader = headerIndex(refusalRows);
  dataRows(refusalRows, refusalAliases).forEach(row => {
    const data = {
      refusalDate: importDateValue(cell(row, refusalHeader, ['Дата'], 1)),
      callTime: normalizeTime(cell(row, refusalHeader, ['Время звонка', 'Время'], 2)),
      reason: cleanText(cell(row, refusalHeader, ['Причина отказа'], 3)),
      refusalDelay: cleanText(cell(row, refusalHeader, ['Время через которое отказались'], 4)),
      localVisitor: cleanText(cell(row, refusalHeader, ['Местные/приезжие', 'Местные приезжие'], 5))
    };
    if (!hasAnyText([data.refusalDate, data.callTime, data.reason, data.refusalDelay, data.localVisitor])) return;
    imported.push(toPayload('refusals', cleanNumber(cell(row, refusalHeader, ['№', 'Номер'], 0)), data, userId));
    counts.refusals++;
  });

  const caddyRows = sheetRows(workbook, ['Caddy']);
  const caddyAliases = ['Дата', 'Время вызова', 'Номер машины', 'Причина вызова', 'Наименование МЦ', 'Медцентр'];
  const caddyHeader = headerIndex(caddyRows);
  dataRows(caddyRows, caddyAliases).forEach(row => {
    const data = {
      caddyDate: importDateValue(cell(row, caddyHeader, ['Дата'], 0)),
      caddyTime: normalizeTime(cell(row, caddyHeader, ['Время вызова', 'Время'], 1)),
      carNumber: cleanText(cell(row, caddyHeader, ['Номер машины'], 2)),
      reason: cleanText(cell(row, caddyHeader, ['Причина вызова'], 3)),
      medCenter: cleanText(cell(row, caddyHeader, ['Наименование МЦ', 'Медцентр', 'МЦ'], 4))
    };
    if (!hasAnyText([data.caddyDate, data.caddyTime, data.carNumber, data.reason, data.medCenter])) return;
    imported.push(toPayload('caddy', null, data, userId));
    counts.caddy++;
  });

  const patientCallRows = sheetRows(workbook, ['Звонки пациентам']);
  const patientCallAliases = ['Комментарий', 'Дата', 'Дата вызова', 'Пациент', 'Диагноз', 'Направления', 'Фио врача', 'Обследования', 'Номер телефона пациента', 'Регистратура отметка о записи'];
  const patientCallHeader = headerIndex(patientCallRows);
  dataRows(patientCallRows, patientCallAliases).forEach(row => {
    const data = {
      comment: cleanText(cell(row, patientCallHeader, ['Комментарий'], 0)),
      patientCallDate: importDateValue(cell(row, patientCallHeader, ['Дата'], 1)),
      callDate: importDateValue(cell(row, patientCallHeader, ['Дата вызова'], 2)),
      patientName: cleanText(cell(row, patientCallHeader, ['Пациент', 'ФИО пациента'], 3)),
      diagnosis: cleanText(cell(row, patientCallHeader, ['Диагноз'], 4)),
      direction: cleanText(cell(row, patientCallHeader, ['Направления', 'Направление'], 5)),
      doctorName: cleanText(cell(row, patientCallHeader, ['Фио врача', 'ФИО врача'], 6)),
      examination: cleanText(cell(row, patientCallHeader, ['Обследования', 'Обследование'], 7)),
      phone: cleanText(cell(row, patientCallHeader, ['Номер телефона пациента', 'Номер телефона', 'Телефон'], 8)),
      registrarMark: cleanText(cell(row, patientCallHeader, ['Регистратура отметка о записи'], 9))
    };
    if (!hasAnyText([data.comment, data.patientCallDate, data.callDate, data.patientName, data.diagnosis, data.direction, data.doctorName, data.examination, data.phone, data.registrarMark])) return;
    const key = patientKey(normalizeDate(data.callDate), data.patientName);
    if (key && callIdsByPatient.has(key)) data.sourceCallId = callIdsByPatient.get(key);
    imported.push(toPayload('patientCalls', null, data, userId));
    counts.patientCalls++;
  });

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

router.get('/available-calls', authenticate, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const rows = await AmbulanceReportEntry.sequelize.query(`
      SELECT c.*
      FROM ambulance_report_entries c
      WHERE c."entryType" = 'calls'
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
    const { type, date, excludeId } = req.query;
    if (!ENTRY_TYPES.includes(type)) return res.status(400).json({ error: 'Неверный тип вкладки' });
    const nextNumber = await getNextNumber(type, date, excludeId);
    res.json({ nextNumber });
  } catch (err) {
    console.error('GET /api/ambulance-reports/next-number error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/import', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const parsed = parseImportWorkbook(workbook, req.user?.id || null);
    const deduped = dedupeImportRows(parsed.imported.map(sanitizeImportPayload));
    const imported = deduped.rows;
    const counts = parsed.counts;

    if (!imported.length) {
      return res.status(400).json({ error: 'Не найдено строк для импорта' });
    }

    const badDateRow = imported.find(row => row.entryDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.entryDate)));
    if (badDateRow) {
      return res.status(400).json({
        error: 'В файле найдена некорректная дата',
        entryType: badDateRow.entryType,
        data: badDateRow.data
      });
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
      byType[type].skipped = Math.max((counts[type] || 0) - typeInserted, 0);
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
      byType
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

router.post('/', authenticate, async (req, res) => {
  try {
    const entryType = req.body.entryType;
    if (!ENTRY_TYPES.includes(entryType)) return res.status(400).json({ error: 'Неверный тип вкладки' });

    const payload = normalizeEntry(entryType, req.body, req.user?.id);
    if (NUMBERED_TYPES.includes(entryType) && !payload.seqNumber) {
      payload.seqNumber = await getNextNumber(entryType, payload.entryDate);
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
      payload.seqNumber = await getNextNumber(entryType, payload.entryDate, row.id);
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
