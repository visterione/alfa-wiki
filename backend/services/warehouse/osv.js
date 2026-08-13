/**
 * Разбор оборотно-сальдовой ведомости 1С (XLSX).
 *
 * Единственный источник автоматических данных модуля: обмена с 1С нет и не
 * планируется, бухгалтерия раз в месяц отдаёт выгрузку по счёту МЦ.04
 * («Инвентарь и хозяйственные принадлежности в эксплуатации»), всё остальное
 * разносится руками.
 *
 * ── Почему xlsx-js-style, а не exceljs ───────────────────────────────────────
 *
 * Выгрузки отчётов (services/warehouse/exports.js) собираются на exceljs ради
 * группировки строк. Читать этим же пакетом файл 1С не получилось: он падает на
 * нём с «Cannot read properties of undefined (reading 'anchors')» — спотыкается о
 * рисунки в шапке листа. xlsx-js-style читает файл целиком и, что здесь главное,
 * отдаёт уровни группировки строк в ws['!rows'][i].level.
 *
 * ── Почему уровень группировки, а не цвет заливки ────────────────────────────
 *
 * В файле дерево размечено дважды: зелёной заливкой групп и настоящей
 * группировкой строк Excel. Заливка — оформление: она зависит от темы, условного
 * форматирования и настроения того, кто выгружал. Уровень группировки 1С
 * проставляет структурно, и он совпадает с деревом номенклатуры один в один.
 * Проверено на августовской выгрузке: 3098 строк, ни одного пропуска уровня.
 *
 * ── Как устроены строки ──────────────────────────────────────────────────────
 *
 * Одна позиция — это ДВЕ строки листа: в колонке «Показатели» сначала «БУ»
 * (суммы бухгалтерского учёта), под ней «Кол.» (количество). Название стоит
 * только в первой. Числовые колонки одинаковые у обеих: сальдо на начало (C/D),
 * обороты (E/F), сальдо на конец (G/H), каждое парой дебет/кредит.
 *
 * ── Про дебет и кредит ───────────────────────────────────────────────────────
 *
 * Сальдо хранится свёрнутым: дебет минус кредит. МЦ.04 — активный забалансовый
 * счёт, кредитового сальдо у него не бывает, и в августовском файле колонки D и H
 * пустые целиком. Но хранить два поля «на всякий случай» значит однажды получить
 * запись в обеих и не решить, какая из них остаток. Свёрнутое значение со знаком
 * отвечает на этот вопрос всегда. Обороты, наоборот, разделены: приход и расход
 * за месяц — разные события, и складывать их нельзя.
 */

const crypto = require('crypto');
const XLSX = require('xlsx-js-style');

/** Ошибка разбора: текст показывается пользователю, поэтому он по-русски. */
class OsvParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OsvParseError';
  }
}

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

// Родительные падежи из шапки 1С («за Август 2026 г.» встречается и как
// «за август 2026 г.», и как «за Августа»), плюс основная форма.
const MONTH_FORMS = MONTHS.flatMap((name, index) => [
  [name, index], [name.replace(/ь$/, 'я'), index], [name.replace(/й$/, 'я'), index],
  [name === 'март' ? 'марта' : null, index], [name === 'август' ? 'августа' : null, index],
]).filter(([form]) => form);

const COL = { name: 0, indicator: 1, openDt: 2, openCt: 3, debit: 4, credit: 5, closeDt: 6, closeCt: 7 };

/** Число из ячейки: 1С отдаёт и числом, и строкой с неразрывными пробелами. */
function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[\s ]/g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\s ]+/g, ' ').trim();
}

/**
 * Шапка листа: организация, счёт и период. Период нужен как ключ — снимок за один
 * и тот же месяц должен заменять предыдущий, а не ложиться рядом вторым.
 */
function parseHeader(cell) {
  const organization = text(cell(0, 0));
  const title = text(cell(1, 0));

  if (!/оборотно-сальдовая ведомость/i.test(title)) {
    throw new OsvParseError(
      'Это не похоже на оборотно-сальдовую ведомость: во второй строке листа '
      + 'ожидался заголовок «Оборотно-сальдовая ведомость по счету …».',
    );
  }

  const account = (title.match(/по счету\s+([^\s]+)/i) || [])[1] || null;
  const periodLabel = (title.match(/\sза\s+(.+?)\s*$/i) || [])[1] || null;

  let periodYear = null;
  let periodMonth = null;
  if (periodLabel) {
    const year = (periodLabel.match(/(20\d{2})/) || [])[1];
    const lower = periodLabel.toLowerCase();
    const month = MONTH_FORMS.find(([form]) => lower.includes(form));
    if (year) periodYear = Number(year);
    if (month) periodMonth = month[1] + 1;
  }

  return { organization, account, title, periodLabel, periodYear, periodMonth };
}

