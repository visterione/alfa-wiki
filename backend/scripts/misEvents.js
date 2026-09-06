'use strict';

/**
 * Что прислала МИС (ver. 7.88).
 *
 * Пока формат события неизвестен, единственный способ его узнать — посмотреть на
 * настоящий запрос. Скрипт печатает принятое целиком, без сокращений: по нему и
 * будем писать разбор.
 *
 * Запуск из каталога backend:
 *   npm run mis-events            последние 10
 *   npm run mis-events -- 30      последние 30
 *   npm run mis-events -- --url   показать адрес для настройки в Renovatio
 */

require('dotenv').config();

const { sequelize, MisEvent } = require('../models');

const args = process.argv.slice(2);
const BASE_URL = (process.env.BASE_URL || 'https://wiki.medcentralfa.ru').replace(/\/+$/, '');

async function main() {
  if (args.includes('--url')) {
    const secret = process.env.MIS_EVENTS_SECRET;
    if (!secret) {
      console.log('MIS_EVENTS_SECRET в .env не задан. Сгенерировать и вписать, например:');
      console.log(`  MIS_EVENTS_SECRET=${require('crypto').randomBytes(18).toString('hex')}`);
      return;
    }
    console.log('Адрес обращения для настройки в админке Renovatio:\n');
    for (const event of ['lab-full', 'lab-partial', 'review', 'created', 'moved', 'cancelled']) {
      console.log(`  ${event.padEnd(12)} ${BASE_URL}/api/mis-events/${secret}/${event}`);
    }
    console.log('\nИмя события в конце адреса — наше, любое: в настройке Renovatio одна');
    console.log('запись = одно событие, и по имени мы поймём, что именно пришло.');
    return;
  }

  const limit = Number(args.find(a => /^\d+$/.test(a))) || 10;
  const rows = await MisEvent.findAll({ order: [['createdAt', 'DESC']], limit });

  if (!rows.length) {
    console.log('От МИС пока ничего не приходило.');
    console.log('Адрес для настройки:  npm run mis-events -- --url');
    return;
  }

  for (const row of rows) {
    console.log('─'.repeat(72));
    console.log(`${new Date(row.createdAt).toLocaleString('ru-RU')}  ${row.method}  событие: ${row.event || '—'}  от ${row.remoteAddr || '?'}`);
    console.log(`заголовки: ${JSON.stringify(row.headers)}`);
    if (Object.keys(row.query || {}).length) console.log(`query:     ${JSON.stringify(row.query)}`);
    console.log('тело:');
    console.log(JSON.stringify(row.body, null, 2));
  }
}

main()
  .catch(err => { console.error('Ошибка:', err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
