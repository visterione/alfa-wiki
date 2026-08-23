'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Секрет задаём до require: сервис читает его при подписи, и без него любые
// токены сошлись бы на пустом ключе.
process.env.FILE_TOKEN_SECRET = 'test-file-secret';

const { issueToken, verifyToken } = require('../services/fileAccess');

test('свежий токен опознаёт своего владельца', () => {
  const token = issueToken('user-1');
  assert.equal(verifyToken(token), 'user-1');
});

test('подмена пользователя в токене не проходит', () => {
  const token = issueToken('user-1');
  const [, exp, sig] = token.split('.');
  assert.equal(verifyToken(`user-2.${exp}.${sig}`), null);
});

test('продление срока жизни правкой токена не проходит', () => {
  const token = issueToken('user-1');
  const [userId, exp, sig] = token.split('.');
  assert.equal(verifyToken(`${userId}.${Number(exp) + 60000}.${sig}`), null);
});

test('истёкший токен отвергается', () => {
  assert.equal(verifyToken(issueToken('user-1', -1000)), null);
});

test('мусор вместо токена не роняет проверку', () => {
  for (const bad of [undefined, null, '', 'abc', 'a.b', 'a.b.c.d', 'a.b.c']) {
    assert.equal(verifyToken(bad), null);
  }
});
