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
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { hoursText, dfull, addDays, today, estimateText } from '../utils/dates';
import { useDayLoad, useEvents, dayEvents, eventHours } from '../utils/useLoad';
import { LoadBar, Empty, Badge, Note } from './Bits';
import PeriodControl from './PeriodControl';

export default function MyDay({ ctx }) {
  const { me, cursor, setCursor, go } = ctx;
  const { load } = useDayLoad(me?.id, cursor);
  const { events } = useEvents(cursor, cursor);
  const list = dayEvents(events, cursor);

  const isToday = cursor === today();

  const openEvent = async event => {
    if (!event.taskPartId) return;
    try {
      const { data } = await api.getPartTask(event.taskPartId);
      ctx.openTask(data.taskId);
    } catch {
      toast.error('Не удалось открыть задачу');
    }
  };

  return (
    <>
      <PeriodControl
        label={`${dfull(cursor)}${isToday ? ' · сегодня' : ''}`}
        onPrevious={() => setCursor(addDays(cursor, -1))}
        onNext={() => setCursor(addDays(cursor, 1))}
        onToday={!isToday ? () => setCursor(today()) : null}
        trailing={<button onClick={() => go('chart')}>График</button>}
      />

      <div className="tsk-grid-2">
        <div>
          <div className="tsk-card">
            <div className="tsk-sect">Загрузка дня</div>
            {load?.onVacation ? (
              <Empty compact>Отпуск. Задачи на этот день не ставятся.</Empty>
            ) : load?.onDayOff ? (
              <Empty compact>Выходной по рабочему расписанию.</Empty>
            ) : load?.norm === null || load?.norm === undefined ? (
              <Empty compact>Рабочее расписание не настроено — загрузка не считается.</Empty>
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
                  {load.done > 0 && ` · выполнено ${hoursText(load.done)}`}
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
          ) : list.map(event => {
            const done = event.status === 'completed';
            return (
            <div className={`tsk-inbox-card ${event.taskPartId ? 'is-clickable' : ''} ${done ? 'is-done' : ''}`}
              key={event.id} style={{ padding: '12px 14px', marginBottom: 8 }}
              onClick={() => openEvent(event)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tsk-inbox-title" style={{ fontSize: 14 }}>
                    {event.isOpaque ? 'Занято' : event.title}
                  </div>
                  <div className="tsk-inbox-from">
                    {done
                      ? 'выполнено'
                      : event.isOpaque
                        ? 'содержание скрыто'
                        : event.isFloating
                          ? 'рабочий блок — время в дне выбираете вы'
                          : new Date(event.startTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <Badge tone={done ? 'ok' : event.isOpaque ? 'muted' : 'info'}>
                  {estimateText(eventHours(event))}
                </Badge>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
