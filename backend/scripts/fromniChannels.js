'use strict';

/**
 * Что подключено у организаций во Fromni (ver. 7.94).
 *
 * Нужен, когда каскад не собирается: имена ступеней в настройке должны
 * совпадать с обозначениями каналов у агрегатора, а какие подключения заведены
 * у конкретной организации, знает только её личный кабинет.
 *
 * Запуск из каталога backend:
 *   npm run fromni:channels           все организации
 *   npm run fromni:channels -- alfa   одна
 */

require('dotenv').config();

const fromni = require('../services/messengers/fromni');
const { sequelize } = require('../models');
const settings = require('../services/notifications/settings');

const only = process.argv.slice(2).find(a => !a.startsWith('--'));

async function main() {
  const cascade = await settings.cascade();
  console.log(`Каскад в настройках: ${cascade.join(' → ')}\n`);

  const orgs = only ? [only] : Object.keys(fromni.KEY_ENV);

  for (const org of orgs) {
    console.log(`── ${org}`);
    try {
      const byChannel = await fromni.connectionsOf(org);
      const names = Object.keys(byChannel);

      if (!names.length) {
        console.log('   подключений нет вовсе (или все неактивны)');
        continue;
      }
      for (const name of names) {
        console.log(`   ${name.padEnd(20)} подключений: ${byChannel[name].length}`);
      }

      // Главное: соберутся ли ступени каскада из того, что есть.
      const steps = await fromni.channelsFor(org, cascade.filter(n => n !== 'bot'));
      const missing = cascade.filter(n => n !== 'bot' && !steps.some(s => s.name === n));
      console.log(`   каскад соберётся из: ${steps.map(s => s.name).join(', ') || '—'}`);
      if (missing.length) console.log(`   НЕ соберётся: ${missing.join(', ')} — нет подключений`);
    } catch (err) {
      console.log(`   ошибка: ${err.message}`);
    }
  }
}

main()
  .catch(err => { console.error('Ошибка:', err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
