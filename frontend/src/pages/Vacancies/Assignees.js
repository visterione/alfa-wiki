/**
 * Исполнители шагов (ver. 8.20, переработано в 8.21 и 8.36).
 *
 * Ролей под процесс не заводим: исполнитель — конкретный человек, а настройка
 * сводится к таблице «вакансия + шаг + филиал → люди». В первом поколении это
 * себя оправдало, и в складском модуле права считаются так же — по факту
 * назначения.
 *
 * ── Почему это больше не вкладка (ver. 8.36) ────────────────────────────────
 *
 * До 8.36 исполнители жили отдельной вкладкой: на одной собирали процесс, на
 * соседней раздавали шаги людям. Список шагов при этом был на обеих, и человек
 * ходил между ними, сверяя названия. Теперь назначение лежит внутри карточки
 * своего шага — там, где на вопрос «кто это делает» отвечают сразу после «что
 * это за шаг».
 *
 * Одно следствие осталось и его не спрятать: процесс сохраняется кнопкой, а
 * назначения — сразу. Пока шаг не сохранён, назначать на него некого — его
 * ключа ещё нет в базе. Поэтому у таких шагов вместо списка стоит просьба
 * сохранить процесс, а не молча неработающее поле.
 *
 * В списке для выбора — только те, у кого есть доступ к разделу («Вакансии» в
 * правах пользователя). До ver. 8.34 здесь были все сотрудники портала:
 * несколько сотен человек, из которых можно было назначить того, кто раздел не
 * откроет вовсе, — его задача молча протухла бы по сроку.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { X, UserPlus, ShieldAlert, BellRing } from 'lucide-react';

import { vacancies as api, BASE_URL } from '../../services/api';
import UserPicker from './UserPicker';

/**
 * Назначения вакансии: данные и сохранение.
 *
 * Хук, а не компонент: назначения нужны карточкам шагов внутри конструктора
 * процесса, и каждая из них не должна ходить за списком сотрудников сама.
 *
 * Сохраняется сразу, без общей кнопки, — в отличие от процесса и анкеты.
 * Проверять здесь нечего: список людей на шаге осмыслен в любой момент, а
 * держать назначения в черновике значило бы разъехаться с процессом, который
 * уже сохранён.
 */
export function useAssignees(vacancyId) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    if (!vacancyId) return;
    try {
      const { data: res } = await api.assignments(vacancyId);
      setData(res);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось загрузить исполнителей');
    }
  }, [vacancyId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (stepKey, medCenterId, userIds) => {
    setSaving(`${stepKey}:${medCenterId || 'net'}`);
    try {
      await api.saveAssignment(vacancyId, stepKey, { medCenterId, userIds });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving('');
    }
  }, [vacancyId, load]);

  return useMemo(() => {
    if (!data) return null;

    // Шаги, которые сервер уже знает: назначать можно только на них. Ключ
    // несохранённого шага в базе не существует, и назначение ушло бы в никуда.
    const knownKeys = new Set((data.steps || []).map(s => s.key));
    const branchId = data.medCenter?.id || '';

    return {
      data,
      mode: 'vacancy',
      knownKeys,
      saving,
      users: data.users || [],
      // Ни у кого нет доступа к разделу — назначать некого, и сказать об этом
      // нужно один раз сверху, а не в каждой карточке.
      nobodyEligible: !(data.users || []).some(u => u.hasAccess !== false),
      /** Кто назначен: у шага филиала — на филиал вакансии, у сетевого — на сеть. */
      forStep: (stepKey, scope) => {
        const medCenterId = scope === 'branch' ? branchId : null;
        return {
          medCenterId,
          busy: saving === `${stepKey}:${medCenterId || 'net'}`,
          current: (data.assignments || []).filter(
            a => a.stepKey === stepKey && (a.medCenterId || null) === (medCenterId || null)
          )
        };
      },
      save,
      // Перечитать после сохранения процесса: ключи новых шагов сервер узнаёт
      // только оттуда, а до этого назначать на них не на что.
      reload: load
    };
  }, [data, saving, save, load]);
}

/** Общие назначения заготовки; при создании вакансии сервер копирует их на сеть. */
export function useTemplateAssignees(templateId) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');

  const load = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    setErrorText('');
    try {
      const { data: res } = await api.templateAssignments(templateId);
      setData(res);
    } catch (error) {
      const message = error.response?.data?.error || 'Не удалось загрузить исполнителей шаблона';
      setErrorText(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (stepKey, _medCenterId, userIds) => {
    setSaving(stepKey);
    try {
      await api.saveTemplateAssignment(templateId, stepKey, { userIds });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving('');
    }
  }, [templateId, load]);

  return useMemo(() => {
    return {
      data,
      mode: 'template',
      knownKeys: new Set((data?.steps || []).map(step => step.key)),
      saving,
      users: data?.users || [],
      nobodyEligible: Boolean(data) && !(data.users || []).some(user => user.hasAccess !== false),
      loading,
      error: errorText,
      forStep: (stepKey) => ({
        medCenterId: null,
        busy: saving === stepKey,
        current: (data?.assignments || []).filter(item => item.stepKey === stepKey)
      }),
      save,
      reload: load
    };
  }, [data, saving, save, load, loading, errorText]);
}

/**
 * Служебная точка процесса: кому писать о просрочке. Шагом она не является —
 * у неё нет ни задачи, ни строки в чек-листе, — поэтому и стоит отдельно, под
 * списком шагов, а не среди них.
 */
