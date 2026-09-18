/**
 * Настройка команды — одно окно и больше ничего.
 *
 * Права ломаются раньше всего остального: приходят подрядчики, смежные отделы,
 * второй филиал — и вопрос «кто видит загрузку соседней команды» становится
 * политическим. Поэтому команда здесь не папка, а граница: филиал, участники,
 * уровень доступа и явный список тех, кто смотрит, не будучи участником.
 *
 * Список команд отсюда ушёл в TeamPage (ver. 8.42). Раньше весь раздел
 * «Команды» состоял из карточек с кнопками и потому не рассказывал о команде
 * ничего; теперь карточка — вход на страницу команды, а настройка стала тем,
 * чем и была, — служебным окном поверх неё.
 *
 * Приглашения по ссылке отсюда убраны (ver. 8.45). Ссылка давала членство, но
 * не право видеть раздел, и приглашённый всё равно упирался в отсутствие
 * кнопки. Состав правится напрямую, и добавление само открывает человеку
 * модуль — см. openTasksModule на сервере.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { CalendarClock, UserPlus } from 'lucide-react';
import { tasks as api, users as usersApi, medCenters as medCentersApi } from '../../../services/api';
import { TEAM_ROLE_LABEL, userName } from '../utils/labels';
import { Avatar, useMaskClose } from './Bits';
import CustomSelect from './CustomSelect';
import { ScheduleModal } from './People';

export function TeamModal({ teamId, onClose, onSaved }) {
  const maskProps = useMaskClose(onClose);
  const [form, setForm] = useState({
    name: '', medCenterId: '', access: 'members', isHidden: true, members: [],
  });
  const [allUsers, setAllUsers] = useState([]);
  /** Кто уже заведён в модуле — тем можно ставить задачи, остальным пока нет. */
  const [enrolled, setEnrolled] = useState(null);
  const [centers, setCenters] = useState([]);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Кому сейчас настраивают расписание прямо отсюда. */
  const [scheduling, setScheduling] = useState(null);

  const loadEnrolled = useCallback(() => api.getAssignable()
    .then(r => setEnrolled(new Set((r.data || []).map(u => u.id))))
    .catch(() => {}), []);

  useEffect(() => {
    // listBasic, а не list: полный список пользователей закрыт админским правом,
    // а для выбора участников достаточно имени и аватарки.
    //
    // И здесь он именно полный, в отличие от выбора исполнителя в форме задачи.
    // Состав команды — точка ВХОДА в модуль: человека сначала заводят сюда, а
    // расписание ему настраивают тут же, соседней кнопкой. Отфильтруй этот
    // список по участию в модуле — и завести нового человека станет нельзя
    // вовсе.
    usersApi.listBasic().then(r => setAllUsers(r.data?.users || r.data || [])).catch(() => {});
    loadEnrolled();
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
  }, [teamId, loadEnrolled]);

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
        let opened = 0;
        for (const m of form.members) {
          const was = before.find(b => b.userId === m.userId);
          if (!was || was.role !== m.role) {
            const { data } = await api.addTeamMember(teamId, m);
            if (data?.accessGranted) opened += 1;
          }
        }
        for (const b of before) {
          if (!form.members.find(m => m.userId === b.userId)) {
            await api.removeTeamMember(teamId, b.userId);
          }
        }
        toast.success(`Команда «${form.name}» сохранена`);
        // Про открытый доступ говорим отдельной строкой и только когда он
        // действительно открылся: это изменение прав другого человека, и
        // прятать его в общем «сохранено» нельзя.
        if (opened) {
          toast.success(opened === 1
            ? 'Новому участнику открыт раздел «Задачи»'
            : `Раздел «Задачи» открыт ${opened} новым участникам`);
        }
      } else {
        await api.createTeam(form);
        toast.success(`Команда «${form.name}» сохранена`);
      }
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

  return createPortal(
    <div className="tsk-mask" {...maskProps}>
      <div className="tsk-modal tsk-team-modal">
        <div className="tsk-modal-head">
          <div className="tsk-modal-title">{teamId ? 'Настройка команды' : 'Новая команда'}</div>
          <button className="tsk-x" onClick={onClose}>×</button>
        </div>

        <div className="tsk-modal-body tsk-team-modal-body">
          <div className="tsk-team-fields">
            <label className="tsk-team-name-field">
              <span>Название</span>
              <input className="tsk-input" autoFocus placeholder="Например, Маркетинг" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </label>
            <CustomSelect label="Медцентр" value={form.medCenterId} options={centerOptions}
              onChange={medCenterId => setForm(f => ({ ...f, medCenterId }))} />
          </div>

          <div className="tsk-team-members-head">
            <span>Участники</span>
            <b>{form.members.length}</b>
          </div>
          <div className="tsk-member-search">
            <input className="tsk-input" placeholder="Добавить сотрудника — начните вводить фамилию" value={query}
              onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 100)}
              onKeyDown={e => { if (e.key === 'Escape') { setSearchOpen(false); e.currentTarget.blur(); } }}
              onChange={e => { setQuery(e.target.value); setSearchOpen(true); }} />
            {searchOpen && query.trim() && <div className="tsk-member-results">
              {found.length ? found.map(user => (
                <button type="button" key={user.id} onMouseDown={e => e.preventDefault()} onClick={() => addMember(user.id)}>
                  <Avatar user={user} size={26} />
                  <span className="tsk-member-result-name">
                    {userName(user)}
                    {enrolled && !enrolled.has(user.id) && <em>раздел «Задачи» откроется при сохранении</em>}
                  </span>
                  <b><UserPlus size={13} strokeWidth={2} /> Добавить</b>
                </button>
              )) : <div className="tsk-member-results-empty">Никого не найдено</div>}
            </div>}
          </div>

          <div className="tsk-member-list">
            {form.members.length ? form.members.map(member => {
              const user = allUsers.find(item => item.id === member.userId) || member.user || member;
              const hasSchedule = !enrolled || enrolled.has(member.userId);
              return (
                <div className="tsk-member-row" key={member.userId}>
                  <Avatar user={user} size={30} />
                  <span className="tsk-member-name">{userName(user)}</span>

                  {/* Без расписания человеку нельзя поставить ни одной задачи —
                      постановка отвечает 409. Раньше об этом узнавали, упёршись
                      в ошибку; теперь это видно там же, где заводят состав, и
                      чинится соседней кнопкой. */}
                  {!hasSchedule && (
                    <button type="button" className="tsk-member-fix" onClick={() => setScheduling({ user, member })}>
                      <CalendarClock size={13} strokeWidth={2} />
                      Настроить расписание
                    </button>
                  )}

                  <CustomSelect value={member.role} options={roleOptions} className="is-compact"
                    onChange={role => updateMember(member.userId, role)} />
                  <button type="button" className="tsk-member-remove" aria-label={`Удалить ${userName(user)}`}
                    onClick={() => removeMember(member.userId)}>×</button>
                </div>
              );
            }) : <div className="tsk-member-empty">Участников пока нет</div>}
          </div>
        </div>

        <div className="tsk-modal-foot tsk-team-modal-foot">
          <div>{teamId && <button className="tsk-btn is-danger" onClick={remove}>Удалить</button>}</div>
          <div className="tsk-modal-btns">
            <button className="tsk-btn" onClick={onClose}>Отмена</button>
            <button className="tsk-btn is-primary" onClick={save} disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>

      {scheduling && (
        <ScheduleModal
          person={{ ...scheduling.user, id: scheduling.member.userId, workSchedule: null }}
          onClose={() => setScheduling(null)}
          onSaved={async () => {
            setScheduling(null);
            await loadEnrolled();
          }}
        />
      )}
    </div>,
    document.body,
  );
}
