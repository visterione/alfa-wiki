const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx-js-style');
const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const { CertificateRegistryEntry } = require('../models');
const { authenticate } = require('../middleware/auth');
const { fullEntryChanges, editChanges, logReportHistory } = require('../utils/reportHistory');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const ORGS = ['prestige', 'labgroup'];
const ORG_TITLES = { prestige: 'Престиж', labgroup: 'Лабгрупп' };

// Подписи полей для «Журнала изменений» wiki-страницы (в порядке формы).
// Дублирующиеся подписи налогоплательщика/пациента различаем префиксом.
const REG_FIELD_LABELS = {
  certNumber: '№ справки',
  correctionNumber: '№ корректировки',
  tpFio: 'Налогоплательщик: Фамилия, имя, отчество',
  tpInn: 'Налогоплательщик: ИНН',
  tpBirthDate: 'Налогоплательщик: Дата рождения',
  tpDocCode: 'Налогоплательщик: Код документа',
  tpDocSeries: 'Налогоплательщик: Серия, номер',
  tpDocDate: 'Налогоплательщик: Дата выдачи',
  ptFio: 'Пациент: Фамилия, имя, отчество',
  ptInn: 'Пациент: ИНН',
  ptBirthDate: 'Пациент: Дата рождения',
  ptDocCode: 'Пациент: Код документа',
  ptDocSeries: 'Пациент: Серия, номер',
  ptDocDate: 'Пациент: Дата выдачи',
  sumCode1: 'Сумма расходов по коду услуги 1',
  sumCode2: 'Сумма расходов по коду услуги 2',
  issuerName: 'ФИО выдавшего справку',
  formDate: 'Дата формирования',
  status: 'Статус',
  clinics: 'Клиники'
};

// Краткая идентификация справки для заголовка события журнала
function recordLabel(data) {
  const d = data || {};
  const raw = cleanText(d.certNumber) || cleanText(d.tpFio) || cleanText(d.ptFio) || cleanText(d.issuerName);
  if (!raw) return 'справка';
  return raw.length > 60 ? raw.slice(0, 60) + '…' : raw;
}

// Обёртка над общим журналлером — фиксирует source='certRegistry'
function logRegistryHistory(req, opts) {
  return logReportHistory(req, { source: 'certRegistry', ...opts });
}

const DATE_FIELDS = ['tpBirthDate', 'tpDocDate', 'ptBirthDate', 'ptDocDate', 'formDate'];

// Содержательные поля (всё, кроме № п/п, № справки, № корректировки). Если при импорте
// заполнены только номера, а эти поля пусты — строка считается пустой заготовкой и пропускается.
const CONTENT_FIELDS = [
  'tpFio', 'tpInn', 'tpBirthDate', 'tpDocCode', 'tpDocSeries', 'tpDocDate',
  'ptFio', 'ptInn', 'ptBirthDate', 'ptDocCode', 'ptDocSeries', 'ptDocDate',
  'sumCode1', 'sumCode2', 'issuerName', 'formDate', 'status', 'clinics'
];

// Первые две строки каждого листа — объединённая шапка таблицы (данные с 3-й строки).
const HEADER_ROWS = 2;

// Организации по названию листа Excel. На одну организацию может быть несколько листов
// с годом в названии: «ПРЕСТИЖ 2024», «ЛАБгрупп 2025» и т.п. — все попадают в свою вкладку.
const SHEET_ORG = [
  { org: 'prestige', names: ['престиж', 'prestige', 'престижа'] },
  { org: 'labgroup', names: ['лабгрупп', 'labgroup', 'лаб групп', 'лабгруп'] }
];

function normalizeLookup(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
}

function cleanText(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function isEmptyRow(row) {
  return !row || row.every(v => v === null || v === undefined || String(v).trim() === '');
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
    if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return '';
}

function isoToDMY(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// Дата-поля храним как ДД.ММ.ГГГГ для отображения (только распознаваемые даты; иначе — как есть)
function normalizeDataDates(data) {
  DATE_FIELDS.forEach(field => {
    const val = data[field];
    if (val === null || val === undefined || String(val).trim() === '') return;
    const iso = normalizeDate(val);
    if (iso) data[field] = isoToDMY(iso);
  });
  return data;
}

function buildSearchText(data) {
  return Object.entries(data || {})
    .filter(([k, v]) => !k.startsWith('_') && v !== null && v !== undefined)
    .map(([, v]) => v)
    .join(' ')
    .trim();
}

async function getNextNumber(org, excludeId) {
  const where = { org, seqNumber: { [Op.not]: null } };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const last = await CertificateRegistryEntry.findOne({ where, order: [['seqNumber', 'DESC']] });
  return last ? (Number(last.seqNumber) || 0) + 1 : 1;
}

function orgForSheet(sheetName) {
  const key = normalizeLookup(sheetName);
  const found = SHEET_ORG.find(o => o.names.some(n => key.includes(normalizeLookup(n))));
  return found ? found.org : null;
}

// Значение ячейки → строка. Большие числа (ИНН) разворачиваем в полную запись,
// чтобы не получить «2.30112E+11». Даты-серийники обрабатываются отдельно (normalizeDate).
function cellToText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return v.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 });
    return String(v);
  }
  return String(v).trim();
}

