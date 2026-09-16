/**
 * Редактор шаблона должности (ver. 8.34).
 *
 * Тот же конструктор, что и у вакансии, но без всего, что привязано к месту и к
 * людям: филиала, исполнителей, чатов, ссылки и состояния набора. Осталось
 * ровно то, что повторяется от вакансии к вакансии, — анкета, процесс и тексты
 * писем.
 *
 * Отдельный экран, а не флажок «это шаблон» в редакторе вакансии: у вакансии
 * половина кнопок означала бы «неприменимо», а объяснять, почему «Открыть
 * набор» ничего не делает, дороже, чем показать список без этой кнопки.
 *
 * Правка шаблона не трогает уже заведённые вакансии. Вакансия получила копию
 * при создании и дальше живёт сама — иначе поправленная сегодня анкета меняла бы
 * форму под руками у кандидата, заполняющего её со вчерашнего дня.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Save, Undo2, Trash2, AlertTriangle } from 'lucide-react';

import { vacancies as api } from '../../services/api';
import FormBuilder, { fromStored, toStored } from './FormBuilder';
import ProcessBuilder from './ProcessBuilder';
import EmailsEditor from './EmailsEditor';

const TABS = [
  { key: 'form', label: 'Анкета' },
  { key: 'process', label: 'Процесс' },
  { key: 'mail', label: 'Письма' }
];

// Шагов, по которым уже заведены задачи, у шаблона не бывает: задачи живут в
// заявках, а заявок у шаблона нет. Значит и запирать в конструкторе нечего.
const NOTHING_LOCKED = new Set();

export default function TemplateEditor({ templateId, meta, onBack, onChanged }) {
  const [template, setTemplate] = useState(null);
  const [tab, setTab] = useState('form');

  const [draft, setDraft] = useState(null);
  const [steps, setSteps] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState([]);

  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.template(templateId);
      setTemplate(data);
      setDraft(fromStored(data.form));
      setSteps((data.process?.steps || []).map(s => ({ ...s, after: s.after || [] })));
      setTitle(data.title);
      setDescription(data.description || '');
      setAttachments(data.attachments || []);
      setErrors([]);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось открыть шаблон');
      onBack();
    } finally {
      setLoading(false);
    }
  }, [templateId, onBack]);

  useEffect(() => { load(); }, [load]);

  // Сравниваем в хранимом виде, а не черновики между собой: в черновике у блока
  // есть служебное поле stepKey, и порядок ключей после правки меняется —
  // построчное сравнение показывало бы правку там, где её нет.
  const savedForm = useMemo(
    () => (template ? JSON.stringify(toStored(fromStored(template.form))) : ''),
    [template]
  );
  const savedProcess = useMemo(
    () => (template ? JSON.stringify((template.process?.steps || []).map(s => ({ ...s, after: s.after || [] }))) : ''),
    [template]
  );

  const formDirty = Boolean(template && draft) && (
    title !== template.title
    || description !== (template.description || '')
    || JSON.stringify(toStored(draft)) !== savedForm
  );
  const processDirty = Boolean(template) && JSON.stringify(steps) !== savedProcess;
  const dirty = formDirty || processDirty;

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const fail = (error, fallback) => {
    const data = error.response?.data;
    setErrors(data?.errors?.length ? data.errors : [data?.error || fallback]);
    toast.error(data?.error || fallback);
  };

  const save = async () => {
    setBusy(true);
    setErrors([]);
    try {
      if (formDirty) await api.saveTemplate(templateId, { title, description, form: toStored(draft) });
      if (processDirty) await api.saveTemplateProcess(templateId, { process: { steps } });
      toast.success('Сохранено');
      await load();
      onChanged?.();
    } catch (error) {
      fail(error, 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const attachFile = async (file) => {
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.addTemplateAttachment(templateId, body);
      setAttachments(prev => [...prev, data]);
      return data;
    } catch (error) {
      toast.error(error.response?.data?.error || 'Файл не загрузился');
      return null;
    }
  };

  const remove = async () => {
    if (!window.confirm(`Удалить шаблон «${template.title}»? Вакансии, заведённые по нему, останутся как есть.`)) return;
    setBusy(true);
    try {
      await api.deleteTemplate(templateId);
      toast.success('Шаблон удалён');
      onChanged?.();
      onBack();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось удалить шаблон');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !draft) return <div className="vac-empty">Загружаем…</div>;

  return (
    <>
      <div className="vac-editor-bar">
        <button className="vac-btn is-ghost" onClick={onBack}><ArrowLeft size={14} />К списку</button>

        <div className="vac-editor-titles">
          <input
            className="vac-input is-title"
            value={title}
            placeholder="Название шаблона — «Врач», «Медицинская сестра»"
            onChange={e => setTitle(e.target.value)}
          />
          <input
            className="vac-input"
            value={description}
            placeholder="Для кого шаблон — видно только здесь, кандидату не показывается"
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        <div className="vac-editor-acts">
          {dirty && <span className="vac-badge vac-badge-warn">Не сохранено</span>}

          <button className="vac-btn" disabled={busy || !dirty} onClick={save}>
            <Save size={14} />Сохранить
          </button>
          <button className="vac-btn is-ghost" disabled={busy || !dirty} onClick={load} title="Вернуть как было">
            <Undo2 size={14} />Отменить
          </button>
          <i className="vac-sep" />

          <button className="vac-icon is-danger" disabled={busy} onClick={remove} title="Удалить шаблон">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="vac-tabs">
        {TABS.map(item => (
          <button key={item.key} className={tab === item.key ? 'is-on' : ''} onClick={() => setTab(item.key)}>
            {item.label}
            {item.key === 'form' && formDirty && <i className="vac-dot" />}
            {item.key === 'process' && processDirty && <i className="vac-dot" />}
          </button>
        ))}
      </div>

      {Boolean(errors.length) && (
        <div className="vac-errors">
          <AlertTriangle size={15} />
          <div>{errors.map((text, i) => <div key={i}>{text}</div>)}</div>
        </div>
      )}

      {tab === 'form' && (
        <FormBuilder
          draft={draft}
          meta={meta}
          attachments={attachments}
          onAttach={attachFile}
          onChange={setDraft}
        />
      )}

      {tab === 'process' && (
        <ProcessBuilder steps={steps} meta={meta} lockedKeys={NOTHING_LOCKED} onChange={setSteps} />
      )}

      {tab === 'mail' && (
        <EmailsEditor
          meta={meta}
          emails={template.emails}
          onSave={emails => api.saveTemplateEmails(templateId, { emails })}
          onPreview={key => api.templateEmailPreview(templateId, key)}
          onSaved={load}
        />
      )}
    </>
  );
}
