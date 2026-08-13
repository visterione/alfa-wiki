const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx-js-style');

const { parseOsv, diffSnapshots, OsvParseError } = require('../services/warehouse/osv');

/**
 * Разбор ведомости 1С проверяется на синтетическом файле, а не на боевой
 * выгрузке: в настоящей лежат цены и полный перечень имущества сети, и место
 * такому файлу не в репозитории (см. правило про выгрузки в CLAUDE.md).
 *
 * Лист собирается ровно так же, как его отдаёт 1С: две строки на позицию («БУ» и
 * «Кол.»), название только в первой, дерево — уровнями группировки строк.
 */
function buildSheet({ rows, title, withTotal = true, totalOverride = null }) {
  const cells = [
    ['ООО «Тест»'],
    [title ?? 'Оборотно-сальдовая ведомость по счету МЦ.04 за Август 2026 г.'],
    [],
    ['Счет, Наименование счета', 'Показа-\nтели', 'Сальдо на начало периода', null,
      'Обороты за период', null, 'Сальдо на конец периода', null],
    ['Номенклатура', null, 'Дебет', 'Кредит', 'Дебет', 'Кредит', 'Дебет', 'Кредит'],
    [],
  ];
  const meta = cells.map(() => ({}));

  for (const row of rows) {
    const [openSum, openQty] = row.opening ?? [row.sum, row.qty];
    cells.push([row.name, 'БУ', openSum, null, row.debitSum ?? null, row.creditSum ?? null, row.sum, null]);
    cells.push([null, 'Кол.', openQty, null, row.debitQty ?? null, row.creditQty ?? null, row.qty, null]);
    meta.push({ level: row.level }, { level: row.level });
  }

  if (withTotal) {
    const total = totalOverride ?? rows
      .filter(r => r.level === 0)
      .reduce((acc, r) => ({ sum: acc.sum + r.sum, qty: acc.qty + r.qty }), { sum: 0, qty: 0 });
    cells.push(['Итого', 'БУ', null, null, null, null, total.sum, null]);
    cells.push([null, 'Кол.', null, null, null, null, total.qty, null]);
    meta.push({ level: 0 }, { level: 0 });
  }

  const sheet = XLSX.utils.aoa_to_sheet(cells);
  sheet['!rows'] = meta;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Лист_1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

/** Дерево из боевого файла в миниатюре, включая повтор названия с разной ценой. */
const SAMPLE = [
  { name: 'МЦ.04, Инвентарь и хозяйственные принадлежности', level: 0, sum: 20500, qty: 14 },
  { name: 'Материалы',            level: 1, sum: 15500, qty: 11 },
  { name: 'Кабинет Хирурга',      level: 2, sum: 12000, qty: 8 },
  { name: 'Шкаф медицинский',     level: 3, sum: 9000,  qty: 6 },
  { name: 'Стол процедурный',     level: 3, sum: 3000,  qty: 2 },
  { name: 'Канцтовары',           level: 2, sum: 3500,  qty: 3 },
  { name: 'Бумага А4/шт',         level: 3, sum: 3500,  qty: 3 },
  { name: 'Оргтехника',           level: 1, sum: 5000,  qty: 3 },
  // Одна номенклатура двумя строками с разной ценой — партии 1С. Ни название, ни
  // путь их не различают; на этой паре проверяется счётчик повторов.
  { name: 'Монитор 24"',          level: 2, sum: 3000,  qty: 2 },
  { name: 'Монитор 24"',          level: 2, sum: 2000,  qty: 1 },
];

test('разбирает шапку: организация, счёт и период', () => {
  const { header } = parseOsv(buildSheet({ rows: SAMPLE }));
  assert.equal(header.account, 'МЦ.04');
  assert.equal(header.periodYear, 2026);
  assert.equal(header.periodMonth, 8);
  assert.equal(header.organization, 'ООО «Тест»');
});

test('строит дерево по уровням группировки и различает группы и позиции', () => {
  const { lines, totals } = parseOsv(buildSheet({ rows: SAMPLE }));

  assert.equal(lines.length, SAMPLE.length, 'строка «Итого» в данные не попадает');
  assert.equal(totals.leafCount, 5);
  assert.equal(totals.groupCount, 5);

  const shelf = lines.find(l => l.name === 'Шкаф медицинский');
  assert.equal(shelf.isGroup, false);
  assert.equal(shelf.level, 3);
  assert.equal(shelf.pathText, 'Материалы / Кабинет Хирурга');
  assert.equal(shelf.unitCost, 1500);

  const room = lines.find(l => l.name === 'Кабинет Хирурга');
  assert.equal(room.isGroup, true);
});

test('итоги совпадают с корнем, обороты разделены на приход и расход', () => {
  // Оборот проставлен и позиции, и всем её родителям — 1С сворачивает обороты
  // вверх по дереву так же, как остатки, а итог отчёта берётся с корня.
  const turnover = { debitSum: 1000, debitQty: 1, creditSum: 250, creditQty: 1 };
  const onPath = new Set(['Стол процедурный', 'Кабинет Хирурга', 'Материалы']);
  const rows = SAMPLE.map((r, index) => (onPath.has(r.name) || index === 0 ? { ...r, ...turnover } : r));
  const { totals, lines } = parseOsv(buildSheet({ rows }));

  assert.equal(totals.closingSum, 20500);
  assert.equal(totals.closingQty, 14);
  assert.equal(totals.debitSum, 1000);
  assert.equal(totals.creditSum, 250);

  const line = lines.find(l => l.name === 'Стол процедурный');
  assert.equal(line.debitQty, 1);
  assert.equal(line.creditQty, 1);
});

test('повторяющееся название в одной группе не склеивается в одну строку', () => {
  const { lines } = parseOsv(buildSheet({ rows: SAMPLE }));
  const monitors = lines.filter(l => l.name === 'Монитор 24"');

  assert.equal(monitors.length, 2);
  assert.notEqual(monitors[0].lineKey, monitors[1].lineKey);
  assert.deepEqual(monitors.map(m => m.dupIndex), [0, 1]);
  assert.deepEqual(monitors.map(m => m.unitCost), [1500, 2000]);
});

test('ключ строки не зависит от порядкового номера строки в файле', () => {
  const base = parseOsv(buildSheet({ rows: SAMPLE }));
  // Между шапкой и данными 1С иногда вставляет пустую строку — ключи от этого
  // меняться не должны, иначе каждый месяц вся ведомость выглядела бы новой.
  const shifted = parseOsv(buildSheet({
    rows: [{ name: 'Прочее', level: 0, sum: 0, qty: 0 }, ...SAMPLE],
    totalOverride: { sum: 20500, qty: 14 },
  }));

  const keyOf = (result, name) => result.lines.find(l => l.name === name).lineKey;
  assert.equal(keyOf(base, 'Бумага А4/шт'), keyOf(shifted, 'Бумага А4/шт'));
});

test('расхождение с «Итого» останавливает импорт', () => {
  const buffer = buildSheet({ rows: SAMPLE, totalOverride: { sum: 999, qty: 3 } });
  assert.throws(() => parseOsv(buffer), (err) => {
    assert.ok(err instanceof OsvParseError);
    assert.match(err.message, /Итог файла не сходится/);
    return true;
  });
});

test('группа, не равная сумме своих строк, попадает в предупреждения', () => {
  const rows = SAMPLE.map(r => (r.name === 'Канцтовары' ? { ...r, sum: 4000 } : r));
  // Корень и «Материалы» подтянуты, чтобы «Итого» сошлось: проверяем именно
  // предупреждение о группе, а не остановку по итогу.
  const patched = rows.map(r => {
    if (r.name === 'Материалы') return { ...r, sum: 16000 };
    if (r.name.startsWith('МЦ.04')) return { ...r, sum: 21000 };
    return r;
  });
  const { warnings } = parseOsv(buildSheet({ rows: patched }));

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Канцтовары/);
});

