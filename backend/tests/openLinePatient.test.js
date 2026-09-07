'use strict';

/**
 * Кого показывать оператору, когда по одному номеру заведена семья (ver. 7.99).
 *
 * Правило задал заказчик и из кода оно не выводится, поэтому проверяется тестом:
 * берём самого старшего, остальное операторы уточняют в разговоре.
 */

const test = require('node:test');
const assert = require('node:assert');

const { pickOldest, title } = require('../services/openLinePatient');

test('из семьи по одному номеру выбирается самый старший', () => {
  const family = [
    { patient_id: '2', number: '2', last_name: 'Иванов', first_name: 'Пётр', birth_date: '15.06.2015' },
    { patient_id: '1', number: '1', last_name: 'Иванова', first_name: 'Мария', birth_date: '01.01.1985' },
    { patient_id: '3', number: '3', last_name: 'Иванова', first_name: 'Аня', birth_date: '20.03.2019' }
  ];

  assert.strictEqual(pickOldest(family).patient_id, '1');
});

test('карточка без даты рождения проигрывает любой с датой', () => {
  const rows = [
    { patient_id: '1', birth_date: null },
    { patient_id: '2', birth_date: '10.10.2010' }
  ];

  assert.strictEqual(pickOldest(rows).patient_id, '2');
});

test('когда дат нет вовсе, кто-то всё равно выбирается', () => {
  const rows = [{ patient_id: '7', birth_date: null }, { patient_id: '8', birth_date: '' }];

  assert.strictEqual(pickOldest(rows).patient_id, '7');
});

test('пустой список — не пациент, а отсутствие пациента', () => {
  assert.strictEqual(pickOldest([]), null);
  assert.strictEqual(pickOldest(null), null);
});

test('подпись собирается в том виде, в каком её ждут в шапке чата', () => {
  const subscriber = {
    phone: '79001234567',
    patientCard: '123456',
    patientName: 'Иванов Иван Иванович',
    patientBirthDate: '01.01.1999'
  };

  assert.strictEqual(title(subscriber), '№123456 Иванов Иван Иванович (01.01.1999) +7 (900) 123-45-67');
});

test('пациент без карты в МИС подписан одним телефоном', () => {
  assert.strictEqual(title({ phone: '79001234567' }), '+7 (900) 123-45-67');
});

test('без номера и без карты подпись всё равно не пустая', () => {
  assert.strictEqual(title({}), 'Без номера');
});
