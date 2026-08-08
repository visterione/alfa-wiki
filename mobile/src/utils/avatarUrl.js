import CONFIG from '../config';

/**
 * Полный URL аватара.
 *
 * Поле avatar в БД бывает трёх видов:
 *   - null / undefined
 *   - относительный путь: "uploads/avatars/foo.jpg" или "/uploads/avatars/foo.jpg"
 *   - абсолютный URL со старым хостом: "http://localhost:9001/uploads/..."
 *
 * Вся логика переехала в CONFIG.fileUrl — здесь остался тонкий алиас, чтобы не
 * править импорты по экранам. Раньше такой же код был продублирован в
 * ChatScreen.fixUrl и жил своей жизнью.
 */
export default function avatarUrl(avatar) {
  return CONFIG.fileUrl(avatar);
}
