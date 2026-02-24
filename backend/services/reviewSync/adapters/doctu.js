/**
 * Адаптер Докту (doctu.ru)
 *
 * Публичная документация API отсутствует.
 * Используется API личного кабинета клиники (manager.doctu.ru).
 *
 * Для настройки:
 * 1. Войти на manager.doctu.ru
 * 2. Открыть DevTools → Network → найти запросы к API
 * 3. Скопировать Authorization-заголовок (Bearer токен)
 * 4. Узнать clinicId из URL или запросов API
 *
 * ВАЖНО: Это внутренний API, может измениться без предупреждения.
 * Рекомендуется обратиться напрямую к Докту для получения официального доступа.
 * Контакт: support@doctu.ru
 *
 * Если Докту не даёт API — можно обойтись ручным вводом только для этой площадки.
 */

const axios = require('axios');

const API_BASE = 'https://manager.doctu.ru/api';
const TIMEOUT = 15000;

/**
 * @param {object} credentials - { clinicId, sessionToken }
 * @param {object} options - { since: Date }
 * @returns {Array} нормализованные отзывы
 */
async function fetchReviews(credentials, options = {}) {
  const { clinicId, sessionToken } = credentials;
  if (!clinicId || !sessionToken) throw new Error('Не заданы clinicId или sessionToken');

  const results = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const resp = await axios.get(`${API_BASE}/clinics/${clinicId}/reviews`, {
      params: { page, per_page: 100 },
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        Accept: 'application/json'
      },
      timeout: TIMEOUT
    });

    const data = resp.data;
    const reviews = data.data || data.reviews || data.items || [];

    if (!reviews.length) { hasMore = false; break; }

    for (const r of reviews) {
      const reviewDate = r.created_at || r.date
        ? new Date(r.created_at || r.date)
        : new Date();

      if (options.since && reviewDate < options.since) continue;

      results.push({
        externalId: `doctu_${r.id}`,
        externalUrl: r.url || `https://doctu.ru/clinic/${clinicId}`,
        authorName: r.author?.name || r.patient_name || r.name || 'Аноним',
        rating: r.rating ? Math.round(parseFloat(r.rating)) : null,
        text: r.text || r.comment || '',
        date: reviewDate,
        platformName: 'Докту',
        doctorName: r.doctor?.name || r.doctor_name || null
      });
    }

    const total = data.total || 0;
    page++;
    hasMore = reviews.length === 100 && results.length < total;
  }

  return results;
}

/**
 * Проверить подключение к Докту API
 */
async function testConnection(credentials) {
  try {
    const { clinicId, sessionToken } = credentials;
    if (!clinicId || !sessionToken) throw new Error('Не заданы clinicId или sessionToken');
    await axios.get(`${API_BASE}/clinics/${clinicId}/reviews`, {
      params: { page: 1, per_page: 1 },
      headers: { Authorization: `Bearer ${sessionToken}` },
      timeout: TIMEOUT
    });
    return { success: true, message: 'Подключение успешно' };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) return { success: false, message: 'Неверный токен (обновите sessionToken из браузера)' };
    if (status === 404) return { success: false, message: 'Клиника не найдена (проверьте clinicId)' };
    return { success: false, message: err.response?.data?.message || err.message };
  }
}

const credentialsSchema = [
  { key: 'clinicId', label: 'ID клиники', type: 'text', placeholder: '12345', required: true,
    hint: 'Из URL в manager.doctu.ru' },
  { key: 'sessionToken', label: 'Session Token', type: 'password', placeholder: 'Bearer токен из DevTools', required: true,
    hint: 'Открыть manager.doctu.ru → DevTools → Network → скопировать Authorization header. Или запросить официальный API у support@doctu.ru' }
];

module.exports = { fetchReviews, testConnection, credentialsSchema };
