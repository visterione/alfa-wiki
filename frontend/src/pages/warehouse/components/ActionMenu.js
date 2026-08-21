import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { dropStyle, useAnchoredDrop, usePortalHost } from './dropdownPortal';

/**
 * Кнопка с выпадающим списком действий.
 *
 * Появилась ради полосы отчётов: рядом с «Сформировать» стояли XLSX, PDF и
 * «Сохранить» — три кнопки подряд, каждая со своим значком, и все три
 * бесполезны, пока отчёт не построен. Занимали они полполосы, а нажимают из них
 * одну и в конце работы. Собранные в один список, они перестали спорить за
 * внимание с главной кнопкой.
 *
 * Панель рисуется порталом по тем же причинам, что и списки комбобокса
 * (см. dropdownPortal.js): полоса фильтров стоит в прокручиваемом теле модуля, и
 * абсолютный список обрезался бы её краем.
 *
 * Недоступные пункты остаются в списке, а не исчезают: список, у которого
 * меняется состав, приходится перечитывать каждый раз заново. Причину
 * недоступности объясняет подсказка на самом пункте.
 */
export default function ActionMenu({ label, icon, items, disabled = false, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const dropRef = useRef(null);
  const portalHost = usePortalHost();
  const place = useAnchoredDrop(boxRef, open, { minHeight: 60, maxHeight: 320 });

  // Клик мимо и Escape закрывают список — иначе он висит поверх таблицы и
  // перехватывает нажатия по ней.
  useEffect(() => {
    if (!open) return undefined;
    const onDocument = (event) => {
      if (boxRef.current?.contains(event.target)) return;
      if (dropRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocument);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocument);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (item) => {
    if (item.disabled) return;
    setOpen(false);
    item.onSelect();
  };

  return (
    <div className="wh-menu" ref={boxRef}>
      <button type="button" className="wh-btn wh-btn--ghost wh-menu__button"
              disabled={disabled} onClick={() => setOpen(v => !v)}
              aria-haspopup="menu" aria-expanded={open}>
        {icon} {label} <ChevronDown size={14} className={open ? 'is-open' : ''} />
      </button>

      {open && place && createPortal((
        <div className="wh-menu__drop" ref={dropRef} role="menu"
             style={{
               ...dropStyle(place),
               // Ширина панели своя: у кнопки она короткая, а пункты подписаны
               // словами. Правый край при этом держится за край кнопки — список
               // висит под действиями, а не уезжает за край полосы.
               //
               // left: 'auto' здесь обязателен. В .wh-menu__drop прописан left: 0
               // (панель комбобокса растягивается по полю), и если просто не
               // задать left, победит именно он: список получал левый край у края
               // экрана и растягивался на всю ширину страницы.
               width: 'auto',
               minWidth: Math.max(place.width, 190),
               left: align === 'right' ? 'auto' : place.left,
               right: align === 'right' ? window.innerWidth - place.left - place.width : 'auto',
             }}>
          {items.map(item => (
            <button type="button" key={item.key} role="menuitem"
                    className="wh-menu__item" disabled={item.disabled}
                    title={item.hint || undefined}
                    onClick={() => pick(item)}>
              {item.icon}
              <span className="wh-menu__item-label">{item.label}</span>
            </button>
          ))}
        </div>
      ), portalHost)}
    </div>
  );
}
