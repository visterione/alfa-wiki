/** Люди и их недельные рабочие расписания. */
import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { tasks as api } from '../../../services/api';
import { weekStart, addDays, hoursText } from '../utils/dates';
import { userName } from '../utils/labels';
import { Avatar, Empty, Note, Badge } from './Bits';

const DAYS = [
  ['mon', 'Понедельник'], ['tue', 'Вторник'], ['wed', 'Среда'], ['thu', 'Четверг'],
  ['fri', 'Пятница'], ['sat', 'Суббота'], ['sun', 'Воскресенье'],
];
const SHORT = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' };
const initialSchedule = () => ({ days: Object.fromEntries(DAYS.map(([key], index) => [key,
  index < 5 ? { enabled: true, start: '09:00', end: '18:00' } : { enabled: false },
])) });

/**
 * Расписание в таблице — строкой на каждую смену, а не на каждый день.
 *
 * Перечисление «Пн 09:00–18:00 · 9 ч, Вт 09:00–18:00 · 9 ч, …» занимало всю
 * ширину столбца и при этом не отвечало на единственный вопрос, который к нему
 * задают: когда человек работает. Одинаковые смены собираются в диапазон дней,
 * а часы недели и так стоят в соседнем столбце, поэтому здесь их нет.
 */
function scheduleGroups(schedule) {
  const days = schedule?.days || {};
  const order = DAYS.map(([key]) => key).filter(key => days[key]?.enabled);
  const byShift = new Map();
  for (const key of order) {
    const shift = `${days[key].start}–${days[key].end}`;
    if (!byShift.has(shift)) byShift.set(shift, []);
    byShift.get(shift).push(key);
  }
  return [...byShift].map(([shift, keys]) => ({ shift, days: dayRanges(keys) }));
}

/** «Пн–Чт, Сб»: подряд идущие дни сворачиваются, разрозненные перечисляются. */
function dayRanges(keys) {
  const index = DAYS.map(([key]) => key);
  const parts = [];
  let from = null;
  let previous = null;
  const flush = () => {
    if (from === null) return;
    parts.push(from === previous ? SHORT[from] : `${SHORT[from]}–${SHORT[previous]}`);
  };
  for (const key of keys) {
    if (previous !== null && index.indexOf(key) === index.indexOf(previous) + 1) {
      previous = key;
      continue;
    }
    flush();
    from = key;
    previous = key;
  }
  flush();
  return parts.join(', ');
}

export default function People({ ctx }) {
  const { cursor, me } = ctx;
  const start = weekStart(cursor);
  const end = addDays(start, 6);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.getPeople({ start, end }); setPeople(data || []); }
    catch { toast.error('Не удалось получить список людей'); }
    finally { setLoading(false); }
  }, [start, end]);
  useEffect(() => { reload(); }, [reload]);

  if (loading) return <Empty compact>Загружаем…</Empty>;
  if (!people.length) return <Empty>В вашей области видимости нет людей.</Empty>;

  return <>
    <div className="tsk-scroll"><table className="tsk-table">
      <thead><tr><th>Человек</th><th>Команды</th><th>Рабочее расписание</th><th>Часы недели</th><th>Свободно</th><th>Переработка</th></tr></thead>
      <tbody>{people.map(person => <tr key={person.id}>
        <td><div className="tsk-person" style={{ cursor: 'default' }}><Avatar user={person} /><div>
          <div className="tsk-person-name">{userName(person)}</div>
          {person.id === me?.id && <div className="tsk-person-sub">это вы</div>}
        </div></div></td>
        <td className="tsk-muted-cell">{person.teams?.map(t => t.name).join(', ') || '—'}</td>
        <td><button className="tsk-schedule-summary" onClick={() => setEditing(person)}>
          {person.workSchedule ? <>
            <span className="tsk-schedule-lines">
              {scheduleGroups(person.workSchedule).map(group => (
                <span className="tsk-schedule-line" key={group.shift}>
                  <b>{group.days}</b>{group.shift}
                </span>
              ))}
            </span>
            <b className="tsk-schedule-edit">Изменить</b>
          </> : <b className="tsk-schedule-edit is-alone">Настроить расписание</b>}
        </button></td>
        <td>{person.workSchedule ? hoursText(person.weeklyHours) : '—'}</td>
        <td>{person.workSchedule ? hoursText(person.freeHours ?? 0) : '—'}</td>
        <td>{person.overloadedDays > 0 ? <Badge tone="bad">{person.overloadedDays} дн.</Badge> : <Badge tone="ok">нет</Badge>}</td>
      </tr>)}</tbody>
    </table></div>
    <Note>Норма каждого рабочего дня равна длительности смены. Встречи и уже запланированные дела уменьшают свободный остаток, выходные не участвуют в расчёте и подборе срока.</Note>
    {editing && <ScheduleModal person={editing} onClose={() => setEditing(null)} onSaved={async () => {
      const own = editing.id === me?.id; setEditing(null); await reload(); if (own) ctx.reloadAccess();
    }} />}
  </>;
}

function ScheduleModal({ person, onClose, onSaved }) {
  const [value, setValue] = useState(() => JSON.parse(JSON.stringify(person.workSchedule || initialSchedule())));
  const [saving, setSaving] = useState(false);
  const update = (key, patch) => setValue(current => ({ ...current, days: { ...current.days,
    [key]: { ...(current.days[key] || {}), ...patch },
  } }));
  const save = async workSchedule => {
    setSaving(true);
    try {
      await api.setSchedule(person.id, workSchedule);
      toast.success(workSchedule ? `Расписание ${userName(person)} сохранено` : `${userName(person)} исключён из планирования`);
      await onSaved();
    } catch (error) { toast.error(error?.response?.data?.error || 'Не удалось сохранить расписание'); }
    finally { setSaving(false); }
  };
  return <div className="tsk-mask" onClick={e => e.target === e.currentTarget && onClose()}>
    <div className="tsk-modal tsk-schedule-modal">
      <div className="tsk-modal-head"><div><div className="tsk-modal-title">Расписание · {userName(person)}</div>
        <div className="tsk-person-sub">Рабочие дни и фактические границы смен</div></div><button className="tsk-x" onClick={onClose}>×</button></div>
      <div className="tsk-modal-body"><div className="tsk-schedule-head"><span>День</span><span>Смена</span></div>
        {DAYS.map(([key, label]) => { const day = value.days[key] || { enabled: false }; return <div className={`tsk-schedule-row ${day.enabled ? '' : 'is-off'}`} key={key}>
          <label className="tsk-schedule-day"><input type="checkbox" checked={!!day.enabled} onChange={e => update(key, e.target.checked
            ? { enabled: true, start: day.start || '09:00', end: day.end || '18:00' }
            : { enabled: false })} /><span>{label}</span></label>
          {day.enabled ? <div className="tsk-time-range"><input className="tsk-input" type="time" value={day.start} onChange={e => update(key, { start: e.target.value })} /><span>—</span><input className="tsk-input" type="time" value={day.end} onChange={e => update(key, { end: e.target.value })} /></div> : <div className="tsk-day-off">Выходной</div>}
        </div>; })}
      </div>
      <div className="tsk-modal-foot"><button className="tsk-btn is-danger" disabled={saving || !person.workSchedule} onClick={() => save(null)}>Не участвовать</button>
        <div className="tsk-modal-btns"><button className="tsk-btn" onClick={onClose}>Отмена</button><button className="tsk-btn is-primary" disabled={saving} onClick={() => save(value)}>{saving ? 'Сохраняем…' : 'Сохранить'}</button></div></div>
    </div>
  </div>;
}
