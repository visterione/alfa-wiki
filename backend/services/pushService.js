/**
 * Push-уведомления на мобильные устройства.
 *
 * Точка входа для остального кода — sendToUsers(). Всё, что касается конкретного
 * шлюза (FCM), заперто внутри этого файла: когда появится APNs, добавится ветка
 * в dispatch(), а вызывающий код не изменится.
 *
 * Конфигурация — service-account JSON из Firebase Console:
 *   FCM_SERVICE_ACCOUNT_PATH=/абс/путь/fcm-service-account.json
 * либо файл backend/config/fcm-service-account.json (он в .gitignore).
 * Если файла нет — сервис молча выключается: локальная разработка и прод без
 * настроенного Firebase продолжают работать, просто без пушей.
 */

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { UserDevice } = require('../models');

// FCM не принимает больше 500 токенов за вызов
const MULTICAST_CHUNK = 500;

// Сколько неудач подряд терпим, прежде чем погасить устройство. Разовые сетевые
// ошибки не должны стоить пользователю уведомлений, поэтому не 1.
const MAX_FAILURES = 5;

let messaging = null;
let initialized = false;
let enabled = false;

function resolveCredentialsPath() {
  const fromEnv = process.env.FCM_SERVICE_ACCOUNT_PATH;
  if (fromEnv) return path.isAbsolute(fromEnv) ? fromEnv : path.join(__dirname, '..', fromEnv);
  return path.join(__dirname, '..', 'config', 'fcm-service-account.json');
}

/**
 * Ленивая инициализация: firebase-admin поднимается при первой отправке, а не при
 * старте сервера, чтобы отсутствие ключей не роняло приложение.
 */
function init() {
  if (initialized) return enabled;
  initialized = true;

  const credPath = resolveCredentialsPath();
  if (!fs.existsSync(credPath)) {
    console.warn(`[push] FCM не настроен (нет ${credPath}) — push-уведомления отключены`);
    return false;
  }

  try {
    // firebase-admin 13+ отдаёт только модульный API: namespaced-вариант
    // (admin.credential.cert / admin.messaging) в нём удалён и возвращает undefined.
    // require внутри функции, а не наверху файла, чтобы отсутствие пакета
    // не роняло сервер на старте.
    const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');

    const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const app = getApps().length
      ? getApp()
      : initializeApp({ credential: cert(serviceAccount) });
    messaging = getMessaging(app);
    enabled = true;
    console.log(`🔔 FCM инициализирован (project ${serviceAccount.project_id})`);
  } catch (err) {
    console.error('[push] Не удалось инициализировать FCM:', err.message);
    enabled = false;
  }

  return enabled;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Гасит устройства, которые FCM признал мёртвыми, и считает неудачи у остальных.
 */
async function handleFailures(tokens, responses) {
  const dead = [];
  const failed = [];

  responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code || '';
    // Приложение удалено / токен перевыпущен — второго шанса не будет
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
      dead.push(tokens[i]);
    } else {
      failed.push(tokens[i]);
    }
  });

  if (dead.length) {
    await UserDevice.update({ isActive: false }, { where: { token: { [Op.in]: dead } } });
  }
  if (failed.length) {
    await UserDevice.increment('failureCount', { where: { token: { [Op.in]: failed } } });
    await UserDevice.update(
      { isActive: false },
      { where: { token: { [Op.in]: failed }, failureCount: { [Op.gte]: MAX_FAILURES } } }
    );
  }

  // Успешные — сбрасываем счётчик, иначе редкие ошибки за месяцы накопятся до порога
  const ok = tokens.filter((_, i) => responses[i].success);
  if (ok.length) {
    await UserDevice.update({ failureCount: 0 }, { where: { token: { [Op.in]: ok }, failureCount: { [Op.gt]: 0 } } });
  }
}

