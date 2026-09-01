/**
 * Онбординг врача (ver. 7.30) — оболочка и навигация.
 *
 * Устроен как «Задачи»: слева разделы, справа полотно. Один маршрут, раздел
 * переключается параметром ?screen=, чтобы ссылка на конкретный экран
 * оставалась рабочей.
 *
 * Что человек здесь увидит, решает бэкенд: список заявок ограничен филиалами,
 * где он назначен исполнителем хоть на один шаг, а анкета в карточке приходит
 * уже урезанной под этот шаг.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Inbox, Archive, SlidersHorizontal, QrCode, MessagesSquare } from 'lucide-react';

import { onboarding as api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import ApplicationCard from './ApplicationCard';
import OnboardingSettings from './OnboardingSettings';
import OnboardingMaterials from './OnboardingMaterials';
import OnboardingChats from './OnboardingChats';
import { Badge, dueText, professionsText } from './bits';
import './Onboarding.css';

const SCREENS = [
  { key: 'tasks', label: 'Мои задачи', icon: Inbox },
  { key: 'apps', label: 'Заявки', icon: FileText },
  { key: 'archive', label: 'Архив', icon: Archive },
  { group: 'Раздел' },
  // Ссылку на анкету рассылает тот, кто ищет врача, а не администратор,
  // поэтому «Материалы» видны всем, у кого есть раздел.
  { key: 'materials', label: 'Материалы', icon: QrCode },
  { key: 'settings', label: 'Настройки', icon: SlidersHorizontal, adminOnly: true },
  // Ссылки в рабочие чаты уходят врачу письмом после запуска, и состав этих
  // чатов — решение сети, а не того, кто ведёт конкретную заявку.
  { key: 'chats', label: 'Рабочие чаты', icon: MessagesSquare, adminOnly: true },
];

export default function Onboarding() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const requested = params.get('screen');
  const screen = SCREENS.some(s => s.key === requested) ? requested : 'tasks';

  const [tasks, setTasks] = useState([]);
  const [apps, setApps] = useState([]);
  const [archive, setArchive] = useState([]);
  const [canConfigure, setCanConfigure] = useState(false);
  const [loading, setLoading] = useState(true);
  const navRef = useRef(null);
  const [navIndicator, setNavIndicator] = useState({ top: 0, height: 36, ready: false });
  // Карточка открывается и по адресу: ?app=<id>. Уведомление об онбординге ведёт
  // на конкретную заявку, и человек должен попадать сразу в неё, а не в список.
  const openId = params.get('app');
  const setOpenId = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('app', id); else next.delete('app');
    setParams(next, { replace: true });
  };

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [overview, my, active, old] = await Promise.all([
        api.overview(),
        api.myTasks(),
        api.applications({ archived: 'false' }),
        api.applications({ archived: 'true' }),
      ]);
      setCanConfigure(Boolean(overview.data.canConfigure));
      setTasks(my.data || []);
      setApps(active.data || []);
      setArchive(old.data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось загрузить раздел');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Новая задача, её захват коллегой или завершение шага отражаются на уже
  // открытом экране без перезагрузки. Небольшой debounce схлопывает несколько
  // событий одного перехода процесса в один запрос.
  useEffect(() => {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => load({ silent: true }), 80);
    };
    window.addEventListener('onboarding-changed', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('onboarding-changed', refresh);
    };
  }, [load]);

  /**
   * Подсветка активного пункта — отдельный слой под кнопками, и её положение
   * приходится измерять.
   *
   * Зависимость от loading не для красоты: пока раздел грузится, «Настройки» в
   * меню ещё нет (право приходит вместе с данными), и панель после загрузки
   * становится выше. Без пересчёта подложка осталась бы на месте, посчитанном
   * по короткому меню.
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
  }, [screen, loading, canConfigure]);

  const go = (key) => setParams(key === 'tasks' ? {} : { screen: key }, { replace: true });
  const isAdmin = canConfigure || user?.isAdmin;

  return (
    <div className="onb">
      <div className="onb-shell">
        <aside className="onb-side">
          <div className="onb-side-brand"><span>Онбординг</span></div>

          <nav
            className={`onb-nav ${navIndicator.ready ? 'is-ready' : ''}`}
            ref={navRef}
            style={{ '--onb-nav-top': `${navIndicator.top}px`, '--onb-nav-height': `${navIndicator.height}px` }}
          >
            {SCREENS.map((item, index) => {
              if (item.group) return <div className="onb-nav-group" key={`g${index}`}>{item.group}</div>;
              if (item.adminOnly && !isAdmin) return null;
              const Icon = item.icon;
              const count = item.key === 'tasks' ? tasks.length : 0;
              return (
                <button
                  key={item.key}
                  className={screen === item.key ? 'is-on' : ''}
                  onClick={() => go(item.key)}
                >
                  <Icon size={16} />
                  {item.label}
                  {count > 0 && <span className="onb-nav-count">{count}</span>}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="onb-main">
          <div className="onb-top">
            <div className="onb-title">
              {SCREENS.find(s => s.key === screen)?.label}
            </div>
          </div>

          <div className="onb-content">
            {loading && <div className="onb-empty">Загружаем…</div>}

            {!loading && screen === 'tasks' && (
              tasks.length
                ? <TaskTable tasks={tasks} onOpen={setOpenId} />
                : <div className="onb-empty">Задач нет</div>
            )}

            {!loading && screen === 'apps' && (
              apps.length
                ? <AppTable apps={apps} onOpen={setOpenId} />
                : <div className="onb-empty">Активных заявок нет</div>
            )}

            {!loading && screen === 'archive' && (
              archive.length
                ? <AppTable apps={archive} onOpen={setOpenId} />
                : <div className="onb-empty">Архив пуст</div>
            )}

            {!loading && screen === 'materials' && <OnboardingMaterials />}

            {!loading && screen === 'settings' && isAdmin && <OnboardingSettings />}

            {!loading && screen === 'chats' && isAdmin && <OnboardingChats />}
          </div>
        </div>
      </div>

      {openId && (
        <ApplicationCard
          applicationId={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function TaskTable({ tasks, onOpen }) {
  return (
    <table className="onb-table">
      <thead>
        <tr>
          <th>Что сделать</th>
          <th>Специальность</th>
          <th />
          <th>Срок</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map(task => (
          <tr
            key={task.id}
            className={`is-clickable${task.overdue ? ' is-late' : ''}`}
            onClick={() => onOpen(task.applicationId)}
          >
            <td>
              <div className="onb-name">{task.title}</div>
              <div className="onb-sub">{task.fullName || 'без имени'}</div>
            </td>
            <td className="onb-sub">{professionsText(task.professions)}</td>
            <td>
              {task.requiresClaim && !task.claimedBy && (
                <span className="onb-shared-note">Общая · нужно взять</span>
              )}
            </td>
            <td className={`onb-when${task.overdue ? ' is-late' : ''}`}>{dueText(task)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AppTable({ apps, onOpen }) {
  return (
    <table className="onb-table">
      <thead>
        <tr>
          <th>Врач</th>
          <th>Филиал</th>
          <th>Стадия</th>
          <th>Готовность</th>
        </tr>
      </thead>
      <tbody>
        {apps.map(app => (
          <tr
            key={app.id}
            className={`is-clickable${app.overdue ? ' is-late' : ''}`}
            onClick={() => onOpen(app.id)}
          >
            <td>
              <div className="onb-name">{app.fullName || 'без имени'}</div>
              <div className="onb-sub">{professionsText(app.professions)}</div>
            </td>
            <td className="onb-sub">{app.medCenter?.name || '—'}</td>
            <td><Badge tone={statusTone(app.status)}>{app.stage.label}</Badge></td>
            <td>
              <div
                className="onb-dots"
                title={`Чек-лист: ${app.checklist.filter(c => c.done).length} из ${app.checklist.length}`}
              >
                {app.checklist.map(item => <i key={item.key} className={item.done ? 'is-done' : ''} />)}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function statusTone(status) {
  if (status === 'launched') return 'ok';
  if (status === 'submitted' || status === 'revision') return 'warn';
  if (status === 'rejected' || status === 'cancelled') return 'muted';
  return 'info';
}
