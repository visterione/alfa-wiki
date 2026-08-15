const test = require('node:test');
const assert = require('node:assert/strict');

const { splitName } = require('../services/warehouse/nameParts');

/**
 * Разбор названия на модель, производителя и габариты (ver. 6.80).
 *
 * Все названия здесь — настоящие, из августовской выгрузки, но только названия:
 * ни цен, ни остатков, ни полного перечня (см. правило про дампы в CLAUDE.md).
 * Проверять эвристику на выдуманных «Прибор ABC-123» бессмысленно — она ровно за
 * тем и написана, чтобы справляться с тем, как пишет 1С.
 *
 * Отдельно проверяется, чего разбор делать НЕ должен: измерения не модель,
 * наименование не переписывается, спорное лучше пропустить, чем угадать.
 */

test('модель и производитель у техники', () => {
  const cases = [
    ['МФУ Pantum M6700DW лазерный', 'M6700DW', 'Pantum'],
    ['Роутер MIKROTIK RB1100AHX4, серый', 'RB1100AHX4', 'MIKROTIK'],
    ['Телевизор Digma DM-LED43MR11, 43", FULL HD черный', 'DM-LED43MR11', 'Digma'],
    ['Центрифуга лабораторная медицинская настольная Armed LC-04А', 'LC-04А', 'Armed'],
  ];
  for (const [name, model, manufacturer] of cases) {
    const parts = splitName(name);
    assert.equal(parts.model, model, name);
    assert.equal(parts.manufacturer, manufacturer, name);
  }
});

test('производитель берётся через продуктовую линейку, а не ближайшим словом', () => {
  // Между брендом и моделью почти всегда стоит линейка: ближайшее слово дало бы
  // «Veriton» вместо Acer, «Ecosys» вместо Kyocera, «Aquilon» вместо DEXP.
  assert.equal(splitName('Компьютер Неттоп ACER Veriton VN4640G, Intel Core i3').manufacturer, 'ACER');
  assert.equal(splitName('Принтер лазерный KYOCERA Ecosys P2040DN, черный').manufacturer, 'KYOCERA');
  assert.equal(splitName('ПК DEXP Aquilon O292 Core i3-10100/8GB').manufacturer, 'DEXP');
});

test('кириллические обозначения — тоже модель', () => {
  assert.equal(splitName('Аппарат озонотерапии АОТ-Н-01-Арз-01/1').model, 'АОТ-Н-01-Арз-01/1');
  assert.equal(splitName('Столик манипуляционный СММП-08').model, 'СММП-08');
  assert.equal(splitName('Холодильник фармацевтический ХФ-250-2 "ПОЗИС"').model, 'ХФ-250-2');
});

test('измерение моделью не становится', () => {
  // Самая дорогая ошибка этого разбора: в поле «модель» попадает диагональ,
  // объём диска или диаметр, и замечают это через год, когда по модели пробуют
  // искать запчасть.
  const notModels = [
    'Ножницы глазные остроконечн.прямые 113 мм',
    'Пинцет анатомический 130мм/шт',
    'Стол рабочий 1500*700*750 с 3-мя ящиками ЛДСП белый',
    'Пинцет байонетный с антипригар. св-ми D=230мм площадка 6х0,7мм',
    'Одеяло 145*210',
  ];
  for (const name of notModels) {
    assert.equal(splitName(name).model, null, name);
  }
});

test('габариты выносятся отдельно и убираются из наименования', () => {
  const parts = splitName('Шкаф с комодами 2000*500*2200 ЛДСП 16мм');
  assert.equal(parts.dimensions, '2000*500*2200');
  assert.equal(parts.model, null);
  assert.ok(!parts.name.includes('2000'), 'габариты остались в наименовании');
  assert.ok(parts.name.startsWith('Шкаф с комодами'));

  // Русское «х» и латинское «x» приводятся к одному знаку — иначе одни и те же
  // габариты в отчёте выглядели бы разными строками.
  assert.equal(splitName('Столик процедурный СП-01-2С, 665х385х800мм').dimensions, '665×385×800мм');
});

test('скобки уходят в примечание, а не в наименование', () => {
  const parts = splitName('Запечатывающее устройство SEAL 120 (упаковочная машина)');
  assert.equal(parts.extras, 'упаковочная машина');
  assert.ok(!parts.name.includes('('), 'скобка осталась в наименовании');
});

test('служебные обрывки 1С не попадают в модель', () => {
  assert.equal(splitName('Конхотом со щелевидным отверст.№1, 4мм').model, null);
  assert.equal(splitName('Стол производственный с бортом СПБ (пс)-7-6 (н)').model, null);
  // «арт.» — служебный префикс, в поле должно попасть само обозначение.
  assert.equal(splitName('Троакар, диаметр 6мм, арт.30120TQ').model, '30120TQ');
});

test('исходное название не переписывается', () => {
  // По названию сходится сверка с бухгалтерией. Разбор возвращает очищенный
  // вариант отдельным полем, но вызывающий код обязан иметь возможность оставить
  // наименование как есть — здесь проверяется, что исходник не мутируется.
  const source = 'Монитор Dahua DHI-LM24-B201E';
  const parts = splitName(source);
  assert.equal(source, 'Монитор Dahua DHI-LM24-B201E');
  assert.equal(parts.model, 'DHI-LM24-B201E');
  assert.deepEqual(parts.found.sort(), ['manufacturer', 'model']);
});

test('пустое и мусорное не роняют разбор', () => {
  for (const value of ['', null, undefined, '   ', '???']) {
    const parts = splitName(value);
    assert.equal(parts.model, null);
    assert.equal(parts.manufacturer, null);
  }
});
