import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { anketa } from '../../services/api';
import './Anketa.css';

/**
 * Анкета врача по личной ссылке.
 *
 * Поля не свёрстаны руками: форма рисуется по схеме, которую отдаёт бэкенд
 * (services/onboarding/formSchema.js). Схема там же используется для проверки и
 * для срезов по исполнителям, поэтому добавленное поле появляется во всех трёх
 * местах разом, а не в двух из трёх.
 *
 * Черновик сохраняется на сервере, а не только в localStorage: анкету заполняют
 * с телефона в несколько заходов, и потерять её при смене устройства нельзя.
 */

const AUTOSAVE_MS = 1500;

export default function AnketaForm() {
  const { token } = useParams();

  const [meta, setMeta] = useState(null);
  const [state, setState] = useState(null);
  const [form, setForm] = useState({});
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const saveTimer = useRef(null);
  // Первую отрисовку автосохранение пропускает: иначе открытие ссылки само по
  // себе писало бы черновик и сбивало отметку «сохранено».
  const dirty = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [metaRes, appRes] = await Promise.all([anketa.meta(), anketa.load(token)]);
        if (cancelled) return;
        setMeta(metaRes.data);
        setState(appRes.data.application);
        setForm(appRes.data.application.form || {});
        setFiles(appRes.data.files || []);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e.response?.status === 404
            ? 'Анкета не найдена. Проверьте ссылку из письма.'
            : 'Не удалось открыть анкету. Попробуйте обновить страницу.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const scheduleSave = useCallback((nextForm, extra = {}) => {
    dirty.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const { data } = await anketa.saveDraft(token, { form: nextForm, ...extra });
        setSavedAt(data.savedAt);
      } catch {
        // Молча: связь на телефоне рвётся, а следующее нажатие сохранит снова.
        setSavedAt(null);
      }
    }, AUTOSAVE_MS);
  }, [token]);

  const setField = (key, value) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      scheduleSave(next);
      return next;
    });
  };

  const setRepeat = (blockKey, rows) => {
    setForm(prev => {
      const next = { ...prev, [blockKey]: rows };
      scheduleSave(next);
      return next;
    });
  };

  const setMedCenter = (medCenterId) => {
    setState(prev => ({ ...prev, medCenterId }));
    scheduleSave(form, { medCenterId });
  };

  const toggleProfession = (profession) => {
    setState(prev => {
      const current = prev.professions || [];
      const exists = current.some(p => String(p.id) === String(profession.id));
      const next = exists
        ? current.filter(p => String(p.id) !== String(profession.id))
        : [...current, profession];
      scheduleSave(form, { professions: next });
      return { ...prev, professions: next };
    });
  };

  const uploadFile = async (kind, file) => {
    const body = new FormData();
    body.append('file', file);
    body.append('kind', kind);
    try {
      const { data } = await anketa.uploadFile(token, body);
      setFiles(prev => [...prev.filter(f => !(kind === 'photo' && f.kind === 'photo')), data.file]);
    } catch (e) {
      setSubmitError(e.response?.data?.message || 'Не удалось загрузить файл');
    }
  };

  const removeFile = async (fileId) => {
    try {
      await anketa.deleteFile(token, fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch {
      setSubmitError('Не удалось удалить файл');
    }
  };

  const setConsent = async (key, value) => {
    const consents = { ...(state.consents || {}) };
    const payload = {
      pd: Boolean(consents.pd),
      image: Boolean(consents.image),
      [key]: value
    };
    try {
      const { data } = await anketa.setConsents(token, payload);
      setState(prev => ({ ...prev, consents: data.consents }));
    } catch {
      setSubmitError('Не удалось сохранить согласие');
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError('');
    setErrors({});
    clearTimeout(saveTimer.current);

    try {
      // Досохраняем перед отправкой: между последним вводом и нажатием кнопки
      // может пройти меньше, чем пауза автосохранения.
      await anketa.saveDraft(token, {
        form,
        medCenterId: state.medCenterId,
        professions: state.professions
      });
      const { data } = await anketa.submit(token);
      setState(prev => ({ ...prev, status: data.status, editable: false }));
    } catch (e) {
      const payload = e.response?.data;
      if (payload?.errors) {
        const map = {};
        for (const item of payload.errors) map[item.field] = item.message;
        setErrors(map);
        setSubmitError('Анкета заполнена не полностью — посмотрите отмеченные поля.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setSubmitError(payload?.message || 'Не удалось отправить анкету');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <div className="ank"><div className="ank__wrap">
        <div className="ank__note ank__note--bad">{loadError}</div>
      </div></div>
    );
  }
  if (!meta || !state) {
    return <div className="ank"><div className="ank__wrap"><p>Загружаем анкету…</p></div></div>;
  }

  if (!state.editable) {
    return (
      <div className="ank"><div className="ank__wrap">
        <div className="ank__head">
          <h1>Анкета №{state.number}</h1>
          <p>{state.statusLabel}</p>
        </div>
        <div className="ank__note ank__note--ok">
          Анкета отправлена. Ответ придёт на {state.email}.
        </div>
        {state.servicesReady && (
          <div className="ank__card">
            <h2>Выбор услуг</h2>
            <a className="ank__btn" href={`/anketa/${token}/services`}>Открыть список услуг</a>
          </div>
        )}
      </div></div>
    );
  }

  return (
    <div className="ank">
      <div className="ank__wrap">
        <div className="ank__head">
          <h1>Анкета врача</h1>
          <p>Заявка №{state.number}</p>
        </div>

        {state.revisionNote && (
          <div className="ank__note ank__note--warn">
            <b>Нужно поправить:</b> {state.revisionNote}
          </div>
        )}
        {submitError && <div className="ank__note ank__note--bad">{submitError}</div>}

        {meta.blocks.map(block => (
          <Block
            key={block.key}
            block={block}
            form={form}
            state={state}
            meta={meta}
            files={files}
            errors={errors}
            revisionFields={state.revisionFields || []}
            onField={setField}
            onRepeat={setRepeat}
            onMedCenter={setMedCenter}
            onProfession={toggleProfession}
            onUpload={uploadFile}
            onRemoveFile={removeFile}
            onConsent={setConsent}
          />
        ))}

        <div className="ank__bar">
          <span>{savedAt ? 'Сохранено' : 'Сохраняется автоматически'}</span>
          <button className="ank__btn" onClick={submit} disabled={submitting}>
            {submitting ? 'Отправляем…' : 'Отправить на согласование'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Блок схемы ─────────────────────────────────────────────────────────────

function Block(props) {
  const { block, form, state, meta, files, errors, revisionFields } = props;

  return (
    <div className="ank__card">
      <h2>{block.title}</h2>
      {block.hint && <p className="ank__hint">{block.hint}</p>}

      {block.repeat
        ? <RepeatBlock block={block} rows={form[block.key] || []} error={errors[block.key]} onChange={rows => props.onRepeat(block.key, rows)} />
        : block.fields.map(field => (
            <Field
              key={field.key}
              field={field}
              value={form[field.key]}
              state={state}
              meta={meta}
              files={files}
              error={errors[field.key]}
              flagged={revisionFields.includes(field.key)}
              onField={props.onField}
              onMedCenter={props.onMedCenter}
              onProfession={props.onProfession}
              onUpload={props.onUpload}
              onRemoveFile={props.onRemoveFile}
              onConsent={props.onConsent}
            />
          ))}
    </div>
  );
}

function Field(props) {
  const { field, value, state, meta, files, error, flagged } = props;
  const cls = `ank__field${error || flagged ? ' ank__field--bad' : ''}`;

  if (field.type === 'medcenter') {
    return (
      <div className={cls}>
        <label>{field.label}</label>
        <select value={state.medCenterId || ''} onChange={(e) => props.onMedCenter(e.target.value || null)}>
          <option value="">— выберите —</option>
          {meta.medCenters.map(mc => (
            <option key={mc.id} value={mc.id}>{mc.displayName || mc.name}{mc.city ? ` — ${mc.city}` : ''}</option>
          ))}
        </select>
        {error && <div className="ank__err">{error}</div>}
      </div>
    );
  }

  if (field.type === 'professions') {
    const chosen = state.professions || [];
    return (
      <div className={cls}>
        <label>{field.label}</label>
        <select
          value=""
          onChange={(e) => {
            const found = meta.professions.find(p => String(p.id) === e.target.value);
            if (found) props.onProfession(found);
          }}
        >
          <option value="">— добавить специальность —</option>
          {meta.professions
            .filter(p => !chosen.some(c => String(c.id) === String(p.id)))
            .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="ank__chips">
          {chosen.map(p => (
            <span className="ank__chip" key={p.id}>
              {p.name}
              <button type="button" onClick={() => props.onProfession(p)} aria-label="Убрать">×</button>
            </span>
          ))}
        </div>
        {!meta.professions.length && (
          <div className="ank__err">Справочник специальностей сейчас недоступен — попробуйте позже.</div>
        )}
        {error && <div className="ank__err">{error}</div>}
      </div>
    );
  }

  if (field.type === 'file' || field.type === 'files') {
    const kind = { photo: 'photo', diploma: 'diploma', certScans: 'certificate' }[field.key];
    const mine = files.filter(f => f.kind === kind);
    return (
      <div className={cls}>
        <label>{field.label}</label>
        <div className="ank__files">
          {mine.map(file => (
            <div className="ank__file" key={file.id}>
              <span>{file.originalName}</span>
              <button type="button" onClick={() => props.onRemoveFile(file.id)}>Удалить</button>
            </div>
          ))}
        </div>
        <input
          type="file"
          accept={field.accept === 'image' ? 'image/*' : 'image/*,application/pdf'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) props.onUpload(kind, file);
            e.target.value = '';
          }}
        />
        {error && <div className="ank__err">{error}</div>}
      </div>
    );
  }

  if (field.type === 'checkbox') {
    const accepted = Boolean(state.consents?.[field.key]);
    return (
      <label className="ank__check">
        <input type="checkbox" checked={accepted} onChange={(e) => props.onConsent(field.key, e.target.checked)} />
        <span>{field.label}{error && <div className="ank__err">{error}</div>}</span>
      </label>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className={cls}>
        <label>{field.label}</label>
        <textarea
          value={value || ''}
          maxLength={field.max}
          onChange={(e) => props.onField(field.key, e.target.value)}
        />
        {error && <div className="ank__err">{error}</div>}
      </div>
    );
  }

  const inputType = { number: 'number', date: 'date', phone: 'tel' }[field.type] || 'text';
  return (
    <div className={cls}>
      <label>{field.label}</label>
      <input
        type={inputType}
        value={value ?? ''}
        min={field.min}
        max={field.max && field.type === 'number' ? field.max : undefined}
        maxLength={field.type === 'number' ? undefined : field.max}
        onChange={(e) => props.onField(field.key, e.target.value)}
      />
      {error && <div className="ank__err">{error}</div>}
    </div>
  );
}

/**
 * Повторяемый блок: образование, квалификация, сертификаты, труды, конференции,
 * ресурсы. Число записей не ограничено — в бумажной анкете их вписывали от руки
 * столько, сколько есть.
 */
function RepeatBlock({ block, rows, error, onChange }) {
  const add = () => onChange([...rows, {}]);
  const remove = (index) => onChange(rows.filter((_, i) => i !== index));
  const update = (index, key, value) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };

  return (
    <>
      {rows.map((row, index) => (
        <div className="ank__repeat-item" key={index}>
          <button className="ank__repeat-del" type="button" onClick={() => remove(index)}>Удалить</button>
          <div className="ank__row">
            {block.fields.map(field => (
              <div className="ank__field" key={field.key}>
                <label>{field.label}</label>
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={row[field.key] ?? ''}
                  onChange={(e) => update(index, field.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
      {error && <div className="ank__err">{error}</div>}
      <button className="ank__btn ank__btn--ghost" type="button" onClick={add}>Добавить ещё</button>
    </>
  );
}
