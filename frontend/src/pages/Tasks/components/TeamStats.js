/**
 * Показатели команды — вкладка «Отчёты» на странице команды.
 *
 * Отвечает на вопрос, которого нет ни на одной другой вкладке. «Обзор» — что
 * сейчас, «Загрузка» — сколько часов, «Доска» — в каком состоянии работа. Здесь
 * — как команда работает: держит ли сроки, умеет ли оценивать, часто ли живёт
 * в аврале и сколько работа лежит нетронутой.
 *
 * Всё считается по истории командных задач: одиннадцать типов событий пишутся
 * туда с запуска модуля, и до сих пор их читала одна лента в карточке задачи.
 *
 * ── Про людей ─────────────────────────────────────────────────────────────
 *
 * Персональные строки здесь есть, и это решение заказчика, принятое осознанно.
 * Раньше модуль обещал обратное — «счётчиков переносов по конкретным людям»
 * значилось в списке того, чего в отчётах нет намеренно. Обещание сокращено до
 * того, что осталось правдой: времени в приложении, активности и «онлайна»
 * модуль не собирает.
 *
 * Разница между тем, что осталось, и тем, что появилось, не в строгости, а в
 * природе числа. Перенос и продление — это след решения о работе: человек сам
 * его принял и сам вписал причину. Активность и время в приложении — это
 * наблюдение за человеком, которого он не совершал.
 *
 * Поэтому таблица людей намеренно не ранжируется цветом и не имеет «места в
 * рейтинге»: она отсортирована по объёму, а не по «успешности», и ни одна
 * колонка не красится в красный. Показатель, который выглядит как оценка,
 * начинают обыгрывать — дробить подзадачи, не отмечать переносы, — и тогда
 * врать начинают все цифры модуля разом, включая загрузку.
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  CalendarCheck, Timer, Flame, RotateCcw, AlertTriangle, Hourglass,
} from 'lucide-react';

import { tasks as api } from '../../../services/api';
import { weekOf, monthDays, addDays, addMonths, dstr, monthTitle, hoursText, ddate } from '../utils/dates';
import { shortName, plural } from '../utils/labels';
import { Avatar, Empty, Note } from './Bits';
import PeriodControl from './PeriodControl';

/** «2 ч», «3 дн.» — ожидание в понятных единицах, а не в дробных часах. */
function waitText(hours) {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} мин`;
  if (hours < 24) return `${Math.round(hours)} ч`;
  const days = hours / 24;
  const rounded = days < 10 ? Math.round(days * 10) / 10 : Math.round(days);
  return `${String(rounded).replace('.', ',')} дн.`;
}

export default function TeamStats({ teamId, ctx }) {
  const { cursor, setCursor } = ctx;
  const [view, setView] = useState('month');
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  // Месяц по умолчанию, а не неделя: на недельном отрезке у команды из четырёх
  // человек закрытых подзадач единицы, и любой процент от них — шум.
  const days = view === 'week' ? weekOf(cursor) : monthDays(cursor);
  const start = days[0];
  const end = days[days.length - 1];

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(false);
    api.getTeamStats(teamId, start, end)
      .then(res => { if (alive) setData(res.data); })
      .catch(() => { if (alive) { setError(true); toast.error('Не удалось собрать показатели'); } });
    return () => { alive = false; };
  }, [teamId, start, end]);

  const shift = back => setCursor(view === 'week'
    ? addDays(cursor, back ? -7 : 7)
    : addMonths(cursor, back ? -1 : 1));

  const controls = (
    <PeriodControl
      views={[['week', 'Неделя'], ['month', 'Месяц']]}
      view={view}
      onView={setView}
      label={view === 'week' ? `${dstr(start)} — ${dstr(end)}` : monthTitle(cursor)}
      onPrevious={() => shift(true)}
      onNext={() => shift(false)}
      onPick={setCursor}
    />
  );

  if (error) return <>{controls}<Empty>Не удалось собрать показатели команды.</Empty></>;
  if (!data) return <>{controls}<Empty compact>Считаем…</Empty></>;
  if (!data.inTeam) {
    return (
      <>
        {controls}
        <Empty>
          Вы видите эту команду, но не состоите в ней.
          <br />Её показатели открыты только участникам и наблюдателям.
        </Empty>
      </>
    );
  }
  if (data.empty) {
    return (
      <>
        {controls}
        <Empty>
          У команды пока нет ни одной командной задачи — считать нечего.
          <br />Показатели собираются по задачам, привязанным к этой команде.
        </Empty>
      </>
    );
  }

  const t = data.totals;
  const maxProjectHours = Math.max(...data.byProject.map(p => p.hours), 1);
  const workingPeople = data.people.filter(row => row.done || row.moved || row.extended);

  return (
    <>
      {controls}

      {/* Соблюдение срока стоит первым и крупнее прочего: остальные плитки
          объясняют, почему оно такое. */}
      <div className="tsk-kpi">
        <Kpi
          icon={CalendarCheck}
          value={t.onTimePercent === null ? '—' : `${t.onTimePercent}%`}
          label="закрыто в срок"
          hint={t.done
            ? `${t.onTime} из ${t.done}${t.late ? `, с опозданием ${t.late}` : ''}`
            : 'за период ничего не закрыто'}
          tone={t.onTimePercent === null ? null : t.onTimePercent >= 80 ? 'ok' : t.onTimePercent >= 50 ? 'warn' : 'bad'}
          lead
        />
        <Kpi
          icon={Timer}
          value={t.done}
          label={plural(t.done, 'подзадача закрыта', 'подзадачи закрыты', 'подзадач закрыто')}
          hint={`${hoursText(t.hours)} трудозатрат`}
        />
        <Kpi
          icon={Hourglass}
          value={waitText(t.planWaitHours)}
          label="лежит до того, как её возьмут в план"
          hint={t.planWaitCount
            ? `медиана по ${t.planWaitCount} ${plural(t.planWaitCount, 'подзадаче', 'подзадачам', 'подзадачам')}`
            : 'в план за период никто ничего не брал'}
        />
      </div>

      <div className="tsk-kpi">
        <Kpi
          icon={RotateCcw}
          value={t.moved}
          label={plural(t.moved, 'перенос срока', 'переноса срока', 'переносов срока')}
          hint={t.becameStuck
            ? `${t.becameStuck} ${plural(t.becameStuck, 'дошла', 'дошли', 'дошло')} до третьего и требует решения`
            : 'до третьего переноса ничего не дошло'}
          tone={t.becameStuck ? 'bad' : null}
        />
        <Kpi
          icon={AlertTriangle}
          value={t.extended}
          label={plural(t.extended, 'продление оценки', 'продления оценки', 'продлений оценки')}
          hint={t.extendedHours ? `недооценили на ${hoursText(t.extendedHours)}` : 'оценки сходятся'}
          tone={t.extended ? 'warn' : null}
        />
        <Kpi
          icon={Flame}
          value={t.forced}
          label={plural(t.forced, 'постановка сверх нормы', 'постановки сверх нормы', 'постановок сверх нормы')}
          hint={t.declined
            ? `и ${t.declined} ${plural(t.declined, 'возврат', 'возврата', 'возвратов')} «не моя зона»`
            : 'возвратов «не моя зона» не было'}
          tone={t.forced ? 'bad' : null}
        />
      </div>

      {!!data.byProject.length && (
        <div className="tsk-stats-block">
          <div className="tsk-sect">На что ушли часы</div>
          <div className="tsk-bars">
            {data.byProject.map(project => (
              <div className="tsk-brow" key={project.id || 'none'}>
                <span className="tsk-bname">{project.name}</span>
                <div className="tsk-btrack">
                  <div
                    className="tsk-bfill"
                    style={{
                      width: `${(project.hours / maxProjectHours) * 100}%`,
                      background: project.color || 'var(--primary)',
                    }}
                  />
                </div>
                <div className="tsk-bvalue">{hoursText(project.hours)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Объяснения, которыми продавили проверку загрузки. Это единственное
          место, где видно не «сколько раз был аврал», а чем его объясняли, —
          и именно текст показывает, повторяется ли одна и та же причина. */}
      {!!data.forcedReasons.length && (
        <div className="tsk-stats-block">
          <div className="tsk-sect">Чем объясняли постановку сверх нормы</div>
          <div className="tsk-reasons">
            {data.forcedReasons.map((row, index) => (
              <div className="tsk-reason" key={`${row.code}-${index}`}>
                <div className="tsk-reason-head">
                  {row.code && <span className="tsk-code">{row.code}</span>}
                  <span>{row.title}</span>
                  <time>{ddate(String(row.at).slice(0, 10))}</time>
                </div>
                <div className="tsk-reason-text">«{row.text}»</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tsk-stats-block">
        <div className="tsk-sect">По людям</div>
        {workingPeople.length ? (
          <div className="tsk-scroll">
            <table className="tsk-table tsk-people-stats">
              <thead>
                <tr>
                  <th>Человек</th>
                  <th>Закрыто</th>
                  <th>Часы</th>
                  <th>В срок</th>
                  <th>Переносов</th>
                  <th>Продлений</th>
                </tr>
              </thead>
              <tbody>
                {workingPeople.map(row => (
                  <tr key={row.userId}>
                    <td>
                      <div className="tsk-bname">
                        <Avatar user={row.user} size={22} />
                        <span>{shortName(row.user)}</span>
                      </div>
                    </td>
                    <td>{row.done}</td>
                    <td>{hoursText(row.hours)}</td>
                    <td>{row.onTimePercent === null ? '—' : `${row.onTimePercent}%`}</td>
                    <td>{row.moved || '—'}</td>
                    <td>{row.extended || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="tsk-owner-empty">
            За период никто из команды не закрывал и не переносил подзадач.
          </div>
        )}
      </div>

      <Note>
        Показатели считаются только по командным задачам — привязанным к этой
        команде. Личные дела участников в них не попадают. Ожидание до плана —
        медиана, а не среднее: одна подзадача, пролежавшая месяц в отпуске
        исполнителя, утянула бы среднее так, что по нему нельзя было бы судить
        об остальных.
      </Note>
    </>
  );
}

/**
 * Плитка показателя. Цвет только там, где он что-то значит: у «закрыто
 * подзадач» хорошего и плохого значения нет, и красить её было бы враньём.
 */
function Kpi({ icon: Icon, value, label, hint, tone, lead }) {
  return (
    <div className={`tsk-kpi-card ${tone ? `is-${tone}` : ''} ${lead ? 'is-lead' : ''}`}>
      <div className="tsk-kpi-top">
        <Icon size={15} strokeWidth={1.9} />
        <span className="tsk-kpi-value">{value}</span>
      </div>
      <div className="tsk-kpi-label">{label}</div>
      {hint && <div className="tsk-kpi-hint">{hint}</div>}
    </div>
  );
}
