/**
 * «Команды» — состав и границы видимости.
 *
 * Права ломаются раньше всего остального: приходят подрядчики, смежные отделы,
 * второй филиал — и вопрос «кто видит загрузку соседней команды» становится
 * политическим. Поэтому команда здесь не папка, а граница: филиал, участники,
 * уровень доступа и явный список тех, кто смотрит, не будучи участником.
 */

import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { tasks as api, users as usersApi, medCenters as medCentersApi } from '../../../services/api';
import { ACCESS_LABEL, TEAM_ROLE_LABEL, userName } from '../utils/labels';
import { Avatar, Badge, Empty, Note } from './Bits';

export default function TeamsAdmin({ ctx }) {
  const [teams, setTeams] = useState([]);
  const [closed, setClosed] = useState(0);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.getTeams();
      setTeams(data.teams || []);
      setClosed(data.closedCount || 0);
    } catch {
      toast.error('Не удалось получить команды');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (loading) return <Empty compact>Загружаем…</Empty>;

  return (
    <>
      <div className="tsk-ctl">
        <button className="tsk-btn is-primary" onClick={() => setEditing({ isNew: true })}>
          Создать команду
        </button>
      </div>

      {!teams.length ? (
        <Empty>Пока нет ни одной команды, доступной вам.</Empty>
      ) : teams.map(team => (
        <div className={`tsk-card ${team.isHidden ? 'is-hidden' : ''}`} key={team.id} style={{ marginBottom: 12 }}>
          <div className="tsk-team-head" style={{ marginBottom: 8 }}>
            <div>
              <div className="tsk-team-name">
                {team.name}
                {team.isHidden && <Badge tone="warn">скрытая</Badge>}
                <Badge tone={team.access === 'all' ? 'ok' : team.access === 'members' ? 'info' : 'violet'}>
                  {ACCESS_LABEL[team.access]}
                </Badge>
              </div>
              <div className="tsk-team-sub">
                {(team.members || []).length} чел.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              <button className="tsk-btn is-sm" onClick={() => ctx.go('load')}>Загрузка</button>
              {(team.isLead || ctx.access?.isAdmin) && (
                <button className="tsk-btn is-sm" onClick={() => setEditing({ id: team.id })}>Настроить</button>
              )}
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            Кто видит загрузку: <b style={{ color: 'var(--text-primary)' }}>{
              team.access === 'all'
                ? 'все сотрудники компании'
                : team.access === 'members'
                  ? 'участники и наблюдатели'
                  : 'только приглашённые наблюдатели'
            }</b>
            {' · '}В списках и поиске: <b style={{ color: 'var(--text-primary)' }}>
              {team.isHidden ? 'не показывается' : 'показывается'}
            </b>
          </div>
        </div>
      ))}

      <Note>
        Скрытая команда не показывается как «нет доступа» — её просто нет в
        интерфейсе того, кому она не открыта. Разница принципиальная: строка
        «нет доступа» сама сообщает, что команда существует, а по названию
        дальше всё понятно и без доступа.
        {closed > 0 && ` Закрытых для вас команд: ${closed}.`}
      </Note>

      {editing && (
        <TeamModal
          teamId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

/* ─────────────────────────── настройка команды ─────────────────────────── */

function TeamModal({ teamId, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', medCenterId: '', access: 'all', isHidden: false, members: [],
  });
  const [allUsers, setAllUsers] = useState([]);
  const [centers, setCenters] = useState([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // listBasic, а не list: полный список пользователей закрыт админским правом,
    // а для выбора участников достаточно имени и аватарки.
    usersApi.listBasic().then(r => setAllUsers(r.data?.users || r.data || [])).catch(() => {});
    medCentersApi.list().then(r => setCenters(r.data?.medCenters || r.data || [])).catch(() => {});
    if (teamId) {
      api.getTeam(teamId).then(r => setForm({
        name: r.data.name,
        medCenterId: r.data.medCenterId || '',
        access: r.data.access,
        isHidden: r.data.isHidden,
        members: r.data.members || [],
      })).catch(() => toast.error('Не удалось открыть команду'));
    }
  }, [teamId]);

  const toggle = (userId, role) => setForm(f => {
    const exists = f.members.find(m => m.userId === userId);
    if (exists && exists.role === role) {
      return { ...f, members: f.members.filter(m => m.userId !== userId) };
    }
    return {
      ...f,
      members: [...f.members.filter(m => m.userId !== userId), { userId, role }],
    };
  });

  const save = async () => {
    if (!form.name.trim()) { toast.error('Нужно название команды'); return; }
    setSaving(true);
    try {
      if (teamId) {
        await api.updateTeam(teamId, form);
        // Состав правится отдельными вызовами: так изменение одного человека
        // не переписывает весь список и не затирает чужую параллельную правку.
        const before = (await api.getTeam(teamId)).data.members || [];
        for (const m of form.members) {
          const was = before.find(b => b.userId === m.userId);
          if (!was || was.role !== m.role) await api.addTeamMember(teamId, m);
        }
        for (const b of before) {
          if (!form.members.find(m => m.userId === b.userId)) {
            await api.removeTeamMember(teamId, b.userId);
          }
        }
      } else {
        await api.createTeam(form);
      }
      toast.success(`Команда «${form.name}» сохранена`);
      onSaved();
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Не удалось сохранить команду');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Удалить команду? Задачи и календари участников не изменятся.')) return;
    try {
      await api.deleteTeam(teamId);
      toast.success('Команда удалена. Задачи и календари участников не тронуты');
      onSaved();
    } catch {
      toast.error('Не удалось удалить команду');
    }
  };

  const found = allUsers.filter(u => !query
    || userName(u).toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="tsk-mask" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tsk-modal">
        <div className="tsk-modal-head">
          <div className="tsk-modal-title">{teamId ? 'Настройка команды' : 'Новая команда'}</div>
          <button className="tsk-x" onClick={onClose}>×</button>
        </div>

        <div className="tsk-modal-body">
          <input
            className="tsk-input tsk-input-title"
            placeholder="Название команды"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />

          <div className="tsk-row" style={{ marginTop: 16 }}>
            <div>
              <label className="tsk-label">Медцентр</label>
              <select className="tsk-select" style={{ width: '100%' }} value={form.medCenterId}
                onChange={e => setForm(f => ({ ...f, medCenterId: e.target.value }))}>
                <option value="">Без привязки</option>
                {centers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="tsk-label">Кто видит загрузку команды</label>
              <select className="tsk-select" style={{ width: '100%' }} value={form.access}
                onChange={e => setForm(f => ({ ...f, access: e.target.value }))}>
                {Object.entries(ACCESS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          <div className="tsk-sect">Состав · {form.members.length}</div>
          <input
            className="tsk-input"
            placeholder="Поиск по имени"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          <div className="tsk-chips">
            {found.slice(0, 40).map(u => {
              const member = form.members.find(m => m.userId === u.id);
              return (
                <button
                  key={u.id}
                  className={`tsk-chip ${member ? 'is-on' : ''}`}
                  onClick={() => toggle(u.id, member?.role === 'member' ? 'lead' : member?.role === 'lead' ? 'viewer' : 'member')}
                  title="Нажатие переключает: участник → руководитель → наблюдатель → убрать"
                >
                  <Avatar user={u} size={18} />
                  {userName(u)}
                  {member && <span style={{ fontSize: 10, opacity: 0.75 }}>{TEAM_ROLE_LABEL[member.role]}</span>}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
            Нажатие переключает роль: участник → руководитель → наблюдатель → убрать.
            Наблюдатель видит загрузку команды, но сам в неё не входит и в
            командный срез не попадает.
          </div>

          <div
            className={`tsk-opt ${form.isHidden ? 'is-sel' : ''}`}
            style={{ marginTop: 18 }}
            onClick={() => setForm(f => ({ ...f, isHidden: !f.isHidden }))}
          >
            <span className="tsk-opt-radio" />
            <span>
              <span className="tsk-opt-title">Скрытая команда</span>
              <span className="tsk-opt-note">
                Не показывается в списках, поиске и фильтрах у тех, кто не
                участник и не наблюдатель. Для них команды не существует — они
                не увидят даже строки «нет доступа».
              </span>
            </span>
          </div>

          <div className="tsk-trade is-neutral">
            <div className="tsk-trade-title">Что увидит человек вне команды</div>
            <div className="tsk-trade-text">
              {form.isHidden
                ? 'Ничего: ни названия, ни состава, ни строки «нет доступа».'
                : form.access === 'all'
                  ? 'Название, состав и загрузку участников в часах — без содержания их дел.'
                  : 'Название и состав. Загрузку — только участники и наблюдатели.'}
            </div>
          </div>
        </div>

        <div className="tsk-modal-foot">
          <div className="tsk-modal-hint">
            Удаление команды не трогает ни задачи, ни календари: команда — это
            граница видимости, а не владелец работы.
          </div>
          <div className="tsk-modal-btns">
            {teamId && <button className="tsk-btn is-danger" onClick={remove}>Удалить</button>}
            <button className="tsk-btn" onClick={onClose}>Отмена</button>
            <button className="tsk-btn is-primary" onClick={save} disabled={saving}>Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  );
}
