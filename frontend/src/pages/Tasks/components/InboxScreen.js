/**
 * Входящие — центральный экран модуля.
 *
 * Здесь задача перестаёт быть чужим намерением и становится работой. Пока
 * человек не поставил её в план, она не занимает у него ни часа, и автор
 * видит, что до задачи ещё никто не дошёл. На обычной доске такая задача лежит
 * в колонке «К выполнению» и создаёт полную иллюзию, что работа идёт.
 *
 * Второй список — «жду ответа» — по той же причине: автору важно видеть не
 * только то, что просят у него, но и то, что до сих пор никем не разобрано.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { dfull, dshort, hoursText, estimateText, addDays } from '../utils/dates';
import { userName } from '../utils/labels';
import { Empty, Badge, AvatarStack, Note } from './Bits';

export default function InboxScreen({ ctx }) {
  const [data, setData] = useState({ mine: [], blocked: [], waiting: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getInbox();
      setData(res.data);
    } catch {
      toast.error('Не удалось получить входящие');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const act = async (partId, fn, message) => {
    setBusy(partId);
    try {
      await fn();
      toast.success(message);
      await reload();
      ctx.refreshInbox();
    } catch (error) {
      const payload = error?.response?.data;
      toast.error(payload?.error || 'Не получилось');
    } finally {
      setBusy(null);
    }
  };

  const plan = (part, date, force) => act(
    part.id,
    () => api.planPart(part.id, date, force),
    force
      ? 'Взято сверх нормы — автор увидит, что вы в переработке'
      : `В плане на ${dfull(date)}. Автору ушло уведомление`
  );

  /**
   * Предложить другой срок.
   *
   * Ближайшее подходящее окно ищет бэкенд, а не интерфейс: у него есть все дни
   * и все нормы. «Нет окна до конца месяца» — валидный ответ, и показать его
   * надо честно, а не подобрать день молча.
   */
  const propose = async part => {
    setBusy(part.id);
    try {
      const { data: fit } = await api.getNextFit(part.id, {
        start: addDays(String(part.dueDate), 1),
      });
      if (!fit.date) {
        toast.error('До конца горизонта нет дня, куда это помещается. Придётся двигать другое или признать переработку');
        return;
      }
      await api.proposeDate(part.id, fit.date);
      toast.success(`Срок ${dshort(fit.date)} предложен автору — вместе с цифрой занятости, без названий ваших дел`);
      await reload();
      ctx.refreshInbox();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Не получилось предложить срок');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Empty compact>Загружаем…</Empty>;

  return (
    /**
     * Два этажа во всю высоту, а не один длинный список.
     *
     * Верхний — то, что требует решения прямо сейчас; нижний — то, чего человек
     * ждёт от других. Раньше они шли подряд, и «жду ответа» уезжало под сгиб
     * ровно в тот день, когда входящих много: список, который нужен, чтобы
     * вовремя пнуть коллегу, был виден реже всего.
     */
    <div className="tsk-inbox-split">
      <section className="tsk-inbox-pane">
        <div className="tsk-sect">Требует вашего решения — {data.mine.length}</div>
        <div className="tsk-inbox-pane-body">
          {!data.mine.length ? (
            <Empty>Входящие разобраны.<br />Ни одна задача не ждёт вашего решения.</Empty>
          ) : data.mine.map(part => {
            const a = part.assessment || {};
            const date = String(part.dueDate);
            return (
              <div className="tsk-inbox-card" key={part.id}>
                <div className="tsk-inbox-title">{part.title}</div>
                <div className="tsk-inbox-from">
                  {part.task?.title !== part.title && `${part.task?.title} · `}
                  от {userName(part.task?.author)}
                  {part.task?.project && ` · ${part.task.project.name}`}
                  {' · '}{estimateText(part.estimateHours)}
                  {' · срок '}<b>{dshort(date)}</b>
                </div>

                <div className={`tsk-fit ${a.fits ? 'is-ok' : 'is-bad'}`}>
                  {a.reason === 'vacation' && 'В этот день у вас отпуск.'}
                  {a.reason === 'no_norm' && 'Вам не задана норма рабочего дня — посчитать загрузку нельзя.'}
                  {a.reason === 'ok' && (
                    <>{dshort(date)}: станет <b>{hoursText(a.after)}</b> из {hoursText(a.norm)}. Помещается,
                      свободного останется {hoursText(a.free)}.</>
                  )}
                  {a.reason === 'overload' && (
                    <>{dshort(date)}: станет <b>{hoursText(a.after)}</b> из {hoursText(a.norm)} —
                      не помещается, переработка {hoursText(a.over)}.</>
                  )}
                </div>

                <div className="tsk-acts">
                  {a.fits ? (
                    <button className="tsk-btn is-primary" disabled={busy === part.id}
                      onClick={() => plan(part, date)}>
                      В план на {dshort(date)}
                    </button>
                  ) : (
                    <button className="tsk-btn is-primary" disabled={busy === part.id}
                      onClick={() => propose(part)}>
                      Предложить другой срок
                    </button>
                  )}
                  <button className="tsk-btn" disabled={busy === part.id}
                    onClick={() => a.fits ? propose(part) : plan(part, date, true)}>
                    {a.fits ? 'Другой день' : 'Всё равно взять'}
                  </button>
                  <button className="tsk-btn" onClick={() => ctx.openTask(part.taskId)}>
                    Открыть задачу
                  </button>
                  <button className="tsk-btn is-danger" disabled={busy === part.id}
                    onClick={() => act(part.id, () => api.declinePart(part.id), 'Возвращено автору с пометкой «не моя зона»')}>
                    Не моё
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="tsk-inbox-pane">
        <div className="tsk-sect">Жду ответа от других — {data.waiting.length}</div>
        <div className="tsk-inbox-pane-body">
          {!data.waiting.length ? (
            <Empty compact>Вы никого не ждёте.</Empty>
          ) : data.waiting.map(part => (
            <div className="tsk-list-row" key={part.id} onClick={() => ctx.openTask(part.taskId)}>
              <div>
                <div className="tsk-list-row-title">{part.title}</div>
                <div className="tsk-list-row-sub">
                  {(part.assignees || []).map(a => userName(a.user)).join(', ')} · ещё не в плане
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AvatarStack users={(part.assignees || []).map(a => a.user).filter(Boolean)} />
                <Badge tone="warn">не обработана</Badge>
              </div>
            </div>
          ))}

          {/* Части, которые ждут завершения предыдущих. Связь «после» — это
              условие появления во входящих, а не пометка на схеме. Стоят в
              нижнем этаже: решения они не требуют, сейчас от человека ничего
              не зависит — он ждёт, как и в списке выше. */}
          {!!data.blocked?.length && (
            <>
              <div className="tsk-sect">Ждут предыдущую часть — {data.blocked.length}</div>
              {data.blocked.map(part => (
                <div className="tsk-list-row" key={part.id} onClick={() => ctx.openTask(part.taskId)}>
                  <div>
                    <div className="tsk-list-row-title">{part.title}</div>
                    <div className="tsk-list-row-sub">
                      Появится во входящих, когда завершится предыдущая часть
                    </div>
                  </div>
                  <Badge tone="muted">{estimateText(part.estimateHours)}</Badge>
                </div>
              ))}
            </>
          )}

        </div>

        <Note>
          «Не обработана» — это задача, которую исполнитель ещё не разобрал: не
          поставил в план и не предложил другой срок. Пока она в этом состоянии,
          она не занимает у него времени, и рассчитывать на неё нельзя.
        </Note>
      </section>
    </div>
  );
}
