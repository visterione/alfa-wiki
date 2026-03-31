/**
 * Скрипт: обнуляет поля advance и mainPayment у всех сотрудников
 * Затрагивает ТОЛЬКО эти два поля. Всё остальное (расходники, замочки, оклады и т.д.) не трогает.
 *
 * Запуск:
 *   node backend/scripts/reset-advance-mainpayment.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { ExecutorSettings, sequelize } = require('../models');

async function main() {
  const all = await ExecutorSettings.findAll();
  console.log(`Всего записей: ${all.length}`);

  let updated = 0;

  for (const record of all) {
    const s = record.settings || {};
    const cs = s.clinicSettings || {};

    if (!Object.keys(cs).length) continue;

    const newCs = {};
    for (const [clinicId, clinicData] of Object.entries(cs)) {
      newCs[clinicId] = {
        ...clinicData,
        advance: 0,
        mainPayment: 0,
      };
    }

    await record.update({ settings: { ...s, clinicSettings: newCs } });
    console.log(`  Сброшено: ${record.doctorName || record.misUserId}`);
    updated++;
  }

  console.log(`\nГотово. Обновлено записей: ${updated}`);
  await sequelize.close();
}

main().catch(err => {
  console.error('Ошибка:', err.message);
  process.exit(1);
});
