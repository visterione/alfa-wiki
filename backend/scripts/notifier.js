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
 *   node scripts/notifier.js --outbox  разобрать очередь: что ушло, что нет и почему
 *   node scripts/notifier.js --reset   очистить очередь, снимки и водяной знак
 */

require('dotenv').config();

const { Client } = require('pg');
const { sequelize, NotifOutbox, NotifAppointment, Setting, BotSubscriber, MessengerBot } = require('../models');
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


/**
 * Разбор очереди. Отвечает на единственный вопрос, который возникает, когда
 * уведомление «не пришло»: дошло ли оно до очереди, чем закончилась отправка и
 * нашёлся ли для телефона подписчик бота.
 */
async function showOutbox(limit = 15) {
  const rows = await NotifOutbox.findAll({ order: [['createdAt', 'DESC']], limit });

  if (!rows.length) {
    console.log('Очередь пуста — детектор пока не нашёл ни одного события.');
    return;
  }

  const misClient = require('../services/misClient');
  const sender = require('../services/notifications/sender');

  console.log(`Вторая ступень (Fromni): ${sender.ALLOW_FROMNI ? 'разрешена' : 'ВЫКЛЮЧЕНА'}` +
    `   пилотных телефонов: ${sender.PILOT_PHONES.length || 'без ограничения'}\n`);

  for (const row of rows) {
    const normalized = misClient.normalizePhone(row.phone || '');
    const subscriber = normalized
      ? await BotSubscriber.findOne({ where: { phone: normalized, source: 'bot' } })
      : null;

    let who = 'подписчика бота нет — уйдёт второй ступенью';
    if (subscriber) {
      const bot = subscriber.botId ? await MessengerBot.findByPk(subscriber.botId) : null;
      who = subscriber.isBlocked
        ? 'подписчик есть, но бот заблокирован'
        : `подписчик @${bot ? bot.username : '?'} (${subscriber.platform})`;
    }

    console.log(`${row.status.toUpperCase().padEnd(8)} ${row.event.padEnd(10)} визит ${row.apptId || '—'}`);
    console.log(`   телефон: ${row.phone || '—'} → ${normalized || '—'}   ${who}`);
    console.log(`   когда:   ${new Date(row.plannedAt).toLocaleString('ru-RU')}` +
      (row.sentAt ? `   отправлено ${new Date(row.sentAt).toLocaleString('ru-RU')} (${row.channel})` : ''));
    if (row.error) console.log(`   причина: ${row.error}`);
    console.log(`   текст:   ${row.text.slice(0, 90)}${row.text.length > 90 ? '…' : ''}`);
    console.log('');
  }
}


/**
 * Сброс к чистому листу: очередь, снимки визитов и водяной знак. Нужен на время
 * обкатки — снимок, снятый неполным запросом, потом уже не поправить, потому что
 * повторное появление того же визита событием не считается.
 */
async function reset() {
  const outbox = await NotifOutbox.destroy({ where: {} });
  const snapshots = await NotifAppointment.destroy({ where: {} });
  await Setting.destroy({ where: { key: detector.WATERMARK_KEY } });

  console.log(`Очищено: очередь ${outbox}, снимков ${snapshots}, водяной знак сброшен.`);
  console.log('Следующий запуск начнёт с текущей минуты — историю не выгребает.');
}

async function main() {
  if (args.includes('--reset')) {
    await reset();
    await sequelize.close();
    return;
  }

  if (args.includes('--outbox')) {
    await showOutbox(Number(args[args.indexOf('--outbox') + 1]) || 15);
    await sequelize.close();
    return;
  }

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
