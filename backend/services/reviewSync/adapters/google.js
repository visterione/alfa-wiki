/**
 * Адаптер Google Business Profile (бывший Google My Business)
 *
 * Для настройки нужно:
 * 1. Google Cloud Console → создать проект
 * 2. Включить API: "My Business Account Management API" + "My Business Reviews API"
 * 3. Создать OAuth2 credentials (Web application)
 * 4. Пройти OAuth-поток и получить refresh_token (один раз)
 * 5. Вставить clientId, clientSecret, refreshToken, locationName в настройках доски
 *
 * locationName формат: "accounts/ACCOUNT_ID/locations/LOCATION_ID"
 * Найти можно на: https://business.google.com → ваша точка → URL содержит location ID
 */

const axios = require('axios');

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://mybusiness.googleapis.com/v4';
const SCOPE = 'https://www.googleapis.com/auth/business.manage';

/**
 * Получить актуальный access_token через refresh_token
 */
async function getAccessToken(credentials) {
  const { clientId, clientSecret, refreshToken } = credentials;
  const resp = await axios.post(OAUTH_TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }, { headers: { 'Content-Type': 'application/json' } });
  return resp.data.access_token;
}

/**
 * Получить отзывы с Google Business Profile
 * @param {object} credentials - { clientId, clientSecret, refreshToken, locationName }
 * @param {object} options - { since: Date }
 * @returns {Array} нормализованные отзывы
 */
async function fetchReviews(credentials, options = {}) {
  const { locationName } = credentials;
  if (!locationName) throw new Error('locationName не задан (формат: accounts/XXX/locations/YYY)');

  const accessToken = await getAccessToken(credentials);
  const results = [];
  let pageToken = null;

  do {
    const params = { pageSize: 100 };
    if (pageToken) params.pageToken = pageToken;

    const resp = await axios.get(
      `${API_BASE}/${locationName}/reviews`,
      {
        params,
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    const reviews = resp.data.reviews || [];
    for (const r of reviews) {
      const reviewDate = new Date(r.createTime);
      if (options.since && reviewDate < options.since) continue;

      results.push({
        externalId: `google_${r.reviewId}`,
        externalUrl: `https://search.google.com/local/reviews?placeid=${locationName.split('/').pop()}`,
        authorName: r.reviewer?.displayName || 'Аноним',
        rating: r.starRating ? starRatingToNumber(r.starRating) : null,
        text: r.comment || '',
        date: reviewDate,
        platformName: 'Google Maps'
      });
    }

    pageToken = resp.data.nextPageToken || null;
  } while (pageToken);

  return results;
}

function starRatingToNumber(starRating) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[starRating] || null;
}

/**
 * Проверить подключение к Google API
 */
async function testConnection(credentials) {
  try {
    const { locationName } = credentials;
    if (!locationName) throw new Error('Не указан locationName');
    const accessToken = await getAccessToken(credentials);
    await axios.get(
      `${API_BASE}/${locationName}/reviews`,
      {
        params: { pageSize: 1 },
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );
    return { success: true, message: 'Подключение успешно' };
  } catch (err) {
    return { success: false, message: err.response?.data?.error?.message || err.message };
  }
}

/**
 * Описание полей credentials для отображения в UI
 */
const credentialsSchema = [
  { key: 'clientId', label: 'Client ID', type: 'text', placeholder: 'xxxx.apps.googleusercontent.com', required: true },
  { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'GOCSPX-...', required: true },
  { key: 'refreshToken', label: 'Refresh Token', type: 'password', placeholder: '1//04...', required: true },
  { key: 'locationName', label: 'Location Name', type: 'text', placeholder: 'accounts/123456789/locations/987654321', required: true,
    hint: 'Найти в URL вашей точки в Google Business Profile' }
];

module.exports = { fetchReviews, testConnection, credentialsSchema };
