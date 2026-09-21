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
