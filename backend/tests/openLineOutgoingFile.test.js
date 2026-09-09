'use strict';

/**
 * Файл, отправленный оператором открытой линии (ver. 8.09).
 *
 * До этого переписка была односторонней по вложениям: пациент мог прислать
 * фотографию направления, а оператор в ответ — только текст.
 *
 * Проверяется то, что ломается молча. Имя файла придумывает человек, и оно
 * попадает в две разные строки: в путь на диске и в подпись вложения. В путь
 * его пускать нельзя — там бывает и «..», и слэш; в подписи оно, наоборот,
 * должно остаться как есть, иначе оператор не узнает, что именно посылал.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const files = require('../services/openLineFiles');

// Каталог с случайным именем: тест пишет на диск по-настоящему, потому что
// проверяет именно то, куда файл ложится.
const conversationId = `test-${crypto.randomUUID()}`;

test.after(() => {
  fs.rmSync(path.join(files.ROOT, conversationId), { recursive: true, force: true });
});

const attach = (originalName, mimetype, body = 'содержимое') =>
  files.saveOutgoing({ buffer: Buffer.from(body), originalName, mimetype }, conversationId);

test('картинка показывается в ленте, остальное — плашкой со скрепкой', async () => {
  // Судим по типу, а не по расширению: тип приходит от браузера вместе с
  // файлом, а расширение человек пишет любое.
  assert.equal((await attach('снимок.jpg', 'image/jpeg')).kind, 'photo');
  assert.equal((await attach('памятка.pdf', 'application/pdf')).kind, 'file');
  assert.equal((await attach('бланк.docx', undefined)).kind, 'file');
});

test('исходное имя остаётся в подписи, но не в пути на диске', async () => {
  const a = await attach('Памятка перед гастроскопией.pdf', 'application/pdf');

  // Человек должен видеть то имя, которое отправлял.
  assert.equal(a.title, 'Памятка перед гастроскопией.pdf');
  // А на диске лежит случайное: пробелы и кириллица в ссылке ни к чему, и
  // второй файл с тем же именем не должен затирать первый.
  assert.ok(!a.url.includes('Памятка'), a.url);
  assert.match(a.url, new RegExp(`^/uploads/open-line/${conversationId}/[0-9a-f-]{36}\\.pdf$`));
});

test('«..» в имени не уводит файл из каталога переписки', async () => {
  const a = await attach('../../../etc/passwd.pdf', 'application/pdf');

  const dir = path.join(files.ROOT, conversationId);
  const written = path.resolve(files.ROOT, '..', '.' + a.url.replace('/uploads', ''));
  assert.ok(written.startsWith(dir + path.sep), `файл ушёл мимо каталога: ${written}`);
  assert.ok(fs.existsSync(written));
});

test('расширение не растягивается на всё имя', async () => {
  // «.<двадцать букв>» — это уже не расширение, а часть имени, и в путь оно
  // попадать не должно.
  const a = await attach(`файл.${'x'.repeat(40)}`, 'application/octet-stream');
  assert.ok(path.extname(a.url).length <= 8, path.extname(a.url));
});

test('вложение описано так же, как присланное пациентом', async () => {
  const a = await attach('схема.png', 'image/png', 'ку-ку');

  // Лента рисует вложения одним и тем же кодом независимо от того, кто их
  // прислал, — набор полей должен совпадать. Кроме previewUrl: у присланного
  // пациентом превью берётся из готовой лесенки размеров Telegram, а файл
  // оператора приходит одним размером, и уменьшать его было бы нашей работой.
  assert.deepEqual(Object.keys(a).sort(), ['kind', 'mime', 'size', 'title', 'url']);
  assert.equal(a.size, Buffer.from('ку-ку').length);
  assert.equal(a.mime, 'image/png');
});