export function EscalationCard({ assignees }) {
  const step = (assignees.data.steps || []).find(s => s.key === '_escalation');
  if (!step) return null;

  const { medCenterId, busy, current } = assignees.forStep(step.key, 'network');

  return (
    <section className="vac-stepcard">
      <header>
        <b><BellRing size={14} /> {step.title}</b>
        {step.hint && <small>{step.hint}</small>}
      </header>
      {/* Пометка своя: здесь ничего не останавливается — эскалация это письмо,
          а не шаг процесса. */}
      <StepAssignees
        assignees={assignees}
        current={current}
        busy={busy}
        onSave={ids => assignees.save(step.key, medCenterId, ids)}
        emptyNote="Не назначен — письма о просрочке никому не уйдут."
      />
    </section>
  );
}

/**
 * Список исполнителей шага.
 *
 * Без своей карточки: он лежит внутри карточки шага в конструкторе процесса и
 * внутри служебной точки эскалации — рамку рисует тот, кто его показывает.
 *
 * Назначенных может быть несколько — тогда задача видна всем, и работает
 * правило «кто первый взял». Это не запасной вариант на случай отпуска, а
 * штатный: старших сотрудников колл-центра двое, и договариваться, чей сегодня
 * черёд, они не должны.
 */
export function StepAssignees({ assignees, current, busy, onSave, emptyNote }) {
  const currentIds = current.map(a => a.userId);
  // Назначить можно только того, у кого есть доступ; потерявшие его приходят в
  // том же списке, чтобы показать их среди уже назначенных, но предлагать их
  // заново нельзя — задача снова уйдёт в никуда.
  const free = assignees.users.filter(u => u.hasAccess !== false && !currentIds.includes(u.id));

  return (
    <div className="vac-assignees">
      {current.map(item => (
        <div className="vac-assignee" key={item.userId}>
          <UserAvatar user={item.user} />
          <div className="vac-assignee-who">
            <b>{item.user?.displayName || item.user?.username || 'сотрудник удалён'}</b>
            {item.user?.position && <small>{item.user.position}</small>}
          </div>
          {item.user && item.user.hasAccess === false && (
            <span
              className="vac-badge vac-badge-warn"
              title="Раздел «Вакансии» человеку не доступен — задачу он не откроет. Выдайте доступ в «Пользователях» или снимите назначение."
            >
              нет доступа
            </span>
          )}
          <button
            className="vac-icon is-danger"
            disabled={busy}
            title="Убрать"
            onClick={() => onSave(currentIds.filter(id => id !== item.userId))}
          >
            <X size={14} />
          </button>
        </div>
      ))}

      <UserPicker
        users={free}
        disabled={busy}
        placeholder={current.length ? 'Добавить исполнителя' : 'Назначить исполнителя'}
        onPick={id => onSave([...currentIds, id])}
      />

      {!current.length && (
        <div className="vac-nobody">
          <UserPlus size={14} />
          {emptyNote || 'Без исполнителя заявки остановятся на этом шаге, и набор не открыть.'}
        </div>
      )}
    </div>
  );
}

/**
 * Исполнители конкретного шага: сам достаёт из назначений то, что относится к
 * этому шагу, и сам решает, на филиал назначение или на сеть.
 */
export function StepAssigneesFor({ assignees, stepKey, scope }) {
  const { medCenterId, busy, current } = assignees.forStep(stepKey, scope);
  const fallback = scope === 'branch' && assignees.mode !== 'template'
    ? assignees.forStep(stepKey, 'network').current
    : [];
  return (
    <>
      {scope === 'branch' && !current.length && Boolean(fallback.length) && (
        <div className="vac-hint">
          Пока не задан отдельный исполнитель филиала, используется общее назначение: {' '}
          {fallback.map(item => item.user?.displayName || item.user?.username || 'сотрудник').join(', ')}.
        </div>
      )}
      <StepAssignees
        assignees={assignees}
        current={current}
        busy={busy}
        onSave={ids => assignees.save(stepKey, medCenterId, ids)}
        emptyNote={fallback.length
          ? 'Общее назначение действует. Новый исполнитель заменит его только в этом филиале.'
          : undefined}
      />
      {scope === 'branch' && current.length > 0 && fallback.length > 0 && (
        <button
          className="vac-btn is-ghost"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => assignees.save(stepKey, medCenterId, [])}
        >
          Вернуть общее назначение
        </button>
      )}
    </>
  );
}

/** Предупреждение о том, что назначать вообще некого. Показывается один раз сверху. */
export function NobodyEligible() {
  return (
    <div className="vac-errors">
      <ShieldAlert size={15} />
      <div>
        Назначать некого: ни у кого нет доступа к разделу «Вакансии».
        Выдайте его в «Пользователях» — права, раздел «Модули».
      </div>
    </div>
  );
}

/** Аватарка с инициалами, когда фото не загружено. */
function UserAvatar({ user }) {
  const name = user?.displayName || user?.username || '';
  const initials = name
    .trim().split(/\s+/).slice(0, 2)
    .map(part => part[0]).join('').toUpperCase() || '•';
  const src = avatarUrl(user?.avatar);

  return (
    <span className="vac-avatar" aria-hidden="true">
      <span>{initials}</span>
      {src && <img src={src} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />}
    </span>
  );
}

function avatarUrl(avatar) {
  if (!avatar) return null;
  // Адрес с localhost остаётся в базе от загрузок на машине разработки: сам
  // файл лежит там же, где и всё остальное, а вот хост в ссылке чужой.
  if (avatar.startsWith('http://localhost')) {
    return `${BASE_URL}/${avatar.replace(/^http:\/\/localhost:\d+\//, '')}`;
  }
  if (avatar.startsWith('http')) return avatar;
  return `${BASE_URL}/${avatar.replace(/^\/+/, '')}`;
}
