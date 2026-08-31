/**
 * «Загрузка» — два взгляда на одни и те же часы: команды и сотрудники.
 *
 * Команды идут первыми и остаются режимом по умолчанию: при двух филиалах и
 * пяти командах список всех сотрудников подряд нечитаем, а при двухстах —
 * бессмысленен. Руководитель сначала отвечает на вопрос «какая команда в
 * завале» и только потом проваливается в неё.
 *
 * Но человек редко состоит в одной команде, и вопрос «кому можно поручить»
 * командами не решается: один и тот же сотрудник встречался в трёх карточках, и
 * складывать его часы приходилось в уме. Для этого — второй режим, сплошной
 * список людей области видимости. Переключатель иконочный и стоит в панели
 * периода: это не два раздела меню, а один экран, на который смотрят с двух
 * сторон.
 *
 * Процент считается от суммы личных норм участников, а не от числа людей: иначе
 * команда из подрядчиков на part-time выглядела бы вечно недозагруженной.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { weekOf, monthGrid, addDays, addMonths, dstr, monthTitle, hoursText } from '../utils/dates';
import { User, Users } from 'lucide-react';
import { loadColor } from '../utils/labels';
import { LoadBar, Empty, Note } from './Bits';
import PeriodControl from './PeriodControl';
import LoadTable from './LoadTable';

// Режим — привычка человека, а не состояние экрана: тот, кто планирует людьми,
// открывает загрузку людьми каждый день, и заставлять его переключаться при
// каждом заходе значит спрашивать одно и то же. В URL режим не выносится:
// ссылкой делятся на конкретную команду, а не на способ смотреть.
const MODE_KEY = 'tsk-load-mode';
const readMode = () => (localStorage.getItem(MODE_KEY) === 'people' ? 'people' : 'teams');

export default function TeamsLoad({ ctx }) {
  const { cursor, setCursor } = ctx;
  const [view, setView] = useState('week');
  const [mode, setMode] = useState(readMode);
  const [openTeam, setOpenTeam] = useState(ctx.selectedTeamId || null);

  useEffect(() => {
    setOpenTeam(ctx.selectedTeamId || null);
    // Ссылка на конкретную команду сильнее сохранённой привычки: пришедший по
    // ней ожидает увидеть её загрузку, а не общий список людей.
    if (ctx.selectedTeamId) setMode('teams');
  }, [ctx.selectedTeamId]);

  const days = view === 'week' ? weekOf(cursor) : monthGrid(cursor).filter(Boolean);
  const start = days[0];
  const end = days[days.length - 1];

  const shift = back => setCursor(view === 'week'
    ? addDays(cursor, back ? -7 : 7)
    : addMonths(cursor, back ? -1 : 1));

  const switchMode = next => {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
    // Выходя в «Сотрудников» из открытой команды, убираем её и из адреса:
    // иначе возврат к командам показал бы таблицу, которую человек уже закрыл.
    if (next === 'people' && openTeam) {
      setOpenTeam(null);
      ctx.go('load');
    }
  };

  const controls = (
    <PeriodControl
      views={[["week", "Неделя"], ["month", "Месяц"]]}
      view={view}
      onView={setView}
      label={view === 'week' ? `${dstr(days[0])} — ${dstr(days[days.length - 1])}` : monthTitle(cursor)}
      onPrevious={() => shift(true)}
      onNext={() => shift(false)}
      onPick={setCursor}
      trailing={<ModeSwitch mode={mode} onMode={switchMode} />}
    />
  );

  if (mode === 'people') {
    return <PeopleLoad start={start} end={end} days={days} view={view} controls={controls} ctx={ctx} />;
  }

  return openTeam
    ? <TeamDetail teamId={openTeam} start={start} end={end} days={days} view={view}
        controls={controls} onBack={() => { setOpenTeam(null); ctx.go('load'); }} ctx={ctx} />
    : <TeamCards start={start} end={end} controls={controls}
        onOpen={teamId => { setOpenTeam(teamId); ctx.go('load', { teamId }); }} ctx={ctx} />;
}

/**
 * Переключатель режима — две иконки без подписей.
 *
 * Подписи «Команды» и «Сотрудники» рядом с сегментами «Неделя/Месяц» читались
 * бы как ещё один период. Смысл держат сами значки: группа людей и один
 * человек; названия остались в подсказках и в aria-label.
 */
