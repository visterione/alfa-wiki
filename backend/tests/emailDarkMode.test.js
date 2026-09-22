'use strict';

/**
 * Проверки тёмной темы письма (ver. 8.57).
 *
 * Симуляция трогает в готовом HTML только цвета. Тесты здесь про то, что она
 * не трогает всё остальное: у перекрашенного письма ровно та же разметка, те
 * же картинки и тот же текст, что у светлого, — иначе мы согласовывали бы с
 * заказчиком одно письмо, а отправляли другое.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const dark = require('../services/emailDarkMode');
const renderer = require('../services/emailRenderer');

const doc = (sections, settings = {}) => ({ version: 1, settings, sections });

test('светлый фон становится тёмным, тон цвета сохраняется', () => {
  const out = dark.invertDeclarations('background:#FFFFFF;color:#1C1C1E;border-color:#0A84FF');

  // Белый уходит в почти чёрный, чёрный — в почти белый.
  assert.match(out, /background:#1[0-9A-F]{5}/);
  assert.match(out, /color:#E[0-9A-F]{5}/);

  // Фирменный синий остаётся синим: у него средняя светлота, и инверсия почти
  // не двигает её. Именно так ведёт себя Gmail, и именно поэтому кнопка в
  // тёмной теме узнаваема.
  const brand = out.match(/border-color:(#[0-9A-F]{6})/)[1];
  const [r, g, b] = [1, 3, 5].map(i => parseInt(brand.slice(i, i + 2), 16));
  assert.ok(b > r && b > g, `ожидался синий, получили ${brand}`);
});

test('чистого чёрного и чистого белого не появляется', () => {
  const out = dark.invertDeclarations('background:#000000;color:#FFFFFF');
  assert.ok(!/#000000/.test(out), 'чёрного в тёмной теме почты не бывает');
  assert.ok(!/#FFFFFF/.test(out), 'белого в тёмной теме почты не бывает');
});

test('white-space не считается цветом', () => {
  // `\bwhite\b` попадает в `white-space`, и без рамки вокруг словесных цветов
  // свойство превращалось в мусор вида «#141414-space:nowrap».
  const out = dark.invertDeclarations('white-space:nowrap;background:white');
  assert.match(out, /white-space:nowrap/);
  assert.ok(!/background:white/.test(out));
});

test('прозрачность сохраняется', () => {
  const out = dark.invertDeclarations('box-shadow:0 1px 2px rgba(0, 0, 0, 0.2)');
  assert.match(out, /rgba\(\d+, \d+, \d+, 0\.2\)/);
});

test('адреса картинок и ссылок не перекрашиваются', () => {
  const html = renderer.render(doc([{
    columns: [{ width: 100, blocks: [
      { type: 'image', src: 'https://portal.example/uploads/email/logo-fff000.png', alt: 'Логотип' },
      { type: 'button', text: 'Записаться', href: 'https://portal.example/booking#c0ffee' },
    ] }],
  }]), { subject: 'Тема' }).html;

  const out = dark.simulate(html);

  assert.ok(out.includes('logo-fff000.png'), 'имя файла картинки изменилось');
  assert.ok(out.includes('booking#c0ffee'), 'адрес ссылки изменился');
  // Текст письма тоже остаётся собой.
  assert.ok(out.includes('Записаться'));
  // А вот шапка должна честно назваться тёмной, иначе Apple Mail в
  // предпросмотре откажется что-либо перекрашивать сам.
  assert.match(out, /<meta name="color-scheme" content="dark">/);
});

test('тёмная полоса в письме — повод предупредить', () => {
  const warnings = dark.inspect(doc([
    { bg: '#111827', columns: [{ width: 100, blocks: [{ type: 'text', html: '<p>Шапка</p>' }] }] },
  ]));
  assert.ok(warnings.some(w => /Тёмных полос/.test(w)), warnings.join(' | '));
});

test('светлое письмо предупреждений про полосы не даёт', () => {
  const warnings = dark.inspect(doc([
    { bg: '#FFFFFF', columns: [{ width: 100, blocks: [{ type: 'text', html: '<p>Тело</p>' }] }] },
  ]));
  assert.ok(!warnings.some(w => /Тёмных полос/.test(w)), warnings.join(' | '));
});
