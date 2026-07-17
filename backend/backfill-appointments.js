/**
 * Разовый бэкфилл визитов из МИС → таблица mis_appointments.
 *
 * В отличие от syncDateRange (fire-and-forget, для HTTP/крона), здесь каждый день
 * загружается ПОСЛЕДОВАТЕЛЬНО с await — процесс живёт до конца и корректно завершается.
 *
 * Использование:
 *   node backfill-appointments.js                       ← с 2026-02-01 по вчера
 *   node backfill-appointments.js 2026-02-01            ← с указанной даты по вчера
 *   node backfill-appointments.js 2026-02-01 2026-06-30 ← явный диапазон [from, to]
 */

require('dotenv').config();
const { sequelize } = require('./models');
const { fetchAndUpsertDay } = require('./services/misAppointmentsSync');

const DELAY_MS = 400; // пауза между днями, чтобы не перегружать МИС

function parseArgDate(str, fallback) {
  if (!str) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    console.error(`❌ Неверный формат даты: "${str}". Ожидается YYYY-MM-DD.`);
    process.exit(1);
  }
  return new Date(`${str}T12:00:00`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(12, 0, 0, 0);

  const start = parseArgDate(process.argv[2], new Date('2026-02-01T12:00:00'));
  const end   = parseArgDate(process.argv[3], yesterday);

  if (start > end) {
    console.error('❌ Дата начала позже даты конца.');
    process.exit(1);
  }

  // Собираем список дней [start .. end]
  const days = [];
  const cur = new Date(start); cur.setHours(12, 0, 0, 0);
  const fin = new Date(end);   fin.setHours(12, 0, 0, 0);
  while (cur <= fin) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

  const fmt = (d) => d.toLocaleDateString('ru-RU');
  console.log(`\n📅 Бэкфилл визитов МИС: ${days.length} дней [${fmt(start)} → ${fmt(end)}]\n`);

  await sequelize.authenticate();
  sequelize.options.logging = false; // без шумного SQL-лога по каждому upsert

  let totalRows = 0;
  let failed = 0;
  for (let i = 0; i < days.length; i++) {
    const label = `${fmt(days[i])} (${i + 1}/${days.length})`;
    try {
      const cnt = await fetchAndUpsertDay(days[i]);
      totalRows += cnt || 0;
      console.log(`  ✓ ${label}: ${cnt || 0} записей`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${label}: ${e.message}`);
    }
    if (i < days.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\n✅ Готово. Записей upsert-нуто: ${totalRows}. Дней с ошибкой: ${failed}/${days.length}\n`);
  await sequelize.close();
  process.exit(failed && !totalRows ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ Фатальная ошибка:', e.message);
  process.exit(1);
});
