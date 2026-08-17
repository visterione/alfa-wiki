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
  hoursText, DOW, dow, today, fromKey,
} from '../utils/dates';
import { usePersonLoad, useEvents, dayEvents } from '../utils/useLoad';
import { loadColor } from '../utils/labels';
import { LoadBar, Note, Empty } from './Bits';
import PeriodControl from './PeriodControl';

/**
 * Выполненное дело остаётся в дне и в часах, но помечается сделанным.
 *
 * Иначе закрытая задача висит в клетке ровно так же, как невыполненная, и
 * человек утром гадает, доделал он её или нет.
 */
const isDone = event => event.status === 'completed';

/**
 * Часы дня красятся той же шкалой, что и полоса под ними.
 *
 * Отпуск, выходной и день без нормы остаются нейтральными: сравнивать их не с
 * чем, а зелёный «0 ч» в выходной читался бы как оценка, которой никто не давал.
 */
const hoursColor = day => (day.onVacation || day.onDayOff || !day.norm
  ? undefined
  : loadColor((day.hours || 0) / day.norm));

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

  const overloaded = load.filter(d => d.color === 'r' && !d.onDayOff).length;
  const free = load.filter(d => !d.onDayOff).reduce((s, d) => s + (d.free || 0), 0);

  return (
    <>
      <PeriodControl
        views={[["week", "Неделя"], ["month", "Месяц"]]}
        view={view}
        onView={setView}
        label={view === 'week' ? `${dstr(days[0])} — ${dstr(days[6])}` : monthTitle(cursor)}
        onPrevious={() => shift(true)}
        onNext={() => shift(false)}
        onToday={() => setCursor(today())}
      />

      {view === 'week' ? (
        <div className="tsk-week">
          {days.map(date => {
            const d = byDate.get(date) || {};
            const list = dayEvents(events, date);
            return (
              <div
                key={date}
                className={`tsk-day ${d.onDayOff ? 'is-weekend' : ''} ${date === today() ? 'is-today' : ''}`}
                onClick={() => openDay(date)}
              >
                <div className="tsk-day-name">{DOW[dow(date)]}, {fromKey(date).getDate()}</div>
                <div className="tsk-day-hours" style={{ color: hoursColor(d) }}>
                  {d.onVacation ? 'отпуск' : d.onDayOff ? 'выходной' : hoursText(d.hours)}
                </div>
                <LoadBar {...d} compact />
                <div style={{ marginTop: 9 }}>
                  {list.slice(0, 4).map(e => (
                    <div
                      key={e.id}
                      className={`tsk-chip-ev ${e.isOpaque ? 'is-opaque' : ''} ${e.eventType === 'meeting' ? 'is-meeting' : ''} ${isDone(e) ? 'is-done' : ''}`}
                      title={e.isOpaque ? 'Занято' : e.title}
                    >
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
                  className={`tsk-mcell ${d.onDayOff ? 'is-weekend' : ''} ${date === today() ? 'is-today' : ''}`}
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
                    <div
                      key={e.id}
                      className={`tsk-chip-ev ${e.isOpaque ? 'is-opaque' : ''} ${isDone(e) ? 'is-done' : ''}`}
                      style={{ fontSize: 10, padding: '2px 5px' }}
                      title={e.isOpaque ? 'Занято' : e.title}
                    >
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

      <Note>
        {overloaded > 0
          ? `Дней с переработкой в этом периоде: ${overloaded}. `
          : 'Переработок в этом периоде нет. '}
        Свободно по рабочим дням: {hoursText(free)}. Нажмите на день, чтобы открыть его целиком.
      </Note>
    </>
  );
}
