const test = require('node:test');
const assert = require('node:assert/strict');

const {
  headWord, normalize, compileRules, classify, headStats,
} = require('../services/warehouse/itemRules');
const { effectiveKind, decisionOf, reviewGroups } = require('../services/warehouse/osvMaterialize');

/**
 * Словарь предметов (ver. 6.79).
 *
 * Названия в тестах взяты из настоящей августовской выгрузки — но только сами
 * названия, без цен и остатков: проверять разбор на выдуманных строках вроде
 * «Товар 1» бессмысленно, а класть выгрузку в репозиторий нельзя (см. правило
 * про дампы в CLAUDE.md).
 *
 * Проверяется не «функция что-то вернула», а конкретные утверждения, ради
 * которых словарь и появился: цена не отвечает на вопрос «что это», решение
 * человека сильнее словаря, а при пустом словаре разбор ведёт себя ровно так
 * же, как до его появления.
 */

test('ведущее слово: регистр, ё и неразрывные пробелы не различаются', () => {
  assert.equal(headWord('Шкаф для одежды 2100*1000*450'), 'шкаф');
  assert.equal(headWord('ШКАФ коммутационный ЦМО'), 'шкаф');
  assert.equal(headWord('Ёмкость-контейнер для дезинфекции'), 'емкость-контейнер');
  assert.equal(normalize('Стол рабочий'), 'стол рабочий');
});

test('ведущее слово: дефис внутри слова часть типа, кавычки в начале — нет', () => {
  // Без дефиса «сплит-система» превратилась бы в «сплит», а «IP-телефон» — в
  // бессмысленное «ip», и оба слились бы с чужими классами вещей.
  assert.equal(headWord('Сплит-система ECOSTAR KVS-IF 18HT'), 'сплит-система');
  assert.equal(headWord('IP-телефон Grandstream GXP-1620'), 'ip-телефон');
  assert.equal(headWord('«Клер»-КГЭМ кресло'), 'клер');
  assert.equal(headWord('"САД-М-МИЗ" стетоскоп'), 'сад-м-миз');
  assert.equal(headWord(''), '');
  assert.equal(headWord(null), '');
});

test('порядок правил: выражение сильнее ведущего слова', () => {
  // Ради этого regex и пишут: общее правило «электрод — карточка» ошибается на
  // одноразовых. Если бы ведущее слово перекрывало выражение, задать исключение
  // было бы нечем.
  const { compiled } = compileRules([
    { id: 'head', pattern: 'электрод', matchType: 'head', accounting: 'asset' },
    { id: 'exception', pattern: 'электрод.*одноразов', matchType: 'regex', accounting: 'material' },
  ]);

  assert.equal(classify('Электрод с прямым стержнем', compiled).id, 'head');
  assert.equal(classify('Электрод одноразовый ЭКГ', compiled).id, 'exception');
});

test('порядок правил: внутри одного вида выигрывает более длинное выражение', () => {
  const { compiled } = compileRules([
    { id: 'short', pattern: 'шкаф', matchType: 'head', accounting: 'asset' },
    { id: 'long', pattern: 'шкаф-купе', matchType: 'head', accounting: 'material' },
  ]);

  assert.equal(classify('Шкаф для документов ШК.13.07', compiled).id, 'short');
  assert.equal(classify('Шкаф-купе 2000*600', compiled).id, 'long');
});

test('сломанное выражение выключает правило, а не разбор', () => {
  const { compiled, broken } = compileRules([
    { id: 'bad', pattern: 'щипцы(', matchType: 'regex', accounting: 'asset' },
    { id: 'good', pattern: 'щипцы', matchType: 'head', accounting: 'material' },
  ]);

  assert.equal(broken.length, 1);
  assert.equal(broken[0].id, 'bad');
  // Одна опечатка не должна делать недоступной всю ведомость.
  assert.equal(compiled.length, 1);
  assert.equal(classify('Щипцы прямые (тип Блэксли)', compiled).id, 'good');
});

