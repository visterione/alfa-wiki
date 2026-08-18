/**
 * Карточка задачи.
 *
 * Отличается от карточки на доске одним разделом — историей. Срок здесь не
 * поле, а результат переговоров: кто предложил, кто перенёс, кто согласовал и
 * какое объяснение приложил автор, продавивший задачу в переполненный день.
 * Без этой ленты «срок сдвинулся» выглядит как факт природы.
 */

import React, { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  CalendarClock, CheckCircle2, ClipboardCheck, Clock, Clock3, RotateCcw,
  FileText, GitBranch, History,
} from 'lucide-react';
import { tasks as api, BASE_URL } from '../../../services/api';
import {
  STATUS_LABEL, STATUS_ICON, STATUS_COLOR, userName, shortName, partCode,
} from '../utils/labels';
import { hoursText, ddate, dfull, clockText } from '../utils/dates';
import { Badge, Avatar, AvatarStack, Empty } from './Bits';

/**
 * Продление: не одна кнопка «+30 минут», а выбор.
 * Полчаса хватало не всегда, и человек нажимал её по четыре раза подряд —
 * каждый раз с запросом на сервер и пересчётом дня.
 */
const EXTEND_OPTIONS = [
  [0.25, '15 мин'],
  [0.5, '30 мин'],
  [1, '1 ч'],
  [2, '2 ч'],
  [4, '4 ч'],
];

/** Человеческие формулировки событий истории. */
function historyText(row) {
  const p = row.payload || {};
  switch (row.action) {
    case 'created':
      return p.parts > 1
        ? `создал задачу из ${p.parts} частей на ${p.people} чел.`
        : 'создал задачу';
    case 'planned':
      return p.overload
        ? `взял в план на ${ddate(p.date)} сверх нормы — стало ${hoursText(p.after)} из ${hoursText(p.norm)}`
        : `поставил в план на ${ddate(p.date)}`;
    case 'proposed_date':
      return `предложил срок ${ddate(p.to)}${p.busyHours !== null && p.busyHours !== undefined
        ? ` — было занято ${hoursText(p.busyHours)} из ${hoursText(p.norm)}` : ''}`;
    case 'accepted_date': return `согласовал срок ${ddate(p.date)}`;
    case 'declined': return 'вернул задачу автору с пометкой «не моя зона»';
    case 'moved':
      return p.becameStuck
        ? `перенёс на ${ddate(p.to)} — третий перенос, задача требует решения`
        : `перенёс на ${ddate(p.to)}`;
    case 'extended': return `продлил: ${hoursText(p.from)} → ${hoursText(p.to)}`;
    case 'split': return `разбил часть: ${hoursText(p.head)} + ${hoursText(p.tail)}`;
    case 'forced': return `продавил проверку загрузки: «${p.explanation}»`;
    case 'status_changed': return `${STATUS_LABEL[p.from] || p.from} → ${STATUS_LABEL[p.to] || p.to}`;
    default: return row.action;
  }
}

function historyTone(row) {
  if (row.action === 'declined' || row.action === 'forced') return 'bad';
  if (row.action === 'moved' || row.action === 'extended' || row.action === 'proposed_date') return 'warn';
  if (row.action === 'planned' || row.action === 'accepted_date') return 'ok';
  if (row.action === 'status_changed') {
    if (row.payload?.to === 'done') return 'ok';
    if (row.payload?.to === 'review') return 'violet';
    return 'info';
  }
  if (row.action === 'split') return 'violet';
  return 'info';
}

