const test = require('node:test');
const assert = require('node:assert/strict');

const { searchWords, matchesSearch } = require('../services/warehouse/search');

/**
 * Поиск по названиям склада (ver. 7.49).
 *
 * Проверяется правило, из-за которого люди считали, что позиции пропадают:
 * поиск шёл подстрокой целиком, различал «ё» и «е» и трактовал «%» как шаблон.
 * Правило одно на сервер и на оба клиента, и разойтись им нельзя — иначе один и
 * тот же запрос даёт разные ответы на соседних вкладках.
 */

test('запрос дробится на слова, порядок не важен', () => {
  assert.ok(matchesSearch('системный блок', ['Блок системный HP ProDesk']));
  assert.ok(matchesSearch('блок системный', ['Блок системный HP ProDesk']));
  assert.ok(matchesSearch('компьютер hp', ['Компьютер HP ProDesk 400']));
});

test('каждое слово обязано найтись', () => {
  // Иначе поиск «компьютер lenovo» показывал бы все компьютеры сети, и человек
  // решил бы, что фильтр не работает вовсе.
  assert.ok(!matchesSearch('компьютер lenovo', ['Компьютер HP ProDesk 400']));
});

test('«ё» и «е» — одна буква', () => {
  assert.ok(matchesSearch('емкость', ['Ёмкость для дезинфекции 5 л']));
  assert.ok(matchesSearch('ёмкость', ['Емкость мерная 1 л']));
});

test('слово ищется в любом из полей строки', () => {
  assert.ok(matchesSearch('прodesk', ['Компьютер', 'ProDesk 400']) === false);
  assert.ok(matchesSearch('компьютер prodesk', ['Компьютер', 'ProDesk 400']));
});

test('шаблонные символы LIKE экранируются, а в памяти сравниваются буквально', () => {
  // «20%» — это двадцать процентов, а не «20 и что угодно после».
  assert.deepEqual(searchWords('20%'), ['20\\%']);
  assert.ok(matchesSearch('20%', ['Салфетка спиртовая 20%']));
  assert.ok(!matchesSearch('20%', ['Салфетка спиртовая 20 шт']));
});

test('короткие слова отбрасываются только когда есть длинные', () => {
  // «в» и «и» есть почти в каждом названии и поиск не сужают.
  assert.deepEqual(searchWords('шкаф в углу'), ['шкаф', 'углу']);
  // Но запрос целиком из коротких слов — это запрос, а не «показать всё»:
  // «3» это номер кабинета, «ПК» — то, как его называют.
  assert.deepEqual(searchWords('3'), ['3']);
  assert.ok(matchesSearch('3', ['Каб. 3']));
  assert.ok(!matchesSearch('3', ['Каб. 12']));
});

test('пустой запрос ничего не отсеивает', () => {
  assert.ok(matchesSearch('', ['что угодно']));
  assert.ok(matchesSearch('   ', ['что угодно']));
  assert.deepEqual(searchWords(''), []);
});
