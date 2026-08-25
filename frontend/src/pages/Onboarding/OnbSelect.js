/**
 * Выпадающий список модуля.
 *
 * Нативный `select` на трёх платформах выглядит по-разному и в двух из них не
 * подчиняется теме: на Android он серый с системной стрелкой, на Windows — с
 * прямыми углами. Рядом с остальными контролами раздела это читалось как чужой
 * элемент, поэтому список свой.
 *
 * Меню рисуется порталом в body и позиционируется по месту кнопки: внутри
 * модалки с `overflow: hidden` любой absolute-список обрезался бы её краем.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export default function OnbSelect({
  value,
  options,
  onChange,
  placeholder = 'Выбрать',
  disabled,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const selected = options.find(option => option.value === value) || null;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const escape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  // Позицию считаем в layout-фазе: между измерением и отрисовкой меню не должно
  // успеть мигнуть в левом верхнем углу.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(window.innerWidth - 16, Math.max(rect.width, 220));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 200 && above > below;
      setMenu({
        left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
        top: up ? undefined : rect.bottom + 6,
        bottom: up ? window.innerHeight - rect.top + 6 : undefined,
        width,
        maxHeight: Math.max(120, Math.min(300, (up ? above : below) - 8)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  return (
    <div className={`onb-cs ${open ? 'is-open' : ''} ${className}`} ref={rootRef}>
      <button
        type="button"
        className="onb-cs-trigger"
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
      >
        <span className={selected ? '' : 'is-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} />
      </button>

      {open && menu && createPortal(
        <div
          ref={menuRef}
          className="onb-cs-menu"
          style={{
            left: menu.left,
            top: menu.top,
            bottom: menu.bottom,
            width: menu.width,
            maxHeight: menu.maxHeight,
          }}
        >
          {options.length ? options.map(option => (
            <button
              type="button"
              key={option.value}
              className={option.value === value ? 'is-selected' : ''}
              onClick={() => { onChange(option.value); setOpen(false); }}
            >
              <span>
                {option.label}
                {option.hint && <small>{option.hint}</small>}
              </span>
              {option.value === value && <Check size={14} />}
            </button>
          )) : (
            <div className="onb-cs-empty">Пусто</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
