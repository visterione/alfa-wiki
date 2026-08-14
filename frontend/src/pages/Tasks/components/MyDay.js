/**
 * «Мой день».
 *
 * Отдельно от «Графика» намеренно. Этот экран открывают утром, чтобы ответить
 * на вопрос «чем я занят сегодня»; график — раз в несколько дней, чтобы
 * планировать вперёд. Один день внутри недельной сетки отвечает на первый
 * вопрос плохо: он там мелкий и стоит в ряду с шестью другими.
 *
 * Руководителю этот экран нужен не меньше, чем исполнителю, поэтому он стоит
 * выше блока «Команды»: руководитель тоже человек с перегруженным днём.
 */

import React from 'react';
import { hoursText, dfull, addDays, today, estimateText } from '../utils/dates';
import { useDayLoad, useEvents, dayEvents, eventHours } from '../utils/useLoad';
import { LoadBar, Empty, Badge, Note } from './Bits';

export default function MyDay({ ctx }) {
  const { me, cursor, setCursor, go } = ctx;
  const { load } = useDayLoad(me?.id, cursor);
  const { events } = useEvents(cursor, cursor);
  const list = dayEvents(events, cursor);

  const isToday = cursor === today();

  return (
    <>
      <div className="tsk-ctl">
        <button className="tsk-arrow" onClick={() => setCursor(addDays(cursor, -1))}>←</button>
        <span className="tsk-ctl-period">{dfull(cursor)}{isToday ? ' · сегодня' : ''}</span>
        <button className="tsk-arrow" onClick={() => setCursor(addDays(cursor, 1))}>→</button>
        {!isToday && (
          <button className="tsk-btn is-sm" onClick={() => setCursor(today())}>Сегодня</button>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <button className="tsk-btn is-sm" onClick={() => go('chart')}>Открыть график</button>
        </span>
      </div>

      <div className="tsk-grid-2">
        <div>
          <div className="tsk-card">
            <div className="tsk-sect">Загрузка дня</div>
            {load?.onVacation ? (
              <Empty compact>Отпуск. Задачи на этот день не ставятся.</Empty>
            ) : load?.norm === null || load?.norm === undefined ? (
              <Empty compact>Норма не задана — загрузка не считается.</Empty>
            ) : (
              <>
                <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.5px' }}>
                  {hoursText(load.hours)}
                  <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 400 }}>
                    {' '}из {hoursText(load.norm)}
                  </span>
                </div>
                <div style={{ margin: '12px 0 8px' }}>
                  <LoadBar {...load} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {load.color === 'r'
                    ? `Переработка ${hoursText(load.hours - load.norm)}`
                    : `Свободно ${hoursText(load.free)}`}
                </div>
              </>
            )}
          </div>

          <Note>
            «Мой день» открывается утром и отвечает на вопрос «чем я занят
            сегодня». «График» — планирование на неделю и месяц вперёд, туда
            заходят раз в несколько дней.
          </Note>
        </div>

        <div>
          <div className="tsk-sect">План дня</div>
          {!list.length ? (
            <Empty>
              На этот день ничего не запланировано.
              {load?.free > 0 && <><br />Свободно {hoursText(load.free)}.</>}
            </Empty>
          ) : list.map(event => (
            <div className="tsk-inbox-card" key={event.id} style={{ padding: '12px 14px', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="tsk-inbox-title" style={{ fontSize: 14 }}>
                    {event.isOpaque ? 'Занято' : event.title}
                  </div>
                  <div className="tsk-inbox-from">
                    {event.isOpaque
                      ? 'содержание скрыто'
                      : event.isFloating
                        ? 'рабочий блок — время в дне выбираете вы'
                        : new Date(event.startTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <Badge tone={event.isOpaque ? 'muted' : 'info'}>
                  {estimateText(eventHours(event))}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
