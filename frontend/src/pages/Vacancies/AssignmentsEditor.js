/**
 * Кто отвечает за шаг (ver. 8.20).
 *
 * Ролей под процесс не заводим: исполнитель — конкретный человек, а настройка
 * сводится к таблице «шаблон + шаг + филиал → люди». В первом поколении это
 * себя оправдало, и в складском модуле права считаются так же — по факту
 * назначения.
 *
 * Экран устроен по филиалам, а не по шагам целиком: филиалов одиннадцать, шагов
 * с филиальным исполнителем у врача шесть, и всё сразу — это семь десятков
 * строк. Настраивают их тоже по одному филиалу: человека нанимают в конкретный
 * медцентр.
 *
 * Сетевые шаги показываются здесь же, но филиал на них не влияет — у них один
 * исполнитель на всю сеть. Отдельным экраном их не выносим: тогда пришлось бы
 * помнить, какой шаг где настраивается.
 *
 * В списке для выбора — все работающие сотрудники, а не только те, кто может
 * открыть раздел. Назначение исполнителем и право собирать шаблоны — разные
 * вещи: кадровик и маркетолог шаги выполняют, а конструктор им не нужен.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Building2, UserPlus, Network } from 'lucide-react';

import { vacancies as api, BASE_URL } from '../../services/api';

export default function AssignmentsEditor({ templateId }) {
  const [data, setData] = useState(null);
  const [branch, setBranch] = useState('');
  const [saving, setSaving] = useState('');

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.assignments(templateId);
      setData(res);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось загрузить исполнителей');
    }
  }, [templateId]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="vac-empty">Загружаем…</div>;

  const currentBranch = branch || data.medCenters[0]?.id || '';

  const assigneesFor = (stepKey, medCenterId) => data.assignments
    .filter(a => a.stepKey === stepKey && (a.medCenterId || null) === (medCenterId || null));

  const save = async (stepKey, medCenterId, userIds) => {
    setSaving(`${stepKey}:${medCenterId || 'net'}`);
    try {
      await api.saveAssignment(templateId, stepKey, { medCenterId, userIds });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving('');
    }
  };

  const branchSteps = data.steps.filter(s => s.scope === 'branch');
  const networkSteps = data.steps.filter(s => s.scope !== 'branch');

  if (!data.steps.length) {
    return (
      <div className="vac-empty">
        В процессе пока нет шагов с исполнителем.<br />
        Соберите процесс на соседней вкладке — исполнители появятся здесь сами.
      </div>
    );
  }

  return (
    <>
      {Boolean(branchSteps.length) && (
        <>
          <div className="vac-branchbar">
            <Building2 size={15} />
            <span>Филиал</span>
            <select
              className="vac-input"
              value={currentBranch}
              onChange={e => setBranch(e.target.value)}
            >
              {data.medCenters.map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
            </select>
          </div>

          {data.medCenters.length === 0 && (
            <div className="vac-empty">В справочнике нет ни одного работающего филиала.</div>
          )}

          {branchSteps.map(step => (
            <StepAssignees
              key={step.key}
              step={step}
              users={data.users}
              current={assigneesFor(step.key, currentBranch)}
              busy={saving === `${step.key}:${currentBranch}`}
              onSave={ids => save(step.key, currentBranch, ids)}
            />
          ))}
        </>
      )}

      {Boolean(networkSteps.length) && (
        <>
          <div className="vac-branchbar">
            <Network size={15} />
            <span>Общие на сеть — филиал на них не влияет</span>
          </div>

          {networkSteps.map(step => (
            <StepAssignees
              key={step.key}
              step={step}
              users={data.users}
              current={assigneesFor(step.key, null)}
              busy={saving === `${step.key}:net`}
              onSave={ids => save(step.key, null, ids)}
            />
          ))}
        </>
      )}
    </>
  );
}

/**
 * Один шаг и его исполнители.
 *
 * Назначенных может быть несколько — тогда задача видна всем, и работает
 * правило «кто первый взял». Это не запасной вариант на случай отпуска, а
 * штатный: старших сотрудников колл-центра двое, и договариваться, чей
 * сегодня черёд, они не должны.
 */
function StepAssignees({ step, users, current, busy, onSave }) {
  const currentIds = current.map(a => a.userId);
  const free = users.filter(u => !currentIds.includes(u.id));

  return (
    <section className="vac-stepcard">
      <header>
        <b>{step.title}</b>
        {step.hint && <small>{step.hint}</small>}
      </header>

      <div className="vac-assignees">
        {current.map(item => (
          <div className="vac-assignee" key={item.userId}>
            <UserAvatar user={item.user} />
            <div className="vac-assignee-who">
              <b>{item.user?.displayName || item.user?.username || 'сотрудник удалён'}</b>
              {item.user?.position && <small>{item.user.position}</small>}
            </div>
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

        <select
          className="vac-input"
          value=""
          disabled={busy || !free.length}
          onChange={e => e.target.value && onSave([...currentIds, e.target.value])}
        >
          <option value="">{current.length ? 'Добавить исполнителя' : 'Назначить исполнителя'}</option>
          {free.map(u => (
            <option key={u.id} value={u.id}>
              {u.displayName || u.username}{u.position ? ` — ${u.position}` : ''}
            </option>
          ))}
        </select>

        {!current.length && (
          <div className="vac-nobody">
            <UserPlus size={14} />
            Без исполнителя заявки остановятся на этом шаге, и шаблон не опубликовать.
          </div>
        )}
      </div>
    </section>
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
