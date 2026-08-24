'use strict';

const test = require('node:test');
const assert = require('node:assert');

const sla = require('../services/onboarding/sla');
const access = require('../services/onboarding/access');
const assignments = require('../services/onboarding/assignments');

// Сроки шагов заказчик просил считать в рабочих часах. Календарные ломаются на
// первой же пятнице: «4 часа на учётку» в 17:00 истекают ночью, и в понедельник
// задача просрочена, хотя никто ничего не нарушил.
test('четыре рабочих часа от пятницы 16:00 переезжают на понедельник', async () => {
  const friday = new Date(2026, 7, 21, 16, 0, 0); // пятница
  const due = await sla.dueAfterWorkingHours(4, friday);

  assert.equal(due.getDay(), 1, 'срок должен приходиться на понедельник');
  assert.equal(due.getHours(), 11, 'два часа пятницы (16–18) + два часа понедельника (9–11)');
});

test('срок внутри одного рабочего дня не переносится', async () => {
  const monday = new Date(2026, 7, 24, 10, 0, 0);
  const due = await sla.dueAfterWorkingHours(4, monday);

  assert.equal(due.getDate(), 24);
  assert.equal(due.getHours(), 14);
});

test('задача, поставленная ночью, получает свои часы с утра', async () => {
  const night = new Date(2026, 7, 24, 2, 0, 0);
  const due = await sla.dueAfterWorkingHours(4, night);

  assert.equal(due.getDate(), 24);
  assert.equal(due.getHours(), 13, 'отсчёт с 9:00, а не задним числом');
});

test('выходные не считаются просрочкой', async () => {
  const dueAt = new Date(2026, 7, 21, 17, 0, 0);   // пятница, 17:00
  const monday = new Date(2026, 7, 24, 10, 0, 0);  // понедельник, 10:00

  const hours = await sla.overdueWorkingHours(dueAt, monday);
  assert.equal(hours, 2, 'час пятницы + час понедельника');
});

// Видимость заявок — это условие в SQL, а не фильтр в интерфейсе: иначе
// достаточно поправить адрес запроса, чтобы увидеть чужие.
test('без назначений заявок не видно даже при доступе к разделу', () => {
  const acl = { allowed: true, isAdmin: false, steps: [], medCenterIds: [], networkSteps: [] };
  assert.deepEqual(access.scopeWhere(acl), { id: null });
});

test('филиальное назначение ограничивает список своим филиалом', () => {
  const acl = {
    allowed: true, isAdmin: false,
    steps: ['badge'], medCenterIds: ['mc-1'], networkSteps: []
  };
  const where = access.scopeWhere(acl);
  assert.ok(where.medCenterId, 'должен быть фильтр по филиалу');
});

test('сетевое назначение показывает заявки всех филиалов', () => {
  const acl = {
    allowed: true, isAdmin: false,
    steps: ['mis_account'], medCenterIds: [], networkSteps: ['mis_account']
  };
  assert.deepEqual(access.scopeWhere(acl), {});
});

// Один человек может быть назначен на несколько шагов. Показывать ему при этом
// самый узкий срез было бы неверно.
test('при нескольких назначениях берётся самый широкий срез', () => {
  const app = { medCenterId: 'mc-1' };
  const acl = {
    allowed: true, isAdmin: false,
    grants: [
      { stepKey: assignments.CHIEF_STEP, medCenterId: 'mc-1' },
      { stepKey: 'badge', medCenterId: 'mc-1' }
    ],
    steps: [assignments.CHIEF_STEP, 'badge'],
    medCenterIds: ['mc-1'], networkSteps: []
  };
  assert.equal(access.viewKeyFor(acl, app), '*');
});

test('филиальное назначение не открывает заявку чужого филиала', () => {
  const acl = {
    allowed: true, isAdmin: false,
    grants: [{ stepKey: assignments.CHIEF_STEP, medCenterId: 'mc-1' }],
    steps: [assignments.CHIEF_STEP], medCenterIds: ['mc-1'], networkSteps: []
  };
  assert.equal(access.viewKeyFor(acl, { medCenterId: 'mc-2' }), null);
  assert.equal(access.canDecide(acl, { medCenterId: 'mc-2' }), false);
  assert.equal(access.canDecide(acl, { medCenterId: 'mc-1' }), true);
});

// Смешанные назначения — тот случай, на котором ломались плоские списки шагов и
// филиалов: по ним «главврач в Кидс» получал права главврача и в Альфе.
test('права главврача не перетекают в филиал, где человек назначен маркетологом', () => {
  const acl = {
    allowed: true, isAdmin: false,
    grants: [
      { stepKey: assignments.CHIEF_STEP, medCenterId: 'kids' },
      { stepKey: 'badge', medCenterId: 'alfa' }
    ],
    steps: [assignments.CHIEF_STEP, 'badge'],
    medCenterIds: ['kids', 'alfa'], networkSteps: []
  };

  assert.equal(access.canDecide(acl, { medCenterId: 'kids' }), true);
  assert.equal(access.canDecide(acl, { medCenterId: 'alfa' }), false);
  // И срез в «Альфе» должен быть маркетологский, а не полный.
  assert.equal(access.viewKeyFor(acl, { medCenterId: 'alfa' }), 'badge');
  assert.equal(access.viewKeyFor(acl, { medCenterId: 'kids' }), '*');
});

test('сетевое назначение действует во всех филиалах', () => {
  const acl = {
    allowed: true, isAdmin: false,
    grants: [{ stepKey: 'mis_account', medCenterId: null }],
    steps: ['mis_account'], medCenterIds: [], networkSteps: ['mis_account']
  };
  assert.equal(access.viewKeyFor(acl, { medCenterId: 'любой' }), 'mis_account');
});

test('администратор портала видит всё — иначе раздел заперт сам от себя', () => {
  const acl = { allowed: true, isAdmin: true, steps: [], medCenterIds: [], networkSteps: [] };
  assert.deepEqual(access.scopeWhere(acl), {});
  assert.equal(access.viewKeyFor(acl, { medCenterId: 'любой' }), '*');
});
