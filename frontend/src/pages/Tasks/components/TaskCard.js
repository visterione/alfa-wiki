/**
 * Карточка задачи.
 *
 * Отличается от карточки на доске одним разделом — историей. Срок здесь не
 * поле, а результат переговоров: кто предложил, кто перенёс, кто согласовал и
 * какое объяснение приложил автор, продавивший задачу в переполненный день.
 * Без этой ленты «срок сдвинулся» выглядит как факт природы.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { STATUS_LABEL, STATUS_TONE, MODE_LABEL, userName } from '../utils/labels';
import { hoursText, dshort, dfull, estimateText } from '../utils/dates';
import { Badge, Avatar, AvatarStack, Empty } from './Bits';

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
        ? `взял в план на ${dshort(p.date)} сверх нормы — стало ${hoursText(p.after)} из ${hoursText(p.norm)}`
        : `поставил в план на ${dshort(p.date)}`;
    case 'proposed_date':
      return `предложил срок ${dshort(p.to)}${p.busyHours !== null && p.busyHours !== undefined
        ? ` — было занято ${hoursText(p.busyHours)} из ${hoursText(p.norm)}` : ''}`;
    case 'accepted_date': return `согласовал срок ${dshort(p.date)}`;
    case 'declined': return 'вернул задачу автору с пометкой «не моя зона»';
    case 'moved':
      return p.becameStuck
        ? `перенёс на ${dshort(p.to)} — третий перенос, задача требует решения`
        : `перенёс на ${dshort(p.to)}`;
    case 'split': return `разбил часть: ${hoursText(p.head)} + ${hoursText(p.tail)}`;
    case 'forced': return `продавил проверку загрузки: «${p.explanation}»`;
    case 'status_changed': return `${STATUS_LABEL[p.from] || p.from} → ${STATUS_LABEL[p.to] || p.to}`;
    default: return row.action;
  }
}

export default function TaskCard({ taskId, ctx, onClose, onChanged }) {
  const [task, setTask] = useState(null);
  const [busy, setBusy] = useState(false);

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
    <div className="tsk-mask" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tsk-modal">
        <div className="tsk-modal-head">
          <div className="tsk-modal-title">{task.title}</div>
          <button className="tsk-x" onClick={onClose}>×</button>
        </div>

        <div className="tsk-modal-body">
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 16 }}>
            {task.project && <Badge tone="info">{task.project.name}</Badge>}
            <Badge tone={task.mode === 'single' ? 'muted' : 'violet'}>{MODE_LABEL[task.mode]}</Badge>
            <Badge tone="muted">{hoursText(task.totalEffortHours)} трудозатрат</Badge>
            <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
          </div>

          <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <div>
              Автор
              <div style={{ color: 'var(--text-primary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
                <Avatar user={task.author} size={20} /> {userName(task.author)}
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
              <div style={{ fontSize: 13.5, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                {task.description}
              </div>
            </>
          )}

          <div className="tsk-sect">Части · {task.parts?.length || 0}</div>
          {(task.parts || []).map(part => {
            const notPlanned = (part.assignees || []).filter(a => !a.plannedDate);
            const mine = (part.assignees || []).find(a => a.userId === ctx.me?.id);
            return (
              <div className="tsk-part" key={part.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{part.title}</div>
                  <Badge tone={STATUS_TONE[part.status]}>{STATUS_LABEL[part.status]}</Badge>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <AvatarStack users={(part.assignees || []).map(a => a.user).filter(Boolean)} size={18} />
                  {(part.assignees || []).map(a => userName(a.user)).join(', ')}
                  {' · '}{estimateText(part.estimateHours)}
                  {' · '}{dshort(String(part.dueDate))}
                  {part.assignees?.length > 1 && <Badge tone="violet">общая</Badge>}
                  {part.moveCount > 0 && (
                    <Badge tone={part.moveCount >= 3 ? 'bad' : 'warn'}>
                      переносов: {part.moveCount}
                    </Badge>
                  )}
                </div>

                {!!notPlanned.length && (
                  <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
                    Не обработали: {notPlanned.map(a => userName(a.user)).join(', ')}
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
                  <div className="tsk-acts" style={{ marginTop: 10 }}>
                    {!mine.plannedDate ? (
                      <button className="tsk-btn is-sm is-primary" disabled={busy}
                        onClick={() => act(
                          () => api.planPart(part.id, String(part.dueDate)),
                          `В плане на ${dfull(String(part.dueDate))}`
                        )}>
                        Взять в план
                      </button>
                    ) : (
                      <>
                        {part.status !== 'done' && (
                          <button className="tsk-btn is-sm" disabled={busy}
                            onClick={() => act(() => api.setPartStatus(part.id, 'done'),
                              'Завершено. Время освободилось — день пересчитан')}>
                            Завершить
                          </button>
                        )}
                        {part.status !== 'review' && part.status !== 'done' && (
                          <button className="tsk-btn is-sm" disabled={busy}
                            onClick={() => act(() => api.setPartStatus(part.id, 'review'), 'Отправлено на проверку')}>
                            На проверку
                          </button>
                        )}
                        {part.status === 'done' && (
                          <button className="tsk-btn is-sm" disabled={busy}
                            onClick={() => act(() => api.setPartStatus(part.id, 'work'), 'Возвращено в работу')}>
                            Вернуть в работу
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

                {isAuthor && !mine && part.status === 'new' && (
                  <div className="tsk-acts" style={{ marginTop: 10 }}>
                    <button className="tsk-btn is-sm" disabled={busy}
                      onClick={() => act(() => api.acceptDate(part.id),
                        `Срок согласован: ${dfull(String(part.dueDate))}`)}>
                      Согласовать срок
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <div className="tsk-sect">История</div>
          <div className="tsk-hist" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            {!task.history?.length ? (
              <div className="tsk-hist-row">Срок назначен односторонне и не пересматривался.</div>
            ) : task.history.map(row => (
              <div className="tsk-hist-row" key={row.id}>
                <b>{userName(row.user)}</b>
                <span>{historyText(row)}</span>
                <span className="tsk-hist-when">
                  {new Date(row.createdAt).toLocaleString('ru-RU', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="tsk-modal-foot">
          <div className="tsk-modal-hint">
            Срок — согласование, а не поле. Поэтому у него есть история.
          </div>
          <div className="tsk-modal-btns">
            {isAuthor && <button className="tsk-btn is-danger" onClick={cancel}>Отменить</button>}
            <button className="tsk-btn" onClick={onClose}>Закрыть</button>
          </div>
        </div>
      </div>
    </div>
  );
}
