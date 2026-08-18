import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fromKey, toKey, today, monthGrid, MONTHS_NOM } from '../utils/dates';

/**
 * Единая панель периода для дня, графика, загрузки и отчётов.
 *
 * Дата в середине — не подпись, а кнопка: она открывает выбор дня. Раньше
 * единственным способом добраться до нужного места времени были стрелки, и
 * «поставить задачу на март через год» превращалось в шестнадцать нажатий.
 * Кнопка «Сегодня» убрана вместе с этим: сегодняшний день выделен в самом
 * выборе, и отдельная кнопка ради него не нужна.
 */
export default function PeriodControl({ label, views, view, onView, onPrevious, onNext, onPick, trailing }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="tsk-periodbar">
      {views?.length ? (
        <div className="tsk-period-modes">
          {views.map(([key, title]) => (
            <button key={key} className={view === key ? 'is-on' : ''} onClick={() => onView(key)}>
              {title}
            </button>
          ))}
        </div>
      ) : <div className="tsk-period-spacer" />}

      <div className="tsk-period-nav">
        <button onClick={onPrevious} aria-label="Предыдущий период"><ChevronLeft size={17} /></button>
        {onPick ? (
          <DatePickerButton label={label} open={open} setOpen={setOpen} onPick={onPick} />
        ) : (
          <div className="tsk-period-label">{label}</div>
        )}
        <button onClick={onNext} aria-label="Следующий период"><ChevronRight size={17} /></button>
      </div>

      <div className="tsk-period-actions">{trailing}</div>
    </div>
  );
}

/**
 * Выбор дня: год стрелками, месяц из двенадцати, день из сетки.
 *
 * Три уровня, а не календарь-простыня, потому что вопросы к нему бывают разного
 * масштаба: «на той неделе» решается сеткой дней, «в марте» — рядом месяцев, «в
 * позапрошлом году» — стрелками у года. Каждый уровень отвечает своим одним
 * нажатием, и до любой даты доходишь максимум за три.
 */
function DatePickerButton({ label, open, setOpen, onPick }) {
  const rootRef = useRef(null);
  const [cursor, setCursor] = useState(today());

  useEffect(() => {
    if (!open) return undefined;
    const close = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open, setOpen]);

  // Открывается всегда на текущем периоде экрана, а не там, где закрылся в
  // прошлый раз: иначе после «прыжка» на 2028 год выбор помнит его и следующее
  // открытие уводит человека туда, откуда он только что ушёл.
  useLayoutEffect(() => { if (open) setCursor(today()); }, [open]);

  const date = fromKey(cursor);
  const year = date.getFullYear();
  const month = date.getMonth();
  const at = (y, m, d = 1) => toKey(new Date(y, m, d));
  const now = today();

  return (
    <div className="tsk-period-picker" ref={rootRef}>
      <button
        className={`tsk-period-label is-pick ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(!open)}
        title="Выбрать дату"
      >
        {label}
      </button>

      {open && (
        <div className="tsk-period-pop" role="dialog" aria-label="Выбор даты">
          <div className="tsk-period-pop-head">
            <button onClick={() => setCursor(at(year - 1, month))} aria-label="Предыдущий год">
              <ChevronLeft size={15} />
            </button>
            <b>{year}</b>
            <button onClick={() => setCursor(at(year + 1, month))} aria-label="Следующий год">
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="tsk-period-months">
            {MONTHS_NOM.map((name, index) => (
              <button
                key={name}
                className={index === month ? 'is-on' : ''}
                onClick={() => setCursor(at(year, index))}
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>

          <div className="tsk-period-days">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(name => (
              <span className="tsk-period-dow" key={name}>{name}</span>
            ))}
            {monthGrid(at(year, month)).map((key, index) => key ? (
              <button
                key={key}
                className={`${key === now ? 'is-today' : ''}`}
                onClick={() => { onPick(key); setOpen(false); }}
              >
                {fromKey(key).getDate()}
              </button>
            ) : <span key={`e${index}`} />)}
          </div>
        </div>
      )}
    </div>
  );
}
