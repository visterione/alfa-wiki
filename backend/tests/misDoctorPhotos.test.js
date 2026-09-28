'use strict';

/**
 * Фото врачей из МИС (ver. 9.05).
 *
 * Проверяем то, что важно для нагрузки и безопасности: список сотрудников
 * берётся из МИС один раз на всех, готовое фото повторно в МИС не ходит, а
 * ссылку на чужой сервер сервер не скачивает, даже если МИС её вернула.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createDoctorPhotos } = require('../services/misDoctorPhotos');

const BASE = 'https://mis.example:3010/api/public';

async function jpeg() {
  return sharp({ create: { width: 900, height: 1200, channels: 3, background: '#888' } }).jpeg().toBuffer();
}

function setup(users) {
  const calls = { getUsers: 0, images: [] };
  const photos = createDoctorPhotos({
    misBaseUrl: BASE,
    misRequest: async (endpoint) => {
      assert.equal(endpoint, 'getUsers');
      calls.getUsers += 1;
      return { error: 0, data: users };
    },
    fetchImage: async (url) => { calls.images.push(url); return jpeg(); },
  });
  return { photos, calls };
}

test('фото ужимается, а повторный запрос отдаётся из кэша без МИС', async () => {
  const { photos, calls } = setup([{ id: 942, avatar: 'https://mis.example:3010/upload/a.jpg' }]);
  const first = await photos.getPhoto('942');
  const meta = await sharp(first).metadata();
  assert.equal(meta.format, 'jpeg');
  // Исходник 900×1200 — на выходе квадрат: рамка в карточке и в Word квадратная.
  assert.equal(meta.width, 480);
  assert.equal(meta.height, 480);
  await photos.getPhoto(942);
  assert.equal(calls.getUsers, 1);
  assert.equal(calls.images.length, 1);
});

test('список сотрудников запрашивается один раз на все карточки', async () => {
  const { photos, calls } = setup([
    { id: 1, avatar: 'https://mis.example:3010/upload/1.jpg' },
    { id: 2, avatar: 'https://mis.example:3010/upload/2.jpg' },
    { id: 3, avatar: null },
  ]);
  const results = await Promise.all([photos.getPhoto(1), photos.getPhoto(2), photos.getPhoto(3)]);
  assert.equal(calls.getUsers, 1);
  assert.ok(results[0] && results[1]);
  assert.equal(results[2], null);
});

test('ссылку не на сервер МИС не скачиваем', async () => {
  const { photos, calls } = setup([{ id: 5, avatar: 'https://evil.example/steal.jpg' }]);
  assert.equal(await photos.getPhoto(5), null);
  assert.equal(calls.images.length, 0);
});
