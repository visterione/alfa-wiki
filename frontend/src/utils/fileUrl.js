import { BASE_URL } from '../services/api';

/**
 * Адрес файла по тому, что лежит в базе.
 *
 * Картинки портала живут в двух разных местах, и по пути это видно:
 *   uploads/…     — загрузки бэкенда (аватарки, вложения, логотипы из карточки
 *                   филиала). Их отдаёт сервер на 9001;
 *   /lab-logos/…  — статика фронта, положенная в репозиторий руками. Её отдаёт
 *                   тот же сервер, что и саму страницу.
 *
 * На бою разницы не видно: nginx отдаёт статику и проксирует /uploads с одного
 * адреса. А на dev-сервере :9000 она решающая — про /uploads он не знает, и
 * аватарка, собранная от origin, там просто не грузится; логотип филиала,
 * собранный от адреса бэкенда, — наоборот.
 *
 * Абсолютные ссылки с localhost остаются в базе от загрузок на машине
 * разработчика: файл лежит там же, где и остальные, а хост в ссылке чужой.
 */
export function fileUrl(value) {
  if (!value) return null;

  if (value.startsWith('http://localhost') || value.startsWith('https://localhost')) {
    return `${BASE_URL}/${value.replace(/^https?:\/\/localhost:\d+\//, '')}`;
  }
  if (value.startsWith('http')) return value;

  const path = value.replace(/^\/+/, '');
  return path.startsWith('uploads/')
    ? `${BASE_URL}/${path}`
    : `${process.env.PUBLIC_URL || ''}/${path}`;
}

export default fileUrl;
