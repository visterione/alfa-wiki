'use strict';

/**
 * Почтовый клуб (ver. 8.79) — разбор того, что присылает сайт.
 *
 * Сайт чужой, и всё, что от него приходит, проверяется здесь: clinic_id
 * решает, в чей клуб попадёт адрес, а consent — единственное свидетельство
 * того, откуда адрес взялся. Ошибка в первом раскладывает подписчиков по
 * чужим клиникам, во втором — хранит в базе всё, что сайт прислал.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const mailClub = require('../services/mailClub');

test('clinic_id принимается числом и строкой, мусор — нет', () => {
  assert.equal(mailClub.normalizeClinicId(2), '2');
  assert.equal(mailClub.normalizeClinicId(' 11 '), '11');
  assert.equal(mailClub.normalizeClinicId('007'), '7');
  for (const bad of ['', null, undefined, 'alfa', '2; drop', '1.5', '-3', '1'.repeat(12)]) {
    assert.equal(mailClub.normalizeClinicId(bad), null, String(bad));
  }
});

test('адрес приводится к нижнему регистру и проверяется', () => {
  assert.equal(mailClub.normalizeEmail(' Ivan@Mail.RU '), 'ivan@mail.ru');
  assert.equal(mailClub.isValidEmail('ivan@mail.ru'), true);
  assert.equal(mailClub.isValidEmail('ivan@mail'), false);
  assert.equal(mailClub.isValidEmail('без собачки'), false);
  assert.equal(mailClub.isValidEmail(`${'a'.repeat(250)}@b.ru`), false);
});

test('consent хранит только известные поля и режет длину', () => {
  const c = mailClub.consentOf({
    pageUrl: 'https://alfa.ru/' + 'x'.repeat(1000),
    visitorIp: '1.2.3.4',
    visitorUserAgent: '',
    requestIp: '5.6.7.8',
    lishnee: 'не должно попасть',
  });
  assert.equal(c.pageUrl.length, 500);
  assert.equal(c.ip, '1.2.3.4');
  assert.equal(c.requestIp, '5.6.7.8');
  assert.equal('userAgent' in c, false);
  assert.equal('lishnee' in c, false);
  assert.ok(!Number.isNaN(Date.parse(c.at)));
});
