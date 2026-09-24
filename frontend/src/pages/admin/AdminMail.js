import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Trash2, RefreshCw, Plug, UserPlus, X, AlertTriangle, Pencil,
  Mail as MailIcon, ScrollText, Loader, Send, Search, UsersRound
} from 'lucide-react';
import { mail as mailApi, users as usersApi } from '../../services/api';
import toast from 'react-hot-toast';
import './AdminMail.css';

/**
 * Настройка почтовых ящиков (ver. 8.59).
 *
 * Доступ можно дать человеку напрямую либо динамической группе по медцентру,
 * роли или их пересечению. Групповое правило остаётся видимым в карточке и в
 * журнале — это важно, потому что новый участник группы получает всю историю
 * общего ящика автоматически.
 *
 * Пароль ящика вводится один раз и обратно не показывается никогда. При правке
 * пустое поле означает «не трогать», а не «стереть»: иначе исправление опечатки
 * в названии обнуляло бы доступ к ящику.
 */

const SYNC_STATES = {
  idle: { label: 'не запускалась', tone: 'muted' },
  headers: { label: 'загрузка заголовков', tone: 'work' },
  bodies: { label: 'докачка тел писем', tone: 'work' },
  ready: { label: 'в порядке', tone: 'ok' },
  error: { label: 'ошибка', tone: 'bad' },
};

const MAIL_PRESETS = [
  {
    key: 'reg-ru', label: 'REG.RU',
    imapHost: 'mail.hosting.reg.ru', imapPort: 993, imapSecure: true,
    smtpHost: 'mail.hosting.reg.ru', smtpPort: 465, smtpSecure: true,
  },
  {
    key: 'google', label: 'Google Workspace / Gmail',
    imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true,
    note: 'Используйте пароль приложения Google. Обычный пароль аккаунта для такого подключения не подходит.',
  },
  {
    key: 'yandex', label: 'Яндекс 360 / Почта',
    imapHost: 'imap.yandex.ru', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.yandex.ru', smtpPort: 465, smtpSecure: true,
    note: 'В Яндекс ID создайте отдельный пароль приложения для почты и разрешите доступ по IMAP.',
  },
  {
    key: 'mail-ru', label: 'VK WorkSpace / Mail.ru',
    imapHost: 'imap.mail.ru', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.mail.ru', smtpPort: 465, smtpSecure: true,
    note: 'Если в аккаунте включена защита входа, используйте пароль для внешнего приложения.',
  },
  {
    key: 'microsoft', label: 'Microsoft 365 / Outlook',
    imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false,
    note: 'SMTP работает через STARTTLS. В организации должны быть разрешены IMAP и парольная SMTP-аутентификация; OAuth2 модуль пока не поддерживает.',
  },
  {
    key: 'rambler', label: 'Рамблер/почта',
    imapHost: 'imap.rambler.ru', imapPort: 993, imapSecure: true,
    smtpHost: 'smtp.rambler.ru', smtpPort: 465, smtpSecure: true,
  },
];

const presetFor = (account) => MAIL_PRESETS.find((preset) => (
  preset.imapHost === account.imapHost
  && preset.imapPort === Number(account.imapPort)
  && preset.imapSecure === (account.imapSecure !== false)
  && preset.smtpHost === account.smtpHost
  && preset.smtpPort === Number(account.smtpPort)
  && preset.smtpSecure === (account.smtpSecure !== false)
))?.key || 'custom';

const EMPTY_FORM = {
  provider: 'reg-ru', email: '', displayName: '', login: '', password: '', medCenterId: '',
  imapHost: 'mail.hosting.reg.ru', imapPort: 993, imapSecure: true,
  smtpHost: 'mail.hosting.reg.ru', smtpPort: 465, smtpSecure: true,
  signature: '',
};

const EMPTY_GROUP = {
  medCenterId: '', roleId: '', canSend: false, canDelete: false,
};

