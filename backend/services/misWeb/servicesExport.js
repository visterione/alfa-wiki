'use strict';

/**
 * Выгрузка «Касса → Выгрузка по услугам» в источники зарплатного модуля
 * (ver. 9.12).
 *
 * Раньше это делали руками: восемь выгрузок за месяц, по одной на медцентр,
 * потом склейка восьми файлов в один. Все клиники одним запросом МИС не
 * тянет — отваливается соединение. Робот повторяет ручной порядок, только
 * без человека: клиника за клиникой, строго по одной, чтобы не нагружать МИС
 * сильнее, чем бухгалтер. Если отрезок всё же не проходит, он делится пополам
 * и выгружается частями — так один тяжёлый месяц не губит всю задачу.
 *
 * Склейка — ровно как вручную: шапка первого файла, дальше строки остальных
 * подряд. Потоковая, потому что месяц по всей сети — это порядка двухсот
 * тысяч строк на пятьдесят одну колонку, и держать их в памяти целиком
 * процессу, который заодно обслуживает мессенджер, незачем.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const client = require('./client');
const session = require('./session');

// Восемь медцентров, как их выгружали вручную. Идентификаторы и названия —
// из списка «Клиники» на странице МИС. Направители и оба «Общих склада»
// заказчик исключил: это не медцентры, зарплата по ним не считается.
const CLINICS = [
  { id: 2, name: 'Альфа' },
  { id: 3, name: 'Альфа Kids' },
  { id: 6, name: 'Альфа Линия' },
  { id: 1, name: 'Альфа Проф' },
  { id: 7, name: 'Альфа Смайл' },
  { id: 4, name: '3К' },
  { id: 11, name: 'Альфа Сукко' },
  { id: 12, name: 'Забор Крови' },
];

const DATE_TYPES = { 1: 'по дате выставления', 2: 'по дате оплаты' };

// Сколько раз делить отрезок, если он не проходит. Три деления — это месяц,
// разбитый до недели; дальше дробить бессмысленно: если МИС не отдаёт и
// неделю, дело не в объёме.
const MAX_SPLIT_DEPTH = 3;
const RETRY_PAUSE_MS = 10 * 1000;

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const iso = d => d.toISOString().slice(0, 10);
const parseIso = s => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => { const d = parseIso(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000) + 1;

/**
 * Период режется по календарным месяцам: месяц на клинику — это объём, который
 * МИС уже отдавала при ручной выгрузке. Больший отрезок в один запрос не
 * посылаем, даже если попросили квартал.
 */
function planRanges(dateFrom, dateTo) {
  const out = [];
  let from = dateFrom;
  while (from <= dateTo) {
    const d = parseIso(from);
    const monthEnd = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    const to = monthEnd < dateTo ? monthEnd : dateTo;
    out.push({ dateFrom: from, dateTo: to });
    from = addDays(to, 1);
  }
  return out;
}

function halve({ dateFrom, dateTo }) {
  const days = daysBetween(dateFrom, dateTo);
  if (days < 2) return null;
  const mid = addDays(dateFrom, Math.floor(days / 2) - 1);
  return [{ dateFrom, dateTo: mid }, { dateFrom: addDays(mid, 1), dateTo }];
}

/**
 * Название источника. Ровно календарный месяц называем по-человечески
 * («Сентябрь 2026») — так источники и подписывали руками, и по такому названию
 * их ищут в списке.
 */
function defaultLabel(dateFrom, dateTo) {
  const f = parseIso(dateFrom);
  const lastDay = iso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)));
  if (dateFrom.endsWith('-01') && dateTo === lastDay) {
    return `${MONTHS[f.getUTCMonth()]} ${f.getUTCFullYear()}`;
  }
  return `${client.toMisDate(dateFrom)} – ${client.toMisDate(dateTo)}`;
}

function cellValue(v) {
  if (v == null) return null;
  // Формулы и форматированный текст в выгрузке МИС не встречались, но если
  // появятся, в склейку должно попасть то, что человек видит в ячейке.
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result ?? null;
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('');
    if ('text' in v) return v.text;
  }
  return v;
}

/**
 * Склеивает файлы в один. Шапки обязаны совпадать: если МИС между запросами
 * поменяет набор колонок, молча склеенный файл разъехался бы по столбцам, и
 * ошибка всплыла бы только в расчёте зарплаты.
 *
 * Итог пишется потоком, а каждый входной файл читается целиком. Потоковое
 * чтение exceljs пробовали — оно падает на файлах, где листы лежат в архиве
 * раньше описания книги. Целиком в памяти оказывается не больше одного куска —
 * месяц одной клиники, — и такой файл exceljs уже читал без труда.
 *
 * Возвращает число строк по каждому файлу — из него вкладка показывает, сколько
 * услуг пришло по каждой клинике.
 */
