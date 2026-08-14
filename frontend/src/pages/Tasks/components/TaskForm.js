/**
 * Форма постановки задачи.
 *
 * Главное здесь — не поля, а разбор внизу. Если задача не помещается в день
 * исполнителя, автор видит это до отправки и обязан выбрать, что изменится:
 * сдвинуть срок, отдать свободному или продавить с объяснением. Решение
 * принимается здесь, а не всплывает через неделю чередой переносов.
 *
 * Обойти проверку можно всегда — запрет означал бы, что модулем перестанут
 * пользоваться в первый же настоящий аврал. Но не молча: объяснение уходит
 * исполнителю и остаётся в истории задачи.
 */

import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { tasks as api, users as usersApi } from '../../../services/api';
import { today, addDays, dfull, hoursText, estimateText } from '../utils/dates';
import { userName, MODE_LABEL } from '../utils/labels';
import { Avatar, Badge } from './Bits';

const MODES = [
  ['single', 'Один исполнитель', 'Обычная задача: один ответственный, один срок.'],
  ['shared', 'Одна задача на всех', 'Все делают её вместе. Время тратит каждый — трудозатраты умножаются на число участников.'],
  ['split', 'Разделить на части', 'У каждого свой кусок, своя оценка и свой срок.'],
];

const ESTIMATES = [0.5, 1, 1.5, 2, 3, 4, 6, 8];

