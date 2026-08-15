import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

/**
 * Выбор позиции из длинного списка с поиском.
 *
 * ── Зачем понадобился ────────────────────────────────────────────────────────
 *
 * В форме складского документа материал выбирался обычным <select> на пятьсот
 * позиций. Найти в нём «Салфетки спиртовые» можно было только прокруткой или
 * набором первых букв вслепую — браузер ищет по началу строки, а в 1С позиция
 * называется «Салфетка спиртовая антисептическая 60×60». Выдача — самая частая
 * операция модуля, по нескольку раз в день, и именно она была самой медленной.
 *
 * ── Почему поиск по подстроке, а не по началу ────────────────────────────────
 *
 * Названия в ведомости начинаются с типа предмета, а человек помнит суть:
 * «перчатки», «шприц», «спирт». Поиск по началу строки в таких названиях
 * бесполезен. Здесь ищется вхождение в любом месте названия и кода, а совпадения
 * в начале поднимаются наверх — так точный набор всё ещё даёт точный результат.
 *
 * ── Почему список ограничен полусотней ───────────────────────────────────────
 *
 * Отрисовать полторы тысячи строк выпадающего списка браузер может, но каждое
 * нажатие клавиши будет заметно подтормаживать. Полсотни — это больше, чем
 * человек просматривает глазами: если нужного нет, надо уточнять запрос, а не
 * листать.
 */
export default function Combobox({
  value, options, onChange, placeholder = 'Начните вводить…',
  disabled = false, allowClear = true, renderOption, emptyText = 'Ничего не нашлось',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find(o => o.id === value) || null;

  // Клик мимо закрывает список. Без этого он оставался висеть поверх соседних
  // полей и перехватывал нажатия по ним.
  useEffect(() => {
    if (!open) return undefined;
    const onDocument = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocument);
    return () => document.removeEventListener('mousedown', onDocument);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQ('');
  }, [open]);

  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options.slice(0, 50);

    const scored = [];
    for (const option of options) {
      const label = String(option.label || '').toLowerCase();
      const code = String(option.code || '').toLowerCase();
      const atLabel = label.indexOf(needle);
      const atCode = code.indexOf(needle);
      if (atLabel === -1 && atCode === -1) continue;
      // Совпадение в начале названия важнее совпадения в середине, а совпадение
      // по коду — важнее обоих: код набирают, когда знают его точно.
      const rank = atCode === 0 ? 0 : atLabel === 0 ? 1 : 2;
      scored.push({ option, rank, at: atLabel === -1 ? atCode : atLabel });
    }
    scored.sort((a, b) => a.rank - b.rank || a.at - b.at);
    return scored.slice(0, 50).map(s => s.option);
  }, [options, q]);

  useEffect(() => { setCursor(0); }, [q]);

  const pick = (option) => {
    onChange(option ? option.id : '');
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor(index => Math.min(index + 1, found.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor(index => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (found[cursor]) pick(found[cursor]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={`wh-combo ${disabled ? 'is-disabled' : ''}`} ref={boxRef}>
      <button type="button" className="wh-combo__value" disabled={disabled}
              onClick={() => setOpen(v => !v)}>
        <span className={selected ? '' : 'wh-combo__placeholder'}>
          {selected ? (renderOption ? renderOption(selected) : selected.label) : placeholder}
        </span>
        {allowClear && selected && !disabled ? (
          <span className="wh-combo__clear" role="button" tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); onChange(''); }}>
            <X size={13} />
          </span>
        ) : (
          <ChevronDown size={14} />
        )}
      </button>

      {open && (
        <div className="wh-combo__drop">
          <div className="wh-combo__search">
            <Search size={14} />
            <input ref={inputRef} value={q} placeholder="Поиск по названию или коду"
                   onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown} />
          </div>
          <div className="wh-combo__list">
            {found.map((option, index) => (
              <button type="button" key={option.id}
                      className={`wh-combo__option ${index === cursor ? 'is-cursor' : ''} ${option.id === value ? 'is-picked' : ''}`}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => pick(option)}>
                {renderOption ? renderOption(option) : option.label}
              </button>
            ))}
            {!found.length && <div className="wh-combo__empty">{emptyText}</div>}
            {found.length === 50 && (
              <div className="wh-combo__more">
                Показаны первые 50 — уточните запрос
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
