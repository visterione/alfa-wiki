import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, RefreshCw, Copy, Check, Bot, X, Eye, EyeOff } from 'lucide-react';
import { bots as botsApi, apiClients as apiClientsApi, BASE_URL } from '../../services/api';
import toast from 'react-hot-toast';

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

function TokenField({ token }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'monospace', fontSize: 13 }}>
      <span style={{ flex: 1, wordBreak: 'break-all' }}>
        {visible ? token : token.replace(/:.+/, ':••••••••••••••')}
      </span>
      <button className="btn btn-icon" onClick={() => setVisible(v => !v)} title={visible ? 'Скрыть' : 'Показать'}>
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <CopyButton text={token} />
    </div>
  );
}

const emptyForm = { name: '', username: '', description: '', webhookUrl: '', webhookSecretToken: '', servesForms: [] };

export default function AdminBots() {
  const [bots, setBots] = useState([]);
  const [publicForms, setPublicForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { mode: 'create'|'edit', bot? }
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(null);
  const [serverUrl, setServerUrl] = useState(() => {
    // Пытаемся определить реальный адрес из сохранённого значения или из текущего hostname
    const saved = localStorage.getItem('botServerUrl');
    if (saved) return saved;
    const { protocol, hostname } = window.location;
    // Если открыто с localhost — показываем подсказку что нужно поменять
    return hostname === 'localhost' || hostname === '127.0.0.1'
      ? 'http://ВАШ-IP-ИЛИ-ДОМЕН:9001'
      : `${protocol}//${hostname}:9001`;
  });

  const saveServerUrl = (val) => {
    setServerUrl(val);
    localStorage.setItem('botServerUrl', val);
  };

  const load = async () => {
    try {
      const { data } = await botsApi.list();
      setBots(data);
    } catch {
      toast.error('Ошибка загрузки ботов');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Список форм публичного API — для галочек «что доставляет бот»
    apiClientsApi.meta().then(({ data }) => setPublicForms(data.forms)).catch(() => {});
  }, []);

  const openCreate = () => {
    setForm(emptyForm);
    setModal({ mode: 'create' });
  };

  const openEdit = (bot) => {
    setForm({
      name: bot.name || '',
      username: bot.username || '',
      description: bot.description || '',
      webhookUrl: bot.webhookUrl || '',
      webhookSecretToken: '',
      servesForms: bot.servesForms || [],
    });
    setModal({ mode: 'edit', bot });
  };

  const toggleServedForm = (formType) => {
    setForm(f => ({
      ...f,
      servesForms: f.servesForms.includes(formType)
        ? f.servesForms.filter(t => t !== formType)
        : [...f.servesForms, formType],
    }));
  };

  const closeModal = () => setModal(null);

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Введите имя бота');
    if (!form.username.trim()) return toast.error('Введите username бота');

    setSaving(true);
    try {
      if (modal.mode === 'create') {
        const { data } = await botsApi.create({
          name: form.name.trim(),
          username: form.username.trim(),
          description: form.description.trim(),
          webhookUrl: form.webhookUrl.trim() || undefined,
          webhookSecretToken: form.webhookSecretToken.trim() || undefined,
        });
        // Формы проставляются отдельным запросом: создание бота их не принимает,
        // а сохранение форм разбирает подписки в чатах, где бот уже состоит
        if (form.servesForms.length > 0) {
          await botsApi.update(data.id, { servesForms: form.servesForms });
        }
        toast.success('Бот создан');
      } else {
        const upd = {
          name: form.name.trim(),
          description: form.description.trim(),
          webhookUrl: form.webhookUrl.trim() || null,
          servesForms: form.servesForms,
        };
        if (form.webhookSecretToken.trim()) upd.webhookSecretToken = form.webhookSecretToken.trim();
        await botsApi.update(modal.bot.id, upd);
        toast.success('Бот обновлён');
      }
      closeModal();
      load();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (bot) => {
    if (!window.confirm(`Удалить бота «${bot.name}»? Его история сообщений останется, но он будет удалён из всех чатов.`)) return;
    try {
      await botsApi.delete(bot.id);
      toast.success('Бот удалён');
      load();
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const handleRegenerate = async (bot) => {
    if (!window.confirm('Сгенерировать новый токен? Старый перестанет работать.')) return;
    setRegenerating(bot.id);
    try {
      const { data } = await botsApi.regenerateToken(bot.id);
      toast.success('Токен обновлён');
      setBots(prev => prev.map(b => b.id === bot.id ? { ...b, token: data.token } : b));
    } catch {
      toast.error('Ошибка генерации токена');
    } finally {
      setRegenerating(null);
    }
  };

  const getBaseUrl = () => BASE_URL.replace('/api', '');

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Боты</h1>
        <button className="btn btn-primary" onClick={openCreate}>
          <Plus size={18} /> Создать бота
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--bg-secondary)', fontSize: 13 }}>
        <strong>Как подключить Комфортел:</strong> создайте бота, скопируйте токен, в Комфортеле замените
        {' '}<code>https://api.telegram.org</code> на адрес сервера вики (IP или домен, доступный для Комфортел — не localhost).
        URL будет выглядеть так: <code>http://ВАШ-IP:9001/bot{'<TOKEN>'}/sendMessage</code>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="loading-spinner" /></div>
      ) : bots.length === 0 ? (
        <div className="admin-empty">
          <Bot size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>Нет ботов. Создайте первого.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Бот</th>
                <th>Username</th>
                <th>Токен</th>
                <th>Формы</th>
                <th>Webhook</th>
                <th>Статус</th>
                <th>Создан</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bots.map(bot => (
                <tr key={bot.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Bot size={18} style={{ opacity: 0.6 }} />
                      <strong>{bot.name}</strong>
                    </div>
                    {bot.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{bot.description}</div>}
                  </td>
                  <td><code>@{bot.username}</code></td>
                  <td style={{ minWidth: 260 }}>
                    <TokenField token={bot.token} />
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ marginTop: 4, fontSize: 11 }}
                      disabled={regenerating === bot.id}
                      onClick={() => handleRegenerate(bot)}
                    >
                      <RefreshCw size={12} /> {regenerating === bot.id ? 'Генерация...' : 'Новый токен'}
                    </button>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {(bot.servesForms || []).length === 0
                      ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                      : (bot.servesForms || []).map(t => (
                          <div key={t}>{publicForms.find(f => f.formType === t)?.title || t}</div>
                        ))
                    }
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {bot.webhookUrl
                      ? <span style={{ color: 'var(--color-success)' }}>✓ {bot.webhookUrl.length > 40 ? bot.webhookUrl.slice(0, 40) + '…' : bot.webhookUrl}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>Не задан (polling)</span>
                    }
                  </td>
                  <td>
                    <span className={`badge ${bot.isActive ? 'badge-success' : 'badge-error'}`}>
                      {bot.isActive ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {new Date(bot.createdAt).toLocaleDateString('ru-RU')}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-icon" onClick={() => openEdit(bot)} title="Редактировать">
                        <Edit2 size={16} />
                      </button>
                      <button className="btn btn-icon btn-danger" onClick={() => handleDelete(bot)} title="Удалить">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* curl-пример для первого бота */}
      {bots.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: '12px 16px', fontSize: 12 }}>
          <strong>Пример curl для Комфортел:</strong>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 8 }}>
            <label style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>Адрес сервера:</label>
            <input
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
              className="input"
              value={serverUrl}
              onChange={e => saveServerUrl(e.target.value)}
              placeholder="http://192.168.1.50:9001"
            />
            <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              (IP или домен, доступный для Комфортел)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <pre style={{ flex: 1, margin: 0, background: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 6, overflowX: 'auto' }}>
{`curl -X POST "${serverUrl}/bot${bots[0].token}/sendMessage" \\
  -H "Content-Type: application/json" \\
  -d '{"chat_id": "<UUID или integer чата>", "text": "Пропущенный вызов: 79991234567"}'`}
            </pre>
            <CopyButton text={`curl -X POST "${serverUrl}/bot${bots[0].token}/sendMessage" -H "Content-Type: application/json" -d '{"chat_id": "<chat_id>", "text": "Сообщение"}'`} />
          </div>
        </div>
      )}

      {/* Модал создания/редактирования */}
      {modal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal.mode === 'create' ? 'Создать бота' : `Редактировать: ${modal.bot.name}`}</h2>
              <button className="btn-icon" onClick={closeModal}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Имя бота <span style={{ color: 'red' }}>*</span></label>
                <input
                  className="input"
                  placeholder="Например: АТС Уведомления"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Username <span style={{ color: 'red' }}>*</span></label>
                <input
                  className="input"
                  placeholder="ats_bot (только буквы, цифры, _)"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  disabled={modal.mode === 'edit'}
                />
                {modal.mode === 'create' && (
                  <small className="text-muted">5–32 символа, только латиница, цифры и _</small>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Описание</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Отправляет уведомления о пропущенных вызовах"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Заявки с сайта, которые доставляет бот</label>
                {publicForms.length === 0 ? (
                  <small className="text-muted">Форм публичного API пока нет</small>
                ) : (
                  <>
                    {publicForms.map(f => (
                      <label key={f.formType} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={form.servesForms.includes(f.formType)}
                          onChange={() => toggleServedForm(f.formType)}
                        />
                        <span>{f.title}</span>
                      </label>
                    ))}
                    <small className="text-muted" style={{ display: 'block', marginTop: 6 }}>
                      Заявки будут приходить в те чаты, где состоит бот. Добавьте его в нужный
                      чат — подписка появится сама, убедиться можно командой <code>/subscriptions</code>.
                    </small>
                  </>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Webhook URL <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(если бот принимает события)</span></label>
                <input
                  className="input"
                  placeholder="https://your-service.com/webhook"
                  value={form.webhookUrl}
                  onChange={e => setForm(f => ({ ...f, webhookUrl: e.target.value }))}
                />
                <small className="text-muted">Оставьте пустым если бот только отправляет сообщения (getUpdates/polling)</small>
              </div>

              <div className="form-group">
                <label className="form-label">Secret Token для Webhook</label>
                <input
                  className="input"
                  placeholder={modal.mode === 'edit' ? '(оставьте пустым чтобы не менять)' : 'Необязательно'}
                  value={form.webhookSecretToken}
                  onChange={e => setForm(f => ({ ...f, webhookSecretToken: e.target.value }))}
                  type="password"
                  autoComplete="new-password"
                />
                <small className="text-muted">Отправляется в заголовке X-Telegram-Bot-Api-Secret-Token</small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeModal}>Отмена</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Сохранение...' : modal.mode === 'create' ? 'Создать' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
