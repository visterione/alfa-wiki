const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQuery, parseDate, parseSize, tokenize, hasAnything } = require('../services/mail/search');

test('обычные слова остаются словами', () => {
  const q = parseQuery('гарантийное письмо Иванов');
  assert.deepEqual(q.terms, ['гарантийное', 'письмо', 'Иванов']);
  assert.deepEqual(q.phrases, []);
});

test('кавычки дают фразу, а не набор слов', () => {
  const q = parseQuery('"акт сверки" договор');
  assert.deepEqual(q.phrases, ['акт сверки']);
  assert.deepEqual(q.terms, ['договор']);
});

test('приставки понимают русские имена', () => {
  // Человек повторит то, что ему показали. Показывать будем по-русски.
  const q = parseQuery('тема:договор от:иванов кому:info@alfa.ru');
  assert.deepEqual(q.subject, ['договор']);
  assert.deepEqual(q.from, ['иванов']);
  assert.deepEqual(q.to, ['info@alfa.ru']);
  assert.deepEqual(q.terms, []);
});

test('английские приставки работают наравне', () => {
  const q = parseQuery('subject:счёт from:buh@x.ru');
  assert.deepEqual(q.subject, ['счёт']);
  assert.deepEqual(q.from, ['buh@x.ru']);
});

test('значение приставки можно взять в кавычки', () => {
  const q = parseQuery('тема:"акт сверки" претензия');
  assert.deepEqual(q.subject, ['акт сверки']);
  assert.deepEqual(q.terms, ['претензия']);
});

test('есть:вложение и статус:непрочитанное', () => {
  const q = parseQuery('есть:вложение статус:непрочитанное');
  assert.deepEqual(q.has, ['attachment']);
  assert.deepEqual(q.is, ['unread']);
});

test('незнакомая приставка становится обычным словом', () => {
  // Поиск, который отвечает «вы неправильно написали» вместо результатов,
  // люди обходят стороной.
  const q = parseQuery('выдумка:значение договор');
  assert.deepEqual(q.terms, ['выдумка:значение', 'договор']);
});

test('двоеточие внутри слова не ломает разбор', () => {
  const q = parseQuery('http://example.com/файл');
  assert.equal(q.terms.length, 1);
  assert.match(q.terms[0], /example\.com/);
});

test('даты принимаются в привычном виде', () => {
  assert.equal(parseDate('2024-03-15').getFullYear(), 2024);
  assert.equal(parseDate('2024-03-15').getMonth(), 2);
  assert.equal(parseDate('15.03.2024').getDate(), 15);
  assert.equal(parseDate('15.03.2024').getMonth(), 2);
});

test('даты словами: человек не считает, какое вчера было число', () => {
  const today = parseDate('сегодня');
  const yesterday = parseDate('вчера');
  assert.ok(today > yesterday);
  assert.equal(Math.round((today - yesterday) / 86400000), 1);
  assert.ok(parseDate('неделя') < yesterday);
});

test('битая дата отбрасывается и не становится словом', () => {
  const q = parseQuery('после:позавчера договор');
  assert.equal(q.after, null);
  assert.deepEqual(q.terms, ['договор'], 'дата не должна превратиться в поисковое слово');
});

test('диапазон дат разбирается целиком', () => {
  const q = parseQuery('после:01.01.2024 до:2024-12-31 претензия');
  assert.equal(q.after.getFullYear(), 2024);
  assert.equal(q.before.getMonth(), 11);
  assert.deepEqual(q.terms, ['претензия']);
});

test('разбивка на слова не рвёт кавычки', () => {
  const tokens = tokenize('слово "две части" ещё');
  assert.equal(tokens.length, 3);
  assert.equal(tokens[1].value, 'две части');
  assert.equal(tokens[1].quoted, true);
});

test('пустой запрос ничего не ищет', () => {
  assert.equal(hasAnything(parseQuery('')), false);
  assert.equal(hasAnything(parseQuery('   ')), false);
  assert.equal(hasAnything(parseQuery(null)), false);
});

test('один только фильтр — это уже запрос', () => {
  // «Покажи всё с вложениями за последний месяц» — законный запрос без слов.
  assert.equal(hasAnything(parseQuery('есть:вложение')), true);
  assert.equal(hasAnything(parseQuery('после:месяц')), true);
});

test('фильтр размера понимает байты, КБ и МБ', () => {
  assert.equal(parseSize('512'), 512);
  assert.equal(parseSize('1,5мб'), 1572864);
  const q = parseQuery('больше:2мб меньше:10MB');
  assert.equal(q.larger, 2 * 1024 * 1024);
  assert.equal(q.smaller, 10 * 1024 * 1024);
});

test('расширенные отрицательные статусы разбираются как фильтры', () => {
  const q = parseQuery('статус:неотвеченное статус:безфлажка');
  assert.deepEqual(q.is, ['unanswered', 'unflagged']);
  assert.equal(hasAnything(q), true);
});

test('несколько уточнений одного вида складываются', () => {
  const q = parseQuery('от:иванов от:петров');
  assert.deepEqual(q.from, ['иванов', 'петров']);
});
