/**
 * Адаптер НаПоправку (napopravku.ru)
 *
 * НаПоправку поглощена СберЗдоровье (та же экосистема, что и DocDoc).
 * Платформы работают на единой инфраструктуре.
 * API доступен партнёрам через developer.sber.ru
 *
 * Для настройки:
 * 1. Обратиться к менеджеру НаПоправку / СберЗдоровье
 * 2. Получить API-токен для вашей клиники
 * 3. Узнать clinicId на napopravku.ru
 *
 * Контакт: help@napopravku.ru
 * Разработчикам: developer.sber.ru/product/docdoc1
 */

const axios = require('axios');

const API_BASE = 'https://www.napopravku.ru/api/v1';
const TIMEOUT = 15000;

/**
 * @param {object} credentials - { apiToken, clinicId }
 * @param {object} options - { since: Date }
 * @returns {Array} нормализованные отзывы
 */
async function fetchReviews(credentials, options = {}) {
  const { apiToken, clinicId } = credentials;
  if (!apiToken || !clinicId) throw new Error('Не заданы apiToken или clinicId');

  const results = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    const resp = await axios.get(`${API_BASE}/lpu/${clinicId}/reviews`, {
      params: { page, per_page: perPage },
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json'
      },
      timeout: TIMEOUT
    });

    const data = resp.data;
    const reviews = data.data || data.results || data.reviews || [];

    if (!reviews.length) { hasMore = false; break; }

    for (const r of reviews) {
      const reviewDate = r.created_at || r.date
        ? new Date(r.created_at || r.date)
        : new Date();

      if (options.since && reviewDate < options.since) continue;

      const ratingRaw = r.rating || r.mark;
      const rating = ratingRaw ? Math.round(parseFloat(ratingRaw)) : null;

      results.push({
        externalId: `napopravku_${r.id}`,
        externalUrl: r.url || `https://napopravku.ru/lpu/${clinicId}/#reviews`,
        authorName: r.author?.name || r.client_name || r.name || 'Аноним',
        rating,
        text: [r.text, r.comment, r.plus, r.minus].filter(Boolean).join('\n').trim() || '',
        date: reviewDate,
        platformName: 'НаПоправку',
        doctorName: getDoctorName(r)
      });
    }

    const total = data.total || data.count || 0;
    page++;
    hasMore = reviews.length === perPage && results.length < total;
  }

  return results;
}

function getDoctorName(review) {
  const candidates = [
    review.doctor?.name,
    review.doctor?.full_name,
    review.doctor?.fullName,
    review.doctor_name,
    review.doctorName,
    review.specialist?.name,
    review.specialist_name,
    review.specialistName,
    review.employee?.name,
    review.employee_name,
    review.employeeName,
  ];
  const value = candidates.find(v => String(v || '').trim());
  return value ? String(value).trim() : null;
}

/**
 * Проверить подключение к НаПоправку API
 */
async function testConnection(credentials) {
  try {
    const { apiToken, clinicId } = credentials;
    if (!apiToken || !clinicId) throw new Error('Не заданы apiToken или clinicId');
    await axios.get(`${API_BASE}/lpu/${clinicId}/reviews`, {
      params: { page: 1, per_page: 1 },
      headers: { Authorization: `Bearer ${apiToken}` },
      timeout: TIMEOUT
    });
    return { success: true, message: 'Подключение успешно' };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) return { success: false, message: 'Неверный токен или нет доступа' };
    if (status === 404) return { success: false, message: 'Клиника не найдена (проверьте clinicId)' };
    return { success: false, message: err.response?.data?.message || err.message };
  }
}

const credentialsSchema = [
  { key: 'apiToken', label: 'API Token НаПоправку', type: 'password', placeholder: 'Токен от менеджера НаПоправку', required: true,
    hint: 'Запросить у менеджера. Контакт: help@napopravku.ru' },
  { key: 'clinicId', label: 'ID клиники', type: 'text', placeholder: '12345', required: true,
    hint: 'Число из URL вашей клиники на napopravku.ru' }
];

module.exports = { fetchReviews, testConnection, credentialsSchema };