// Подпись столбца внутри группы «Налогоплательщик»/«Пациент» → поле (prefix = 'tp' | 'pt').
function subField(prefix, sub) {
  if (!sub) return null;
  if (sub.includes('фамили') || sub.includes('фио')) return prefix + 'Fio';
  if (sub.includes('инн')) return prefix + 'Inn';
  if (sub.includes('рождени') || sub.includes('обращени')) return prefix + 'BirthDate';
  if (sub.includes('выдач')) return prefix + 'DocDate';
  if (sub.includes('код')) return prefix + 'DocCode';
  if (sub.includes('сери') || sub.includes('номер')) return prefix + 'DocSeries';
  return null;
}

function sumField(sub, order) {
  if (sub && sub.includes('1')) return 'sumCode1';
  if (sub && sub.includes('2')) return 'sumCode2';
  return order === 0 ? 'sumCode1' : 'sumCode2';
}

// Одиночный (внегрупповой) столбец по его подписи. Подпись может стоять в любой из
// двух строк шапки, поэтому проверяем объединённый текст обеих строк столбца.
// Порядок важен, т.к. подписи пересекаются по словам:
//  - 'выдавш' раньше 'справк' («ФИО выдавшего справку» содержит оба);
//  - дата со словом «справк» («Дата формирования справки» / «Дата справки») — это
//    «Дата формирования», а не «№ справки», поэтому ловим её раньше чистого 'справк'.
function standaloneField(text) {
  if (!text) return null;
  if (text.includes('корректировк')) return 'correctionNumber';
  if (text.includes('выдавш')) return 'issuerName';
  if (text.includes('формировани') || (text.includes('дата') && text.includes('справк'))) return 'formDate';
  if (text.includes('справк')) return 'certNumber';
  if (text.includes('статус')) return 'status';
  if (text.includes('клиник')) return 'clinics';
  if (text.includes('пп') || text.includes('поряд')) return 'seqNumber';
  return null;
}

// Сопоставление столбцов по двум строкам шапки.
//  - Название группы («Налогоплательщик»/«Пациент»/«Сумма расходов») — в объединённой
//    ячейке row1, её подпись стоит в первом столбце диапазона, дальше row1 пуст.
//  - Одиночные столбцы (№ п/п, № справки, ФИО выдавшего, Статус, Клиники…) могут иметь
//    подпись как в row1, так и в row2 — ловим по объединённому тексту обеих строк.
// Благодаря этому лишний/пустой столбец не сдвигает разбор, а хвостовые одиночные
// столбцы не «прилипают» к последней группе.
function resolveColumns(row1, row2) {
  const n1 = (row1 || []).map(normalizeLookup);
  const n2 = (row2 || []).map(normalizeLookup);
  const width = Math.max(n1.length, n2.length);
  const map = [];
  let group = null;      // 'tp' | 'pt' | 'sum' | null
  let sumOrder = 0;

  for (let c = 0; c < width; c++) {
    const a = n1[c] || '';
    const b = n2[c] || '';

    // 1. Начало группы — только по row1 (объединённая ячейка-анкер).
    if (a.includes('налогоплательщик')) { group = 'tp'; map[c] = subField('tp', b); continue; }
    if (a.includes('пациент')) { group = 'pt'; map[c] = subField('pt', b); continue; }
    if (a.includes('расход')) { group = 'sum'; sumOrder = 0; map[c] = sumField(b, sumOrder++); continue; }

    // 2. Одиночный столбец (подпись в row1 или row2) — сбрасывает текущую группу.
    const st = standaloneField(a + ' ' + b);
    if (st) { group = null; map[c] = st; continue; }

    // 3. Иначе — продолжение активной группы (подпись столбца в row2).
    if (group === 'tp') map[c] = subField('tp', b);
    else if (group === 'pt') map[c] = subField('pt', b);
    else if (group === 'sum') map[c] = sumField(b, sumOrder++);
    else map[c] = null;
  }
  return map;
}

