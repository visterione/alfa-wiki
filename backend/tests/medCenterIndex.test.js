const test = require('node:test');
const assert = require('node:assert/strict');
const idx = require('../utils/medCenterIndex');

const mc = (name, code, misClinicIds, extra = {}) =>
  ({ id: `id-${code}`, name, code, misClinicIds, color: '#111111', isVirtual: false, isActive: true, ...extra });

const ROWS = [
  mc('Альфа', 'alfa', ['2'], { color: '#de64a1' }),
  mc('Кидс', 'kids', ['3'], { color: '#ed9121' }),
  // У Сукко исторически два id в МИС — 12 это тот же филиал.
  mc('Сукко', 'sukko', ['11', '12'], { color: '#2d7055' }),
  mc('ИП Микаелян', 'ip-mikaelyan', ['ip'], { color: '#e05252' }),
  mc('Направители', 'referrers', ['8'], { color: '#00bfff', isVirtual: true }),
  mc('Старый', 'old', ['99'], { isActive: false })
];

const index = idx.buildIndex(ROWS);

test('клиника находится по id из МИС', () => {
  assert.equal(idx.byMisId(index, '2').name, 'Альфа');
  assert.equal(idx.byMisId(index, 2).name, 'Альфа');
});

test('второй исторический id ведёт на ту же клинику', () => {
  assert.equal(idx.byMisId(index, '12').name, 'Сукко');
  assert.equal(idx.byMisId(index, '11').name, 'Сукко');
});

test('канонический id — первый в списке', () => {
  assert.equal(idx.canonicalMisId(index, '12'), '11');
  assert.equal(idx.canonicalMisId(index, '11'), '11');
});

test('клиника из МИС приходит и объектом, и голым id', () => {
  assert.equal(idx.byMisId(index, { id: 3, name: 'Альфа Kids' }).name, 'Кидс');
});

test('псевдо-id портала работает наравне с числовыми', () => {
  assert.equal(idx.byMisId(index, 'ip').name, 'ИП Микаелян');
});

test('пустой ввод не находит клинику и не падает', () => {
  for (const empty of [null, undefined, '', {}, { id: null }]) {
    assert.equal(idx.byMisId(index, empty), null);
  }
});

test('у неизвестной клиники серый цвет и собственный id вместо названия', () => {
  assert.equal(idx.colorByMisId(index, '777'), idx.FALLBACK_COLOR);
  assert.equal(idx.nameByMisId(index, '777'), '777');
  assert.equal(idx.nameByMisId(index, null), '');
});

test('цвет берётся из справочника', () => {
  assert.equal(idx.colorByMisId(index, '2'), '#de64a1');
  assert.equal(idx.colorByMisId(index, '12'), '#2d7055');
});

test('поиск по коду и названию, название без учёта регистра и пробелов', () => {
  assert.equal(idx.byCode(index, 'kids').name, 'Кидс');
  assert.equal(idx.byName(index, '  АЛЬФА ').name, 'Альфа');
  assert.equal(idx.byName(index, 'нет такой'), null);
});

test('по умолчанию список без служебных и без закрытых', () => {
  const names = idx.filterRows(ROWS).map(r => r.name);
  assert.deepEqual(names, ['Альфа', 'Кидс', 'Сукко', 'ИП Микаелян']);
});

test('служебные и закрытые добавляются флагами', () => {
  assert.ok(idx.filterRows(ROWS, { includeVirtual: true }).some(r => r.name === 'Направители'));
  assert.ok(idx.filterRows(ROWS, { includeInactive: true }).some(r => r.name === 'Старый'));
  assert.equal(idx.filterRows(ROWS, { includeVirtual: true, includeInactive: true }).length, ROWS.length);
});

test('пустой справочник не ломает резолверы', () => {
  const empty = idx.buildIndex([]);
  assert.equal(idx.byMisId(empty, '2'), null);
  assert.equal(idx.colorByMisId(empty, '2'), idx.FALLBACK_COLOR);
  assert.deepEqual(idx.filterRows([]), []);
});
