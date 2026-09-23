import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Trash2, RefreshCw, Plug, UserPlus, X, Check, AlertTriangle,
  Mail as MailIcon, ScrollText, Loader, Send, Search
} from 'lucide-react';
import { mail as mailApi, users as usersApi, medCenters as medCentersApi } from '../../services/api';
import toast from 'react-hot-toast';
import './AdminMail.css';

/**
 * Настройка почтовых ящиков (ver. 8.58).
 *
 * Ящики заводит администратор и он же раздаёт доступ. Соблазн выдавать доступ
 * по должности — «все регистраторы такой-то клиники» — был и осознанно
 * отклонён: в этих ящиках жалобы и гарантийные письма с фамилиями пациентов, а
 * выдача по должности означает, что новый сотрудник получит всю историю
 * переписки раньше, чем кто-то об этом подумает. Поэтому только поимённо, и
 * каждая выдача — видимое действие живого человека, попадающее в журнал.
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

export default function AdminMail() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [centers, setCenters] = useState([]);
  const [staff, setStaff] = useState([]);

  const [editing, setEditing] = useState(null);   // id ящика либо 'new'
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const [grantFor, setGrantFor] = useState(null);
  const [staffQuery, setStaffQuery] = useState('');

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
    medCentersApi.list().then(({ data }) => setCenters(data.medCenters || data || [])).catch(() => {});
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
    const total = account.stats?.total || 0;
    const ok = window.confirm(
      `Удалить ящик ${account.email}?\n\n` +
      `Из портала пропадут ${total} писем и все выданные доступы. ` +
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

  if (loading) {
    return <div className="amail-page amail-page--center"><Loader className="amail-spin" size={28} /></div>;
  }

  return (
    <div className="amail-page">
      <header className="amail-head">
        <div>
          <h1><MailIcon size={22} /> Почтовые ящики</h1>
          <p>
            Ящики заводятся здесь, сотрудники получают доступ к готовому — своих паролей
            никто не вводит. Письма забирает отдельный процесс синхронизации.
          </p>
        </div>
        <button type="button" className="amail-btn amail-btn--primary" onClick={startCreate}>
          <Plus size={16} /> Добавить ящик
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

      <div className="amail-list">
        {accounts.map((account) => {
          const state = SYNC_STATES[account.syncState] || SYNC_STATES.idle;
          const caps = account.capabilities || {};
          return (
            <article key={account.id} className="amail-card">
              <div className="amail-card__head">
                <div className="amail-card__title">
                  <h3>{account.displayName}</h3>
                  <span className="amail-email">{account.email}</span>
                  {account.medCenter && <span className="amail-chip">{account.medCenter.name}</span>}
                  {!account.isActive && <span className="amail-chip amail-chip--off">выключен</span>}
                </div>
                <span className={`amail-state amail-state--${state.tone}`}>{state.label}</span>
              </div>

              <div className="amail-stats">
                <span><b>{account.stats?.total || 0}</b> писем</span>
                <span><b>{account.stats?.unread || 0}</b> непрочитанных</span>
                <span><b>{account.stats?.pending || 0}</b> без тела</span>
                {account.lastSyncAt && (
                  <span className="amail-muted">
                    синхронизация {new Date(account.lastSyncAt).toLocaleString('ru-RU')}
                  </span>
                )}
              </div>

              {account.lastError && (
                <div className="amail-error">
                  <AlertTriangle size={15} /> {account.lastError}
                </div>
              )}

              {/* Возможности сервера показываем не из любопытства: от CONDSTORE
                  зависит, дорого или дёшево обходится синхронизация, и когда
                  ящик начнёт отставать, это первое, куда стоит посмотреть. */}
              {caps.raw && (
                <div className="amail-caps">
                  {[['CONDSTORE', caps.condstore], ['QRESYNC', caps.qresync], ['IDLE', caps.idle],
                    ['MOVE', caps.move], ['UIDPLUS', caps.uidplus], ['SPECIAL-USE', caps.specialUse]]
                    .map(([name, ok]) => (
                      <span key={name} className={`amail-cap ${ok ? 'yes' : 'no'}`}>
                        {ok ? <Check size={11} /> : <X size={11} />} {name}
                      </span>
                    ))}
                </div>
              )}

              {testResult && testResult.id === account.id && (
                <div className={`amail-test ${testResult.ok === false ? 'bad' : 'ok'}`}>
                  {testResult.ok === false
                    ? <>Сервер отказал: {testResult.error}</>
                    : <>Подключение за {testResult.ms} мс, папок на сервере: {testResult.folders?.length}</>}
                </div>
              )}

              <div className="amail-actions">
                <button type="button" className="amail-btn" onClick={() => startEdit(account)}>Изменить</button>
                <button type="button" className="amail-btn" disabled={testing === account.id} onClick={() => testConnection(account)}>
                  <Plug size={15} /> {testing === account.id ? 'Проверяем…' : 'Проверить связь'}
                </button>
                <button type="button" className="amail-btn" onClick={() => syncNow(account)}>
                  <RefreshCw size={15} /> Синхронизировать
                </button>
                <button type="button" className="amail-btn" onClick={() => openAudit(account)}>
                  <ScrollText size={15} /> Журнал
                </button>
                <button type="button" className="amail-btn amail-btn--danger" onClick={() => remove(account)}>
                  <Trash2 size={15} /> Удалить
                </button>
              </div>

              {/* ── Доступы ── */}
              <div className="amail-access">
                <div className="amail-access__head">
                  <h4>Доступ ({account.access.length})</h4>
                  <button
                    type="button"
                    className="amail-btn amail-btn--small"
                    onClick={() => { setGrantFor(grantFor === account.id ? null : account.id); setStaffQuery(''); }}
                  >
                    <UserPlus size={14} /> Выдать
                  </button>
                </div>

                {grantFor === account.id && (
                  <div className="amail-picker">
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
                  </div>
                )}

                {!account.access.length && <div className="amail-muted">Доступ пока ни у кого</div>}

                {account.access.map((access) => (
                  <div key={access.id} className="amail-person">
                    <span className="amail-person__name">
                      {access.user?.displayName || access.user?.username || '—'}
                      <small>{access.user?.username}</small>
                    </span>
                    <label className="amail-toggle" title="Может отправлять письма от имени ящика">
                      <input
                        type="checkbox" checked={access.canSend}
                        onChange={(e) => changeRights(account.id, access, { canSend: e.target.checked })}
                      />
                      <Send size={13} /> отправка
                    </label>
                    <label className="amail-toggle" title="Удаление письма стирает его и на сервере">
                      <input
                        type="checkbox" checked={access.canDelete}
                        onChange={(e) => changeRights(account.id, access, { canDelete: e.target.checked })}
                      />
                      <Trash2 size={13} /> удаление
                    </label>
                    <button type="button" className="amail-icon-btn" title="Забрать доступ" onClick={() => revoke(account.id, access)}>
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>

              {auditFor === account.id && (
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
                        {entry.detail?.subject || entry.detail?.filename || entry.detail?.user || ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
