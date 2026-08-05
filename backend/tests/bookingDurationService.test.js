'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDurationMinutes,
  normalizeRequest,
  resolveBookingDuration,
  clearFallbackCache
} = require('../services/bookingDurationService');

test('parseDurationMinutes accepts legacy numeric minute formats', () => {
  assert.equal(parseDurationMinutes(20), 20);
  assert.equal(parseDurationMinutes('20'), 20);
  assert.equal(parseDurationMinutes('20 мин'), 20);
  assert.equal(parseDurationMinutes('20 минут'), 20);
  assert.equal(parseDurationMinutes('20мин.'), 20);
});

test('parseDurationMinutes rejects ambiguous and invalid values', () => {
  assert.equal(parseDurationMinutes('20–30'), null);
  assert.equal(parseDurationMinutes('около часа'), null);
  assert.equal(parseDurationMinutes('0'), null);
  assert.equal(parseDurationMinutes(-5), null);
  assert.equal(parseDurationMinutes(12.5), null);
});

test('normalizeRequest accepts public API parameter names and reports missing fields', () => {
  assert.deepEqual(normalizeRequest({ doctor_id: 1, clinic_id: 2, service_id: 3 }), {
    doctorId: '1', clinicId: '2', serviceId: '3'
  });
  assert.throws(
    () => normalizeRequest({ doctor_id: 1 }),
    error => error.code === 'invalid_parameters' && error.status === 400
  );
});

test('resolveBookingDuration returns doctor override without calling MIS', async () => {
  let misCalls = 0;
  const result = await resolveBookingDuration(
    { doctor_id: 10, clinic_id: 2, service_id: 99 },
    {
      DurationModel: {
        findOne: async () => ({ durationMinutes: 30, updatedAt: new Date('2026-01-01T00:00:00Z') })
      },
      misRequest: async () => { misCalls++; }
    }
  );
  assert.equal(result.duration, 30);
  assert.equal(result.source, 'doctor_override');
  assert.equal(misCalls, 0);
});

test('resolveBookingDuration falls back to getServices duration', async () => {
  clearFallbackCache();
  let requestArgs;
  const result = await resolveBookingDuration(
    { doctor_id: 10, clinic_id: 2, service_id: 99 },
    {
      DurationModel: { findOne: async () => null },
      misRequest: async (endpoint, params) => {
        requestArgs = { endpoint, params };
        return { error: 0, data: [{ service_id: 99, duration: '50' }] };
      }
    }
  );
  assert.equal(result.duration, 50);
  assert.equal(result.defaultDuration, 50);
  assert.equal(result.source, 'mis_default');
  assert.equal(requestArgs.endpoint, 'getServices');
  assert.equal(requestArgs.params.clinic_id, '2');
});

test('resolveBookingDuration fails clearly when MIS duration is invalid', async () => {
  clearFallbackCache();
  await assert.rejects(
    resolveBookingDuration(
      { doctor_id: 10, clinic_id: 2, service_id: 100 },
      {
        DurationModel: { findOne: async () => null },
        misRequest: async () => ({ error: 0, data: [{ service_id: 100, duration: '' }] })
      }
    ),
    error => error.code === 'duration_not_configured' && error.status === 422
  );
});
