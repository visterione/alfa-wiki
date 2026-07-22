const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx-js-style');
const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const { DoctorDayReportEntry } = require('../models');
const { authenticate } = require('../middleware/auth');
const { logReportHistory } = require('../utils/reportHistory');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const sequelize = DoctorDayReportEntry.sequelize;

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const MONTH_TITLES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];

// Основы названий месяцев — ловят и «Январь», и «января», и «ЯНВ»
const MONTH_STEMS = [
  ['янв'], ['фев'], ['март', 'марта', 'мар'], ['апр'], ['май', 'мая'], ['июн'],
  ['июл'], ['авг'], ['сен'], ['окт'], ['ноя'], ['дек']
];

function cleanText(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function normalizeLookup(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
}

function parseYear(value) {
  const n = Number(cleanText(value));
  return Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR ? n : null;
}

function parseMonth(value) {
  const n = Number(cleanText(value));
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function periodTitle(year, month) {
  return `${MONTH_TITLES[month - 1] || month} ${year}`;
}

// Обёртка над общим журналлером — фиксирует source='doctorDay'
function logDoctorDayHistory(req, opts) {
  return logReportHistory(req, { source: 'doctorDay', ...opts });
}

// Число из ячейки: «1 200,50 ₽» → 1200.5. Нечисловое → null.
function parseAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value)
    .replace(/\s| /g, '')
    .replace(/[^\d,.\-]/g, '')
    .replace(',', '.');
  if (!text || text === '-' || text === '.') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// Значение ячейки → строка (целые числа без экспоненты и лишних нулей)
function cellToText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v)
      ? v.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
      : String(v);
  }
  return String(v).trim();
}

// Приводим days к каноничному виду: ключи «1»…«31», значения { sum, info } строками.
// Пустые дни выбрасываем, чтобы в JSONB не копился мусор.
function normalizeDays(raw, year, month) {
  const limit = year && month ? daysInMonth(year, month) : 31;
  const days = {};
  Object.keys(raw || {}).forEach(key => {
    const day = Number(key);
    if (!Number.isInteger(day) || day < 1 || day > limit) return;
    const cell = raw[key] || {};
    const sum = cleanText(typeof cell === 'object' ? cell.sum : cell);
    const info = cleanText(typeof cell === 'object' ? cell.info : '');
    if (!sum && !info) return;
    days[String(day)] = { sum, info };
  });
  return days;
}

function rowTotal(days) {
  return Object.values(days || {}).reduce((acc, cell) => {
    const n = parseAmount(cell && cell.sum);
    return n === null ? acc : acc + n;
  }, 0);
}

// Единый порядок строк — по алфавиту ФИО. Порядковый номер не храним: новый врач
// попадает на своё место сам, без перенумерации остальных строк.
// btrim+lower — чтобы «иванов» и « Иванов» стояли рядом, а не в разных концах списка.
// Названия, начинающиеся с цифры («314 кабинет»), уходят в конец списка — после алфавита.
// COLLATE "C" обязателен: коллация БД (en_US.UTF-8) кириллицу сортирует неверно —
// «Перевязочный» оказывается впереди «Арабян ЖМ». В байтовом порядке кириллица
// после lower() идёт ровно по алфавиту, «ё» приводим к «е» отдельно.
const NAME_SORT_KEY = `lower(translate(btrim("DoctorDayReportEntry"."doctorName"), 'Ёё', 'Ее')) COLLATE "C"`;
const NAME_ORDER = [
  [sequelize.literal(`CASE WHEN btrim("DoctorDayReportEntry"."doctorName") ~ '^[0-9]' THEN 1 ELSE 0 END`), 'ASC'],
  [sequelize.literal(NAME_SORT_KEY), 'ASC']
];

