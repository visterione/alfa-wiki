const test = require('node:test');
const assert = require('node:assert/strict');

const codes = require('../services/tasks/codes');

/**
 * Коды задач: подбор ключа проекта и сборка кода.
 *
 * Проверяется ровно то, из-за чего коды перестают быть кодами: два проекта с
 * одинаковым сокращением, ключ короче двух букв, мусор во введённом руками
 * значении. Выдача номера здесь не проверяется — она живёт в одном SQL-операторе
 * и без базы смысла не имеет.
 */

test('ключ — это сокращение названия, а не инициалы', () => {
  // РЕМ узнаётся в разговоре, РМ приходится расшифровывать.
  assert.equal(codes.suggestKey('Ремонт МЦ-04'), 'РЕМ');
  assert.equal(codes.suggestKey('Закупки и склад'), 'ЗАК');
  // Первого слова не хватило — добираем из следующего.
  assert.equal(codes.suggestKey('Он боарды'), 'ОНБ');
  // Название короче трёх знаков остаётся собой, а не дополняется мусором.
  assert.equal(codes.suggestKey('IT'), 'IT');
});

test('совпавшие сокращения разводятся длиной, и только потом цифрой', () => {
  assert.equal(codes.uniqueKey('Обслуживание', ['ОБС']), 'ОБСЛ');
  assert.equal(codes.uniqueKey('Обследования', ['ОБС', 'ОБСЛ']), 'ОБСЛЕ');
  // Удлинять нечем — название кончилось.
  assert.equal(codes.uniqueKey('IT', ['IT']), 'IT2');
  // Занятость не зависит от регистра: «рем» и «РЕМ» — один префикс.
  assert.notEqual(codes.uniqueKey('Ремонт', ['рем']), 'РЕМ');
});

test('введённый руками ключ чистится, а негодный отклоняется', () => {
  assert.equal(codes.normalizeKey('рем-04'), 'РЕМ04');
  assert.equal(codes.normalizeKey('  a b  '), 'AB');
  assert.equal(codes.normalizeKey('!!!'), '');

  assert.ok(codes.isValidKey('РЕМ'));
  assert.ok(!codes.isValidKey('Р'), 'одна буква — не ключ');
  assert.ok(!codes.isValidKey('рем'), 'ключ хранится в верхнем регистре');
  assert.ok(!codes.isValidKey('РЕМОНТ7'), 'длиннее шести знаков');
});

test('код части — номер внутри задачи, с единицы', () => {
  assert.equal(codes.partCode('РЕМ-42', 0), 'РЕМ-42/1');
  assert.equal(codes.partCode('РЕМ-42', 2), 'РЕМ-42/3');
  // Задача без кода (создана до миграции) не должна давать «undefined/1».
  assert.equal(codes.partCode(null, 0), '');
});
