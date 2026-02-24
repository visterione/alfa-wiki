/**
 * Адаптер ПроДокторов
 *
 * Для настройки нужно:
 * 1. Запросить API-токен у ПроДокторов (через личный кабинет партнёра)
 * 2. Узнать ID вашей клиники (filialId) — виден в URL личного кабинета
 *    или запросить у менеджера площадки
 *
 * Документация: https://api.prodoctorov.ru/v2/
 * Раздел "Отзывы": /v2/feedback/?filial=CLINIC_ID&token=TOKEN
 */

const axios = require('axios');

const API_BASE = 'https://api.prodoctorov.ru/v2';
const TIMEOUT = 15000;

/**
 * Извлекает имя врача из текста по паттерну "Лечащий врач: Фамилия Имя [Отчество]".
 * Возвращает { doctorName, cleanText } — текст без этой строки.
 */
function extractDoctorFromText(text) {
  if (!text) return { doctorName: null, cleanText: text };
  const match = text.match(/Лечащий врач:\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})/);
  if (!match) return { doctorName: null, cleanText: text };
  const doctorName = match[1].trim();
  const cleanText = text.replace(match[0], '').trim();
  return { doctorName, cleanText };
}

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
  let hasMore = true;

  while (hasMore) {
    const resp = await axios.get(`${API_BASE}/feedback/`, {
      params: {
        token: apiToken,
        filial: clinicId,
        page,
        page_size: 100
      },
      timeout: TIMEOUT
    });

    const data = resp.data;
    // API ПроДокторов возвращает { results: [...], next: url | null }
    const feedbacks = data.results || data || [];

    if (!Array.isArray(feedbacks) || feedbacks.length === 0) {
      hasMore = false;
      break;
    }

    for (const f of feedbacks) {
      const reviewDate = f.date ? new Date(f.date) : new Date();
      if (options.since && reviewDate < options.since) {
        hasMore = false;
        break;
      }

      const rawText = [f.text_plus, f.text_minus, f.text].filter(Boolean).join('\n').trim() || '';
      let doctorName = f.doctor_name || null;
      let reviewText = rawText;
      if (!doctorName) {
        const extracted = extractDoctorFromText(rawText);
        doctorName = extracted.doctorName;
        reviewText = extracted.cleanText;
      }

      results.push({
        externalId: `prodoctorov_${f.id}`,
        externalUrl: f.url || `https://prodoctorov.ru/lpu/${clinicId}/otzyvy/`,
        authorName: f.client_name || f.name || 'Аноним',
        rating: f.rate ? Math.round(parseFloat(f.rate)) : null,
        text: reviewText,
        date: reviewDate,
        platformName: 'ПроДокторов',
        doctorName
      });
    }

    hasMore = !!data.next && feedbacks.length > 0;
    page++;
  }

  return results;
}

/**
 * Проверить подключение к ПроДокторов API
 */
async function testConnection(credentials) {
  try {
    const { apiToken, clinicId } = credentials;
    if (!apiToken || !clinicId) throw new Error('Не заданы apiToken или clinicId');
    await axios.get(`${API_BASE}/feedback/`, {
      params: { token: apiToken, filial: clinicId, page_size: 1 },
      timeout: TIMEOUT
    });
    return { success: true, message: 'Подключение успешно' };
  } catch (err) {
    return { success: false, message: err.response?.data?.detail || err.message };
  }
}

const credentialsSchema = [
  { key: 'apiToken', label: 'API Token', type: 'password', placeholder: 'Токен из личного кабинета ПроДокторов', required: true },
  { key: 'clinicId', label: 'ID клиники (filial)', type: 'text', placeholder: '12345', required: true,
    hint: 'Видно в URL личного кабинета или уточнить у менеджера ПроДокторов' }
];

module.exports = { fetchReviews, testConnection, credentialsSchema };