function ModeSwitch({ mode, onMode }) {
  return (
    <div className="tsk-modeswitch" role="group" aria-label="Режим просмотра">
      <button
        type="button"
        className={mode === 'teams' ? 'is-on' : ''}
        onClick={() => onMode('teams')}
        title="Команды"
        aria-label="Команды"
        aria-pressed={mode === 'teams'}
      >
        <Users size={16} />
      </button>
      <button
        type="button"
        className={mode === 'people' ? 'is-on' : ''}
        onClick={() => onMode('people')}
        title="Сотрудники"
        aria-label="Сотрудники"
        aria-pressed={mode === 'people'}
      >
        <User size={16} />
      </button>
    </div>
  );
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

  useEffect(() => {
    let alive = true;
    api.getTeamLoad(teamId, start, end)
      .then(res => { if (alive) setData(res.data); })
      .catch(() => toast.error('Не удалось получить загрузку команды'));
    return () => { alive = false; };
  }, [teamId, start, end]);

  if (!data) return <>{controls}<Empty compact>Загружаем…</Empty></>;

  return (
    <>
      <div className="tsk-ctl">
        <button className="tsk-btn is-sm" onClick={onBack}>← Все команды</button>
        <span className="tsk-ctl-period" style={{ minWidth: 'auto' }}>{data.team.name}</span>
      </div>
      {controls}

      <LoadTable rows={data.rows} days={days} view={view} ctx={ctx} />

      <Note>
        Норма у каждого своя, поэтому пунктир на каждой строке стоит в своём
        месте: 4 ч у подрядчика и 7 ч у поддержки — это не один и тот же день.
        Состав чужого дня здесь не показывается: видны только часы.
        {data.summary.overloadedDays > 0 && (
          <> Переработка суммарно: {data.summary.overloadedDays} человеко-дней.</>
        )}
      </Note>
    </>
  );
}

/* ─────────────────────────── сплошной список людей ─────────────────────────── */

/**
 * Все люди области видимости одной таблицей.
 *
 * Область та же, что у раздела «Люди»: участники команд, чью загрузку человеку
 * открыли, плюс он сам. Отдельного права у режима нет намеренно — иначе он стал
 * бы обходом настроек команд.
 *
 * Порядок — по проценту от нормы, сверху вниз. Алфавит здесь отвечал бы на
 * вопрос «где Петров», а спрашивают у этого экрана другое: кто перегружен и у
 * кого есть место. Люди без расписания уходят вниз: сравнивать их не с чем.
 */
function PeopleLoad({ start, end, days, view, controls, ctx }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    api.getPeopleLoad(start, end)
      .then(res => { if (alive) setData(res.data); })
      .catch(() => toast.error('Не удалось получить загрузку сотрудников'));
    return () => { alive = false; };
  }, [start, end]);

  if (!data) return <>{controls}<Empty compact>Загружаем…</Empty></>;

  const percentOf = new Map((data.summary.perUser || []).map(u => [u.userId, u.percent]));
  const rows = [...data.rows].sort((a, b) => {
    const left = percentOf.get(a.userId);
    const right = percentOf.get(b.userId);
    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    return right - left;
  });

  if (!rows.length) {
    return <>{controls}<Empty>В вашей области видимости нет людей.</Empty></>;
  }

  return (
    <>
      {controls}

      {/* Подпись под именем — команды человека, а не часы недели: в общем
          списке первым делом непонятно, откуда этот человек здесь взялся.
          Показываются только те команды, о которых знает смотрящий. */}
      <LoadTable
        rows={rows}
        days={days}
        view={view}
        ctx={ctx}
        subtitle={row => {
          const percent = percentOf.get(row.userId);
          const load = percent === null || percent === undefined ? 'расписания нет' : `${percent}% нормы`;
          const teams = (row.teams || []).map(t => t.name).join(', ');
          return teams ? `${load} · ${teams}` : load;
        }}
      />

      <Note>
        {rows.length} человек из команд, чью загрузку вам открыли: тот, кто
        состоит сразу в трёх, стоит здесь одной строкой со всеми своими часами.
        Сверху — самые загруженные. Состав чужого дня не показывается: видны
        только часы.
        {data.summary.overloadedDays > 0 && (
          <> Переработка суммарно: {data.summary.overloadedDays} человеко-дней.</>
        )}
      </Note>
    </>
  );
}
