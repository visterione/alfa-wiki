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
import { Clock } from 'lucide-react';
import { tasks as api } from '../../../services/api';
import { hoursText, dfull, addDays, today, clockText } from '../utils/dates';
import { useDayLoad, useEvents, dayEvents, eventHours } from '../utils/useLoad';
import { LoadBar, Empty, Note } from './Bits';
import PeriodControl from './PeriodControl';

export default function MyDay({ ctx }) {
  const { me, cursor, setCursor } = ctx;
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
        onPick={setCursor}
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
                <div style={{ margin: '12px 0 0' }}>
                  <LoadBar {...load} />
                </div>
                {/* Свободный остаток из подписи убран: он есть и в полосе, и в
                    самом «8 из 9 ч» над ней. Переработка и выполненное — другое
                    дело, их из цифр дня не вычитаешь. */}
                {(load.hours > load.norm || load.done > 0) && (
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8 }}>
                    {[
                      load.hours > load.norm && `Переработка ${hoursText(load.hours - load.norm)}`,
                      load.done > 0 && `${load.hours > load.norm ? 'выполнено' : 'Выполнено'} ${hoursText(load.done)}`,
                    ].filter(Boolean).join(' · ')}
                  </div>
                )}
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
            const subtitle = done
              ? 'выполнено'
              : event.isOpaque
                ? 'содержание скрыто'
                : event.isFloating
                  ? ''
                  : new Date(event.startTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            return (
            <div className={`tsk-inbox-card ${event.taskPartId ? 'is-clickable' : ''} ${done ? 'is-done' : ''}`}
              key={event.id} style={{ padding: '12px 14px', marginBottom: 8 }}
              onClick={() => openEvent(event)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Код блока задачи — тем же приглушённым знаком, что и на
                      доске, в списке и в графике: план дня читают вместе с
                      ними, и дело должно называться везде одинаково. */}
                  {!event.isOpaque && event.taskCode && (
                    <div className="tsk-code">{event.taskCode}</div>
                  )}
                  <div className="tsk-inbox-title" style={{ fontSize: 14 }}>
                    {event.isOpaque ? 'Занято' : event.title}
                  </div>
                  {/* У плавающего блока времени начала нет и быть не должно —
                      см. planning.js. Раньше на его месте стояло объяснение
                      этого, но строка «время в дне выбираете вы» читалась как
                      обещание настройки, которой в модуле нет. Пусто честнее. */}
                  {subtitle && <div className="tsk-inbox-from">{subtitle}</div>}
                </div>
                <span className="tsk-hours-chip">
                  <Clock size={13} strokeWidth={1.9} />
                  {clockText(eventHours(event))}
                </span>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
