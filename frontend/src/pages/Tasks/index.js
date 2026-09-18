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
  CalendarDays, Inbox, BarChart3, Columns3,
  UserCog, Shield, ListTodo, PieChart, FolderKanban,
} from 'lucide-react';

import { tasks as api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { today } from './utils/dates';
import { Spinner, Empty } from './components/Bits';

import MyDay from './components/MyDay';
import InboxScreen from './components/InboxScreen';
import Chart from './components/Chart';
import Board from './components/Board';
import People from './components/People';
import TeamPage from './components/TeamPage';
import { TeamModal } from './components/TeamsAdmin';
import ProjectsAdmin, { ProjectModal } from './components/ProjectsAdmin';
import TaskList from './components/TaskList';
import Reports from './components/Reports';
import TaskForm from './components/TaskForm';
import TaskCard from './components/TaskCard';

import './Tasks.css';

/**
 * Разделы сгруппированы по тому, чьё это, а не по тому, как выглядит.
 *
 * До ver. 8.42 группа «Команды» состояла из пяти экранов, из которых о команде
 * рассказывал ровно ноль: «Загрузка» показывала часы, «Доска» — всё вперемешку,
 * «Команды» — кнопки настройки. Теперь команда одна строка меню, и всё про неё
 * лежит внутри неё же.
 *
 * Отдельного экрана «Загрузка» тоже не стало (ver. 8.45). Он задумывался как
 * ответ на вопрос «кому вообще поручить» — про всю компанию, включая тех, кто
 * не состоит ни в одной команде. На деле в модуль заводят через команду, людей
 * вне команд в нём не оказалось, и экран показывал подмножество того, что и так
 * лежит во вкладке «Загрузка» внутри команды: две одинаковые на вид таблицы с
 * одним названием в одном меню. Понадобится снова — вернётся, маршрут
 * /tasks/people/load на месте.
 *
 * «Моё» стоит выше «Команд» даже у руководителя: он тоже человек с
 * перегруженным днём, и открывать утром ему нужно свой день, а не чужую
 * загрузку. «Доска» переехала в «Моё» и там же и должна быть — это личные
 * задачи, разложенные по состояниям, тот же набор, что и в «Задачах».
 *
 * «Люди» и «Проекты» — справочники, и стоят последними: в них заходят раз в
 * месяц, чтобы что-то завести, а не чтобы посмотреть.
 */
const SCREENS = [
  { key: 'myday', label: 'Мой день', icon: CalendarDays, Component: MyDay },
  { key: 'inbox', label: 'Входящие', icon: Inbox, Component: InboxScreen },
  { key: 'chart', label: 'График', icon: BarChart3, Component: Chart },
  { group: 'Моё' },
  { key: 'tasks', label: 'Задачи', icon: ListTodo, Component: TaskList },
  { key: 'board', label: 'Доска', icon: Columns3, Component: Board },
  { key: 'reports', label: 'Отчёты', icon: PieChart, Component: Reports },
  { group: 'Команды' },
  /**
   * У пункта два имени, и они про разное.
   *
   * label — куда кнопка ведёт: «Все команды». Заголовок группы уже сказал слово
   * «Команды», и повторять его пунктом значит сказать дважды одно.
   *
   * title — где человек находится: «Команды». Провалившись в «Маркетинг», он
   * видел бы над ним шапку «Все команды», хотя открыта ровно одна; имя самой
   * команды стоит строкой ниже и говорит за себя.
   */
  { key: 'teams', label: 'Все команды', title: 'Команды', icon: Shield, Component: TeamPage },
  { group: 'Справочники' },
  { key: 'people', label: 'Люди', icon: UserCog, Component: People },
  { key: 'projects', label: 'Проекты', icon: FolderKanban, Component: ProjectsAdmin, managerOnly: true },
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
  /**
   * Слот для фильтров экрана в общей шапке.
   *
   * Фильтры рисует сам экран — он знает, какие они, — но стоять они должны в
   * одной строке с названием раздела, над рабочим полотном. Тащить их наверх
   * пропсами значит описывать в оболочке фильтры каждого экрана; вместо этого
   * оболочка отдаёт узел, а экран рисует в него порталом.
   *
   * Через state, а не ref: узел появляется после первого рендера, и без
   * перерисовки экран не узнал бы, что портал уже есть куда ставить.
   */
  const [headerSlot, setHeaderSlot] = useState(null);
  /**
   * Что подставить в «Новую задачу», если экран успел это подсказать.
   *
   * Кнопка одна на все разделы и стоит в шапке — своей кнопки «поставить
   * задачу» у экрана быть не должно, она дублировала бы её в двух шагах друг от
   * друга. Но экран загрузки знает больше шапки: там уже выбрали и человека, и
   * день. Поэтому выбор едет не в отдельную кнопку, а в эту же.
   */
  const [newTaskPreset, setNewTaskPreset] = useState({});
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
      // Бейдж на кнопке модуля живёт в сайдбаре, вне этой страницы. Без сигнала
      // он обновится только по своему таймеру, и человек, только что разобравший
      // входящие, ещё минуту видел бы на кнопке старое число.
      window.dispatchEvent(new Event('tasks-badge-changed'));
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
    // Рабочие блоки задач являются событиями календаря. Сайдбар живёт вне
    // страницы задач и без явного сигнала продолжает показывать старые точки.
    window.dispatchEvent(new Event('calendar-events-changed'));
  }, [refreshInbox]);

  // Выбор живёт ровно на том экране, где его сделали: уходя, кнопка снова
  // становится просто «Новой задачей».
  useEffect(() => { setNewTaskPreset({}); }, [screen]);

  const go = useCallback((key, options = {}) => {
    const next = new URLSearchParams(params);
    next.set('screen', key);
    if (options.teamId) next.set('team', options.teamId);
    else next.delete('team');
    setParams(next, { replace: true });
  }, [params, setParams]);

  /**
   * Обводка активного пункта — отдельный слой под кнопками, и её положение
   * приходится измерять.
   *
   * Зависимость от loading здесь не для красоты. Пока страница грузит права,
   * оболочка отдаёт спиннер вместо всей боковой панели: navRef пуст, измерять
   * нечего, и эффект выходит ни с чем. Меню появлялось следующим рендером, а
   * эффект больше не запускался — экран-то не менялся, — и обводка не
   * показывалась до первого переключения вкладки. Ровно это и было видно после
   * перезагрузки: синяя подпись есть, подложки под ней нет.
   *
   * Более поздние перестроения меню ловит ResizeObserver: «Проекты» появляются
   * только у руководителя, и с приходом прав панель становится выше.
   */
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (loading || !nav) return undefined;
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
  }, [screen, loading]);

  /** Общий контекст экранов — чтобы не протаскивать десяток пропсов по одному. */
  const ctx = useMemo(() => ({
    me: user,
    access,
    cursor,
    setCursor,
    go,
    selectedTeamId: params.get('team'),
    headerSlot,
    openTask: setOpenTaskId,
    newTask: (preset = {}) => setFormState(preset),
    setNewTaskPreset,
    refreshInbox,
    reloadAccess: loadAccess,
    teamsRevision,
    projectsRevision,
    tasksRevision,
  }), [user, access, cursor, go, refreshInbox, loadAccess, teamsRevision, projectsRevision, tasksRevision, params, headerSlot]);

  if (loading) return <div className="tsk"><Spinner /></div>;

  const current = SCREENS.find(s => s.key === screen) || SCREENS[0];
  const Screen = current.Component;
  const headerAction = screen === 'projects' && !access?.canManageProjects
    ? null
    : ['inbox', 'people', 'reports'].includes(screen)
    ? null
    // Команды заводят в списке команд — и только там. Провалившись внутрь
    // команды, человек занят её работой, и кнопка «Создать команду» над
    // страницей конкретной команды предлагала бы завести ещё одну вместо
    // того, чтобы поставить задачу в эту. На «Загрузке» её нет по той же
    // причине: экран отвечает на другой вопрос — кто перегружен.
    : screen === 'teams' && !params.get('team') ? 'team'
    : screen === 'projects' ? 'project' : 'task';
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
            <div className="tsk-title">{current.title || current.label}</div>
            {/* Фильтры стоят справа, рядом с главной кнопкой: слева читают, где
                находишься, справа — управляют тем, что видишь. */}
            <div className="tsk-top-right">
              <div className="tsk-top-filters" ref={setHeaderSlot} />
              {headerAction && <button className="tsk-btn is-primary"
                onClick={() => headerAction === 'team' ? setTeamFormOpen(true)
                  : headerAction === 'project' ? setProjectFormOpen(true) : setFormState(newTaskPreset)}>
                {headerAction === 'team' ? 'Создать команду' : headerAction === 'project' ? 'Создать проект' : 'Новая задача'}
                {/* Подпись выбора — единственное подтверждение, что нажатие по
                    клетке во что-то попало. Без неё выбор молчит, и человек
                    заново ищет исполнителя в модалке. */}
                {headerAction === 'task' && newTaskPreset.label && (
                  <span className="tsk-btn-preset">{newTaskPreset.label}</span>
                )}
              </button>}
            </div>
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

    </div>
  );
}
