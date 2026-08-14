/**
 * Модуль «Задачи» (ver. 6.75) — оболочка и навигация.
 *
 * Пришёл на смену канбан-доске. Доска здесь осталась, но стала одним экраном из
 * девяти и далеко не главным: смысл модуля не в колонках, а в том, что у работы
 * есть длительность, у человека — норма рабочего дня, а у срока — согласование
 * вместо назначения.
 *
 * Внутренняя навигация повторяет трёхколоночную геометрию прототипа, а цвета,
 * шрифт и состояния берёт из общей дизайн-системы Alfa Wiki.
 *
 * Порядок разделов повторяет прототип и он не случайный. «Мой день» стоит выше
 * блока «Команды» даже у руководителя: он тоже человек с перегруженным днём, и
 * открывать утром ему нужно свой день, а не чужую загрузку.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  CalendarDays, Inbox, BarChart3, Users, Columns3,
  UserCog, Shield, ListTodo, PieChart,
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
import TeamsAdmin from './components/TeamsAdmin';
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
  { group: 'Моё' },
  { key: 'tasks', label: 'Задачи', icon: ListTodo, Component: TaskList },
  { key: 'reports', label: 'Отчёты', icon: PieChart, Component: Reports },
];

const SCREEN_CONTEXT = {
  myday: ['Личный фокус', 'Откройте день утром: здесь только ваша загрузка и план, без командной аналитики.'],
  inbox: ['Сначала договориться', 'Пока исполнитель не выбрал день, задача не занимает его время. Автор видит это как ожидание ответа.'],
  chart: ['Период и окна', 'Неделя показывает состав дней, месяц — где завал и где остаётся свободное время.'],
  load: ['Команда → человек → день', 'Сначала выберите команду, затем сотрудника. Содержание личных дел не раскрывается.'],
  board: ['Статус — следствие', 'Колонки показывают состояние частей задачи, а не заменяют планирование по времени.'],
  people: ['Норма у каждого своя', 'Подрядчик, руководитель и поддержка не должны сравниваться с одной общей нормой.'],
  teams: ['Граница видимости', 'Команда определяет, кто видит загрузку, и не является владельцем задач.'],
  tasks: ['Вся работа в срезе', 'Фильтры помогают отделить поставленное вами, совместные задачи и то, что требует решения.'],
  reports: ['Загрузка, не слежка', 'Здесь нет онлайна и времени в приложении — только запланированные часы и личные нормы.'],
};

export default function Tasks() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const screen = params.get('screen') || 'myday';

  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inboxCount, setInboxCount] = useState(0);

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
  }, [refreshInbox]);

  const go = useCallback(key => {
    const next = new URLSearchParams(params);
    next.set('screen', key);
    setParams(next, { replace: true });
  }, [params, setParams]);

  /** Общий контекст экранов — чтобы не протаскивать десяток пропсов по одному. */
  const ctx = useMemo(() => ({
    me: user,
    access,
    cursor,
    setCursor,
    go,
    openTask: setOpenTaskId,
    newTask: (preset = {}) => setFormState(preset),
    refreshInbox,
    reloadAccess: loadAccess,
  }), [user, access, cursor, go, refreshInbox, loadAccess]);

  if (loading) return <div className="tsk"><Spinner /></div>;

  const current = SCREENS.find(s => s.key === screen) || SCREENS[0];
  const Screen = current.Component;
  const detail = SCREEN_CONTEXT[current.key] || SCREEN_CONTEXT.myday;

  return (
    <div className="tsk">
      <div className="tsk-shell">
        <aside className="tsk-side">
          <div className="tsk-side-brand">
            <span>Задачи</span>
            <small>Alfa Wiki</small>
          </div>
          <nav className="tsk-nav">
            {SCREENS.map((item, i) => item.group
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
              <div className="tsk-sub">Работа со сроком, длительностью и загрузкой</div>
            </div>
            <button className="tsk-btn is-primary" onClick={() => setFormState({})}>
              Новая задача
            </button>
          </div>

          <div className="tsk-content">
            {/* Без нормы человек не участвует в планировании: ему нельзя ставить
                задачи и незачем показывать пустой календарь. */}
            {access && !access.enrolled && screen !== 'people' && (
              <Empty>
                Вам ещё не задана норма рабочего дня, поэтому загрузка не считается.
                <br />
                Норма — это честное время на задачи: рабочий день минус встречи,
                переключения и перерывы.
                <br /><br />
                <button className="tsk-btn" onClick={() => go('people')}>Задать норму</button>
              </Empty>
            )}
            <Screen ctx={ctx} />
          </div>
        </main>

        <aside className="tsk-detail">
          <div className="tsk-detail-title">{detail[0]}</div>
          <div className="tsk-detail-text">{detail[1]}</div>
          <div className="tsk-detail-rule" />
          <div className="tsk-detail-label">Текущий раздел</div>
          <div className="tsk-detail-value">{current.label}</div>
          <button className="tsk-btn is-wide" onClick={() => setFormState({})}>+ Новая задача</button>
        </aside>
      </div>

      {openTaskId && (
        <TaskCard
          taskId={openTaskId}
          ctx={ctx}
          onClose={closeTask}
          onChanged={refreshInbox}
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
