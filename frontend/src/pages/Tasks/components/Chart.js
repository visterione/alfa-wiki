/**
 * «График» — своя загрузка на неделю и на месяц.
 *
 * Неделя отвечает на вопрос «что где стоит», месяц — «где завал и где окно на
 * горизонте». Один день сюда не входит: он открывается в другой момент и с
 * другой целью, для него есть «Мой день».
 */

import React, { useState } from 'react';
import {
  weekOf, monthGrid, addDays, addMonths, dstr, monthTitle,
  hoursText, DOW, dow, isWeekend, today, fromKey,
} from '../utils/dates';
import { usePersonLoad, useEvents, dayEvents } from '../utils/useLoad';
import { LoadBar, Note, Empty } from './Bits';

export default function Chart({ ctx }) {
  const { me, cursor, setCursor, go } = ctx;
  const [view, setView] = useState('week');

  const days = view === 'week' ? weekOf(cursor) : monthGrid(cursor).filter(Boolean);
  const start = days[0];
  const end = days[days.length - 1];

  const { days: load } = usePersonLoad(me?.id, start, end);
  const { events } = useEvents(start, end);
  const byDate = new Map(load.map(d => [d.date, d]));

  const shift = back => setCursor(view === 'week'
    ? addDays(cursor, back ? -7 : 7)
    : addMonths(cursor, back ? -1 : 1));

  const openDay = date => { setCursor(date); go('myday'); };

  const overloaded = load.filter(d => d.color === 'r' && !isWeekend(d.date)).length;
  const free = load.filter(d => !isWeekend(d.date)).reduce((s, d) => s + (d.free || 0), 0);

  return (
    <>
      <div className="tsk-ctl">
        <div className="tsk-seg">
          <button className={view === 'week' ? 'is-on' : ''} onClick={() => setView('week')}>Неделя</button>
          <button className={view === 'month' ? 'is-on' : ''} onClick={() => setView('month')}>Месяц</button>
        </div>
        <button className="tsk-arrow" onClick={() => shift(true)}>←</button>
        <span className="tsk-ctl-period">
          {view === 'week' ? `${dstr(days[0])} — ${dstr(days[6])}` : monthTitle(cursor)}
        </span>
        <button className="tsk-arrow" onClick={() => shift(false)}>→</button>
        <button className="tsk-btn is-sm" onClick={() => setCursor(today())}>Сегодня</button>
      </div>

      {view === 'week' ? (
        <div className="tsk-week">
          {days.map(date => {
            const d = byDate.get(date) || {};
            const list = dayEvents(events, date);
            return (
              <div
                key={date}
                className={`tsk-day ${isWeekend(date) ? 'is-weekend' : ''} ${date === today() ? 'is-today' : ''}`}
                onClick={() => openDay(date)}
              >
                <div className="tsk-day-name">{DOW[dow(date)]}, {fromKey(date).getDate()}</div>
                <div className="tsk-day-hours" style={{ color: d.color === 'r' ? 'var(--error)' : d.color === 'y' ? 'var(--warning)' : undefined }}>
                  {d.onVacation ? '—' : hoursText(d.hours)}
                </div>
                <LoadBar {...d} compact />
                <div style={{ marginTop: 9 }}>
                  {list.slice(0, 4).map(e => (
                    <div key={e.id} className={`tsk-chip-ev ${e.isOpaque ? 'is-opaque' : ''} ${e.eventType === 'meeting' ? 'is-meeting' : ''}`}>
                      {e.isOpaque ? 'Занято' : e.title}
                    </div>
                  ))}
                  {list.length > 4 && (
                    <div className="tsk-day-name">ещё {list.length - 4}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="tsk-month">
            {DOW.map(d => <div className="tsk-month-head" key={d}>{d}</div>)}
            {monthGrid(cursor).map((date, i) => {
              if (!date) return <div className="tsk-mcell is-empty" key={`e${i}`} />;
              const d = byDate.get(date) || {};
              const list = dayEvents(events, date);
              return (
                <div
                  key={date}
                  className={`tsk-mcell ${isWeekend(date) ? 'is-weekend' : ''} ${date === today() ? 'is-today' : ''}`}
                  onClick={() => openDay(date)}
                >
                  <div className="tsk-mcell-top">
                    <span>{fromKey(date).getDate()}</span>
                    <span className="tsk-mcell-hours">
                      {d.onVacation ? 'отпуск' : d.hours ? hoursText(d.hours) : ''}
                    </span>
                  </div>
                  <div style={{ margin: '5px 0' }}><LoadBar {...d} compact /></div>
                  {list.slice(0, 2).map(e => (
                    <div key={e.id} className={`tsk-chip-ev ${e.isOpaque ? 'is-opaque' : ''}`} style={{ fontSize: 10, padding: '2px 5px' }}>
                      {e.isOpaque ? 'Занято' : e.title}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {!load.length && <Empty compact>Загружаем загрузку месяца…</Empty>}
        </>
      )}

      <div className="tsk-legend">
        <span><i style={{ background: 'var(--success)' }} />есть запас</span>
        <span><i style={{ background: 'var(--warning)' }} />плотно, от 85% нормы</span>
        <span><i style={{ background: 'var(--error)' }} />переработка</span>
        <span><span className="dash" />ваша норма дня</span>
      </div>

      <Note>
        {overloaded > 0
          ? `Дней с переработкой в этом периоде: ${overloaded}. `
          : 'Переработок в этом периоде нет. '}
        Свободно по рабочим дням: {hoursText(free)}. Нажмите на день, чтобы открыть его целиком.
      </Note>
    </>
  );
}
