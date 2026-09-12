/**
 * Вакансии (ver. 8.20) — оболочка раздела.
 *
 * Второе поколение онбординга. Устроен как онбординг и «Задачи»: слева разделы,
 * справа полотно, один маршрут, экран переключается параметром ?screen= — чтобы
 * ссылка на конкретный экран оставалась рабочей.
 *
 * Экранов две группы, и это не косметика. Сверху ежедневная работа — задачи и
 * заявки: её видит и тот, кто просто назначен исполнителем шага. Ниже
 * настройка — шаблоны, вакансии, ссылки: она только для админа, и у остальных
 * этих пунктов нет вовсе, а не «есть, но с замком».
 *
 * Старый раздел онбординга остаётся рядом и работает: заявки идут через него,
 * пока здесь не появится всё то же самое. Его кнопка в сайдбаре помечена
 * «(старый)».
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileStack, Briefcase, QrCode, Inbox, FileText, Archive, Plus } from 'lucide-react';

import { vacancies as api } from '../../services/api';
import TemplateEditor from './TemplateEditor';
import OpeningsScreen from './OpeningsScreen';
import ApplicationCard from './ApplicationCard';
import './Vacancies.css';

const SCREENS = [
  { key: 'tasks', label: 'Мои задачи', icon: Inbox },
  { key: 'apps', label: 'Заявки', icon: FileText },
  { key: 'archive', label: 'Архив', icon: Archive },
  { group: 'Настройка' },
  { key: 'templates', label: 'Шаблоны', icon: FileStack, adminOnly: true },
  { key: 'list', label: 'Вакансии', icon: Briefcase, adminOnly: true },
  { key: 'qr', label: 'Ссылки и QR', icon: QrCode, adminOnly: true },
];

export default function Vacancies() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('screen');
  const screen = SCREENS.some(s => s.key === requested) ? requested : 'tasks';

  const [tasks, setTasks] = useState([]);
  const [apps, setApps] = useState([]);
  const [archive, setArchive] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [list, setList] = useState([]);
  const [medCenters, setMedCenters] = useState([]);
  const [meta, setMeta] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const navRef = useRef(null);
  const [navIndicator, setNavIndicator] = useState({ top: 0, height: 36, ready: false });

  // Открытые шаблон и заявка живут в адресе: ссылку можно кинуть коллеге, а
  // уведомление о задаче ведёт сразу в нужную заявку, а не в список.
  const openTemplateId = params.get('template');
  const openAppId = params.get('app');

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: key === 'app' });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const overview = await api.overview();
      const admin = Boolean(overview.data.canConfigure);
      setIsAdmin(admin);

      const [my, active, old] = await Promise.all([
        api.myTasks(),
        api.applications({ archived: 'false' }),
        api.applications({ archived: 'true' })
      ]);
      setTasks(my.data || []);
      setApps(active.data || []);
      setArchive(old.data || []);

      // Настройка грузится только тому, кому она доступна: остальным эти
      // запросы вернули бы 403 и насорили в консоли.
      if (admin) {
        const [t, v, mc, m] = await Promise.all([
          api.templates(), api.list(), api.medCenters(), api.meta()
        ]);
        setTemplates(t.data || []);
        setList(v.data || []);
        setMedCenters(mc.data || []);
        setMeta(m.data || null);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось загрузить раздел');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Новая задача, её захват коллегой или закрытие шага отражаются на уже
  // открытом экране без перезагрузки. Небольшая задержка схлопывает несколько
  // событий одного перехода процесса в один запрос.
  useEffect(() => {
    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 120); };
    window.addEventListener('vacancies-changed', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('vacancies-changed', refresh); };
  }, [load]);

  const createTemplate = async () => {
    const title = window.prompt('Название должности — «Медсестра», «Техничка»');
    if (!title?.trim()) return;
    try {
      const { data } = await api.createTemplate({ title: title.trim() });
      await load();
      setParam('template', data.id);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось создать шаблон');
    }
  };

  // Подсветка активного пункта — отдельный слой под кнопками, и её положение
  // приходится измерять. Пересчёт после загрузки обязателен: до неё пунктов
  // настройки в меню ещё нет, и панель станет выше.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const update = () => {
      const active = nav.querySelector('button.is-on');
      if (!active) return;
      setNavIndicator({ top: active.offsetTop, height: active.offsetHeight, ready: true });
    };
    update();
    const observer = typeof window.ResizeObserver === 'undefined' ? null : new window.ResizeObserver(update);
    observer?.observe(nav);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, [screen, loading, isAdmin]);

  const go = (key) => setParams(key === 'tasks' ? {} : { screen: key }, { replace: true });

  const counts = {
    tasks: tasks.length, apps: apps.length, archive: 0,
    templates: templates.length, list: list.length, qr: 0
  };

  return (
    <div className="vac">
      <div className="vac-shell">
        <aside className="vac-side">
          <div className="vac-side-brand"><span>Вакансии</span></div>

          <nav
            className={`vac-nav ${navIndicator.ready ? 'is-ready' : ''}`}
            ref={navRef}
            style={{ '--vac-nav-top': `${navIndicator.top}px`, '--vac-nav-height': `${navIndicator.height}px` }}
          >
            {SCREENS.map((item, index) => {
              if (item.group) return isAdmin ? <div className="vac-nav-group" key={`g${index}`}>{item.group}</div> : null;
              if (item.adminOnly && !isAdmin) return null;
              const Icon = item.icon;
              const count = counts[item.key];
              return (
                <button key={item.key} className={screen === item.key ? 'is-on' : ''} onClick={() => go(item.key)}>
                  <Icon size={16} />
                  {item.label}
                  {count > 0 && <span className="vac-nav-count">{count}</span>}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="vac-main">
          <div className="vac-top">
            <div className="vac-title">{SCREENS.find(s => s.key === screen)?.label}</div>
            {screen === 'templates' && !openTemplateId && isAdmin && (
              <button className="vac-btn" onClick={createTemplate}><Plus size={15} />Новый шаблон</button>
            )}
          </div>

          <div className="vac-content">
            {loading && <div className="vac-empty">Загружаем…</div>}

            {!loading && screen === 'tasks' && (
              tasks.length
                ? <TaskTable tasks={tasks} onOpen={id => setParam('app', id)} />
                : <div className="vac-empty">Задач нет.</div>
            )}

            {!loading && screen === 'apps' && (
              apps.length
                ? <AppTable apps={apps} onOpen={id => setParam('app', id)} />
                : <div className="vac-empty">Активных заявок нет.</div>
            )}

            {!loading && screen === 'archive' && (
              archive.length
                ? <AppTable apps={archive} onOpen={id => setParam('app', id)} />
                : <div className="vac-empty">Архив пуст.</div>
            )}

            {!loading && screen === 'templates' && isAdmin && openTemplateId && meta && (
              <TemplateEditor
                templateId={openTemplateId}
                meta={meta}
                onBack={() => setParam('template', null)}
                onChanged={load}
              />
            )}

            {!loading && screen === 'templates' && isAdmin && !openTemplateId && (
              <TemplatesScreen templates={templates} onOpen={id => setParam('template', id)} onCreate={createTemplate} />
            )}

            {!loading && screen === 'list' && isAdmin && (
              <OpeningsScreen list={list} templates={templates} medCenters={medCenters} onChanged={load} />
            )}

            {!loading && screen === 'qr' && isAdmin && <QrScreen medCenters={medCenters} list={list} />}
          </div>
        </div>
      </div>

      {openAppId && (
        <ApplicationCard
          applicationId={openAppId}
          onClose={() => setParam('app', null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/** Мои задачи: что ждёт именно меня, с ближайшим сроком сверху. */
