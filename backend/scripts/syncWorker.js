/**
 * Кросс-платформенный воркер синхронизации кэша услуг партнёров.
 *
 * Запускается ОТДЕЛЬНЫМ долгоживущим процессом (не под nodemon, не внутри веб-сервера),
 * поэтому рестарты dev-сервера / деплои его не прерывают. Работает одинаково на Windows и macOS.
 *
 * Логика «через день» + самовосстановление:
 *   - При старте: если кэш старше MIN_AGE_HOURS — сразу запускает синк (догоняет после
 *     простоя/перезапуска/сна машины).
 *   - Ежедневно в 02:00 МСК проверяет возраст кэша и синхронизирует, только если он
 *     старше ~40ч. Итог: фактический прогон раз в ~2 суток, всегда ночью.
 *
 * Запуск:
 *   npm run sync-worker
 * Держать процесс живым: отдельное окно терминала, либо Windows-служба (nssm) / pm2 / screen.
 */
require('dotenv').config();

const cron = require('node-cron');
const { syncPartnerServicesCache } = require('../cron/partnerServicesCacheCron');
const { PartnerServiceCache } = require('../models');

const MIN_AGE_HOURS = 40;          // синк, только если кэш старше этого → «через день»
const SCHEDULE = '0 2 * * *';      // ежедневная проверка в 02:00
const TZ = 'Europe/Moscow';

async function cacheAgeHours() {
  const latest = await PartnerServiceCache.max('syncedAt');
  if (!latest) return Infinity;
  return (Date.now() - new Date(latest).getTime()) / 3600000;
}

async function maybeSync(reason) {
  try {
    const age = await cacheAgeHours();
    if (age < MIN_AGE_HOURS) {
      console.log(`[SYNC-WORKER] Кэш свежий (${age.toFixed(1)}ч < ${MIN_AGE_HOURS}ч) — пропуск (${reason}).`);
      return;
    }
    console.log(`[SYNC-WORKER] Кэш устарел (${age === Infinity ? 'пусто' : age.toFixed(1) + 'ч'}) — запуск синка (${reason})...`);
    const res = await syncPartnerServicesCache();
    console.log('[SYNC-WORKER] Итог синка:', JSON.stringify(res));
  } catch (e) {
    console.error('[SYNC-WORKER] Ошибка:', e.message);
  }
}

// 1) Догоняем при старте, если кэш протух
maybeSync('старт');

// 2) Ежедневная ночная проверка (синк только если кэш старше ~40ч)
cron.schedule(SCHEDULE, () => maybeSync('расписание 02:00'), { timezone: TZ });

console.log(`✅ [SYNC-WORKER] Запущен. Проверка ежедневно в 02:00 ${TZ}; синк, если кэш старше ${MIN_AGE_HOURS}ч (≈ через день).`);
