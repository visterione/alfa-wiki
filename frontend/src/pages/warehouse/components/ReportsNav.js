import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * Боковой список отчётов — тот самый, что стоит во вкладке «Отчёты».
 *
 * Вынесен отдельным компонентом, когда такой же список понадобился «Архиву»:
 * снимки разложены по видам отчётов, и разбирать их удобно тем же делением на
 * группы, каким отчёты строят. Вторая копия разъехалась бы с первой на первой же
 * правке — хотя бы потому, что бегунок под активным пунктом считается вручную.
 *
 * Бегунок считается по размерам, а не рисуется рамкой у активной кнопки: пункты
 * разной высоты (названия отчётов в две и три строки), и переход между ними
 * должен быть плавным, а не мигающим.
 *
 * Состав пунктов у обеих вкладок один и тот же — права на отчёты, — и держится
 * это на общей функции allowedReports. В «Архиве» сначала показывались только
 * виды, по которым есть снимки: список выходил короче и переставал быть похож на
 * соседнюю вкладку, а пустой отчёт в нём нельзя было даже найти глазами, чтобы
 * убедиться, что снимков по нему правда нет. Счётчиков у пунктов тоже нет —
 * сколько снимков внутри, видно на самой странице.
 */
export default function ReportsNav({ groups, titles, isVisible, active, onSelect }) {
  const navRef = useRef(null);
  const [slider, setSlider] = useState({ top: 0, height: 0 });

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;

    const recalc = () => {
      const el = nav.querySelector('.wh-reports__group button.is-active');
      if (!el) return;
      const navRect = nav.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      setSlider({ top: rect.top - navRect.top, height: rect.height });
    };

    recalc();
    const observer = new ResizeObserver(recalc);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [active, groups, titles]);

  return (
    <aside className="wh-reports__nav" ref={navRef}>
      <div className="wh-reports__slider"
           style={{ transform: `translateY(${slider.top}px)`, height: slider.height }} />
      {groups.filter(g => g.keys.some(isVisible)).map(g => (
        <div key={g.title} className="wh-reports__group">
          <h4>{g.title}</h4>
          {g.keys.filter(isVisible).map(k => (
            <button key={k} className={active === k ? 'is-active' : ''} onClick={() => onSelect(k)}>
              {titles[k]}
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
