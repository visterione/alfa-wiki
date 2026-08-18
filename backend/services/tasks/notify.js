'use strict';

/**
 * Уведомления модуля «Задачи».
 *
 * Раньше они приходили сообщениями от Альфа-Ассистента в чат. Это работало, но
 * ставило рабочее уведомление в один ряд с перепиской: чтобы узнать о новой
 * задаче, надо было открыть мессенджер, а прочитанное сообщение бота уже ничем
 * не отличалось от непрочитанного. Теперь уведомление — это уведомление:
 * всплывающее окно в вебе и push на телефоне.
 *
 * Ничего не хранится. Источником правды остаются сама задача и её история
 * (task_history), а уведомление — сигнал «посмотри туда сейчас». Заводить под
 * него отдельную таблицу значит завести второй, расходящийся с историей журнал
 * и обязанность его чистить.
 *
 * Доставка не может помешать работе: упавший сокет или недоступный FCM не
 * должны откатывать уже выполненное действие с задачей. Поэтому все ошибки
 * гасятся здесь же, а вызывающий код о них не знает.
 */

const notificationService = require('../notificationService');
const pushService = require('../pushService');

/**
 * @param {string[]} userIds  кому (дубли и пустые значения отсеиваются)
 * @param {object}   event
 * @param {string}   event.title  короткая суть: «Новая задача»
 * @param {string}   event.body   подробность: кто и что сделал
 * @param {string}   [event.taskId] куда вести по нажатию
 * @param {string}   [event.code]   код задачи (РЕМ-42) для заголовка
 */
async function notify(userIds, { title, body, taskId = null, code = null }) {
  const recipients = [...new Set((userIds || []).filter(Boolean))];
  if (!recipients.length) return;

  const payload = {
    kind: 'task',
    title,
    body,
    code: code || '',
    taskId: taskId || '',
    at: new Date().toISOString(),
  };

  try {
    const io = notificationService.getIo();
    if (io) {
      for (const userId of recipients) {
        io.to(`user:${userId}`).emit('task:notify', payload);
      }
    }
  } catch (error) {
    console.error('[tasks/notify] сокет:', error.message);
  }

  try {
    // Push уходит всем получателям, включая тех, кто сейчас сидит в вебе:
    // человек может быть за рабочим компьютером и всё равно хотеть знать о
    // задаче в дороге. Подавлением занимается клиент — он знает, открыт ли
    // прямо сейчас нужный экран.
    await pushService.sendToUsers(recipients, payload);
  } catch (error) {
    console.error('[tasks/notify] push:', error.message);
  }
}

module.exports = { notify };