/**
 * Проверка раскладки колонок. Без неё перепутанные местами «Обороты» и «Сальдо на
 * конец» дали бы правдоподобно выглядящий, но неверный импорт — а заметили бы это
 * через месяцы, при первом расхождении с бухгалтерией.
 */
function assertLayout(cell) {
  for (let row = 2; row < 8; row++) {
    const isHeader = /сальдо на начало/i.test(text(cell(row, COL.openDt)))
      && /обороты/i.test(text(cell(row, COL.debit)))
      && /сальдо на конец/i.test(text(cell(row, COL.closeDt)));
    if (!isHeader) continue;

    const debit = text(cell(row + 1, COL.openDt));
    const credit = text(cell(row + 1, COL.openCt));
    if (!/дебет/i.test(debit) || !/кредит/i.test(credit)) {
      throw new OsvParseError(
        'Не совпадает раскладка колонок: под «Сальдо на начало периода» ожидались '
        + '«Дебет» и «Кредит». Похоже, отчёт выгружен с другими настройками.',
      );
    }
    return row;
  }
  throw new OsvParseError(
    'Не нашёл шапку таблицы: ожидались колонки «Сальдо на начало периода», '
    + '«Обороты за период» и «Сальдо на конец периода».',
  );
}

/**
 * Ключ строки, устойчивый между месяцами. Составляется из полного пути по дереву,
 * названия и порядкового номера повтора.
 *
 * Номер повтора нужен из-за того, что одна и та же номенклатура встречается в
 * одной группе несколько раз с разной ценой — это партии 1С: «Шкаф коммутационный
 * ЦМО» лежит строками 2 шт. по 15 110 и три раза по 12 666,67. Ни название, ни
 * даже путь целиком их не различают, и без счётчика второй импорт склеил бы их в
 * одну строку, потеряв количество.
 *
 * Ключ рвётся при переименовании группы в 1С — это неизбежно и поэтому не
 * скрывается: после каждого импорта показываем «новые» и «пропавшие» строки,
 * чтобы такую пару было видно и можно было связать руками.
 */
