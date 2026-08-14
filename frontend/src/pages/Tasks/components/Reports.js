/**
 * Отчёты по загрузке.
 *
 * Главная цифра здесь — «частей никем не обработано». Она отвечает на вопрос,
 * который обычная доска прячет: сколько работы числится поставленной, но на
 * самом деле ещё никем не начато.
 *
 * Список «чего здесь нет намеренно» приходит с бэкенда и показывается в
 * интерфейсе не для красоты: он закрывает вопрос «а давайте добавим метрику
 * активности» до того, как тот будет задан. Модуль, в котором появится
 * слежка за людьми, перестанут заполнять честно в тот же месяц.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { weekOf, monthDays, addDays, addMonths, dstr, monthTitle, hoursText } from '../utils/dates';
import { userName } from '../utils/labels';
import { Avatar, Empty, Note } from './Bits';

export default function Reports({ ctx }) {
  const { cursor, setCursor } = ctx;
  const [view, setView] = useState('week');
  const [data, setData] = useState(null);

  const days = view === 'week' ? weekOf(cursor) : monthDays(cursor);
  const start = days[0];
  const end = days[days.length - 1];

  const reload = useCallback(async () => {
    try {
      const res = await api.getReports({ start, end });
      setData(res.data);
    } catch {
      toast.error('Не удалось построить отчёт');
    }
  }, [start, end]);

  useEffect(() => { reload(); }, [reload]);

  const shift = back => setCursor(view === 'week'
    ? addDays(cursor, back ? -7 : 7)
    : addMonths(cursor, back ? -1 : 1));

  if (!data) return <Empty compact>Считаем…</Empty>;

  const maxFree = Math.max(...data.freeByPerson.map(p => p.freeHours), 1);

  return (
    <>
      <div className="tsk-ctl">
        <div className="tsk-seg">
          <button className={view === 'week' ? 'is-on' : ''} onClick={() => setView('week')}>Неделя</button>
          <button className={view === 'month' ? 'is-on' : ''} onClick={() => setView('month')}>Месяц</button>
        </div>
        <button className="tsk-arrow" onClick={() => shift(true)}>←</button>
        <span className="tsk-ctl-period">
          {view === 'week' ? `${dstr(start)} — ${dstr(end)}` : monthTitle(cursor)}
        </span>
        <button className="tsk-arrow" onClick={() => shift(false)}>→</button>
      </div>

      <div className="tsk-stats">
        <div className="tsk-stat">
          <div className="tsk-stat-value">{data.unprocessed}</div>
          <div className="tsk-stat-label">частей задач никем не обработано</div>
        </div>
        <div className="tsk-stat">
          <div className="tsk-stat-value">{data.overloadedPersonDays}</div>
          <div className="tsk-stat-label">человеко-дней с переработкой</div>
        </div>
        <div className="tsk-stat">
          <div className="tsk-stat-value">{data.stuckParts}</div>
          <div className="tsk-stat-label">частей требуют решения после трёх переносов</div>
        </div>
        <div className="tsk-stat">
          <div className="tsk-stat-value">{data.multiPersonTasks}</div>
          <div className="tsk-stat-label">задач с несколькими исполнителями</div>
        </div>
        <div className="tsk-stat">
          <div className="tsk-stat-value">{data.people}</div>
          <div className="tsk-stat-label">человек в срезе</div>
        </div>
      </div>

      <div className="tsk-sect">Свободное время за период — норма у каждого своя</div>
      <div className="tsk-bars">
        {data.freeByPerson.map(row => (
          <div className="tsk-brow" key={row.user.id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Avatar user={row.user} size={20} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {userName(row.user)}
              </span>
            </div>
            <div className="tsk-btrack">
              <div
                className="tsk-bfill"
                style={{
                  width: `${(row.freeHours / maxFree) * 100}%`,
                  background: row.freeHours < 3 ? 'var(--error)' : row.freeHours < 8 ? 'var(--warning)' : 'var(--success)',
                }}
              />
            </div>
            <div className="tsk-bvalue">{hoursText(row.freeHours)}</div>
          </div>
        ))}
      </div>

      {!!data.byTeam.length && (
        <>
          <div className="tsk-sect">По командам — процент от суммы личных норм</div>
          <div className="tsk-bars">
            {data.byTeam.map(team => (
              <div className="tsk-brow" key={team.id}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {team.name}
                </span>
                <div className="tsk-btrack">
                  <div
                    className="tsk-bfill"
                    style={{
                      width: `${Math.min(team.percent, 100)}%`,
                      background: team.percent > 100 ? 'var(--error)' : team.percent > 85 ? 'var(--warning)' : 'var(--success)',
                    }}
                  />
                </div>
                <div className="tsk-bvalue">{team.percent}%</div>
              </div>
            ))}
          </div>
        </>
      )}

      <Note>
        Чего здесь нет намеренно: {data.deliberatelyAbsent.join(', ')}. Загрузка —
        это сумма запланированного, а не наблюдение за человеком.
      </Note>
    </>
  );
}
