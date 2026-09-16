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
 *
 * Наши файлы (ver. 8.34) ведут себя как исполнители, а не как анкета: уезжают
 * при выборе. Поэтому и держатся отдельным состоянием — перечитать вакансию
 * ради одного файла значило бы стереть несохранённую правку анкеты.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Save, Undo2, Trash2, AlertTriangle, Play, Pause, Archive, Copy, Building2 } from 'lucide-react';

import { vacancies as api } from '../../services/api';
import FormBuilder, { fromStored, toStored } from './FormBuilder';
import ProcessBuilder, { fromStoredSteps, toStoredSteps } from './ProcessBuilder';
import MainTab from './MainTab';
import EmailsEditor from './EmailsEditor';
import ShareTab from './ShareTab';
import { fromVacancy as salaryFromVacancy, toPayload as salaryPayload } from './SalaryField';
import { useAssignees } from './Assignees';

// Вкладки идут в порядке сборки вакансии: что предлагаем → что спрашиваем →
// что происходит дальше → чем разговариваем → куда звать.
//
// «Исполнители» отдельной вкладкой были до ver. 8.36: список шагов был и там, и
// в процессе, и человек ходил между ними, сверяя названия. Теперь назначение
// лежит в карточке своего шага.
const TABS = [
  { key: 'main', label: 'Основное' },
  { key: 'form', label: 'Анкета' },
  { key: 'process', label: 'Процесс' },
  { key: 'mail', label: 'Письма' },
  { key: 'share', label: 'Ссылка и QR' }
];

const STATUS_LABEL = { draft: 'Черновик', open: 'Набор открыт', closed: 'Набор закрыт' };
const STATUS_TONE = { draft: 'muted', open: 'ok', closed: 'warn' };

