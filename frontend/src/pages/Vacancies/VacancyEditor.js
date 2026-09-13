/**
 * Редактор вакансии (ver. 8.21).
 *
 * Одна вакансия — один экран. В 8.20 здесь был редактор шаблона, а сама
 * вакансия правилась в другом месте; ходить между ними оказалось неудобно, и
 * слой шаблонов убран. Теперь на пяти вкладках лежит всё, что нужно, чтобы
 * открыть набор: анкета, процесс, исполнители, письма и ссылки.
 *
 * Анкета и процесс сохраняются по кнопке, а не на каждое нажатие клавиши: схема
 * проверяется целиком, и половина промежуточных состояний правки проверку не
 * проходит («поле только что добавлено, подписи ещё нет»). Автосохранение
 * превратило бы редактор в мигающий список ошибок. Исполнители и чаты, наоборот,
 * сохраняются сразу — там нечего проверять целиком.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Save, Undo2, Trash2, AlertTriangle, Play, Pause, Archive } from 'lucide-react';

import { vacancies as api } from '../../services/api';
import FormBuilder, { fromStored, toStored } from './FormBuilder';
import ProcessBuilder from './ProcessBuilder';
import AssignmentsEditor from './AssignmentsEditor';
import EmailsEditor from './EmailsEditor';
import ShareTab from './ShareTab';

const TABS = [
  { key: 'form', label: 'Анкета' },
  { key: 'process', label: 'Процесс' },
  { key: 'people', label: 'Исполнители' },
  { key: 'mail', label: 'Письма' },
  { key: 'share', label: 'Ссылка и QR' }
];

const STATUS_LABEL = { draft: 'Черновик', open: 'Набор открыт', closed: 'Набор закрыт' };
const STATUS_TONE = { draft: 'muted', open: 'ok', closed: 'warn' };

export default function VacancyEditor({ vacancyId, meta, onBack, onChanged }) {
  const [vacancy, setVacancy] = useState(null);
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
      const { data } = await api.opening(vacancyId);
      setVacancy(data);
      setDraft(fromStored(data.form));
      setSteps((data.process?.steps || []).map(s => ({ ...s, after: s.after || [] })));
      setTitle(data.title);
      setDescription(data.description || '');
      setErrors([]);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось открыть вакансию');
      onBack();
    } finally {
      setLoading(false);
    }
  }, [vacancyId, onBack]);

  useEffect(() => { load(); }, [load]);

  // Сравниваем в хранимом виде, а не черновики между собой: в черновике у блока
  // есть служебное поле stepKey, и порядок ключей в объекте после правки
  // меняется — построчное сравнение показывало бы правку там, где её нет.
  const savedForm = useMemo(
    () => (vacancy ? JSON.stringify(toStored(fromStored(vacancy.form))) : ''),
    [vacancy]
  );
  const savedProcess = useMemo(
    () => (vacancy ? JSON.stringify((vacancy.process?.steps || []).map(s => ({ ...s, after: s.after || [] }))) : ''),
    [vacancy]
  );

  const formDirty = Boolean(vacancy && draft) && (
    title !== vacancy.title
    || description !== (vacancy.description || '')
    || JSON.stringify(toStored(draft)) !== savedForm
  );
  const processDirty = Boolean(vacancy) && JSON.stringify(steps) !== savedProcess;
  const dirty = formDirty || processDirty;

  // Уйти со страницы с несохранённой анкетой на тридцать полей — это потерять
  // полчаса работы, и подтверждение здесь не формальность.
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
      if (formDirty) await api.saveOpening(vacancyId, { title, description, form: toStored(draft) });
      if (processDirty) await api.saveProcess(vacancyId, { process: { steps } });
      toast.success('Сохранено');
      await load();
      onChanged?.();
    } catch (error) {
      fail(error, 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status) => {
    setBusy(true);
    setErrors([]);
    try {
      await api.setStatus(vacancyId, { status });
      toast.success(status === 'open' ? 'Набор открыт' : status === 'closed' ? 'Набор закрыт' : 'Вернули в черновик');
      await load();
      onChanged?.();
    } catch (error) {
      fail(error, 'Не удалось изменить состояние');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Удалить вакансию «${vacancy.title}»? Это нельзя отменить.`)) return;
    setBusy(true);
    try {
      await api.deleteOpening(vacancyId);
      toast.success('Вакансия удалена');
      onChanged?.();
      onBack();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось удалить вакансию');
    } finally {
      setBusy(false);
    }
  };

  const goTab = (next) => {
    // Правки вкладки живут в памяти до «Сохранить», и уход на соседнюю их не
    // теряет — но «Исполнители» и «Ссылка» читают сохранённый процесс, поэтому
    // об этом предупреждаем.
    if ((next === 'people' || next === 'share') && processDirty
      && !window.confirm('Процесс не сохранён. Эта вкладка показывает сохранённый — перейти всё равно?')) return;
    setTab(next);
  };

  if (loading || !draft) return <div className="vac-empty">Загружаем…</div>;

  const lockedKeys = new Set(vacancy.lockedStepKeys || []);

  return (
    <>
      <div className="vac-editor-bar">
        <button className="vac-btn is-ghost" onClick={onBack}><ArrowLeft size={14} />К списку</button>

        <div className="vac-editor-titles">
          <input
            className="vac-input is-title"
            value={title}
            placeholder="Название вакансии — «Врач-терапевт»"
            onChange={e => setTitle(e.target.value)}
          />
          <input
            className="vac-input"
            value={description}
            placeholder="Условия, график, требования — это кандидат видит перед анкетой"
            onChange={e => setDescription(e.target.value)}
          />
          <div className="vac-sub">{vacancy.medCenter?.name}</div>
        </div>

        <div className="vac-editor-acts">
          {dirty && <span className="vac-badge vac-badge-warn">Не сохранено</span>}
          {!dirty && (
            <span className={`vac-badge vac-badge-${STATUS_TONE[vacancy.status]}`}>
              {STATUS_LABEL[vacancy.status]}
            </span>
          )}

          <button className="vac-btn" disabled={busy || !dirty} onClick={save}>
            <Save size={14} />Сохранить
          </button>
          <button className="vac-btn is-ghost" disabled={busy || !dirty} onClick={load} title="Вернуть как было">
            <Undo2 size={14} />Отменить
          </button>

          {vacancy.status !== 'open' && (
            <button
              className="vac-btn is-ghost"
              disabled={busy || dirty}
              onClick={() => setStatus('open')}
              title={dirty ? 'Сначала сохраните правки' : 'Вакансия появится по ссылке и начнёт принимать отклики'}
            >
              <Play size={14} />Открыть набор
            </button>
          )}
          {vacancy.status === 'open' && (
            <button className="vac-btn is-ghost" disabled={busy} onClick={() => setStatus('closed')}>
              <Pause size={14} />Закрыть набор
            </button>
          )}
          {vacancy.status === 'closed' && (
            <button className="vac-btn is-ghost" disabled={busy} onClick={() => setStatus('draft')}>
              <Archive size={14} />В черновик
            </button>
          )}

          {!vacancy.applicationCount && (
            <button className="vac-btn is-ghost is-danger" disabled={busy} onClick={remove}>
              <Trash2 size={14} />Удалить
            </button>
          )}
        </div>
      </div>

      <div className="vac-tabs">
        {TABS.map(item => (
          <button key={item.key} className={tab === item.key ? 'is-on' : ''} onClick={() => goTab(item.key)}>
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

      {vacancy.applicationCount > 0 && tab === 'form' && (
        <div className="vac-hint">
          По вакансии уже подано заявок: {vacancy.applicationCount}. Правки анкеты
          их не затронут — каждая заявка носит копию той анкеты, которую человек
          заполнял.
        </div>
      )}

      {vacancy.applicationCount > 0 && tab === 'process' && (
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

      {tab === 'people' && <AssignmentsEditor vacancyId={vacancyId} />}

      {tab === 'mail' && <EmailsEditor vacancyId={vacancyId} meta={meta} emails={vacancy.emails} onSaved={load} />}

      {tab === 'share' && <ShareTab vacancy={vacancy} />}
    </>
  );
}
