/**
 * «Задачи» — плоский список с фильтрами.
 *
 * Нужен там, где доска бесполезна: найти задачу по проекту, посмотреть всё, что
 * поставил сам, вытащить задачи на нескольких человек. Колонка «Трудозатраты»
 * считает оценку с умножением на число исполнителей — общая часть на троих это
 * не два часа, а шесть.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { STATUS_LABEL, STATUS_TONE, MODE_LABEL, userName } from '../utils/labels';
import { hoursText, dshort } from '../utils/dates';
import { Badge, AvatarStack, Empty } from './Bits';

const FILTERS = [
  ['all', 'Все'],
  ['mine', 'Поставленные мной'],
  ['multi', 'На нескольких человек'],
  ['new', 'Не обработано'],
  ['stuck', 'Анализируется'],
  ['done', 'Готово'],
];

export default function TaskList({ ctx }) {
  const [list, setList] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter === 'mine') params.mine = true;
      else if (filter === 'multi') params.multi = true;
      else if (filter !== 'all') params.status = filter;
      const { data } = await api.getTasks(params);
      setList(data || []);
    } catch {
      toast.error('Не удалось получить задачи');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <>
      <div className="tsk-chips" style={{ marginBottom: 16 }}>
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            className={`tsk-chip ${filter === key ? 'is-on' : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? <Empty compact>Загружаем…</Empty>
        : !list.length ? <Empty>В этом фильтре пусто.</Empty> : (
        <div className="tsk-scroll">
          <table className="tsk-table">
            <thead>
              <tr>
                <th>Задача</th>
                <th>Исполнители</th>
                <th>Формат</th>
                <th>Трудозатраты</th>
                <th>Срок</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {list.map(task => {
                const users = (task.parts || [])
                  .flatMap(p => (p.assignees || []).map(a => a.user))
                  .filter((u, i, arr) => u && arr.findIndex(x => x?.id === u.id) === i);
                const due = (task.parts || [])
                  .map(p => String(p.dueDate))
                  .sort()
                  .pop();
                return (
                  <tr key={task.id} className="is-clickable" onClick={() => ctx.openTask(task.id)}>
                    <td>
                      {task.title}
                      <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 3 }}>
                        {task.project?.name || 'без проекта'}
                        {task.parts?.length > 1 && ` · ${task.parts.length} части`}
                        {!!task.attachments?.length && ` · 📎${task.attachments.length}`}
                        {task.author && ` · от ${userName(task.author)}`}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AvatarStack users={users} size={20} />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{users.length}</span>
                      </div>
                    </td>
                    <td>
                      <Badge tone={task.mode === 'single' ? 'muted' : 'violet'}>{MODE_LABEL[task.mode]}</Badge>
                    </td>
                    <td>{hoursText(task.totalEffortHours)}</td>
                    <td>{due ? dshort(due) : '—'}</td>
                    <td><Badge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
