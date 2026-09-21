'use strict';

/**
 * Иконки писем (ver. 8.53).
 *
 * Маршрут /api/email/icon — единственный в разделе рассылок без проверки входа:
 * по нему ходит прокси Gmail, у которого токена нет и быть не может. Значит,
 * всё, что пришло из адреса, обязано быть проверено до того, как попадёт в имя
 * файла или в разметку SVG. Проверки ниже — про это и про совпадение адреса с
 * именем файла: разойдись они, картинка рисовалась бы заново на каждый запрос.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const icons = require('../services/emailIconImage');

test('иконка не из набора не даёт ни адреса, ни файла', async () => {
  assert.equal(icons.normalize({ key: 'нет-такой' }), null);
  assert.equal(icons.iconUrl({ key: 'нет-такой' }, 'https://wiki.example.ru'), '');
  assert.equal(await icons.iconFile({ key: 'нет-такой' }), null);
});

test('в имя файла не уходит ничего, кроме проверенных значений', () => {
  // Попытка выйти каталогом вверх и подсунуть свой цвет разбивается о то, что
  // имя берётся из набора, а цвет обязан быть шестнадцатеричным.
  assert.equal(icons.normalize({ key: '../../etc/passwd' }), null);
  const p = icons.normalize({ key: 'check', color: 'red; url(http://зло)', bg: '../x' });
  assert.equal(p.color, '#1C1C1E');
  assert.equal(p.bg, null);
});

test('размер зажат в вилку, а не берётся из адреса как есть', () => {
  assert.equal(icons.normalize({ key: 'check', size: 9000 }).size, icons.MAX_SIZE);
  assert.equal(icons.normalize({ key: 'check', size: -5 }).size, 12);
  assert.equal(icons.normalize({ key: 'check', size: 'сорок' }).size, 28);
});

test('адрес описывает картинку целиком — по нему её и кэшируют', () => {
  const url = icons.iconUrl({ key: 'heart-pulse', size: 32, color: '#0A84FF', bg: '#EAF4FF' }, 'https://wiki.example.ru/');
  assert.equal(url, 'https://wiki.example.ru/api/email/icon/heart-pulse.png?size=32&color=0A84FF&bg=EAF4FF');
  // Без подложки её нет и в адресе: иначе у одной иконки два адреса на одну картинку.
  const plain = icons.iconUrl({ key: 'heart-pulse', size: 32, color: '#0A84FF' }, 'https://wiki.example.ru');
  assert.equal(plain, 'https://wiki.example.ru/api/email/icon/heart-pulse.png?size=32&color=0A84FF');
});

test('в SVG уезжает выбранный цвет, а подложка становится кружком', () => {
  const withBg = icons.buildSvg(icons.normalize({ key: 'check', size: 40, color: '#0A84FF', bg: '#EAF4FF' }));
  assert.match(withBg, /<circle cx="12" cy="12" r="12" fill="#EAF4FF"\/>/);
  assert.match(withBg, /stroke="#0A84FF"/);
  // PNG рисуется вдвое крупнее: на экране с двойной плотностью иконка ровно по
  // размеру выглядит замыленной.
  assert.match(withBg, /width="80" height="80"/);

  const plain = icons.buildSvg(icons.normalize({ key: 'check', size: 40, color: '#0A84FF' }));
  assert.doesNotMatch(plain, /<circle/);
});

test('нарисованная иконка остаётся на диске и второй раз не рисуется', async () => {
  const params = { key: 'mail', size: 24, color: '#1C1C1E' };
  const first = await icons.iconFile(params);
  const stat = require('fs').statSync(first);
  const again = await icons.iconFile(params);
  assert.equal(again, first);
  assert.equal(require('fs').statSync(again).mtimeMs, stat.mtimeMs);
  assert.match(first, /mail-24-1C1C1E\.png$/);
});
