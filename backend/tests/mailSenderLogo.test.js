'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeDomain,
  domainCandidates,
  isPrivateIp,
  assertSafeSvg,
} = require('../services/mail/senderLogo');

test('домен логотипа принимается только как DNS-имя', () => {
  assert.equal(normalizeDomain(' News.Pinterest.COM. '), 'news.pinterest.com');
  assert.equal(normalizeDomain('127.0.0.1'), null);
  assert.equal(normalizeDomain('localhost'), null);
  assert.equal(normalizeDomain('bad_domain.example'), null);
});

test('поиск favicon доходит до домена бренда, но не до публичного суффикса', () => {
  assert.deepEqual(domainCandidates('mail.pinterest.com'), ['mail.pinterest.com', 'pinterest.com']);
  assert.deepEqual(domainCandidates('mail.example.co.uk'), ['mail.example.co.uk', 'example.co.uk']);
});

test('приватные и служебные адреса нельзя использовать для загрузки логотипа', () => {
  ['127.0.0.1', '10.0.0.2', '169.254.169.254', '192.168.1.2', '::1', 'fd00::1', 'fe80::1']
    .forEach((address) => assert.equal(isPrivateIp(address), true, address));
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('2001:4860:4860::8888'), false);
});

test('SVG логотипа не может содержать скрипты и внешние ресурсы', () => {
  assert.doesNotThrow(() => assertSafeSvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')));
  assert.throws(() => assertSafeSvg(Buffer.from('<svg><script>alert(1)</script></svg>')));
  assert.throws(() => assertSafeSvg(Buffer.from('<svg><image href="http://127.0.0.1/a"/></svg>')));
});
