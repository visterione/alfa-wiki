'use strict';

/**
 * Отдача присланных файлов (ver. 8.07).
 *
 * Проверяем ту самую дыру, ради которой правило появилось: пациент присылает в
 * бот файл с расширением, которое браузер считает документом, оператор нажимает
 * на вложение — и скрипт из файла исполняется на домене портала, где в
 * localStorage лежит токен сотрудника.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { isInlineSafe, dispositionFor, applyUploadSafety } = require('../middleware/uploadSafety');

/** Заглушка ответа: запоминает заголовки, как настоящий res. */
function fakeRes() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) { headers[name.toLowerCase()] = value; }
  };
}

test('страницы и скрипты в браузере не открываются', () => {
  for (const name of ['спрака.html', 'a.htm', 'снимок.svg', 'x.xhtml', 'y.mhtml', 'z.js', 'q.mjs', 'w.xml']) {
    assert.equal(isInlineSafe(name), false, name);
  }
});

test('картинки, pdf и видео по-прежнему смотрят прямо в ленте', () => {
  for (const name of ['фото.JPG', 'a.png', 'b.pdf', 'c.mp4', 'd.ogg', 'e.txt']) {
    assert.equal(isInlineSafe(name), true, name);
  }
});

test('исполнимое уходит файлом, а не страницей', () => {
  const res = fakeRes();
  applyUploadSafety(res, '/uploads/open-line/abc/1a2b.html');

  assert.match(res.headers['content-disposition'], /^attachment;/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  // Даже отрисованный, файл не получает ни прав, ни своего origin
  assert.match(res.headers['content-security-policy'], /sandbox/);
});

test('картинке ничего не мешает', () => {
  const res = fakeRes();
  applyUploadSafety(res, '/uploads/open-line/abc/1a2b.jpg');

  assert.equal(res.headers['content-disposition'], undefined);
  assert.equal(res.headers['content-security-policy'], undefined);
  // nosniff ставится всем: он ничего не ломает, а подмену типа исключает
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('имя файла не разрывает заголовок', () => {
  // Имя приходит от отправителя, и перевод строки в нём позволил бы подставить
  // свои заголовки в ответ.
  const value = dispositionFor('плохое"имя\r\nX-Injected: 1.bin');

  assert.equal(value.includes('\r'), false);
  assert.equal(value.includes('\n'), false);
  assert.match(value, /filename\*=UTF-8''/);
});

test('файл без расширения тоже скачивается', () => {
  assert.equal(isInlineSafe('/uploads/open-line/abc/1a2b'), false);
});
