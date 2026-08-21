import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { dropStyle, useAnchoredDrop, usePortalHost } from './dropdownPortal';

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
 *
 * ── Почему поиск виден не всегда ─────────────────────────────────────────────
 *
 * Тем же компонентом заменены короткие <select> на два-три пункта (область
 * инвентаризации, отделение): в модуле не должно быть двух разных на вид
 * выпадающих списков — браузерного и своего. Но строка поиска над списком из
 * двух строк — лишний шаг и лишний вопрос «а надо ли сюда что-то вводить»,
 * поэтому короткий список открывается сразу списком, а стрелки и Enter ловит
 * сама панель. Порог у searchable='auto' — восемь пунктов: столько видно
 * целиком, не прокручивая.
 */
export default function Combobox({
  value, options, onChange, placeholder = 'Начните вводить…',
  disabled = false, allowClear = true, renderOption, emptyText = 'Ничего не нашлось',
  searchable = 'auto', searchPlaceholder = 'Поиск по названию или коду',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef(null);
  const dropRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const portalHost = usePortalHost();
  // Панель рисуется порталом с фиксированными координатами: поля стоят в
  // прокручиваемых модалках, которые обрезали абсолютный список (подробнее — в
  // dropdownPortal.js).
  const place = useAnchoredDrop(boxRef, open, { maxHeight: 340 });

  const selected = options.find(o => o.id === value) || null;
  const showSearch = searchable === true || (searchable === 'auto' && options.length > 8);

  // Клик мимо закрывает список. Без этого он оставался висеть поверх соседних
  // полей и перехватывал нажатия по ним.
  useEffect(() => {
    if (!open) return undefined;
    const onDocument = (event) => {
      const inField = boxRef.current?.contains(event.target);
      const inDrop = dropRef.current?.contains(event.target);
      if (!inField && !inDrop) setOpen(false);
    };
    document.addEventListener('mousedown', onDocument);
    return () => document.removeEventListener('mousedown', onDocument);
  }, [open]);

  // Фокус уходит туда, где ловятся стрелки: в поле поиска, а без него — на саму
  // панель. Иначе у короткого списка клавиатура не работала бы вовсе.
  useEffect(() => {
    if (open) (showSearch ? inputRef.current : dropRef.current)?.focus();
    else setQ('');
  }, [open, showSearch]);

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

  // Подсветка стрелками должна оставаться в поле зрения: список прокручиваемый.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('.is-cursor')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const pick = (option) => {
    onChange(option ? option.id : '');
    setOpen(false);
  };

  // Открытие — не просто setOpen: курсор сразу встаёт на уже выбранном пункте.
  // В коротком списке без строки поиска это единственная подсказка, что именно
  // выбрано сейчас, и Enter не меняет значение на первое попавшееся. Курсор
  // ставится здесь, а не эффектом на open: список при пустом запросе — это
  // первые полсотни options, и позиция считается из них же, без гонки с
  // пересборкой found на каждый ввод.
  const toggleOpen = () => {
    if (open) return setOpen(false);
    const at = options.findIndex(o => o.id === value);
    setCursor(at > 0 && at < 50 ? at : 0);
    setOpen(true);
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
              onClick={toggleOpen}>
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

      {open && place && createPortal((
        <div className="wh-combo__drop" ref={dropRef} tabIndex={-1}
             onKeyDown={showSearch ? undefined : onKeyDown}
             style={dropStyle(place)}>
          {showSearch && (
            <div className="wh-combo__search">
              <Search size={14} />
              <input ref={inputRef} value={q} placeholder={searchPlaceholder}
                     onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown} />
            </div>
          )}
          <div className="wh-combo__list" ref={listRef} style={{ maxHeight: place.maxHeight }}>
            {found.map((option, index) => (
              <button type="button" key={option.id}
                      className={`wh-combo__option ${index === cursor ? 'is-cursor' : ''} ${option.id === value ? 'is-picked' : ''}`}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => pick(option)}>
                <span className="wh-combo__option-label">
                  {renderOption ? renderOption(option) : option.label}
                </span>
                {/* Галочка, а не только жирность: подсветка занята курсором, и
                    когда он стоит не на выбранной строке, отличить «выбрано» от
                    «сейчас выберется» по одному начертанию не выходит. */}
                {option.id === value && <Check className="wh-combo__check" size={14} />}
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
      ), portalHost)}
    </div>
  );
}
