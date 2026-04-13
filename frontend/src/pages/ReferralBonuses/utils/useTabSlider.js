import { useRef, useState, useLayoutEffect } from 'react';

export function useTabSlider(activeKey) {
  const wrapRef = useRef(null);
  const [slider, setSlider] = useState({ left: 0, width: 0, duration: 0 });

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const active = wrap.querySelector('.rb-clinic-tab.active');
    if (!active) return;
    const newLeft = active.offsetLeft;
    const distance = Math.abs(newLeft - slider.left);
    const duration = Math.min(0.65, 0.3 + distance / 2000);
    setSlider({ left: newLeft, width: active.offsetWidth, duration });
  }, [activeKey]);

  const sliderEl = (
    <div
      className="rb-clinic-tab-wrap-slider"
      style={{ left: slider.left, width: slider.width, '--slider-duration': `${slider.duration}s` }}
    />
  );

  return { wrapRef, sliderEl };
}
