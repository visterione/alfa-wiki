'use strict';

/**
 * Проверки токена отписки (ver. 8.43).
 *
 * Отписка — единственный адрес портала, доступный из интернета без всякой
 * авторизации, и единственный, который обязан работать через год после
 * отправки письма. Отсюда и проверки: подделать токен нельзя, разобрать чужой
 * нельзя, а свой должен читаться одинаково всегда.
 */

process.env.EMAIL_OPTOUT_SECRET = 'тестовый-секрет-для-подписи-отписок';
process.env.PUBLIC_BASE_URL = 'https://wiki.example.ru';

const test = require('node:test');
const assert = require('node:assert/strict');
const optout = require('../services/emailOptout');

test('токен читается обратно и не зависит от регистра адреса', () => {
  const token = optout.makeToken('Ivan.Petrov@Mail.RU');
  assert.equal(optout.readToken(token), 'ivan.petrov@mail.ru');
});

test('один и тот же адрес всегда даёт один и тот же токен', () => {
  // Ссылка из письма годовой давности должна открываться и сегодня.
  assert.equal(optout.makeToken('a@b.ru'), optout.makeToken(' A@B.ru '));
});

test('подделанная подпись не проходит', () => {
  const token = optout.makeToken('ivan@mail.ru');
  const [payload] = token.split('.');
  assert.equal(optout.readToken(`${payload}.подписьнеоттуда`), null);
  assert.equal(optout.readToken(`${payload}.`), null);
  assert.equal(optout.readToken(payload), null);
});

test('чужой адрес нельзя подставить, не зная секрета', () => {
  const mine = optout.makeToken('ivan@mail.ru');
  const [, signature] = mine.split('.');
  const foreign = Buffer.from('boss@alfa.ru').toString('base64').replace(/=+$/, '');
  assert.equal(optout.readToken(`${foreign}.${signature}`), null);
});

test('мусор вместо токена не роняет разбор', () => {
  for (const bad of ['', null, undefined, '....', 'не.токен', '%%%.%%%', 'a'.repeat(5000)]) {
    assert.equal(optout.readToken(bad), null);
  }
});

test('в токене без собачки отписки не бывает', () => {
  // Payload подписан верно, но внутри не адрес: такой токен бесполезен и должен
  // отлетать, а не отписывать пустоту.
  const token = optout.makeToken('просто-строка');
  assert.equal(token === '' || optout.readToken(token) === null, true);
});

test('адрес страницы отписки собирается от PUBLIC_BASE_URL', () => {
  const url = optout.unsubscribeUrl('ivan@mail.ru');
  assert.match(url, /^https:\/\/wiki\.example\.ru\/api\/email-optout\/[A-Za-z0-9_.-]+$/);
  assert.equal(optout.readToken(url.split('/').pop()), 'ivan@mail.ru');
});

test('смена секрета обесценивает старые токены, а не ломает разбор', () => {
  const token = optout.makeToken('ivan@mail.ru');
  process.env.EMAIL_OPTOUT_SECRET = 'другой-секрет';
  assert.equal(optout.readToken(token), null);
  process.env.EMAIL_OPTOUT_SECRET = 'тестовый-секрет-для-подписи-отписок';
  assert.equal(optout.readToken(token), 'ivan@mail.ru');
});

// ── Почтовый клуб (ver. 8.79) ────────────────────────────────────────────────
// В письме клуба ссылка несёт ещё и медцентр: отписка из письма Альфы должна
// убирать человека только из Альфы. При этом ссылки из писем, ушедших до
// клуба, обязаны читаться как раньше — общей отпиской.

const CLUB = '3f2b8c1e-5d4a-4b7e-9c61-0a2f4e8d7b10';

test('токен клуба несёт адрес и медцентр', () => {
  const token = optout.makeToken('Ivan@Mail.ru', CLUB);
  assert.deepEqual(optout.readTokenFull(token), { email: 'ivan@mail.ru', club: CLUB });
  assert.equal(optout.readToken(token), 'ivan@mail.ru');
});

test('старый токен без клуба читается общей отпиской', () => {
  const token = optout.makeToken('ivan@mail.ru');
  assert.deepEqual(optout.readTokenFull(token), { email: 'ivan@mail.ru', club: null });
});

test('токены одного адреса в разных клубах различаются', () => {
  const other = '9a1c4e2f-7b3d-4c8a-b5e6-1f0d2c3b4a59';
  assert.notEqual(optout.makeToken('ivan@mail.ru', CLUB), optout.makeToken('ivan@mail.ru', other));
  assert.notEqual(optout.makeToken('ivan@mail.ru', CLUB), optout.makeToken('ivan@mail.ru'));
});

test('клуб не из UUID в токен не попадает', () => {
  // Отписка от «клуба» с произвольной строкой была бы подписанным мусором.
  assert.equal(optout.makeToken('ivan@mail.ru', 'alfa'), optout.makeToken('ivan@mail.ru'));
});

test('клуб в токене нельзя подменить, не зная секрета', () => {
  const [, signature] = optout.makeToken('ivan@mail.ru', CLUB).split('.');
  const other = '9a1c4e2f-7b3d-4c8a-b5e6-1f0d2c3b4a59';
  const forged = Buffer.from(`ivan@mail.ru\n${other}`).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(optout.readTokenFull(`${forged}.${signature}`), null);
});

test('ссылка отписки клуба ведёт на ту же страницу', () => {
  const url = optout.unsubscribeUrl('ivan@mail.ru', CLUB);
  assert.match(url, /^https:\/\/wiki\.example\.ru\/api\/email-optout\/[A-Za-z0-9_.-]+$/);
  assert.equal(optout.readTokenFull(url.split('/').pop()).club, CLUB);
});
