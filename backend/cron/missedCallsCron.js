/**
 * Cron-задача: опрос Nextcloud на наличие пропущенных звонков от АТС
 *
 * Каждую минуту обращается к PHP-файлу на Nextcloud (GET-запрос),
 * забирает накопленную очередь звонков и отправляет каждый в групповой чат.
 *
 * Переменные окружения:
 *   MISSED_CALLS_NEXTCLOUD_URL — URL PHP-файла на Nextcloud
 *   MISSED_CALLS_CHAT_ID       — UUID группового чата в мессенджере
 */

const cron = require('node-cron');
const axios = require('axios');
const https = require('https');
const notificationService = require('../services/notificationService');

// Nextcloud использует самоподписанный сертификат — отключаем проверку
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const SCHEDULE = '* * * * *'; // каждую минуту

const NEXTCLOUD_URL = process.env.MISSED_CALLS_NEXTCLOUD_URL;
const CHAT_ID = process.env.MISSED_CALLS_CHAT_ID;

console.log('[MissedCalls Cron] Initializing missed calls polling job (every minute)');

async function pollAndSend() {
  if (!NEXTCLOUD_URL || !CHAT_ID) {
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

    const sent = await notificationService.sendMissedCallToGroup(CHAT_ID, text);
    if (sent) {
      console.log(`[MissedCalls Cron] Доставлено: ${text}`);
    }
  }
}

cron.schedule(SCHEDULE, async () => {
  await pollAndSend();
});

console.log('[MissedCalls Cron] Job scheduled successfully');

module.exports = { pollAndSend };
