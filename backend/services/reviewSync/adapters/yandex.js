/**
 * Адаптер Яндекс.Карты / Яндекс.Бизнес
 *
 * Официального публичного API для отзывов у Яндекса нет.
 * Используется внутреннее API личного кабинета Яндекс.Бизнес,
 * которое доступно авторизованным пользователям через OAuth-токен.
 *
 * Для настройки:
 * 1. Получить OAuth-токен Яндекс: https://oauth.yandex.ru/
 *    Приложение должно иметь права на "Яндекс Бизнес" (scope: yabusiness:read)
 *    ИЛИ использовать токен из браузера (временный, нужно обновлять)
 *
 * 2. Узнать ID организации (organizationId):
 *    Зайти в https://business.yandex.ru → ваша точка → в URL будет ID
 *
 * ВАЖНО: Яндекс официально не предоставляет API для отзывов сторонним приложениям.
 * Этот адаптер использует внутренние эндпоинты — Яндекс может их изменить.
 * Рекомендуется уточнить у Яндекс.Бизнес наличие партнёрского API.
 */

const axios = require('axios');

const API_BASE = 'https://api.sprav.yandex.net/v1';
const TIMEOUT = 15000;

/**
 * @param {object} credentials - { oauthToken, organizationId }
 * @param {object} options - { since: Date }
 * @returns {Array} нормализованные отзывы
 */
async function fetchReviews(credentials, options = {}) {
  const { oauthToken, organizationId } = credentials;
  if (!oauthToken || !organizationId) throw new Error('Не заданы oauthToken или organizationId');

  const results = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const resp = await axios.get(`${API_BASE}/companies/${organizationId}/reviews`, {
      params: {
        limit,
        offset,
        sort: 'updated',
        order: 'asc'
      },
      headers: {
        Authorization: `OAuth ${oauthToken}`,
        'Content-Type': 'application/json'
      },
      timeout: TIMEOUT
    });

    const reviews = resp.data.items || resp.data.reviews || [];
    if (!reviews.length) { hasMore = false; break; }

    for (const r of reviews) {
      const reviewDate = r.updatedAt || r.createdAt
        ? new Date(r.updatedAt || r.createdAt)
        : new Date();

      if (options.since && reviewDate < options.since) continue;

      const rating = r.rating?.value
        ? Math.round(parseFloat(r.rating.value))
        : (r.rating ? Math.round(parseFloat(r.rating)) : null);

      results.push({
        externalId: `yandex_${r.id}`,
        externalUrl: r.url || `https://yandex.ru/maps/org/${organizationId}/reviews/`,
        authorName: r.author?.name || r.authorName || 'Аноним',
        rating,
        text: r.text || '',
        date: reviewDate,
        platformName: 'Яндекс Карты'
      });
    }

    offset += limit;
    hasMore = reviews.length === limit;
  }

  return results;
}

/**
 * Проверить подключение к Яндекс API
 */
async function testConnection(credentials) {
  try {
    const { oauthToken, organizationId } = credentials;
    if (!oauthToken || !organizationId) throw new Error('Не заданы oauthToken или organizationId');
    await axios.get(`${API_BASE}/companies/${organizationId}/reviews`, {
      params: { limit: 1, offset: 0 },
      headers: { Authorization: `OAuth ${oauthToken}` },
      timeout: TIMEOUT
    });
    return { success: true, message: 'Подключение успешно' };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) return { success: false, message: 'Неверный токен (401)' };
    if (status === 403) return { success: false, message: 'Нет доступа к организации (403)' };
    return { success: false, message: err.response?.data?.message || err.message };
  }
}

const credentialsSchema = [
  { key: 'oauthToken', label: 'OAuth Токен Яндекс', type: 'password', placeholder: 'y0_Ag...', required: true,
    hint: 'Получить на oauth.yandex.ru. Если Яндекс не выдаёт API-доступ — уточнить у менеджера Яндекс.Бизнес' },
  { key: 'organizationId', label: 'ID организации', type: 'text', placeholder: '12345678', required: true,
    hint: 'Число из URL вашей организации в Яндекс.Бизнес' }
];

module.exports = { fetchReviews, testConnection, credentialsSchema };
