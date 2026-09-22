'use strict';

/**
 * Отметки на письмах и доставка их до сервера (ver. 8.58).
 *
 * Отметка живёт в двух местах сразу, и это не дублирование, а разные вещи.
 *
 * Флаг \Seen в IMAP — общий на весь ящик: прочитанное одним становится
 * прочитанным для всех. Пока часть сотрудников остаётся в Roundcube, ломать его
 * нельзя, поэтому мы его и читаем, и отдаём обратно.
 *
 * Поверх лежит личное состояние (mail_user_message_state): «я это читал», «я
 * взял в работу». Оно нужно как раз потому, что серверный флаг общий: в ящике
 * на пятерых иначе нельзя понять, дошли ли руки до письма лично у тебя.
 *
 * Наружу, на IMAP, изменения уходят через очередь, а не прямо из обработчика
 * запроса. Соединений мало и они общие на сотню ящиков; ждать свободного слота
 * внутри HTTP-запроса — значит подвесить интерфейс на действии, которое человек
 * считает мгновенным. Очередь переживает и перезапуск: без неё неудавшаяся
 * отправка потерялась бы, а следующая синхронизация вернула бы флаг с сервера и
 * отменила действие человека у него на глазах.
 */

const { Op } = require('sequelize');
const { sequelize, MailMessage, MailFolder, MailAccount, MailFlagOp } = require('../../models');
const { withConnection } = require('./imap');

// Операции, которые умеем доносить до сервера.
const OPS = {
  seen: { add: ['\\Seen'] },
  unseen: { remove: ['\\Seen'] },
  flag: { add: ['\\Flagged'] },
  unflag: { remove: ['\\Flagged'] },
  // Ставится не человеком, а самой отправкой ответа: стрелка «отвечено» должна
  // появиться и у коллег в Roundcube, иначе двое ответят на одно письмо.
  answered: { add: ['\\Answered'] },
  // Удаление стоит особняком: это не флаг, а перенос в «Корзину», и
  // обрабатывается оно отдельной веткой ниже.
  delete: { move: true },
};

// После скольких неудач перестаём пытаться. Пять — это несколько кругов
// синхронизации; если за них не вышло, дело не в случайном обрыве, и молча
// долбиться в сервер дальше бессмысленно.
const MAX_ATTEMPTS = 5;

/**
 * Ставит отметку: сразу в зеркале (чтобы интерфейс ответил мгновенно) и в
 * очередь на отправку. Личное состояние пишется только для тех операций, где
 * оно есть, — «взял в работу» серверного отражения не имеет вовсе.
 */
async function setFlag(message, userId, op) {
  if (!OPS[op]) throw new Error(`Неизвестная отметка «${op}»`);

  await sequelize.transaction(async (transaction) => {
    const patch = {};
    if (op === 'seen') patch.isSeen = true;
    if (op === 'unseen') patch.isSeen = false;
    if (op === 'flag') patch.isFlagged = true;
    if (op === 'unflag') patch.isFlagged = false;
    if (op === 'answered') patch.isAnswered = true;

    await MailMessage.update(patch, { where: { id: message.id }, transaction });

    if (op === 'seen' || op === 'unseen') {
      await sequelize.query(`
        INSERT INTO mail_user_message_state ("userId", "messageId", "isRead", "readAt", "updatedAt")
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT ("userId", "messageId") DO UPDATE SET
          "isRead" = EXCLUDED."isRead",
          "readAt" = COALESCE(mail_user_message_state."readAt", EXCLUDED."readAt"),
          "updatedAt" = NOW()
      `, {
        bind: [userId, message.id, op === 'seen', op === 'seen' ? new Date() : null],
        transaction,
      });
    }

    if (op === 'flag' || op === 'unflag') {
      await sequelize.query(`
        INSERT INTO mail_user_message_state ("userId", "messageId", "isStarred", "updatedAt")
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT ("userId", "messageId") DO UPDATE SET
          "isStarred" = EXCLUDED."isStarred", "updatedAt" = NOW()
      `, { bind: [userId, message.id, op === 'flag'], transaction });
    }

    // Противоположные невыполненные операции по этому же письму снимаем: если
    // человек успел передумать дважды, на сервер должно уехать только последнее.
    await MailFlagOp.destroy({
      where: { messageId: message.id, doneAt: null, op: { [Op.in]: oppositeOps(op) } },
      transaction,
    });

    await MailFlagOp.create({ messageId: message.id, userId, op }, { transaction });
  });
}

function oppositeOps(op) {
  switch (op) {
    case 'seen': return ['unseen'];
    case 'unseen': return ['seen'];
    case 'flag': return ['unflag'];
    case 'unflag': return ['flag'];
    default: return [];
  }
}

/**
 * Прячет письмо и ставит удаление в очередь.
 *
 * Строку не удаляем сразу: удаление настоящее, письмо уезжает в «Корзину» на
 * сервере и пропадает у всех. Но если сервер недоступен, а строку мы уже
 * стёрли, письмо осталось бы на сервере и при этом исчезло из портала навсегда
 * — обычная синхронизация его не вернёт, она забирает только UID выше
 * известного максимума. Поэтому сначала прячем, стираем после подтверждения.
 */
async function requestDelete(message, userId) {
  await sequelize.transaction(async (transaction) => {
    await MailMessage.update({ pendingDelete: true }, { where: { id: message.id }, transaction });
    await MailFlagOp.destroy({ where: { messageId: message.id, doneAt: null }, transaction });
    await MailFlagOp.create({ messageId: message.id, userId, op: 'delete' }, { transaction });
  });
}

