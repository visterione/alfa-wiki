#!/usr/bin/env node
/**
 * Принудительная синхронизация кэша услуг партнёров.
 * Запуск: node backend/scripts/sync-partner-services.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { syncPartnerServicesCache } = require('../cron/partnerServicesCacheCron');

syncPartnerServicesCache()
  .then((result) => {
    if (result.success) {
      console.log('\n🎉 Готово!');
    } else {
      console.error('\n❌ Синхронизация завершилась с ошибкой:', result.reason);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('\n❌ Неожиданная ошибка:', err.message);
    process.exit(1);
  });
