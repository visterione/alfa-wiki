/**
 * Модуль «Задачи» (ver. 6.75) — оболочка и навигация.
 *
 * Пришёл на смену канбан-доске. Доска здесь осталась, но стала одним экраном из
 * девяти и далеко не главным: смысл модуля не в колонках, а в том, что у работы
 * есть длительность, у человека — норма рабочего дня, а у срока — согласование
 * вместо назначения.
 *
 * Продуктовая часть прототипа состоит из навигации и рабочего полотна.
 * Правая колонка в исходном HTML была авторским комментарием к макету и в
 * интерфейс не переносится. Цвета и шрифт берутся из Alfa Wiki.
 *
 * Порядок разделов повторяет прототип и он не случайный. «Мой день» стоит выше
 * блока «Команды» даже у руководителя: он тоже человек с перегруженным днём, и
 * открывать утром ему нужно свой день, а не чужую загрузку.
 */

import React, { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  CalendarDays, Inbox, BarChart3, Users, Columns3,
  UserCog, Shield, ListTodo, PieChart, FolderKanban,
} from 'lucide-react';

import { tasks as api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { today } from './utils/dates';
import { Spinner, Empty } from './components/Bits';

import MyDay from './components/MyDay';
import InboxScreen from './components/InboxScreen';
import Chart from './components/Chart';
import TeamsLoad from './components/TeamsLoad';
import Board from './components/Board';
import People from './components/People';
import TeamsAdmin, { TeamModal } from './components/TeamsAdmin';
import ProjectsAdmin, { ProjectModal } from './components/ProjectsAdmin';
import TaskList from './components/TaskList';
import Reports from './components/Reports';
import TaskForm from './components/TaskForm';
import TaskCard from './components/TaskCard';

import './Tasks.css';

const SCREENS = [
  { key: 'myday', label: 'Мой день', icon: CalendarDays, Component: MyDay },
  { key: 'inbox', label: 'Входящие', icon: Inbox, Component: InboxScreen },
  { key: 'chart', label: 'График', icon: BarChart3, Component: Chart },
  { group: 'Команды' },
  { key: 'load', label: 'Загрузка', icon: Users, Component: TeamsLoad },
  { key: 'board', label: 'Доска', icon: Columns3, Component: Board },
  { key: 'people', label: 'Люди', icon: UserCog, Component: People },
  { key: 'teams', label: 'Команды', icon: Shield, Component: TeamsAdmin },
  { key: 'projects', label: 'Проекты', icon: FolderKanban, Component: ProjectsAdmin, managerOnly: true },
  { group: 'Моё' },
  { key: 'tasks', label: 'Задачи', icon: ListTodo, Component: TaskList },
  { key: 'reports', label: 'Отчёты', icon: PieChart, Component: Reports },
];

export default function Tasks() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const requestedScreen = params.get('screen');
  const screen = SCREENS.some(item => item.key === requestedScreen) ? requestedScreen : 'myday';

  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inboxCount, setInboxCount] = useState(0);
  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [teamsRevision, setTeamsRevision] = useState(0);
  const [projectsRevision, setProjectsRevision] = useState(0);
  const [tasksRevision, setTasksRevision] = useState(0);
  const [projectFormOpen, setProjectFormOpen] = useState(false);

  // Общий курсор даты: переключаясь между «Моим днём» и «Графиком», человек
  // должен оставаться в том же дне, а не прыгать на сегодня каждый раз.
  const [cursor, setCursor] = useState(today());

  // Модальные окна живут в оболочке, а не в экранах: карточку задачи
  // открывают пять разных экранов, и дублировать её в каждом значило бы
  // получить пять слегка разошедшихся карточек.
  const [openTaskId, setOpenTaskId] = useState(null);
  const [formState, setFormState] = useState(null);
  const [joinInvite, setJoinInvite] = useState(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const navRef = useRef(null);
  const [navIndicator, setNavIndicator] = useState({ top: 0, height: 0, ready: false });

  const loadAccess = useCallback(async () => {
    try {
      const { data } = await api.getAccess();
      setAccess(data);
    } catch (error) {
      toast.error('Не удалось открыть раздел «Задачи»');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshInbox = useCallback(async () => {
    try {
      const { data } = await api.getInbox();
      setInboxCount((data.mine || []).length);
    } catch {
      // Счётчик входящих не критичен: молча оставляем прежний, чтобы одна
      // неудачная выборка не роняла весь экран.
    }
  }, []);

  useEffect(() => { loadAccess(); refreshInbox(); }, [loadAccess, refreshInbox]);

  // Ссылки из уведомлений открывают карточку поверх нужного экрана.
  useEffect(() => {
    const taskId = params.get('task');
    if (taskId) setOpenTaskId(taskId);
  }, [params]);

  const joinToken = params.get('join');
  const clearJoin = useCallback(() => {
    setJoinInvite(null);
    setParams(previous => {
      if (!previous.has('join')) return previous;
      const next = new URLSearchParams(previous);
      next.delete('join');
      return next;
    }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    if (!joinToken) return;
    let alive = true;
    api.getTeamInvite(joinToken)
      .then(({ data }) => {
        if (!alive) return;
        setJoinInvite({ ...data, token: joinToken });
      })
      .catch(error => {
        if (!alive) return;
        toast.error(error?.response?.data?.error || 'Не удалось открыть приглашение');
        clearJoin();
      });
    return () => { alive = false; };
  }, [joinToken, clearJoin]);

  const acceptJoin = useCallback(async () => {
    if (!joinInvite?.token) return;
    setJoinBusy(true);
    try {
      const { data } = await api.acceptTeamInvite(joinInvite.token);
      toast.success(`Вы присоединились к команде «${data.team.name}»`);
      await loadAccess();
      clearJoin();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Не удалось принять приглашение');
    } finally {
      setJoinBusy(false);
    }
  }, [joinInvite, loadAccess, clearJoin]);

  /**
   * Обработчики модалок мемоизированы, и это не микрооптимизация.
   *
   * Карточка задачи перезагружается при смене onClose — иначе её нельзя
   * закрыть из обработчика ошибки. Пока onClose создавался инлайном, он менял
   * идентичность на каждый рендер: карточка грузилась, вызывала setTask,
   * получала новый onClose и грузилась снова — бесконечный цикл запросов.
   */
  const closeTask = useCallback(() => {
    setOpenTaskId(null);
    if (params.has('task')) {
      const next = new URLSearchParams(params);
      next.delete('task');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);
  const closeForm = useCallback(() => setFormState(null), []);
  const taskCreated = useCallback(() => {
    setFormState(null);
    refreshInbox();
    setTasksRevision(value => value + 1);
  }, [refreshInbox]);
  const taskChanged = useCallback(() => {
    refreshInbox();
    setTasksRevision(value => value + 1);
  }, [refreshInbox]);

  const go = useCallback((key, options = {}) => {
    const next = new URLSearchParams(params);
    next.set('screen', key);
    if (options.teamId) next.set('team', options.teamId);
    else next.delete('team');
    setParams(next, { replace: true });
  }, [params, setParams]);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const update = () => {
      const active = nav.querySelector('button.is-on');
      if (!active) return;
      setNavIndicator({ top: active.offsetTop, height: active.offsetHeight, ready: true });
    };
    update();
    const observer = typeof window.ResizeObserver === 'undefined'
      ? null
      : new window.ResizeObserver(update);
    observer?.observe(nav);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [screen]);

  /** Общий контекст экранов — чтобы не протаскивать десяток пропсов по одному. */
  const ctx = useMemo(() => ({
    me: user,
    access,
    cursor,
    setCursor,
    go,
    selectedTeamId: params.get('team'),
    openTask: setOpenTaskId,
    newTask: (preset = {}) => setFormState(preset),
    refreshInbox,
    reloadAccess: loadAccess,
    teamsRevision,
    projectsRevision,
    tasksRevision,
  }), [user, access, cursor, go, refreshInbox, loadAccess, teamsRevision, projectsRevision, tasksRevision, params]);

  if (loading) return <div className="tsk"><Spinner /></div>;

  const current = SCREENS.find(s => s.key === screen) || SCREENS[0];
  const Screen = current.Component;
  const headerAction = screen === 'projects' && !access?.canManageProjects
    ? null
    : ['inbox', 'people', 'reports'].includes(screen)
    ? null
    : ['load', 'teams'].includes(screen) ? 'team' : screen === 'projects' ? 'project' : 'task';
  return (
    <div className="tsk">
      <div className="tsk-shell">
        <aside className="tsk-side">
          <div className="tsk-side-brand">
            <span>Задачи</span>
          </div>
          <nav
            className={`tsk-nav ${navIndicator.ready ? 'is-ready' : ''}`}
            ref={navRef}
            style={{ '--tsk-nav-top': `${navIndicator.top}px`, '--tsk-nav-height': `${navIndicator.height}px` }}
          >
            {SCREENS.filter(item => !item.managerOnly || access?.canManageProjects).map((item, i) => item.group
              ? <span className="tsk-nav-group" key={`g${i}`}>{item.group}</span>
              : (
                <button
                  key={item.key}
                  className={screen === item.key ? 'is-on' : ''}
                  onClick={() => go(item.key)}
                >
                  <item.icon size={16} />
                  {item.label}
                  {item.key === 'inbox' && inboxCount > 0 && (
                    <span className="tsk-nav-count">{inboxCount}</span>
                  )}
                </button>
              ))}
          </nav>
        </aside>

        <main className="tsk-main">
          <div className="tsk-top">
            <div>
              <div className="tsk-title">{current.label}</div>
            </div>
            {headerAction && <button className="tsk-btn is-primary"
              onClick={() => headerAction === 'team' ? setTeamFormOpen(true)
                : headerAction === 'project' ? setProjectFormOpen(true) : setFormState({})}>
              {headerAction === 'team' ? 'Создать команду' : headerAction === 'project' ? 'Создать проект' : 'Новая задача'}
            </button>}
          </div>

          <div className="tsk-content">
            {/* Без расписания человек не участвует в планировании: ему нельзя ставить
                задачи и незачем показывать пустой календарь. */}
            {access && !access.enrolled && !['people', 'projects'].includes(screen) && (
              <Empty>
                Рабочее расписание ещё не настроено, поэтому загрузка не считается.
                <br />
                В расписании отмечаются рабочие дни и фактические границы смен.
                <br /><br />
                <button className="tsk-btn" onClick={() => go('people')}>Настроить расписание</button>
              </Empty>
            )}
            <Screen ctx={ctx} />
          </div>
        </main>

      </div>

      {openTaskId && (
        <TaskCard
          taskId={openTaskId}
          ctx={ctx}
          onClose={closeTask}
          onChanged={taskChanged}
        />
      )}

      {formState && (
        <TaskForm
          preset={formState}
          ctx={ctx}
          onClose={closeForm}
          onCreated={taskCreated}
        />
      )}

      {teamFormOpen && (
        <TeamModal
          onClose={() => setTeamFormOpen(false)}
          onSaved={() => {
            setTeamFormOpen(false);
            setTeamsRevision(value => value + 1);
          }}
        />
      )}

      {projectFormOpen && (
        <ProjectModal
          onClose={() => setProjectFormOpen(false)}
          onSaved={() => {
            setProjectFormOpen(false);
            setProjectsRevision(value => value + 1);
          }}
        />
      )}

      {joinInvite && (
        <div className="tsk-mask" onClick={e => e.target === e.currentTarget && clearJoin()}>
          <div className="tsk-modal" style={{ width: 480 }}>
            <div className="tsk-modal-head">
              <div className="tsk-modal-title">Приглашение в команду</div>
              <button className="tsk-x" onClick={clearJoin}>×</button>
            </div>
            <div className="tsk-modal-body">
              <div className="tsk-join-name">{joinInvite.team.name}</div>
              <div className="tsk-trade is-neutral">
                <div className="tsk-trade-title">Ваша роль</div>
                <div className="tsk-trade-text">
                  {joinInvite.role === 'lead' ? 'Руководитель' : joinInvite.role === 'viewer' ? 'Наблюдатель' : 'Участник'}.
                  {' '}Содержание личных дел других сотрудников останется скрытым.
                </div>
              </div>
            </div>
            <div className="tsk-modal-foot">
              <button className="tsk-btn" onClick={clearJoin}>Отмена</button>
              <button className="tsk-btn is-primary" disabled={joinBusy} onClick={acceptJoin}>
                {joinBusy ? 'Вступаем…' : 'Вступить в команду'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
