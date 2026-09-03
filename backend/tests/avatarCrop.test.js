'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAvatarCrop } = require('../services/avatarCrop');

const META = { width: 4032, height: 3024 };

test('рамка из окна обрезки доходит до sharp как есть', () => {
  assert.deepEqual(
    parseAvatarCrop('{"x":100,"y":200,"width":1500,"height":1500}', META),
    { left: 100, top: 200, width: 1500, height: 1500 },
  );
});

test('дробные координаты округляются: экранные точки не целые', () => {
  assert.deepEqual(
    parseAvatarCrop({ x: 10.4, y: 10.6, width: 99.5, height: 99.4 }, META),
    { left: 10, top: 11, width: 100, height: 99 },
  );
});

test('без рамки берётся центр кадра — как было до появления обрезки', () => {
  assert.equal(parseAvatarCrop(undefined, META), null);
  assert.equal(parseAvatarCrop('', META), null);
});

test('мусор вместо рамки не роняет загрузку', () => {
  assert.equal(parseAvatarCrop('не json', META), null);
  assert.equal(parseAvatarCrop('{"x":"слева"}', META), null);
  assert.equal(parseAvatarCrop({ x: NaN, y: 0, width: 10, height: 10 }, META), null);
  assert.equal(parseAvatarCrop({ x: 0, y: 0, width: 10, height: 10 }, {}), null);
});

test('рамка за краями картинки отбрасывается целиком, а не подрезается', () => {
  assert.equal(parseAvatarCrop({ x: -5, y: 0, width: 100, height: 100 }, META), null);
  assert.equal(parseAvatarCrop({ x: 4000, y: 0, width: 100, height: 100 }, META), null);
  assert.equal(parseAvatarCrop({ x: 0, y: 3000, width: 100, height: 100 }, META), null);
});

test('вырожденная рамка не доходит до extract: sharp на ней падает', () => {
  assert.equal(parseAvatarCrop({ x: 0, y: 0, width: 0, height: 100 }, META), null);
  assert.equal(parseAvatarCrop({ x: 0, y: 0, width: 100, height: 0.4 }, META), null);
});

test('рамка ровно по краю картинки — законная', () => {
  assert.deepEqual(
    parseAvatarCrop({ x: 1008, y: 0, width: 3024, height: 3024 }, META),
    { left: 1008, top: 0, width: 3024, height: 3024 },
  );
});