function TaskTable({ tasks, onOpen }) {
  return (
    <table className="vac-table">
      <thead>
        <tr><th>Что сделать</th><th>Вакансия</th><th /><th>Срок</th></tr>
      </thead>
      <tbody>
        {tasks.map(task => (
          <tr
            key={task.id}
            className={`is-clickable${task.overdue ? ' is-late' : ''}`}
            onClick={() => onOpen(task.applicationId)}
          >
            <td>
              <div className="vac-name">{task.title}</div>
              <div className="vac-sub">{task.fullName || 'без имени'}</div>
            </td>
            <td className="vac-sub">{task.vacancy || '—'}<br />{task.medCenter || ''}</td>
            <td>
              {task.requiresClaim && !task.claimedBy && (
                <span className="vac-badge vac-badge-info">общая · нужно взять</span>
              )}
            </td>
            <td className={task.overdue ? 'vac-late' : 'vac-sub'}>
              {task.overdue
                ? `просрочка ${task.overdueHours} ч`
                : task.dueAt
                  ? new Date(task.dueAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                  : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Список заявок.
 *
 * Вместо стадии — прогресс по чек-листу точками и перечень открытых шагов:
 * именованных стадий во втором поколении нет, при произвольном процессе они
 * врут.
 */
function AppTable({ apps, onOpen }) {
  return (
    <table className="vac-table">
      <thead>
        <tr><th>Кандидат</th><th>Вакансия</th><th>Сейчас</th><th>Готовность</th></tr>
      </thead>
      <tbody>
        {apps.map(app => (
          <tr
            key={app.id}
            className={`is-clickable${app.overdue ? ' is-late' : ''}`}
            onClick={() => onOpen(app.id)}
          >
            <td>
              <div className="vac-name">{app.fullName || 'без имени'}</div>
              <div className="vac-sub">{app.phone || app.email}</div>
            </td>
            <td className="vac-sub">{app.vacancy?.title || app.template?.title}<br />{app.medCenter?.name}</td>
            <td className="vac-sub">
              {app.status === 'submitted' && 'на согласовании'}
              {app.status === 'revision' && 'у кандидата на доработке'}
              {app.status === 'draft' && 'заполняется'}
              {app.status === 'launched' && 'запущен'}
              {app.status === 'rejected' && 'отказ'}
              {app.status === 'cancelled' && 'отменена'}
              {app.status === 'in_progress' && (app.open.length ? app.open.join(', ') : 'все шаги закрыты')}
            </td>
            <td>
              <div className="vac-dots" title={`Чек-лист: ${app.done} из ${app.total}`}>
                {app.checklist.map(item => <i key={item.key} className={item.done ? 'is-done' : ''} />)}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Шаблоны — анкета плюс процесс под одну должность.
 *
 * Размеры («14 блоков, 10 шагов») показываются, потому что по ним и узнают
 * шаблон в списке: названия «Врач» и «Медсестра» сами по себе ничего не говорят
 * о том, доделан он или пуст.
 */
function TemplatesScreen({ templates, onOpen, onCreate }) {
  if (!templates.length) {
    return (
      <div className="vac-empty">
        Шаблонов ещё нет.<br />
        <button className="vac-btn is-ghost" onClick={onCreate}>Собрать первый</button>
      </div>
    );
  }

  return (
    <table className="vac-table">
      <thead>
        <tr><th>Должность</th><th>Анкета</th><th>Процесс</th><th>Вакансий</th><th>Состояние</th></tr>
      </thead>
      <tbody>
        {templates.map(t => (
          <tr key={t.id} className="is-clickable" onClick={() => onOpen(t.id)}>
            <td>
              <div className="vac-name">{t.title}</div>
              {t.description && <div className="vac-sub">{t.description}</div>}
            </td>
            <td className="vac-sub">{t.blockCount} блоков</td>
            <td className="vac-sub">{t.stepCount} шагов</td>
            <td className="vac-sub">{t.vacancyCount || '—'}</td>
            <td>
              {t.isPublished
                ? <span className="vac-badge vac-badge-ok">Опубликован</span>
                : <span className="vac-badge vac-badge-muted">Черновик</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Ссылки, на которые вешаются QR-коды.
 *
 * У каждого медцентра свой адрес: человек приходит по нему и видит вакансии
 * только этого филиала. Адрес строится из MedCenter.code — латинского
 * идентификатора, который не меняется при переименовании клиники.
 *
 * Экран показывает и филиалы без кода: без него ссылку строить не из чего, и
 * узнать об этом нужно до того, как кто-то распечатает табличку.
 */
function QrScreen({ medCenters, list }) {
  const [shown, setShown] = useState(null);
  const [materials, setMaterials] = useState(null);

  const openByMc = new Map();
  for (const v of list) {
    if (!v.isOpen || !v.medCenter) continue;
    openByMc.set(v.medCenter.id, (openByMc.get(v.medCenter.id) || 0) + 1);
  }

  const show = async (mc) => {
    if (shown === mc.code) { setShown(null); setMaterials(null); return; }
    setShown(mc.code);
    setMaterials(null);
    try {
      const { data } = await api.materials(mc.code);
      setMaterials(data);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось собрать QR');
      setShown(null);
    }
  };

  return (
    <>
      <table className="vac-table">
        <thead>
          <tr><th>Филиал</th><th>Адрес для QR</th><th>Открытых вакансий</th><th /></tr>
        </thead>
        <tbody>
          {medCenters.map(mc => (
            <tr key={mc.id}>
              <td><div className="vac-name">{mc.name}</div></td>
              <td>
                {mc.code
                  ? <span className="vac-link">{window.location.origin}/vacancy/{mc.code}</span>
                  : <span className="vac-badge vac-badge-warn">Нет кода филиала</span>}
              </td>
              <td className="vac-sub">{openByMc.get(mc.id) || '—'}</td>
              <td>
                {mc.code && (
                  <button className="vac-btn is-ghost" onClick={() => show(mc)}>
                    {shown === mc.code ? 'Скрыть' : 'Показать QR'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {shown && (
        <div className="vac-qr">
          {!materials && <div className="vac-sub">Собираем…</div>}
          {materials && (
            <>
              <img src={materials.qrPng} alt={`QR филиала ${materials.branch.name}`} />
              <div className="vac-qr-side">
                <b>{materials.branch.name}</b>
                <span className="vac-link">{materials.url}</span>
                <div className="vac-editor-acts">
                  <button
                    className="vac-btn is-ghost"
                    onClick={() => {
                      navigator.clipboard?.writeText(materials.url);
                      toast.success('Ссылка скопирована');
                    }}
                  >
                    Скопировать ссылку
                  </button>
                  {/* Для печати отдаём вектор: на бумаге растр с экранными
                      512 px выглядит мылом, а этот QR именно печатают. */}
                  <a
                    className="vac-btn is-ghost"
                    href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(materials.qrSvg)}`}
                    download={`vacancy-${materials.branch.code}.svg`}
                  >
                    Скачать для печати
                  </a>
                </div>
                {!materials.baseConfigured && (
                  <div className="vac-hint">
                    PUBLIC_BASE_URL на сервере не задан — адрес собран по
                    умолчанию. Печатать стоит после того, как его настроят.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
