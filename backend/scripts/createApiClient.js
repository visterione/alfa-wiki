#!/usr/bin/env node
'use strict';

/**
 * Выдача ключа внешней системе для публичного API.
 *
 * Использование:
 *   node scripts/createApiClient.js "Сайт medcentralfa.ru" forms:patient-registration
 *   node scripts/createApiClient.js "Лендинг" forms:patient-registration --public --origin=https://medcentralfa.ru
 *
 * Флаги:
 *   --public            ключ будет вызываться из браузера (обязателен --origin)
 *   --origin=URL        разрешённый Origin, можно указать несколько раз
 *   --ip=1.2.3.4        разрешённый IP, можно указать несколько раз
 *   --rate=60           лимит запросов в минуту (по умолчанию 60)
 *
 * Ключ печатается один раз и в базе не хранится — сохраните его сразу.
 */

const crypto = require('crypto');
const { sequelize, ApiClient } = require('../models');
const { hashKey, KEY_PREFIX_LENGTH } = require('../middleware/publicApi');

function parseArgs(argv) {
  const positional = [];
  const origins = [];
  const ips = [];
  let isPublic = false;
  let rate = 60;

  for (const arg of argv) {
    if (arg === '--public') isPublic = true;
    else if (arg.startsWith('--origin=')) origins.push(arg.slice(9));
    else if (arg.startsWith('--ip=')) ips.push(arg.slice(5));
    else if (arg.startsWith('--rate=')) rate = parseInt(arg.slice(7), 10) || 60;
    else positional.push(arg);
  }

  return { name: positional[0], scopes: positional.slice(1), isPublic, origins, ips, rate };
}

async function main() {
  const { name, scopes, isPublic, origins, ips, rate } = parseArgs(process.argv.slice(2));

  if (!name || scopes.length === 0) {
    console.error('Укажите название и хотя бы одно право, например:');
    console.error('  node scripts/createApiClient.js "Сайт medcentralfa.ru" forms:patient-registration');
    process.exit(1);
  }

  if (isPublic && origins.length === 0) {
    console.error('Для --public обязателен хотя бы один --origin=https://...');
    process.exit(1);
  }

  await sequelize.authenticate();

  // wk_live_ + 32 hex: первые 16 символов служат префиксом для поиска строки
  const key = 'wk_live_' + crypto.randomBytes(16).toString('hex');

  const client = await ApiClient.create({
    name,
    keyType:         isPublic ? 'public' : 'secret',
    keyPrefix:       key.slice(0, KEY_PREFIX_LENGTH),
    keyHash:         hashKey(key),
    scopes,
    allowedOrigins:  origins,
    allowedIps:      ips,
    rateLimitPerMin: rate
  });

  console.log('');
  console.log('✅ Ключ создан');
  console.log('');
  console.log(`   Система:  ${client.name}`);
  console.log(`   Тип:      ${client.keyType}${isPublic ? ' (вызов из браузера)' : ' (вызов с сервера)'}`);
  console.log(`   Права:    ${scopes.join(', ')}`);
  if (origins.length) console.log(`   Origins:  ${origins.join(', ')}`);
  if (ips.length)     console.log(`   IP:       ${ips.join(', ')}`);
  console.log(`   Лимит:    ${rate} запросов в минуту`);
  console.log('');
  console.log('   КЛЮЧ (показывается один раз, в базе не хранится):');
  console.log('');
  console.log(`   ${key}`);
  console.log('');
  console.log('   Передайте его разработчику по защищённому каналу.');
  console.log('');

  await sequelize.close();
}

main().catch(async err => {
  console.error('❌ Не удалось создать ключ:', err.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