test('выключенное правило не участвует', () => {
  const { compiled } = compileRules([
    { id: 'off', pattern: 'стол', matchType: 'head', accounting: 'asset', isActive: false },
  ]);
  assert.equal(compiled.length, 0);
  assert.equal(classify('Стол рабочий 1500х600х750', compiled), null);
});

test('ведущие слова снимка: покрытие и порядок по числу строк', () => {
  const lines = [
    { name: 'Шкаф для одежды', closingQty: 37, closingSum: 437_007 },
    { name: 'Шкаф с комодами', closingQty: 1, closingSum: 65_400 },
    { name: 'Шкаф коммутационный ЦМО', closingQty: 2, closingSum: 30_220 },
    { name: 'Ножницы глазные остроконечные', closingQty: 12, closingSum: 6264 },
    { name: 'Одеяло 145*210', closingQty: 15, closingSum: 20_250 },
  ];
  const { compiled } = compileRules([
    { id: 'r1', pattern: 'шкаф', matchType: 'head', accounting: 'asset' },
  ]);

  const stats = headStats(lines, compiled);

  // Сортировка по числу строк — это и есть смысл экрана разметки: сверху то,
  // что закрывает больше всего работы одним решением. При равном числе строк
  // выше стоит дороже: одеяло на 20 250 ₽ важнее ножниц на 6264 ₽.
  assert.deepEqual(stats.map(s => s.head), ['шкаф', 'одеяло', 'ножницы']);

  const shkaf = stats[0];
  assert.equal(shkaf.lines, 3);
  assert.equal(shkaf.covered, 3);
  assert.equal(shkaf.units, 40);
  assert.equal(shkaf.sum, 532_627);
  assert.equal(shkaf.rules[0].count, 3);
  assert.equal(shkaf.samples.length, 3);

  // Неразмеченные слова видно сразу: covered = 0 при lines > 0.
  assert.equal(stats[1].covered, 0);
  assert.equal(stats[1].rules.length, 0);
});

// ── Цепочка решений: правило по строке → словарь ─────────────────────────────

const branch = (over = {}) => ({ kind: 'auto', ...over });

test('словарь работает без всякого сопоставления', () => {
  // Ради этого и затевалось ver. 7.14. До него первой строкой effectiveKind
  // стояло `if (!mapping) return 'unmapped'`, и чтобы словарь спросили, человеку
  // приходилось сначала завести сопоставление — а завести его можно было только
  // выбрав ветке кабинет. Вопрос о месте запирал ответ на вопрос о способе учёта.
  const rule = { accounting: 'asset' };
  assert.equal(effectiveKind({ unitCost: 90_000, closingQty: 1 }, null, rule), 'asset');
  assert.equal(effectiveKind({ unitCost: 90_000, closingQty: 1 }, undefined, rule), 'asset');
});

test('решение человека сильнее словаря', () => {
  // Словарь — правило по умолчанию для класса вещей, а не начальство над тем,
  // кто смотрит на конкретную позицию.
  const rule = { accounting: 'material' };
  const line = { unitCost: 522, closingQty: 12 };
  assert.equal(effectiveKind(line, branch({ kind: 'asset' }), rule), 'asset');
  assert.equal(effectiveKind(line, branch({ kind: 'ignore' }), rule), 'ignore');
});

test('словарь решает там, где цена ответить не может', () => {
  // Ножницы за 522 ₽ и одеяло за 1350 ₽ по цене неразличимы — обе дешевле
  // порога и обе стали бы остатком. Инструмент при этом инвентаризируется, а
  // мягкий инвентарь списывается.
  const nozhnicy = { unitCost: 522, closingQty: 12 };
  const odeyalo = { unitCost: 1350, closingQty: 15 };

  assert.equal(effectiveKind(nozhnicy, branch(), { accounting: 'asset' }), 'asset');
  assert.equal(effectiveKind(odeyalo, branch(), { accounting: 'material' }), 'material');
  assert.equal(effectiveKind(nozhnicy, branch(), { accounting: 'ignore' }), 'ignore');
});