// Короткое описание изменений по дням для «Журнала изменений»
function daysChanges(oldDays, newDays) {
  const changes = [];
  const keys = new Set([...Object.keys(oldDays || {}), ...Object.keys(newDays || {})]);
  Array.from(keys)
    .map(Number)
    .filter(n => Number.isInteger(n))
    .sort((a, b) => a - b)
    .forEach(day => {
      const before = (oldDays || {})[day] || {};
      const after = (newDays || {})[day] || {};
      const from = [cleanText(before.sum), cleanText(before.info)].filter(Boolean).join(' / ');
      const to = [cleanText(after.sum), cleanText(after.info)].filter(Boolean).join(' / ');
      if (from !== to) changes.push({ field: `day${day}`, label: `${day} число`, from, to });
    });
  return changes;
}

// ── Импорт Excel ──────────────────────────────────────────────────────────────

// «Июль 2026» / «07.2026» / «июля 2026» → { year, month }. Без года — null.
function parseSheetName(sheetName) {
  const raw = String(sheetName || '');
  const key = normalizeLookup(raw);
  const yearMatch = raw.match(/(20\d{2})/);
  const year = yearMatch ? parseYear(yearMatch[1]) : null;
  if (!year) return null;

  let month = null;
  for (let i = 0; i < MONTH_STEMS.length; i++) {
    if (MONTH_STEMS[i].some(stem => key.includes(stem))) { month = i + 1; break; }
  }
  // Числовой формат листа: «07.2026», «2026-07»
  if (!month) {
    const numeric = raw.match(/(?:^|\D)(0?[1-9]|1[0-2])[.\-/\s]+20\d{2}/)
      || raw.match(/20\d{2}[.\-/\s]+(0?[1-9]|1[0-2])(?:\D|$)/);
    if (numeric) month = parseMonth(numeric[1]);
  }
  return month ? { year, month } : null;
}

// Ищем строку шапки с числами месяца: ≥5 ячеек с возрастающими числами 1…31.
function findDayHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const nums = (rows[i] || [])
      .map(v => Number(cleanText(v)))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 31);
    if (nums.length < 5) continue;
    let ascending = true;
    for (let k = 1; k < nums.length; k++) if (nums[k] <= nums[k - 1]) { ascending = false; break; }
    if (ascending) return i;
  }
  return -1;
}

// Раскладка листа: где столбец ФИО и по каким столбцам лежат Сумма/Информация каждого дня.
// Число дня стоит в объединённой ячейке (значение только в первом столбце пары),
// поэтому вторую колонку пары определяем по подзаголовку «Информация».
function resolveLayout(rows, dayRowIndex) {
  const dayRow = rows[dayRowIndex] || [];
  const subRow = rows[dayRowIndex + 1] || [];
  const subKeys = subRow.map(normalizeLookup);
  const hasSubHeader = subKeys.some(k => k.includes('сумм') || k.includes('информ'));

  const dayCols = [];
  for (let c = 0; c < dayRow.length; c++) {
    const day = Number(cleanText(dayRow[c]));
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    // Колонка «Информация» — соседняя справа, если она не начинает следующий день
    const nextIsDay = Number.isInteger(Number(cleanText(dayRow[c + 1])))
      && Number(cleanText(dayRow[c + 1])) >= 1;
    const infoCol = !nextIsDay && (!hasSubHeader || (subKeys[c + 1] || '').includes('информ'))
      ? c + 1
      : null;
    dayCols.push({ day, sumCol: c, infoCol });
  }

  // Столбец ФИО: подпись «ФИО»/«врач»/«сотрудник» в шапке, иначе — первый столбец
  let doctorCol = 0;
  for (let r = 0; r <= dayRowIndex + 1; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const k = normalizeLookup(row[c]);
      if (k.includes('фио') || k.includes('врач') || k.includes('сотрудник')) {
        doctorCol = c;
        r = dayRowIndex + 1;
        break;
      }
    }
  }

  const headerRows = hasSubHeader ? dayRowIndex + 2 : dayRowIndex + 1;
  return { dayCols, doctorCol, headerRows };
}

