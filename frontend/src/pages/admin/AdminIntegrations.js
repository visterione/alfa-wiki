import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, RefreshCw, Copy, Check, KeyRound, X, Send, AlertTriangle } from 'lucide-react';
import { apiClients as apiClientsApi } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

/**
 * Ключи публичного API и реестр доставки заявок.
 *
 * Главное отличие от прежнего порядка: права ключа редактируются. Раньше они
 * задавались один раз в scripts/createApiClient.js, и чтобы разрешить существующему
 * сайту новую форму, приходилось выпускать новый ключ и передавать его разработчику
 * заново. Здесь достаточно поставить галочку — ключ остаётся прежним.
 */

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className="btn btn-icon" onClick={handleCopy} title="Скопировать">
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

/** Ключ показывается ровно один раз — в базе только его хеш */
function NewKeyBanner({ apiKey, onClose }) {
  return (
    <div className="card" style={{ marginBottom: 16, padding: '14px 16px', border: '1px solid var(--color-warning, var(--amber-600))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <AlertTriangle size={18} style={{ color: 'var(--color-warning, var(--amber-600))' }} />
        <strong>Скопируйте ключ сейчас — больше он не отобразится</strong>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <code style={{ flex: 1, fontSize: 14, wordBreak: 'break-all' }}>{apiKey}</code>
        <CopyButton text={apiKey} />
        <button className="btn btn-icon" onClick={onClose}><X size={16} /></button>
      </div>
      <small className="text-muted">Передайте разработчику по защищённому каналу — не в общем чате.</small>
    </div>
  );
}

const emptyForm = { name: '', keyType: 'secret', scopes: [], allowedOrigins: '', allowedIps: '', rateLimitPerMin: 60 };

export default function AdminIntegrations() {
  const [clients, setClients] = useState([]);
  const [forms, setForms] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);   // null | { mode: 'create'|'edit', client? }
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState(null);
  const [tab, setTab] = useState('keys');     // keys | routing | submissions

  const load = useCallback(async () => {
    try {
      const [clientsRes, metaRes, submissionsRes] = await Promise.all([
        apiClientsApi.list(),
        apiClientsApi.meta(),
        apiClientsApi.submissions({ limit: 50 }),
      ]);
      setClients(clientsRes.data);
      setForms(metaRes.data.forms);
      setSubscriptions(metaRes.data.subscriptions);
      setSubmissions(submissionsRes.data);
    } catch {
      toast.error('Ошибка загрузки интеграций');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm(emptyForm);
    setModal({ mode: 'create' });
  };

  const openEdit = (client) => {
    setForm({
      name: client.name || '',
      keyType: client.keyType,
      scopes: client.scopes || [],
      allowedOrigins: (client.allowedOrigins || []).join('\n'),
      allowedIps: (client.allowedIps || []).join('\n'),
      rateLimitPerMin: client.rateLimitPerMin || 60,
    });
    setModal({ mode: 'edit', client });
  };

  const toggleScope = (scope) => {
    setForm(f => ({
      ...f,
      scopes: f.scopes.includes(scope) ? f.scopes.filter(s => s !== scope) : [...f.scopes, scope],
    }));
  };

  const splitLines = (value) => value.split('\n').map(s => s.trim()).filter(Boolean);

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Укажите название системы');
    if (form.keyType === 'public' && splitLines(form.allowedOrigins).length === 0) {
      return toast.error('Для ключа, вызываемого из браузера, обязателен хотя бы один Origin');
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        scopes: form.scopes,
        allowedOrigins: splitLines(form.allowedOrigins),
        allowedIps: splitLines(form.allowedIps),
        rateLimitPerMin: Number(form.rateLimitPerMin) || 60,
      };

      if (modal.mode === 'create') {
        const { data } = await apiClientsApi.create({ ...payload, keyType: form.keyType });
        setNewKey(data.key);
        toast.success('Ключ создан');
      } else {
        await apiClientsApi.update(modal.client.id, payload);
        toast.success('Сохранено — ключ при этом не изменился');
      }
      setModal(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleRotate = async (client) => {
    if (!window.confirm(
      `Перевыпустить ключ «${client.name}»?\n\nСтарый перестанет работать сразу, ` +
      `и сайт будет получать 401, пока разработчик не пропишет новый.\n\n` +
      `Для добавления прав перевыпуск не нужен — достаточно галочек в «Изменить».`
    )) return;

    try {
      const { data } = await apiClientsApi.rotate(client.id);
      setNewKey(data.key);
      toast.success('Ключ перевыпущен');
      load();
    } catch {
      toast.error('Ошибка перевыпуска');
    }
  };

  const handleRevoke = async (client) => {
    if (!window.confirm(`Отозвать ключ «${client.name}»? Запросы с ним перестанут приниматься.`)) return;
    try {
      await apiClientsApi.revoke(client.id);
      toast.success('Ключ отозван');
      load();
    } catch {
      toast.error('Ошибка отзыва');
    }
  };

  const handleRedeliver = async (submission) => {
    try {
      const { data } = await apiClientsApi.redeliver(submission.id);
      toast.success(`Отправлено: ${data.sent}, не вышло: ${data.failed}`);
      load();
    } catch {
      toast.error('Ошибка переотправки');
    }
  };

  const formTitle = (formType) => forms.find(f => f.formType === formType)?.title || formType;
  const scopeTitle = (scope) => forms.find(f => f.scope === scope)?.title || formTitle(scope.replace('forms:', ''));

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Интеграции</h1>
        {tab === 'keys' && (
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={18} /> Выдать ключ
          </button>
        )}
      </div>

      {newKey && <NewKeyBanner apiKey={newKey} onClose={() => setNewKey(null)} />}

      <div className="tabs" style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {[
          { id: 'keys',        label: 'Ключи' },
          { id: 'routing',     label: 'Куда уходят заявки' },
          { id: 'submissions', label: 'Заявки' },
        ].map(t => (
          <button
            key={t.id}
            className={`btn ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="admin-loading"><div className="loading-spinner" /></div>
      ) : tab === 'keys' ? (
        clients.length === 0 ? (
          <div className="admin-empty">
            <KeyRound size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
            <p>Ключей пока нет. Выдайте первый — например, сайту клиники.</p>
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Система</th>
                  <th>Ключ</th>
                  <th>Разрешённые формы</th>
                  <th>Лимит</th>
                  <th>Заявок</th>
                  <th>Последний вызов</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clients.map(client => (
                  <tr key={client.id} style={{ opacity: client.isActive ? 1 : 0.5 }}>
                    <td>
                      <strong>{client.name}</strong>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {client.keyType === 'public' ? 'Вызывается из браузера' : 'Вызывается с сервера'}
                        {!client.isActive && ' • отозван'}
                      </div>
                    </td>
                    <td><code style={{ fontSize: 12 }}>{client.keyPrefix}…</code></td>
                    <td style={{ maxWidth: 280 }}>
                      {(client.scopes || []).length === 0
                        ? <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>нет прав</span>
                        : (client.scopes || []).map(s => (
                            <div key={s} style={{ fontSize: 12 }}>{scopeTitle(s)}</div>
                          ))
                      }
                    </td>
                    <td style={{ fontSize: 12 }}>{client.rateLimitPerMin}/мин</td>
                    <td style={{ fontSize: 12 }}>{client.submissionCount}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString('ru-RU') : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-icon" onClick={() => openEdit(client)} title="Изменить права">
                          <Edit2 size={16} />
                        </button>
                        <button className="btn btn-icon" onClick={() => handleRotate(client)} title="Перевыпустить ключ">
                          <RefreshCw size={16} />
                        </button>
                        <button className="btn btn-icon btn-danger" onClick={() => handleRevoke(client)} title="Отозвать">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'routing' ? (
        <>
          <div className="card" style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--bg-secondary)', fontSize: 13 }}>
            Куда попадает заявка, задаётся тем, в какие чаты добавлен бот. Чтобы подключить
            новый чат — добавьте в него бота, обслуживающего нужную форму (раздел «Боты»).
            Точечно поправить можно командами в самом чате: <code>/subscriptions</code>,{' '}
            <code>/subscribe</code>, <code>/unsubscribe</code>.
          </div>

          {subscriptions.length === 0 ? (
            <div className="admin-empty">
              <p>Ни один чат не подписан на формы. Заявки будет некуда доставлять.</p>
            </div>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Форма</th><th>Чат</th><th>Бот</th><th>Ограничение источника</th></tr>
                </thead>
                <tbody>
                  {subscriptions.map(s => (
                    <tr key={s.id}>
                      <td><strong>{formTitle(s.formType)}</strong></td>
                      <td>{s.chat?.name || '—'}</td>
                      <td style={{ fontSize: 12 }}>{s.bot ? `${s.bot.name} (@${s.bot.username})` : '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {s.filters?.clientId
                          ? clients.find(c => c.id === s.filters.clientId)?.name || s.filters.clientId
                          : 'от всех'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        submissions.length === 0 ? (
          <div className="admin-empty"><p>Заявок пока не было.</p></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Когда</th><th>Форма</th><th>Доставка</th><th></th></tr>
              </thead>
              <tbody>
                {submissions.map(s => (
                  <tr key={s.id}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(s.createdAt).toLocaleString('ru-RU')}
                    </td>
                    <td>{formTitle(s.formType)}</td>
                    <td style={{ fontSize: 12 }}>
                      {s.deliveries.length === 0
                        ? <span style={{ color: 'var(--color-error, var(--red-600))' }}>адресатов не было</span>
                        : s.deliveries.map((d, i) => (
                            <div key={i}>
                              {d.status === 'sent' ? '✓' : '✗'} {d.chatName || d.chatId}
                              {d.status !== 'sent' && d.error && (
                                <span style={{ color: 'var(--text-muted)' }}> — {d.error}</span>
                              )}
                            </div>
                          ))
                      }
                    </td>
                    <td>
                      {s.deliveryStatus !== 'sent' && (
                        <button className="btn btn-sm btn-ghost" onClick={() => handleRedeliver(s)}>
                          <Send size={14} /> Переотправить
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal.mode === 'create' ? 'Выдать ключ' : `Права: ${modal.client.name}`}</h2>
              <button className="btn-icon" onClick={() => setModal(null)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Название системы <span style={{ color: 'red' }}>*</span></label>
                <input
                  className="input"
                  placeholder="Сайт medcentralfa.ru"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              {modal.mode === 'create' && (
                <div className="form-group">
                  <label className="form-label">Откуда вызывают</label>
                  <select
                    className="input"
                    value={form.keyType}
                    onChange={e => setForm(f => ({ ...f, keyType: e.target.value }))}
                  >
                    <option value="secret">С сервера сайта (обычный случай)</option>
                    <option value="public">Из браузера — ключ виден в коде страницы</option>
                  </select>
                  <small className="text-muted">
                    Ключ для браузера видит любой посетитель, поэтому для него обязателен список Origin.
                  </small>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Какие действия разрешены</label>
                {forms.length === 0 ? (
                  <small className="text-muted">Доступных действий пока нет</small>
                ) : forms.map(f => (
                  <label key={f.scope} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.scopes.includes(f.scope)}
                      onChange={() => toggleScope(f.scope)}
                    />
                    <span>{f.title}</span>
                    <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.formType}</code>
                  </label>
                ))}
                {modal.mode === 'edit' && (
                  <small className="text-muted" style={{ display: 'block', marginTop: 6 }}>
                    Ключ при изменении прав не меняется — разработчику сайта ничего передавать не нужно.
                  </small>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">
                  Разрешённые Origin {form.keyType === 'public' && <span style={{ color: 'red' }}>*</span>}
                </label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder={'https://medcentralfa.ru\nhttps://www.medcentralfa.ru'}
                  value={form.allowedOrigins}
                  onChange={e => setForm(f => ({ ...f, allowedOrigins: e.target.value }))}
                />
                <small className="text-muted">По одному в строке</small>
              </div>

              <div className="form-group">
                <label className="form-label">Разрешённые IP</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Оставьте пустым, чтобы не ограничивать"
                  value={form.allowedIps}
                  onChange={e => setForm(f => ({ ...f, allowedIps: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Лимит запросов в минуту</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={form.rateLimitPerMin}
                  onChange={e => setForm(f => ({ ...f, rateLimitPerMin: e.target.value }))}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal(null)}>Отмена</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Сохранение...' : modal.mode === 'create' ? 'Выдать ключ' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
