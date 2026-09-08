'use strict';

/**
 * Безопасная отдача присланных файлов (ver. 8.07).
 *
 * ЧТО БЫЛО НЕ ТАК. Вложения открытой линии, файлы анкет онбординга и вложения
 * чатов лежат в uploads и отдаются express.static. Расширение файла берётся из
 * имени, которое прислал отправитель (services/openLineFiles.js), Content-Type
 * express.static выводит из расширения, а заголовка Content-Disposition не было
 * вовсе. Значит присланный в бот файл «справка.html» или «снимок.svg»
 * открывался у сотрудника КАК СТРАНИЦА, на домене портала. А в localStorage
 * этого домена лежит токен сотрудника — то есть скрипт внутри такого файла
 * получал доступ к его сессии. Достаточно, чтобы оператор нажал на вложение.
 *
 * ЧТО ДЕЛАЕМ. Смотреть в браузере разрешаем только тому, что смотрят на самом
 * деле: картинкам, pdf, видео, звуку и простому тексту. Всё остальное уходит
 * файлом на диск (Content-Disposition: attachment) — открыть его можно, но уже
 * не в нашем origin. Плюс два заголовка на всякий случай:
 *
 *   X-Content-Type-Options: nosniff — браузер не «догадывается» о типе сам;
 *   Content-Security-Policy: default-src 'none'; sandbox — даже если файл
 *     всё-таки окажется отрисован, он попадает в пустой origin без прав.
 *
 * ПОЧЕМУ SVG НЕ СЧИТАЕТСЯ КАРТИНКОЙ. Он картинка, пока лежит в <img>. Открытый
 * прямой ссылкой, он документ и выполняет свои скрипты — то есть ровно та же
 * дыра, что и html.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Правило одно на три каталога с чужим содержимым:
 * пациенты пишут в бот, кандидаты присылают документы в анкету, сотрудники
 * шлют файлы в чат. Держать это в трёх местах — значит однажды поправить два.
 */

const path = require('path');

// То, что браузер показывает и чем нельзя выполнить код. Список намеренно
// короткий: всё, чего в нём нет, скачивается, и это не потеря — файл открывается
// той программой, которой и должен.
const INLINE_SAFE = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.ico', '.heic',
  '.pdf',
  '.mp4', '.webm', '.mov', '.m4v',
  '.mp3', '.m4a', '.wav', '.oga', '.ogg', '.opus',
  '.txt'
]);

/** Можно ли показывать такой файл прямо в браузере. */
function isInlineSafe(filePath) {
  return INLINE_SAFE.has(path.extname(String(filePath || '')).toLowerCase());
}

/**
 * Имя для заголовка. В Content-Disposition нельзя класть что попало: перевод
 * строки в имени разрывает заголовок и позволяет подставить свой. Поэтому в
 * ASCII-имени оставляем только безобидное, а настоящее отдаём в filename*.
 */
function dispositionFor(filePath) {
  const name = path.basename(String(filePath || '')) || 'file';
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Проставляет заголовки на ответ со статикой.
 * @param {Object} res      ответ Express
 * @param {string} filePath путь к отдаваемому файлу
 */
function applyUploadSafety(res, filePath) {
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (isInlineSafe(filePath)) return;

  res.setHeader('Content-Disposition', dispositionFor(filePath));
  // Заменяет общий CSP приложения на этом ответе: у присланного файла не должно
  // быть права ни на скрипты, ни на свой origin.
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
}

/**
 * Оборачивает setHeaders для express.static: сначала то, что было (типы видео,
 * Range), потом наши ограничения — они должны иметь последнее слово.
 */
function secureUploadHeaders(base) {
  return (res, filePath, stat) => {
    if (typeof base === 'function') base(res, filePath, stat);
    applyUploadSafety(res, filePath);
  };
}

module.exports = { isInlineSafe, dispositionFor, applyUploadSafety, secureUploadHeaders, INLINE_SAFE };
