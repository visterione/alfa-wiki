/**
 * Анкета кандидата (ver. 8.20).
 *
 * Рисуется по снимку, который заявка носит с собой, а не по нынешнему шаблону:
 * человек отвечает на ту форму, которую открыл. Если анкету в конструкторе
 * поправят, пока он заполняет черновик, под руками у него ничего не поменяется.
 *
 * Шагами, а не одним полотном: у врача четырнадцать блоков, и на телефоне это
 * минута прокрутки — до конца доходили не все. Сохранение при этом идёт по
 * изменению, а не по кнопке «дальше», поэтому уйти можно с любого места и с
 * любого шага.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { vacancyPublic as api } from '../../services/api';
import { PhoneInput, WeekdayPicker, TimeRange, ProfessionPicker, FileField } from './fields';
import './Vacancy.css';

const SAVE_DELAY_MS = 700;

export default function VacancyForm() {
  const { token } = useParams();

  const [state, setState] = useState(null);
  const [values, setValues] = useState({});
  const [files, setFiles] = useState([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState('');
  const [uploading, setUploading] = useState('');
  const [problems, setProblems] = useState([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  // Сохранение откладывается на SAVE_DELAY_MS от последнего нажатия: без этого
  // каждая буква в поле «био» уходила бы отдельным запросом.
  const saveTimer = useRef(null);

  useEffect(() => {
    let alive = true;
    api.load(token)
      .then(({ data }) => {
        if (!alive) return;
        setState(data);
        setValues(data.values || {});
        setFiles(data.files || []);
        setDone(data.status === 'submitted' || data.status === 'in_progress' || data.status === 'launched');
      })
      .catch(err => { if (alive) setLoadError(err.response?.data?.message || 'Заявка не найдена'); });
    return () => { alive = false; clearTimeout(saveTimer.current); };
  }, [token]);

  const save = useCallback(async (next) => {
    setSaveState('saving');
    try {
      await api.saveDraft(token, { values: next });
      setSaveState('saved');
    } catch (err) {
      // Сеть в клинике и в дороге рвётся, и потерять полчаса заполнения из-за
      // одного неудачного автосохранения человек не должен: говорим прямо, что
      // не сохранилось, и оставляем введённое на экране.
      setSaveState('failed');
    }
  }, [token]);

  const change = (key, value) => {
    setValues(prev => {
      const next = { ...prev };
      if (value === undefined || value === null || value === '') delete next[key];
      else next[key] = value;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(next), SAVE_DELAY_MS);
      return next;
    });
  };

  const form = state?.form;
  const steps = useMemo(() => {
    if (!form) return [];
    const byKey = new Map((form.blocks || []).map(b => [b.key, b]));
    return (form.steps || []).map(step => ({
      ...step,
      items: (step.blocks || []).map(key => byKey.get(key)).filter(Boolean)
    }));
  }, [form]);

  if (loadError) {
    return (
      <Shell>
        <h1>Анкета не открылась</h1>
        <p className="vcy-lead">{loadError}</p>
      </Shell>
    );
  }

  if (!state) return <Shell><div className="vcy-note">Загружаем…</div></Shell>;

  if (done) {
    return (
      <Shell state={state}>
        <h1>Анкета отправлена</h1>
        <p className="vcy-lead">
          Спасибо. Мы получили вашу анкету и передали её на рассмотрение —
          о решении напишем на вашу почту.
        </p>
        <p className="vcy-note">Эта ссылка остаётся вашей: по ней анкету можно перечитать.</p>
      </Shell>
    );
  }

  if (!state.editable) {
    return (
      <Shell state={state}>
        <h1>Анкета закрыта</h1>
        <p className="vcy-lead">Эту заявку больше нельзя менять.</p>
      </Shell>
    );
  }

  const step = steps[stepIndex] || steps[0];
  const last = stepIndex === steps.length - 1;

  const submit = async () => {
    setProblems([]);
    setMessage('');
    setSending(true);
    clearTimeout(saveTimer.current);
    try {
      await api.submit(token, { values });
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (err) {
      const data = err.response?.data;
      setProblems(data?.fields || []);
      setMessage(data?.message || 'Не удалось отправить анкету');

      // Незаполненное обязательное поле лежит там, где человек его пропустил, —
      // возможно, на другом шаге. Перебрасываем на первый шаг с ошибкой, иначе
      // сообщение «не заполнено» показывалось бы на экране, где этого поля нет.
      const firstBad = String(data?.fields?.[0] || '').split(/[[.]/)[0];
      const target = steps.findIndex(s => s.items.some(
        b => b.key === firstBad || (b.fields || []).some(f => f.key === firstBad)
      ));
      if (target >= 0) setStepIndex(target);
      window.scrollTo({ top: 0 });
    } finally {
      setSending(false);
    }
  };

  return (
    <Shell state={state}>
      <div className="vcy-progress">
        {steps.map((s, index) => (
          <button
            type="button"
            key={s.key}
            className={index === stepIndex ? 'is-on' : ''}
            onClick={() => setStepIndex(index)}
          >
            {s.title}
          </button>
        ))}
      </div>

      {state.status === 'revision' && (
        <div className="vcy-revision">
          <b>Анкету вернули на доработку</b>
          {state.decisionNote && <p>{state.decisionNote}</p>}
          {Boolean(state.revisionFields?.length) && (
            <p className="vcy-note">Поправить нужно только отмеченное — остальное сохранено.</p>
          )}
        </div>
      )}

      {step?.items.map(block => (
        <Block
          key={block.key}
          block={block}
          values={values}
          files={files}
          professions={state.professions || []}
          problems={problems}
          revisionFields={state.revisionFields || []}
          uploading={uploading}
          onChange={change}
          onUpload={async (field, file) => {
            setUploading(field.key);
            try {
              const body = new FormData();
              body.append('file', file);
              body.append('fieldKey', field.key);
              const { data } = await api.uploadFile(token, body);
              setFiles(prev => [...prev, data.file]);
              // В ответах у файлового поля лежат идентификаторы, а не сами
              // файлы: файл приезжает отдельным запросом, ещё до отправки.
              if (field.type === 'files') {
                change(field.key, [...(values[field.key] || []), data.file.id]);
              } else {
                change(field.key, data.file.id);
              }
            } catch (err) {
              setMessage(err.response?.data?.message || 'Файл не загрузился');
            } finally {
              setUploading('');
            }
          }}
          onRemoveFile={async (field, fileId) => {
            try {
              await api.deleteFile(token, fileId);
              setFiles(prev => prev.filter(f => f.id !== fileId));
              if (field.type === 'files') {
                change(field.key, (values[field.key] || []).filter(id => id !== fileId));
              } else {
                change(field.key, undefined);
              }
            } catch (err) {
              setMessage(err.response?.data?.message || 'Файл не удалился');
            }
          }}
        />
      ))}

      {message && <div className="vcy-error">{message}</div>}

      <div className="vcy-nav">
        <button
          type="button"
          className="vcy-btn is-ghost"
          disabled={stepIndex === 0}
          onClick={() => { setStepIndex(i => i - 1); window.scrollTo({ top: 0 }); }}
        >
          Назад
        </button>

        <span className="vcy-saved">
          {saveState === 'saving' && 'Сохраняем…'}
          {saveState === 'saved' && 'Сохранено'}
          {saveState === 'failed' && 'Не сохранилось — проверьте связь'}
        </span>

        {last ? (
          <button type="button" className="vcy-btn" disabled={sending} onClick={submit}>
            {sending ? 'Отправляем…' : 'Отправить анкету'}
          </button>
        ) : (
          <button
            type="button"
            className="vcy-btn"
            onClick={() => { setStepIndex(i => i + 1); window.scrollTo({ top: 0 }); }}
          >
            Дальше
          </button>
        )}
      </div>
    </Shell>
  );
}

// ── Блок ───────────────────────────────────────────────────────────────────

function Block({
  block, values, files, professions, problems, revisionFields,
  uploading, onChange, onUpload, onRemoveFile
}) {
  if (block.repeat) {
    const rows = Array.isArray(values[block.key]) ? values[block.key] : [];
    const setRow = (index, row) => {
      const next = rows.slice();
      next[index] = row;
      onChange(block.key, next);
    };

    return (
      <section className="vcy-block">
        <h2>{block.title}</h2>
        {block.hint && <p className="vcy-note">{block.hint}</p>}

        {rows.map((row, index) => (
          <div className="vcy-row" key={index}>
            <div className="vcy-row-head">
              <span>Запись {index + 1}</span>
              <button type="button" onClick={() => onChange(block.key, rows.filter((_, i) => i !== index))}>
                Убрать
              </button>
            </div>
            {block.fields.map(field => (
              <Field
                key={field.key}
                field={field}
                value={row[field.key]}
                professions={professions}
                invalid={problems.some(p => p.startsWith(`${block.key}[${index}].${field.key}`))}
                onChange={v => setRow(index, { ...row, [field.key]: v })}
              />
            ))}
          </div>
        ))}

        <button type="button" className="vcy-btn is-ghost" onClick={() => onChange(block.key, [...rows, {}])}>
          Добавить запись
        </button>
      </section>
    );
  }

  return (
    <section className="vcy-block">
      <h2>{block.title}</h2>
      {block.hint && <p className="vcy-note">{block.hint}</p>}

      {block.fields.map(field => (
        <Field
          key={field.key}
          field={field}
          value={values[field.key]}
          professions={professions}
          files={files.filter(f => f.fieldKey === field.key)}
          uploading={uploading === field.key}
          invalid={problems.includes(field.key)}
          highlighted={revisionFields.includes(field.key)}
          onChange={v => onChange(field.key, v)}
          onUpload={file => onUpload(field, file)}
          onRemoveFile={id => onRemoveFile(field, id)}
        />
      ))}
    </section>
  );
}

// ── Поле ───────────────────────────────────────────────────────────────────

function Field({
  field, value, professions, files = [], uploading,
  invalid, highlighted, onChange, onUpload, onRemoveFile
}) {
  const cls = `vcy-field${invalid ? ' is-bad' : ''}${highlighted ? ' is-marked' : ''}`;
  const labelText = <span>{field.label}{field.required && <i className="vcy-req">*</i>}</span>;

  if (field.type === 'checkbox') {
    return (
      <label className={`${cls} is-check`}>
        <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked || undefined)} />
        {labelText}
        {field.hint && <small>{field.hint}</small>}
      </label>
    );
  }

  return (
    <label className={cls}>
      {labelText}

      {field.type === 'text' && (
        <input type="text" maxLength={field.max || 500} value={value || ''} onChange={e => onChange(e.target.value)} />
      )}

      {field.type === 'textarea' && (
        <textarea rows={4} maxLength={field.max || 4000} value={value || ''} onChange={e => onChange(e.target.value)} />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )}

      {field.type === 'date' && (
        <input type="date" value={value || ''} onChange={e => onChange(e.target.value || undefined)} />
      )}

      {field.type === 'phone' && <PhoneInput value={value} invalid={invalid} onChange={onChange} />}

      {field.type === 'weekdays' && <WeekdayPicker value={value} onChange={onChange} />}

      {field.type === 'timerange' && <TimeRange value={value} onChange={onChange} />}

      {field.type === 'professions' && (
        <ProfessionPicker value={value} options={professions} onChange={onChange} />
      )}

      {(field.type === 'file' || field.type === 'files') && (
        <FileField
          field={field}
          files={files}
          busy={uploading}
          onUpload={onUpload}
          onRemove={onRemoveFile}
        />
      )}

      {field.hint && <small>{field.hint}</small>}
    </label>
  );
}

function Shell({ state, children }) {
  return (
    <div className="vcy">
      <div className="vcy-card">
        {state?.vacancy && (
          <div className="vcy-branch">
            {state.vacancy.title}
            {state.branch && <small>{state.branch}</small>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
