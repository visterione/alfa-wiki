/**
 * Какой чат открыт прямо сейчас.
 *
 * Нужен ровно для одного решения: показывать ли уведомление о новом сообщении.
 * Если пользователь смотрит на этот самый чат, уведомление — шум: сообщение уже
 * прилетело по сокету и отрисовано в ленте.
 *
 * Отдельный модуль, а не React-состояние, потому что читать это значение
 * приходится из обработчиков FCM, живущих вне дерева компонентов
 * (setBackgroundMessageHandler регистрируется в index.js).
 */

let activeChatId = null;
let isForeground = true;

export function setActiveChat(chatId) {
  activeChatId = chatId ? String(chatId) : null;
}

export function clearActiveChat() {
  activeChatId = null;
}

export function isChatOpen(chatId) {
  return activeChatId !== null && String(chatId) === activeChatId;
}

export function setForeground(value) {
  isForeground = Boolean(value);
}

/**
 * Показывать ли уведомление о сообщении из этого чата.
 * Глушим только когда приложение на экране И открыт именно этот чат.
 */
export function shouldNotify(chatId) {
  if (!isForeground) return true;
  return !isChatOpen(chatId);
}