export default function TaskCard({ taskId, ctx, onClose, onChanged }) {
  const [task, setTask] = useState(null);
  const [busy, setBusy] = useState(false);
  const [movingPart, setMovingPart] = useState(null);
  const [moveDate, setMoveDate] = useState('');
  // Какая часть сейчас спрашивает «завершаем или на проверку» и какая — «на
  // сколько продлить». Строкой с id, а не флагом: частей в задаче несколько.
  const [finishingPart, setFinishingPart] = useState(null);
  const [extendingPart, setExtendingPart] = useState(null);
  const [tab, setTab] = useState('main');

  const reload = useCallback(async () => {
    try {
      const { data } = await api.getTask(taskId);
      setTask(data);
    } catch {
      toast.error('Не удалось открыть задачу');
      onClose();
    }
  }, [taskId, onClose]);

  useEffect(() => { reload(); }, [reload]);

  const act = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      toast.success(message);
      await reload();
      onChanged?.();
    } catch (error) {
      const payload = error?.response?.data;
      // 409 после третьего переноса — не ошибка, а требование решения.
      toast.error(payload?.error || 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!window.confirm('Отменить задачу? Запланированное время вернётся людям в свободное.')) return;
    try {
      await api.cancelTask(taskId);
      toast.success('Задача отменена. После нескольких переносов это чаще всего верное решение');
      onChanged?.();
      onClose();
    } catch {
      toast.error('Не удалось отменить задачу');
    }
  };

  if (!task) {
    return (
      <div className="tsk-mask" onClick={onClose}>
        <div className="tsk-modal"><div className="tsk-modal-body"><Empty compact>Загружаем…</Empty></div></div>
      </div>
    );
  }

  const users = (task.parts || [])
    .flatMap(p => (p.assignees || []).map(a => a.user))
    .filter((u, i, arr) => u && arr.findIndex(x => x?.id === u.id) === i);
  const isAuthor = task.authorId === ctx.me?.id;

  return (
    <div className="tsk-mask tsk-task-card-mask" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tsk-modal tsk-task-card-modal">
        <div className="tsk-modal-head">
          <div className="tsk-modal-title">
            {/* Код над названием: именно им задачу называют вслух, и в открытой
                карточке он должен читаться сразу, а не искаться по мелочи. */}
            {task.code && <span className="tsk-code is-lead">{task.code}</span>}
            {task.title}
          </div>
          <button className="tsk-x" onClick={onClose}>×</button>
        </div>

        {/* Карточка разложена по вкладкам: раньше это была одна лента, в
            которой части, схема и история шли подряд, и до истории добирались
            прокруткой мимо всего остального. Схемы нет у задачи из одной части
            — рисовать вкладку с одной строкой незачем. */}
        <TaskTabs tab={tab} onTab={setTab} hasScheme={(task.parts?.length || 0) > 1} />

        <div className="tsk-modal-body tsk-task-card-body">
          {tab === 'main' && (<>
          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <div>
              Автор
              <div style={{ color: 'var(--text-primary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
                <Avatar user={task.author} size={20} /> <span title={userName(task.author)}>{shortName(task.author)}</span>
              </div>
            </div>
            <div>
              Исполнители
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AvatarStack users={users} size={20} />
                <span style={{ color: 'var(--text-primary)' }}>{users.length}</span>
              </div>
            </div>
          </div>

          {task.description && (
            <>
              <div className="tsk-sect">Описание</div>
              <div className="tsk-task-card-description">
                {task.description}
              </div>
            </>
          )}

          {!!task.attachments?.length && (
            <>
              <div className="tsk-sect">Файлы · {task.attachments.length}</div>
              <div className="tsk-files">
                {task.attachments.map((file, index) => (
                  <a
                    className="tsk-file"
                    key={file.id || file.path || index}
                    href={`${BASE_URL}/${String(file.path || '').replace(/^\//, '')}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="tsk-file-icon">{String(file.filename || 'file').split('.').pop()?.slice(0, 4)}</span>
                    <span className="tsk-file-name">{file.filename || file.originalName || 'Вложение'}</span>
                    <span className="tsk-file-open">Открыть</span>
                  </a>
                ))}
              </div>
            </>
          )}

          <div className="tsk-sect">Части · {task.parts?.length || 0}</div>
          {/* Тот же порядок, что и в схеме: номер части — это её место в
              задаче, и в двух вкладках он обязан совпадать. */}
          {[...(task.parts || [])]
            .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
            .map((part, index) => {
            const notPlanned = (part.assignees || []).filter(a => !a.plannedDate);
            const mine = (part.assignees || []).find(a => a.userId === ctx.me?.id);
            const partHistory = (task.history || []).filter(row => row.partId === part.id);
            const lastProposal = partHistory.map(row => row.action).lastIndexOf('proposed_date');
            const lastAccept = partHistory.map(row => row.action).lastIndexOf('accepted_date');
            const hasPendingProposal = lastProposal > lastAccept;
            const StatusIcon = STATUS_ICON[part.status];
            return (
              <div className="tsk-part" key={part.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    {task.code && <div className="tsk-code">{partCode(task.code, task.parts.length > 1 ? index : null)}</div>}
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{part.title}</div>
                  </div>
                  {/* Статус иконкой, как в таблице задач: подпись повторяла то,
                      что и так видно по кнопкам действий ниже. */}
                  <span className="tsk-part-status" title={STATUS_LABEL[part.status]}>
                    {StatusIcon && <StatusIcon size={18} strokeWidth={1.8} color={STATUS_COLOR[part.status]} />}
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <AvatarStack users={(part.assignees || []).map(a => a.user).filter(Boolean)} size={18} />
                  {(part.assignees || []).map(a => shortName(a.user)).join(', ')}
                  <span className="tsk-hours-chip">
                    <Clock size={13} strokeWidth={1.9} />{clockText(part.estimateHours)}
                  </span>
                  {' · '}{ddate(String(part.dueDate))}
                  {part.assignees?.length > 1 && <Badge tone="violet">общая</Badge>}
                  {part.moveCount > 0 && (
                    <Badge tone={part.moveCount >= 3 ? 'bad' : 'warn'}>
                      переносов: {part.moveCount}
                    </Badge>
                  )}
                </div>

                {!!notPlanned.length && (
                  <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
                    Не обработали: {notPlanned.map(a => shortName(a.user)).join(', ')}
                  </div>
                )}

                {/* Застрявшая часть: кнопки «перенести ещё раз» здесь нет
                    специально — после третьего переноса нужен выбор. */}
                {part.status === 'stuck' && (
                  <div className="tsk-trade is-bad" style={{ marginTop: 12 }}>
                    <div className="tsk-trade-title">Требует решения</div>
                    <div className="tsk-trade-text">
                      Часть переносится третий раз подряд. Обычно это значит, что
                      она слишком крупная или на самом деле не нужна.
                    </div>
                    <div className="tsk-acts" style={{ marginTop: 10 }}>
                      <button className="tsk-btn" disabled={busy}
                        onClick={() => act(() => api.splitPart(part.id, {}), 'Разбито надвое — теперь части мельче и помещаются в день')}>
                        Разбить на части
                      </button>
                      {isAuthor && (
                        <button className="tsk-btn is-danger" onClick={cancel}>Отменить задачу</button>
                      )}
                    </div>
                  </div>
                )}

                {mine && part.status !== 'stuck' && (
                  <div className="tsk-part-actions">
                    {!mine.plannedDate ? (
                      <button className="tsk-part-action is-plan" disabled={busy}
                        onClick={() => act(
                          () => api.planPart(part.id, String(part.dueDate)),
                          `В плане на ${dfull(String(part.dueDate))}`
                        )}>
                        <CalendarClock size={15} />Взять в план
                      </button>
                    ) : (
                      <>
                        {/* «Готово» вместо двух кнопок «Завершить» и «На
                            проверку». Это один и тот же момент — работа сделана,
                            — и разница только в том, смотрит ли её кто-то после.
                            Спрашиваем один раз вместо того, чтобы держать на
                            виду обе кнопки. */}
                        {part.status !== 'done' && (
                          <button className="tsk-part-action is-complete" disabled={busy}
                            onClick={() => {
                              setFinishingPart(finishingPart === part.id ? null : part.id);
                              setExtendingPart(null);
                            }}>
                            <CheckCircle2 size={15} />Готово
                          </button>
                        )}
                        {part.status !== 'done' && (
                          <button className="tsk-part-action" disabled={busy}
                            onClick={() => {
                              setExtendingPart(extendingPart === part.id ? null : part.id);
                              setFinishingPart(null);
                            }}>
                            <Clock3 size={15} />Продлить
                          </button>
                        )}
                        {part.status !== 'done' && (
                          <button className="tsk-part-action" disabled={busy}
                            onClick={() => {
                              setMovingPart(part.id);
                              setMoveDate(String(mine.plannedDate || part.dueDate));
                              setFinishingPart(null);
                              setExtendingPart(null);
                            }}>
                            <CalendarClock size={15} />Перенести
                          </button>
                        )}
                        {part.status === 'done' && (
                          <button className="tsk-part-action" disabled={busy}
                            onClick={() => act(() => api.setPartStatus(part.id, 'work'), 'Возвращено в работу')}>
                            <RotateCcw size={15} />Вернуть в работу
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

                {isAuthor && !mine && part.status === 'new' && hasPendingProposal && (
                  <div className="tsk-acts" style={{ marginTop: 10 }}>
                    <button className="tsk-btn is-sm" disabled={busy}
                      onClick={() => act(() => api.acceptDate(part.id),
                        `Срок согласован: ${dfull(String(part.dueDate))}`)}>
                      Согласовать срок
                    </button>
                  </div>
                )}

                {finishingPart === part.id && (
                  <div className="tsk-choice">
                    <span className="tsk-choice-title">Работа сделана —</span>
                    <button className="tsk-part-action is-complete" disabled={busy}
                      onClick={() => act(
                        () => api.setPartStatus(part.id, 'done'),
                        'Завершено. Время освободилось — день пересчитан'
                      ).then(() => setFinishingPart(null))}>
                      <CheckCircle2 size={15} />Завершить
                    </button>
                    <button className="tsk-part-action is-review" disabled={busy || part.status === 'review'}
                      onClick={() => act(
                        () => api.setPartStatus(part.id, 'review'),
                        'Отправлено на проверку'
                      ).then(() => setFinishingPart(null))}>
                      <ClipboardCheck size={15} />
                      {part.status === 'review' ? 'Уже на проверке' : 'На проверку'}
                    </button>
                    <button className="tsk-part-action" onClick={() => setFinishingPart(null)}>Отмена</button>
                  </div>
                )}

                {extendingPart === part.id && (
                  <div className="tsk-choice">
                    <span className="tsk-choice-title">Добавить к оценке</span>
                    {EXTEND_OPTIONS.map(([hours, label]) => (
                      <button className="tsk-part-action" key={hours} disabled={busy}
                        onClick={() => act(
                          () => api.extendPart(part.id, hours),
                          `Продлено на ${label} — загрузка пересчитана`
                        ).then(() => setExtendingPart(null))}>
                        {label}
                      </button>
                    ))}
                    <button className="tsk-part-action" onClick={() => setExtendingPart(null)}>Отмена</button>
                  </div>
                )}

                {movingPart === part.id && (
                  <div className="tsk-move">
                    <input className="tsk-input" type="date" value={moveDate}
                      onChange={e => setMoveDate(e.target.value)} />
                    <button className="tsk-btn is-primary" disabled={busy || !moveDate}
                      onClick={() => act(
                        () => api.movePart(part.id, moveDate),
                        `Перенесено на ${dfull(moveDate)}`
                      ).then(() => setMovingPart(null))}>
                      Перенести
                    </button>
                    <button className="tsk-btn" onClick={() => setMovingPart(null)}>Отмена</button>
                  </div>
                )}
              </div>
            );
          })}

          </>)}

          {tab === 'scheme' && <TaskScheme task={task} />}

          {tab === 'history' && (
          <div className="tsk-card-history">
            {!task.history?.length ? (
              <div className="tsk-card-history-empty">История пока пуста.</div>
            ) : task.history.map(row => (
              <div className={`tsk-card-history-row is-${historyTone(row)}`} key={row.id}>
                <div className="tsk-card-history-rail"><i /></div>
                <div className="tsk-card-history-content">
                  <div className="tsk-card-history-head">
                    <b title={userName(row.user)}>{shortName(row.user)}</b>
                    <time>{new Date(row.createdAt).toLocaleString('ru-RU', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}</time>
                  </div>
                  <div>{historyText(row)}</div>
                </div>
              </div>
            ))}
          </div>
          )}
        </div>

        <div className="tsk-modal-foot tsk-task-card-foot">
          <div className="tsk-modal-btns">
            {isAuthor && <button className="tsk-btn is-danger" onClick={cancel}>Отменить</button>}
            <button className="tsk-btn" onClick={onClose}>Закрыть</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Переключатель вкладок карточки.
 *
 * Устроен как rb-wizard-nav в зарплатном модуле: подложка активной вкладки —
 * отдельный слой, который переезжает на новое место, а не появляется там. Так
 * видно, что это одна панель с тремя положениями, а не три отдельные кнопки.
 * Длительность переезда зависит от расстояния — иначе соседний переход
 * выглядит вяло, а дальний слишком резким.
 */
function TaskTabs({ tab, onTab, hasScheme }) {
  const navRef = useRef(null);
  const [slider, setSlider] = useState({ left: 0, width: 0, duration: 0 });

  const tabs = [
    ['main', 'Основное', FileText],
    ...(hasScheme ? [['scheme', 'Схема', GitBranch]] : []),
    ['history', 'История', History],
  ];

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const recalc = animate => {
      const active = nav.querySelector('.tsk-card-tab.is-on');
      if (!active) return;
      setSlider(previous => ({
        left: active.offsetLeft,
        width: active.offsetWidth,
        duration: animate ? Math.min(0.5, 0.24 + Math.abs(active.offsetLeft - previous.left) / 2000) : 0,
      }));
    };
    recalc(true);
    const observer = typeof window.ResizeObserver === 'undefined'
      ? null
      : new window.ResizeObserver(() => recalc(false));
    observer?.observe(nav);
    return () => observer?.disconnect();
  }, [tab, hasScheme]);

  return (
    <div className="tsk-card-tabs" ref={navRef}>
      <div
        className="tsk-card-tabs-slider"
        style={{ left: slider.left, width: slider.width, '--slide': `${slider.duration}s` }}
      />
      {tabs.map(([key, label, Icon]) => (
        <button
          key={key}
          className={`tsk-card-tab ${tab === key ? 'is-on' : ''}`}
          onClick={() => onTab(key)}
        >
          <Icon size={15} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function TaskScheme({ task }) {
  const deps = task.deps || [];
  const parts = [...(task.parts || [])].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  return (
    <div className="tsk-card-scheme">
      {parts.map((part, index) => {
        const StatusIcon = STATUS_ICON[part.status];
        const after = deps
          .filter(dep => dep.partId === part.id)
          .map(dep => parts.find(p => p.id === dep.afterPartId)?.title)
          .filter(Boolean);
        return (
          <div className="tsk-card-scheme-row" key={part.id}>
            <div className="tsk-card-scheme-rail">
              <span>{index + 1}</span>
              {index < parts.length - 1 && <i />}
            </div>
            <div className={`tsk-card-scheme-node is-${part.status}`}>
              <div className="tsk-card-scheme-head">
                <b>
                  {/* Код части над названием: именно им её называют, когда
                      этапов несколько и «первый» у каждого свой. */}
                  {task.code && <span className="tsk-code is-lead">{partCode(task.code, index)}</span>}
                  {part.title}
                </b>
                <span className="tsk-part-status" title={STATUS_LABEL[part.status]}>
                  {StatusIcon && <StatusIcon size={17} strokeWidth={1.8} color={STATUS_COLOR[part.status]} />}
                </span>
              </div>
              <div className="tsk-card-scheme-meta">
                <AvatarStack users={(part.assignees || []).map(a => a.user).filter(Boolean)} size={18} />
                <span>{(part.assignees || []).map(a => shortName(a.user)).join(', ')}</span>
                <em className="tsk-hours-chip">
                  <Clock size={13} strokeWidth={1.9} />{clockText(part.estimateHours)}
                </em>
              </div>
              {!!after.length && <div className="tsk-card-scheme-deps">
                <span>После</span>{after.map(title => <b key={title}>{title}</b>)}
              </div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
