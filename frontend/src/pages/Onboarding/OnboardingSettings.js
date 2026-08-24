/**
 * Кто отвечает за шаг.
 *
 * Ролей под этот процесс не заводили: исполнитель — конкретный человек, а
 * настройка сводится к таблице «шаг + филиал → люди».
 *
 * В выборе только те, у кого есть доступ к разделу: назначить человека, который
 * раздел не откроет, значит поставить задачу, которую он никогда не увидит.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Building2, Network, AlertTriangle } from 'lucide-react';

import { onboarding as api } from '../../services/api';
import { Badge } from './bits';
import './Onboarding.css';

export default function OnboardingSettings() {
  const [data, setData] = useState(null);
  const [broken, setBroken] = useState([]);
  const [saving, setSaving] = useState('');
  // Филиалов одиннадцать, шагов с филиальным исполнителем шесть — показывать всё
  // сразу значит выкатить экран на семь десятков строк. Врача нанимают в один
  // филиал, и настраивают его тоже по одному.
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
  const branchName = data.medCenters.find(mc => mc.id === currentBranch)?.name || '';

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

  return (
    <>
      {Boolean(broken.length) && (
        <div className="onb-empty" style={{ textAlign: 'left', borderStyle: 'solid' }}>
          <div className="onb-task-head" style={{ marginBottom: 8 }}>
            <AlertTriangle size={15} color="var(--error)" />
            <b>Эти назначения не сработают</b>
          </div>
          <div className="onb-people">
            {broken.map((item, index) => (
              <span className="onb-person is-gone" key={index}>
                {item.user.displayName || item.user.username} · {item.reason}
              </span>
            ))}
          </div>
        </div>
      )}

      {!data.users.length && (
        <div className="onb-empty">
          Доступ к разделу пока никому не выдан.<br />
          Выдайте его в «Пользователи → Модули → Онбординг врача».
        </div>
      )}

      <div className="onb-step-head" style={{ paddingBottom: 4 }}>
        <Building2 size={14} color="var(--text-tertiary)" />
        <b>Филиал</b>
        <select
          className="onb-select"
          value={currentBranch}
          onChange={(e) => setBranch(e.target.value)}
        >
          {data.medCenters.map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
        </select>
      </div>

      {data.steps.map(step => (
        <div className="onb-step" key={step.key}>
          <div className="onb-step-head">
            {step.scope === 'network'
              ? <Network size={14} color="var(--text-tertiary)" />
              : <Building2 size={14} color="var(--text-tertiary)" />}
            <b>{step.title}</b>
            {step.mode === 'race' && <Badge tone="info">кто первый</Badge>}
          </div>

          {step.scope === 'network' ? (
            <AssignRow
              label="Все филиалы"
              users={data.users}
              current={assigneesFor(step.key, null)}
              saving={saving === `${step.key}:net`}
              onSave={(ids) => save(step.key, null, ids)}
            />
          ) : (
            <AssignRow
              label={branchName}
              users={data.users}
              current={assigneesFor(step.key, currentBranch)}
              saving={saving === `${step.key}:${currentBranch}`}
              onSave={(ids) => save(step.key, currentBranch, ids)}
            />
          )}
        </div>
      ))}
    </>
  );
}

function AssignRow({ label, users, current, saving, onSave }) {
  const currentIds = current.map(a => a.userId);

  return (
    <div className="onb-assign">
      <div className="onb-sub">{label}</div>

      <div className="onb-people">
        {current.length
          ? current.map(item => (
              <span className="onb-person" key={item.userId}>
                {item.user?.displayName || item.user?.username}
                <button type="button" onClick={() => onSave(currentIds.filter(id => id !== item.userId))} aria-label="Убрать">
                  <X size={12} />
                </button>
              </span>
            ))
          : <span className="onb-sub">—</span>}
      </div>

      <select
        className="onb-select"
        value=""
        disabled={saving || !users.length}
        onChange={(e) => e.target.value && onSave([...currentIds, e.target.value])}
      >
        <option value="">Добавить</option>
        {users
          .filter(u => !currentIds.includes(u.id))
          .map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}</option>)}
      </select>
    </div>
  );
}