test('файл не той формы отвергается с внятным текстом', () => {
  const buffer = buildSheet({ rows: SAMPLE, title: 'Анализ счета 41 за Август 2026 г.' });
  assert.throws(() => parseOsv(buffer), /не похоже на оборотно-сальдовую ведомость/i);
});

test('сравнение снимков видит появившееся, пропавшее и изменившееся', () => {
  const previous = parseOsv(buildSheet({ rows: SAMPLE })).lines;
  // Позиция списана целиком — вместе с ней уходит и её группа: пустых групп 1С
  // не выгружает.
  const nextRows = SAMPLE
    .filter(r => r.name !== 'Бумага А4/шт' && r.name !== 'Канцтовары')
    .map(r => (r.name === 'Шкаф медицинский' ? { ...r, sum: 12000, qty: 8 } : r))
    .concat([{ name: 'Кресло', level: 2, sum: 4000, qty: 1 }]);
  const next = parseOsv(buildSheet({ rows: nextRows, withTotal: false })).lines;

  const diff = diffSnapshots(previous, next);
  assert.deepEqual(diff.added.map(l => l.name), ['Кресло']);
  assert.deepEqual(diff.removed.map(l => l.name), ['Бумага А4/шт']);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].name, 'Шкаф медицинский');
  assert.equal(diff.changed[0].qtyDelta, 2);
  assert.equal(diff.changed[0].sumDelta, 3000);
});
