/**
 * «Задачи» — плоский список с фильтрами.
 *
 * Нужен там, где доска бесполезна: найти задачу по проекту, посмотреть всё, что
 * поставил сам, вытащить задачи на нескольких человек. Колонка «Трудозатраты»
 * считает оценку с умножением на число исполнителей — общая часть на троих это
 * не два часа, а шесть.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { STATUS_LABEL, STATUS_ICON, STATUS_COLOR, MODE_LABEL } from '../utils/labels';
import { hoursText, dnum } from '../utils/dates';
import { AvatarStack, Empty } from './Bits';
import CustomSelect from './CustomSelect';

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

  // Фильтр стоит в шапке модуля рядом с названием раздела — там же, где фильтры
  // доски. Свою строку над таблицей он занимал целиком ради одного поля.
  const filters = (
    <CustomSelect
      label="Показывать"
      value={filter}
      onChange={setFilter}
      options={FILTERS.map(([value, label]) => ({ value, label }))}
      className="is-wide"
    />
  );

  return (
    <>
      {ctx.headerSlot && createPortal(filters, ctx.headerSlot)}

      {loading ? <Empty compact>Загружаем…</Empty>
        : !list.length ? <Empty>В этом фильтре пусто.</Empty> : (
        <div className="tsk-task-table-wrap">
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
                const StatusIcon = STATUS_ICON[task.status];
                return (
                  <tr key={task.id} className="is-clickable" onClick={() => ctx.openTask(task.id)}>
                    <td>
                      {/* Код перед названием, а не отдельным столбцом: столбец
                          из шести знаков забрал бы ширину у самих названий,
                          ради которых таблицу и открывают. */}
                      {task.code && <span className="tsk-code">{task.code}</span>}
                      {task.title}
                      {/* Вторая строка — только проект. Число частей, вложения и
                          автор есть в карточке задачи, а в списке они сливались
                          в серую строку, которую никто не дочитывал до конца. */}
                      {task.project?.name && (
                        <div className="tsk-task-project">{task.project.name}</div>
                      )}
                    </td>
                    <td>
                      {/* Ячейка центрирована, но её содержимое — своя флекс-строка,
                          и собрать её к середине надо отдельно. */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <AvatarStack users={users} size={20} />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{users.length}</span>
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{MODE_LABEL[task.mode]}</td>
                    <td>{hoursText(task.totalEffortHours)}</td>
                    <td>{due ? dnum(due) : '—'}</td>
                    <td className="tsk-task-status" title={STATUS_LABEL[task.status]}>
                      {StatusIcon && <StatusIcon size={18} strokeWidth={1.8} color={STATUS_COLOR[task.status]} />}
                    </td>
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