test('дробное количество остаётся материалом вопреки словарю', () => {
  // 2,02 метра портьеры — инвентарный номер на них не выдаётся ни при какой
  // цене и ни по какому правилу.
  const line = { unitCost: 50_000, closingQty: 2.02 };
  assert.equal(effectiveKind(line, branch(), { accounting: 'asset' }), 'material');
});

test('словарь без способа учёта не угадывает решение', () => {
  const line = { unitCost: 12_000, closingQty: 1 };
  assert.equal(effectiveKind(line, branch(), { accounting: 'auto' }), 'unmapped');
});

test('пустой словарь оставляет строку неразобранной независимо от цены', () => {
  assert.equal(effectiveKind({ unitCost: 100, closingQty: 3 }, branch(), null), 'unmapped');
  assert.equal(effectiveKind({ unitCost: 1_000_000, closingQty: 3 }, branch()), 'unmapped');
  assert.equal(effectiveKind({ unitCost: 1_000_000, closingQty: 3 }, null, null), 'unmapped');
});

// ── Экран проверки: причина решения ──────────────────────────────────────────

/** Строка плана в том виде, в каком её собирает planMaterialization. */
const planItem = (over = {}) => ({
  line: { lineKey: 'k1', name: 'Стул', closingQty: 3, closingSum: 3000, ...over.line },
  mapping: null, scope: null, rule: null, categoryId: null,
  placedQty: 0, unplacedQty: 3,
  ...over,
  kind: over.kind || effectiveKind(
    { closingQty: 3, ...over.line }, over.mapping || null, over.rule || null,
  ),
});

test('причина решения совпадает с самим решением', () => {
  // decisionOf зеркалит effectiveKind, и разойтись им нельзя: экран проверки
  // показывал бы не ту причину, по которой строка поедет в объекты.
  const byRule = planItem({ rule: { id: 'r1', accounting: 'asset', pattern: 'стул' } });
  assert.equal(byRule.kind, 'asset');
  assert.equal(decisionOf(byRule).key, 'rule:r1');

  const manual = planItem({ mapping: { id: 'm1', kind: 'material' }, scope: 'line' });
  assert.equal(manual.kind, 'material');
  assert.equal(decisionOf(manual).source, 'line');

  const unknown = planItem({});
  assert.equal(unknown.kind, 'unmapped');
  assert.equal(decisionOf(unknown).source, 'none');
});

test('дробное количество показывается своей причиной, а не правилом словаря', () => {
  // Правило сказало «карточкой», но 2,02 метра портьеры поедут остатком.
  // Приписать эту строку правилу значило бы назвать причиной то, что как раз
  // не сработало.
  const item = planItem({
    line: { lineKey: 'k2', name: 'Портьера', closingQty: 2.02, closingSum: 5000 },
    rule: { id: 'r2', accounting: 'asset', pattern: 'портьера' },
  });
  assert.equal(item.kind, 'material');
  assert.equal(decisionOf(item).source, 'fraction');
});

test('неразобранное стоит первым, остальное — по убыванию суммы', () => {
  // Прогон необратим: первым в глаза должно попадать то, что требует действия,
  // а дальше — дорогое.
  const groups = reviewGroups([
    planItem({ line: { lineKey: 'a', name: 'Стол', closingQty: 1, closingSum: 500_000 },
      rule: { id: 'r1', accounting: 'asset', pattern: 'стол' } }),
    planItem({ line: { lineKey: 'b', name: 'Нечто', closingQty: 1, closingSum: 10 } }),
    planItem({ line: { lineKey: 'c', name: 'Салфетка', closingQty: 1, closingSum: 900 },
      rule: { id: 'r3', accounting: 'material', pattern: 'салфетка' } }),
  ]);

  assert.deepEqual(groups.map(g => g.source), ['none', 'rule', 'rule']);
  assert.equal(groups[1].pattern, 'стол');
  assert.equal(groups[1].sum, 500_000);
  assert.equal(groups[2].pattern, 'салфетка');
  assert.equal(groups.every(g => !g.mixedKind), true);
});
