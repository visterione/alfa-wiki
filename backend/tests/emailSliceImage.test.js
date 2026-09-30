'use strict';

/**
 * Картинка с кнопкой (ver. 9.18).
 *
 * Маршрут кусков открыт без входа, поэтому главное здесь — что он режет только
 * подписанное рендерером, и что куски сходятся без щелей: шов в пиксель на
 * тёмном макете виден с первого взгляда.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fsp = require('fs').promises;
const slices = require('../services/emailSliceImage');
const { render } = require('../services/emailRenderer');

const ID = '00000000-0000-4000-8000-00000000abcd';
const SRC = `/uploads/email/2000-01/${ID}.png`;

const doc = (block) => ({
  version: 2,
  settings: {},
  sections: [{ columns: [{ width: 100, blocks: [{ type: 'hotspot', src: SRC, href: 'https://alfa.example/zapis', padding: { top: 0, right: 0, bottom: 0, left: 0 }, ...block }] }] }],
});

test('резать можно только файл, загруженный в конструктор', () => {
  assert.deepEqual(slices.parseSource(SRC), { month: '2000-01', id: ID, ext: 'png' });
  assert.equal(slices.parseSource('https://чужой.сайт/banner.png'), null);
  assert.equal(slices.parseSource(`/uploads/email/2000-01/../../../etc/${ID}.png`), null);
  assert.equal(slices.parseSource('/uploads/email/2000-01/кот.png'), null);
});

test('зона прилипает к краям и отбрасывает промах мышью', () => {
  assert.deepEqual(slices.normalizeZone({ x: 0.003, y: 0.7, w: 0.5, h: 0.296 }), { l: 0, t: 7000, r: 5030, b: slices.SCALE });
  assert.equal(slices.normalizeZone({ x: 0.5, y: 0.5, w: 0.01, h: 0.2 }), null);
  assert.equal(slices.normalizeZone({ x: 'много' }), null);
  assert.equal(slices.normalizeZone(null), null);
});

test('кусок без верной подписи не режется', () => {
  const rect = { l: 3000, t: 7000, r: 7000, b: 8500 };
  const url = slices.sliceUrl(slices.parseSource(SRC), rect, 'https://w.ru');
  const signature = new URL(url).searchParams.get('s');
  const ask = (over = {}) => slices.parseRequest({ month: '2000-01', id: ID, rect: '3000-7000-7000-8500', ext: 'png', signature, ...over });

  assert.ok(ask());
  assert.equal(ask({ signature: 'x'.repeat(20) }), null);
  // Подпись от одного прямоугольника не открывает соседний.
  assert.equal(ask({ rect: '0-0-10000-10000' }), null);
  assert.equal(ask({ id: '../../../../etc/passwd-000000000000' }), null);
  assert.equal(ask({ rect: '7000-7000-3000-8500' }), null);
});

test('письмо собирается полосами, и ссылку получает только кнопка', () => {
  const { html, warnings } = render(doc({ zone: { x: 0.3, y: 0.7, w: 0.4, h: 0.15 }, buttonAlt: 'Записаться' }), { baseUrl: 'https://w.ru' });
  const pieces = html.match(/\/api\/email\/slice\/[^"]+/g) || [];
  // Верх, слева, кнопка, справа, низ.
  assert.equal(pieces.length, 5);
  const links = html.match(/<a href="https:\/\/alfa\.example\/zapis"[^>]*>(.*?)<\/a>/g) || [];
  assert.equal(links.length, 1);
  assert.match(links[0], /3000-7000-7000-8500\.png/);
  assert.match(links[0], /alt="Записаться"/);
  // Ширины среднего ряда в сумме дают ширину блока — иначе ряд уже или шире
  // полос над ним и под ним.
  const widths = [...html.matchAll(/<td width="(\d+)" valign="top" style="width:(\d+\.\d+)%/g)];
  const middle = widths.slice(1, 4);
  assert.equal(middle.reduce((sum, m) => sum + Number(m[1]), 0), 600);
  assert.equal(middle.reduce((sum, m) => sum + Number(m[2]), 0), 100);
  assert.ok(!warnings.some(w => /вся картинка/.test(w)));
});

test('кнопка у края не даёт пустых кусков', () => {
  const { html } = render(doc({ zone: { x: 0, y: 0.8, w: 0.5, h: 0.2 } }), { baseUrl: 'https://w.ru' });
  // Только верх, кнопка и кусок справа: слева и снизу резать нечего.
  assert.equal((html.match(/\/api\/email\/slice\//g) || []).length, 3);
});

test('чужая картинка уходит целиком со ссылкой и с предупреждением', () => {
  const { html, warnings } = render(doc({ src: 'https://cdn.example/banner.png', zone: { x: 0.3, y: 0.7, w: 0.4, h: 0.15 } }), { baseUrl: 'https://w.ru' });
  assert.doesNotMatch(html, /\/api\/email\/slice\//);
  assert.match(html, /<a href="https:\/\/alfa\.example\/zapis"[^>]*><img src="https:\/\/cdn\.example\/banner\.png"/);
  assert.ok(warnings.some(w => /вся картинка/.test(w)));
});

test('куски режутся по одним краям и сходятся без щели', async () => {
  const sharp = require('sharp');
  const dir = path.join(__dirname, '..', 'uploads', 'email', '2000-01');
  const original = path.join(dir, `${ID}.png`);
  await fsp.mkdir(dir, { recursive: true });
  await sharp({ create: { width: 1201, height: 601, channels: 3, background: '#336699' } }).png().toFile(original);

  const made = [];
  try {
    const source = slices.parseSource(SRC);
    const zone = slices.normalizeZone({ x: 0.3333, y: 0.7, w: 0.3333, h: 0.15 });
    const size = async (rect) => {
      const file = await slices.sliceFile({ source, rect });
      made.push(file);
      const m = await sharp(file).metadata();
      return { w: m.width, h: m.height };
    };
    const left = await size({ l: 0, t: zone.t, r: zone.l, b: zone.b });
    const button = await size(zone);
    const right = await size({ l: zone.r, t: zone.t, r: slices.SCALE, b: zone.b });
    assert.equal(left.w + button.w + right.w, 1201);
    assert.equal(left.h, button.h);
    assert.equal(button.h, right.h);

    // Второй раз кусок берётся из кэша, а не режется заново.
    assert.equal(await slices.sliceFile({ source, rect: zone }), made[1]);
  } finally {
    await Promise.all([original, ...made].map(f => fsp.rm(f, { force: true })));
    await fsp.rmdir(dir).catch(() => {});
  }
});

test('кусок удалённой картинки — пустота, а не ошибка', async () => {
  const source = { month: '2000-02', id: ID, ext: 'jpg' };
  assert.equal(await slices.sliceFile({ source, rect: { l: 0, t: 0, r: 5000, b: 5000 } }), null);
});
