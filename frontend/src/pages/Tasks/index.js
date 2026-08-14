/**
 * Модуль «Задачи» (ver. 6.75) — оболочка и навигация.
 *
 * Пришёл на смену канбан-доске. Доска здесь осталась, но стала одним экраном из
 * девяти и далеко не главным: смысл модуля не в колонках, а в том, что у работы
 * есть длительность, у человека — норма рабочего дня, а у срока — согласование
 * вместо назначения.
 *
 * Навигация горизонтальной лентой, а не вторым сайдбаром: слева уже есть
 * сайдбар портала, и второй вертикальный список превратил бы экран в коридор.
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

  /**
   * Обработчики модалок мемоизированы, и это не микрооптимизация.
   *
   * Карточка задачи перезагружается при смене onClose — иначе её нельзя
   * закрыть из обработчика ошибки. Пока onClose создавался инлайном, он менял
   * идентичность на каждый рендер: карточка грузилась, вызывала setTask,
   * получала новый onClose и грузилась снова — бесконечный цикл запросов.
   */
  const closeTask = useCallback(() => setOpenTaskId(null), []);
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

  return (
    <div className="tsk">
      <div className="tsk-top">
        <div>
          <div className="tsk-title">Задачи</div>
          <div className="tsk-sub">
            Работа со сроком, длительностью и загрузкой — вместо доски со стикерами
          </div>
        </div>
        <button className="tsk-btn is-primary" onClick={() => setFormState({})}>
          Новая задача
        </button>
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
              <item.icon size={15} />
              {item.label}
              {item.key === 'inbox' && inboxCount > 0 && (
                <span className="tsk-nav-count">{inboxCount}</span>
              )}
            </button>
          ))}
      </nav>

      {/* Без нормы человек не участвует в планировании: ему нельзя ставить
          задачи и незачем показывать пустой календарь. Честнее сказать это
          прямо, чем оставить его гадать, почему все цифры нулевые. */}
      {access && !access.enrolled && screen !== 'people' && (
        <Empty>
          Вам ещё не задана норма рабочего дня, поэтому загрузка не считается.
          <br />
          Норма — это не длина смены, а честное время на задачи: рабочий день
          минус встречи, переключения и перерывы.
          <br /><br />
          <button className="tsk-btn" onClick={() => go('people')}>
            Задать норму
          </button>
        </Empty>
      )}

      <Screen ctx={ctx} />

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
    </div>
  );
}
