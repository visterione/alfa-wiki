/**
 * Разовый ПОЛНЫЙ импорт подписчиков ботов из Fromni в МИС (без вотермарка).
 * Обычную периодическую синхронизацию делает sync.js. Этот скрипт — на случай
 * первичного/повторного полного прогона.
 *
 *   node bot/patient/backfill.js --dry-run           # посчитать, без записи и без МИС
 *   node bot/patient/backfill.js                      # полный боевой прогон
 *   node bot/patient/backfill.js --org=alfa           # одна организация
 *   node bot/patient/backfill.js --platform=max       # один канал
 *   node bot/patient/backfill.js --limit=50           # ограничить (тест)
 */
require('dotenv').config();
const { sequelize } = require('../../models');
const { runSync } = require('../../services/fromniSync');
const { printStats } = require('./syncStats');

const args = process.argv.slice(2);
const val = (n) => { const a = args.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : null; };

async function main() {
  const dryRun = args.includes('--dry-run');
  console.log(dryRun ? '🔎 BACKFILL (dry-run)\n' : '🚀 BACKFILL (полный боевой прогон)\n');
  try { await sequelize.query('SELECT 1 FROM bot_subscribers LIMIT 1'); }
  catch { console.error('❌ Нет таблицы bot_subscribers — примените миграцию ver. 5.86'); process.exit(1); }

  const stats = await runSync({
    dryRun,
    onlyOrg: val('org'),
    onlyPlatform: val('platform'),
    limit: val('limit') ? parseInt(val('limit'), 10) : null
  });
  printStats(stats, dryRun);
  await sequelize.close();
}

main().catch(err => { console.error('❌ Фатальная ошибка:', err); process.exit(1); });
