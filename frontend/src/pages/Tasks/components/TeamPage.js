/**
 * Команды: список и страница команды (ver. 8.42).
 *
 * Раньше раздел «Команды» состоял из карточек с кнопками «Пригласить» и
 * «Настроить» — то есть был administrative-экраном и ничего не рассказывал о
 * самой команде. Смотреть на команду было негде: её загрузка жила отдельным
 * пунктом меню, её работа не была видна никому, кроме руководителя, а доска
 * показывала всё вперемешку.
 *
 * Теперь команда — это место, куда проваливаются. Четыре вкладки отвечают на
 * четыре разных вопроса, и порядок у них не случайный:
 *
 *   Обзор    — кто за что отвечает. Главный вопрос о команде, и задают его
 *              первым. Единица ответа — человек, а не карточка.
 *   Доска    — в каком состоянии работа.
 *   Загрузка — у кого сколько часов и кто в завале.
 *   Отчёты   — то же самое за период и в цифрах.
 *
 * «Обзор» стоит первым именно потому, что доска на него не отвечает: разложить
 * карточки по состояниям и разложить работу по людям — разные вещи, и человек,
 * пришедший узнать, кто ведёт закупку, ищет фамилию, а не колонку.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  Users, LayoutList, Columns3, BarChart3, PieChart, AlertTriangle, Clock3, CalendarX,
  ArrowLeft, Settings,
} from 'lucide-react';

import { tasks as api } from '../../../services/api';
import { TEAM_ROLE_LABEL, userName, shortName, STATUS_COLOR, STATUS_LABEL, STATUS_ICON, partCode, plural } from '../utils/labels';
import { weekOf, monthGrid, addDays, addMonths, dstr, monthTitle, ddate, dateRange } from '../utils/dates';
import { Avatar, Empty, Note } from './Bits';
import PeriodControl from './PeriodControl';
import LoadTable from './LoadTable';
import Board from './Board';
import TeamStats from './TeamStats';
import { TeamModal } from './TeamsAdmin';

const TABS = [
  ['overview', 'Обзор', LayoutList],
  ['board', 'Доска', Columns3],
  ['load', 'Загрузка', BarChart3],
  ['reports', 'Показатели', PieChart],
];

export default function TeamPage({ ctx }) {
  const teamId = ctx.selectedTeamId;
  return teamId
    ? <TeamDetail teamId={teamId} ctx={ctx} onBack={() => ctx.go('teams')} />
    : <TeamsList ctx={ctx} onOpen={id => ctx.go('teams', { teamId: id })} />;
}

/* ─────────────────────────────── список ─────────────────────────────── */

/**
 * Карточка команды показывает не состав, а состояние: сколько её работы никем
 * не разобрано и сколько застряло. Число участников само по себе ничего не
 * говорит — «7 чел.» одинаково выглядит и у команды в порядке, и у команды,
 * где половина задач третью неделю висит нетронутой.
 */
