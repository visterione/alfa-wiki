'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { providerLogoDomain } = require('../services/mail/provider');

test('из серверов известных площадок выбирается их публичный логотип', () => {
  assert.equal(providerLogoDomain({ imapHost: 'mail.hosting.reg.ru', email: 'info@clinic.ru' }), 'reg.ru');
  assert.equal(providerLogoDomain({ imapHost: 'imap.gmail.com', email: 'info@clinic.ru' }), 'mail.google.com');
  assert.equal(providerLogoDomain({ imapHost: 'imap.yandex.ru', email: 'info@clinic.ru' }), 'mail.yandex.ru');
  assert.equal(providerLogoDomain({ imapHost: 'outlook.office365.com', email: 'info@clinic.ru' }), 'outlook.office.com');
});

test('у собственного почтового сервера используется домен адреса, а не внутренний хост', () => {
  assert.equal(providerLogoDomain({ imapHost: 'mail.internal.local', email: 'hello@example.org' }), 'example.org');
  assert.equal(providerLogoDomain({ imapHost: 'localhost', email: 'broken-address' }), null);
});
