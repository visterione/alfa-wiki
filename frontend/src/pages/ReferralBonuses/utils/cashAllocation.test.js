import { allocateCashByRow, sumCash } from './cashAllocation';

// Случай из отчёта заказчика: у Князевой три медцентра в одной записи и одна
// выдача из кассы. До ver. 8.18 сводка печатала эту выдачу и общий остаток в
// строке каждого медцентра.
const clinicReports = [
  { clinicId: '5', clinicLabel: 'Проф' },
  { clinicId: '2', clinicLabel: 'Альфа' },
  { clinicId: '4', clinicLabel: 'Сукко' },
];
const rec = { id: 'rec-1', reportData: { clinicReports } };
const rows = clinicReports.map((cr, i) => ({ key: `rec-1_${i}`, rec, cr }));

function payment(id, amount, clinicId) {
  return { id, amount, clinicId };
}

test('выдача с медцентром попадает только в его строку', () => {
  const map = allocateCashByRow(rows, { 'rec-1': [payment('p1', 33325, '2')] });

  expect(sumCash(map.get('rec-1_0').assigned)).toBe(0);
  expect(sumCash(map.get('rec-1_1').assigned)).toBe(33325);
  expect(sumCash(map.get('rec-1_2').assigned)).toBe(0);
  rows.forEach(r => expect(map.get(r.key).unassigned).toHaveLength(0));
});

test('выдача без медцентра показывается один раз, а не в каждой строке', () => {
  const map = allocateCashByRow(rows, { 'rec-1': [payment('p1', 33325, null)] });

  expect(sumCash(map.get('rec-1_0').unassigned)).toBe(33325);
  expect(sumCash(map.get('rec-1_1').unassigned)).toBe(0);
  expect(sumCash(map.get('rec-1_2').unassigned)).toBe(0);
  rows.forEach(r => expect(map.get(r.key).assigned).toHaveLength(0));
});

test('выдача отфильтрованного медцентра не оседает на чужой строке', () => {
  const visible = [rows[0]]; // в выборке остался только «Проф»
  const map = allocateCashByRow(visible, { 'rec-1': [payment('p1', 33325, '2')] });

  expect(map.get('rec-1_0').assigned).toHaveLength(0);
  expect(map.get('rec-1_0').unassigned).toHaveLength(0);
});

test('несколько выдач по одному медцентру складываются в его строке', () => {
  const map = allocateCashByRow(rows, {
    'rec-1': [payment('p1', 1000, '4'), payment('p2', 500, '4'), payment('p3', 200, null)],
  });

  expect(sumCash(map.get('rec-1_2').assigned)).toBe(1500);
  expect(sumCash(map.get('rec-1_0').unassigned)).toBe(200);
});

test('выдача с медцентром, которого нет в записи, не теряется', () => {
  const map = allocateCashByRow(rows, { 'rec-1': [payment('p1', 700, '99')] });

  expect(sumCash(map.get('rec-1_0').unassigned)).toBe(700);
});
