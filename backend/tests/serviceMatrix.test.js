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

// Карточек у врача бывает несколько — по специальностям, и одна и та же услуга
// в них помечена по-разному. Правило «видима, если показана хотя бы в одной»
// защищает педиатрический приём, спрятанный на карточке аллерголога.
test('видимость услуги собирается по всем карточкам врача', () => {
  const { buildCardIndex } = require('../routes/service-matrix');

  const index = buildCardIndex([
    {
      fullName: 'Иванова Мария Петровна',
      metadata: {
        misUserId: '77',
        clinics: [1, 4],
        serviceOverrides: { '100': { isHidden: true }, '200': {} }
      }
    },
    {
      fullName: 'Иванова Мария Петровна',
      metadata: {
        misUserId: '77',
        clinics: [11],
        serviceOverrides: { '100': {}, '300': { isHidden: true } }
      }
    }
  ]);

  const info = index.get('77');
  assert.equal(info.visible.has('100'), true, 'вторая карточка показывает услугу');
  assert.equal(info.visible.has('200'), true);
  assert.equal(info.visible.has('300'), false);
  assert.equal(info.hidden.has('300'), true);
  // Старые идентификаторы филиалов из карточки приводим к нынешним; Сукко (11)
  // в прежнюю нумерацию не входил и остаётся собой.
  assert.deepEqual([...info.clinicIds].sort((a, b) => a - b), [2, 6, 11]);
});
