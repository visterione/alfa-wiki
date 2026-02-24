/**
 * Принудительный запуск синхронизации (минуя крон и HTTP)
 * Использование:
 *   node run-sync.js            ← синхронизирует все включённые доски
 *   node run-sync.js <boardId>  ← синхронизирует конкретную доску
 */

require('dotenv').config();
const { ReviewSyncConfig } = require('./models');
const reviewSyncService = require('./services/reviewSync');

const boardId = process.argv[2] || null;

async function main() {
  console.log('\n🔄 Принудительный запуск синхронизации GetLoyalty\n');

  // Проверяем что миграция выполнена и конфиги существуют
  let configs;
  try {
    configs = await ReviewSyncConfig.findAll({
      where: { provider: 'getloyalty', isEnabled: true }
    });
  } catch (err) {
    if (err.message?.includes('review_sync_configs')) {
      console.error('❌ Таблица review_sync_configs не найдена.');
      console.error('   Выполните миграцию: psql -d <dbname> -f migrations/ver.\\ 1.44\\ alter.sql');
    } else {
      console.error('❌ Ошибка подключения к БД:', err.message);
    }
    process.exit(1);
  }

  if (!configs.length) {
    console.log('⚠️  Нет включённых конфигураций GetLoyalty.');
    console.log('   Настройте синхронизацию в UI: Настройки доски → Синхронизация');
    process.exit(0);
  }

  console.log(`📋 Найдено конфигураций: ${configs.length}`);
  configs.forEach(c => console.log(`   • boardId: ${c.boardId}`));
  console.log();

  if (boardId) {
    console.log(`▶ Синхронизирую доску: ${boardId}\n`);
    const results = await reviewSyncService.syncBoard(boardId);
    const r = results[0];
    if (r?.status === 'success') {
      console.log(`\n✅ Готово! Импортировано новых отзывов: ${r.count}`);
    } else {
      console.log(`\n❌ Ошибка: ${r?.error || 'неизвестная ошибка'}`);
    }
  } else {
    console.log('▶ Синхронизирую все включённые доски...\n');
    await reviewSyncService.syncAll();
    console.log('\n✅ Готово!');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Необработанная ошибка:', err.message || err);
  process.exit(1);
});
