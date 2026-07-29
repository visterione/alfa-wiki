#!/usr/bin/env node
'use strict';

/**
 * Забрать прайсы конкурентов из alfa-parser прямо сейчас.
 *
 * То же самое, что делает ночной крон, но вручную — для первого наполнения
 * и для проверки связки после настройки.
 *
 * Запуск на сервере:
 *   cd <ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/backend
 *   node scripts/syncCompetitorPrices.js
 *
 * Адрес парсера и ключ берутся из backend/.env (PARSER_BASE_URL, PARSER_API_TOKEN).
 * Повторный запуск безопасен: услуги обновляются на месте, цены переписываются.
 */

const { sequelize } = require('../models');
const parser = require('../services/parserClient');
const { syncAll } = require('../services/competitorPricesSync');

sequelize.options.logging = false;

async function main() {
  console.log('');
  console.log('▶ Забор прайсов конкурентов из alfa-parser');
  console.log(`   Парсер: ${parser.parserUrl()}`);
  console.log(`   Ключ задан: ${parser.hasToken() ? 'да' : 'НЕТ — API парсера ответит отказом'}`);
  console.log('');

  await sequelize.authenticate();

  // Сначала короткая проверка связи: иначе о том, что парсер не поднят,
  // мы узнаем в середине обхода источников
  try {
    const pong = await parser.ping();
    if (!pong?.auth_configured) {
      console.warn('⚠️  На парсере не задан PARSER_API_TOKEN — его API выключен');
    }
  } catch (err) {
    const { message } = parser.describeError(err);
    throw new Error(message);
  }

  const result = await syncAll();
  console.log('');

  if (result.failed) {
    console.log(`⚠️  Готово, но ${result.failed} из ${result.total} источников не забрались — см. вывод выше`);
  } else {
    console.log(`✅ Готово: ${result.total} источников за ${result.seconds} с`);
  }
  console.log('');
}

main()
  .then(() => sequelize.close())
  .catch(async err => {
    console.error('');
    console.error('❌ Синхронизация не выполнена:', err.message);
    console.error('');
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
