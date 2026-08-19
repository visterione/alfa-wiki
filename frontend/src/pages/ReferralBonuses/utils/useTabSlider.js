import { useCallback, useLayoutEffect, useState } from 'react';

/**
 * Бегунок под активной вкладкой: подсветку рисует не сама кнопка, а отдельный
 * абсолютный блок, который переезжает к активной вкладке. Его left и width
 * известны только из замера DOM — и в этом всё коварство.
 *
 * Раньше замер жил в useLayoutEffect с зависимостью от активной вкладки и брал
 * узел из обычного ref. Если в момент замера полосы вкладок не было в документе
 * (блок ещё не отрисован, потому что не приехали данные; модалка не открыта) или
 * она была спрятана display:none — эффект выходил на первой строке,
 * ResizeObserver даже не создавался, и бегунок навсегда оставался нулевой
 * ширины. Активная вкладка при этом рисует белый текст поверх белой карточки:
 * не читается совсем, пока не переключишь вкладку и эффект не перезапустится.
 * Ровно это и видно было после каждой перезагрузки страницы.
 *
 * Поэтому узел ловится callback-ref'ом через состояние: эффект перезапускается
 * сам, когда полоса наконец появляется в документе. Нулевой замер (полоса ещё
 * скрыта) не сохраняется — ждём ResizeObserver, он разбудит нас, когда у
 * элемента появится размер. Наблюдаем и за самой активной вкладкой: её ширина
 * меняется от подгрузки шрифта и логотипов клиник, ширина полосы при этом та же,
 * и такой сдвиг раньше терялся.
 *
 * На время, пока замера нет, полоса помечается data-slider-ready="0" — по этому
 * признаку CSS красит активную вкладку сам, так что читаемость не зависит от
 * того, успел ли JS измерить.
 */
export function useTabSlider(activeKey, options = {}) {
  const {
    itemSelector = '.rb-clinic-tab',
    sliderClass = 'rb-clinic-tab-wrap-slider',
  } = options;

  // Узел держим в состоянии, а не в ref: React зовёт callback-ref и при
  // монтировании, и при размонтировании, поэтому эффект видит появление полосы.
  const [wrap, setWrap] = useState(null);
  const wrapRef = useCallback(node => setWrap(node), []);
  const [slider, setSlider] = useState({ left: 0, width: 0, duration: 0 });

  useLayoutEffect(() => {
    if (!wrap) return;

    let observedItem = null;

    const recalc = (animate) => {
      const item = wrap.querySelector(`${itemSelector}.active`);
      // Нулевая ширина — полоса скрыта (display:none у родителя, закрытая
      // модалка). Замерять нечего, вернёмся по сигналу ResizeObserver.
      if (!item || !item.offsetWidth) {
        wrap.dataset.sliderReady = '0';
        return;
      }
      if (observedItem !== item) {
        if (observedItem) ro.unobserve(observedItem);
        ro.observe(item);
        observedItem = item;
      }
      wrap.dataset.sliderReady = '1';

      const left = item.offsetLeft;
      const width = item.offsetWidth;
      setSlider(prev => {
        // ResizeObserver при observe сразу отдаёт первый замер, и он совпадает с
        // тем, что мы только что посчитали. Вернуть новый объект значит сбросить
        // duration в ноль и оборвать уже начавшийся переезд бегунка.
        if (prev.left === left && prev.width === width) return prev;
        return {
          left,
          width,
          // Первое появление (ширины ещё не было) не анимируем: бегунок должен
          // просто оказаться на месте, а не разъезжаться из нуля.
          duration: animate && prev.width ? Math.min(0.65, 0.3 + Math.abs(left - prev.left) / 2000) : 0,
        };
      });
    };

    const ro = new ResizeObserver(() => recalc(false));
    ro.observe(wrap);
    recalc(true);

    return () => ro.disconnect();
  }, [wrap, activeKey, itemSelector]);

  const sliderEl = (
    <div
      className={sliderClass}
      style={{ left: slider.left, width: slider.width, '--slider-duration': `${slider.duration}s` }}
    />
  );

  return { wrapRef, sliderEl };
}
