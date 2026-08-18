/**
 * «Загрузка» — сначала команды, потом внутрь конкретной.
 *
 * При двух филиалах и пяти командах список всех сотрудников подряд нечитаем, а
 * при двухстах — бессмысленен. Руководитель сначала отвечает на вопрос «какая
 * команда в завале» и только потом проваливается в неё.
 *
 * Процент считается от суммы личных норм участников, а не от числа людей: иначе
 * команда из подрядчиков на part-time выглядела бы вечно недозагруженной.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { weekOf, monthGrid, addDays, addMonths, dstr, monthTitle, dshort, hoursText, fromKey, scheduleWeeklyHours } from '../utils/dates';
import { User } from 'lucide-react';
import { userName, shortName, loadColor } from '../utils/labels';
import { LoadBar, Avatar, Empty, Note } from './Bits';
import PeriodControl from './PeriodControl';

export default function TeamsLoad({ ctx }) {
  const { cursor, setCursor } = ctx;
  const [view, setView] = useState('week');
  const [openTeam, setOpenTeam] = useState(ctx.selectedTeamId || null);

  useEffect(() => {
    setOpenTeam(ctx.selectedTeamId || null);
  }, [ctx.selectedTeamId]);

  const days = view === 'week' ? weekOf(cursor) : monthGrid(cursor).filter(Boolean);
  const start = days[0];
  const end = days[days.length - 1];

  const shift = back => setCursor(view === 'week'
    ? addDays(cursor, back ? -7 : 7)
    : addMonths(cursor, back ? -1 : 1));

  const controls = (
    <PeriodControl
      views={[["week", "Неделя"], ["month", "Месяц"]]}
      view={view}
      onView={setView}
      label={view === 'week' ? `${dstr(days[0])} — ${dstr(days[days.length - 1])}` : monthTitle(cursor)}
      onPrevious={() => shift(true)}
      onNext={() => shift(false)}
      onPick={setCursor}
    />
  );

  return openTeam
    ? <TeamDetail teamId={openTeam} start={start} end={end} days={days} view={view}
        controls={controls} onBack={() => { setOpenTeam(null); ctx.go('load'); }} ctx={ctx} />
    : <TeamCards start={start} end={end} controls={controls}
        onOpen={teamId => { setOpenTeam(teamId); ctx.go('load', { teamId }); }} ctx={ctx} />;
}

/* ─────────────────────────── список команд ─────────────────────────── */

function TeamCards({ start, end, controls, onOpen, ctx }) {
  const [teams, setTeams] = useState([]);
  const [closed, setClosed] = useState(0);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.getTeams();
      setTeams(data.teams || []);
      setClosed(data.closedCount || 0);

      // Загрузку тянем только по тем командам, чьи цифры человеку открыты:
      // запрашивать закрытые и молча ловить 403 — это лишние запросы и лишний
      // способ узнать о существовании команды по коду ответа.
      const entries = await Promise.all((data.teams || [])
        .filter(t => t.canSeeLoad)
        .map(async t => {
          try {
            const res = await api.getTeamLoad(t.id, start, end);
            return [t.id, res.data.summary];
          } catch {
            return [t.id, null];
          }
        }));
      setStats(Object.fromEntries(entries));
    } catch {
      toast.error('Не удалось получить команды');
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => { reload(); }, [reload]);

  if (loading) return <>{controls}<Empty compact>Загружаем…</Empty></>;

  return (
    <>
      {controls}
      {!teams.length ? (
        <Empty>
          Вам не открыта ни одна команда.
          <br />Создать её можно в разделе «Команды».
        </Empty>
      ) : (
        <div className="tsk-teams">
          {teams.map(team => {
            const s = stats[team.id];
            const percent = s?.percent ?? null;
            return (
              <div
                key={team.id}
                className="tsk-team"
                onClick={() => team.canSeeLoad && onOpen(team.id)}
              >
                {/* В шапке — только имя и число людей. Уровень доступа никого
                    не интересует на экране про загрузку (он настраивается в
                    «Командах»), а «Открыть →» дублировал клик по карточке.
                    Пометки о скрытости здесь тоже нет: закрыты все команды
                    модуля без исключения, и значок отличал бы карточку ни от
                    чего. */}
                <div className="tsk-team-head">
                  <div className="tsk-team-name">{team.name}</div>
                  <span className="tsk-team-people" title="человек в команде">
                    <User size={13} strokeWidth={2} />
                    {team.members?.length || 0}
                  </span>
                </div>

                {!team.canSeeLoad ? (
                  <div className="tsk-team-sub">Загрузка этой команды вам закрыта</div>
                ) : (
                  <>
                    <LoadBar hours={s?.hours} norm={s?.capacity} compact />
                    <div className="tsk-team-foot">
                      <span>
                        Загрузка <b style={{ color: percent === null ? 'var(--text-tertiary)' : loadColor(percent / 100) }}>
                          {percent ?? '—'}%
                        </b> от нормы
                      </span>
                      <span>Свободно {hoursText(s?.freeHours)}</span>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Note>
        Вы видите {teams.length} команд.
        {closed > 0 && ` Ещё ${closed} существуют, но закрыты для вас.`}
        {' '}Процент считается от суммы личных норм участников, а не от общего
        числа часов: команда из подрядчиков на part-time не выглядит
        недозагруженной.
      </Note>
    </>
  );
}

/* ─────────────────────────── внутри команды ─────────────────────────── */

function TeamDetail({ teamId, start, end, days, view, controls, onBack, ctx }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    api.getTeamLoad(teamId, start, end)
      .then(res => { if (alive) setData(res.data); })
      .catch(() => toast.error('Не удалось получить загрузку команды'));
    return () => { alive = false; };
  }, [teamId, start, end]);

  if (!data) return <>{controls}<Empty compact>Загружаем…</Empty></>;

  const byUser = new Map(data.rows.map(r => [r.userId, r]));

  return (
    <>
      <div className="tsk-ctl">
        <button className="tsk-btn is-sm" onClick={onBack}>← Все команды</button>
        <span className="tsk-ctl-period" style={{ minWidth: 'auto' }}>{data.team.name}</span>
      </div>
      {controls}

      <div className="tsk-scroll">
        <table className="tsk-load">
          <thead>
            <tr>
              <th />
              {days.map(d => <th key={d}>{view === 'month' ? fromKey(d).getDate() : dshort(d)}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.map(row => (
              <tr key={row.userId} className={selected === row.userId ? 'is-sel' : ''}>
                <td>
                  <div className="tsk-person" onClick={() => setSelected(row.userId)} title={userName(row.user)}>
                    <Avatar user={row.user} />
                    <div>
                      <div className="tsk-person-name">{shortName(row.user)}</div>
                      <div className="tsk-person-sub">
                        неделя {row.user?.taskWorkSchedule
                          ? hoursText(scheduleWeeklyHours(row.user.taskWorkSchedule))
                          : 'не настроена'}
                      </div>
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
                const sum = data.rows.reduce((s, r) => {
                  const day = r.days.find(d => d.date === date);
                  return s + (day?.hours || 0);
                }, 0);
                return <td key={date}>{sum.toFixed(1).replace('.', ',')}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <Note>
        Норма у каждого своя, поэтому пунктир на каждой строке стоит в своём
        месте: 4 ч у подрядчика и 7 ч у поддержки — это не один и тот же день.
        Состав чужого дня здесь не показывается: видны только часы.
        {data.summary.overloadedDays > 0 && (
          <> Переработка суммарно: {data.summary.overloadedDays} человеко-дней.</>
        )}
      </Note>

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
