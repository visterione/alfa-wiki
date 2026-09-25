import { useState, useCallback } from 'react';

/**
 * Размеры, которые человек подобрал себе мышью (ver. 8.78).
 *
 * Раскладку почты делали под свой экран, а экраны у людей разные: одному
 * тесно в списке, другому в окне письма. Размер запоминаем в localStorage —
 * это настройка рабочего места, а не учётной записи: на ноутбуке и на большом
 * мониторе удобная ширина разная, и общий размер на все устройства мешал бы.
 *
 * localStorage бывает недоступен (приватное окно, запрет сайта), поэтому все
 * обращения в try/catch: без него просто открывается размер по умолчанию.
 */
export function useStoredSize(key) {
  const [size, setSize] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  });

  const save = useCallback((value) => {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* не запомнилось — не страшно, до перезагрузки размер держится */ }
  }, [key]);

  return [size, setSize, save];
}

/**
 * Тянет ручку мышью или пальцем. onMove получает смещение от точки захвата,
 * onEnd зовётся один раз по отпусканию — там и сохраняем, а не на каждое
 * движение, иначе localStorage пишется десятки раз в секунду.
 *
 * Пока тянем, на body вешается класс: он держит курсор и отключает выделение
 * текста, иначе при быстром движении мышь соскальзывает с узкой ручки и
 * вместо изменения размера выделяется половина письма.
 */
export function startDrag(event, cursor, onMove, onEnd) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  document.body.classList.add('mail-resizing');
  document.body.style.setProperty('--mail-resize-cursor', cursor);

  const move = (e) => onMove(e.clientX - startX, e.clientY - startY);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    document.body.classList.remove('mail-resizing');
    document.body.style.removeProperty('--mail-resize-cursor');
    onEnd?.();
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
