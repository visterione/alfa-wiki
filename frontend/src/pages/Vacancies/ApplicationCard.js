/**
 * Карточка заявки (ver. 8.20).
 *
 * Три вещи на одном экране: решение по анкете, ход процесса и сама анкета.
 * Разносить их по вкладкам незачем — главврач решает, глядя в анкету, а
 * исполнитель закрывает свой шаг, глядя на то, что человек написал.
 *
 * Анкета показывается целиком: разграничения по полям во втором поколении нет
 * по решению заказчика. Подписи берутся из снимка, который несёт заявка, —
 * из той анкеты, на которую человек отвечал.
 *
 * Именованных стадий нет: при произвольном процессе они врут. Вместо стадии —
 * прогресс по чек-листу и список шагов с их состоянием.
 *
 * Схема над списком (ver. 8.38) — та же, что в конструкторе процесса, только
 * узлы покрашены по состоянию задач. Вторую раскладку для заявки не заводим:
 * две разошлись бы при первой же правке, а вопрос у обеих один — «где мы и что
 * идёт параллельно».
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  X, Check, RotateCcw, Ban, Clock, AlertTriangle, CheckCircle2, Circle, Hand
} from 'lucide-react';

import { vacancies as api, chat, BASE_URL } from '../../services/api';
import ProcessMap from './ProcessMap';

const STATUS_LABELS = {
  draft: 'Заполняется',
  submitted: 'На согласовании',
  revision: 'На доработке',
  rejected: 'Отказ',
  in_progress: 'В работе',
  launched: 'Запущен',
  cancelled: 'Отменена'
};

const STATUS_TONE = {
  launched: 'ok',
  submitted: 'warn',
  revision: 'warn',
  rejected: 'muted',
  cancelled: 'muted',
  draft: 'muted',
  in_progress: 'info'
};

export default function ApplicationCard({ applicationId, onClose, onChanged }) {
  const [data, setData] = useState(null);

  // Подписанный токен к ссылкам на сканы кандидата. Файлы отдаются за guard'ом,
  // а заголовок Authorization в href не подставить — токен идёт в адресе, тем
  // же способом, что у вложений чата. До ver. 8.38 его здесь не было вовсе, и
  // диплом из карточки открывался ответом 401.
  const [fileToken, setFileToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('');
  const [note, setNote] = useState('');
  const [marked, setMarked] = useState([]);

  const load = useCallback(async () => {
    try {
      const res = await api.application(applicationId);
      setData(res.data);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось открыть заявку');
      onClose();
    }
  }, [applicationId, onClose]);

  useEffect(() => { load(); }, [load]);

  // Токен берётся один раз на карточку: он живёт дольше, чем её держат
  // открытой, а без него ссылки просто не откроются — молча, ответом 401.
  useEffect(() => {
    let alive = true;
    chat.getFileToken()
      .then(res => { if (alive) setFileToken(res.data?.token || ''); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  /**
   * Подписи полей второго этапа анкеты — для формы возврата у шага проверки.
   * Возвращают документы, а не анкету целиком, и предлагать юристу отметить
   * «Дата рождения» из первой части незачем: её он и не смотрел.
   */
  const extraLabels = useMemo(() => {
    const form = data?.form;
    const late = new Set(
      (form?.steps || [])
        .filter(step => (step.stage || 'initial') !== 'initial')
        .flatMap(step => step.blocks || [])
    );
    const out = {};
    for (const block of form?.blocks || []) {
      if (!late.has(block.key)) continue;
      if (block.repeat) { out[block.key] = block.title; continue; }
      for (const field of block.fields || []) out[field.key] = field.label;
    }
    return out;
  }, [data]);

  // Закрытие по Escape — карточка открывается поверх списка, и мышь до крестика
  // на узком экране не всегда доходит.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !mode) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, mode]);

  if (!data) {
    return (
      <div className="vac-overlay" onClick={onClose}>
        <div className="vac-card" onClick={e => e.stopPropagation()}>
          <div className="vac-empty">Загружаем…</div>
        </div>
      </div>
    );
  }

  const act = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      toast.success(okText);
      setMode('');
      setNote('');
      setMarked([]);
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  const toggleMark = (key) => {
    setMarked(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  return (
    <div className="vac-overlay" onClick={onClose}>
      <div className="vac-card" onClick={e => e.stopPropagation()}>
        <header className="vac-card-head">
          <div>
            <h2>{data.fullName || 'Заявка без имени'}</h2>
            <div className="vac-sub">
              {data.vacancy?.title} · {data.medCenter?.name}
              {data.phone && <> · {data.phone}</>}
              {data.email && <> · {data.email}</>}
            </div>
          </div>
          <span className={`vac-badge vac-badge-${STATUS_TONE[data.status] || 'muted'}`}>
            {STATUS_LABELS[data.status] || data.status}
          </span>
          <button className="vac-icon" onClick={onClose} title="Закрыть"><X size={18} /></button>
        </header>

        <div className="vac-card-body">
          {data.status === 'revision' && data.decisionNote && (
            <div className="vac-hint">Возвращено на доработку: {data.decisionNote}</div>
          )}
          {data.status === 'rejected' && (
            <div className="vac-hint">Отказ{data.decisionNote ? `: ${data.decisionNote}` : ''}</div>
          )}
          {data.status === 'cancelled' && (
            <div className="vac-hint">Отменена{data.cancelReason ? `: ${data.cancelReason}` : ''}</div>
          )}

          {/* ── Решение ────────────────────────────────────────────────── */}
          {data.canDecide && !mode && (
            <div className="vac-decide">
              <button className="vac-btn" disabled={busy} onClick={() => act(() => api.approve(data.id), 'Заявка согласована')}>
                <Check size={15} />Согласовать
              </button>
              <button className="vac-btn is-ghost" disabled={busy} onClick={() => setMode('revision')}>
                <RotateCcw size={15} />Вернуть на доработку
              </button>
              <button className="vac-btn is-ghost is-danger" disabled={busy} onClick={() => setMode('reject')}>
                <Ban size={15} />Отказать
              </button>
            </div>
          )}

          {mode === 'revision' && (
            <div className="vac-decide-form">
              <b>Что поправить</b>
              <textarea
                className="vac-input"
                rows={3}
                value={note}
                placeholder="Напишите кандидату, что уточнить"
                onChange={e => setNote(e.target.value)}
              />
              <div className="vac-sub">
                Отметьте поля — кандидату подсветятся только они, остальное останется заполненным.
              </div>
              <div className="vac-chips">
                {Object.entries(data.labels).map(([key, label]) => (
                  <button
                    key={key}
                    className={`vac-chip ${marked.includes(key) ? 'is-on' : ''}`}
                    onClick={() => toggleMark(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="vac-editor-acts">
                <button
                  className="vac-btn"
                  disabled={busy || (!note.trim() && !marked.length)}
                  onClick={() => act(() => api.revision(data.id, { note, fields: marked }), 'Отправлено на доработку')}
                >
                  Вернуть кандидату
                </button>
                <button className="vac-btn is-ghost" onClick={() => { setMode(''); setNote(''); setMarked([]); }}>
                  Отмена
                </button>
              </div>
            </div>
          )}

          {mode === 'reject' && (
            <div className="vac-decide-form">
              <b>Причина отказа</b>
              <textarea
                className="vac-input"
                rows={2}
                value={note}
                placeholder="Для своих — кандидату эта строка не уходит"
                onChange={e => setNote(e.target.value)}
              />
              <div className="vac-editor-acts">
                <button
                  className="vac-btn is-danger"
                  disabled={busy}
                  onClick={() => act(() => api.reject(data.id, { reason: note }), 'Отказано')}
                >
                  Отказать
                </button>
                <button className="vac-btn is-ghost" onClick={() => { setMode(''); setNote(''); }}>Отмена</button>
              </div>
            </div>
          )}

          {/* ── Ход процесса ───────────────────────────────────────────── */}
          <div className="vac-sect">
            <span>Ход процесса</span>
            <span className="vac-sub">{data.done} из {data.total}</span>
          </div>

          {data.steps.filter(s => !s.archived).length > 1 && (
            <ProcessMap steps={data.steps} live />
          )}

          <div className="vac-steps-list">
            {data.steps.filter(s => !s.archived || s.task).map(step => (
              <StepRow
                key={step.key}
                step={step}
                extraLabels={extraLabels}
                onChanged={async () => { await load(); onChanged?.(); }}
              />
            ))}
          </div>

          {/* ── Анкета ─────────────────────────────────────────────────── */}
          <div className="vac-sect"><span>Анкета</span></div>
          <Answers
            form={data.form}
            values={data.values}
            files={data.files}
            fileToken={fileToken}
            revisionFields={data.revisionFields}
          />

          {data.consents?.at && (
            <div className="vac-sub" style={{ marginTop: 10 }}>
              Согласия приняты {new Date(data.consents.at).toLocaleString('ru-RU')}
              {data.consents.version ? `, версия текста ${data.consents.version}` : ''}
              {data.consents.ip ? `, адрес ${data.consents.ip}` : ''}.
            </div>
          )}

          {/* ── Журнал ─────────────────────────────────────────────────── */}
          <div className="vac-sect"><span>Журнал</span></div>
          <div className="vac-journal">
            {data.events.map(e => (
              <div className="vac-journal-row" key={e.id}>
                <span className="vac-sub">{new Date(e.createdAt).toLocaleString('ru-RU')}</span>
                <span>{eventText(e)}</span>
                <span className="vac-sub">{e.author?.displayName || ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Шаг процесса с его задачей: взять, проверить, закрыть. */
function StepRow({ step, onChanged, extraLabels = {} }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [check, setCheck] = useState(null);

  // Возврат работы кандидату (ver. 8.38) — вторая кнопка у шага проверки.
  // Отдельное состояние, а не тот же `open`: закрытие и возврат — разные жесты
  // с разными последствиями, и переключатель между ними в одной форме читался
  // бы как «отметить и заодно вернуть».
  const [back, setBack] = useState(false);
  const [marked, setMarked] = useState([]);

  const task = step.task;

  const done = Boolean(task?.completedAt);
  const mine = Boolean(task?.mine);

  const run = async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      if (okText) toast.success(okText);
      await onChanged();
    } catch (error) {
      const data = error.response?.data;
      // Сверка с МИС не «ошибка сервера»: она отдаёт причину, которую человек
      // должен прочитать целиком, а не в исчезающем всплывающем окне.
      if (data?.reason) setCheck(data);
      else toast.error(data?.error || 'Не получилось');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`vac-step-row ${done ? 'is-done' : ''} ${task?.overdue ? 'is-late' : ''} ${step.archived ? 'is-archived' : ''}`}>
      <span className="vac-step-mark">
        {done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
      </span>

      <div className="vac-step-main">
        <b>{step.title}</b>
        {step.hint && <small>{step.hint}</small>}
        {check && (
          <div className="vac-errors" style={{ marginTop: 8 }}>
            <AlertTriangle size={15} />
            <div>
              {check.reason}
              {Boolean(check.missing?.length) && (
                <div className="vac-sub" style={{ marginTop: 6 }}>
                  Не нашлось в МИС: {check.missing.map(m => m.title).join(', ')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="vac-step-state">
        {step.archived && <span className="vac-badge vac-badge-muted">в архиве</span>}
        {done && task?.verifiedByMis && <span className="vac-badge vac-badge-ok">сверено с МИС</span>}
        {done && task?.completer && <span className="vac-sub">{task.completer.displayName}</span>}
        {!done && task?.overdue && (
          <span className="vac-badge vac-badge-warn">
            <Clock size={11} /> просрочка {task.overdueHours} ч
          </span>
        )}
        {!done && task && !task.overdue && task.dueAt && (
          <span className="vac-sub">до {new Date(task.dueAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        )}
        {task?.returned && (
          <span
            className="vac-badge vac-badge-warn"
            title={task.returned.note || 'Работу возвращали кандидату'}
          >
            <RotateCcw size={11} /> возвращали{task.returned.count > 1 ? ` ×${task.returned.count}` : ''}
          </span>
        )}
        {!task && <span className="vac-sub">ждёт своей очереди</span>}
        {!done && task && !task.assigneeIds?.length && step.kind !== 'services_pick' && (
          <span className="vac-badge vac-badge-warn">некому</span>
        )}
      </div>

      {!done && task && mine && (
        <div className="vac-step-acts">
          {task.assigneeIds?.length > 1 && !task.claimedBy && (
            <button className="vac-btn is-ghost" disabled={busy} onClick={() => run(() => api.claimTask(task.id), 'Задача за вами')}>
              <Hand size={14} />Взять
            </button>
          )}
          {!open && !back && (
            <>
              <button className="vac-btn" disabled={busy} onClick={() => setOpen(true)}>Закрыть шаг</button>
              {step.returnTo && (
                <button
                  className="vac-btn is-ghost"
                  disabled={busy}
                  title={`Кандидат заполнит заново: «${step.returnTitle}»`}
                  onClick={() => setBack(true)}
                >
                  <RotateCcw size={14} />Вернуть
                </button>
              )}
            </>
          )}

          {open && (
            <div className="vac-step-close">
              <input
                className="vac-input"
                value={note}
                placeholder="Комментарий (необязательно)"
                onChange={e => setNote(e.target.value)}
              />
              <button
                className="vac-btn"
                disabled={busy}
                onClick={() => run(() => api.completeTask(task.id, { note }), 'Шаг закрыт')}
              >
                Готово
              </button>
              <button className="vac-btn is-ghost" onClick={() => { setOpen(false); setCheck(null); }}>Отмена</button>
            </div>
          )}

          {back && (
            <div className="vac-decide-form">
              <b>Что поправить</b>
              <textarea
                className="vac-input"
                rows={3}
                value={note}
                placeholder="Напишите кандидату, что не так с документами"
                onChange={e => setNote(e.target.value)}
              />

              {Boolean(Object.keys(extraLabels).length) && (
                <>
                  <div className="vac-sub">
                    Отметьте поля — кандидату подсветятся только они, остальное
                    останется заполненным.
                  </div>
                  <div className="vac-chips">
                    {Object.entries(extraLabels).map(([key, label]) => (
                      <button
                        key={key}
                        className={`vac-chip ${marked.includes(key) ? 'is-on' : ''}`}
                        onClick={() => setMarked(prev => (
                          prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
                        ))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="vac-sub">
                Шаг «{step.returnTitle}» откроется кандидату заново, ему уйдёт
                письмо. Эта задача вернётся к вам, когда он пришлёт исправленное.
              </div>

              <div className="vac-editor-acts">
                <button
                  className="vac-btn"
                  disabled={busy || (!note.trim() && !marked.length)}
                  onClick={() => run(
                    () => api.returnTask(task.id, { note, fields: marked }),
                    'Вернули кандидату'
                  )}
                >
                  Вернуть кандидату
                </button>
                <button className="vac-btn is-ghost" onClick={() => { setBack(false); setNote(''); setMarked([]); }}>
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Ответы кандидата.
 *
 * Рисуются по снимку анкеты, а не по нынешнему шаблону: заявка отвечает на ту
 * форму, которую человек открыл, и блок, убранный из шаблона позже, обязан
 * остаться в карточке.
 */
function Answers({ form, values, files, fileToken, revisionFields = [] }) {
  return (
    <div className="vac-answers">
      {(form?.blocks || []).map(block => {
        if (block.repeat) {
          const rows = Array.isArray(values[block.key]) ? values[block.key] : [];
          if (!rows.length) return null;
          return (
            <section key={block.key}>
              <h4>{block.title}</h4>
              {rows.map((row, i) => (
                <div className="vac-answer-row" key={i}>
                  {block.fields.map(f => (
                    row[f.key] === undefined ? null : (
                      <div className="vac-answer" key={f.key}>
                        <span>{f.label}</span>
                        <b>{renderValue(f, row[f.key], files, fileToken)}</b>
                      </div>
                    )
                  ))}
                </div>
              ))}
            </section>
          );
        }

        const filled = block.fields.filter(f => values[f.key] !== undefined);
        if (!filled.length) return null;
        return (
          <section key={block.key}>
            <h4>{block.title}</h4>
            {filled.map(f => (
              <div className={`vac-answer ${revisionFields.includes(f.key) ? 'is-marked' : ''}`} key={f.key}>
                <span>{f.label}</span>
                <b>{renderValue(f, values[f.key], files, fileToken)}</b>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

const DAY_NAMES = { 1: 'пн', 2: 'вт', 3: 'ср', 4: 'чт', 5: 'пт', 6: 'сб', 7: 'вс' };

function renderValue(field, value, files, fileToken) {
  if (field.type === 'checkbox') return value ? 'да' : 'нет';
  if (field.type === 'weekdays') return (value || []).map(d => DAY_NAMES[d]).join(', ');
  if (field.type === 'timerange') return value?.from ? `${value.from}–${value.to}` : '';
  if (field.type === 'speciality') return (value || []).join(', ');
  if (field.type === 'date') return new Date(value).toLocaleDateString('ru-RU');

  if (field.type === 'file' || field.type === 'files') {
    const ids = field.type === 'files' ? (value || []) : [value];
    const own = (files || []).filter(f => ids.includes(f.id));
    if (!own.length) return '—';
    return (
      <span className="vac-answer-files">
        {own.map(f => (
          // Файл отдаётся за guard'ом, и сотруднику нужен подписанный токен в
          // адресе: заголовок Authorization в ссылку не подставить.
          <a
            key={f.id}
            href={`${BASE_URL}/uploads/vacancies/${f.filename}${fileToken ? `?t=${encodeURIComponent(fileToken)}` : ''}`}
            target="_blank"
            rel="noreferrer"
          >
            {f.originalName || f.filename}
          </a>
        ))}
      </span>
    );
  }

  return String(value);
}

const EVENT_TEXT = {
  created: 'Заявка создана',
  submitted: 'Анкета отправлена',
  approved: 'Анкета согласована',
  revision: 'Возвращена на доработку',
  rejected: 'Отказ',
  cancelled: 'Заявка отменена',
  task_opened: 'Открыт шаг',
  task_claimed: 'Задача взята',
  task_completed: 'Шаг закрыт',
  task_unassigned: 'Шаг открыт, но исполнитель не назначен',
  services_invited: 'Отправлено приглашение выбрать услуги',
  services_picked: 'Кандидат отметил услуги',
  extra_invited: 'Отправлено приглашение дозаполнить анкету',
  extra_submitted: 'Кандидат прислал документы',
  returned: 'Работу вернули кандидату',
  return_mailed: 'Отправлено письмо о возврате',
  launched: 'Все шаги закрыты',
  sla_reminded: 'Напоминание о просрочке',
  sla_escalated: 'Просрочка эскалирована',
  decision_missing: 'В процессе нет шага решения'
};

function eventText(event) {
  const base = EVENT_TEXT[event.action] || event.action;
  const step = event.payload?.stepKey;
  return step ? `${base} — ${step}` : base;
}
