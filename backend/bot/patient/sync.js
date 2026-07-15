/**
 * Инкрементальный синк подписчиков ботов из Fromni в МИС.
 * Запускается периодически (по крону / PM2). Берёт из Fromni только контакты,
 * созданные с прошлого запуска (вотермарк в settings), и помечает новых в МИС.
 *
 *   node bot/patient/sync.js            # инкрементально (от вотермарка)
 *   node bot/patient/sync.js --full     # игнорировать вотермарк, полный проход
 *
 * Вотермарк хранится в settings[key='fromni_sync_watermark'] = ISO-время последнего запуска.
 * Есть защитное перекрытие (OVERLAP): берём немного «назад», чтобы не терять пограничные.
 */
require('dotenv').config();
const { sequelize, Setting } = require('../../models');
const { runSync } = require('../../services/fromniSync');
const { printStats } = require('./syncStats');

const WATERMARK_KEY = 'fromni_sync_watermark';
const OVERLAP_MS = 24 * 60 * 60 * 1000; // сутки перекрытия (дедуп по bot_subscribers делает это дешёвым)

async function main() {
  const full = process.argv.includes('--full');
  try { await sequelize.query('SELECT 1 FROM bot_subscribers LIMIT 1'); }
  catch { console.error('❌ Нет таблицы bot_subscribers — примените миграцию ver. 5.86'); process.exit(1); }

  let sinceDate = null;
  if (!full) {
    const row = await Setting.findByPk(WATERMARK_KEY);
    if (row && row.value) {
      sinceDate = new Date(new Date(row.value).getTime() - OVERLAP_MS);
    }
  }
  const runStart = new Date();
  console.log(`🔄 Fromni sync ${full ? '(--full)' : sinceDate ? `с ${sinceDate.toISOString()}` : '(первый запуск, полный)'}\n`);

  const stats = await runSync({ sinceDate });
  printStats(stats, false);

  // Сдвигаем вотермарк только если не было ошибок — иначе на следующем запуске переберём заново
  if (stats.errors === 0) {
    await Setting.upsert({ key: WATERMARK_KEY, value: runStart.toISOString(), description: 'Fromni sync: время последнего успешного синка подписчиков' });
    console.log(`\n✅ Вотермарк обновлён: ${runStart.toISOString()}`);
  } else {
    console.warn(`\n⚠️ Были ошибки (${stats.errors}) — вотермарк НЕ сдвинут, на следующем запуске переберём.`);
  }
  await sequelize.close();
}

main().catch(err => { console.error('❌ Фатальная ошибка синка:', err); process.exit(1); });
