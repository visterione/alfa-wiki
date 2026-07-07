const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx-js-style');
const { randomUUID } = require('crypto');
const { Op, literal } = require('sequelize');
const { TherapyReportEntry, Page, PageHistory } = require('../models');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Человекочитаемые названия полей записи — для описаний в журнале изменений страницы
const FIELD_LABELS = {
  admissionDate: 'Дата поступления пациента',
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

// Все заполненные поля записи → элементы журнала.
// side = 'to' (создание, зелёным) или 'from' (удаление, красным).
function fullEntryChanges(data, side) {
  const changes = [];
  Object.keys(FIELD_LABELS).forEach(field => {
    const val = cleanText((data || {})[field]);
    if (!val) return;
    changes.push({ field, label: FIELD_LABELS[field], [side]: val });
  });
  return changes;
}

// Полный список полей записи для журнала редактирования (в порядке формы):
// изменённые — { from, to } (старое красным → новое зелёным),
// неизменённые непустые — { unchanged } (серым, для полноты картины).
function editChanges(oldData, newData) {
  const changes = [];
  Object.keys(FIELD_LABELS).forEach(field => {
    const from = cleanText((oldData || {})[field]);
    const to = cleanText((newData || {})[field]);
    if (from !== to) {
      changes.push({ field, label: FIELD_LABELS[field], from, to });
    } else if (to) {
      changes.push({ field, label: FIELD_LABELS[field], unchanged: to });
    }
  });
  return changes;
}

// pageId wiki-страницы, в которую встроена таблица (передаётся клиентом в body/query/form)
function resolvePageId(req) {
  const raw = (req.body && req.body.pageId) || req.query.pageId || '';
  return String(raw || '').trim();
}

// Пишем событие в журнал изменений wiki-страницы (page_history).
// Никогда не роняем основную операцию: ошибки логирования только пишем в консоль.
async function logTherapyHistory(req, { event, summary, changes }) {
  try {
    const pageId = resolvePageId(req);
    const userId = req.user && req.user.id;
    if (!pageId || !userId) return;

    const page = await Page.findByPk(pageId, { attributes: ['id'] });
    if (!page) return;

    await PageHistory.create({
      pageId,
      userId,
      action: 'updated',
      changesSummary: summary,
      metadata: {
        source: 'therapy',
        event,
        ...(changes && changes.length ? { changes } : {})
      }
    });
  } catch (err) {
    console.error('[therapy] logTherapyHistory error:', err && err.message);
  }
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const COLUMNS = [
  { aliases: ['Дата поступления пациента', 'Дата поступления', 'Дата'], field: 'admissionDate' },
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

// Excel хранит даты как серийный номер (дни от 1899-12-30). Если у ячейки не задан
// формат даты, парсер отдаёт голое число (напр. 46058) — конвертируем его в ДД.ММ.ГГГГ.
function excelSerialToDMY(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}

function normalizeDateCell(raw) {
  const s = cleanText(raw);
  if (!s) return '';
  // Чисто числовое значение в диапазоне Excel-дат (~1982…2099) — это серийный номер
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 30000 && n < 73050) return excelSerialToDMY(Math.floor(n));
  }
  return s; // уже строка-дата или другой текст — оставляем как есть
}

// ДД.ММ.ГГГГ → ISO (для колонки entryDate, по которой идёт сортировка). null если не дата.
function dmyToISO(val) {
  const m = String(val || '').trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Начало периода пребывания → ISO. Формат «24.04.25-29.04.25» (ГГ или ГГГГ).
// Разделители внутри даты допускаем разные (., , -, /) — в источнике встречаются опечатки.
function stayPeriodStartISO(val) {
  const m = String(val || '').trim().match(/^(\d{1,2})[.,\-/](\d{1,2})[.,\-/](\d{2}(?:\d{2})?)/);
  if (!m) return null;
  const year = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Дата для сортировки: сначала начало периода пребывания, иначе дата поступления.
function computeEntryDate(data) {
  return stayPeriodStartISO(data.stayPeriod) || dmyToISO(data.admissionDate);
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

// Лист «Гинекология» пропускаем — его данные импортируются на отдельной странице
const EXCLUDED_SHEET = 'Гинекология';

function parseImportWorkbook(workbook, userId) {
  const imported = [];

  const excluded = normalizeLookup(EXCLUDED_SHEET);
  const sheetNames = workbook.SheetNames.filter(name => normalizeLookup(name) !== excluded);

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (!rows.length) continue;

    let headerRowIdx = -1;
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
    // Нет строки заголовков с известными столбцами — лист не наш, пропускаем
    if (headerRowIdx === -1) continue;

    const headerRow = rows[headerRowIdx] || [];
    const colIndexes = COLUMNS.map(col => resolveColumnIndex(headerRow, col.aliases));

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (isEmptyRow(row)) continue;

      const data = {};
      COLUMNS.forEach((col, ci) => {
        const idx = colIndexes[ci];
        const raw = idx !== -1 ? row[idx] : '';
        data[col.field] = col.field === 'admissionDate' ? normalizeDateCell(raw) : cleanText(raw);
      });

      if (!data.patientName && !data.diagnosis) continue;

      imported.push({
        id: randomUUID(),
        entryDate: computeEntryDate(data),
        searchText: buildSearchText(data),
        data,
        createdBy: userId || null
      });
    }
  }

  return imported;
}

async function insertImportRows(rows) {
  const sequelize = TherapyReportEntry.sequelize;
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
        INSERT INTO therapy_report_entries (id, "entryDate", "searchText", data, "createdBy", "createdAt", "updatedAt")
        SELECT *
        FROM (VALUES ${values}) AS v(id, "entryDate", "searchText", data, "createdBy", "createdAt", "updatedAt")
        WHERE NOT EXISTS (
          SELECT 1 FROM therapy_report_entries e
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

    const result = await TherapyReportEntry.findAndCountAll({
      where,
      // Обратная хронология по дате поступления; записи без даты — в конце
      order: [[literal('"entryDate" DESC NULLS LAST')], ['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({ rows: result.rows, total: result.count, page, limit });
  } catch (err) {
    console.error('GET /api/therapy-reports error:', err);
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
    const rows = await TherapyReportEntry.findAll({
      where,
      order: [['entryDate', 'ASC'], ['createdAt', 'ASC']]
    });
    await logTherapyHistory(req, {
      event: 'export',
      summary: `Экспорт в Excel: выгружено записей — ${rows.length}`
    });
    res.json(rows);
  } catch (err) {
    console.error('GET /api/therapy-reports/export-data error:', err);
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
    console.log('[therapy-import] Листы:', workbook.SheetNames);

    const parsed = parseImportWorkbook(workbook, req.user?.id || null);
    console.log('[therapy-import] Распарсено строк:', parsed.length);

    const deduped = dedupeRows(parsed);
    if (deduped.duplicates > 0) console.log('[therapy-import] Дублей внутри файла:', deduped.duplicates);

    if (!deduped.rows.length) {
      return res.status(400).json({ error: 'Не найдено строк для импорта. Проверьте заголовки столбцов.' });
    }

    const inserted = await insertImportRows(deduped.rows);
    console.log(`[therapy-import] Вставлено=${inserted}, пропущено как дубли=${deduped.rows.length - inserted}`);

    await logTherapyHistory(req, {
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
    console.error('POST /api/therapy-reports/import error:', err);
    res.status(500).json({ error: 'Ошибка импорта Excel' });
  }
});

// ── POST create ───────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const data = req.body.data || {};

    const row = await TherapyReportEntry.create({
      entryDate: computeEntryDate(data),
      searchText: buildSearchText(data),
      data,
      createdBy: req.user?.id || null
    });
    await logTherapyHistory(req, {
      event: 'create',
      summary: `Добавлена запись: ${patientLabel(data)}`,
      changes: fullEntryChanges(data, 'to')
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/therapy-reports error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── PUT update ────────────────────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const row = await TherapyReportEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });

    const data = req.body.data || {};
    const oldData = row.data || {};

    await row.update({ entryDate: computeEntryDate(data), searchText: buildSearchText(data), data });
    await logTherapyHistory(req, {
      event: 'update',
      summary: `Изменена запись: ${patientLabel(data)}`,
      // Полный список полей: неизменённые — серым, изменённые — старое→новое
      changes: editChanges(oldData, data)
    });
    res.json(row);
  } catch (err) {
    console.error('PUT /api/therapy-reports/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── DELETE one ────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const row = await TherapyReportEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });
    const removedData = row.data || {};
    await row.destroy();
    await logTherapyHistory(req, {
      event: 'delete',
      summary: `Удалена запись: ${patientLabel(removedData)}`,
      // Полный состав удалённой записи — чтобы можно было восстановить при ошибочном удалении
      changes: fullEntryChanges(removedData, 'from')
    });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/therapy-reports/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── DELETE all ────────────────────────────────────────────────────────────────
router.delete('/', authenticate, async (req, res) => {
  try {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Нет доступа' });
    const deleted = await TherapyReportEntry.destroy({ where: {}, truncate: false });
    await logTherapyHistory(req, {
      event: 'clear',
      summary: `Удалены все данные (записей: ${deleted})`
    });
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('DELETE /api/therapy-reports error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
