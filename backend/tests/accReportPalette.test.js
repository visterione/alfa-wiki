const test = require('node:test');
const assert = require('node:assert/strict');
const { accMedCenterMeta } = require('../services/pdfService');

// Справочник в том виде, в каком его отдаёт medCenters.list() (порядок = sortOrder).
const REGISTRY = [
  { name: 'Альфа',       code: 'alfa',         color: '#de64a1' },
  { name: 'Кидс',        code: 'kids',         color: '#ed9121' },
  { name: 'Проф',        code: 'prof',         color: '#9999ff' },
  { name: 'Линия',       code: 'liniya',       color: '#c7a878' },
  { name: '3К',          code: '3k',           color: '#800080' },
  { name: 'Смайл',       code: 'smile',        color: '#999999' },
  { name: 'Сукко',       code: 'sukko',        color: '#2d7055' },
  { name: 'ИП Микаелян', code: 'ip-mikaelyan', color: '#e05252' }
];

test('печатные цвета заголовков не изменились после переезда на справочник', () => {
  const meta = accMedCenterMeta(REGISTRY);
  // Значения до ver. 6.67 — константа ACC_MC_COLORS в pdfService.
  assert.equal(meta.color('Альфа'), '#be185d');
  assert.equal(meta.color('Кидс'), '#c2410c');
  assert.equal(meta.color('Проф'), '#6d28d9');
  assert.equal(meta.color('3К'), '#a21caf');
  assert.equal(meta.color('Смайл'), '#4b5563');
  assert.equal(meta.color('Линия'), '#92400e');
  assert.equal(meta.color('Сукко'), '#047857');
  assert.equal(meta.color('ИП Микаелян'), '#0369a1');
});

test('новой клинике цвет затемняется из фирменного, а не падает в серый', () => {
  const meta = accMedCenterMeta([...REGISTRY, { name: 'Новый', code: 'new-mc', color: '#ffffff' }]);
  assert.equal(meta.color('Новый'), '#8c8c8c'); // 255 * 0.55 = 140 = 0x8c
});

test('клиника без фирменного цвета получает тёмно-серый', () => {
  const meta = accMedCenterMeta([{ name: 'Без цвета', code: 'nc', color: null }]);
  assert.equal(meta.color('Без цвета'), '#1f2937');
});

test('порядок секций берётся из справочника', () => {
  const meta = accMedCenterMeta(REGISTRY);
  assert.ok(meta.rank('Альфа') < meta.rank('Кидс'));
  assert.ok(meta.rank('3К') < meta.rank('Смайл'), 'порядок теперь по sortOrder справочника');
});

test('неизвестный медцентр уезжает в конец, а не в начало', () => {
  const meta = accMedCenterMeta(REGISTRY);
  assert.ok(meta.rank('Чужой') > meta.rank('ИП Микаелян'));
});

test('пустой справочник не роняет отчёт', () => {
  const meta = accMedCenterMeta([]);
  assert.equal(meta.color('Альфа'), '#1f2937');
  assert.equal(meta.rank('Альфа'), 99);
});