/** Взял в работу — отметка чисто наша, на сервере ей соответствовать нечему. */
async function setTaken(messageId, userId, taken) {
  await sequelize.query(`
    INSERT INTO mail_user_message_state ("userId", "messageId", "takenAt", "updatedAt")
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT ("userId", "messageId") DO UPDATE SET "takenAt" = EXCLUDED."takenAt", "updatedAt" = NOW()
  `, { bind: [userId, messageId, taken ? new Date() : null] });
}

/**
 * Разгребает очередь. Операции сортируются по ящикам и папкам, чтобы одно
 * соединение закрыло сразу всё накопившееся, а не открывалось на каждый флаг.
 */
async function drainFlagOps(limit = 200) {
  const pending = await MailFlagOp.findAll({
    where: { doneAt: null, attempts: { [Op.lt]: MAX_ATTEMPTS } },
    order: [['createdAt', 'ASC']],
    limit,
    include: [{
      model: MailMessage,
      as: 'message',
      required: true,
      include: [{ model: MailFolder, as: 'folder', required: true }],
    }],
  });

  if (!pending.length) return { pushed: 0 };

  // Ящик → папка → список операций.
  const byAccount = new Map();
  for (const item of pending) {
    const accountId = item.message.accountId;
    if (!byAccount.has(accountId)) byAccount.set(accountId, new Map());
    const folders = byAccount.get(accountId);
    const folderPath = item.message.folder.path;
    if (!folders.has(folderPath)) folders.set(folderPath, []);
    folders.get(folderPath).push(item);
  }

  let pushed = 0;

  for (const [accountId, folders] of byAccount) {
    const account = await MailAccount.scope('withSecret').findByPk(accountId);
    if (!account || !account.isActive) continue;

    try {
      await withConnection(account, async (client) => {
        for (const [folderPath, items] of folders) {
          // Пишущий режим: readOnly здесь не годится, мы как раз меняем флаги.
          await client.mailboxOpen(folderPath, { readOnly: false });

          for (const item of items) {
            try {
              const spec = OPS[item.op];
              const uid = String(item.message.uid);

              if (spec.move) {
                await deleteOnServer(client, account, item.message, folderPath);
                // Сервер подтвердил — теперь можно стереть у себя. Письмо
                // вернётся к нам уже в «Корзине», обычной синхронизацией.
                await item.update({ doneAt: new Date(), lastError: null });
                await item.message.destroy();
                pushed += 1;
                continue;
              }

              if (spec.add) await client.messageFlagsAdd(uid, spec.add, { uid: true });
              if (spec.remove) await client.messageFlagsRemove(uid, spec.remove, { uid: true });
              await item.update({ doneAt: new Date(), lastError: null });
              pushed += 1;
            } catch (err) {
              // Письмо могли удалить из Roundcube, пока отметка ждала очереди.
              // Это не повод останавливать остальные — просто считаем попытку.
              const attempts = item.attempts + 1;
              await item.update({ attempts, lastError: String(err.message || err).slice(0, 1000) });

              // Если удаление окончательно не вышло, письмо надо вернуть в
              // список: оно осталось на сервере, и прятать его от людей значит
              // потерять его для портала насовсем.
              if (item.op === 'delete' && attempts >= MAX_ATTEMPTS) {
                await item.message.update({ pendingDelete: false });
                console.warn(`📬 Почта: удаление письма uid=${item.message.uid} не прошло, письмо возвращено в список`);
              }
            }
          }

          await client.mailboxClose();
        }
      });
    } catch (err) {
      // Не достучались до ящика целиком: помечаем попытку всем его операциям,
      // чтобы они не крутились в очереди вечно.
      for (const items of folders.values()) {
        for (const item of items) {
          await item.update({ attempts: item.attempts + 1, lastError: String(err.message || err).slice(0, 1000) });
        }
      }
    }
  }

  return { pushed };
}

/**
 * Убирает письмо на сервере. Предпочитаем перенос в «Корзину», а не пометку
 * \\Deleted с последующим EXPUNGE: корзина — это то, что человек ожидает, и
 * ошибочно удалённое письмо оттуда можно достать. Безвозвратно стираем только
 * то, что уже лежит в корзине, — второе удаление означает именно это.
 *
 * MOVE есть не на всех серверах; где его нет, делаем то же самое в два шага.
 */
async function deleteOnServer(client, account, message, folderPath) {
  const trash = await MailFolder.findOne({ where: { accountId: account.id, specialUse: '\\Trash' } })
    || await MailFolder.findOne({ where: { accountId: account.id, name: { [Op.iLike]: '%корзин%' } } });

  const uid = String(message.uid);
  const alreadyInTrash = trash && trash.path === folderPath;

  if (!trash || alreadyInTrash) {
    await client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true });
    // Без EXPUNGE письмо осталось бы висеть зачёркнутым в Roundcube — для
    // человека это «не удалилось».
    if (typeof client.messageDelete === 'function') {
      await client.messageDelete(uid, { uid: true });
    }
    return 'expunged';
  }

  if (client.capabilities.has('MOVE')) {
    await client.messageMove(uid, trash.path, { uid: true });
  } else {
    await client.messageCopy(uid, trash.path, { uid: true });
    await client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true });
    if (typeof client.messageDelete === 'function') await client.messageDelete(uid, { uid: true });
  }

  return 'trashed';
}

/** Выполненные операции старше недели не нужны — очередь не архив. */
async function cleanupFlagOps() {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  return MailFlagOp.destroy({ where: { doneAt: { [Op.lt]: cutoff } } });
}

module.exports = { setFlag, setTaken, requestDelete, deleteOnServer, drainFlagOps, cleanupFlagOps, OPS, MAX_ATTEMPTS };
