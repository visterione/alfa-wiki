/**
 * Адаптер DocDoc (СберЗдоровье)
 *
 * DocDoc является частью экосистемы СберЗдоровье.
 * API доступен партнёрам — необходимо заключить соглашение.
 *
 * Для настройки:
 * 1. Обратиться к менеджеру DocDoc / СберЗдоровье для получения API-токена
 * 2. Узнать clinicId вашей клиники в системе DocDoc
 *    (виден в URL личного кабинета на docdoc.ru)
 *
 * Официальная документация (для партнёров): https://dd1012.docs.apiary.io/
 * Контакт: info@docdoc.ru
 */

const axios = require('axios');

const API_BASE = 'https://docdoc.ru/api/partner/v2';
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
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const resp = await axios.get(`${API_BASE}/clinic/${clinicId}/reviews`, {
      params: { offset, count: limit },
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'X-API-Token': apiToken
      },
      timeout: TIMEOUT
    });

    const data = resp.data;
    const reviews = data.ReviewList || data.reviews || data.items || [];

    if (!reviews.length) { hasMore = false; break; }

    for (const r of reviews) {
      const reviewDate = r.CreateDate || r.date
        ? new Date(r.CreateDate || r.date)
        : new Date();

      if (options.since && reviewDate < options.since) continue;

      const rating = r.Rating || r.rating
        ? Math.round(parseFloat(r.Rating || r.rating))
        : null;

      results.push({
        externalId: `docdoc_${r.Id || r.id}`,
        externalUrl: r.Url || r.url || `https://docdoc.ru/clinic/${clinicId}#reviews`,
        authorName: r.Client || r.client?.name || r.clientName || 'Аноним',
        rating,
        text: r.Text || r.text || '',
        date: reviewDate,
        platformName: 'DocDoc',
        doctorName: r.DoctorName || r.doctorName || null
      });
    }

    offset += limit;
    hasMore = reviews.length === limit;
  }

  return results;
}

/**
 * Проверить подключение к DocDoc API
 */
async function testConnection(credentials) {
  try {
    const { apiToken, clinicId } = credentials;
    if (!apiToken || !clinicId) throw new Error('Не заданы apiToken или clinicId');
    await axios.get(`${API_BASE}/clinic/${clinicId}/reviews`, {
      params: { offset: 0, count: 1 },
      headers: { Authorization: `Bearer ${apiToken}`, 'X-API-Token': apiToken },
      timeout: TIMEOUT
    });
    return { success: true, message: 'Подключение успешно' };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) return { success: false, message: 'Неверный токен или нет доступа' };
    if (status === 404) return { success: false, message: 'Клиника не найдена (проверьте clinicId)' };
    return { success: false, message: err.response?.data?.error || err.message };
  }
}

const credentialsSchema = [
  { key: 'apiToken', label: 'API Token DocDoc', type: 'password', placeholder: 'Токен от менеджера DocDoc', required: true,
    hint: 'Запросить у менеджера DocDoc/СберЗдоровье. Email: info@docdoc.ru' },
  { key: 'clinicId', label: 'ID клиники', type: 'text', placeholder: '12345', required: true,
    hint: 'Число из URL вашей клиники на docdoc.ru' }
];

module.exports = { fetchReviews, testConnection, credentialsSchema };
