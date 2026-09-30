export function senderName(message) {
  return message?.fromName || message?.fromEmail || 'Неизвестный отправитель';
}

export function listDate(value) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
  }
  if (date.getFullYear() === today.getFullYear()) {
    return date.toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'});
  }
  return date.toLocaleDateString('ru-RU', {day: '2-digit', month: '2-digit', year: '2-digit'});
}

export function fullDate(value) {
  return value ? new Date(value).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '';
}

// Текст письма без вёрстки — только для писем, у которых HTML нет вовсе.
// Письма с разметкой показывает MailBody в WebView.
export function bodyText(body) {
  return String(body?.text || '').trim();
}

/**
 * Корзина и Спам: перенос туда равен удалению, и без права на удаление сервер
 * его отвергнет (ver. 9.11). Имя проверяем на случай сервера без SPECIAL-USE —
 * то же правило, что на сервере.
 */
export function isDisposalFolder(folder) {
  if (folder?.specialUse === '\\Trash' || folder?.specialUse === '\\Junk') return true;
  return /корзин|спам|trash|junk|spam|deleted/i.test(`${folder?.path || ''} ${folder?.name || ''}`);
}

export function isInbox(folder) {
  return String(folder?.path || '').toUpperCase() === 'INBOX';
}

/** «INBOX» у сервера — «Входящие» у человека. */
export function folderTitle(folder) {
  if (!folder) return '';
  return isInbox(folder) && /^inbox$/i.test(folder.name || '') ? 'Входящие' : (folder.name || folder.path);
}

export function sizeText(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

export function initials(value) {
  return String(value || '?').trim().slice(0, 1).toUpperCase();
}
