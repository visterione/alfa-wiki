'use strict';

/**
 * Проверка учётной записи Имобиса (ver. 7.95).
 *
 * Первое, что нужно узнать перед подключением: жив ли токен, сколько на счету и
 * какие имена отправителя одобрены. Имя нельзя придумать — оно проходит
 * модерацию у операторов, и с чужим SMS просто не уйдёт.
 *
 * Запуск из каталога backend:
 *   npm run imobis:check                боевой аккаунт
 *   npm run imobis:check -- --sandbox   песочница (реальные сообщения не уходят)
 *   npm run imobis:check -- --org alfa  токен конкретной организации
 */

require('dotenv').config();

const imobis = require('../services/messengers/imobis');

const args = process.argv.slice(2);
const sandbox = args.includes('--sandbox');
const org = (() => {
  const i = args.indexOf('--org');
  return i >= 0 ? args[i + 1] : null;
})();

async function main() {
  console.log(sandbox ? 'Песочница (реальные сообщения не отправляются)\n' : 'Боевой аккаунт\n');

  try {
    imobis.tokenFor(org);
  } catch (err) {
    console.log(err.message);
    console.log('Токен берётся в личном кабинете app.imobis.ru: Токены → Создать токен.');
    console.log('Вписать в backend/.env строкой  IMOBIS_TOKEN=...');
    return;
  }

  const show = async (title, fn) => {
    try {
      const data = await fn();
      console.log(`${title}:`);
      console.log(JSON.stringify(data, null, 2).split('\n').map(l => '   ' + l).join('\n'));
    } catch (err) {
      console.log(`${title}: ошибка — ${err.message}`);
    }
    console.log('');
  };

  await show('Логин', () => imobis.info(org, sandbox));
  await show('Баланс', () => imobis.balance(org, sandbox));
  await show('Имена отправителя', () => imobis.senders(org, sandbox));
  await show('Шаблоны', () => imobis.templates(org, sandbox));
}

main().catch(err => { console.error('Ошибка:', err.message); process.exitCode = 1; });