async function mergeXlsx(files, outPath) {
  const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: outPath, useStyles: false, useSharedStrings: false });
  const sheet = writer.addWorksheet('Выгрузка по услугам');
  let header = null;
  let rows = 0;
  const perFile = [];

  for (const file of files) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    // В выгрузке МИС один лист; если их станет больше, берём первый.
    const ws = wb.worksheets[0];
    let count = 0;
    let isHeader = true;
    let mismatch = false;
    ws?.eachRow({ includeEmpty: false }, row => {
      if (mismatch) return;
      const values = row.values.slice(1).map(cellValue);
      if (isHeader) {
        isHeader = false;
        const names = values.map(v => (v == null ? '' : String(v).trim()));
        if (!header) {
          header = names;
          sheet.addRow(header).commit();
        } else if (names.join('\u0001') !== header.join('\u0001')) {
          mismatch = true;
        }
        return;
      }
      if (values.every(v => v == null || v === '')) return;
      sheet.addRow(Array.from({ length: header.length }, (_, i) => values[i] ?? null)).commit();
      count++;
    });
    if (mismatch) throw new Error(`Шапка файла «${path.basename(file)}» не совпадает с первой — склеивать нельзя`);
    perFile.push(count);
    rows += count;
  }

  if (!header) throw new Error('Ни одного файла со строками — склеивать нечего');
  await sheet.commit();
  await writer.commit();
  return { rows, columns: header.length, perFile };
}

// ── Оценка времени ─────────────────────────────────────────────────────────
//
// Файл МИС собирает целиком и молча, так что прогресса «изнутри» нет. Зато
// скорость у каждой клиники своя и от раза к разу похожая: запоминаем, сколько
// секунд уходит на день периода, и по ней рисуем ожидаемое время. Среднее
// скользящее, чтобы один медленный вечер не портил оценку надолго.

const SPEED_KEY = 'mis_export_speed';

async function loadSpeeds() {
  try {
    const { Setting } = require('../../models');
    return (await Setting.findByPk(SPEED_KEY))?.value || {};
  } catch {
    return {};
  }
}

async function rememberSpeed(clinicId, secPerDay) {
  try {
    const { Setting } = require('../../models');
    const speeds = await loadSpeeds();
    const prev = speeds[clinicId];
    speeds[clinicId] = prev ? prev * 0.5 + secPerDay * 0.5 : secPerDay;
    await Setting.upsert({ key: SPEED_KEY, value: speeds, description: 'Скорость выгрузки услуг из МИС, секунд на день периода по клиникам' });
  } catch (err) {
    // Оценка — удобство, а не часть выгрузки: без неё полоса просто станет
    // «бегущей».
    console.error('[mis-export] не удалось запомнить скорость:', err.message);
  }
}

// ── Задача ─────────────────────────────────────────────────────────────────
//
// Одна на всю вики. Параллельные выгрузки удвоили бы нагрузку на МИС — ровно
// то, из-за чего всё и падало, — а пользы не дали бы: сессия всё равно одна.
// Состояние в памяти: задача длится минуты, и после перезапуска её честнее
// начать заново, чем восстанавливать наполовину скачанное.

let current = null;
let abort = null;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Отменено')); }, { once: true });
});

function publicState() {
  if (!current) return null;
  const { tmpDir, ...rest } = current;
  return JSON.parse(JSON.stringify(rest));
}

class CancelledError extends Error {}

async function fetchRange(jar, job, part, range, depth, signal, onLog) {
  if (signal.aborted) throw new CancelledError();
  const file = path.join(job.tmpDir, `${part.clinicId}_${range.dateFrom}_${range.dateTo}.xlsx`);
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      part.current = { ...range, attempt };
      const buf = await client.downloadServices(jar, { ...range, dateType: job.params.dateType, clinicId: part.clinicId, signal });
      await fs.promises.writeFile(file, buf);
      return [file];
    } catch (err) {
      if (signal.aborted) throw new CancelledError();
      if (err.code === 'MIS_SESSION_EXPIRED') throw err;
      lastErr = err;
      onLog(`${part.name}, ${client.toMisDate(range.dateFrom)}–${client.toMisDate(range.dateTo)}: ${err.message}`);
      if (attempt < 2) await sleep(RETRY_PAUSE_MS, signal);
    }
  }
  const halves = depth < MAX_SPLIT_DEPTH ? halve(range) : null;
  if (!halves) throw lastErr;
  onLog(`${part.name}: делю отрезок пополам и пробую частями`);
  const a = await fetchRange(jar, job, part, halves[0], depth + 1, signal, onLog);
  const b = await fetchRange(jar, job, part, halves[1], depth + 1, signal, onLog);
  return [...a, ...b];
}

