/**
 * Автономный запуск синхронизации кэша услуг партнёров.
 *
 * Запускается ОТДЕЛЬНЫМ процессом, не зависит от dev-сервера / nodemon —
 * рестарт сервера при сохранении файлов не прерывает синк.
 *
 * Использование:
 *   node scripts/syncPartnerServices.js            # все медцентры
 *   node scripts/syncPartnerServices.js 11         # только указанные id (через пробел)
 *
 * Подходит и для системного cron / pm2 как замена внутреннего node-cron.
 */
require('dotenv').config();

const { syncPartnerServicesCache } = require('../cron/partnerServicesCacheCron');

const clinicIds = process.argv.slice(2).map(Number).filter(Boolean);

(async () => {
  const t0 = Date.now();
  console.log(`[SYNC-RUNNER] Старт: ${new Date().toISOString()}${clinicIds.length ? ` (медцентры: ${clinicIds.join(', ')})` : ''}`);
  try {
    const result = await syncPartnerServicesCache(clinicIds.length ? { clinicIds } : {});
    console.log('[SYNC-RUNNER] Результат:', JSON.stringify(result));
    console.log(`[SYNC-RUNNER] Готово за ${Math.round((Date.now() - t0) / 1000)} сек.`);
    process.exit(0);
  } catch (err) {
    console.error('[SYNC-RUNNER] Фатальная ошибка:', err.message);
    process.exit(1);
  }
})();