// Итоговые строки исходника («Итого», «Всего») — считаем на лету, не импортируем
function isTotalsLabel(text) {
  const k = normalizeLookup(text);
  return k === 'итого' || k === 'всего' || k.startsWith('итого') || k.startsWith('всего');
}

function parseImportWorkbook(workbook, userId) {
  const imported = [];
  const counts = {};
  const skippedSheets = [];

  for (const sheetName of workbook.SheetNames) {
    const period = parseSheetName(sheetName);
    if (!period) { skippedSheets.push(sheetName); continue; }
    const { year, month } = period;

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
    const dayRowIndex = findDayHeaderRow(rows);
    if (dayRowIndex === -1) { skippedSheets.push(sheetName); continue; }

    const { dayCols, doctorCol, headerRows } = resolveLayout(rows, dayRowIndex);
    if (!dayCols.length) { skippedSheets.push(sheetName); continue; }

    const limit = daysInMonth(year, month);
    for (let i = headerRows; i < rows.length; i++) {
      const row = rows[i] || [];
      const doctorName = cellToText(row[doctorCol]);
      if (!doctorName || isTotalsLabel(doctorName)) continue;

      const days = {};
      dayCols.forEach(({ day, sumCol, infoCol }) => {
        if (day > limit) return;
        const sum = cellToText(row[sumCol]);
        const info = infoCol === null ? '' : cellToText(row[infoCol]);
        if (!sum && !info) return;
        days[String(day)] = { sum, info };
      });

      imported.push({
        id: randomUUID(),
        year,
        month,
        doctorName,
        days,
        createdBy: userId || null
      });
      const key = `${year}|${month}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  return { imported, counts, skippedSheets };
}

// Врач на листе месяца уникален: существующую строку дополняем, новую — создаём.
// Так повторный импорт того же файла не плодит дубли, а досланный за месяц файл
// дописывает недостающие дни.
async function upsertImportRows(rows) {
  let inserted = 0;
  let updated = 0;

  await sequelize.transaction(async transaction => {
    for (const row of rows) {
      const existing = await DoctorDayReportEntry.findOne({
        where: {
          year: row.year,
          month: row.month,
          doctorName: { [Op.iLike]: row.doctorName.trim() }
        },
        transaction
      });

      if (!existing) {
        await DoctorDayReportEntry.create(row, { transaction });
        inserted++;
        continue;
      }

      const merged = { ...(existing.days || {}), ...row.days };
      const changed = JSON.stringify(merged) !== JSON.stringify(existing.days || {});
      if (changed) {
        await existing.update({ days: merged }, { transaction });
        updated++;
      }
    }
  });

  return { inserted, updated };
}

// ── GET list ──────────────────────────────────────────────────────────────────
// Матрица целиком: страница показывает весь месяц сразу, пагинация не нужна.
router.get('/', authenticate, async (req, res) => {
  try {
    const year = parseYear(req.query.year);
    const month = parseMonth(req.query.month);
    if (!year || !month) return res.status(400).json({ error: 'Не указан год или месяц' });

    const where = { year, month };
    const search = cleanText(req.query.search);
    if (search) where.doctorName = { [Op.iLike]: `%${search}%` };

    const rows = await DoctorDayReportEntry.findAll({ where, order: NAME_ORDER });

    res.json({ rows, year, month, days: daysInMonth(year, month), total: rows.length });
  } catch (err) {
    console.error('GET /api/doctor-day-report error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET periods ───────────────────────────────────────────────────────────────
// Периоды, реально присутствующие в данных: фронт объединяет их со своим
// базовым списком вкладок, чтобы «нестандартные» месяцы не потерялись.
router.get('/periods', authenticate, async (_req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT year, month, count(*)::int AS count
      FROM doctor_day_report_entries
      GROUP BY year, month
      ORDER BY year, month
    `);
    res.json({ periods: rows });
  } catch (err) {
    console.error('GET /api/doctor-day-report/periods error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET whoami ────────────────────────────────────────────────────────────────
router.get('/whoami', authenticate, (req, res) => {
  res.json({ isAdmin: !!req.user.isAdmin, displayName: req.user.displayName || '' });
});

// ── GET export-data ───────────────────────────────────────────────────────────
router.get('/export-data', authenticate, async (req, res) => {
  try {
    const rows = await DoctorDayReportEntry.findAll({
      order: [['year', 'ASC'], ['month', 'ASC'], ...NAME_ORDER]
    });
    await logDoctorDayHistory(req, {
      event: 'export',
      summary: `Экспорт в Excel: выгружено строк — ${rows.length}`
    });
    res.json(rows);
  } catch (err) {
    console.error('GET /api/doctor-day-report/export-data error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST create (новый врач на листе месяца) ─────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const year = parseYear(req.body.year);
    const month = parseMonth(req.body.month);
    const doctorName = cleanText(req.body.doctorName);
    if (!year || !month) return res.status(400).json({ error: 'Не указан год или месяц' });
    if (!doctorName) return res.status(400).json({ error: 'Не указано ФИО врача' });

    const duplicate = await DoctorDayReportEntry.findOne({
      where: { year, month, doctorName: { [Op.iLike]: doctorName } }
    });
    if (duplicate) return res.status(409).json({ error: 'Такой врач уже есть на этом листе' });

    const row = await DoctorDayReportEntry.create({
      year,
      month,
      doctorName,
      days: normalizeDays(req.body.days, year, month),
      createdBy: req.user?.id || null
    });

    await logDoctorDayHistory(req, {
      event: 'create',
      summary: `Добавлен врач (${periodTitle(year, month)}): ${doctorName}`
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/doctor-day-report error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── PUT update (ФИО и/или дни) ────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  try {
    const row = await DoctorDayReportEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });

    const oldName = row.doctorName;
    const oldDays = row.days || {};
    const patch = {};

    if (req.body.doctorName !== undefined) {
      const doctorName = cleanText(req.body.doctorName);
      if (!doctorName) return res.status(400).json({ error: 'Не указано ФИО врача' });
      if (normalizeLookup(doctorName) !== normalizeLookup(oldName)) {
        const duplicate = await DoctorDayReportEntry.findOne({
          where: {
            year: row.year,
            month: row.month,
            doctorName: { [Op.iLike]: doctorName },
            id: { [Op.ne]: row.id }
          }
        });
        if (duplicate) return res.status(409).json({ error: 'Такой врач уже есть на этом листе' });
      }
      patch.doctorName = doctorName;
    }
    if (req.body.days !== undefined) {
      patch.days = normalizeDays(req.body.days, row.year, row.month);
    }

    await row.update(patch);

    const changes = daysChanges(oldDays, row.days || {});
    if (patch.doctorName && patch.doctorName !== oldName) {
      changes.unshift({ field: 'doctorName', label: 'ФИО врача', from: oldName, to: patch.doctorName });
    }
    if (changes.length) {
      await logDoctorDayHistory(req, {
        event: 'update',
        summary: `Изменена строка (${periodTitle(row.year, row.month)}): ${row.doctorName}`,
        changes
      });
    }
    res.json(row);
  } catch (err) {
    console.error('PUT /api/doctor-day-report/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST copy-doctors ─────────────────────────────────────────────────────────
// Переносит список врачей с другого месяца пустыми строками — чтобы не набивать
// шапку таблицы заново каждый месяц.
router.post('/copy-doctors', authenticate, async (req, res) => {
  try {
    const fromYear = parseYear(req.body.fromYear);
    const fromMonth = parseMonth(req.body.fromMonth);
    const toYear = parseYear(req.body.toYear);
    const toMonth = parseMonth(req.body.toMonth);
    if (!fromYear || !fromMonth || !toYear || !toMonth) {
      return res.status(400).json({ error: 'Не указан период' });
    }

    const source = await DoctorDayReportEntry.findAll({
      where: { year: fromYear, month: fromMonth },
      order: NAME_ORDER
    });
    if (!source.length) return res.status(404).json({ error: 'В выбранном месяце нет врачей' });

    const existing = await DoctorDayReportEntry.findAll({ where: { year: toYear, month: toMonth } });
    const taken = new Set(existing.map(r => normalizeLookup(r.doctorName)));

    const created = [];
    for (const src of source) {
      if (taken.has(normalizeLookup(src.doctorName))) continue;
      created.push({
        id: randomUUID(),
        year: toYear,
        month: toMonth,
        doctorName: src.doctorName,
        days: {},
        createdBy: req.user?.id || null
      });
    }
    if (created.length) await DoctorDayReportEntry.bulkCreate(created);

    await logDoctorDayHistory(req, {
      event: 'update',
      summary: `Список врачей перенесён из «${periodTitle(fromYear, fromMonth)}»`
        + ` в «${periodTitle(toYear, toMonth)}»: добавлено ${created.length}`
    });
    res.json({ success: true, added: created.length, skipped: source.length - created.length });
  } catch (err) {
    console.error('POST /api/doctor-day-report/copy-doctors error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST import ───────────────────────────────────────────────────────────────
router.post('/import', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;
    console.log('[doctor-day-import] Листы:', sheetNames);

    const parsed = parseImportWorkbook(workbook, req.user?.id || null);
    console.log('[doctor-day-import] Распарсено строк:', parsed.imported.length, 'по периодам:', parsed.counts);

    if (!parsed.imported.length) {
      return res.status(400).json({
        error: 'Не найдено строк для импорта. Листы должны называться как «Июль 2026»'
          + ' — с месяцем и годом, а в шапке должны идти числа месяца.',
        sheetNames,
        skippedSheets: parsed.skippedSheets
      });
    }

    const { inserted, updated } = await upsertImportRows(parsed.imported);
    console.log(`[doctor-day-import] Добавлено=${inserted}, дополнено=${updated}`);

    const parts = Object.keys(parsed.counts).sort().map(key => {
      const [year, month] = key.split('|');
      return `${periodTitle(Number(year), Number(month))}: ${parsed.counts[key]}`;
    });
    await logDoctorDayHistory(req, {
      event: 'import',
      summary: `Импорт из Excel: добавлено ${inserted}, дополнено ${updated}`
        + (parts.length ? ` (${parts.join(', ')})` : '')
    });

    res.json({
      success: true,
      total: inserted,
      updated,
      parsed: parsed.imported.length,
      skipped: parsed.imported.length - inserted - updated,
      counts: parsed.counts,
      skippedSheets: parsed.skippedSheets,
      sheetNames
    });
  } catch (err) {
    console.error('POST /api/doctor-day-report/import error:', err);
    res.status(500).json({ error: 'Ошибка импорта Excel' });
  }
});

// ── DELETE one ────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const row = await DoctorDayReportEntry.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Запись не найдена' });

    const { doctorName, year, month, days } = row;
    await row.destroy();
    await logDoctorDayHistory(req, {
      event: 'delete',
      summary: `Удалена строка (${periodTitle(year, month)}): ${doctorName}`
        + ` — сумма за месяц ${rowTotal(days)}`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/doctor-day-report/:id error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── DELETE all ────────────────────────────────────────────────────────────────
router.delete('/', authenticate, async (req, res) => {
  try {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Нет доступа' });
    const deleted = await DoctorDayReportEntry.destroy({ where: {}, truncate: false });
    await logDoctorDayHistory(req, {
      event: 'delete',
      summary: `Очищен отчёт по врачам: удалено строк — ${deleted}`
    });
    res.json({ success: true, deleted });
  } catch (err) {
    console.error('DELETE /api/doctor-day-report error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
