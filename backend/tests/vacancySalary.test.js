const test = require('node:test');
const assert = require('node:assert/strict');

const salary = require('../services/vacancies/salary');

/**
 * Зарплата в вакансии (ver. 8.35).
 *
 * Проверяется не «функция что-то вернула», а два утверждения, ради которых
 * поле вообще разложено на вид и суммы.
 *
 * Первое: пара «вид ↔ суммы» не бывает наполовину заполненной. Ровно это же
 * условие записано проверкой в базе (vac_vacancies_salary_chk), и если разбор
 * пропустит вилку без верхней границы, сохранение упадёт ошибкой Postgres — а
 * человек увидит «не удалось сохранить вакансию» вместо «заполните границу».
 *
 * Второе: суммы у видов, где их не бывает, обнуляются. Иначе «Договорная» с
 * забытыми внутри 100 000 однажды покажется вилкой после смены вида.
 */

test('вилка: обе границы обязательны и верхняя больше нижней', () => {
  assert.deepEqual(
    salary.parse({ salaryKind: 'range', salaryFrom: '100000', salaryTo: '120000' }).salary,
    { salaryKind: 'range', salaryFrom: 100000, salaryTo: 120000 }
  );

  assert.match(salary.parse({ salaryKind: 'range', salaryFrom: '100000' }).errors[0], /Верхняя/);
  assert.match(salary.parse({ salaryKind: 'range', salaryTo: '120000' }).errors[0], /Нижняя/);
  assert.match(
    salary.parse({ salaryKind: 'range', salaryFrom: '120000', salaryTo: '100000' }).errors[0],
    /больше нижней/
  );
  // Границы, совпавшие до рубля, — это не вилка, а фиксированная сумма.
  assert.equal(salary.parse({ salaryKind: 'range', salaryFrom: '100000', salaryTo: '100000' }).salary, null);
});

test('точная сумма не тащит за собой верхнюю границу', () => {
  assert.deepEqual(
    salary.parse({ salaryKind: 'exact', salaryFrom: '90000', salaryTo: '120000' }).salary,
    { salaryKind: 'exact', salaryFrom: 90000, salaryTo: null }
  );
  assert.match(salary.parse({ salaryKind: 'exact' }).errors[0], /не заполнена/);
});

test('договорная и «не указывать» суммы обнуляют', () => {
  for (const kind of ['negotiable', 'none']) {
    assert.deepEqual(
      salary.parse({ salaryKind: kind, salaryFrom: '100000', salaryTo: '120000' }).salary,
      { salaryKind: kind, salaryFrom: null, salaryTo: null }
    );
  }
});

test('мусор вместо суммы не превращается в ноль', () => {
  // Number('') === 0, и без проверки «больше нуля» пустое поле сохранилось бы
  // вакансией с зарплатой 0 ₽ — а это не «не указана», это оскорбление.
  assert.equal(salary.parse({ salaryKind: 'exact', salaryFrom: '' }).salary, null);
  assert.equal(salary.parse({ salaryKind: 'exact', salaryFrom: 'сколько скажете' }).salary, null);
  assert.equal(salary.parse({ salaryKind: 'exact', salaryFrom: '-50000' }).salary, null);
  assert.equal(salary.parse({ salaryKind: 'exact', salaryFrom: '99999999999' }).salary, null);
});

test('неизвестный вид не проходит', () => {
  assert.equal(salary.parse({ salaryKind: 'по_итогам_собеседования' }).salary, null);
});

test('словами: разряды неразрывные, «не указана» — это отсутствие строки', () => {
  assert.equal(salary.label({ salaryKind: 'exact', salaryFrom: 120000 }), '120 000 ₽');
  assert.equal(
    salary.label({ salaryKind: 'range', salaryFrom: 100000, salaryTo: 120000 }),
    '100 000 — 120 000 ₽'
  );
  assert.equal(salary.label({ salaryKind: 'negotiable' }), 'По договорённости');
  // Вызывающему не нужно знать про виды: нет строки — блока на странице нет.
  assert.equal(salary.label({ salaryKind: 'none' }), null);
  assert.equal(salary.label(null), null);
});