export default function VacancyEditor({ vacancyId, meta, onBack, onChanged }) {
  const [vacancy, setVacancy] = useState(null);
  const [tab, setTab] = useState('main');

  const [draft, setDraft] = useState(null);
  const [steps, setSteps] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [salary, setSalary] = useState({ kind: 'none', from: '', to: '' });

  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  // Наши файлы живут отдельно от черновика анкеты: они уезжают на сервер сразу
  // при выборе, а анкета сохраняется кнопкой. Перечитывать из-за файла всю
  // вакансию нельзя — это стёрло бы несохранённую правку анкеты.
  const [attachments, setAttachments] = useState([]);

  // Назначения живут рядом с процессом, но загружаются здесь: их читает
  // конструктор процесса, и ходить за списком сотрудников из каждой карточки
  // шага незачем.
  const assignees = useAssignees(vacancyId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.opening(vacancyId);
      setVacancy(data);
      // Черновик пересобираем поверх прежнего: так уцелеют идентификаторы
      // строк, а вместе с ними — то, какие блоки были раскрыты.
      setDraft(prev => fromStored(data.form, prev));
      setSteps(fromStoredSteps(data.process?.steps));
      setTitle(data.title);
      setDescription(data.description || '');
      setSalary(salaryFromVacancy(data));
      setAttachments(data.attachments || []);
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
  // Сравниваем в хранимом виде: в черновике у шага есть служебный _uid, и по
  // нему процесс расходился бы с сохранённым всегда.
  const savedProcess = useMemo(
    () => (vacancy ? JSON.stringify(toStoredSteps(fromStoredSteps(vacancy.process?.steps))) : ''),
    [vacancy]
  );

  // Правки «Основного» и анкеты уходят одним PUT — это одна запись в базе, — но
  // точку о несохранённом надо поставить на ту вкладку, где правка лежит.
  const mainDirty = Boolean(vacancy) && (
    title !== vacancy.title
    || description !== (vacancy.description || '')
    || JSON.stringify(salary) !== JSON.stringify(salaryFromVacancy(vacancy))
  );
  const schemaDirty = Boolean(vacancy && draft) && JSON.stringify(toStored(draft)) !== savedForm;
  const formDirty = mainDirty || schemaDirty;
  const processDirty = Boolean(vacancy) && JSON.stringify(toStoredSteps(steps)) !== savedProcess;
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
      if (formDirty) {
        await api.saveOpening(vacancyId, {
          title, description, ...salaryPayload(salary), form: toStored(draft)
        });
      }
      if (processDirty) {
        await api.saveProcess(vacancyId, { process: { steps: toStoredSteps(steps) } });
        // Назначения знают только сохранённые шаги: у нового шага ключа в базе
        // до этого момента не было, и без этой строки карточка продолжала бы
        // просить сохранить уже сохранённое.
        await assignees?.reload();
      }
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

  /**
   * Приём нашего файла. Возвращает строку файла — конструктор по ней ставит
   * ссылку полю; на отказе возвращает null, и поле остаётся как было.
   */
  const attachFile = async (file) => {
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.addAttachment(vacancyId, body);
      setAttachments(prev => [...prev, data]);
      return data;
    } catch (error) {
      toast.error(error.response?.data?.error || 'Файл не загрузился');
      return null;
    }
  };

  /**
   * Вакансия как шаблон.
   *
   * Уезжает сохранённое, а не то, что на экране: шаблон собирается на сервере
   * из того, что лежит в базе. Поэтому с несохранёнными правками не даём — иначе
   * человек получил бы шаблон без последнего часа работы и узнал бы об этом
   * через месяц.
   */
  const saveAsTemplate = async () => {
    if (dirty) {
      toast.error('Сначала сохраните правки — в шаблон уедет сохранённая анкета');
      return;
    }
    const name = window.prompt('Название шаблона', vacancy.title);
    if (!name?.trim()) return;

    setBusy(true);
    try {
      await api.templateFromOpening(vacancyId, { title: name.trim() });
      toast.success('Шаблон сохранён — он в разделе «Шаблоны»');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить шаблон');
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
    // теряет — но «Ссылка и QR» показывает сохранённое состояние вакансии,
    // поэтому об этом предупреждаем.
    if (next === 'share' && processDirty
      && !window.confirm('Процесс не сохранён. Эта вкладка показывает сохранённый — перейти всё равно?')) return;
    setTab(next);
  };

  if (loading || !draft) return <div className="vac-empty">Загружаем…</div>;

  const lockedKeys = new Set(vacancy.lockedStepKeys || []);

  return (
    <>
      <header className="vac-head">
        {/* Верхняя строка отвечает на «где я и что с этой вакансией», нижние
            две — это то, что правят. До ver. 8.34 всё лежало вперемешку в одном
            ряду, и филиал — единственное, чего в вакансии не поменять, — стоял
            в самом низу мелким шрифтом. */}
        <div className="vac-head-top">
          <button className="vac-btn is-ghost" onClick={onBack}><ArrowLeft size={14} />К списку</button>

          <span className="vac-crumb">
            <Building2 size={14} />
            {vacancy.medCenter?.name || 'филиал не указан'}
          </span>

          {dirty
            ? <span className="vac-badge vac-badge-warn">Не сохранено</span>
            : (
              <span className={`vac-badge vac-badge-${STATUS_TONE[vacancy.status]}`}>
                {STATUS_LABEL[vacancy.status]}
              </span>
            )}

          <div className="vac-editor-acts">
            <button className="vac-btn" disabled={busy || !dirty} onClick={save}>
              <Save size={14} />Сохранить
            </button>
            <button className="vac-btn is-ghost" disabled={busy || !dirty} onClick={load} title="Вернуть как было">
              <Undo2 size={14} />Отменить
            </button>

            <i className="vac-sep" />

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

            <i className="vac-sep" />

            <button
              className="vac-btn is-ghost"
              disabled={busy}
              onClick={saveAsTemplate}
              title="Завести шаблон с этой анкетой, процессом и письмами"
            >
              <Copy size={14} />В шаблон
            </button>

            {/* Удаление — редкое и необратимое, поэтому без подписи: подписанная
                кнопка того же веса, что «Сохранить», стоит рядом с ней весь день. */}
            {!vacancy.applicationCount && (
              <button
                className="vac-icon is-danger"
                disabled={busy}
                onClick={remove}
                title="Удалить вакансию"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>

        <input
          className="vac-head-title"
          value={title}
          placeholder="Название вакансии — «Врач-терапевт»"
          onChange={e => setTitle(e.target.value)}
        />
      </header>

      <div className="vac-tabs">
        {TABS.map(item => (
          <button key={item.key} className={tab === item.key ? 'is-on' : ''} onClick={() => goTab(item.key)}>
            {item.label}
            {item.key === 'main' && mainDirty && <i className="vac-dot" />}
            {item.key === 'form' && schemaDirty && <i className="vac-dot" />}
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
          Заявок подано: {vacancy.applicationCount}. Правки анкеты их не затронут.
        </div>
      )}

      {vacancy.applicationCount > 0 && tab === 'process' && (
        <div className="vac-hint">
          Процесс живой: новый шаг появится и у заявок в работе. Шаги с
          заведёнными задачами помечены — их можно только убрать в архив.
        </div>
      )}

      {tab === 'main' && (
        <MainTab
          meta={meta}
          description={description}
          onDescription={setDescription}
          salary={salary}
          onSalary={setSalary}
        />
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
        <ProcessBuilder
          steps={steps}
          meta={meta}
          lockedKeys={lockedKeys}
          assignees={assignees}
          onChange={setSteps}
        />
      )}

      {tab === 'mail' && (
        <EmailsEditor
          meta={meta}
          emails={vacancy.emails}
          onSave={emails => api.saveEmails(vacancyId, { emails })}
          onPreview={key => api.emailPreview(vacancyId, key)}
          onSaved={load}
        />
      )}

      {tab === 'share' && <ShareTab vacancy={vacancy} />}
    </>
  );
}