function TeamsList({ ctx, onOpen }) {
  const [teams, setTeams] = useState([]);
  const [closed, setClosed] = useState(0);
  const [signals, setSignals] = useState({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.getTeams();
      const list = data.teams || [];
      setTeams(list);
      setClosed(data.closedCount || 0);

      // Сигналы тянем только по своим командам: у чужой, открытой лишь по
      // уровню доступа, задач не видно вовсе, и запрос вернул бы нули, которые
      // читались бы как «там всё хорошо».
      const entries = await Promise.all(list
        .filter(team => team.isMember || team.isLead)
        .map(async team => {
          try {
            const res = await api.getTeamOverview(team.id);
            return [team.id, res.data];
          } catch {
            return [team.id, null];
          }
        }));
      setSignals(Object.fromEntries(entries));
    } catch {
      toast.error('Не удалось получить команды');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (ctx.teamsRevision) reload(); }, [ctx.teamsRevision, reload]);

  if (loading) return <Empty compact>Загружаем…</Empty>;
  if (!teams.length) {
    return (
      <Empty>
        Пока нет ни одной команды, доступной вам.
        <br />Создать её можно кнопкой «Создать команду» в шапке раздела.
      </Empty>
    );
  }

  return (
    <>
      <div className="tsk-teams">
        {teams.map(team => {
          const data = signals[team.id];
          const s = data?.signals;
          const mine = team.isMember || team.isLead;
          return (
            <div className="tsk-team is-clickable" key={team.id} onClick={() => onOpen(team.id)}>
              <div className="tsk-team-head">
                <div className="tsk-team-name">{team.name}</div>
                <span className="tsk-team-people" title="человек в команде">
                  <Users size={13} strokeWidth={2} />
                  {team.members?.length || 0}
                </span>
              </div>

              {!mine ? (
                <div className="tsk-team-sub">Вы не в составе: работа команды закрыта</div>
              ) : !data ? (
                <div className="tsk-team-sub">Считаем…</div>
              ) : !data.taskCount ? (
                <div className="tsk-team-sub">Командных задач пока нет</div>
              ) : (
                <>
                  <div className="tsk-team-signals">
                    <Signal icon={Clock3} value={s.unplanned} label="не разобрано" tone="warn" />
                    <Signal icon={AlertTriangle} value={s.stuck} label="анализируется" tone="bad" />
                    <Signal icon={CalendarX} value={s.overdue} label="просрочено" tone="bad" />
                  </div>
                  <div className="tsk-team-foot">
                    <span>
                      {data.taskCount}{' '}
                      {plural(data.taskCount, 'командная задача', 'командные задачи', 'командных задач')}
                    </span>
                    {team.isLead && <span>вы руководитель</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <Note>
        Вы видите {teams.length} команд.
        {closed > 0 && ` Ещё ${closed} существуют, но закрыты для вас.`}
        {' '}На карточке — не объём работы, а то, что требует вмешательства:
        сколько подзадач исполнители ещё не разобрали, сколько застряло после трёх
        переносов и сколько просрочено. Числа «всего задач» здесь нет намеренно:
        оно не опускается до нуля никогда, и показатель, который горит всегда,
        перестают замечать.
      </Note>
    </>
  );
}

/** Сигнал на карточке. Ноль не красится: тревожный цвет должен что-то значить. */
function Signal({ icon: Icon, value, label, tone }) {
  return (
    <span className={`tsk-signal ${value > 0 ? `is-${tone}` : ''}`} title={label}>
      <Icon size={13} strokeWidth={2} />
      {value}
    </span>
  );
}

/* ────────────────────────── страница команды ────────────────────────── */

function TeamDetail({ teamId, ctx, onBack }) {
  const [tab, setTab] = useState('overview');
  const [team, setTeam] = useState(null);
  const [editing, setEditing] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.getTeam(teamId);
      setTeam(data);
    } catch {
      setNotFound(true);
    }
  }, [teamId]);

  useEffect(() => { reload(); }, [reload, ctx.teamsRevision]);

  // Задачу, поставленную со страницы команды, незачем переспрашивать «чья она».
  // Кнопка «Новая задача» одна на весь модуль и стоит в шапке — подсказка едет
  // в неё тем же способом, что и выбор человека с таблицы загрузки.
  const { setNewTaskPreset } = ctx;
  useEffect(() => {
    if (!team) return undefined;
    const isMember = (team.members || []).some(m =>
      m.userId === ctx.me?.id && m.role !== 'viewer');
    if (isMember) setNewTaskPreset({ teamId: team.id, label: team.name });
    return () => setNewTaskPreset({});
    // tab в зависимостях не для красоты: таблица загрузки на своей вкладке
    // сбрасывает подсказку, когда её размонтируют, и без переустановки кнопка
    // после возврата на «Обзор» молча переставала бы адресовать задачу команде.
  }, [team, tab, ctx.me, setNewTaskPreset]);

  if (notFound) {
    return (
      <Empty>
        Команда не найдена или закрыта для вас.
        <br /><br />
        <button className="tsk-btn" onClick={onBack}>← Все команды</button>
      </Empty>
    );
  }
  if (!team) return <Empty compact>Загружаем…</Empty>;

  const isLead = (team.members || []).some(m => m.userId === ctx.me?.id && m.role === 'lead');

  return (
    <>
      <div className="tsk-team-page-head">
        {/* Возврат — квадратная кнопка со стрелкой, без подписи. Слева от
            названия команды она и так читается однозначно, а «← Все команды»
            словами занимало места больше самого названия, ради которого на
            страницу и заходят. Что она делает, говорит подсказка. */}
        <button
          type="button"
          className="tsk-icon-btn"
          onClick={onBack}
          title="Все команды"
          aria-label="Все команды"
        >
          <ArrowLeft size={17} strokeWidth={2} />
        </button>
        <div className="tsk-team-page-name">{team.name}</div>
        {/* Настройка — такая же квадратная кнопка со знаком, как возврат слева.
            В шапке из трёх элементов подпись «Настроить» была единственным
            словом, спорящим с названием команды за внимание, а шестерёнка
            читается без подписи где угодно. */}
        {(isLead || ctx.access?.isAdmin) && (
          <div className="tsk-team-page-actions">
            <button
              type="button"
              className="tsk-icon-btn"
              onClick={() => setEditing(true)}
              title="Настройка команды"
              aria-label="Настройка команды"
            >
              <Settings size={17} strokeWidth={1.9} />
            </button>
          </div>
        )}
      </div>

      <div className="tsk-team-tabs">
        {TABS.map(([key, label, Icon]) => (
          <button key={key} className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)}>
            <Icon size={15} strokeWidth={1.9} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview teamId={teamId} ctx={ctx} />}
      {tab === 'board' && <Board ctx={ctx} teamId={teamId} />}
      {tab === 'load' && <TeamLoad teamId={teamId} ctx={ctx} />}
      {tab === 'reports' && <TeamStats teamId={teamId} ctx={ctx} />}

      {editing && (
        <TeamModal
          teamId={teamId}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); }}
        />
      )}
    </>
  );
}

/* ───────────────────────────── вкладка «Обзор» ───────────────────────────── */

/**
 * Кто за что отвечает.
 *
 * Строка — человек, вложенные строки — его незакрытые части. Не доска и не
 * таблица часов: и та и другая отвечают на вопрос «что происходит», а здесь
 * спрашивают «кто это делает». Закрытые части не показываются — обзор про
 * текущую ответственность, а не про заслуги; сделанное лежит в отчётах.
 */
function Overview({ teamId, ctx }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    api.getTeamOverview(teamId)
      .then(res => { if (alive) setData(res.data); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [teamId, ctx.tasksRevision]);

  if (error) return <Empty>Не удалось собрать обзор команды.</Empty>;
  if (!data) return <Empty compact>Загружаем…</Empty>;

  if (!data.inTeam) {
    return (
      <Empty>
        Вы видите эту команду, но не состоите в ней.
        <br />Её работа открыта только участникам и наблюдателям.
      </Empty>
    );
  }

  const { signals } = data;
  const byName = (a, b) => userName(a.user).localeCompare(userName(b.user), 'ru');
  /**
   * Люди с работой — карточками, остальные — одной строкой внизу.
   *
   * Сначала карточка была у каждого, и в команде из четверых три из них
   * состояли из подписи «Командных задач нет». Это тот же столбец одинакового
   * шума, из-за которого подписи убрали из таблицы загрузки: сообщение об
   * отсутствии занимает место сообщения о человеке. Прятать таких людей совсем
   * тоже нельзя — это как раз те, кому можно поручить, — поэтому они остаются
   * строкой, а не карточкой.
   */
  const busy = data.people.filter(row => row.parts.length).sort(byName);
  const free = data.people.filter(row => !row.parts.length).sort(byName);

  return (
    <>
      <div className="tsk-stats">
        <div className="tsk-stat">
          <div className="tsk-stat-value">{data.taskCount}</div>
          <div className="tsk-stat-label">
            {plural(data.taskCount, 'командная задача', 'командные задачи', 'командных задач')} в работе
          </div>
        </div>
        <div className={`tsk-stat ${signals.unplanned ? 'is-warn' : ''}`}>
          <div className="tsk-stat-value">{signals.unplanned}</div>
          <div className="tsk-stat-label">
            {plural(signals.unplanned, 'подзадача', 'подзадачи', 'подзадач')} исполнитель ещё не разобрал
          </div>
        </div>
        <div className={`tsk-stat ${signals.stuck ? 'is-bad' : ''}`}>
          <div className="tsk-stat-value">{signals.stuck}</div>
          <div className="tsk-stat-label">
            {plural(signals.stuck, 'подзадача требует', 'подзадачи требуют', 'подзадач требуют')} решения
            после трёх переносов
          </div>
        </div>
        <div className={`tsk-stat ${signals.overdue ? 'is-bad' : ''}`}>
          <div className="tsk-stat-value">{signals.overdue}</div>
          <div className="tsk-stat-label">
            {plural(signals.overdue, 'подзадача просрочена', 'подзадачи просрочены', 'подзадач просрочено')}
          </div>
        </div>
      </div>

      <div className="tsk-sect">Кто за что отвечает</div>
      {!busy.length && (
        <div className="tsk-owner-empty" style={{ marginTop: 10 }}>
          Ни одной командной задачи в работе. Поставленная отсюда задача сразу
          будет открыта команде.
        </div>
      )}
      <div className="tsk-owners">
        {busy.map(row => (
          <div className="tsk-owner" key={row.user?.id || row.role}>
            <div className="tsk-owner-head">
              <Avatar user={row.user} size={30} />
              <div className="tsk-owner-name">
                {shortName(row.user)}
                <span>
                  {TEAM_ROLE_LABEL[row.role]}
                  {!row.enrolled && ' · расписание не настроено'}
                </span>
              </div>
              <span className="tsk-owner-count">{row.parts.length}</span>
            </div>

            {(
              <div className="tsk-owner-parts">
                {row.parts.map(part => {
                  const StatusIcon = STATUS_ICON[part.status];
                  return (
                    <button
                      type="button"
                      className={`tsk-owner-part ${part.isOverdue ? 'is-overdue' : ''}`}
                      key={part.partId}
                      onClick={() => ctx.openTask(part.taskId)}
                    >
                      {StatusIcon && (
                        <StatusIcon size={15} strokeWidth={1.8} color={STATUS_COLOR[part.status]} />
                      )}
                      <span className="tsk-owner-part-title">
                        {/* Название части, а не задачи: за часть человек и
                            отвечает. Задача подписана ниже — без неё «Созвон с
                            подрядчиком» не говорит, к чему он относится. */}
                        {part.title}
                        {part.taskTitle !== part.title && (
                          <b>{part.taskTitle}</b>
                        )}
                      </span>
                      {/* Окно работы, а не одна дата: подзадача на неделю
                          (ver. 8.48) иначе читалась бы как дело на четверг, и
                          вопрос «кто за что отвечает» получал бы неверный
                          ответ по срокам. */}
                      <span className="tsk-owner-part-due" title={STATUS_LABEL[part.status]}>
                        {part.startDate && String(part.startDate) !== String(part.dueDate)
                          ? dateRange(part.startDate, part.dueDate)
                          : ddate(part.dueDate)}
                      </span>
                      <span className="tsk-code">{partCode(part.code, null)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {!!free.length && (
        <div className="tsk-owners-free">
          <span>Без командных задач</span>
          {free.map(row => (
            <span className="tsk-owners-free-person" key={row.user?.id}>
              <Avatar user={row.user} size={20} />
              {shortName(row.user)}
            </span>
          ))}
        </div>
      )}

      <Note>
        Здесь только командные задачи — те, что явно открыты этой команде.
        Личные задачи участников сюда не попадают, даже у руководителя: обзор
        команды про общую работу, а не про то, чем человек занят вообще.
        Закрытые подзадачи не показываются — вопрос вкладки в том, кто за что
        отвечает сейчас.
      </Note>
    </>
  );
}

/* ──────────────────────────── вкладка «Загрузка» ──────────────────────────── */

/**
 * Часы участников за период. Переехала сюда из отдельного пункта меню: вопрос
 * «кто перегружен» задают про команду, а не про компанию, и отвечать на него
 * лучше там, где рядом видно, чем эти люди заняты.
 */
function TeamLoad({ teamId, ctx }) {
  const { cursor, setCursor } = ctx;
  const [view, setView] = useState('week');
  const [data, setData] = useState(null);

  const days = view === 'week' ? weekOf(cursor) : monthGrid(cursor).filter(Boolean);
  const start = days[0];
  const end = days[days.length - 1];

  useEffect(() => {
    let alive = true;
    setData(null);
    api.getTeamLoad(teamId, start, end)
      .then(res => { if (alive) setData(res.data); })
      .catch(() => toast.error('Не удалось получить загрузку команды'));
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

  if (!data) return <>{controls}<Empty compact>Загружаем…</Empty></>;

  const percentOf = new Map((data.summary?.perUser || []).map(u => [u.userId, u.percent]));

  return (
    <>
      {controls}
      <LoadTable rows={data.rows} days={days} view={view} ctx={ctx} percentOf={percentOf} />
      <Note>
        Норма у каждого своя, поэтому пунктир на каждой строке стоит в своём
        месте: 4 ч у подрядчика и 7 ч у поддержки — это не один и тот же день.
        Кольцо вокруг аватарки — процент от нормы за весь период. Часы считаются
        по всей работе человека, включая личные задачи и другие команды: иначе
        «свободен» означало бы «свободен в этой команде», и на него нельзя было
        бы опереться. Состав чужого дня не показывается — видны только часы.
        {data.summary.overloadedDays > 0 && (
          <> Переработка суммарно: {data.summary.overloadedDays} человеко-дней.</>
        )}
      </Note>
    </>
  );
}
