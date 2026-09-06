'use strict';

/**
 * Уведомления пациентам: поиск событий и отправка (ver. 7.86).
 *
 * Отдельный процесс, как и забор обновлений ботов, и по той же причине: он
 * ходит в чужие API и не должен иметь возможности уронить портал. Ту же цену мы
 * однажды заплатили на синхронизации цен партнёров.
 *
 * Два цикла с разным ритмом. Детектор спрашивает МИС «что изменилось» раз в
 * минуту — запрос дешёвый и почти всегда пустой. Отправщик разгребает очередь
 * чаще: там же лежат напоминания, которым подошёл срок.
 *
 * Запуск из каталога backend:
 *   npm run notifier                   боевой режим
 *   node scripts/notifier.js --once    один проход обоих циклов, для проверки
 *   node scripts/notifier.js --dry     показать, что нашлось, ничего не отправляя
 */

require('dotenv').config();

const { Client } = require('pg');
const { sequelize, NotifOutbox } = require('../models');
const detector = require('../services/notifications/detector');
const sender = require('../services/notifications/sender');

const DETECT_MS = Number(process.env.NOTIFIER_DETECT_MS || 60000);
const SEND_MS = Number(process.env.NOTIFIER_SEND_MS || 20000);

// Тот же приём, что у забора обновлений: два запущенных экземпляра слали бы
// уведомления дважды, а процессы поднимают руками в tmux.
const LOCK_KEY = 78601;
let lockClient = null;

async function acquireLock() {
  lockClient = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  await lockClient.connect();

  const { rows } = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
  if (rows[0].ok) return true;

  await lockClient.end();
  lockClient = null;
  return false;
}

const args = process.argv.slice(2);
const once = args.includes('--once');
const dry = args.includes('--dry');

let stopping = false;

async function detectTick() {
  try {
    const { checked, events } = await detector.runOnce();
    if (checked || events) {
      console.log(`[notifier] изменений: ${checked}, событий: ${events}`);
    }
  } catch (err) {
    console.error('[notifier] детектор:', err.message);
  }
}

async function sendTick() {
  if (dry) {
    const pending = await NotifOutbox.count({ where: { status: 'pending' } });
    console.log(`[notifier] --dry: в очереди ${pending}, ничего не отправляю`);
    return;
  }
  try {
    const { sent, failed } = await sender.runOnce();
    if (sent || failed) console.log(`[notifier] отправлено: ${sent}, не удалось: ${failed}`);
  } catch (err) {
    console.error('[notifier] отправщик:', err.message);
  }
}

async function main() {
  console.log(`[notifier] запуск${dry ? ' (--dry, без отправки)' : ''}`);

  if (!once && !await acquireLock()) {
    // Выходим нулём: это не падение, а «уже работает», и петля перезапуска в
    // tmux не должна долбиться сюда каждые пять секунд.
    console.log('[notifier] уже запущен другим процессом — этот экземпляр не нужен, выхожу');
    await sequelize.close();
    process.exit(0);
  }

  await detectTick();
  await sendTick();

  if (once) {
    if (lockClient) await lockClient.end().catch(() => {});
    await sequelize.close();
    return;
  }

  const detectTimer = setInterval(() => { if (!stopping) detectTick(); }, DETECT_MS);
  const sendTimer = setInterval(() => { if (!stopping) sendTick(); }, SEND_MS);

  const shutdown = async (signal) => {
    console.log(`[notifier] ${signal} — останавливаюсь`);
    stopping = true;
    clearInterval(detectTimer);
    clearInterval(sendTimer);
    if (lockClient) await lockClient.end().catch(() => {});
    await sequelize.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('[notifier] не поднялся:', err.message);
  process.exit(1);
});