async function run(jar, user) {
  const job = current;
  const { signal } = abort;
  const log = msg => { job.log.push({ at: new Date().toISOString(), msg }); if (job.log.length > 50) job.log.shift(); };
  const files = [];   // [{ file, part }] в порядке склейки

  try {
    for (const part of job.parts) {
      part.status = 'running';
      part.startedAt = new Date().toISOString();
      const partFiles = [];
      const ranges = planRanges(job.params.dateFrom, job.params.dateTo);
      // МИС не сообщает, сколько осталось до готовности файла, поэтому честный
      // прогресс внутри клиники — только по месяцам: сколько кусков уже
      // скачано из скольких.
      part.chunksTotal = ranges.length;
      part.chunksDone = 0;
      for (const range of ranges) {
        partFiles.push(...await fetchRange(jar, job, part, range, 0, signal, log));
        part.chunksDone++;
      }
      files.push(...partFiles.map(file => ({ file, part })));
      const secs = (Date.now() - new Date(part.startedAt)) / 1000;
      await rememberSpeed(part.clinicId, secs / daysBetween(job.params.dateFrom, job.params.dateTo));
      part.bytes = 0;
      for (const f of partFiles) part.bytes += (await fs.promises.stat(f)).size;
      part.current = null;
      part.status = 'done';
      part.finishedAt = new Date().toISOString();
    }

    job.status = 'merging';
    const out = path.join(job.tmpDir, 'merged.xlsx');
    const { rows, perFile } = await mergeXlsx(files.map(f => f.file), out);
    job.parts.forEach(p => { p.rows = 0; });
    perFile.forEach((n, i) => { files[i].part.rows += n; });
    const data = await fs.promises.readFile(out);

    // Модель импортируется здесь, а не в шапке: так чистые функции модуля
    // (нарезка, склейка) проверяются тестами без подключения к базе.
    const { RbExcelSource } = require('../../models');
    const { dateFrom, dateTo, periodLabel } = job.params;
    const src = await RbExcelSource.create({
      dateFrom,
      dateTo,
      periodLabel,
      fileName: `Выгрузка по услугам ${client.toMisDate(dateFrom)}–${client.toMisDate(dateTo)}.xlsx`,
      fileData: data.toString('base64'),
      uploadedBy: user.displayName || user.username || null,
    });

    job.rows = rows;
    job.sourceId = src.id;
    job.status = 'done';
  } catch (err) {
    const running = job.parts.find(p => p.status === 'running');
    if (running) { running.status = 'failed'; running.current = null; }
    if (err instanceof CancelledError || signal.aborted) {
      job.status = 'cancelled';
    } else if (err.code === 'MIS_SESSION_EXPIRED') {
      job.status = 'needs_login';
      job.error = err.message;
      await session.markExpired().catch(() => {});
    } else {
      job.status = 'failed';
      job.error = err.message;
    }
    console.error('[mis-export] задача остановлена:', err.message);
  } finally {
    job.finishedAt = new Date().toISOString();
    abort = null;
    // Во временных файлах — персональные данные пациентов. Хранить их дольше
    // задачи незачем: итог уже в источниках.
    await fs.promises.rm(job.tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Запускает выгрузку. Бросает ошибку с кодом, если запустить нельзя: уже идёт
 * другая, нет сессии.
 */
async function start({ dateFrom, dateTo, dateType = 2, clinicIds, periodLabel }, user) {
  if (current && ['running', 'merging'].includes(current.status)) {
    const e = new Error('Выгрузка уже идёт — дождитесь её окончания');
    e.status = 409;
    throw e;
  }
  const jar = await session.loadJar();
  if (!jar) {
    const e = new Error('Нет входа в МИС');
    e.status = 409;
    e.code = 'MIS_SESSION_EXPIRED';
    throw e;
  }

  const wanted = new Set((clinicIds || []).map(Number));
  const clinics = CLINICS.filter(c => wanted.has(c.id));
  const speeds = await loadSpeeds();
  const days = daysBetween(dateFrom, dateTo);

  current = {
    id: crypto.randomUUID(),
    status: 'running',
    params: {
      dateFrom, dateTo, dateType: Number(dateType) === 1 ? 1 : 2,
      periodLabel: (periodLabel || '').trim() || defaultLabel(dateFrom, dateTo),
    },
    parts: clinics.map(c => ({
      clinicId: c.id, name: c.name, status: 'waiting', rows: null, chunksTotal: 0, chunksDone: 0,
      estimateSec: speeds[c.id] ? Math.round(speeds[c.id] * days) : null,
    })),
    startedBy: user.displayName || user.username || null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    rows: null,
    sourceId: null,
    error: null,
    log: [],
    tmpDir: await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mis-export-')),
  };
  abort = new AbortController();
  run(jar, user);
  return publicState();
}

function cancel() {
  if (abort) abort.abort();
  return publicState();
}

module.exports = {
  CLINICS,
  DATE_TYPES,
  planRanges,
  halve,
  defaultLabel,
  mergeXlsx,
  start,
  cancel,
  state: publicState,
};
