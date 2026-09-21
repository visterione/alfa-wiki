/**
 * Срок работы: один день или несколько.
 *
 * Отдельного переключателя «работа идёт несколько дней» в модуле нет и не было
 * нужно. Длительность выпадает из того, как выбрали срок: нажал один день —
 * работа на день, нажал второй — она идёт с первого по второй. Ровно так же
 * устроена шкала дня в форме постановки (нажатие по началу, нажатие по концу), и
 * повторять здесь тот же жест дешевле, чем объяснять новый.
 *
 * Первое нажатие срок УЖЕ ставит — на один день, — а не открывает выбор
 * диапазона. Иначе однодневная работа, то есть почти вся, требовала бы двух
 * нажатий вместо одного, и выбор ощущался бы как разговор про длительность там,
 * где никакой длительности нет.
 *
 * Вид взят у выбора даты в панели периода (tsk-period-pop): год стрелками, месяц
 * из двенадцати, день из сетки. Второй календарь другого вида в одном модуле
 * читался бы как другая сущность.
 *
 * min и max ограничивают выбор — ими пользуются подзадачи, которым разрешён
 * только срок задачи. Это дешевле предупреждения «выходит за срок задачи»:
 * предупреждение сначала позволяет совершить ошибку, а потом о ней сообщает.
 *
 * Подписи «один день — работа на день, два — срок с первого по второй» здесь нет.
 * Жест виден по самому календарю: нажал — день подсветился, повёл курсор —
 * потянулся диапазон. Текст объяснял то, что показывает поведение.
 */

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { ChevronLeft, ChevronRight, CalendarClock } from 'lucide-react';
import { fromKey, toKey, today, monthGrid, ddate, dateRange, MONTHS_NOM, DOW } from '../utils/dates';

/** Календарных дней в сроке, включая оба конца. */
export function spanDays(from, to) {
  if (!from || !to) return 1;
  return Math.round((fromKey(to) - fromKey(from)) / 86400000) + 1;
}

/** «чт, 25.09.26» или «22 – 26.09.26 · 5 дн.» */
export function dueText(from, to) {
  if (!to) return 'выбрать срок';
  if (!from || from === to) return ddate(to);
  return `${dateRange(from, to)} · ${spanDays(from, to)} дн.`;
}

export default function DueRange({ from, to, onChange, disabled, min, max }) {
  const [open, setOpen] = useState(false);
  /** Первое нажатие: срок уже поставлен на этот день, ждём возможного второго. */
  const [anchor, setAnchor] = useState(null);
  const [hover, setHover] = useState(null);
  const [cursor, setCursor] = useState(to || today());
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = event => {
      if (!rootRef.current?.contains(event.target)) { setOpen(false); setAnchor(null); }
    };
    const escape = event => {
      if (event.key === 'Escape') { setOpen(false); setAnchor(null); }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  // Открывается на выбранном сроке, а не там, где закрылся в прошлый раз: иначе
  // после прыжка в другой месяц выбор помнит его и уводит от текущей даты.
  useLayoutEffect(() => {
    if (open) { setCursor(to || today()); setAnchor(null); setHover(null); }
  }, [open, to]);

  const outOfRange = key => (!!min && key < min) || (!!max && key > max);

  const pick = key => {
    if (outOfRange(key)) return;
    // Второе нажатие по тому же дню — это «всё-таки один день», а не отмена:
    // человек уже сказал, чего хочет, и забирать у него срок незачем.
    if (anchor && key !== anchor) {
      const a = anchor < key ? anchor : key;
      const b = anchor < key ? key : anchor;
      onChange({ from: a === b ? null : a, to: b });
      setOpen(false);
      setAnchor(null);
      return;
    }
    onChange({ from: null, to: key });
    setAnchor(key);
  };

  // Что подсвечено: тянущийся от первого нажатия диапазон или уже выбранный срок.
  const live = anchor && hover && hover !== anchor
    ? { from: anchor < hover ? anchor : hover, to: anchor < hover ? hover : anchor }
    : { from: from || to, to };
  const inRange = key => live.from && live.to && key >= live.from && key <= live.to;

  const date = fromKey(cursor);
  const year = date.getFullYear();
  const month = date.getMonth();
  const at = (y, m, d = 1) => toKey(new Date(y, m, d));
  const now = today();

  return (
    <div className="tsk-due-pick" ref={rootRef}>
      <button
        type="button"
        className={`tsk-due-btn ${open ? 'is-open' : ''} ${from && from !== to ? 'is-range' : ''}`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <CalendarClock size={14} strokeWidth={1.9} />
        {dueText(from, to)}
      </button>

      {open && (
        <div className="tsk-period-pop tsk-due-pop" role="dialog" aria-label="Срок работы">
          <div className="tsk-period-pop-head">
            <button type="button" onClick={() => setCursor(at(year - 1, month))} aria-label="Предыдущий год">
              <ChevronLeft size={15} />
            </button>
            <b>{year}</b>
            <button type="button" onClick={() => setCursor(at(year + 1, month))} aria-label="Следующий год">
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="tsk-period-months">
            {MONTHS_NOM.map((name, index) => (
              <button
                type="button"
                key={name}
                className={index === month ? 'is-on' : ''}
                onClick={() => setCursor(at(year, index))}
              >
                {name.slice(0, 3)}
              </button>
            ))}
          </div>

          <div className="tsk-period-days" onMouseLeave={() => setHover(null)}>
            {DOW.map(name => <span className="tsk-period-dow" key={name}>{name}</span>)}
            {monthGrid(at(year, month)).map((key, index) => (key ? (
              <button
                type="button"
                key={key}
                className={[
                  key === now ? 'is-today' : '',
                  inRange(key) ? 'is-in' : '',
                  key === live.from ? 'is-edge is-start' : '',
                  key === live.to ? 'is-edge is-end' : '',
                ].filter(Boolean).join(' ')}
                disabled={outOfRange(key)}
                onMouseEnter={() => setHover(key)}
                onClick={() => pick(key)}
              >
                {fromKey(key).getDate()}
              </button>
            ) : <span key={`e${index}`} />))}
          </div>
        </div>
      )}
    </div>
  );
}
