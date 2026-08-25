/**
 * Кто отвечает за шаг.
 *
 * Ролей под этот процесс не заводили: исполнитель — конкретный человек, а
 * настройка сводится к таблице «шаг + филиал → люди».
 *
 * Экран устроен по филиалам, а не по шагам целиком: филиалов одиннадцать, шагов
 * с филиальным исполнителем шесть, и всё сразу — это семь десятков строк.
 * Настраивают их тоже по одному: врача нанимают в конкретный медцентр.
 *
 * В выборе только те, у кого есть доступ к разделу. Назначить человека, который
 * раздел не откроет, значит поставить задачу, которую он никогда не увидит.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Building2, AlertTriangle, UserPlus } from 'lucide-react';

import { onboarding as api } from '../../services/api';
import OnbSelect from './OnbSelect';
import { UserAvatar } from './bits';
import './Onboarding.css';

export default function OnboardingSettings() {
  const [data, setData] = useState(null);
  const [broken, setBroken] = useState([]);
  const [saving, setSaving] = useState('');
  const [branch, setBranch] = useState('');

  const load = useCallback(async () => {
    try {
      const [settings, problems] = await Promise.all([api.settings(), api.broken()]);
      setData(settings.data);
      setBroken(problems.data || []);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось загрузить настройки');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="onb-empty">Загружаем…</div>;

  const currentBranch = branch || data.medCenters[0]?.id || '';

  const assigneesFor = (stepKey, medCenterId) => data.assignments
    .filter(a => a.stepKey === stepKey && (a.medCenterId || null) === (medCenterId || null));

  const save = async (stepKey, medCenterId, userIds) => {
    setSaving(`${stepKey}:${medCenterId || 'net'}`);
    try {
      await api.saveStep(stepKey, { medCenterId, userIds });
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving('');
    }
  };

  const userOptions = (exclude) => data.users
    .filter(user => !exclude.includes(user.id))
    .map(user => ({
      value: user.id,
      label: user.displayName || user.username,
      hint: user.position || undefined,
    }));

  return (
    <>
      {Boolean(broken.length) && (
        <div className="onb-alert">
          <AlertTriangle size={16} />
          <div>
            <b>Эти назначения не сработают</b>
            <div className="onb-broken-list">
              {broken.map((item, index) => (
                <div key={index}>
                  <span>{item.user.displayName || item.user.username}</span>
                  <small>{item.reason}</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!data.users.length && (
        <div className="onb-empty">
          Доступ к разделу пока никому не выдан.<br />
          Выдайте его в «Пользователи → Модули → Онбординг врача».
        </div>
      )}

      <div className="onb-branchbar">
        <Building2 size={15} />
        <span>Филиал</span>
        <OnbSelect
          value={currentBranch}
          onChange={setBranch}
          options={data.medCenters.map(mc => ({ value: mc.id, label: mc.name }))}
        />
      </div>

      <div className="onb-steps">
        {data.steps.map(step => {
          const network = step.scope === 'network';
          const medCenterId = network ? null : currentBranch;
          const current = assigneesFor(step.key, medCenterId);
          const currentIds = current.map(a => a.userId);
          const busy = saving === `${step.key}:${medCenterId || 'net'}`;

          return (
            <section className="onb-stepcard" key={step.key}>
              <header className="onb-stepcard-head">
                <b>{step.title}</b>
              </header>

              <div className="onb-assignee-list">
                {current.map(item => (
                  <div className="onb-assignee-row" key={item.userId}>
                    <UserAvatar user={item.user} />
                    <div>
                      <b>{item.user?.displayName || item.user?.username}</b>
                      {item.user?.position && <small>{item.user.position}</small>}
                    </div>
                    <button
                      type="button"
                      aria-label={`Убрать ${item.user?.displayName || item.user?.username}`}
                      onClick={() => save(step.key, medCenterId, currentIds.filter(id => id !== item.userId))}
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}

                <OnbSelect
                  className="onb-assignee-add"
                  value=""
                  placeholder={current.length ? 'Добавить исполнителя' : 'Назначить исполнителя'}
                  disabled={busy || !data.users.length}
                  options={userOptions(currentIds)}
                  onChange={(userId) => save(step.key, medCenterId, [...currentIds, userId])}
                />

                {!current.length && (
                  <div className="onb-nobody">
                    <UserPlus size={14} /> Назначьте исполнителя — без него заявки остановятся на этом шаге.
                  </div>
                )}
              </div>

            </section>
          );
        })}
      </div>
    </>
  );
}
