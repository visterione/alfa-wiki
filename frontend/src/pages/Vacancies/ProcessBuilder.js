/**
 * Конструктор процесса (ver. 8.20).
 *
 * Шаг описывается тем, кто его выполняет (вид и область), когда он появляется
 * (список предшественников) и за какой срок должен быть закрыт. Ветвлений нет:
 * шаг ждёт всех перечисленных сразу. «Если филиал такой-то, то» превратило бы
 * конструктор в язык программирования, а разные ветки для разных должностей и
 * так выражаются разными шаблонами.
 *
 * Порядок карточек на экране — это не порядок выполнения: его задают
 * зависимости, и четыре шага после создания учётки идут одновременно. Порядок
 * здесь нужен только для чтения, поэтому в свёрнутой карточке написано, чего
 * шаг ждёт, — иначе понять последовательность можно было бы только раскрыв все.
 */

import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, ChevronUp, Plus, Trash2, Archive, ArchiveRestore, Lock
} from 'lucide-react';

import { keyFromLabel } from './FormBuilder';

export default function ProcessBuilder({ steps, meta, lockedKeys, onChange }) {
  const [open, setOpen] = useState(() => new Set());

  const toggle = (key) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const setStep = (index, step) => {
    const next = steps.slice();
    const before = next[index].key;
    next[index] = step;
    // Ключ поменялся — перецепляем всех, кто этот шаг ждал. Иначе правка
    // названия шага молча рвала бы зависимости.
    if (before !== step.key) {
      for (let i = 0; i < next.length; i += 1) {
        if (!next[i].after?.includes(before)) continue;
        next[i] = { ...next[i], after: next[i].after.map(k => (k === before ? step.key : k)) };
      }
    }
    onChange(next);
  };

  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = steps.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const addStep = () => {
    const taken = new Set(steps.map(s => s.key));
    const key = keyFromLabel('Новый шаг', taken);
    // Новый шаг по умолчанию идёт сразу после решения: так он хотя бы появится
    // у кого-то. Шаг, который ничего не ждёт, не возникнет никогда, и человек
    // узнал бы об этом только из ошибки сохранения.
    const decision = steps.find(s => s.kind === 'decision');
    const step = {
      key,
      title: 'Новый шаг',
      kind: 'manual',
      scope: 'branch',
      after: decision ? [decision.key] : [],
      slaHours: 8,
      checklist: 'Шаг закрыт'
    };
    onChange([...steps, step]);
    setOpen(prev => new Set(prev).add(key));
  };

  const addDecision = () => {
    const taken = new Set(steps.map(s => s.key));
    const key = keyFromLabel('Решение', taken);
    const step = {
      key,
      title: 'Согласование анкеты',
      hint: 'Единственная точка, где процесс может встать целиком.',
      kind: 'decision',
      scope: 'branch',
      after: [],
      slaHours: 24,
      checklist: 'Анкета согласована'
    };
    onChange([step, ...steps]);
    setOpen(prev => new Set(prev).add(key));
  };

  const remove = (index) => {
    const step = steps[index];
    const next = steps
      .filter((_, i) => i !== index)
      .map(s => (s.after?.includes(step.key) ? { ...s, after: s.after.filter(k => k !== step.key) } : s));
    onChange(next);
  };

  const hasDecision = steps.some(s => s.kind === 'decision' && !s.archived);

  return (
    <div className="vac-builder">
      <div className="vac-sect">
        <span>Шаги процесса</span>
        <button className="vac-btn is-ghost" onClick={addStep}><Plus size={14} />Добавить шаг</button>
      </div>

      {!hasDecision && (
        <div className="vac-errors">
          <Lock size={15} />
          <div>
            В процессе нет шага решения. С него начинается всё остальное: пока
            анкету не согласовали, задачи не появляются ни у кого.
            <div style={{ marginTop: 8 }}>
              <button className="vac-btn is-ghost" onClick={addDecision}>Добавить шаг решения</button>
            </div>
          </div>
        </div>
      )}

      {!steps.length && <div className="vac-empty">В процессе нет ни одного шага.</div>}

      {steps.map((step, index) => (
        <StepCard
          key={step.key || index}
          step={step}
          steps={steps}
          meta={meta}
          locked={lockedKeys.has(step.key)}
          isOpen={open.has(step.key)}
          onToggle={() => toggle(step.key)}
          onChange={next => setStep(index, next)}
          onMoveUp={() => move(index, -1)}
          onMoveDown={() => move(index, 1)}
          onRemove={() => remove(index)}
          canMoveUp={index > 0}
          canMoveDown={index < steps.length - 1}
        />
      ))}
    </div>
  );
}

