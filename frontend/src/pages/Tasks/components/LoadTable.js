/**
 * Таблица «люди × дни» — общая для загрузки команды и для вкладки «Сотрудники».
 *
 * Вынесена из TeamsLoad, когда у экрана появился второй режим просмотра.
 * Полоса, пунктир нормы, слова «отпуск» и «вых.», строка ИТОГО значат одно и то
 * же независимо от того, сгруппированы люди командой или показаны сплошным
 * списком; две копии разошлись бы на первой же правке — как разошлись бы и два
 * свода, если бы процент считали два маршрута по-своему.
 *
 * Состав чужого дня здесь не показывается: наружу уходят только часы.
 */

import React, { useState } from 'react';
import { fromKey, dshort, hoursText, scheduleWeeklyHours } from '../utils/dates';
import { userName, shortName } from '../utils/labels';
import { LoadBar, Avatar } from './Bits';

/** Подпись под именем по умолчанию — часы недели по расписанию человека. */
const weekHours = row => row.user?.taskWorkSchedule
  ? `неделя ${hoursText(scheduleWeeklyHours(row.user.taskWorkSchedule))}`
  : 'неделя не настроена';

export default function LoadTable({ rows, days, view, ctx, subtitle = weekHours }) {
  const [selected, setSelected] = useState(null);
  const byUser = new Map(rows.map(r => [r.userId, r]));

  return (
    <>
      <div className="tsk-scroll">
        <table className="tsk-load">
          <thead>
            <tr>
              <th />
              {days.map(d => <th key={d}>{view === 'month' ? fromKey(d).getDate() : dshort(d)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.userId} className={selected === row.userId ? 'is-sel' : ''}>
                <td>
                  <div className="tsk-person" onClick={() => setSelected(row.userId)} title={userName(row.user)}>
                    <Avatar user={row.user} />
                    <div>
                      <div className="tsk-person-name">{shortName(row.user)}</div>
                      <div className="tsk-person-sub">{subtitle(row)}</div>
                    </div>
                  </div>
                </td>
                {days.map(date => {
                  const day = row.days.find(d => d.date === date);
                  return (
                    <td key={date}>
                      <div className="tsk-cell">
                        <LoadBar {...(day || {})} />
                        <div className="tsk-hours">
                          {day?.onVacation ? 'отпуск' : day?.onDayOff ? 'вых.' : day?.hours ? day.hours.toFixed(1).replace('.', ',') : '—'}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="tsk-total">
              <td style={{ textAlign: 'left' }}>ИТОГО</td>
              {days.map(date => {
                const sum = rows.reduce((s, r) => {
                  const day = r.days.find(d => d.date === date);
                  return s + (day?.hours || 0);
                }, 0);
                return <td key={date}>{sum.toFixed(1).replace('.', ',')}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {selected && (
        <div style={{ marginTop: 16 }}>
          <button className="tsk-btn is-primary"
            onClick={() => ctx.newTask({ assignee: selected })}>
            Поставить задачу: {shortName(byUser.get(selected)?.user)}
          </button>
        </div>
      )}
    </>
  );
}