export default function TaskForm({ preset, ctx, onClose, onCreated }) {
  const [tab, setTab] = useState('main');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [mode, setMode] = useState('single');
  const [parts, setParts] = useState([{
    key: 'p0',
    title: '',
    assignees: preset.assignee ? [preset.assignee] : [],
    estimateHours: 2,
    dueDate: preset.date || addDays(today(), 1),
    after: [],
  }]);

  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [loads, setLoads] = useState({});
  const [choice, setChoice] = useState(null);
  const [explanation, setExplanation] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    usersApi.listBasic().then(r => setPeople(r.data?.users || r.data || [])).catch(() => {});
    api.getProjects().then(r => setProjects(r.data || [])).catch(() => {});
  }, []);

  /**
   * Загрузка каждого исполнителя на его день.
   *
   * Тянется по мере того, как автор выбирает людей и даты: показать «станет 8,2
   * из 6,4 ч» нужно до отправки, иначе весь смысл проверки теряется.
   */
  useEffect(() => {
    const wanted = parts.flatMap(p => p.assignees.map(id => `${id}|${p.dueDate}`));
    const missing = [...new Set(wanted)].filter(k => !(k in loads));
    if (!missing.length) return;

    let alive = true;
    Promise.all(missing.map(async key => {
      const [userId, date] = key.split('|');
      try {
        const { data } = await api.getPersonLoad(userId, date, date);
        return [key, data.days?.[0] || null];
      } catch {
        return [key, null];
      }
    })).then(entries => {
      if (alive) setLoads(prev => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { alive = false; };
  }, [parts, loads]);

  /** Разбор: кто и насколько не помещается. */
  const overloads = useMemo(() => {
    const out = [];
    for (const part of parts) {
      for (const userId of part.assignees) {
        const day = loads[`${userId}|${part.dueDate}`];
        if (!day) continue;
        if (day.onVacation) {
          out.push({ userId, date: part.dueDate, reason: 'vacation' });
          continue;
        }
        if (day.norm === null || day.norm === undefined) {
          out.push({ userId, date: part.dueDate, reason: 'no_norm' });
          continue;
        }
        const after = day.hours + Number(part.estimateHours);
        if (after > day.norm + 1e-9) {
          out.push({ userId, date: part.dueDate, reason: 'overload', after, norm: day.norm, over: after - day.norm });
        }
      }
    }
    return out;
  }, [parts, loads]);

  const totalEffort = parts.reduce(
    (sum, p) => sum + Number(p.estimateHours) * Math.max(p.assignees.length, 1), 0
  );

  const setPart = (i, patch) => setParts(list =>
    list.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const toggleAssignee = (i, userId) => setPart(i, {
    assignees: parts[i].assignees.includes(userId)
      ? parts[i].assignees.filter(x => x !== userId)
      : [...parts[i].assignees, userId],
  });

  const applyMode = next => {
    setMode(next);
    if (next === 'single') {
      setParts(list => [{ ...list[0], assignees: list[0].assignees.slice(0, 1), after: [] }]);
    } else if (next === 'split' && parts.length < 2) {
      setParts(list => [...list, {
        key: `p${Date.now()}`,
        title: '',
        assignees: [],
        estimateHours: 2,
        dueDate: addDays(list[0].dueDate, 2),
        after: [list[0].key],
      }]);
    }
  };

  const canSend = title.trim() && parts.every(p => p.assignees.length && p.dueDate);
  const needsExplanation = overloads.some(o => o.reason === 'overload');

  const submit = async () => {
    if (!canSend) return;
    if (needsExplanation && explanation.trim().length < 8) {
      toast.error('Впишите, почему это всё равно должно быть сделано в этот срок');
      setTab('main');
      return;
    }
    setSaving(true);
    try {
      await api.createTask({
        title: title.trim(),
        description: description.trim() || null,
        projectId: projectId || null,
        explanation: needsExplanation ? explanation.trim() : undefined,
        parts: parts.map(p => ({
          id: p.key,
          title: p.title.trim() || title.trim(),
          assignees: p.assignees,
          estimateHours: Number(p.estimateHours),
          dueDate: p.dueDate,
          after: p.after,
        })),
      });
      toast.success(parts.length === 1 && parts[0].assignees.length === 1
        ? 'Отправлено во входящие. В календарь исполнителя задача попадёт после того, как он её обработает'
        : `Задача создана: ${MODE_LABEL[mode].toLowerCase()}, ${hoursText(totalEffort)} трудозатрат. Каждый получил свою часть`);
      onCreated();
    } catch (error) {
      const payload = error?.response?.data;
      toast.error(payload?.error || 'Не удалось создать задачу');
    } finally {
      setSaving(false);
    }
  };

  const found = people.filter(u => !query || userName(u).toLowerCase().includes(query.toLowerCase()));
  const byId = Object.fromEntries(people.map(u => [u.id, u]));

  return (
    <div className="tsk-mask" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tsk-modal">
        <div className="tsk-modal-head">
          <div className="tsk-modal-title">Новая задача</div>
          <button className="tsk-x" onClick={onClose}>×</button>
        </div>

        <div className="tsk-tabs">
          <button className={tab === 'main' ? 'is-on' : ''} onClick={() => setTab('main')}>Задача</button>
          <button className={tab === 'who' ? 'is-on' : ''} onClick={() => setTab('who')}>
            Исполнители и части{parts.length > 1 && ` · ${parts.length}`}
          </button>
        </div>

        <div className="tsk-modal-body">
          {tab === 'main' ? (
            <>
              <input
                className="tsk-input tsk-input-title"
                placeholder="Название задачи — впишите своими словами"
                value={title}
                onChange={e => setTitle(e.target.value)}
                autoFocus
              />

              <div className="tsk-row" style={{ marginTop: 16 }}>
                <div style={{ maxWidth: 260 }}>
                  <label className="tsk-label">Проект</label>
                  <select className="tsk-select" style={{ width: '100%' }}
                    value={projectId} onChange={e => setProjectId(e.target.value)}>
                    <option value="">Без проекта</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div style={{ maxWidth: 200 }}>
                  <label className="tsk-label">Срок</label>
                  <input
                    className="tsk-input"
                    type="date"
                    value={parts[0].dueDate}
                    onChange={e => setParts(list => list.map(p => ({ ...p, dueDate: e.target.value })))}
                  />
                </div>
                <div style={{ maxWidth: 160 }}>
                  <label className="tsk-label">Оценка</label>
                  <select className="tsk-select" style={{ width: '100%' }}
                    value={parts[0].estimateHours}
                    onChange={e => setPart(0, { estimateHours: Number(e.target.value) })}>
                    {ESTIMATES.map(h => <option key={h} value={h}>{estimateText(h)}</option>)}
                  </select>
                </div>
              </div>

              <div className="tsk-sect">Кому</div>
              <input
                className="tsk-input"
                placeholder="Поиск по имени"
                value={query}
                onChange={e => setQuery(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <div className="tsk-chips">
                <button
                  className={`tsk-chip ${parts[0].assignees.includes(ctx.me?.id) ? 'is-on' : ''}`}
                  onClick={() => toggleAssignee(0, ctx.me?.id)}
                >
                  Моя задача
                </button>
                {found.slice(0, 30).map(u => (
                  <button
                    key={u.id}
                    className={`tsk-chip ${parts[0].assignees.includes(u.id) ? 'is-on' : ''}`}
                    onClick={() => toggleAssignee(0, u.id)}
                  >
                    <Avatar user={u} size={18} />
                    {userName(u)}
                  </button>
                ))}
              </div>

              <div className="tsk-sect">Описание</div>
              <textarea
                className="tsk-textarea"
                placeholder="Опишите задачу так, чтобы исполнителю не пришлось уточнять в чате: что нужно сделать, где данные, что считается результатом."
                value={description}
                onChange={e => setDescription(e.target.value)}
              />

              <Assessment
                overloads={overloads}
                parts={parts}
                loads={loads}
                byId={byId}
                me={ctx.me}
                choice={choice}
                setChoice={setChoice}
                explanation={explanation}
                setExplanation={setExplanation}
                onShiftDate={date => setParts(list => list.map(p => ({ ...p, dueDate: date })))}
              />
            </>
          ) : (
            <>
              <div className="tsk-sect" style={{ marginTop: 0 }}>Формат</div>
              {MODES.map(([key, label, note]) => (
                <div
                  key={key}
                  className={`tsk-opt ${mode === key ? 'is-sel' : ''}`}
                  onClick={() => applyMode(key)}
                >
                  <span className="tsk-opt-radio" />
                  <span>
                    <span className="tsk-opt-title">{label}</span>
                    <span className="tsk-opt-note">{note}</span>
                  </span>
                </div>
              ))}

              <div className="tsk-sect">
                {mode === 'single' ? 'Исполнитель' : `Части задачи · ${parts.length}`}
              </div>

              {parts.map((part, i) => (
                <div className="tsk-part" key={part.key}>
                  <div className="tsk-part-top">
                    <input
                      className="tsk-input"
                      placeholder={parts.length > 1 ? `Название части ${i + 1}` : 'Совпадает с названием задачи'}
                      value={part.title}
                      onChange={e => setPart(i, { title: e.target.value })}
                    />
                    <select className="tsk-select" value={part.estimateHours}
                      onChange={e => setPart(i, { estimateHours: Number(e.target.value) })}>
                      {ESTIMATES.map(h => <option key={h} value={h}>{estimateText(h)}</option>)}
                    </select>
                    <input className="tsk-input" type="date" style={{ maxWidth: 150 }}
                      value={part.dueDate}
                      onChange={e => setPart(i, { dueDate: e.target.value })} />
                    {parts.length > 1 && (
                      <button className="tsk-x"
                        onClick={() => setParts(list => list.filter((_, idx) => idx !== i))}>×</button>
                    )}
                  </div>

                  <div className="tsk-chips">
                    {found.slice(0, 24).map(u => (
                      <button
                        key={u.id}
                        className={`tsk-chip ${part.assignees.includes(u.id) ? 'is-on' : ''}`}
                        onClick={() => toggleAssignee(i, u.id)}
                      >
                        {userName(u)}
                      </button>
                    ))}
                  </div>

                  {part.assignees.length > 1 && (
                    <div style={{ marginTop: 8 }}>
                      <Badge tone="violet">
                        общая · {hoursText(part.estimateHours * part.assignees.length)} суммарно
                      </Badge>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
                        {estimateText(part.estimateHours)} занимают у каждого
                      </span>
                    </div>
                  )}

                  {!part.assignees.length && (
                    <div style={{ fontSize: 12, color: 'var(--error)', marginTop: 8 }}>
                      Не выбран ни один исполнитель
                    </div>
                  )}

                  {/* Связь «после»: часть не появится во входящих, пока
                      предыдущая не завершена. */}
                  {i > 0 && (
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
                      Начинается после:{' '}
                      <span className="tsk-chips" style={{ display: 'inline-flex', marginLeft: 6 }}>
                        {parts.slice(0, i).map(prev => (
                          <button
                            key={prev.key}
                            className={`tsk-chip ${part.after.includes(prev.key) ? 'is-on' : ''}`}
                            onClick={() => setPart(i, {
                              after: part.after.includes(prev.key)
                                ? part.after.filter(x => x !== prev.key)
                                : [...part.after, prev.key],
                            })}
                          >
                            {prev.title || `часть ${parts.indexOf(prev) + 1}`}
                          </button>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {mode !== 'single' && (
                <button className="tsk-btn is-wide" onClick={() => setParts(list => [...list, {
                  key: `p${Date.now()}`,
                  title: '',
                  assignees: [],
                  estimateHours: 1,
                  dueDate: addDays(list[list.length - 1].dueDate, 1),
                  after: [],
                }])}>
                  + Добавить часть
                </button>
              )}

              <div className="tsk-trade is-neutral">
                <div className="tsk-trade-title">
                  Итого: {hoursText(totalEffort)} трудозатрат
                </div>
                <div className="tsk-trade-text">
                  Общая часть занимает время у каждого участника: 2 ч на троих —
                  это 6 ч трудозатрат и 2 ч в календаре у каждого. Проверка
                  загрузки идёт по личной норме каждого, а не по общей цифре.
                </div>
              </div>
            </>
          )}
        </div>

        <div className="tsk-modal-foot">
          <div className="tsk-modal-hint">
            {!title.trim() ? 'Впишите название задачи.'
              : !parts.every(p => p.assignees.length) ? 'У одной из частей нет исполнителя.'
              : needsExplanation ? 'Обойти проверку можно всегда — но не молча. Текст останется в истории задачи.'
              : 'Задача уйдёт во входящие. В календарь исполнителя попадёт после того, как он её обработает.'}
          </div>
          <div className="tsk-modal-btns">
            <button className="tsk-btn" onClick={onClose}>Отмена</button>
            <button className="tsk-btn is-primary" onClick={submit} disabled={!canSend || saving}>
              Создать задачу
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── разбор загрузки и выбор компромисса ─────────────────── */

function Assessment({ overloads, parts, loads, byId, me, choice, setChoice, explanation, setExplanation, onShiftDate }) {
  const first = parts[0];
  if (!first.assignees.length) {
    return (
      <div className="tsk-trade is-neutral">
        <div className="tsk-trade-title">Исполнитель не выбран</div>
        <div className="tsk-trade-text">
          Выберите «Моя задача», найдите человека в поиске выше или откройте
          вкладку «Исполнители и части», чтобы назначить нескольких.
        </div>
      </div>
    );
  }

  if (!overloads.length) {
    const day = loads[`${first.assignees[0]}|${first.dueDate}`];
    return (
      <div className="tsk-trade is-ok">
        <div className="tsk-trade-title">Помещается</div>
        <div className="tsk-trade-text">
          {day && day.norm ? (
            <>У исполнителя станет {hoursText(day.hours + Number(first.estimateHours))} из {hoursText(day.norm)}.
              Свободного останется {hoursText(Math.max(0, day.norm - day.hours - Number(first.estimateHours)))}.</>
          ) : 'Загрузка проверяется по личной норме каждого исполнителя.'}
          {first.assignees[0] === me?.id
            ? ' Задача сразу попадёт к вам во входящие.'
            : ' В календарь исполнителя она попадёт после того, как он её обработает.'}
        </div>
      </div>
    );
  }

  const vacation = overloads.filter(o => o.reason === 'vacation');
  const noNorm = overloads.filter(o => o.reason === 'no_norm');
  const over = overloads.filter(o => o.reason === 'overload');

  return (
    <div className="tsk-trade is-bad">
      <div className="tsk-trade-title">Не помещается</div>
      <div className="tsk-trade-text">
        {vacation.map(o => (
          <div key={`v${o.userId}`}>
            {userName(byId[o.userId])}: в этот день отпуск — выберите другой день или другого человека.
          </div>
        ))}
        {noNorm.map(o => (
          <div key={`n${o.userId}`}>
            {userName(byId[o.userId])}: не задана норма рабочего дня, посчитать загрузку нельзя.
          </div>
        ))}
        {over.map(o => (
          <div key={`o${o.userId}${o.date}`}>
            {userName(byId[o.userId])}: станет <b>{hoursText(o.after)}</b> при норме {hoursText(o.norm)} —
            переработка {hoursText(o.over)}.
          </div>
        ))}
      </div>

      {!!over.length && (
        <>
          <div className="tsk-trade-text">Выберите, что изменится:</div>
          <div
            className={`tsk-opt ${choice === 'shift' ? 'is-sel' : ''}`}
            onClick={() => { setChoice('shift'); onShiftDate(addDays(first.dueDate, 1)); }}
          >
            <span className="tsk-opt-radio" />
            <span>
              <span className="tsk-opt-title">Сдвинуть срок на день вперёд</span>
              <span className="tsk-opt-note">
                {dfull(addDays(first.dueDate, 1))} — загрузка пересчитается сразу
              </span>
            </span>
          </div>
          <div
            className={`tsk-opt ${choice === 'force' ? 'is-sel' : ''}`}
            onClick={() => setChoice('force')}
          >
            <span className="tsk-opt-radio" />
            <span>
              <span className="tsk-opt-title">Поставить всё равно</span>
              <span className="tsk-opt-note">
                Объяснение обязательно — оно уйдёт исполнителю и останется в истории задачи
              </span>
            </span>
          </div>

          {choice === 'force' && (
            <textarea
              className="tsk-textarea"
              style={{ marginTop: 10, minHeight: 70 }}
              placeholder={`Почему это всё равно должно быть сделано ${dfull(first.dueDate)}?`}
              value={explanation}
              onChange={e => setExplanation(e.target.value)}
            />
          )}
        </>
      )}
    </div>
  );
}
