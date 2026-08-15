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
import { TEAM_ROLE_LABEL, userName } from '../utils/labels';
import { Avatar, Empty } from './Bits';
import CustomSelect from './CustomSelect';

export default function TeamsAdmin({ ctx }) {
  const [teams, setTeams] = useState([]);
  const [editing, setEditing] = useState(null);
  const [inviteTeam, setInviteTeam] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.getTeams();
      setTeams(data.teams || []);
    } catch {
      toast.error('Не удалось получить команды');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (ctx.teamsRevision) reload(); }, [ctx.teamsRevision, reload]);

  if (loading) return <Empty compact>Загружаем…</Empty>;

  return (
    <>
      {!teams.length ? (
        <Empty>Пока нет ни одной команды, доступной вам.</Empty>
      ) : teams.map(team => (
        <div className="tsk-card" key={team.id} style={{ marginBottom: 12 }}>
          <div className="tsk-team-head" style={{ marginBottom: 8 }}>
            <div>
              <div className="tsk-team-name">
                {team.name}
              </div>
              <div className="tsk-team-sub">
                {(team.members || []).length} чел.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              <button className="tsk-btn is-sm" onClick={() => ctx.go('load', { teamId: team.id })}>Загрузка</button>
              {(team.isLead || ctx.access?.isAdmin) && (
                <>
                  <button className="tsk-btn is-sm" onClick={() => setInviteTeam(team)}>Пригласить</button>
                  <button className="tsk-btn is-sm" onClick={() => setEditing({ id: team.id })}>Настроить</button>
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <TeamModal
          teamId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {inviteTeam && (
        <InviteModal team={inviteTeam} onClose={() => setInviteTeam(null)} />
      )}
    </>
  );
}

function InviteModal({ team, onClose }) {
  const [role, setRole] = useState('member');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const { data } = await api.createTeamInvite(team.id, { role, expiresInDays });
      setLink(`${window.location.origin}/tasks?join=${encodeURIComponent(data.token)}`);
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Не удалось создать ссылку');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Ссылка скопирована');
    } catch {
      window.prompt('Скопируйте ссылку', link);
    }
  };

  return (
    <div className="tsk-mask" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tsk-modal" style={{ width: 560 }}>
        <div className="tsk-modal-head">
          <div className="tsk-modal-title">Пригласить в «{team.name}»</div>
          <button className="tsk-x" onClick={onClose}>×</button>
        </div>
        <div className="tsk-modal-body">
          <div className="tsk-row">
            <div>
              <label className="tsk-label">Права приглашённого</label>
              <select className="tsk-select" style={{ width: '100%' }} value={role} onChange={e => setRole(e.target.value)}>
                <option value="member">Участник</option>
                <option value="viewer">Наблюдатель</option>
                <option value="lead">Руководитель команды</option>
              </select>
            </div>
            <div>
              <label className="tsk-label">Срок действия</label>
              <select className="tsk-select" style={{ width: '100%' }} value={expiresInDays === null ? 'never' : String(expiresInDays)}
                onChange={e => setExpiresInDays(e.target.value === 'never' ? null : Number(e.target.value))}>
                <option value="1">1 день</option>
                <option value="7">7 дней</option>
                <option value="30">30 дней</option>
                <option value="never">Бессрочно</option>
              </select>
            </div>
          </div>

          {link ? (
            <div className="tsk-invite-link">
              <span>{link}</span>
              <button className="tsk-btn" onClick={copy}>Копировать</button>
            </div>
          ) : (
            <button className="tsk-invite-create" disabled={busy} onClick={generate}>
              {busy ? 'Создаём…' : 'Сгенерировать ссылку-приглашение'}
            </button>
          )}

          <div className="tsk-trade is-neutral">
            <div className="tsk-trade-title">Что произойдёт по ссылке</div>
            <div className="tsk-trade-text">
              Авторизованный сотрудник сразу попадёт в команду с выбранной ролью.
              Содержание личных дел приглашение не открывает.
            </div>
          </div>
        </div>
        <div className="tsk-modal-foot">
          <div className="tsk-modal-hint">Ссылку можно отправить в чат Alfa Wiki.</div>
          <button className="tsk-btn is-primary" onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── настройка команды ─────────────────────────── */

export function TeamModal({ teamId, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', medCenterId: '', access: 'members', isHidden: true, members: [],
  });
  const [allUsers, setAllUsers] = useState([]);
  const [centers, setCenters] = useState([]);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // listBasic, а не list: полный список пользователей закрыт админским правом,
    // а для выбора участников достаточно имени и аватарки.
    usersApi.listBasic().then(r => setAllUsers(r.data?.users || r.data || [])).catch(() => {});
    medCentersApi.list().then(r => setCenters(r.data?.medCenters || r.data || [])).catch(() => {});
    if (teamId) {
      api.getTeam(teamId).then(r => setForm({
        name: r.data.name,
        medCenterId: r.data.medCenterId ? String(r.data.medCenterId) : '',
        access: 'members',
        isHidden: true,
        members: r.data.members || [],
      })).catch(() => toast.error('Не удалось открыть команду'));
    }
  }, [teamId]);

  const addMember = userId => {
    setForm(f => f.members.some(m => m.userId === userId) ? f : {
      ...f, members: [...f.members, { userId, role: 'member' }],
    });
    setQuery('');
    setSearchOpen(false);
  };
  const updateMember = (userId, role) => setForm(f => ({ ...f,
    members: f.members.map(m => m.userId === userId ? { ...m, role } : m),
  }));
  const removeMember = userId => setForm(f => ({ ...f,
    members: f.members.filter(m => m.userId !== userId),
  }));

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

  const found = query.trim() ? allUsers.filter(u =>
    !form.members.some(m => m.userId === u.id)
    && userName(u).toLowerCase().includes(query.trim().toLowerCase())
  ).slice(0, 8) : [];
  const centerOptions = [
    { value: '', label: 'Без привязки' },
    ...centers.map(center => ({ value: String(center.id), label: center.name })),
  ];
  const roleOptions = Object.entries(TEAM_ROLE_LABEL).map(([value, label]) => ({ value, label }));

  return (
    <div className="tsk-mask" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tsk-modal tsk-team-modal">
        <div className="tsk-modal-head">
          <div className="tsk-modal-title">{teamId ? 'Настройка команды' : 'Новая команда'}</div>
          <button className="tsk-x" onClick={onClose}>×</button>
        </div>

        <div className="tsk-modal-body tsk-team-modal-body">
          <label className="tsk-team-name-field">
            <span>Название</span>
            <input className="tsk-input" autoFocus placeholder="Например, Маркетинг" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </label>

          <div className="tsk-team-fields">
            <CustomSelect label="Медцентр" value={form.medCenterId} options={centerOptions}
              onChange={medCenterId => setForm(f => ({ ...f, medCenterId }))} />
          </div>

          <div className="tsk-team-members-head"><span>Участники</span><b>{form.members.length}</b></div>
          <div className="tsk-member-search">
            <input className="tsk-input" placeholder="Добавить сотрудника" value={query}
              onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 100)}
              onKeyDown={e => { if (e.key === 'Escape') { setSearchOpen(false); e.currentTarget.blur(); } }}
              onChange={e => { setQuery(e.target.value); setSearchOpen(true); }} />
            {searchOpen && query.trim() && <div className="tsk-member-results">
              {found.length ? found.map(user => <button type="button" key={user.id} onMouseDown={e => e.preventDefault()} onClick={() => addMember(user.id)}>
                <Avatar user={user} size={24} /><span className="tsk-member-result-name">{userName(user)}</span><b>Добавить</b>
              </button>) : <div className="tsk-member-results-empty">Никого не найдено</div>}
            </div>}
          </div>

          <div className="tsk-member-list">
            {form.members.length ? form.members.map(member => {
              const user = allUsers.find(item => item.id === member.userId) || member.user || member;
              return <div className="tsk-member-row" key={member.userId}>
                <Avatar user={user} size={28} />
                <span className="tsk-member-name">{userName(user)}</span>
                <CustomSelect value={member.role} options={roleOptions} className="is-compact"
                  onChange={role => updateMember(member.userId, role)} />
                <button type="button" className="tsk-member-remove" aria-label={`Удалить ${userName(user)}`}
                  onClick={() => removeMember(member.userId)}>×</button>
              </div>;
            }) : <div className="tsk-member-empty">Участников пока нет</div>}
          </div>

        </div>

        <div className="tsk-modal-foot tsk-team-modal-foot">
          <div>{teamId && <button className="tsk-btn is-danger" onClick={remove}>Удалить</button>}</div>
          <div className="tsk-modal-btns">
            <button className="tsk-btn" onClick={onClose}>Отмена</button>
            <button className="tsk-btn is-primary" onClick={save} disabled={saving}>Сохранить</button>
          </div>
        </div>
      </div>
    </div>
  );
}
