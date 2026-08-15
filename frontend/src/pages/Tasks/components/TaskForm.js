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

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { tasks as api, users as usersApi, media } from '../../../services/api';
import { today, addDays, dfull, hoursText, estimateText } from '../utils/dates';
import { userName, MODE_LABEL } from '../utils/labels';
import { Avatar, Badge } from './Bits';
import CustomSelect from './CustomSelect';
import { ProjectModal } from './ProjectsAdmin';

const MODES = [
  ['single', 'Один'], ['shared', 'На всех'], ['split', 'По частям'], ['mixed', 'Смешанная'],
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
  const [assigneePool, setAssigneePool] = useState(preset.assignee ? [preset.assignee] : []);

  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [loads, setLoads] = useState({});
  const [choice, setChoice] = useState(null);
  const [explanation, setExplanation] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [slotStep, setSlotStep] = useState(30);
  const [slotRange, setSlotRange] = useState(null);
  const [busySlots, setBusySlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsOpen, setSlotsOpen] = useState(false);
  const fileRef = useRef(null);

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

  const primaryAssignee = parts[0].assignees.length === 1 ? parts[0].assignees[0] : null;
  useEffect(() => {
    setSlotRange(null);
    if (!primaryAssignee || !parts[0].dueDate) {
      setBusySlots([]);
      return;
    }
    let alive = true;
    setSlotsLoading(true);
    api.getPersonSlots(primaryAssignee, parts[0].dueDate)
      .then(({ data }) => { if (alive) setBusySlots(data.slots || []); })
      .catch(() => { if (alive) setBusySlots([]); })
      .finally(() => { if (alive) setSlotsLoading(false); });
    return () => { alive = false; };
  }, [primaryAssignee, parts[0].dueDate]);

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
        if (day.onDayOff) {
          out.push({ userId, date: part.dueDate, reason: 'day_off' });
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

  const updateAssigneePool = next => {
    const unique = [...new Set(next)];
    const nextMode = unique.length > 1 && mode === 'single'
      ? 'shared'
      : unique.length < 2 && mode === 'shared' ? 'single' : mode;
    setAssigneePool(unique);
    if (nextMode !== mode) setMode(nextMode);
    setParts(list => list.map((part, index) => ({
      ...part,
      assignees: nextMode === 'single' && index === 0
        ? unique.slice(0, 1)
        : nextMode === 'shared' && index === 0
          ? unique
          : part.assignees.filter(id => unique.includes(id)),
    })));
  };

  const applyMode = next => {
    setMode(next);
    if (next === 'single') {
      const only = assigneePool.slice(0, 1);
      setAssigneePool(only);
      setParts(list => [{ ...list[0], assignees: only, after: [] }]);
    } else if (next === 'shared') {
      setParts(list => [{ ...list[0], assignees: assigneePool, after: [] }]);
    } else if ((next === 'split' || next === 'mixed') && parts.length < 2) {
      setParts(list => [{ ...list[0], assignees: assigneePool[0] ? [assigneePool[0]] : [] }, {
          key: `p${Date.now()}`,
          title: next === 'mixed' ? 'Сборка и приёмка' : '',
          assignees: next === 'mixed' ? assigneePool : assigneePool[1] ? [assigneePool[1]] : [],
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
        attachments,
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
      const selfTask = parts.length === 1
        && parts[0].assignees.length === 1
        && parts[0].assignees[0] === ctx.me?.id;
      toast.success(selfTask
        ? 'Ваша задача сразу добавлена в календарь'
        : parts.length === 1 && parts[0].assignees.length === 1
          ? 'Отправлено во входящие. В календарь исполнителя задача попадёт после обработки'
        : `Задача создана: ${MODE_LABEL[mode].toLowerCase()}, ${hoursText(totalEffort)} трудозатрат. Каждый получил свою часть`);
      onCreated();
    } catch (error) {
      const payload = error?.response?.data;
      toast.error(payload?.error || 'Не удалось создать задачу');
    } finally {
      setSaving(false);
    }
  };

  const byId = Object.fromEntries(people.map(u => [u.id, u]));
  const projectOptions = [
    { value: '', label: 'Без проекта' },
    ...projects.map(project => ({ value: project.id, label: project.name, color: project.color })),
    ...(ctx.access?.canManageProjects ? [{ value: '__new_project__', label: '+ Создать проект' }] : []),
  ];
  const estimateOptions = ESTIMATES.map(value => ({ value, label: estimateText(value) }));

  const uploadFiles = async event => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    if (attachments.length + files.length > 10) {
      toast.error('К задаче можно прикрепить не больше 10 файлов');
      return;
    }
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of files) {
        const { data } = await media.upload(file);
        uploaded.push({
          id: data.id,
          filename: data.originalName || file.name,
          path: data.path,
          size: data.size || file.size,
          mimeType: data.mimeType || file.type,
        });
      }
      setAttachments(list => [...list, ...uploaded]);
    } catch {
      toast.error('Не удалось прикрепить файл');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const shiftToNextFit = async () => {
    const first = parts[0];
    const userId = first.assignees[0];
    if (!userId) return;
    try {
      const start = addDays(first.dueDate, 1);
      const end = addDays(first.dueDate, 30);
      const { data } = await api.getPersonLoad(userId, start, end);
      const fit = (data.days || []).find(day =>
        !day.onVacation
        && day.norm !== null
        && Number(day.hours) + Number(first.estimateHours) <= Number(day.norm)
      );
      if (!fit) {
        toast.error('В ближайшие 30 дней подходящего окна нет');
        return;
      }
      setChoice('shift');
      setParts(list => list.map(p => ({ ...p, dueDate: fit.date })));
      toast.success(`Срок перенесён на ${dfull(fit.date)} — там задача помещается`);
    } catch {
      toast.error('Не удалось найти свободный день');
    }
  };

  const giveToFreePerson = async () => {
    const first = parts[0];
    const current = new Set(first.assignees);
    try {
      const checks = await Promise.all(people
        .filter(person => !current.has(person.id))
        .map(async person => {
          const { data } = await api.getPersonLoad(person.id, first.dueDate, first.dueDate);
          return { person, day: data.days?.[0] };
        }));
      const fit = checks.find(({ day }) =>
        day && !day.onVacation && day.norm !== null
        && Number(day.hours) + Number(first.estimateHours) <= Number(day.norm)
      );
      if (!fit) {
        toast.error('На этот день свободного исполнителя не найдено');
        return;
      }
      setChoice('give');
      setAssigneePool([fit.person.id]);
      setParts(list => list.map((p, index) => index === 0
        ? { ...p, assignees: [fit.person.id] }
        : p));
      toast.success(`Передано: ${userName(fit.person)}`);
    } catch {
      toast.error('Не удалось проверить загрузку коллег');
    }
  };

  return (
    <div className="tsk-mask" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tsk-modal tsk-task-modal">
        <div className="tsk-modal-head">
          <div className="tsk-modal-title">Новая задача</div>
          <button className="tsk-x" onClick={onClose}>×</button>
        </div>

        <div className="tsk-tabs">
          <button className={tab === 'main' ? 'is-on' : ''} onClick={() => setTab('main')}>Основное</button>
          <button className={tab === 'who' ? 'is-on' : ''} onClick={() => setTab('who')}>
            Части{parts.length > 1 && ` · ${parts.length}`}
          </button>
          <button className={tab === 'scheme' ? 'is-on' : ''} onClick={() => setTab('scheme')}>
            Схема{parts.length > 1 && ` · ${parts.length}`}
          </button>
        </div>

        <div className="tsk-modal-body tsk-task-modal-body">
          {tab === 'main' ? (
            <>
              <input
                className="tsk-input tsk-task-title-input"
                placeholder="Название задачи"
                value={title}
                onChange={e => setTitle(e.target.value)}
                autoFocus
              />

              <div className="tsk-task-fields">
                <CustomSelect label="Проект" value={projectId} options={projectOptions} onChange={value => {
                  if (value === '__new_project__') setProjectFormOpen(true);
                  else setProjectId(value);
                }} />
                <div>
                  <label className="tsk-label">Срок</label>
                  <input
                    className="tsk-input"
                    type="date"
                    value={parts[0].dueDate}
                    onChange={e => setParts(list => list.map(p => ({ ...p, dueDate: e.target.value })))}
                  />
                </div>
                <CustomSelect label="Оценка" value={parts[0].estimateHours} options={estimateOptions}
                  onChange={estimateHours => setPart(0, { estimateHours })} />
              </div>

              <div className="tsk-task-section-head">Исполнитель</div>
              <PeoplePicker people={people} selected={assigneePool} byId={byId}
                onChange={updateAssigneePool} />

              <button type="button" className="tsk-task-disclosure" onClick={() => setSlotsOpen(value => !value)}>
                <span>Время в дне</span><b>{slotRange ? `${estimateText(parts[0].estimateHours)}` : slotsOpen ? 'Скрыть' : 'Выбрать'}</b>
              </button>
              {slotsOpen && <TimeSlots assignee={primaryAssignee} date={parts[0].dueDate} busy={busySlots}
                loading={slotsLoading} step={slotStep} range={slotRange}
                onStep={value => { setSlotStep(value); setSlotRange(null); }}
                onRange={next => { setSlotRange(next); setPart(0, { estimateHours: ((next.end - next.start + 1) * slotStep) / 60 }); }} />}

              <div className="tsk-task-section-head">Описание</div>
              <textarea
                className="tsk-textarea tsk-task-description"
                placeholder="Описание"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />

              <div className="tsk-task-files-head">
                <span>Файлы{attachments.length ? ` · ${attachments.length}` : ''}</span>
                <input ref={fileRef} type="file" multiple hidden onChange={uploadFiles} />
                <button className="tsk-btn is-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? 'Загружаем…' : 'Прикрепить'}
                </button>
              </div>
              {!!attachments.length && (
                <div className="tsk-files">
                  {attachments.map((file, index) => (
                    <div className="tsk-file" key={`${file.id}-${index}`}>
                      <span className="tsk-file-icon">{String(file.filename).split('.').pop()?.slice(0, 4)}</span>
                      <span className="tsk-file-name">{file.filename}</span>
                      <button className="tsk-x" onClick={() => setAttachments(list => list.filter((_, i) => i !== index))}>×</button>
                    </div>
                  ))}
                </div>
              )}

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
                onShift={shiftToNextFit}
                onGive={giveToFreePerson}
              />
            </>
          ) : tab === 'who' ? (
            <>
              <div className="tsk-mode-segment">
                {MODES.map(([key, label]) => <button type="button" key={key}
                  className={mode === key ? 'is-on' : ''} onClick={() => applyMode(key)}>{label}</button>)}
              </div>

              <div className="tsk-task-section-head">
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
                    <CustomSelect value={part.estimateHours} options={estimateOptions} className="is-compact"
                      onChange={estimateHours => setPart(i, { estimateHours })} />
                    <input className="tsk-input" type="date" style={{ maxWidth: 150 }}
                      value={part.dueDate}
                      onChange={e => setPart(i, { dueDate: e.target.value })} />
                    {parts.length > 1 && (
                      <button className="tsk-x"
                        onClick={() => setParts(list => list.filter((_, idx) => idx !== i))}>×</button>
                    )}
                  </div>

                  <PeoplePicker people={people.filter(person => assigneePool.includes(person.id))} selected={part.assignees} byId={byId}
                    single={mode === 'single'} onChange={assignees => setPart(i, { assignees })} />

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

              <div className="tsk-task-total">Итого · {hoursText(totalEffort)}</div>
            </>
          ) : <TaskScheme parts={parts} byId={byId} />}
        </div>

        <div className="tsk-modal-foot tsk-task-modal-foot">
          <div />
          <div className="tsk-modal-btns">
            <button className="tsk-btn" onClick={onClose}>Отмена</button>
            <button className="tsk-btn is-primary" onClick={submit} disabled={!canSend || saving}>
              Создать задачу
            </button>
          </div>
        </div>
      </div>
      {projectFormOpen && <ProjectModal onClose={() => setProjectFormOpen(false)} onSaved={project => {
        setProjects(list => [...list, project].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
        setProjectId(project.id);
        setProjectFormOpen(false);
      }} />}
    </div>
  );
}

function PeoplePicker({ people, selected, byId, single, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const matches = people.filter(person => !selected.includes(person.id)
    && (!query.trim() || userName(person).toLowerCase().includes(query.trim().toLowerCase()))).slice(0, 12);

  useEffect(() => {
    if (!open) return undefined;
    const close = event => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const position = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(window.innerWidth - 16, Math.max(rect.width, 280));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const up = below < 210 && above > below;
      const maxHeight = Math.max(120, Math.min(260, (up ? above : below) - 8));
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setMenuStyle(up
        ? { position: 'fixed', left, bottom: window.innerHeight - rect.top + 6, width, maxHeight }
        : { position: 'fixed', left, top: rect.bottom + 6, width, maxHeight });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);

  const add = userId => {
    onChange(single ? [userId] : [...selected, userId]);
    setQuery('');
    setOpen(false);
  };

  return <div className="tsk-people-picker" ref={rootRef}>
    {!!selected.length && <div className="tsk-picker-selected">
      {selected.map(userId => { const user = byId[userId]; return <div key={userId}>
        <Avatar user={user} size={24} /><span>{userName(user)}</span>
        <button type="button" aria-label={`Убрать ${userName(user)}`}
          onClick={() => onChange(selected.filter(id => id !== userId))}>×</button>
      </div>; })}
    </div>}
    <input className="tsk-input" value={query}
      placeholder={single && selected.length ? 'Заменить исполнителя' : selected.length ? 'Добавить ещё' : 'Найти сотрудника'}
      onFocus={() => { setMenuStyle(null); setOpen(true); }}
      onChange={event => { setQuery(event.target.value); setOpen(true); }} />
    {open && menuStyle && createPortal(<div className="tsk-people-menu" ref={menuRef} style={menuStyle}>
      {matches.length ? matches.map(person => <button type="button" key={person.id}
        onClick={() => add(person.id)}><Avatar user={person} size={26} /><span>{userName(person)}</span></button>)
        : <div className="tsk-people-menu-empty">Никого не найдено</div>}
    </div>, document.body)}
  </div>;
}

function TimeSlots({ assignee, date, busy, loading, step, range, onStep, onRange }) {
  const from = 8;
  const to = 21;
  const count = ((to - from) * 60) / step;
  const cells = Array.from({ length: count }, (_, index) => {
    const startMinutes = from * 60 + index * step;
    const endMinutes = startMinutes + step;
    const occupied = busy.some(slot => {
      const start = new Date(slot.startTime);
      const end = new Date(slot.endTime);
      const slotStart = start.getHours() * 60 + start.getMinutes();
      const slotEnd = end.getHours() * 60 + end.getMinutes();
      return slotStart < endMinutes && slotEnd > startMinutes;
    });
    return { index, startMinutes, occupied };
  });

  const pick = cell => {
    if (cell.occupied) return;
    if (!range || range.done) {
      onRange({ start: cell.index, end: cell.index, done: false });
      return;
    }
    const start = Math.min(range.start, cell.index);
    const end = Math.max(range.start, cell.index);
    if (cells.slice(start, end + 1).some(item => item.occupied)) return;
    onRange({ start, end, done: true });
  };

  const time = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const selectedText = range
    ? `${time(cells[range.start].startMinutes)}–${time(cells[range.end].startMinutes + step)}`
    : 'Выберите интервал';

  if (!assignee) return <div className="tsk-empty is-compact">Выберите одного исполнителя, чтобы увидеть свободные интервалы.</div>;
  if (loading) return <div className="tsk-empty is-compact">Проверяем занятые интервалы…</div>;

  return (
    <div className="tsk-slots-wrap">
      <div className="tsk-slots-tools">
        <span>Шаг сетки</span>
        {[15, 30, 60].map(value => (
          <button key={value} className={`tsk-chip ${step === value ? 'is-on' : ''}`} onClick={() => onStep(value)}>
            {value} мин
          </button>
        ))}
        <b>{selectedText}</b>
      </div>
      <div className="tsk-slots">
        {cells.map(cell => {
          const selected = range && cell.index >= range.start && cell.index <= range.end;
          return (
            <button
              key={cell.index}
              title={`${time(cell.startMinutes)}–${time(cell.startMinutes + step)}`}
              className={`${cell.occupied ? 'is-busy' : ''} ${selected ? 'is-selected' : ''}`}
              onClick={() => pick(cell)}
            >
              {cell.startMinutes % 60 === 0 ? time(cell.startMinutes) : ''}
            </button>
          );
        })}
      </div>
      <div className="tsk-slot-legend">
        <span><i className="is-free" />свободно</span>
        <span><i className="is-busy" />занято</span>
        <span><i className="is-selected" />выбрано</span>
      </div>
    </div>
  );
}

function TaskScheme({ parts, byId }) {
  if (parts.length < 2) {
    return (
      <div className="tsk-empty">
        Схема появится, когда у задачи будет больше одной части.
      </div>
    );
  }

  return (
    <div className="tsk-scheme">
      {parts.map((part, index) => (
        <React.Fragment key={part.key}>
          {index > 0 && <div className="tsk-scheme-arrow">→</div>}
          <div className={`tsk-scheme-node ${part.assignees.length > 1 ? 'is-shared' : ''}`}>
            <div className="tsk-scheme-title">{part.title || `Часть ${index + 1}`}</div>
            <div className="tsk-scheme-meta">
              {part.assignees.map(id => userName(byId[id])).join(', ') || 'без исполнителя'}
              {' · '}{estimateText(part.estimateHours)}
            </div>
            {!!part.after.length && (
              <div className="tsk-scheme-deps">
                после: {part.after.map(id => parts.find(p => p.key === id)?.title || 'предыдущей части').join(', ')}
              </div>
            )}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ─────────────────── разбор загрузки и выбор компромисса ─────────────────── */

function Assessment({ overloads, parts, loads, byId, me, choice, setChoice, explanation, setExplanation, onShift, onGive }) {
  const first = parts[0];
  if (!first.assignees.length) return null;

  if (!overloads.length) {
    const day = loads[`${first.assignees[0]}|${first.dueDate}`];
    return <div className="tsk-assessment is-ok"><b>Помещается</b><span>{day?.norm
      ? `${hoursText(day.hours + Number(first.estimateHours))} из ${hoursText(day.norm)}`
      : 'проверяем загрузку'}</span>{first.assignees[0] === me?.id && <small>сразу в календарь</small>}</div>;
  }

  const vacation = overloads.filter(o => o.reason === 'vacation');
  const dayOff = overloads.filter(o => o.reason === 'day_off');
  const noNorm = overloads.filter(o => o.reason === 'no_norm');
  const over = overloads.filter(o => o.reason === 'overload');

  return (
    <div className="tsk-assessment-panel">
      <div className="tsk-assessment-title">Не помещается</div>
      <div className="tsk-assessment-details">
        {vacation.map(o => (
          <div key={`v${o.userId}`}>
            {userName(byId[o.userId])}: отпуск
          </div>
        ))}
        {dayOff.map(o => <div key={`d${o.userId}`}>{userName(byId[o.userId])}: выходной</div>)}
        {noNorm.map(o => (
          <div key={`n${o.userId}`}>
            {userName(byId[o.userId])}: рабочее расписание не настроено.
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
          <div className="tsk-assessment-actions">
            <button type="button" className={choice === 'shift' ? 'is-on' : ''} onClick={onShift}>Другой день</button>
          {parts.length === 1 && first.assignees.length === 1 && (
            <button type="button" className={choice === 'give' ? 'is-on' : ''} onClick={onGive}>Другой сотрудник</button>
          )}
            <button type="button" className={choice === 'force' ? 'is-on' : ''}
              onClick={() => setChoice('force')}>Всё равно</button>
          </div>

          {choice === 'force' && (
            <textarea
              className="tsk-textarea tsk-force-reason"
              placeholder={`Причина срока ${dfull(first.dueDate)}`}
              value={explanation}
              onChange={e => setExplanation(e.target.value)}
            />
          )}
        </>
      )}
    </div>
  );
}