// Импорт по заголовкам: первые две строки — шапка, данные с 3-й строки.
function parseImportWorkbook(workbook, userId) {
  const imported = [];
  const counts = { prestige: 0, labgroup: 0 };

  for (const sheetName of workbook.SheetNames) {
    const org = orgForSheet(sheetName);
    if (!org) continue;

    const sheet = workbook.Sheets[sheetName];
    // raw: true — числа/даты остаются числами (ИНН не уходит в экспоненту, дату-серийник ловит normalizeDate)
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    if (rows.length <= HEADER_ROWS) continue;

    const colMap = resolveColumns(rows[0], rows[1]);

    for (let i = HEADER_ROWS; i < rows.length; i++) {
      const row = rows[i];
      if (isEmptyRow(row)) continue;

      const data = {};
      let seqNumber = null;
      for (let c = 0; c < row.length; c++) {
        const field = colMap[c];
        if (!field) continue;
        const raw = row[c];
        if (field === 'seqNumber') {
          const n = Number(raw);
          seqNumber = Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
        } else if (DATE_FIELDS.includes(field)) {
          const iso = normalizeDate(raw);
          data[field] = iso ? isoToDMY(iso) : cellToText(raw);
        } else {
          data[field] = cellToText(raw);
        }
      }

      // Пропускаем «пустые заготовки»: строки, где заполнены только № п/п и/или № справки
      // (и № корректировки), а всё содержательное пусто — их резервировали на будущее.
      const hasContent = CONTENT_FIELDS.some(f => cleanText(data[f]) !== '');
      if (!hasContent) continue;

      data._source = 'import';
      imported.push({
        id: randomUUID(),
        org,
        seqNumber,
        searchText: buildSearchText(data),
        data,
        createdBy: userId || null
      });
      counts[org]++;
    }
  }

  return { imported, counts };
}

