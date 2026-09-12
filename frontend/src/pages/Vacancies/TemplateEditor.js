/**
 * Редактор шаблона (ver. 8.20).
 *
 * Шаблон — это анкета плюс процесс под одну должность, поэтому вкладок три:
 * «Анкета», «Процесс» и «Исполнители». Вкладка писем приедет вместе с рабочим
 * контуром.
 *
 * Анкета и процесс сохраняются по кнопке, а не на каждое нажатие клавиши.
 * В публичной анкете автосохранение оправдано — её заполняют с телефона в
 * несколько заходов, — а здесь наоборот: схема проверяется целиком, и половина
 * промежуточных состояний правки проверку не проходит («поле только что
 * добавлено, подписи ещё нет»). Автосохранение превратило бы редактор в
 * мигающий список ошибок.
 *
 * Исполнители, наоборот, сохраняются сразу: там нечего проверять целиком —
 * каждая строка самостоятельна.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Save, Send, Undo2, Trash2, AlertTriangle } from 'lucide-react';

import { vacancies as api } from '../../services/api';
import FormBuilder, { fromStored, toStored } from './FormBuilder';
import ProcessBuilder from './ProcessBuilder';
import AssignmentsEditor from './AssignmentsEditor';

const TABS = [
  { key: 'form', label: 'Анкета' },
  { key: 'process', label: 'Процесс' },
  { key: 'people', label: 'Исполнители' }
];

export default function TemplateEditor({ templateId, meta, onBack, onChanged }) {
  const [template, setTemplate] = useState(null);
  const [tab, setTab] = useState('form');

  const [draft, setDraft] = useState(null);
  const [steps, setSteps] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

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
      setErrors([]);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось загрузить шаблон');
      onBack();
    } finally {
      setLoading(false);
    }
  }, [templateId, onBack]);

  useEffect(() => { load(); }, [load]);

  // Сравниваем в хранимом виде, а не черновики между собой: в черновике у блока
  // есть служебное поле stepKey, и порядок ключей в объекте после правки
  // меняется — построчное сравнение показывало бы правку там, где её нет.
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

  // Уйти со страницы с несохранёнными правками анкеты на тридцать полей — это
  // потерять полчаса работы, и подтверждение здесь не формальность.
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
      if (processDirty) await api.saveProcess(templateId, { process: { steps } });
      toast.success('Сохранено');
      await load();
      onChanged?.();
    } catch (error) {
      fail(error, 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const togglePublish = async () => {
    setBusy(true);
    setErrors([]);
    try {
      const { data } = await api.publishTemplate(templateId, { isPublished: !template.isPublished });
      toast.success(data.isPublished ? 'Шаблон опубликован' : 'Шаблон вернулся в черновики');
      await load();
      onChanged?.();
    } catch (error) {
      fail(error, 'Не удалось изменить состояние');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Удалить шаблон «${template.title}»? Это нельзя отменить.`)) return;
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

  const goTab = (next) => {
    // Правки вкладки живут в памяти до «Сохранить», и уход на соседнюю их не
    // теряет — но человек об этом не знает, поэтому спрашиваем только при
    // уходе на «Исполнителей»: она перезагружает процесс с сервера.
    if (next === 'people' && processDirty
      && !window.confirm('Процесс не сохранён. Исполнители показываются по сохранённому — перейти всё равно?')) return;
    setTab(next);
  };

  if (loading || !draft) return <div className="vac-empty">Загружаем…</div>;

  const lockedKeys = new Set(template.lockedStepKeys || []);

  return (
    <>
      <div className="vac-editor-bar">
        <button className="vac-btn is-ghost" onClick={onBack}><ArrowLeft size={14} />К списку</button>

        <div className="vac-editor-titles">
          <input
            className="vac-input is-title"
            value={title}
            placeholder="Должность"
            onChange={e => setTitle(e.target.value)}
          />
          <input
            className="vac-input"
            value={description}
            placeholder="Пометка для себя — кандидат этого не видит"
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        <div className="vac-editor-acts">
          {dirty && <span className="vac-badge vac-badge-warn">Не сохранено</span>}
          {!dirty && template.isPublished && <span className="vac-badge vac-badge-ok">Опубликован</span>}
          {!dirty && !template.isPublished && <span className="vac-badge vac-badge-muted">Черновик</span>}

          <button className="vac-btn" disabled={busy || !dirty} onClick={save}>
            <Save size={14} />Сохранить
          </button>
          <button className="vac-btn is-ghost" disabled={busy || !dirty} onClick={load} title="Вернуть как было">
            <Undo2 size={14} />Отменить
          </button>
          <button
            className="vac-btn is-ghost"
            disabled={busy || dirty}
            onClick={togglePublish}
            title={dirty ? 'Сначала сохраните правки' : ''}
          >
            <Send size={14} />{template.isPublished ? 'В черновики' : 'Опубликовать'}
          </button>
          {!template.applicationCount && !template.vacancyCount && (
            <button className="vac-btn is-ghost is-danger" disabled={busy} onClick={remove}>
              <Trash2 size={14} />Удалить
            </button>
          )}
        </div>
      </div>

      <div className="vac-tabs">
        {TABS.map(item => (
          <button
            key={item.key}
            className={tab === item.key ? 'is-on' : ''}
            onClick={() => goTab(item.key)}
          >
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

      {template.applicationCount > 0 && tab === 'form' && (
        <div className="vac-hint">
          По шаблону уже подано заявок: {template.applicationCount}. Правки анкеты
          их не затронут — каждая заявка носит копию той анкеты, которую человек
          заполнял.
        </div>
      )}

      {template.applicationCount > 0 && tab === 'process' && (
        <div className="vac-hint">
          Процесс живой: новый шаг появится и у тех заявок, что уже в работе.
          Шаги, по которым задачи уже заведены, помечены — их ключ не
          переименовать и сам шаг не удалить, только убрать в архив.
        </div>
      )}

      {tab === 'form' && <FormBuilder draft={draft} meta={meta} onChange={setDraft} />}

      {tab === 'process' && (
        <ProcessBuilder steps={steps} meta={meta} lockedKeys={lockedKeys} onChange={setSteps} />
      )}

      {tab === 'people' && <AssignmentsEditor templateId={templateId} />}
    </>
  );
}