function lineKeyOf(path, dupIndex) {
  const raw = `${path.join('')}${dupIndex}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

/**
 * @param {Buffer} buffer содержимое .xlsx
 * @returns {{header, lines, totals, control, warnings}}
 */
function parseOsv(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
  } catch (err) {
    throw new OsvParseError(`Файл не читается как XLSX: ${err.message}`);
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet || !sheet['!ref']) throw new OsvParseError('В файле нет ни одного листа с данными.');

  const range = XLSX.utils.decode_range(sheet['!ref']);
  const meta = sheet['!rows'] || [];
  const cell = (row, col) => {
    const found = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
    return found ? found.v : undefined;
  };
  const levelOf = row => (meta[row] && meta[row].level) || 0;

  const header = parseHeader(cell);
  const headerRow = assertLayout(cell);

  // ── Собираем пары «БУ» + «Кол.» ────────────────────────────────────────────
  const records = [];
  for (let row = headerRow + 1; row <= range.e.r; row++) {
    if (!/^БУ$/i.test(text(cell(row, COL.indicator)))) continue;

    const qtyRow = /^кол\.?$/i.test(text(cell(row + 1, COL.indicator))) ? row + 1 : null;
    const money = c => num(cell(row, c));
    const qty = c => (qtyRow === null ? 0 : num(cell(qtyRow, c)));

    records.push({
      rowNumber: row + 1,
      level: levelOf(row),
      name: text(cell(row, COL.name)),
      openingSum: money(COL.openDt) - money(COL.openCt),
      openingQty: qty(COL.openDt) - qty(COL.openCt),
      debitSum: money(COL.debit),
      debitQty: qty(COL.debit),
      creditSum: money(COL.credit),
      creditQty: qty(COL.credit),
      closingSum: money(COL.closeDt) - money(COL.closeCt),
      closingQty: qty(COL.closeDt) - qty(COL.closeCt),
    });
  }

  if (!records.length) {
    throw new OsvParseError('В файле не нашлось ни одной строки с показателем «БУ».');
  }

  // Последняя строка «Итого» дублирует корень счёта. В данные она не идёт — иначе
  // все суммы удвоятся, — но остаётся контрольной: с ней сверяется результат.
  let control = null;
  const last = records[records.length - 1];
  if (/^итого/i.test(last.name)) control = records.pop();

  // ── Путь по дереву и признак группы ────────────────────────────────────────
  const stack = [];
  const dupCounters = new Map();

  const lines = records.map((record, index) => {
    stack[record.level] = record.name;
    stack.length = record.level + 1;
    const path = stack.slice();

    const next = records[index + 1];
    const isGroup = Boolean(next && next.level > record.level);

    const dupSeed = path.join('');
    const dupIndex = dupCounters.get(dupSeed) || 0;
    dupCounters.set(dupSeed, dupIndex + 1);

    return {
      ...record,
      isGroup,
      // Путь до родителя: сам элемент в нём уже не нужен, а для отображения и
      // группового сопоставления («вся ветка → кабинет») нужен именно родитель.
      // Корень отброшен — это сам счёт, он одинаковый у всех строк файла.
      pathText: path.slice(1, -1).join(' / '),
      dupIndex,
      lineKey: lineKeyOf(path, dupIndex),
      unitCost: record.closingQty ? record.closingSum / record.closingQty : null,
    };
  });

  // ── Проверки целостности ───────────────────────────────────────────────────
  const warnings = [];
  const roots = lines.filter(line => line.level === 0);
  const totals = roots.reduce((acc, line) => ({
    openingSum: acc.openingSum + line.openingSum,
    openingQty: acc.openingQty + line.openingQty,
    debitSum: acc.debitSum + line.debitSum,
    debitQty: acc.debitQty + line.debitQty,
    creditSum: acc.creditSum + line.creditSum,
    creditQty: acc.creditQty + line.creditQty,
    closingSum: acc.closingSum + line.closingSum,
    closingQty: acc.closingQty + line.closingQty,
  }), {
    openingSum: 0, openingQty: 0, debitSum: 0, debitQty: 0,
    creditSum: 0, creditQty: 0, closingSum: 0, closingQty: 0,
  });

  if (control) {
    if (Math.abs(control.closingSum - totals.closingSum) > 0.05
      || Math.abs(control.closingQty - totals.closingQty) > 0.005) {
      throw new OsvParseError(
        `Итог файла не сходится с суммой строк: в «Итого» ${control.closingSum.toFixed(2)} ₽ / `
        + `${control.closingQty}, по строкам ${totals.closingSum.toFixed(2)} ₽ / ${totals.closingQty}. `
        + 'Файл разобран неверно — импортировать его нельзя.',
      );
    }
  } else {
    warnings.push('В файле нет строки «Итого» — проверить общую сумму не с чем.');
  }

  // Каждая группа должна равняться сумме своих прямых детей. Это не формальность:
  // именно на этой проверке видно, что разбор уехал на строку или что в файл
  // добавили колонку. В августовской выгрузке сошлись все 105 групп.
  const mismatches = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].isGroup) continue;
    let sum = 0;
    let qty = 0;
    for (let j = i + 1; j < lines.length && lines[j].level > lines[i].level; j++) {
      if (lines[j].level === lines[i].level + 1) {
        sum += lines[j].closingSum;
        qty += lines[j].closingQty;
      }
    }
    if (Math.abs(sum - lines[i].closingSum) > 0.05 || Math.abs(qty - lines[i].closingQty) > 0.005) {
      mismatches.push(lines[i].name);
    }
  }
  if (mismatches.length) {
    warnings.push(
      `Группы, где итог не равен сумме вложенных строк (${mismatches.length}): `
      + `${mismatches.slice(0, 5).join(', ')}${mismatches.length > 5 ? ' и другие' : ''}.`,
    );
  }

  return {
    header,
    lines,
    control,
    warnings,
    totals: {
      ...totals,
      lineCount: lines.length,
      groupCount: lines.filter(l => l.isGroup).length,
      leafCount: lines.filter(l => !l.isGroup).length,
    },
  };
}

/**
 * Сравнение двух снимков по ключу строки. Основной результат импорта: цифры сами
 * по себе мало что говорят, а «появилось 12 строк, пропало 3, у 40 изменилось
 * количество» — это и есть месячный отчёт о движении.
 *
 * Сравниваются только листья: расхождение в группе — это всегда следствие
 * расхождения в её строках, и показывать его вторым разом значит удваивать список.
 */
function diffSnapshots(previousLines, nextLines) {
  const before = new Map(previousLines.filter(l => !l.isGroup).map(l => [l.lineKey, l]));
  const after = new Map(nextLines.filter(l => !l.isGroup).map(l => [l.lineKey, l]));

  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, line] of after) {
    const old = before.get(key);
    if (!old) {
      added.push(line);
      continue;
    }
    const qtyDelta = Number(line.closingQty) - Number(old.closingQty);
    const sumDelta = Number(line.closingSum) - Number(old.closingSum);
    if (Math.abs(qtyDelta) > 0.0005 || Math.abs(sumDelta) > 0.005) {
      changed.push({ ...line, previousQty: Number(old.closingQty), previousSum: Number(old.closingSum), qtyDelta, sumDelta });
    }
  }
  for (const [key, line] of before) {
    if (!after.has(key)) removed.push(line);
  }

  return { added, removed, changed };
}

module.exports = { parseOsv, diffSnapshots, OsvParseError };
