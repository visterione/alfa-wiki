import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

/** Выпадающий список модуля — одинаковый во всех браузерах и темах. */
export default function CustomSelect({ label, value, options, onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const selected = options.find(option => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = event => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = event => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const position = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const compact = className.split(/\s+/).includes('is-compact');
      const wantedWidth = compact ? Math.max(rect.width, 190) : Math.max(rect.width, 220);
      const width = Math.min(window.innerWidth - 16, wantedWidth);
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const opensUp = spaceBelow < 190 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(110, Math.min(280, (opensUp ? spaceAbove : spaceBelow) - 8));
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setMenuStyle(opensUp
        ? { position: 'fixed', left, bottom: window.innerHeight - rect.top + 7, width, maxHeight }
        : { position: 'fixed', left, top: rect.bottom + 7, width, maxHeight });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, className]);

  return (
    <div className={`tsk-custom-select ${open ? 'is-open' : ''} ${className}`} ref={rootRef}>
      {label && <span className="tsk-custom-select-label">{label}</span>}
      <button
        type="button"
        className="tsk-custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!open) setMenuStyle(null);
          setOpen(!open);
        }}
      >
        <span className="tsk-custom-select-value">
          {selected?.color && <i className="tsk-custom-select-dot" style={{ background: selected.color }} />}
          <span>{selected?.label}</span>
        </span>
        <ChevronDown size={15} />
      </button>
      {open && menuStyle && createPortal(
        <div className={`tsk-custom-select-menu is-portal ${className.includes('is-compact') ? 'is-compact' : ''}`}
          role="listbox" ref={menuRef} style={menuStyle}>
          {options.map(option => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? 'is-selected' : ''}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="tsk-custom-select-value">
                {option.color && <i className="tsk-custom-select-dot" style={{ background: option.color }} />}
                <span>{option.label}</span>
              </span>
              {option.value === value && <Check size={15} />}
            </button>
          ))}
        </div>, document.body
      )}
    </div>
  );
}
