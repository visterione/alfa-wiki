const test = require('node:test');
const assert = require('node:assert/strict');
const { textSimilarity, pickCounterpart } = require('../services/reviewCollector/match');

// Тексты — из разведки кабинетов в сентябре 2026, в том виде, в каком их
// отдают площадки и в каком их сохранял GetLoyalty.
const PD_PLUS = 'Внимательное отношение, доступность объяснения, максимально внимательный осмотр. Рекомендую однозначно!';
const PD_COMMENT = 'Обратилась к доктору с дискомфортом в брюшной области, больше даже для профилактического осмотра. Выбрала случайно, не пожалела. Осмотр максимально подробный, доступно все пояснил.';

function card(fields) {
  return { reviewDate: '2026-09-24', rating: 5, doctorName: null, externalUrl: null, ...fields };
}

test('текст ПроДокторов из трёх частей находит карточку GetLoyalty с одной частью', () => {
  const incoming = { date: '2026-09-24', rating: 5, text: `${PD_PLUS}\nНе выявлено.\n${PD_COMMENT}` };
  const gl = card({ id: 'gl', reviewText: PD_COMMENT });
  assert.equal(pickCounterpart(incoming, [gl]), gl);
});

test('вырезанный GetLoyalty врач в начале текста не мешает', () => {
  const full = 'Кузин Александр Сергеевич - замечательный доктор! Спасибо Вам огромное за мои красивые ножки. У меня варикоз, наследственный.';
  const cleaned = 'замечательный доктор! Спасибо Вам огромное за мои красивые ножки. У меня варикоз, наследственный.';
  assert.ok(textSimilarity(full, cleaned) >= 0.9);
});

test('разные короткие благодарности не склеиваются', () => {
  const incoming = { date: '2026-09-24', rating: 5, text: 'Спасибо!' };
  const gl = card({ reviewText: 'Спасибо большое!' });
  assert.equal(pickCounterpart(incoming, [gl]), null);
});

test('разные отзывы одного дня не склеиваются', () => {
  const incoming = { date: '2026-09-24', rating: 5, text: 'Врач провела осмотр, получила анамнез, по итогу сдали анализы на аллергены.' };
  const gl = card({ reviewText: 'Врач сделала УЗИ, нашла воспаленную кисту, взяла пункцию. В клинике чистота, вежливость.' });
  assert.equal(pickCounterpart(incoming, [gl]), null);
});

test('даты дальше окна в три дня не сопоставляются', () => {
  const incoming = { date: '2026-09-24', rating: 5, text: PD_COMMENT };
  const gl = card({ reviewDate: '2026-09-18', reviewText: PD_COMMENT });
  assert.equal(pickCounterpart(incoming, [gl]), null);
});

test('разница оценок больше единицы — другой отзыв', () => {
  const incoming = { date: '2026-09-24', rating: 1, text: PD_COMMENT };
  const gl = card({ rating: 5, reviewText: PD_COMMENT });
  assert.equal(pickCounterpart(incoming, [gl]), null);
});

test('номер ПроДокторов в ссылке GetLoyalty даёт точное совпадение', () => {
  const incoming = { date: '2026-09-24', text: 'совсем другой текст', urlFragment: '/rate/7563417/' };
  const gl = card({ reviewText: PD_COMMENT, externalUrl: 'https://prodoctorov.ru/cabinet/lpu-rates/rate/7563417/?lpu=23159' });
  assert.equal(pickCounterpart(incoming, [gl]), gl);
});

test('отзыв без текста сопоставляется, только если пара единственная', () => {
  const incoming = { date: '2026-09-24', text: '', doctor: 'Макаров Константин Анатольевич' };
  const one = card({ reviewText: '(текст отсутствует)', doctorName: 'Макаров К. А.' });
  const two = card({ reviewText: '(текст отсутствует)', doctorName: 'Макаров К. А.' });
  assert.equal(pickCounterpart(incoming, [one]), one);
  assert.equal(pickCounterpart(incoming, [one, two]), null);
});

test('при двух похожих побеждает более полное совпадение', () => {
  const incoming = { date: '2026-09-24', rating: 5, text: PD_COMMENT };
  const partial = card({ id: 'partial', reviewText: 'Обратилась к доктору с дискомфортом, выбрала случайно, не пожалела, другой врач, другая клиника, другое всё остальное.' });
  const exact = card({ id: 'exact', reviewDate: '2026-09-25', reviewText: PD_COMMENT });
  assert.equal(pickCounterpart(incoming, [partial, exact]), exact);
});