function duplicateKey(row) {
  const stable = Object.keys(row.data || {})
    .filter(k => k !== '_source')
    .sort()
    .reduce((acc, k) => {
      acc[k] = row.data[k] === null || row.data[k] === undefined ? '' : String(row.data[k]).trim();
      return acc;
    }, {});
  return JSON.stringify({ org: row.org, seqNumber: row.seqNumber || null, data: stable });
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

async function insertImportRows(rows) {
  const sequelize = CertificateRegistryEntry.sequelize;
  const batchSize = 500;
  let inserted = 0;

  await sequelize.transaction(async transaction => {
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const replacements = {};
      const values = batch.map((row, index) => {
        const orderIndex = i + index;
        replacements[`id${index}`] = row.id || randomUUID();
        replacements[`org${index}`] = row.org;
        replacements[`seqNumber${index}`] = row.seqNumber;
        replacements[`searchText${index}`] = row.searchText || '';
        replacements[`data${index}`] = JSON.stringify(row.data || {});
        replacements[`createdBy${index}`] = row.createdBy || null;
        replacements[`orderIndex${index}`] = orderIndex;
        return `(
          CAST(:id${index} AS uuid),
          CAST(:org${index} AS certificate_registry_org),
          CAST(:seqNumber${index} AS integer),
          CAST(:searchText${index} AS text),
          CAST(:data${index} AS jsonb),
          CAST(:createdBy${index} AS uuid),
          NOW() + (:orderIndex${index} * INTERVAL '1 millisecond'),
          NOW() + (:orderIndex${index} * INTERVAL '1 millisecond')
        )`;
      }).join(',');

      const [insertedRows] = await sequelize.query(`
        INSERT INTO certificate_registry_entries (id, org, "seqNumber", "searchText", data, "createdBy", "createdAt", "updatedAt")
        SELECT *
        FROM (VALUES ${values}) AS v(id, org, "seqNumber", "searchText", data, "createdBy", "createdAt", "updatedAt")
        WHERE NOT EXISTS (
          SELECT 1 FROM certificate_registry_entries e
          WHERE e.org = v.org
            AND COALESCE(e."seqNumber", -2147483648) = COALESCE(CAST(v."seqNumber" AS integer), -2147483648)
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
    const { org, search } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = (page - 1) * limit;
    const where = {};

    if (org && ORGS.includes(org)) where.org = org;
    if (search && search.trim()) {
      where.searchText = { [Op.iLike]: `%${search.trim()}%` };
    }

    const result = await CertificateRegistryEntry.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({ rows: result.rows, total: result.count, page, limit });
  } catch (err) {
    console.error('GET /api/certificate-registry error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET next-number ───────────────────────────────────────────────────────────
router.get('/next-number', authenticate, async (req, res) => {
  try {
    const { org, excludeId } = req.query;
    if (!ORGS.includes(org)) return res.status(400).json({ error: 'Неверная организация' });
    const nextNumber = await getNextNumber(org, excludeId);
    res.json({ nextNumber });
  } catch (err) {
    console.error('GET /api/certificate-registry/next-number error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET export-data ───────────────────────────────────────────────────────────
router.get('/export-data', authenticate, async (req, res) => {
  try {
    const rows = await CertificateRegistryEntry.findAll({
      order: [['org', 'ASC'], ['createdAt', 'ASC']]
    });
    await logRegistryHistory(req, {
      event: 'export',
      summary: `Экспорт в Excel: выгружено записей — ${rows.length}`
    });
    res.json(rows);
  } catch (err) {
    console.error('GET /api/certificate-registry/export-data error:', err);
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
    const sheetNames = workbook.SheetNames;
    console.log('[cert-registry-import] Листы:', sheetNames);

    const parsed = parseImportWorkbook(workbook, req.user?.id || null);
    console.log('[cert-registry-import] Распарсено строк:', parsed.imported.length, 'по орг:', parsed.counts);

    const deduped = dedupeRows(parsed.imported);
    if (deduped.duplicates > 0) console.log('[cert-registry-import] Дублей внутри файла:', deduped.duplicates);

    if (!deduped.rows.length) {
      return res.status(400).json({
        error: 'Не найдено строк для импорта. Проверьте названия листов (Престиж / Лабгрупп) и заголовки.',
        sheetNames
      });
    }

    const inserted = await insertImportRows(deduped.rows);
    console.log(`[cert-registry-import] Вставлено=${inserted}, пропущено как дубли=${deduped.rows.length - inserted}`);

    const insertedParts = ORGS
      .filter(org => parsed.counts[org])
      .map(org => `${ORG_TITLES[org]}: ${parsed.counts[org]}`);
    await logRegistryHistory(req, {
      event: 'import',
      summary: `Импорт из Excel: добавлено ${inserted}`
        + (insertedParts.length ? ` (${insertedParts.join(', ')})` : '')
        + `, пропущено ${parsed.imported.length - inserted}`
    });

    res.json({
      success: true,
      total: inserted,
      parsed: parsed.imported.length,
      skipped: parsed.imported.length - inserted,
      duplicatesInFile: deduped.duplicates,
      counts: parsed.counts,
      sheetNames
    });
  } catch (err) {
    console.error('POST /api/certificate-registry/import error:', err);
    res.status(500).json({ error: 'Ошибка импорта Excel' });
  }
});

// ── POST create ───────────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const org = req.body.org;
    if (!ORGS.includes(org)) return res.status(400).json({ error: 'Неверная организация' });

    const data = normalizeDataDates({ ...(req.body.data || {}) });
    let seqNumber = req.body.seqNumber ? Number(req.body.seqNumber) : null;
    if (!Number.isFinite(seqNumber) || seqNumber <= 0) seqNumber = await getNextNumber(org);

    const row = await CertificateRegistryEntry.create({
      org,
      seqNumber,
      searchText: buildSearchText(data),
      data,
      createdBy: req.user?.id || null
    });
    await logRegistryHistory(req, {
      event: 'create',
      summary: `Добавлена справка (${ORG_TITLES[org] || org}): ${recordLabel(data)}`,
      changes: fullEntryChanges(data, 'to', REG_FIELD_LABELS)
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/certificate-registry error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── PUT update ────────────────────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const row = await CertificateRegistryEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });

    const org = ORGS.includes(req.body.org) ? req.body.org : row.org;
    const oldData = row.data || {};
    const data = normalizeDataDates({ ...(req.body.data || {}) });
    let seqNumber = req.body.seqNumber ? Number(req.body.seqNumber) : null;
    if (!Number.isFinite(seqNumber) || seqNumber <= 0) seqNumber = await getNextNumber(org, row.id);

    await row.update({ org, seqNumber, searchText: buildSearchText(data), data });
    await logRegistryHistory(req, {
      event: 'update',
      summary: `Изменена справка (${ORG_TITLES[org] || org}): ${recordLabel(data)}`,
      changes: editChanges(oldData, data, REG_FIELD_LABELS)
    });
    res.json(row);
  } catch (err) {
    console.error('PUT /api/certificate-registry/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── DELETE one ────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const row = await CertificateRegistryEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });
    const removedData = row.data || {};
    const removedOrg = row.org;
    await row.destroy();
    await logRegistryHistory(req, {
      event: 'delete',
      summary: `Удалена справка (${ORG_TITLES[removedOrg] || removedOrg}): ${recordLabel(removedData)}`,
      changes: fullEntryChanges(removedData, 'from', REG_FIELD_LABELS)
    });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/certificate-registry/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── DELETE all ────────────────────────────────────────────────────────────────
router.delete('/', authenticate, async (req, res) => {
  try {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Нет доступа' });
    const deleted = await CertificateRegistryEntry.destroy({ where: {}, truncate: false });
    await logRegistryHistory(req, {
      event: 'clear',
      summary: `Удалены все данные реестра справок (записей: ${deleted})`
    });
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('DELETE /api/certificate-registry error:', err);
    res.status(500).json({ error: 'Ошибка очистки данных' });
  }
});

module.exports = router;
