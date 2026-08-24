'use strict';

const test = require('node:test');
const assert = require('node:assert');

const proc = require('../services/onboarding/process');
const validation = require('../services/onboarding/validation');
const projection = require('../services/onboarding/projection');

// Стадия на параллельном шаге не описывается одним хранимым статусом: после
// создания учётки одновременно живут четыре ветки. Проверяем, что стадия
// выводится из задач, а не из поля.
test('стадия после создания учётки выводится из закрытых задач', () => {
  const app = { status: proc.STATUS.MIS_CREATED };

  assert.equal(proc.stageOf(app, []).label, 'Запуск / выбор услуг');

  const picked = [{ stepKey: proc.DOCTOR_STEP, completedAt: new Date() }];
  assert.equal(proc.stageOf(app, picked).label, 'Услуги у бухгалтера');

  const accounted = [...picked, { stepKey: 'services_mis', completedAt: new Date() }];
  assert.equal(proc.stageOf(app, accounted).label, 'Выгрузка в колл-центр');
});

test('до создания учётки стадия совпадает со статусом заявки', () => {
  const app = { status: proc.STATUS.SUBMITTED };
  assert.equal(proc.stageOf(app, []).label, 'На согласовании');
});

// Чек-лист из ТЗ: запуск разрешён только когда закрыты все пункты, включая
// выбор услуг врачом — он не входит в STEPS, но в чек-листе обязан быть.
test('чек-лист включает выбор услуг врачом и не пускает запуск раньше времени', () => {
  const items = proc.checklistOf([]);
  assert.ok(items.some(i => i.key === proc.DOCTOR_STEP), 'нет пункта про выбор услуг');
  assert.equal(proc.isReadyToLaunch([]), false);

  const allDone = items.map(i => ({ stepKey: i.key, completedAt: new Date() }));
  assert.equal(proc.isReadyToLaunch(allDone), true);

  const missingBadge = allDone.filter(t => t.stepKey !== 'badge');
  assert.equal(proc.isReadyToLaunch(missingBadge), false);
});

test('параллельный запуск стартует четырьмя ветками после учётки в МИС', () => {
  const next = proc.stepsAfter('mis_account').map(s => s.key).sort();
  assert.deepEqual(next, ['badge', 'schedule', 'website']);
  // Четвёртая ветка — врач, у неё нет исполнителя внутри клиники, поэтому в
  // STEPS её нет и открывает её движок отдельно.
  assert.equal(proc.DOCTOR_STEP, 'services_pick');
});

// Форма публичная: в JSONB не должно попадать ничего, чего нет в схеме.
test('черновик очищается по схеме и отбрасывает посторонние ключи', () => {
  const form = validation.sanitize({
    fullName: '  Иванов  Иван   Иванович ',
    experienceTotal: '12,5',
    isAdmin: true,
    education: [{ year: '2010', institution: 'МГУ', specialty: 'Лечебное дело', city: 'Москва' }]
  });

  assert.equal(form.fullName, 'Иванов Иван Иванович');
  assert.equal(form.experienceTotal, 12.5);
  assert.equal('isAdmin' in form, false);
  assert.equal(form.education.length, 1);
});

test('пустые строки повторяемого блока не сохраняются', () => {
  const form = validation.sanitize({ education: [{}, { year: '', institution: '' }] });
  assert.deepEqual(form.education, []);
});

test('отправка без диплома и согласий не проходит', () => {
  const app = { medCenterId: 'mc', professions: [{ id: '1', name: 'Терапевт' }], consents: {} };
  const form = validation.sanitize({
    fullName: 'Иванов Иван', birthDate: '1980-01-01', phone: '+79000000000',
    startDate: '2026-09-01', experienceTotal: 10, experienceSpecialty: 8,
    scheduleDays: 'пн-пт', scheduleTime: '09:00-18:00', appointmentMinutes: 30,
    education: [{ year: 2005, institution: 'МГУ', specialty: 'Лечебное дело' }]
  });

  const withoutDocs = validation.validateForSubmit(app, form, []);
  assert.equal(withoutDocs.ok, false);
  assert.ok(withoutDocs.errors.some(e => e.field === 'diploma'));
  assert.ok(withoutDocs.errors.some(e => e.field === 'pd'));

  const ready = validation.validateForSubmit(
    { ...app, consents: { pd: { acceptedAt: 'now' }, image: { acceptedAt: 'now' } } },
    form,
    [{ kind: 'diploma' }, { kind: 'photo' }, { kind: 'certificate' }]
  );
  assert.deepEqual(ready.errors, []);
});

// Срез анкеты фильтруется на сервере: скрытие в интерфейсе обходится открытием
// ответа запроса.
test('маркетолог по бейджу не видит паспортных данных, главврач видит всё', () => {
  const app = {
    id: 'a', number: 1, status: 'submitted', medCenterId: 'mc',
    professions: [{ id: '1', name: 'Терапевт' }],
    fullName: 'Иванов Иван', phone: '+79000000000', email: 'i@example.com',
    form: { snils: '123-456', inn: '7700', badgeName: 'И. И. Иванов', bio: 'текст', photo: null },
    consents: {}
  };

  const badge = projection.project(app, 'badge', []);
  assert.equal(badge.form.badgeName, 'И. И. Иванов');
  assert.equal('snils' in badge.form, false);
  assert.equal('inn' in badge.form, false);
  assert.equal(badge.email, undefined);

  const chief = projection.project(app, '*', []);
  assert.equal(chief.form.snils, '123-456');
  assert.equal(chief.email, 'i@example.com');
});

test('сканы документов доступны только тому, кто согласовывает допуск', () => {
  assert.equal(projection.canSeeDocuments('*'), true);
  assert.equal(projection.canSeeDocuments('badge'), false);
  assert.equal(projection.canSeeDocuments('mis_account'), false);
});
