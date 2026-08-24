'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { looksLikePerson, pickDuration } = require('../routes/service-matrix');

// В роли «врач» МИС держит и кабинеты: если их не отделить, матрица предложит
// регистратуре записать пациента к «Процедурный(Проф) Кабинет» наравне с врачом.
test('исполнителей-кабинеты отличаем от врачей', () => {
  const people = [
    'Агапов Александр Георгиевич',
    'Кузьмина(Скворцова) Елена Юрьевна',
    'Липаткина (Агеева) Яна Александровна',
    'Буяков Олег'
  ];
  const facilities = [
    'КТ Кабинет Альфа',
    'Дневной стационар №316 3 этаж',
    'Процедурный(Проф) Кабинет',
    'Холтер-СМАД',
    'Вакцинация Кабинет Kids',
    'Лаборатория Линия',
    'Panacea',
    'Администратор '
  ];

  for (const name of people) assert.equal(looksLikePerson(name), true, name);
  for (const name of facilities) assert.equal(looksLikePerson(name), false, name);
});

test('длительность берём в порядке: своя по филиалу → из карточки → дефолт услуги', () => {
  assert.deepEqual(
    pickDuration({ own: 40, legacy: 30, serviceDefault: 20 }),
    { duration: 40, source: 'doctor' }
  );
  assert.deepEqual(
    pickDuration({ own: null, legacy: 30, serviceDefault: 20 }),
    { duration: 30, source: 'card' }
  );
  assert.deepEqual(
    pickDuration({ own: null, legacy: null, serviceDefault: 20 }),
    { duration: 20, source: 'service' }
  );
  assert.deepEqual(
    pickDuration({ own: null, legacy: null, serviceDefault: null }),
    { duration: null, source: 'none' }
  );
});
