'use strict';

/**
 * Рамка обрезки аватара, присланная клиентом (ver. 7.75).
 *
 * Клиент показывает снимок в круглом окне и даёт его двигать и приближать; сюда
 * приезжает то, что в окно попало, — прямоугольник в координатах исходной
 * картинки. Раньше выбора не было вовсе: sharp с fit:'cover' брал середину
 * кадра, и у вертикального снимка в аватар попадала не голова, а то, что
 * случайно оказалось по центру.
 *
 * Координаты считаются в картинке, уже повёрнутой по метке EXIF: в окне человек
 * видит именно её, а не то, как пиксели лежат в файле.
 *
 * Рамка приходит от клиента, поэтому проверяется целиком. Кривая рамка — не
 * ошибка запроса: возвращаем null, и вызывающий берёт центр кадра, как до
 * появления обрезки. Отказывать из-за неё в загрузке фотографии не за что.
 */
function parseAvatarCrop(raw, meta) {
  if (!raw || !meta?.width || !meta?.height) return null;

  let box;
  try {
    box = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!box || typeof box !== 'object') return null;

  const left = Math.round(Number(box.x));
  const top = Math.round(Number(box.y));
  const width = Math.round(Number(box.width));
  const height = Math.round(Number(box.height));

  if (![left, top, width, height].every(Number.isFinite)) return null;
  if (width < 1 || height < 1) return null;
  if (left < 0 || top < 0) return null;
  // Выход за край — это не «подрезать до края»: рамка, которую клиент считал
  // иначе, чем сервер, лучше пусть будет отброшена целиком, чем даст обрезок,
  // не похожий на то, что человек видел в окне
  if (left + width > meta.width || top + height > meta.height) return null;

  return { left, top, width, height };
}

module.exports = { parseAvatarCrop };
