import { useRef, useState, useLayoutEffect } from 'react';

export function useTabSlider(activeKey) {
  const wrapRef = useRef(null);
  const [slider, setSlider] = useState({ left: 0, width: 0, duration: 0 });

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const recalc = (animate) => {
      const active = wrap.querySelector('.rb-clinic-tab.active');
      if (!active) return;
      const newLeft = active.offsetLeft;
      setSlider(prev => ({
        left: newLeft,
        width: active.offsetWidth,
        duration: animate ? Math.min(0.65, 0.3 + Math.abs(newLeft - prev.left) / 2000) : 0,
      }));
    };

    recalc(true);

    const ro = new ResizeObserver(() => recalc(false));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [activeKey]);

  const sliderEl = (
    <div
      className="rb-clinic-tab-wrap-slider"
      style={{ left: slider.left, width: slider.width, '--slider-duration': `${slider.duration}s` }}
    />
  );

  return { wrapRef, sliderEl };
}
