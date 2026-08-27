'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cvPdf = require('../services/onboarding/cvPdf');

function render(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function assertValidPdf(buffer) {
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.match(buffer.subarray(-32).toString(), /%%EOF\s*$/);
}

const application = {
  fullName: 'Иванов Иван Иванович',
  professions: [{ name: 'Терапевт' }],
  startDate: '2026-09-01',
  submittedAt: '2026-08-27'
};

test('анкета формируется как завершаемый вызывающим кодом PDF-поток', async () => {
  const doc = cvPdf.buildCv(application, {
    email: 'doctor@example.com',
    phone: '79991234567',
    form: {
      birthDate: '1990-01-01',
      about: 'Тестовая анкета'
    }
  }, { name: 'Тестовый филиал' });

  assert.equal(doc.readableEnded, false);
  assertValidPdf(await render(doc));
});

test('список услуг формируется как завершаемый вызывающим кодом PDF-поток', async () => {
  const doc = cvPdf.buildServices(application, [{
    code: 'A01',
    title: 'Первичный приём',
    price: 2500,
    misDuration: 30,
    doctorDuration: 40,
    comment: 'Нужны дополнительные десять минут',
    isCustom: false
  }], { name: 'Тестовый филиал' });

  assert.equal(doc.readableEnded, false);
  assertValidPdf(await render(doc));
});
