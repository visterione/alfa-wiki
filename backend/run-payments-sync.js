/**
 * Разовый бэкфилл финансовых списаний/возвратов из МИС (getPayments, type=2)
 * в таблицу mis_payments — минуя HTTP и кнопку в UI.
 *
 * После этого ежедневный крон (cron/misPaymentsSyncCron.js, 00:10 МСК)
 * поддерживает данные свежими сам — запускать этот скрипт нужно один раз.
 *
 * Использование:
 *   node run-payments-sync.js                       ← с 01.02.2026 по вчера
 *   node run-payments-sync.js 01.02.2026            ← с указанной даты по вчера
 *   node run-payments-sync.js 01.02.2026 30.06.2026 ← явный диапазон
 *
 * Даты — в формате dd.mm.yyyy или ISO (yyyy-mm-dd).
 */

require('dotenv').config();
const { fetchAndUpsertDay } = require('./services/misPaymentsSync');

const DELAY_MS = 400; // пауза между днями, чтобы не перегружать МИС

function parseArg(str, fallback) {
  if (!str) return fallback;
  const ru = String(str).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ru) return new Date(`${ru[3]}-${ru[2]}-${ru[1]}T12:00:00`);
  const d = new Date(str);
  return isNaN(d) ? fallback : d;
}

async function main() {
  const start = parseArg(process.argv[2], new Date('2026-02-01T12:00:00'));
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(12, 0, 0, 0);
  const end = parseArg(process.argv[3], yesterday);

  const days = [];
  const cur = new Date(start); cur.setHours(12, 0, 0, 0);
  const fin = new Date(end);   fin.setHours(12, 0, 0, 0);
  while (cur <= fin) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

  const fmt = d => d.toLocaleDateString('ru-RU');
  console.log(`\n💸 Бэкфилл возвратов/списаний: ${days.length} дней [${fmt(start)} → ${fmt(end)}]\n`);

  let total = 0;
  for (let i = 0; i < days.length; i++) {
    try {
      const cnt = await fetchAndUpsertDay(days[i]);
      total += cnt;
      if (cnt) console.log(`  ✓ ${fmt(days[i])}: ${cnt} списаний`);
    } catch (e) {
      console.error(`  ✗ ${fmt(days[i])}:`, e.message);
    }
    if (i < days.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n✅ Готово. Всего загружено списаний: ${total}\n`);
  process.exit(0);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
