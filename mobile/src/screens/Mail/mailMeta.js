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

// Почтовый HTML может быть любым. В приложении не исполняем его и не тянем
// внешние картинки: для чтения в дороге безопаснее и понятнее текстовая версия.
export function bodyText(body) {
  if (body?.text) return String(body.text).trim();
  return String(body?.html || '')
    .replace(/<\/(p|div|br|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sizeText(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

export function initials(value) {
  return String(value || '?').trim().slice(0, 1).toUpperCase();
}
