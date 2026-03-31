/**
 * Cron-задача: опрос почтового ящика на наличие новых писем о пропущенных вызовах
 *
 * Каждую минуту подключается к IMAP-серверу, забирает непрочитанные письма
 * и отправляет каждое в групповой чат от имени ATS-бота.
 *
 * Переменные окружения:
 *   MAIL_IMAP_HOST       — IMAP-сервер (например, imap.mail.ru)
 *   MAIL_IMAP_PORT       — порт (993 для TLS, 143 для STARTTLS)
 *   MAIL_IMAP_USER       — логин (email-адрес)
 *   MAIL_IMAP_PASSWORD   — пароль
 *   MAIL_IMAP_TLS        — использовать TLS: true/false (по умолчанию true)
 *   MAIL_IMAP_MAILBOX    — папка для проверки (по умолчанию INBOX)
 *   MISSED_CALLS_CHAT_ID — UUID группового чата в мессенджере
 *   TELEGRAM_BOT_TOKEN   — токен Telegram-бота (опционально)
 *   TELEGRAM_CHAT_ID     — ID чата/группы в Telegram (опционально)
 */

const cron = require('node-cron');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const axios = require('axios');
const notificationService = require('../services/notificationService');

const SCHEDULE = '* * * * *'; // каждую минуту

const IMAP_HOST     = process.env.MAIL_IMAP_HOST;
const IMAP_PORT     = parseInt(process.env.MAIL_IMAP_PORT || '993', 10);
const IMAP_USER     = process.env.MAIL_IMAP_USER;
const IMAP_PASSWORD = process.env.MAIL_IMAP_PASSWORD;
const IMAP_TLS      = process.env.MAIL_IMAP_TLS !== 'false'; // по умолчанию true
const IMAP_MAILBOX  = process.env.MAIL_IMAP_MAILBOX || 'INBOX';
const CHAT_ID          = process.env.MISSED_CALLS_CHAT_ID;
const TG_BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT_ID       = process.env.TELEGRAM_CHAT_ID;

console.log('[MissedCalls Cron] Initializing missed calls email polling job (every minute)');

async function sendToTelegram(text) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`,
      { chat_id: TG_CHAT_ID, text },
      { timeout: 10000 }
    );
  } catch (err) {
    console.error('[MissedCalls Cron] Ошибка отправки в Telegram:', err.message);
  }
}

async function pollAndSend() {
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD || !CHAT_ID) {
    return; // не настроено — пропускаем тихо
  }

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_TLS,
    auth: {
      user: IMAP_USER,
      pass: IMAP_PASSWORD,
    },
    logger: false, // отключаем встроенный лог imapflow
    tls: {
      rejectUnauthorized: false, // разрешаем самоподписанные сертификаты
    },
  });

  try {
    await client.connect();
  } catch (err) {
    console.error('[MissedCalls Cron] Не удалось подключиться к IMAP:', err.message);
    return;
  }

  try {
    await client.mailboxOpen(IMAP_MAILBOX);

    // Ищем непрочитанные письма
    const uids = await client.search({ unseen: true });
    if (!uids || uids.length === 0) return;

    console.log(`[MissedCalls Cron] Найдено ${uids.length} непрочитанных писем`);

    for (const uid of uids) {
      let parsed;
      try {
        const msg = await client.fetchOne(uid, { source: true });
        parsed = await simpleParser(msg.source);
      } catch (err) {
        console.error(`[MissedCalls Cron] Ошибка чтения письма uid=${uid}:`, err.message);
        // Помечаем прочитанным, чтобы не зациклиться на битом письме
        await client.messageFlagsAdd(uid, ['\\Seen']).catch(() => {});
        continue;
      }

      // Формируем текст сообщения: тема + текст тела (если есть)
      const subject = (parsed.subject || '').trim();
      const body    = (parsed.text   || '').trim();
      const text    = subject
        ? (body ? `${subject}\n${body}` : subject)
        : body;

      if (text) {
        const sent = await notificationService.sendMissedCallToGroup(CHAT_ID, text);
        if (sent) {
          console.log(`[MissedCalls Cron] Доставлено в чат: ${subject || '(без темы)'}`);
        }
        await sendToTelegram(text);
      }

      // Помечаем письмо как прочитанное
      await client.messageFlagsAdd(uid, ['\\Seen']).catch((err) => {
        console.error(`[MissedCalls Cron] Не удалось пометить письмо uid=${uid} как прочитанное:`, err.message);
      });
    }
  } catch (err) {
    console.error('[MissedCalls Cron] Ошибка при обработке почты:', err.message);
  } finally {
    await client.logout().catch(() => {});
  }
}

cron.schedule(SCHEDULE, async () => {
  await pollAndSend();
});

console.log('[MissedCalls Cron] Job scheduled successfully');

module.exports = { pollAndSend };