/**
 * Отправка через FCM. Сообщение data-only: интерфейс уведомления рисует сам
 * клиент через notifee. Так мы контролируем внешний вид, группировку по чату и
 * подавление, когда нужный чат уже открыт — с notification-payload система
 * показала бы уведомление сама, мимо всякой логики.
 */
async function sendFcm(tokens, data) {
  const results = { sent: 0, failed: 0 };

  for (const batch of chunk(tokens, MULTICAST_CHUNK)) {
    try {
      const res = await messaging.sendEachForMulticast({
        tokens: batch,
        // FCM требует, чтобы все значения data были строками
        data,
        android: {
          // Без high приложение, выгруженное из памяти, не проснётся
          priority: 'high'
        }
      });
      results.sent += res.successCount;
      results.failed += res.failureCount;
      if (res.failureCount > 0) {
        await handleFailures(batch, res.responses);
      }
    } catch (err) {
      console.error('[push] Ошибка отправки FCM:', err.message);
      results.failed += batch.length;
    }
  }

  return results;
}

/**
 * Отправить push списку пользователей.
 *
 * @param {string[]} userIds — кому
 * @param {object} data — плоский объект, значения приводятся к строкам
 * @returns {Promise<{sent:number, failed:number, skipped:boolean}>}
 */
async function sendToUsers(userIds, data) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { sent: 0, failed: 0, skipped: true };
  }
  if (!init()) {
    return { sent: 0, failed: 0, skipped: true };
  }

  const devices = await UserDevice.findAll({
    where: {
      userId: { [Op.in]: userIds },
      isActive: true,
      // platform:'ios' с provider:'fcm' сюда не попадёт — у Apple без APNs-ключа
      // токен не выдаётся, такие устройства живут только на сокете
      provider: 'fcm'
    },
    attributes: ['token']
  });

  if (devices.length === 0) {
    return { sent: 0, failed: 0, skipped: true };
  }

  // Значения data в FCM обязаны быть строками, иначе весь запрос отлетает с 400
  const payload = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) continue;
    payload[k] = String(v);
  }

  return sendFcm(devices.map(d => d.token), payload);
}

/**
 * Push о новом сообщении в чате.
 *
 * Кому: всем участникам, кроме автора, у кого чат не приглушён. Онлайн-статус
 * намеренно НЕ учитываем: пользователь может сидеть в вебе на работе, и это не
 * повод оставлять телефон в кармане молчать. Подавлением занимается клиент —
 * он знает, открыт ли прямо сейчас этот чат.
 *
 * @param {object} params
 * @param {object} params.message — сообщение с подгруженным sender
 * @param {object} params.chat — чат с подгруженными members
 * @param {string} params.senderId
 */
async function notifyNewMessage({ message, chat, senderId }) {
  try {
    const recipients = (chat.members || [])
      .filter(m => m.userId !== senderId && !m.isNotificationMuted)
      .map(m => m.userId);

    if (recipients.length === 0) return;

    const senderName = message.sender?.displayName || message.sender?.username || 'Сообщение';

    let title = senderName;
    let body = message.content || '';
    if (chat.type === 'group') {
      // В группе важнее её название, автор уходит в текст
      title = chat.name || 'Группа';
      body = `${senderName}: ${body}`;
    }
    if (!message.content && message.attachments?.length) {
      const allImages = message.attachments.every(a => a.mimeType?.startsWith('image/'));
      const label = allImages ? '📷 Фото' : '📎 Файл';
      body = chat.type === 'group' ? `${senderName}: ${label}` : label;
    }
    if (body.length > 200) body = `${body.slice(0, 200)}…`;

    await sendToUsers(recipients, {
      kind: 'new_message',
      chatId: chat.id,
      chatType: chat.type,
      messageId: message.id,
      senderId,
      title,
      body
    });
  } catch (err) {
    // Push — вспомогательный канал: его падение не должно ломать отправку сообщения
    console.error('[push] notifyNewMessage error:', err.message);
  }
}

module.exports = {
  sendToUsers,
  notifyNewMessage,
  isEnabled: () => init()
};
