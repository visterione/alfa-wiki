/**
 * Cron-задача: опрос Nextcloud на наличие пропущенных звонков от АТС
 *
 * Каждую минуту обращается к PHP-файлу на Nextcloud (GET-запрос),
 * забирает накопленную очередь звонков и маршрутизирует каждый
 * в групповой чат соответствующего МЦ по номеру 8800 из текста.
 *
 * Переменные окружения:
 *   MISSED_CALLS_NEXTCLOUD_URL        — URL PHP-файла на Nextcloud
 *   MISSED_CALLS_ROUTE_8800XXXXXXX    — UUID чата для данного номера МЦ
 *   MISSED_CALLS_FALLBACK_CHAT_ID     — UUID чата для нераспознанных номеров
 */

const cron = require('node-cron');
const axios = require('axios');
const https = require('https');
const notificationService = require('../services/notificationService');

// Nextcloud использует самоподписанный сертификат — отключаем проверку
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const SCHEDULE = '* * * * *'; // каждую минуту

const NEXTCLOUD_URL = process.env.MISSED_CALLS_NEXTCLOUD_URL;
const FALLBACK_CHAT_ID = process.env.MISSED_CALLS_FALLBACK_CHAT_ID || null;

// Строим карту маршрутизации из переменных окружения вида MISSED_CALLS_ROUTE_8800XXXXXXX
const ROUTING_MAP = {};
for (const [key, value] of Object.entries(process.env)) {
  const match = key.match(/^MISSED_CALLS_ROUTE_(8800\d+)$/);
  if (match && value) {
    ROUTING_MAP[match[1]] = value;
  }
}

console.log('[MissedCalls Cron] Initializing missed calls polling job (every minute)');
console.log(`[MissedCalls Cron] Routing map: ${JSON.stringify(ROUTING_MAP)}`);
console.log(`[MissedCalls Cron] Fallback chat: ${FALLBACK_CHAT_ID || 'не задан'}`);

// Извлекает номер 8800 из текста сообщения
function extractPhoneNumber(text) {
  const match = text.match(/\b(8800\d+)\b/);
  return match ? match[1] : null;
}

// Определяет UUID чата для данного сообщения
function resolveChatId(text) {
  const phone = extractPhoneNumber(text);
  if (phone && ROUTING_MAP[phone]) {
    return { chatId: ROUTING_MAP[phone], phone };
  }
  return { chatId: FALLBACK_CHAT_ID, phone };
}

async function pollAndSend() {
  if (!NEXTCLOUD_URL) {
    return; // не настроено — пропускаем тихо
  }

  let calls;
  try {
    const response = await axios.get(NEXTCLOUD_URL, { timeout: 10000, httpsAgent });
    if (!response.data?.ok || !Array.isArray(response.data.calls)) return;
    calls = response.data.calls;
  } catch (err) {
    console.error('[MissedCalls Cron] Не удалось опросить Nextcloud:', err.message);
    return; // попробуем в следующую минуту
  }

  if (calls.length === 0) return;

  console.log(`[MissedCalls Cron] Получено ${calls.length} звонок(ов)`);

  for (const call of calls) {
    const text = call.message;
    if (!text) continue;

    const { chatId, phone } = resolveChatId(text);

    if (!chatId) {
      console.warn(`[MissedCalls Cron] Нераспознанный номер, fallback не задан. Сообщение: ${text}`);
      continue;
    }

    const sent = await notificationService.sendMissedCallToGroup(chatId, text);
    if (sent) {
      const target = phone && ROUTING_MAP[phone] ? phone : 'fallback';
      console.log(`[MissedCalls Cron] Доставлено [${target}]: ${text}`);
    }
  }
}

cron.schedule(SCHEDULE, async () => {
  await pollAndSend();
});

console.log('[MissedCalls Cron] Job scheduled successfully');

module.exports = { pollAndSend };