export default function AdminMail() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [centers, setCenters] = useState([]);
  const [roles, setRoles] = useState([]);
  const [staff, setStaff] = useState([]);

  const [editing, setEditing] = useState(null);   // id ящика либо 'new'
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const [grantFor, setGrantFor] = useState(null);
  const [accessFor, setAccessFor] = useState(null);
  const [grantMode, setGrantMode] = useState('group');
  const [staffQuery, setStaffQuery] = useState('');
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP);
  const [accessSaving, setAccessSaving] = useState(false);

  const [auditFor, setAuditFor] = useState(null);
  const [audit, setAudit] = useState([]);

  const load = useCallback(async () => {
    try {
      const { data } = await mailApi.admin.accounts();
      setAccounts(data.accounts || []);
    } catch (e) {
      toast.error('Не удалось получить ящики');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    mailApi.admin.accessOptions().then(({ data }) => {
      setCenters(data.medCenters || []);
      setRoles(data.roles || []);
    }).catch(() => toast.error('Не удалось получить медцентры и роли'));
    usersApi.listBasic().then(({ data }) => setStaff(data.users || data || [])).catch(() => {});
  }, []);

  // ── Ящик ────────────────────────────────────────────────────────────────

  const startCreate = () => { setEditing('new'); setForm(EMPTY_FORM); setTestResult(null); };

  const startEdit = (account) => {
    setEditing(account.id);
    setTestResult(null);
    setForm({
      email: account.email,
      displayName: account.displayName,
      login: account.login,
      password: '',
      medCenterId: account.medCenter?.id || '',
      provider: presetFor(account),
      imapHost: account.imapHost, imapPort: account.imapPort, imapSecure: account.imapSecure !== false,
      smtpHost: account.smtpHost, smtpPort: account.smtpPort, smtpSecure: account.smtpSecure !== false,
      signature: account.signature || '',
    });
  };

  const applyPreset = (key) => {
    const preset = MAIL_PRESETS.find((item) => item.key === key);
    setForm((current) => (preset
      ? { ...current, provider: key, imapHost: preset.imapHost, imapPort: preset.imapPort,
        imapSecure: preset.imapSecure, smtpHost: preset.smtpHost, smtpPort: preset.smtpPort,
        smtpSecure: preset.smtpSecure }
      : { ...current, provider: 'custom' }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, medCenterId: form.medCenterId || null };
      delete payload.provider;
      if (editing === 'new') {
        await mailApi.admin.create(payload);
        toast.success('Ящик заведён. Проверьте подключение.');
      } else {
        // Пустой пароль в форме правки — «оставить как есть».
        if (!payload.password) delete payload.password;
        await mailApi.admin.update(editing, payload);
        toast.success('Сохранено');
      }
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (account) => {
    setTesting(account.id);
    setTestResult(null);
    try {
      const { data } = await mailApi.admin.test(account.id);
      setTestResult({ id: account.id, ...data });
      if (data.ok === false) toast.error('Сервер не пустил — смотрите подробности');
      else toast.success(`Подключились за ${data.ms} мс`);
      load();
    } catch (err) {
      toast.error('Проверка не выполнилась');
    } finally {
      setTesting(null);
    }
  };

  const syncNow = async (account) => {
    try {
      await mailApi.admin.sync(account.id);
      toast.success('Синхронизация запущена — она идёт фоном');
      setTimeout(load, 4000);
    } catch (e) {
      toast.error('Не удалось запустить синхронизацию');
    }
  };

  const remove = async (account) => {
    const ok = window.confirm(
      `Удалить ящик ${account.email}?\n\n` +
      'Из портала пропадут письма и все выданные доступы. ' +
      'На сервере reg.ru письма останутся нетронутыми — при повторном заведении они загрузятся заново.'
    );
    if (!ok) return;
    try {
      await mailApi.admin.remove(account.id);
      toast.success('Ящик убран из портала');
      load();
    } catch (e) {
      toast.error('Не удалось удалить');
    }
  };

  // ── Доступы ─────────────────────────────────────────────────────────────

  const grant = async (accountId, userId) => {
    try {
      await mailApi.admin.grant(accountId, { userId, canSend: false, canDelete: false });
      toast.success('Доступ выдан');
      setGrantFor(null);
      setStaffQuery('');
      load();
    } catch (e) {
      toast.error('Не удалось выдать доступ');
    }
  };

  const changeRights = async (accountId, access, patch) => {
    try {
      await mailApi.admin.grant(accountId, {
        userId: access.userId,
        canSend: patch.canSend ?? access.canSend,
        canDelete: patch.canDelete ?? access.canDelete,
      });
      load();
    } catch (e) {
      toast.error('Не удалось изменить права');
    }
  };

  const revoke = async (accountId, access) => {
    if (!window.confirm(`Забрать у ${access.user?.displayName || 'сотрудника'} доступ к ящику?`)) return;
    try {
      await mailApi.admin.revoke(accountId, access.userId);
      load();
    } catch (e) {
      toast.error('Не удалось отозвать доступ');
    }
  };

  const saveAccessRule = async (accountId, rule = null, patch = {}) => {
    const values = rule || groupForm;
    const payload = {
      medCenterId: values.medCenterId || null,
      roleId: values.roleId || null,
      canSend: patch.canSend ?? values.canSend,
      canDelete: patch.canDelete ?? values.canDelete,
    };
    if (!payload.medCenterId && !payload.roleId) {
      toast.error('Выберите медцентр, роль или оба условия');
      return;
    }

    setAccessSaving(true);
    try {
      await mailApi.admin.saveAccessRule(accountId, payload);
      if (!rule) {
        toast.success('Групповой доступ настроен');
        setGrantFor(null);
        setGroupForm(EMPTY_GROUP);
      }
      await load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить групповое правило');
    } finally {
      setAccessSaving(false);
    }
  };

  const revokeAccessRule = async (accountId, rule) => {
    const group = [rule.medCenter?.name, rule.role?.name].filter(Boolean).join(' + ');
    if (!window.confirm(`Удалить групповое правило «${group}»?`)) return;
    try {
      await mailApi.admin.revokeAccessRule(accountId, rule.id);
      load();
    } catch (e) {
      toast.error('Не удалось удалить групповое правило');
    }
  };

  const toggleGrant = (accountId) => {
    setGrantFor((current) => current === accountId ? null : accountId);
    setGrantMode('group');
    setStaffQuery('');
    setGroupForm(EMPTY_GROUP);
  };

  const toggleAccess = (accountId) => {
    setAccessFor((current) => current === accountId ? null : accountId);
    setGrantFor(null);
    setStaffQuery('');
    setGroupForm(EMPTY_GROUP);
  };

  const openAudit = async (account) => {
    setAuditFor(account.id === auditFor ? null : account.id);
    if (account.id === auditFor) return;
    try {
      const { data } = await mailApi.admin.audit({ accountId: account.id, limit: 60 });
      setAudit(data.entries || []);
    } catch (e) {
      toast.error('Журнал не открылся');
    }
  };

  const staffMatches = useMemo(() => {
    const q = staffQuery.trim().toLowerCase();
    const account = accounts.find((a) => a.id === grantFor);
    const already = new Set((account?.access || []).map((x) => x.userId));
    return staff
      .filter((u) => !already.has(u.id))
      .filter((u) => !q ||
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.username || '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [staff, staffQuery, grantFor, accounts]);

  const providerNote = MAIL_PRESETS.find((preset) => preset.key === form.provider)?.note;
  const accountGroups = useMemo(() => {
    const grouped = new Map();
    accounts.forEach((account) => {
      const center = account.medCenter;
      const key = center?.id || '__without-center__';
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          name: center?.displayName || center?.name || 'Без медцентра',
          withoutCenter: !center,
          accounts: [],
        });
      }
      grouped.get(key).accounts.push(account);
    });
    return [...grouped.values()]
      .sort((a, b) => Number(a.withoutCenter) - Number(b.withoutCenter)
        || a.name.localeCompare(b.name, 'ru'))
      .map((group) => ({
        ...group,
        accounts: group.accounts.sort((a, b) => (
          (a.displayName || a.email).localeCompare(b.displayName || b.email, 'ru')
        )),
      }));
  }, [accounts]);

  if (loading) {
    return <div className="amail-page amail-page--center"><Loader className="amail-spin" size={28} /></div>;
  }

  return (
    <div className="amail-page">
      <header className="amail-head">
        <h1><MailIcon size={22} /> Почтовые ящики</h1>
        <button type="button" className="amail-btn amail-btn--primary" onClick={startCreate}>
          Добавить ящик
        </button>
      </header>

      {editing && (
        <form className="amail-form" onSubmit={save}>
          <h2>{editing === 'new' ? 'Новый ящик' : 'Правка ящика'}</h2>

          <div className="amail-grid">
            <label>
              <span>Почтовый сервис <small>заполнит серверы автоматически</small></span>
              <select value={form.provider} onChange={(e) => applyPreset(e.target.value)}>
                {MAIL_PRESETS.map((preset) => (
                  <option key={preset.key} value={preset.key}>{preset.label}</option>
                ))}
                <option value="custom">Другой — настроить вручную</option>
              </select>
            </label>
            <label>
              <span>Адрес</span>
              <input
                type="email" required value={form.email}
                disabled={editing !== 'new'}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="info@alfa.ru"
              />
            </label>
            <label>
              <span>Название</span>
              <input
                type="text" required value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="Регистратура на Ленина"
              />
            </label>
            <label>
              <span>Логин <small>обычно совпадает с адресом</small></span>
              <input
                type="text" value={form.login}
                onChange={(e) => setForm({ ...form, login: e.target.value })}
                placeholder={form.email || 'info@alfa.ru'}
              />
            </label>
            <label>
              <span>
                Пароль
                {editing !== 'new' && <small>пусто — оставить прежний</small>}
              </span>
              <input
                type="password" value={form.password}
                required={editing === 'new'}
                autoComplete="new-password"
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <label>
              <span>Медцентр</span>
              <select
                value={form.medCenterId}
                onChange={(e) => setForm({ ...form, medCenterId: e.target.value })}
              >
                <option value="">— не привязан —</option>
                {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>
              <span>Сервер IMAP</span>
              <input
                type="text" value={form.imapHost}
                onChange={(e) => setForm({ ...form, provider: 'custom', imapHost: e.target.value })}
              />
            </label>
            <label>
              <span>Порт IMAP</span>
              <input
                type="number" value={form.imapPort}
                onChange={(e) => setForm({ ...form, provider: 'custom', imapPort: Number(e.target.value) })}
              />
            </label>
            <label>
              <span>Шифрование IMAP</span>
              <select
                value={form.imapSecure ? 'ssl' : 'starttls'}
                onChange={(e) => setForm({ ...form, provider: 'custom', imapSecure: e.target.value === 'ssl' })}
              >
                <option value="ssl">SSL/TLS при подключении</option>
                <option value="starttls">STARTTLS</option>
              </select>
            </label>
            <label>
              <span>Сервер SMTP</span>
              <input
                type="text" value={form.smtpHost}
                onChange={(e) => setForm({ ...form, provider: 'custom', smtpHost: e.target.value })}
              />
            </label>
            <label>
              <span>Порт SMTP</span>
              <input
                type="number" value={form.smtpPort}
                onChange={(e) => setForm({ ...form, provider: 'custom', smtpPort: Number(e.target.value) })}
              />
            </label>
            <label>
              <span>Шифрование SMTP</span>
              <select
                value={form.smtpSecure ? 'ssl' : 'starttls'}
                onChange={(e) => setForm({ ...form, provider: 'custom', smtpSecure: e.target.value === 'ssl' })}
              >
                <option value="ssl">SSL/TLS при подключении</option>
                <option value="starttls">STARTTLS</option>
              </select>
            </label>
          </div>

          <div className="amail-provider-note">
            <MailIcon size={15} />
            <span>
              Пресет только заполняет поля: адреса серверов, порты и шифрование можно изменить вручную.
              {providerNote && <small>{providerNote}</small>}
            </span>
          </div>

          {/* Подпись на ящик, а не на человека: письмо уходит от регистратуры
              клиники, и подписывать его именем оператора неверно — отвечать
              будет уже другая смена. */}
          <label className="amail-signature">
            <span>Подпись <small>подставляется в конец исходящих; можно простой HTML</small></span>
            <textarea
              rows={3}
              value={form.signature}
              onChange={(e) => setForm({ ...form, signature: e.target.value })}
              placeholder={'Регистратура «Альфа» на Ленина<br>+7 900 000-00-00'}
            />
          </label>

          <div className="amail-form__actions">
            <button type="submit" className="amail-btn amail-btn--primary" disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
            <button type="button" className="amail-btn" onClick={() => setEditing(null)}>Отмена</button>
          </div>
        </form>
      )}

      {!accounts.length && !editing && (
        <div className="amail-empty">
          <MailIcon size={36} />
          <p>Ящиков пока нет. Добавьте первый и проверьте подключение.</p>
        </div>
      )}

      {!!accounts.length && (
        <div className="amail-table-wrap">
          <table className="amail-table">
            <thead>
              <tr>
                <th>Ящик</th>
                <th>Состояние</th>
                <th className="amail-table__access-col">Доступ</th>
                <th className="amail-table__actions-col"><span className="sr-only">Действия</span></th>
              </tr>
            </thead>
            {accountGroups.map((group) => (
              <tbody key={group.key}>
                <tr className="amail-table__group"><th colSpan="4">{group.name}</th></tr>
                {group.accounts.map((account) => {
                  const state = SYNC_STATES[account.syncState] || SYNC_STATES.idle;
                  return (
                    <React.Fragment key={account.id}>
                      <tr className="amail-table__account">
                        <td>
                          <div className="amail-table__mailbox">
                            <strong>{account.displayName}</strong>
                            <span>{account.email}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`amail-state amail-state--${state.tone}`}>{state.label}</span>
                          {account.lastError && <AlertTriangle className="amail-status-error" size={15} title={account.lastError} />}
                          {!account.isActive && <span className="amail-chip amail-chip--off">выключен</span>}
                        </td>
                        <td>
                          <button
                            type="button" className={`amail-square-btn ${accessFor === account.id ? 'is-active' : ''}`}
                            title="Доступ" aria-label="Доступ" aria-expanded={accessFor === account.id}
                            onClick={() => toggleAccess(account.id)}
                          >
                            <UsersRound size={16} />
                          </button>
                        </td>
                        <td className="amail-table__actions">
                          <button type="button" className="amail-square-btn" title="Изменить" aria-label="Изменить" onClick={() => startEdit(account)}><Pencil size={16} /></button>
                          <button type="button" className="amail-square-btn" title="Проверить связь" aria-label="Проверить связь" disabled={testing === account.id} onClick={() => testConnection(account)}>
                            {testing === account.id ? <Loader className="amail-spin" size={16} /> : <Plug size={16} />}
                          </button>
                          <button type="button" className="amail-square-btn" title="Синхронизировать" aria-label="Синхронизировать" onClick={() => syncNow(account)}><RefreshCw size={16} /></button>
                          <button type="button" className={`amail-square-btn ${auditFor === account.id ? 'is-active' : ''}`} title="Журнал" aria-label="Журнал" onClick={() => openAudit(account)}><ScrollText size={16} /></button>
                          <button type="button" className="amail-square-btn amail-square-btn--danger" title="Удалить" aria-label="Удалить" onClick={() => remove(account)}><Trash2 size={16} /></button>
                        </td>
                      </tr>

                      {testResult && testResult.id === account.id && (
                        <tr className="amail-table__detail"><td colSpan="4">
                          <div className={`amail-test ${testResult.ok === false ? 'bad' : 'ok'}`}>
                            {testResult.ok === false
                              ? <>Сервер отказал: {testResult.error}</>
                              : <>Соединение установлено</>}
                          </div>
                        </td></tr>
                      )}

                      {accessFor === account.id && (
                        <tr className="amail-table__detail"><td colSpan="4">
                          <div className="amail-access">
                <div className="amail-access__head">
                  <h4>Доступ</h4>
                  <button
                    type="button"
                    className="amail-btn amail-btn--small"
                    onClick={() => toggleGrant(account.id)}
                  >
                    <UserPlus size={14} /> Выдать
                  </button>
                </div>

                {grantFor === account.id && (
                  <div className="amail-picker">
                    <div className="amail-picker__tabs">
                      <button
                        type="button"
                        className={grantMode === 'group' ? 'active' : ''}
                        onClick={() => setGrantMode('group')}
                      >
                        <UsersRound size={14} /> Группе
                      </button>
                      <button
                        type="button"
                        className={grantMode === 'person' ? 'active' : ''}
                        onClick={() => setGrantMode('person')}
                      >
                        <UserPlus size={14} /> Сотруднику
                      </button>
                    </div>

                    {grantMode === 'person' ? (
                      <>
                        <div className="amail-picker__search">
                          <Search size={14} />
                          <input
                            autoFocus type="text" value={staffQuery}
                            onChange={(e) => setStaffQuery(e.target.value)}
                            placeholder="Фамилия или логин"
                          />
                        </div>
                        <div className="amail-picker__list">
                          {staffMatches.map((u) => (
                            <button key={u.id} type="button" onClick={() => grant(account.id, u.id)}>
                              {u.displayName || u.username}
                              <small>{u.username}</small>
                            </button>
                          ))}
                          {!staffMatches.length && <div className="amail-muted">Никого не нашлось</div>}
                        </div>
                      </>
                    ) : (
                      <div className="amail-group-form">
                        <p>
                          Выберите хотя бы одно условие. Если выбраны оба, доступ получат
                          только сотрудники этого медцентра с этой ролью.
                        </p>
                        <div className="amail-group-form__filters">
                          <label>
                            <span>Медцентр</span>
                            <select
                              value={groupForm.medCenterId}
                              onChange={(e) => setGroupForm({ ...groupForm, medCenterId: e.target.value })}
                            >
                              <option value="">Любой медцентр</option>
                              {centers.map((center) => (
                                <option key={center.id} value={center.id}>
                                  {center.displayName || center.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <span className="amail-group-form__and">И</span>
                          <label>
                            <span>Роль</span>
                            <select
                              value={groupForm.roleId}
                              onChange={(e) => setGroupForm({ ...groupForm, roleId: e.target.value })}
                            >
                              <option value="">Любая роль</option>
                              {roles.map((role) => (
                                <option key={role.id} value={role.id}>{role.name}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="amail-group-form__footer">
                          <label className="amail-toggle">
                            <input
                              type="checkbox" checked={groupForm.canSend}
                              onChange={(e) => setGroupForm({ ...groupForm, canSend: e.target.checked })}
                            />
                            <Send size={13} /> отправка
                          </label>
                          <label className="amail-toggle">
                            <input
                              type="checkbox" checked={groupForm.canDelete}
                              onChange={(e) => setGroupForm({ ...groupForm, canDelete: e.target.checked })}
                            />
                            <Trash2 size={13} /> удаление
                          </label>
                          <button
                            type="button"
                            className="amail-btn amail-btn--primary amail-btn--small"
                            disabled={accessSaving || (!groupForm.medCenterId && !groupForm.roleId)}
                            onClick={() => saveAccessRule(account.id)}
                          >
                            {accessSaving ? 'Сохраняем…' : 'Выдать группе'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!account.access.length && !account.accessRules?.length ? (
                  <div className="amail-muted">Доступ пока никому не выдан</div>
                ) : (
                  <div className="amail-access-table-wrap">
                    <table className="amail-access-table">
                      <thead>
                        <tr>
                          <th>Кому</th>
                          <th title="Отправка" aria-label="Отправка"><Send size={14} /></th>
                          <th title="Удаление" aria-label="Удаление"><Trash2 size={14} /></th>
                          <th><span className="sr-only">Отозвать доступ</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(account.accessRules || []).map((rule) => (
                          <tr key={`rule-${rule.id}`}>
                            <td>
                              <span className="amail-access-table__name">
                                <UsersRound size={15} />
                                {[rule.medCenter?.displayName || rule.medCenter?.name, rule.role?.name].filter(Boolean).join(' + ')}
                              </span>
                            </td>
                            <td><input aria-label="Отправка" title="Может отправлять письма от имени ящика" type="checkbox" checked={rule.canSend} disabled={accessSaving} onChange={(e) => saveAccessRule(account.id, rule, { canSend: e.target.checked })} /></td>
                            <td><input aria-label="Удаление" title="Удаление письма стирает его и на сервере" type="checkbox" checked={rule.canDelete} disabled={accessSaving} onChange={(e) => saveAccessRule(account.id, rule, { canDelete: e.target.checked })} /></td>
                            <td><button type="button" className="amail-icon-btn" title="Удалить правило" aria-label="Удалить правило" onClick={() => revokeAccessRule(account.id, rule)}><X size={15} /></button></td>
                          </tr>
                        ))}
                        {account.access.map((access) => (
                          <tr key={`user-${access.id}`}>
                            <td>
                              <span className="amail-access-table__name">
                                {access.user?.displayName || access.user?.username || '—'}
                                {access.user?.username && <small>{access.user.username}</small>}
                              </span>
                            </td>
                            <td><input aria-label="Отправка" title="Может отправлять письма от имени ящика" type="checkbox" checked={access.canSend} onChange={(e) => changeRights(account.id, access, { canSend: e.target.checked })} /></td>
                            <td><input aria-label="Удаление" title="Удаление письма стирает его и на сервере" type="checkbox" checked={access.canDelete} onChange={(e) => changeRights(account.id, access, { canDelete: e.target.checked })} /></td>
                            <td><button type="button" className="amail-icon-btn" title="Забрать доступ" aria-label="Забрать доступ" onClick={() => revoke(account.id, access)}><X size={15} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                          </div>
                        </td></tr>
                      )}

                      {auditFor === account.id && (
                        <tr className="amail-table__detail"><td colSpan="4">
                          <div className="amail-audit">
                            {!audit.length && <div className="amail-muted">Записей нет</div>}
                            {audit.map((entry) => (
                              <div key={entry.id} className="amail-audit__row">
                                <span className="amail-audit__when">
                                  {new Date(entry.createdAt).toLocaleString('ru-RU')}
                                </span>
                                <span className="amail-audit__who">{entry.user?.displayName || entry.user?.username || '—'}</span>
                                <span className="amail-audit__what">{entry.action}</span>
                                <span className="amail-audit__detail">
                                  {entry.detail?.subject || entry.detail?.filename || entry.detail?.user
                                    || [entry.detail?.medCenter, entry.detail?.role].filter(Boolean).join(' + ')
                                    || entry.detail?.ruleId || ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
