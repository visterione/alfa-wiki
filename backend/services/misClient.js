/**
 * Тонкий клиент к API МИС Renovatio.
 * Вынесен из routes/mis-proxy.js, чтобы переиспользовать в клиентских ботах.
 */
const axios = require('axios');
const qs = require('qs');

const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const REQUEST_TIMEOUT = 15000;

async function misRequest(endpoint, params = {}) {
  const response = await axios.post(
    `${MIS_BASE_URL}/${endpoint}`,
    qs.stringify({ api_key: MIS_API_KEY, ...params }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: REQUEST_TIMEOUT
    }
  );
  return response.data;
}

/**
 * Нормализует телефон к 11 цифрам РФ (7XXXXXXXXXX).
 * Поиск в МИС терпим к формату, но нормализуем для детерминированности и хранения.
 */
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (digits.length === 10) digits = '7' + digits;
  return digits;
}

/**
 * Ищет пациентов по мобильному телефону.
 * Ответ МИС: { error, data }, где data — null | объект | массив объектов.
 * Возвращает всегда массив (по одному номеру может быть несколько карт — семьи).
 */
async function getPatientsByPhone(mobile) {
  const res = await misRequest('getPatient', { mobile: normalizePhone(mobile) });
  const data = res && typeof res === 'object' && 'data' in res ? res.data : res;
  if (data == null) return [];
  return Array.isArray(data) ? data : [data];
}

/**
 * Добавляет категорию пациенту. МИС возвращает true при успехе.
 */
async function addPatientCategory(patientId, categoryId) {
  const res = await misRequest('addPatientCategory', {
    patient_id: patientId,
    category_id: categoryId
  });
  const value = res && typeof res === 'object' && 'data' in res ? res.data : res;
  return value === true || value === 'true' || value === 1 || value === '1';
}

module.exports = {
  misRequest,
  normalizePhone,
  getPatientsByPhone,
  addPatientCategory,
  MIS_API_KEY,
  MIS_BASE_URL
};
