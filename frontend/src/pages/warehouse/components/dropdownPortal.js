import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

/**
 * Общая механика выпадающих списков модуля: панель рисуется порталом в body с
 * фиксированными координатами, а не абсолютом внутри поля.
 *
 * Причина простая: поля стоят в прокручиваемом теле модального окна
 * (.wh-modal__body с overflow-y: auto) и в ячейках таблиц с overflow: auto, а
 * такой предок обрезает всё, что вылезает за его край, — абсолютно
 * позиционированный список превращался в полоску в две строки с собственной
 * прокруткой. Сначала это починили в выборе кабинета (ver. 7.04), потом та же
 * беда нашлась у обычного комбобокса в модалке инвентаризации — поэтому код
 * переехал сюда, а не был скопирован во второй раз.
 */

/**
 * Узел под портал: div в конце body с классом wh-app.
 *
 * Класс здесь не для вида. Токены модуля (--wh-bg, --wh-card-bg, --wh-border и
 * прочие полсотни) объявлены на корневом .wh-app — складской модуль намеренно не
 * лезет в :root портала. Список же выносится порталом в body, то есть наружу из
 * .wh-app, и там каждый var(--wh-…) разрешался в пустоту: панель оставалась без
 * фона и без рамки, и сквозь неё просвечивал серый фон страницы.
 *
 * display: contents у обёртки (в CSS) убирает её собственную коробку вместе с
 * отступами .wh-app — наследование значений при этом сохраняется, а лишнего
 * блока в конце страницы не появляется.
 */
export function usePortalHost() {
  const [host] = useState(() => {
    const node = document.createElement('div');
    node.className = 'wh-app wh-portal-host';
    return node;
  });
  useEffect(() => {
    document.body.appendChild(host);
    return () => host.remove();
  }, [host]);
  return host;
}

/**
 * Координаты открытой панели под полем anchorRef.
 *
 * Раскрывается вниз, а если внизу тесно — вверх; за нижний край экрана список
 * не выходит в любом случае. Возвращает null, пока список закрыт, — по нему же
 * удобно решать, рисовать портал или нет.
 */
export function useAnchoredDrop(anchorRef, open, { minHeight = 180, maxHeight = 420 } = {}) {
  const [place, setPlace] = useState(null);

  const reposition = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 4;
    const below = window.innerHeight - rect.bottom - gap - 8;
    const above = rect.top - gap - 8;
    const up = below < 240 && above > below;
    setPlace({
      left: rect.left,
      width: rect.width,
      top: up ? undefined : rect.bottom + gap,
      bottom: up ? window.innerHeight - rect.top + gap : undefined,
      maxHeight: Math.max(minHeight, Math.min(maxHeight, up ? above : below)),
    });
  }, [anchorRef, minHeight, maxHeight]);

  useLayoutEffect(() => {
    if (!open) { setPlace(null); return undefined; }
    reposition();
    // Прокрутка любого предка сдвигает поле — список едет за ним. Слушаем в фазе
    // перехвата, иначе прокрутка внутренних контейнеров сюда не долетает.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);

  return place;
}

/** Инлайновые координаты для панели: перебивают absolute из .wh-combo__drop. */
export function dropStyle(place) {
  return {
    position: 'fixed',
    left: place.left,
    width: place.width,
    top: place.top,
    bottom: place.bottom,
    right: 'auto',
  };
}
