/**
 * Карточка заявки.
 *
 * Что человек здесь увидит, решает бэкенд: анкета приходит уже урезанной под
 * его шаг, а подписи полей — из той же схемы, по которой рисуется сама анкета.
 * Маркетологу по бейджу СНИЛС не отдаётся вовсе, а не прячется стилями: иначе
 * достаточно открыть ответ запроса.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { X, Check, Circle, Paperclip, Printer } from 'lucide-react';

import { onboarding as api, BASE_URL } from '../../services/api';
import ApplicationCV from './ApplicationCV';
import { Badge, dateTime, professionsText } from './bits';
import './Onboarding.css';

export default function ApplicationCard({ applicationId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null);
  const [note, setNote] = useState('');
  const [services, setServices] = useState(null);
  const [candidates, setCandidates] = useState(null);

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
      setCandidates(null);
      await load();
      onChanged?.();
    } catch (error) {
      const payload = error.response?.data;
      // Не подтвердилось в МИС — показываем, что именно не нашлось.
      if (payload?.candidates) {
        setCandidates({ taskId: task.id, list: payload.candidates });
      }
      toast.error(payload?.reason || error.message || 'Не удалось закрыть задачу');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;

  const app = data.application;
  // «Задача закрыта» три раза подряд ничего не говорит — нужно, какая именно.
  // Названия шагов уже пришли вместе с задачами, второго справочника не заводим.
  const stepTitles = Object.fromEntries(data.tasks.map(t => [t.stepKey, t.title]));
  const fileHref = (file) => `${BASE_URL}${file.url}${data.fileToken ? `?t=${data.fileToken}` : ''}`;

  // Через портал в body: у .onb стоит isolation: isolate (как в «Задачах»), и
  // внутри него position: fixed считается от нового слоя — затемнение не
  // накрывало бы шапку и меню портала, а висело бы только над рабочей областью.
  return createPortal(
    <div className="onb-mask" onClick={onClose}>
      <div className="onb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="onb-modal-head">
          <div>
            <div className="onb-modal-title">
              №{app.number} · {app.fullName || 'без имени'}
            </div>
            <div className="onb-sub">
              {professionsText(app.professions)}{data.medCenter ? ` · ${data.medCenter.name}` : ''}
            </div>
          </div>
          <Badge tone={app.status === 'launched' ? 'ok' : 'info'}>{data.stage.label}</Badge>
          <button className="onb-close" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div className="onb-modal-body">
          <div className="onb-cols">
            <div>
              <div className="onb-sect">
                Анкета
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

              <div className="onb-sect">Журнал</div>
              <ul className="onb-log">
                {data.events.slice(0, 20).map(event => (
                  <li key={event.id}>
                    <time>{dateTime(event.createdAt)}</time>
                    <span>
                      {eventLabel(event, stepTitles)}
                      {event.author ? ` — ${event.author.displayName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="onb-sect">Чек-лист запуска</div>
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

              <div className="onb-sect">Задачи</div>
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

                  {candidates?.taskId === task.id && (
                    <div className="onb-acts">
                      {candidates.list.map(candidate => (
                        <button key={candidate.id} className="onb-btn is-sm"
                          onClick={() => complete(task, candidate.id)}>
                          {candidate.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <div className="onb-sect">Услуги</div>
              {!services ? (
                <button className="onb-btn is-sm"
                  onClick={async () => {
                    try {
                      const { data: res } = await api.services(app.id);
                      setServices(res);
                    } catch {
                      toast.error('Не удалось загрузить услуги');
                    }
                  }}>
                  Показать выбор врача
                </button>
              ) : (
                <ServiceSummary services={services} />
              )}

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
            </div>
          </div>
        </div>
      </div>
      {/* Печатный слой. Отдельная копия документа прямо в body: печатать саму
          модалку значило бы бороться с её прокруткой, размытием и фиксированной
          высотой. На экране слой скрыт, при печати скрыто всё остальное. */}
      <div className="onb-print-root">
        <ApplicationCV data={data} fileHref={fileHref} />
      </div>
    </div>,
    document.body
  );
}

/**
 * Бухгалтеру важен не весь список, а расхождения: где врач изменил длительность
 * или оставил комментарий. Их немного, и разбирать нужно только их.
 */
function ServiceSummary({ services }) {
  return (
    <div>
      <div className="onb-kv" style={{ marginBottom: 10 }}>
        <dt>Отмечено</dt><dd>{services.total}</dd>
      </div>

      {Boolean(services.differences.length) && (
        <>
          <div className="onb-sub" style={{ marginBottom: 6 }}>Расхождения</div>
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
          <div className="onb-sub" style={{ margin: '10px 0 6px' }}>Нет в справочнике</div>
          <ul className="onb-log">
            {services.custom.map(item => <li key={item.id}><span>{item.title}</span></li>)}
          </ul>
        </>
      )}
    </div>
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

function eventLabel(event, stepTitles = {}) {
  const base = EVENTS[event.action] || event.action;
  const step = event.payload?.stepKey;
  return step ? `${base}: ${stepTitles[step] || step}` : base;
}
