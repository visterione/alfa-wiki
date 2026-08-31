/**
 * Таблица «люди × дни» — общая для загрузки команды и для вкладки «Сотрудники».
 *
 * Вынесена из TeamsLoad, когда у экрана появился второй режим просмотра.
 * Полоса, пунктир нормы, штриховка выходного и строка ИТОГО значат одно и то же
 * независимо от того, сгруппированы люди командой или показаны сплошным
 * списком; две копии разошлись бы на первой же правке — как разошлись бы и два
 * свода, если бы процент считали два маршрута по-своему.
 *
 * Состав чужого дня здесь не показывается: наружу уходят только часы.
 *
 * Клетка — это выбор «кому и на когда». Своей кнопки «поставить задачу» у
 * таблицы нет: она дублировала бы «Новую задачу» в шапке экрана, стоящую там на
 * всех разделах. Вместо этого выбор клетки подставляется в ту же кнопку —
 * человек уже показал пальцем и на исполнителя, и на день, и переспрашивать его
 * в модалке незачем. Раньше клетка на нажатие подсвечивалась и не делала
 * ничего: hover обещал действие, которого не было.
 */

import React, { useState, useEffect } from 'react';
import { fromKey, dshort, dstr, hoursText, scheduleWeeklyHours } from '../utils/dates';
import { userName, shortName } from '../utils/labels';
import { LoadBar, Avatar } from './Bits';

/** Подпись под именем по умолчанию — часы недели по расписанию человека. */
const weekHours = row => row.user?.taskWorkSchedule
  ? `неделя ${hoursText(scheduleWeeklyHours(row.user.taskWorkSchedule))}`
  : 'неделя не настроена';

export default function LoadTable({ rows, days, view, ctx, subtitle = weekHours, percentOf }) {
  // Выбор — пара «человек и день»: день может быть пустым, если ткнули в имя.
  const [selected, setSelected] = useState({ userId: null, date: null });

  // Уходя с таблицы, выбор из кнопки убираем: «Новая задача · Иванов, 3 сент.»
  // на экране отчётов означала бы, что предзаполнение живёт своей жизнью.
  const { setNewTaskPreset } = ctx;
  useEffect(() => () => setNewTaskPreset?.({}), [setNewTaskPreset]);

  const choose = (row, date) => {
    const same = selected.userId === row.userId && selected.date === date;
    const next = same ? { userId: null, date: null } : { userId: row.userId, date };
    setSelected(next);
    // Подпись для кнопки собирается здесь: в оболочке нет ни людей, ни дат
    // этого экрана, а «Новая задача · Иванов, 3 сент.» — единственное место,
    // где человек видит, что его выбор куда-то попал.
    ctx.setNewTaskPreset?.(next.userId
      ? {
        assignee: next.userId,
        date: next.date || undefined,
        label: [shortName(row.user), next.date ? dstr(next.date) : null].filter(Boolean).join(', '),
      }
      : {});
  };

  return (
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
            <tr key={row.userId} className={selected.userId === row.userId ? 'is-sel' : ''}>
              <td>
                <div className="tsk-person" onClick={() => choose(row, null)} title={userName(row.user)}>
                  <Avatar user={row.user} percent={percentOf?.get(row.userId) ?? null} />
                  <div>
                    <div className="tsk-person-name">{shortName(row.user)}</div>
                    {/* Пустой подписи не бывает: строка без текста всё равно
                        занимала бы место и сдвигала имя вверх от центра. */}
                    {subtitle(row) && <div className="tsk-person-sub">{subtitle(row)}</div>}
                  </div>
                </div>
              </td>
              {days.map(date => {
                const day = row.days.find(d => d.date === date);
                const isPicked = selected.userId === row.userId && selected.date === date;
                return (
                  <td key={date}>
                    <div
                      className={`tsk-cell ${isPicked ? 'is-picked' : ''}`}
                      onClick={() => choose(row, date)}
                      title={`${shortName(row.user)} · ${dstr(date)} — выбрать для новой задачи`}
                    >
                      <LoadBar {...(day || {})} />
                      {/* В выходной часы всё равно показываем, если они есть:
                          вышедший в субботу человек — это то, что на таблице
                          ищут, а не служебная деталь. Пустой выходной остаётся
                          прочерком: слово «вых.» заменила штриховка полосы. */}
                      <div className="tsk-hours">
                        {day?.onVacation ? 'отпуск'
                          : day?.hours ? day.hours.toFixed(1).replace('.', ',')
                          : '—'}
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
  );
}
