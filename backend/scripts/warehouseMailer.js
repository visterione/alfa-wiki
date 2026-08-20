/**
 * Регламентная рассылка складских отчётов.
 *
 * ── Почему отдельный процесс ─────────────────────────────────────────────────
 *
 * Тем же соображением, что и scripts/syncWorker.js: бэкенд под pm2 живёт в
 * fork-режиме и перезапускается при каждом деплое. Расписание внутри него
 * однажды уедет ровно в тот момент, когда наполовину разослано, — половина людей
 * получит письмо, вторая нет, и понять, кто именно, будет не по чему.
 *
 * Здесь же лежит вторая причина: сборка отчёта на каждого получателя — это
 * тяжёлые запросы, и делать их в процессе, который в это же время отвечает на
 * запросы врачей, незачем.
 *
 * ── Что он НЕ делает ─────────────────────────────────────────────────────────
 *
 * Не шлёт сокетные сигналы. Socket.IO живёт в API-процессе, а redis-адаптер в
 * этой установке необязателен (SOCKET_IO_REDIS_URL может быть пуст) — значит из
 * отдельного процесса сигнал дошёл бы не всегда. Сигналы «посмотри сейчас»
 * отправляются там, где происходит само событие: routes/warehouse/operations.js.
 *
 * Запуск:
 *   npm run warehouse-mailer            — демон по расписанию
 *   npm run warehouse-mailer -- --now   — разослать немедленно и выйти
 *   npm run warehouse-mailer -- --dry   — посчитать получателей, ничего не слать
 */
require('dotenv').config();

const cron = require('node-cron');
const { MAILINGS, runMailing } = require('../services/warehouse/mailing');

const TZ = process.env.WAREHOUSE_MAIL_TZ || 'Europe/Moscow';
const args = process.argv.slice(2);
const isDry = args.includes('--dry');
const runNow = args.includes('--now') || isDry;

const stamp = () => new Date().toLocaleString('ru-RU', { timeZone: TZ });

async function fire(code, reason) {
  try {
    console.log(`[СКЛАД-ПОЧТА] ${stamp()} · ${code} (${reason})${isDry ? ' · холостой прогон' : ''}`);
    const report = await runMailing(code, { dryRun: isDry });
    console.log(
      `[СКЛАД-ПОЧТА] ${code}: кандидатов ${report.candidates}, `
      + `отправлено ${report.sent}, пропущено ${report.skipped}, ошибок ${report.failed}`
    );
    for (const d of report.details) {
      console.log(d.error
        ? `   ✗ ${d.user}: ${d.error}`
        : `   → ${d.user} <${d.email}>: ${d.items} позиций`);
    }
  } catch (err) {
    console.error(`[СКЛАД-ПОЧТА] ${code} упала:`, err.message);
  }
}

async function main() {
  if (runNow) {
    for (const code of Object.keys(MAILINGS)) await fire(code, 'ручной запуск');
    process.exit(0);
  }

  for (const [code, config] of Object.entries(MAILINGS)) {
    cron.schedule(config.cron, () => fire(code, config.schedule), { timezone: TZ });
    console.log(`[СКЛАД-ПОЧТА] ${code} — ${config.schedule} (${TZ})`);
  }
  console.log(`✅ [СКЛАД-ПОЧТА] Запущен, часовой пояс ${TZ}. Рассылок в расписании: ${Object.keys(MAILINGS).length}`);
}

main();
