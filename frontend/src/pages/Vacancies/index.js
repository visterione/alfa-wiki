/**
 * Вакансии (ver. 8.20, переработано в 8.21) — оболочка раздела.
 *
 * Второе поколение онбординга. Устроен как онбординг и «Задачи»: слева разделы,
 * справа полотно, один маршрут, экран переключается параметром ?screen= — чтобы
 * ссылка на конкретный экран оставалась рабочей.
 *
 * Экранов две группы, и это не косметика. Сверху ежедневная работа — задачи и
 * заявки: её видит и тот, кто просто назначен исполнителем шага. Ниже
 * настройка — вакансии, шаблоны и QR-коды: она только для админа, и у остальных
 * этих пунктов нет вовсе, а не «есть, но с замком».
 *
 * Старый раздел онбординга остаётся рядом и работает: заявки идут через него,
 * пока здесь не появится всё то же самое. Его кнопка в сайдбаре помечена
 * «(старый)».
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Briefcase, QrCode, Inbox, FileText, Archive, Plus, Copy, X } from 'lucide-react';

import { vacancies as api } from '../../services/api';
import VacancyEditor from './VacancyEditor';
import TemplateEditor from './TemplateEditor';
import ApplicationCard from './ApplicationCard';
import './Vacancies.css';

const SCREENS = [
  { key: 'tasks', label: 'Мои задачи', icon: Inbox },
  { key: 'apps', label: 'Заявки', icon: FileText },
  { key: 'archive', label: 'Архив', icon: Archive },
  { group: 'Настройка' },
  { key: 'list', label: 'Вакансии', icon: Briefcase, adminOnly: true },
  { key: 'templates', label: 'Шаблоны', icon: Copy, adminOnly: true },
  // До ver. 8.34 пункт назывался «Таблички филиалов» — по тому, что из него
  // печатали. Печатают по-прежнему таблички, но ищут в меню QR-код.
  { key: 'qr', label: 'QR-коды', icon: QrCode, adminOnly: true },
];

export default function Vacancies() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('screen');
  const screen = SCREENS.some(s => s.key === requested) ? requested : 'tasks';

  const [tasks, setTasks] = useState([]);
  const [apps, setApps] = useState([]);
  const [archive, setArchive] = useState([]);
  const [list, setList] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [medCenters, setMedCenters] = useState([]);
  const [meta, setMeta] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const navRef = useRef(null);
  const [navIndicator, setNavIndicator] = useState({ top: 0, height: 36, ready: false });

  // Открытые вакансия и заявка живут в адресе: ссылку можно кинуть коллеге, а
  // уведомление о задаче ведёт сразу в нужную заявку, а не в список.
  const openVacancyId = params.get('vacancy');
  const openTemplateId = params.get('template');
  const openAppId = params.get('app');

  // Диалог создания вакансии: название, филиал и — необязательно — шаблон.
  const [creating, setCreating] = useState(false);

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
        const [v, t, mc, m] = await Promise.all([
          api.openings(), api.templates(), api.medCenters(), api.meta()
        ]);
        setList(v.data || []);
        setTemplates(t.data || []);
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

  /**
   * Новая вакансия.
   *
   * Спрашиваем три вещи: название, филиал и шаблон. Остальное — анкета, процесс,
   * письма — правится в самом редакторе, и вываливать это в диалог создания
   * значит заставить человека решать всё до того, как он увидел экран.
   *
   * До ver. 8.34 это была цепочка window.prompt с филиалами, пронумерованными
   * в тексте. Третий вопрос в такую цепочку уже не влезал.
   */
  const openCreate = () => {
    if (!medCenters.some(mc => mc.code)) {
      toast.error('Ни у одного филиала не заполнен латинский код — без него ссылку не построить');
      return;
    }
    setCreating(true);
  };

  const createVacancy = async (payload) => {
    try {
      const { data } = await api.createOpening(payload);
      setCreating(false);
      await load();
      setParam('vacancy', data.id);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось создать вакансию');
    }
  };

  /**
   * Новый шаблон. Здесь одного вопроса достаточно: филиала у шаблона нет, а
   * заводить шаблон по шаблону незачем — для этого есть «Сохранить как шаблон»
   * в готовой вакансии.
   */
  const createTemplate = async () => {
    const title = window.prompt('Название шаблона — «Врач», «Медицинская сестра»');
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
    list: list.length, templates: templates.length, qr: 0
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
            {screen === 'list' && !openVacancyId && isAdmin && (
              <button className="vac-btn" onClick={openCreate}><Plus size={15} />Новая вакансия</button>
            )}
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

            {!loading && screen === 'list' && isAdmin && openVacancyId && meta && (
              <VacancyEditor
                vacancyId={openVacancyId}
                meta={meta}
                onBack={() => setParam('vacancy', null)}
                onChanged={load}
              />
            )}

            {!loading && screen === 'list' && isAdmin && !openVacancyId && (
              <VacancyList list={list} onOpen={id => setParam('vacancy', id)} onCreate={openCreate} />
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
              <TemplateList list={templates} onOpen={id => setParam('template', id)} onCreate={createTemplate} />
            )}

            {!loading && screen === 'qr' && isAdmin && <QrScreen medCenters={medCenters} list={list} />}
          </div>
        </div>
      </div>

      {creating && (
        <NewVacancyDialog
          medCenters={medCenters}
          templates={templates}
          onCancel={() => setCreating(false)}
          onCreate={createVacancy}
        />
      )}

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
            <td className="vac-sub">{app.vacancy?.title}<br />{app.medCenter?.name}</td>
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
 * Список вакансий.
 *
 * Размеры анкеты и процесса («14 блоков, 10 шагов») стоят рядом с названием
 * потому, что по ним и узнают вакансию в списке: «Врач-терапевт» сам по себе
 * ничего не говорит о том, доделана она или пуста.
 */
const STATUS_LABEL = { draft: 'Черновик', open: 'Набор открыт', closed: 'Набор закрыт' };
const STATUS_TONE = { draft: 'muted', open: 'ok', closed: 'warn' };

function VacancyList({ list, onOpen, onCreate }) {
  if (!list.length) {
    return (
      <div className="vac-empty">
        Вакансий ещё нет.<br />
        <button className="vac-btn is-ghost" onClick={onCreate}>Завести первую</button>
      </div>
    );
  }

  return (
    <table className="vac-table">
      <thead>
        <tr><th>Вакансия</th><th>Филиал</th><th>Анкета</th><th>Откликов</th><th>Состояние</th></tr>
      </thead>
      <tbody>
        {list.map(v => (
          <tr key={v.id} className="is-clickable" onClick={() => onOpen(v.id)}>
            <td>
              <div className="vac-name">{v.title}</div>
              {v.description && <div className="vac-sub">{v.description}</div>}
            </td>
            <td className="vac-sub">{v.medCenter?.name || '—'}</td>
            <td className="vac-sub">{v.blockCount} блоков · {v.stepCount} шагов</td>
            <td className="vac-sub">{v.applicationCount || '—'}</td>
            <td>
              <span className={`vac-badge vac-badge-${STATUS_TONE[v.status]}`}>
                {STATUS_LABEL[v.status]}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Список шаблонов.
 *
 * Шаблон — заготовка должности: анкета, процесс и письма, с которых начинается
 * вакансия. Рядом с названием стоят размеры анкеты: по ним шаблон и узнают,
 * «Врач» сам по себе не говорит, собран он или пуст.
 */
function TemplateList({ list, onOpen, onCreate }) {
  if (!list.length) {
    return (
      <div className="vac-empty">
        Шаблонов ещё нет. Если анкета уже собрана в какой-то вакансии — откройте
        её и нажмите «Сохранить как шаблон».<br />
        <button className="vac-btn is-ghost" onClick={onCreate}>Завести первый</button>
      </div>
    );
  }

  return (
    <table className="vac-table">
      <thead>
        <tr><th>Шаблон</th><th>Анкета</th><th>Процесс</th><th>Изменён</th></tr>
      </thead>
      <tbody>
        {list.map(t => (
          <tr key={t.id} className="is-clickable" onClick={() => onOpen(t.id)}>
            <td>
              <div className="vac-name">{t.title}</div>
              {t.description && <div className="vac-sub">{t.description}</div>}
            </td>
            <td className="vac-sub">{t.blockCount} блоков · {t.fieldCount} полей</td>
            <td className="vac-sub">{t.stepCount} шагов</td>
            <td className="vac-sub">
              {new Date(t.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
              {t.author ? `, ${t.author.displayName}` : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Диалог создания вакансии.
 *
 * Шаблон здесь необязателен и ни к чему не привязывает: вакансия получает копию
 * анкеты, процесса и писем и дальше живёт сама по себе. Поэтому «с нуля»
 * остаётся первым пунктом списка — это не запасной путь, а равноправный.
 */
function NewVacancyDialog({ medCenters, templates, onCancel, onCreate }) {
  // Филиал без латинского кода показывать незачем: из него не построить ни
  // ссылку, ни QR, и выбор такого закончился бы отказом сервера.
  const usable = medCenters.filter(mc => mc.code);

  const [title, setTitle] = useState('');
  const [medCenterId, setMedCenterId] = useState(usable[0]?.id || '');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);

  const chosen = templates.find(t => t.id === templateId);
  const ready = Boolean(title.trim() && medCenterId);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onCreate({
        title: title.trim(),
        medCenterId,
        templateId: templateId || undefined
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vac-overlay" onClick={onCancel}>
      <div className="vac-card is-narrow" onClick={e => e.stopPropagation()}>
        <div className="vac-card-head">
          <div><h2>Новая вакансия</h2></div>
          <button className="vac-icon" onClick={onCancel} title="Закрыть"><X size={18} /></button>
        </div>

        <div className="vac-card-body">
          <label className="vac-lab is-wide">
            Название
            <input
              className="vac-input"
              autoFocus
              value={title}
              placeholder="«Врач-терапевт», «Медицинская сестра»"
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            />
          </label>

          <label className="vac-lab is-wide">
            Филиал
            <select className="vac-input" value={medCenterId} onChange={e => setMedCenterId(e.target.value)}>
              {usable.map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
            </select>
          </label>

          <label className="vac-lab is-wide">
            Шаблон
            <select className="vac-input" value={templateId} onChange={e => setTemplateId(e.target.value)}>
              <option value="">— собрать с нуля —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>

          <div className="vac-hint">
            {chosen
              ? `Копией приедут анкета (${chosen.blockCount} бл., ${chosen.fieldCount} пол.), процесс и письма.`
              : 'Заведётся заготовка: блок с ФИО и шаг решения.'}
          </div>

          <div className="vac-editor-acts">
            <button className="vac-btn" disabled={!ready || busy} onClick={submit}>
              {busy ? 'Заводим…' : 'Создать'}
            </button>
            <button className="vac-btn is-ghost" disabled={busy} onClick={onCancel}>Отмена</button>
          </div>
        </div>
      </div>
    </div>
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
    if (v.status !== 'open' || !v.medCenter) continue;
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
