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
import { X, Check, Circle, Download, Search } from 'lucide-react';

import { onboarding as api, BASE_URL } from '../../services/api';
import ApplicationCV from './ApplicationCV';
import FilesTab from './FilesTab';
import JournalTab from './JournalTab';
import { Badge, dateTime, professionsText } from './bits';
import './Onboarding.css';

const TABS = [
  { key: 'cv', label: 'Анкета' },
  { key: 'files', label: 'Файлы' },
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

  // Услуги грузим при переходе на вкладку, а не по кнопке: кнопка «показать»
  // была лишним нажатием перед единственным, что вкладка умеет.
  useEffect(() => {
    if (tab !== 'services' || services) return;
    let cancelled = false;
    api.services(applicationId)
      .then(({ data: res }) => { if (!cancelled) setServices(res); })
      .catch(() => { if (!cancelled) setServices({ error: true }); });
    return () => { cancelled = true; };
  }, [tab, services, applicationId]);

  /**
   * Скачивание анкеты. Идём за файлом с токеном сессии и сохраняем из памяти:
   * обычная ссылка ушла бы без заголовка Authorization и вернула 401.
   */
  const download = async () => {
    setBusy(true);
    try {
      const response = await api.cvPdf(applicationId);
      const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Анкета врача — ${data.application.fullName || 'без имени'}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Safari успевает забрать blob только после возврата управления браузеру.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      toast.error('Не удалось собрать файл');
    } finally {
      setBusy(false);
    }
  };

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
    files: app.files?.length || null,
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
                  <button className="onb-btn is-sm" onClick={download} disabled={busy}>
                    <Download size={13} /> Скачать
                  </button>
                </div>

                <ApplicationCV data={data} fileHref={fileHref} />

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

            {tab === 'files' && <FilesTab files={app.files} fileHref={fileHref} />}

            {tab === 'services' && <ServicesTab data={services} />}

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

            {tab === 'log' && <JournalTab events={data.events} tasks={data.tasks} />}
          </div>
        </div>
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

  // Поле ищет на сервере, а не только внутри первых загруженных строк. Без
  // этого сотрудника за пределами начальной шестидесятки нельзя было выбрать.
  useEffect(() => {
    if (!query.trim() && candidates) {
      setList(candidates);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.misUsers(applicationId, query.trim());
        if (!cancelled) setList(data);
      } catch (error) {
        if (!cancelled) toast.error(error.response?.data?.error || 'МИС не ответила');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query.trim() ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applicationId, candidates, query]);

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
function ServicesTab({ data: services }) {
  if (!services) return <div className="onb-sub">Загружаем…</div>;
  if (services.error) return <div className="onb-empty">Не удалось загрузить услуги</div>;
  if (!services.total && !services.custom.length) {
    return <div className="onb-empty">Врач ещё не отмечал услуги</div>;
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
