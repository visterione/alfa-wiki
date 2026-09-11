'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const medCenters = require('../services/medCenters');
const branches = require('../services/notifications/branches');

// Справочник подменяем целиком: проверяем порядок сопоставления, а поход в базу
// к нему ничего не добавляет — сами резолверы разобраны в medCenterIndex.test.js.
const ROWS = [
  { id: 'id-liniya', name: 'Линия', misClinicIds: ['5'] },
  { id: 'id-alfa', name: 'Альфа', misClinicIds: ['2'] },
  // Новый филиал, которому id в справочнике ещё не проставили.
  { id: 'id-zabor', name: 'Забор Крови', misClinicIds: [] }
];

const original = { byMisId: medCenters.byMisId, byName: medCenters.byName };

test.before(() => {
  medCenters.byMisId = async (clinic) => {
    if (clinic === null || clinic === undefined || clinic === '') return null;
    const raw = String(clinic);
    return ROWS.find(row => row.misClinicIds.includes(raw)) || null;
  };
  medCenters.byName = async (name) => ROWS.find(
    row => row.name.trim().toLowerCase() === String(name || '').trim().toLowerCase()
  ) || null;
});

test.after(() => {
  medCenters.byMisId = original.byMisId;
  medCenters.byName = original.byName;
});

test('филиал находится по id клиники, когда названия разошлись', async () => {
  // Ровно случай боевой базы: в МИС «Альфа Линия», в справочнике «Линия».
  // По имени такой визит не сопоставлялся ни с чем, и уведомления по филиалу
  // не заводились вовсе — даже строки в журнале не появлялось.
  const mc = await branches.find({ clinicId: 5, clinicName: 'Альфа Линия' });
  assert.equal(mc.id, 'id-liniya');
});

test('id важнее имени', async () => {
  const mc = await branches.find({ clinicId: 5, clinicName: 'Альфа' });
  assert.equal(mc.id, 'id-liniya', 'имя другого филиала не должно перебивать id');
});

test('филиалу без id в справочнике остаётся сопоставление по имени', async () => {
  const mc = await branches.find({ clinicId: 77, clinicName: 'Забор Крови' });
  assert.equal(mc.id, 'id-zabor');
});

test('имя сравнивается без учёта регистра и лишних пробелов', async () => {
  const mc = await branches.find({ clinicName: '  забор крови ' });
  assert.equal(mc.id, 'id-zabor');
});

test('незнакомая клиника — null, а не исключение', async () => {
  assert.equal(await branches.find({ clinicId: 999, clinicName: 'Чужая' }), null);
  assert.equal(await branches.find({}), null);
  assert.equal(await branches.find(null), null);
});

test('idFor отдаёт идентификатор филиала или null', async () => {
  assert.equal(await branches.idFor({ clinicId: 2 }), 'id-alfa');
  assert.equal(await branches.idFor({ clinicName: 'Чужая' }), null);
  assert.equal(await branches.idFor(null), null);
});
