/**
 * «Люди» — нормы рабочего дня.
 *
 * Норма правится прямо в таблице и действует сразу: пересчитываются все дни,
 * цвета и проверка при постановке задач. Каждое изменение попадает в историю —
 * это разговор между руководителем и человеком, а не тихая настройка.
 *
 * Подрядчик на part-time, поддержка со сменным графиком и руководитель, у
 * которого полдня встречи, не могут иметь одну норму. Пока норма задаётся одной
 * цифрой на компанию, отчёт по загрузке — это отчёт о том, насколько неверно
 * эта цифра выбрана.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { weekStart, addDays, hoursText } from '../utils/dates';
import { userName } from '../utils/labels';
import { Avatar, Empty, Note, Badge } from './Bits';

export default function People({ ctx }) {
  const { cursor, me } = ctx;
  // Границы недели держим отдельными строками, а не массивом из weekOf:
  // массив пересоздаётся на каждый рендер, и выборка уходила бы в цикл.
  const start = weekStart(cursor);
  const end = addDays(start, 6);

  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.getPeople({ start, end });
      setPeople(data || []);
      setDraft(Object.fromEntries((data || []).map(p => [p.id, p.dailyNormHours ?? ''])));
    } catch {
      toast.error('Не удалось получить список людей');
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => { reload(); }, [reload]);

  const save = async person => {
    const value = draft[person.id];
    const norm = value === '' ? null : Number(value);
    if (norm !== null && (!Number.isFinite(norm) || norm <= 0 || norm > 24)) {
      toast.error('Норма должна быть от 0 до 24 часов');
      return;
    }
    if (norm === (person.dailyNormHours ?? null)) return;

    try {
      await api.setNorm(person.id, norm);
      toast.success(norm === null
        ? `${userName(person)} больше не участвует в планировании`
        : `Норма ${userName(person)}: ${hoursText(norm)} в день. Пересчитаны все дни и цвета`);
      await reload();
      if (person.id === me?.id) ctx.reloadAccess();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Не удалось изменить норму');
      setDraft(d => ({ ...d, [person.id]: person.dailyNormHours ?? '' }));
    }
  };

  if (loading) return <Empty compact>Загружаем…</Empty>;
  if (!people.length) return <Empty>В вашей области видимости нет людей.</Empty>;

  return (
    <>
      <div className="tsk-scroll">
        <table className="tsk-table">
          <thead>
            <tr>
              <th>Человек</th>
              <th>Команды</th>
              <th>Норма дня</th>
              <th>Свободно за неделю</th>
              <th>Переработка</th>
            </tr>
          </thead>
          <tbody>
            {people.map(person => (
              <tr key={person.id}>
                <td>
                  <div className="tsk-person" style={{ cursor: 'default' }}>
                    <Avatar user={person} />
                    <div>
                      <div className="tsk-person-name">{userName(person)}</div>
                      {person.id === me?.id && <div className="tsk-person-sub">это вы</div>}
                    </div>
                  </div>
                </td>
                <td style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>
                  {person.teams?.map(t => t.name).join(', ') || '—'}
                </td>
                <td>
                  <input
                    className="tsk-input tsk-num"
                    type="number"
                    min="1"
                    max="24"
                    step="0.2"
                    placeholder="—"
                    value={draft[person.id] ?? ''}
                    onChange={e => setDraft(d => ({ ...d, [person.id]: e.target.value }))}
                    onBlur={() => save(person)}
                    onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                  <span style={{ marginLeft: 6, color: 'var(--text-secondary)', fontSize: 12 }}>ч</span>
                </td>
                <td>{person.dailyNormHours ? hoursText(person.freeHours ?? 0) : '—'}</td>
                <td>
                  {person.overloadedDays > 0
                    ? <Badge tone="bad">{person.overloadedDays} дн.</Badge>
                    : <Badge tone="ok">нет</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Note>
        Норма — это не длина смены, а честное время на задачи: рабочий день
        минус встречи, переключения и перерывы. Пустое поле означает, что
        человек в планировании не участвует — ему нельзя ставить задачи.
        Изменения сохраняются при уходе из поля и действуют сразу.
      </Note>
    </>
  );
}
