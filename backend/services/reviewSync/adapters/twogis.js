/**
 * Адаптер 2ГИС
 *
 * 2ГИС не предоставляет официальный API для отзывов бизнесам.
 * Используется публичный API отзывов (доступен без авторизации, только чтение).
 *
 * Для настройки:
 * 1. Найти branchId вашего объекта в 2ГИС:
 *    - Открыть 2ГИС → найти вашу точку → скопировать ID из URL
 *    - Формат: https://2gis.ru/city/firm/BRANCH_ID
 *    - Или через API: GET https://catalog.api.2gis.com/3.0/items?q=название&key=...
 *
 * 2. apiKey — опционально, из dev.2gis.ru (бесплатный ключ).
 *    Без ключа запросы работают, но с лимитами.
 *
 * Документация (неофициальная): https://apidocs.2gis.com
 */

const axios = require('axios');

const REVIEWS_API = 'https://public-api.reviews.2gis.com/2.0/branches';
const TIMEOUT = 15000;

/**
 * @param {object} credentials - { branchId, apiKey? }
 * @param {object} options - { since: Date }
 * @returns {Array} нормализованные отзывы
 */
async function fetchReviews(credentials, options = {}) {
  const { branchId, apiKey } = credentials;
  if (!branchId) throw new Error('Не задан branchId');

  const results = [];
  let offset = 0;
  const limit = 50;
  let hasMore = true;

  while (hasMore) {
    const params = {
      locale: 'ru_RU',
      sort_by: 'date_edited',
      limit,
      offset,
      is_advertiser: false
    };
    if (apiKey) params.key = apiKey;

    const resp = await axios.get(`${REVIEWS_API}/${branchId}/reviews`, {
      params,
      timeout: TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReviewSync/1.0)' }
    });

    const reviews = resp.data.reviews || [];
    const total = resp.data.total || 0;

    if (!reviews.length) { hasMore = false; break; }

    for (const r of reviews) {
      const reviewDate = r.date_edited
        ? new Date(r.date_edited)
        : (r.date_created ? new Date(r.date_created) : new Date());

      if (options.since && reviewDate < options.since) continue;

      results.push({
        externalId: `2gis_${r.id}`,
        externalUrl: `https://2gis.ru/firm/${branchId}/reviews`,
        authorName: r.user?.name || 'Аноним',
        rating: r.rating ? Math.round(parseFloat(r.rating)) : null,
        text: r.text || '',
        date: reviewDate,
        platformName: '2ГИС'
      });
    }

    offset += limit;
    hasMore = offset < total;
  }

  return results;
}

/**
 * Проверить подключение к 2ГИС API
 */
async function testConnection(credentials) {
  try {
    const { branchId, apiKey } = credentials;
    if (!branchId) throw new Error('Не задан branchId');

    const params = { locale: 'ru_RU', limit: 1 };
    if (apiKey) params.key = apiKey;

    const resp = await axios.get(`${REVIEWS_API}/${branchId}/reviews`, {
      params,
      timeout: TIMEOUT,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReviewSync/1.0)' }
    });
    const total = resp.data.total || 0;
    return { success: true, message: `Подключение успешно. Всего отзывов: ${total}` };
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) return { success: false, message: 'Объект не найден (проверьте branchId)' };
    return { success: false, message: err.response?.data?.message || err.message };
  }
}

const credentialsSchema = [
  { key: 'branchId', label: 'ID объекта (Branch ID)', type: 'text', placeholder: '141265769337247', required: true,
    hint: 'Число из URL вашей точки в 2ГИС: 2gis.ru/city/firm/ЭТОТ_НОМЕР' },
  { key: 'apiKey', label: 'API Key (необязательно)', type: 'text', placeholder: 'Ключ из dev.2gis.ru',
    hint: 'Опционально. Получить бесплатно на dev.2gis.ru для увеличения лимитов' }
];

module.exports = { fetchReviews, testConnection, credentialsSchema };
