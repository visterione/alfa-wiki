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
 * Телефон в том виде, в каком его ждёт МИС: «+7 (XXX) XXX-XX-XX».
 * Публичное API форм хранит его как «+7XXXXXXXXXX».
 */
function formatMobile(raw) {
  const d = normalizePhone(raw);
  if (d.length !== 11) return String(raw || '');
  return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
}

/**
 * Заводит пациента в МИС.
 *
 * Метод принимает только ФИО, дату рождения, пол и контакты — паспорт и адрес,
 * которые собирает анкета с сайта, ему передать нечем. Их дозаполняют в МИС
 * руками по тексту заявки в чате.
 *
 * @param {Object} p
 * @param {string} p.lastName
 * @param {string} p.firstName
 * @param {string} [p.middleName]
 * @param {string} [p.birthDate]  ISO ГГГГ-ММ-ДД
 * @param {'male'|'female'} [p.gender]
 * @param {string} [p.phone]
 * @param {string} [p.email]
 * @returns {Promise<Object>} карточка пациента: { patient_id, number, ... }
 */
async function createPatient(p) {
  const params = {
    last_name:  p.lastName,
    first_name: p.firstName
  };

  if (p.middleName) params.third_name = p.middleName;
  if (p.birthDate) {
    const [y, m, d] = String(p.birthDate).split('-');
    params.birth_date = `${d}.${m}.${y}`;
  }
  if (p.gender) params.gender = p.gender === 'female' ? 2 : 1;
  if (p.phone) params.mobile = formatMobile(p.phone);
  if (p.email) params.email = p.email;

  const res = await misRequest('createPatient', params);

  // МИС отвечает { error, data }; при отказе текст ошибки лежит в error
  if (res && typeof res === 'object' && res.error) {
    throw new Error(typeof res.error === 'string' ? res.error : 'МИС отклонила создание пациента');
  }

  const data = res && typeof res === 'object' && 'data' in res ? res.data : res;
  if (!data || !data.patient_id) {
    throw new Error('МИС не вернула карточку пациента');
  }
  return data;
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
  formatMobile,
  getPatientsByPhone,
  createPatient,
  addPatientCategory,
  MIS_API_KEY,
  MIS_BASE_URL
};
