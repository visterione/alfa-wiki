import React, { useState, useEffect, useRef } from 'react';

export default function SearchableSelect({ value, onChange, options, style, multiSelect }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = e => {
      if (!wrapRef.current?.contains(e.target)) { setOpen(false); setSearch(''); }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const arrValue = multiSelect ? (Array.isArray(value) ? value : []) : null;

  const isSelected = (optValue) => multiSelect
    ? arrValue.includes(String(optValue))
    : String(optValue) === String(value);

  const hasValue = multiSelect ? arrValue.length > 0 : value !== '';

  const selectedLabel = multiSelect
    ? (arrValue.length === 0
        ? (options[0]?.label ?? '')
        : arrValue.length === 1
            ? (options.find(o => String(o.value) === arrValue[0])?.label ?? arrValue[0])
            : `${arrValue.length} выбрано`)
    : (options.find(o => String(o.value) === String(value))?.label ?? '');

  const filtered = search
    ? options.filter(o => o.value === '' || o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const handleSelect = (optValue) => {
    if (multiSelect) {
      if (String(optValue) === '') {
        onChange([]);
      } else {
        const strVal = String(optValue);
        onChange(arrValue.includes(strVal)
          ? arrValue.filter(v => v !== strVal)
          : [...arrValue, strVal]);
      }
    } else {
      onChange(optValue);
      setOpen(false);
      setSearch('');
    }
  };

  return (
    <div className={`rb-ss-wrap${open ? ' open' : ''}`} ref={wrapRef} style={style}>
      <button
        type="button"
        className={`rb-ss-trigger${hasValue ? ' has-value' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        <span className="rb-ss-value">{selectedLabel}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="rb-ss-dropdown">
          <div className="rb-ss-search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={searchRef}
              className="rb-ss-search"
              type="text"
              placeholder="Поиск..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="rb-ss-clear" type="button" onClick={() => setSearch('')}>×</button>
            )}
          </div>
          <div className="rb-ss-list">
            {filtered.map(opt => {
              const sel = isSelected(opt.value);
              return (
                <div
                  key={opt.value}
                  className={`rb-ss-item${sel ? ' selected' : ''}${opt.value === '' ? ' rb-ss-item-all' : ''}`}
                  onClick={() => handleSelect(opt.value)}
                >
                  {multiSelect && opt.value !== '' && (
                    <span className="rb-ss-checkbox">
                      {sel && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="9" height="9">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </span>
                  )}
                  <span>{opt.label}</span>
                  {!multiSelect && sel && opt.value !== '' && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13" style={{ flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && <div className="rb-ss-empty">Ничего не найдено</div>}
          </div>
        </div>
      )}
    </div>
  );
}
