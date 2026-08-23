'use strict';

/**
 * Кто и что может удалить в чате (ver. 7.29).
 *
 * До 7.29 удаление было одно на всех и оставляло в переписке заглушку
 * «Сообщение удалено». При разборе завала такие заглушки превращали чат в
 * кладбище, поэтому их убрали, а удаление разделили на два действия:
 *
 *   «у себя»  — прячет сообщение только у того, кто удалил. Разрешено всем и
 *               всегда: это правка своего экрана, а не чужой переписки.
 *   «у всех»  — стирает сообщение физически. Правила ниже.
 *
 * Срок для автора взят такой же, как в привычных мессенджерах: сказанное вчера
 * уже прочитано, и стирать его задним числом значит переписывать чужую память
 * о разговоре. У администратора срока нет — ему разгребать мусор и сообщения
 * ботов, которые сами за собой не уберут.
 */

const DELETE_FOR_ALL_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * @param {object} message  — сообщение (senderId, createdAt, type)
 * @param {object} chat     — чат (type, createdBy)
 * @param {object} membership — членство удаляющего в этом чате (role)
 * @param {object} user     — тот, кто удаляет (id, isAdmin)
 * @param {number} [now]    — точка отсчёта, вынесена ради тестов
 */
function canDeleteForAll({ message, chat, membership, user, now = Date.now() }) {
  if (!message || !user) return false;

  // Системные сообщения — летопись чата («такого-то добавили в группу»).
  // Без неё непонятно, откуда взялись участники, поэтому её не трогает никто.
  if (message.type === 'system') return false;

  if (user.isAdmin) return true;

  if (chat?.type === 'group'
    && (String(chat.createdBy) === String(user.id) || membership?.role === 'admin')) {
    return true;
  }

  if (String(message.senderId) === String(user.id)) {
    return now - new Date(message.createdAt).getTime() <= DELETE_FOR_ALL_WINDOW_MS;
  }

  return false;
}

/**
 * Кто может закреплять и откреплять сообщения (ver. 7.33).
 *
 * В группе — только админы и создатель: закреп висит у всех в шапке, и право
 * туда что-то повесить не должно быть у каждого. В личной переписке админов
 * нет и вешать не на кого — там закрепляет любой из двоих.
 */
function canPin({ chat, membership, user }) {
  if (!chat || !user || !membership) return false;
  if (user.isAdmin) return true;
  if (chat.type === 'private') return true;
  return String(chat.createdBy) === String(user.id) || membership.role === 'admin';
}

module.exports = { canDeleteForAll, canPin, DELETE_FOR_ALL_WINDOW_MS };
