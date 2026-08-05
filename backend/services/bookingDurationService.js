'use strict';

const { DoctorServiceDuration } = require('../models');
const { misRequest } = require('./misClient');

const FALLBACK_CACHE_MS = 5 * 60 * 1000;
const fallbackCache = new Map();

function normalizeMisId(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * Старые карточки содержат и «20», и «20 мин». Неоднозначный текст намеренно
 * не угадываем: резолвер должен перейти к безопасному fallback МИС.
 */
function parseDurationMinutes(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  const text = String(value == null ? '' : value).trim().toLocaleLowerCase('ru-RU');
  const match = text.match(/^(\d+)\s*(?:мин(?:\.|ут(?:а|ы)?)?)?$/u);
  if (!match) return null;
  const minutes = Number(match[1]);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}

function normalizeRequest(input) {
  const doctorId = normalizeMisId(input.doctorId ?? input.doctor_id);
  const clinicId = normalizeMisId(input.clinicId ?? input.clinic_id);
  const serviceId = normalizeMisId(input.serviceId ?? input.service_id);
  const missing = [];
  if (!doctorId) missing.push('doctor_id');
  if (!clinicId) missing.push('clinic_id');
  if (!serviceId) missing.push('service_id');
  if (missing.length) {
    const error = new Error(`Не переданы обязательные параметры: ${missing.join(', ')}`);
    error.code = 'invalid_parameters';
    error.status = 400;
    throw error;
  }
  return { doctorId, clinicId, serviceId };
}

function extractServices(response) {
  const data = response && typeof response === 'object' && 'data' in response ? response.data : response;
  if (data == null) return [];
  return Array.isArray(data) ? data : [data];
}

async function getMisDuration(serviceId, clinicId, request = misRequest) {
  const cacheKey = `${clinicId}:${serviceId}`;
  const cached = fallbackCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.duration;

  const response = await request('getServices', {
    service_id: serviceId,
    clinic_id: clinicId,
    show_all: 1
  });
  if (Number(response?.error) !== 0) {
    const error = new Error('МИС не вернула услугу для fallback длительности');
    error.code = 'mis_service_unavailable';
    error.status = 502;
    throw error;
  }

  const service = extractServices(response).find(item =>
    normalizeMisId(item.service_id ?? item.id) === serviceId
  ) || extractServices(response)[0];
  const duration = parseDurationMinutes(service?.duration);
  if (!duration) {
    const error = new Error('У услуги в МИС не указана корректная длительность');
    error.code = 'duration_not_configured';
    error.status = 422;
    throw error;
  }

  fallbackCache.set(cacheKey, { duration, expiresAt: Date.now() + FALLBACK_CACHE_MS });
  return duration;
}

async function resolveBookingDuration(input, dependencies = {}) {
  const { doctorId, clinicId, serviceId } = normalizeRequest(input);
  const DurationModel = dependencies.DurationModel || DoctorServiceDuration;
  const row = await DurationModel.findOne({
    where: { misUserId: doctorId, clinicId, serviceId }
  });
  const override = parseDurationMinutes(row?.durationMinutes);
  if (override) {
    return {
      doctorId,
      clinicId,
      serviceId,
      duration: override,
      defaultDuration: null,
      source: 'doctor_override',
      updatedAt: row.updatedAt || null
    };
  }

  const duration = await getMisDuration(serviceId, clinicId, dependencies.misRequest || misRequest);
  return {
    doctorId,
    clinicId,
    serviceId,
    duration,
    defaultDuration: duration,
    source: 'mis_default',
    updatedAt: null
  };
}

function clearFallbackCache() {
  fallbackCache.clear();
}

module.exports = {
  normalizeMisId,
  parseDurationMinutes,
  normalizeRequest,
  getMisDuration,
  resolveBookingDuration,
  clearFallbackCache
};
