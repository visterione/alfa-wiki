'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canWriteScheduleClinic } = require('../utils/rbScheduleAccess');

test('администратор может редактировать расписание любой клиники', () => {
  assert.equal(canWriteScheduleClinic({ isAdmin: true, clinicId: '6' }), true);
});

test('право edit с пустым списком клиник означает доступ ко всем клиникам', () => {
  assert.equal(canWriteScheduleClinic({
    permission: { tabSchedule: 'edit', clinics: [] },
    clinicId: '6',
  }), true);
});

test('сотрудник может редактировать только клиники из своей области прав', () => {
  const permission = { tabSchedule: 'edit', clinics: ['6'] };
  assert.equal(canWriteScheduleClinic({ permission, clinicId: 6 }), true);
  assert.equal(canWriteScheduleClinic({ permission, clinicId: '2' }), false);
});

test('исторический id клиники разрешается через канонический id', () => {
  assert.equal(canWriteScheduleClinic({
    permission: { tabSchedule: 'edit', clinics: ['11'] },
    clinicId: '12',
    canonicalClinicId: '11',
  }), true);
});

test('отсутствие прав или режим read запрещают изменение', () => {
  assert.equal(canWriteScheduleClinic({ permission: null, clinicId: '6' }), false);
  assert.equal(canWriteScheduleClinic({
    permission: { tabSchedule: 'read', clinics: ['6'] },
    clinicId: '6',
  }), false);
});