function StepCard({
  step, steps, meta, locked, isOpen, onToggle, onChange,
  onMoveUp, onMoveDown, onRemove, canMoveUp, canMoveDown
}) {
  const kindSpec = meta.stepKinds.find(k => k.key === step.kind);
  const others = steps.filter(s => s.key !== step.key && !s.archived);
  const afterTitles = (step.after || [])
    .map(key => steps.find(s => s.key === key)?.title || key);

  // Вид, который уже занят другим шагом, в списке не предлагаем: единственность
  // всё равно проверит сервер, но выбрать заведомо неверное значение и прочитать
  // об этом в ошибке — лишний круг.
  const takenKinds = new Set(
    steps.filter(s => s !== step && !s.archived).map(s => s.kind)
  );
  const kinds = meta.stepKinds.filter(
    k => k.key === step.kind || !k.unique || !takenKinds.has(k.key)
  );

  const toggleAfter = (key) => {
    const after = step.after || [];
    onChange({
      ...step,
      after: after.includes(key) ? after.filter(k => k !== key) : [...after, key]
    });
  };

  return (
    <div className={`vac-block ${isOpen ? 'is-open' : ''} ${step.archived ? 'is-archived' : ''}`}>
      <div className="vac-block-head">
        <button className="vac-icon" onClick={onToggle} title={isOpen ? 'Свернуть' : 'Развернуть'}>
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <input
          className="vac-input is-title"
          value={step.title}
          placeholder="Название шага"
          onChange={e => onChange({ ...step, title: e.target.value })}
        />

        {step.kind !== 'manual' && (
          <span className="vac-badge vac-badge-info">{kindSpec?.label || step.kind}</span>
        )}
        {step.archived && <span className="vac-badge vac-badge-muted">в архиве</span>}
        {locked && (
          <span className="vac-badge vac-badge-warn" title="По шагу есть задачи: ключ не переименовать и шаг не удалить">
            <Lock size={11} /> в работе
          </span>
        )}

        <span className="vac-sub vac-after-note">
          {step.kind === 'decision'
            ? 'начало процесса'
            : afterTitles.length ? `после: ${afterTitles.join(', ')}` : 'ничего не ждёт'}
        </span>

        <button className="vac-icon" title="Выше" disabled={!canMoveUp} onClick={onMoveUp}><ChevronUp size={14} /></button>
        <button className="vac-icon" title="Ниже" disabled={!canMoveDown} onClick={onMoveDown}><ChevronDown size={14} /></button>

        {step.archived ? (
          <button className="vac-icon" title="Вернуть из архива" onClick={() => onChange({ ...step, archived: false })}>
            <ArchiveRestore size={14} />
          </button>
        ) : (
          <button className="vac-icon" title="Убрать в архив: у новых заявок шага не будет, у старых останется" onClick={() => onChange({ ...step, archived: true })}>
            <Archive size={14} />
          </button>
        )}

        <button
          className="vac-icon is-danger"
          title={locked ? 'По шагу есть задачи — только в архив' : 'Удалить шаг'}
          disabled={locked}
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {isOpen && (
        <div className="vac-block-body">
          <div className="vac-row">
            {/* Ключ придумывается один раз при создании шага и из названия
                больше не берётся: он лежит строками в задачах и назначениях,
                и правка заголовка не должна их рвать. */}
            <label className="vac-lab">
              Ключ шага
              <input
                className="vac-input is-key"
                value={step.key}
                disabled={locked}
                title={locked ? 'По шагу есть задачи — ключ менять нельзя' : ''}
                onChange={e => onChange({ ...step, key: e.target.value.trim() })}
              />
            </label>

            <label className="vac-lab">
              Кто выполняет
              <select
                className="vac-input"
                value={step.kind}
                onChange={e => {
                  const next = meta.stepKinds.find(k => k.key === e.target.value);
                  onChange({
                    ...step,
                    kind: e.target.value,
                    scope: next?.forcedScope || (step.scope === 'candidate' ? 'branch' : step.scope)
                  });
                }}
              >
                {kinds.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>

            <label className="vac-lab">
              Исполнитель
              <select
                className="vac-input"
                value={step.scope}
                disabled={Boolean(kindSpec?.forcedScope)}
                onChange={e => onChange({ ...step, scope: e.target.value })}
              >
                {meta.scopes
                  .filter(s => s.key !== 'candidate' || kindSpec?.forcedScope === 'candidate')
                  .map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>

            <label className="vac-lab is-tiny">
              Срок, рабочих часов
              <input
                className="vac-input"
                type="number"
                min="1"
                value={step.slaHours ?? ''}
                onChange={e => onChange({ ...step, slaHours: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </label>
          </div>

          {kindSpec?.hint && <div className="vac-hint">{kindSpec.hint}</div>}

          <div className="vac-row">
            <label className="vac-lab is-wide">
              Строка чек-листа
              <input
                className="vac-input"
                value={step.checklist || ''}
                placeholder="Что именно считается сделанным"
                onChange={e => onChange({ ...step, checklist: e.target.value })}
              />
            </label>
            <label className="vac-lab is-wide">
              Подсказка исполнителю
              <input
                className="vac-input"
                value={step.hint || ''}
                placeholder="необязательно"
                onChange={e => onChange({ ...step, hint: e.target.value })}
              />
            </label>
          </div>

          {kindSpec?.ability && (
            <label className="vac-check">
              <input
                type="checkbox"
                checked={step.blocking !== false}
                onChange={e => onChange({ ...step, blocking: e.target.checked ? undefined : false })}
              />
              Не давать закрыть шаг, пока сверка с МИС не сошлась
            </label>
          )}

          {step.kind !== 'decision' && (
            <>
              <div className="vac-sect" style={{ marginTop: 6 }}><span>Появляется после</span></div>
              <div className="vac-hint">
                Шаг ждёт все отмеченные сразу. Отмечено несколько — задача
                появится, когда закроется последний из них.
              </div>
              <div className="vac-chips">
                {others.map(other => (
                  <button
                    key={other.key}
                    className={`vac-chip ${step.after?.includes(other.key) ? 'is-on' : ''}`}
                    onClick={() => toggleAfter(other.key)}
                  >
                    {other.title || other.key}
                  </button>
                ))}
                {!others.length && <span className="vac-sub">Других шагов пока нет</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
