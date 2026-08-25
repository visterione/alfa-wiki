/**
 * Карточка заявки.
 *
 * Разделена на вкладки: анкета, задачи, услуги, чек-лист и журнал. Одним
 * полотном в две колонки они не помещались — документ сжимался до половины
 * ширины, а журнал и услуги приходилось искать прокруткой.
 *
 * Что человек здесь увидит, решает бэкенд: анкета приходит уже урезанной под
 * его шаг. Маркетологу по бейджу СНИЛС не отдаётся вовсе, а не прячется
 * стилями — иначе достаточно открыть ответ запроса.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { X, Check, Circle, Paperclip, Printer, Search } from 'lucide-react';

import { onboarding as api, BASE_URL } from '../../services/api';
import ApplicationCV from './ApplicationCV';
import { Badge, dateTime, professionsText } from './bits';
import './Onboarding.css';

const TABS = [
  { key: 'cv', label: 'Анкета' },
  { key: 'tasks', label: 'Задачи' },
  { key: 'services', label: 'Услуги' },
  { key: 'checklist', label: 'Чек-лист' },
  { key: 'log', label: 'Журнал' },
];

export default function ApplicationCard({ applicationId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('cv');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null);
  const [note, setNote] = useState('');
  const [services, setServices] = useState(null);
  const [picker, setPicker] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.application(applicationId);
      setData(res);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось открыть заявку');
      onClose();
    }
  }, [applicationId, onClose]);

  useEffect(() => { load(); }, [load]);

  /**
   * Имя файла при печати браузер берёт из заголовка вкладки, и без этого все
   * анкеты сохранялись как «Альфа Вики.pdf». Меняем на время печати и
   * возвращаем обратно: на события печати браузер зовёт нас и при Ctrl+P.
   */
  useEffect(() => {
    const name = data?.application?.fullName;
    if (!name) return undefined;
    const original = document.title;
    const before = () => { document.title = `Анкета врача — ${name}`; };
    const after = () => { document.title = original; };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      document.title = original;
    };
  }, [data?.application?.fullName]);

  const act = async (fn, successText) => {
    setBusy(true);
    try {
      await fn();
      toast.success(successText);
      setMode(null);
      setNote('');
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  const complete = async (task, misUserId) => {
    setBusy(true);
    try {
      const { data: res } = await api.completeTask(task.id, { misUserId });
      if (res.ok === false) throw new Error(res.reason);
      toast.success('Задача закрыта');
      setPicker(null);
      await load();
      onChanged?.();
    } catch (error) {
      const payload = error.response?.data;
      const reason = payload?.reason || error.message || 'Не удалось закрыть задачу';
      // Сверка не сошлась — не тупик: предлагаем выбрать сотрудника руками.
      // Не находится он сплошь и рядом по бытовым причинам: фамилия записана с
      // другой буквой, специальность поставили не ту, завели в соседнюю клинику.
      if (task.stepKey === 'mis_account') {
        setPicker({ taskId: task.id, reason, list: payload?.candidates || null });
      }
      toast.error(reason);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;

  const app = data.application;
  const fileHref = (file) => `${BASE_URL}${file.url}${data.fileToken ? `?t=${data.fileToken}` : ''}`;
  const openTasks = data.tasks.filter(t => !t.completedAt).length;
  const doneChecks = data.checklist.filter(item => item.done).length;

  const counters = {
    tasks: openTasks || null,
    checklist: `${doneChecks}/${data.checklist.length}`,
  };

  return createPortal(
    <>
      <div className="onb-mask" onClick={onClose}>
        <div className="onb-modal" onClick={(e) => e.stopPropagation()}>
          <div className="onb-modal-head">
            <div className="onb-modal-ident">
              <div className="onb-modal-title">{app.fullName || 'Без имени'}</div>
              <div className="onb-sub">
                {professionsText(app.professions)}{data.medCenter ? ` · ${data.medCenter.name}` : ''}
              </div>
            </div>
            <button className="onb-close" onClick={onClose} aria-label="Закрыть">
              <X size={18} />
            </button>
          </div>

          <Timeline points={data.timeline} status={app.status} label={data.statusLabel} />

          <nav className="onb-modal-tabs" role="tablist">
            {TABS.map(item => (
              <button
                key={item.key}
                role="tab"
                aria-selected={tab === item.key}
                className={tab === item.key ? 'is-on' : ''}
                onClick={() => setTab(item.key)}
              >
                {item.label}
                {counters[item.key] && <span className="onb-tab-count">{counters[item.key]}</span>}
              </button>
            ))}
          </nav>

          <div className="onb-modal-body">
            {tab === 'cv' && (
              <>
                <div className="onb-toolbar">
                  <button className="onb-btn is-sm" onClick={() => window.print()}>
                    <Printer size={13} /> Печать
                  </button>
                </div>

                <ApplicationCV data={data} fileHref={fileHref} />

                {Boolean(app.files?.length) && (
                  <>
                    <div className="onb-sect">Файлы</div>
                    <div className="onb-files">
                      {app.files.map(file => (
                        <a key={file.id} href={fileHref(file)} target="_blank" rel="noreferrer">
                          <Paperclip size={13} /> {file.originalName || file.filename}
                        </a>
                      ))}
                    </div>
                  </>
                )}

                {data.permissions.canDecide && (
                  <>
                    <div className="onb-sect">Решение</div>
                    {mode && (
                      <textarea
                        className="onb-textarea"
                        autoFocus
                        placeholder={mode === 'revision' ? 'Что поправить' : 'Причина отклонения'}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    )}
                    <div className="onb-acts">
                      {!mode && (
                        <>
                          <button className="onb-btn is-primary" disabled={busy}
                            onClick={() => act(() => api.approve(app.id), 'Согласовано')}>
                            Согласовать
                          </button>
                          <button className="onb-btn" onClick={() => setMode('revision')}>На доработку</button>
                          <button className="onb-btn is-danger" onClick={() => setMode('reject')}>Отклонить</button>
                        </>
                      )}
                      {mode === 'revision' && (
                        <button className="onb-btn is-primary" disabled={busy || !note.trim()}
                          onClick={() => act(() => api.revision(app.id, { note }), 'Отправлено врачу')}>
                          Отправить
                        </button>
                      )}
                      {mode === 'reject' && (
                        <button className="onb-btn is-danger" disabled={busy || !note.trim()}
                          onClick={() => act(() => api.reject(app.id, { reason: note }), 'Отклонено')}>
                          Отклонить
                        </button>
                      )}
                      {mode && (
                        <button className="onb-btn" onClick={() => { setMode(null); setNote(''); }}>Отмена</button>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {tab === 'tasks' && (
              <>
                {data.tasks.map(task => (
                  <div
                    key={task.id}
                    className={`onb-task${task.overdue ? ' is-late' : ''}${task.completedAt ? ' is-done' : ''}`}
                  >
                    <div className="onb-task-head">
                      {task.completedAt
                        ? <Check size={14} strokeWidth={2.4} color="var(--success)" />
                        : <Circle size={14} strokeWidth={1.6} color="var(--border)" />}
                      <b>{task.title}</b>
                      {!task.completedAt && task.dueAt && (
                        <span className="onb-when">{dateTime(task.dueAt)}</span>
                      )}
                    </div>

                    {task.completedAt && task.completer && (
                      <div className="onb-sub">
                        {task.completer.displayName}
                        {task.verifiedByMis ? ' · сверено с МИС' : ''}
                      </div>
                    )}
                    {!task.completedAt && task.claimer && (
                      <div className="onb-sub">взял: {task.claimer.displayName}</div>
                    )}

                    {!task.completedAt && task.mine && (
                      <div className="onb-acts">
                        {task.mode === 'race' && !task.claimedBy && (
                          <button className="onb-btn is-sm" disabled={busy}
                            onClick={() => act(() => api.claimTask(task.id), 'Задача за вами')}>
                            Взять
                          </button>
                        )}
                        {task.verify === 'mis' && (
                          <button className="onb-btn is-sm" disabled={busy}
                            onClick={async () => {
                              const { data: res } = await api.verifyTask(task.id, {});
                              if (res.ok) toast.success('Найдено в МИС');
                              else toast.error(res.reason);
                            }}>
                            Сверить с МИС
                          </button>
                        )}
                        <button className="onb-btn is-sm is-primary" disabled={busy} onClick={() => complete(task)}>
                          Готово
                        </button>
                      </div>
                    )}

                    {picker?.taskId === task.id && (
                      <MisPicker
                        applicationId={app.id}
                        reason={picker.reason}
                        candidates={picker.list}
                        busy={busy}
                        onPick={(misUserId) => complete(task, misUserId)}
                        onClose={() => setPicker(null)}
                      />
                    )}
                  </div>
                ))}
                {!data.tasks.length && <div className="onb-empty">Задач ещё нет</div>}
              </>
            )}

            {tab === 'services' && (
              <ServicesTab
                applicationId={app.id}
                services={services}
                onLoad={setServices}
              />
            )}

            {tab === 'checklist' && (
              <>
                <ul className="onb-check">
                  {data.checklist.map(item => (
                    <li key={item.key} className={item.done ? 'is-done' : ''}>
                      {item.done
                        ? <Check size={15} strokeWidth={2.4} color="var(--success)" />
                        : <Circle size={15} strokeWidth={1.6} color="var(--border)" />}
                      {item.title}
                    </li>
                  ))}
                </ul>

                {data.permissions.canManage && !['cancelled', 'rejected'].includes(app.status) && (
                  <div className="onb-acts" style={{ marginTop: 22 }}>
                    <button className="onb-btn is-danger is-sm"
                      onClick={() => {
                        const reason = window.prompt('Причина отмены процесса');
                        if (reason?.trim()) act(() => api.cancel(app.id, { reason }), 'Процесс отменён');
                      }}>
                      Отменить процесс
                    </button>
                  </div>
                )}
              </>
            )}

            {tab === 'log' && (
              <ul className="onb-log">
                {data.events.map(event => (
                  <li key={event.id}>
                    <time>{dateTime(event.createdAt)}</time>
                    <span>
                      {eventLabel(event, data.tasks)}
                      {event.author ? ` — ${event.author.displayName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Печатный слой — соседом маски, а не внутри неё: при печати всё, кроме
          него, скрывается правилом `body > *:not(.onb-print-root)`, и вложенный
          документ пропадал бы вместе с модалкой. */}
      <div className="onb-print-root">
        <ApplicationCV data={data} fileHref={fileHref} />
      </div>
    </>,
    document.body
  );
}

/**
 * Лента процесса. Заменила бейдж стадии: бейдж отвечал только «где сейчас», а
 * ленту читают целиком — сколько позади и сколько ещё.
 */
function Timeline({ points = [], status, label }) {
  const off = ['rejected', 'cancelled', 'revision'].includes(status);
  return (
    <div className={`onb-timeline${off ? ' is-off' : ''}`}>
      {points.map(point => (
        <div className={`onb-tl-point is-${point.state}`} key={point.key}>
          <i />
          <span>{point.label}</span>
        </div>
      ))}
      {off && <Badge tone={status === 'revision' ? 'warn' : 'bad'}>{label}</Badge>}
    </div>
  );
}

/**
 * Выбор сотрудника МИС руками. Появляется только когда сверка не сошлась —
 * иначе это лишняя кнопка на каждом шаге.
 */
function MisPicker({ applicationId, reason, candidates, busy, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [list, setList] = useState(candidates || null);
  const [loading, setLoading] = useState(false);

  const search = async (value) => {
    setLoading(true);
    try {
      const { data } = await api.misUsers(applicationId, value);
      setList(data);
    } catch (error) {
      toast.error(error.response?.data?.error || 'МИС не ответила');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (!candidates) search(''); /* eslint-disable-next-line */ }, []);

  const shown = (list || []).filter(user =>
    !query || user.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="onb-picker">
      <div className="onb-picker-why">{reason}</div>

      <div className="onb-picker-search">
        <Search size={13} />
        <input
          className="onb-input"
          value={query}
          placeholder="Найти сотрудника в МИС"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && <div className="onb-sub">Спрашиваем МИС…</div>}

      <div className="onb-picker-list">
        {shown.map(user => (
          <button key={user.id} type="button" disabled={busy} onClick={() => onPick(user.id)}>
            <span>
              {user.name}
              {Boolean(user.professions?.length) && <small>{user.professions.join(', ')}</small>}
            </span>
          </button>
        ))}
        {!loading && !shown.length && <div className="onb-sub">Никого не нашлось</div>}
      </div>

      <button className="onb-btn is-sm" onClick={onClose}>Отмена</button>
    </div>
  );
}

/**
 * Бухгалтеру важен не весь список, а расхождения: где врач изменил длительность
 * или оставил комментарий. Их немного, и разбирать нужно только их.
 */
function ServicesTab({ applicationId, services, onLoad }) {
  if (!services) {
    return (
      <button className="onb-btn is-sm"
        onClick={async () => {
          try {
            const { data: res } = await api.services(applicationId);
            onLoad(res);
          } catch {
            toast.error('Не удалось загрузить услуги');
          }
        }}>
        Показать выбор врача
      </button>
    );
  }

  return (
    <>
      <div className="onb-kv" style={{ marginBottom: 14 }}>
        <dt>Отмечено услуг</dt><dd>{services.total}</dd>
      </div>

      {Boolean(services.differences.length) && (
        <>
          <div className="onb-sect">Расхождения</div>
          <ul className="onb-log">
            {services.differences.map(item => (
              <li key={item.id}>
                <span>
                  {item.title}
                  {item.doctorDuration && item.doctorDuration !== item.misDuration
                    ? ` · ${item.misDuration ?? '—'} → ${item.doctorDuration} мин`
                    : ''}
                  {item.comment ? ` · ${item.comment}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {Boolean(services.custom.length) && (
        <>
          <div className="onb-sect">Нет в справочнике</div>
          <ul className="onb-log">
            {services.custom.map(item => <li key={item.id}><span>{item.title}</span></li>)}
          </ul>
        </>
      )}

      {!services.differences.length && !services.custom.length && (
        <div className="onb-sub">Врач ничего не менял — список совпадает с прайсом.</div>
      )}
    </>
  );
}

const EVENTS = {
  created: 'Заявка создана',
  submitted: 'Отправлена на согласование',
  approved: 'Согласована',
  revision: 'Возвращена на доработку',
  rejected: 'Отклонена',
  mis_created: 'Пользователь создан в «Реновации»',
  task_opened: 'Задача поставлена',
  task_claimed: 'Задача взята',
  task_completed: 'Задача закрыта',
  task_unassigned: 'Задача без исполнителя',
  chief_unassigned: 'Не назначен главврач филиала',
  doctor_services_invited: 'Врачу отправлен список услуг',
  services_picked: 'Врач отметил услуги',
  durations_applied: 'Длительности перенесены в настройки врача',
  launched: 'Врач запущен',
  cancelled: 'Процесс отменён',
  medcenter_changed: 'Сменён филиал',
  sla_reminded: 'Напоминание о просрочке',
  sla_escalated: 'Эскалация просрочки',
};

function eventLabel(event, tasks = []) {
  const base = EVENTS[event.action] || event.action;
  const step = event.payload?.stepKey;
  if (!step) return base;
  const title = tasks.find(task => task.stepKey === step)?.title || step;
  return `${base}: ${title}`;
}
