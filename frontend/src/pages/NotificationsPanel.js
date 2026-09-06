import React, { useState, useEffect, useCallback } from 'react';
import { FileText, ScrollText, Check, X, AlertTriangle, Clock, Ban, Save, Eye } from 'lucide-react';
import { notifications as api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

/**
 * Шаблоны уведомлений и журнал отправок (ver. 7.86).
 *
 * Тексты правит администратор — так же, как он правил их на экране Renovatio до
 * переезда. Журнал открыт всем, кто работает на линии: вопрос «почему человек не
 * получил напоминание» задают операторам, и отвечать они должны сами.
 */

const EVENT_TITLES = {
  created: 'Запись на визит',
  moved: 'Перенос визита',
  cancelled: 'Отмена визита',
  reminder: 'Напоминание о визите',
  review: 'Просьба об отзыве'
};

const STATUS_VIEW = {
  sent: { label: 'доставлено', icon: Check, cls: 'ok' },
  pending: { label: 'ждёт отправки', icon: Clock, cls: 'wait' },
  failed: { label: 'не доставлено', icon: AlertTriangle, cls: 'bad' },
  skipped: { label: 'пропущено', icon: Ban, cls: 'muted' }
};

function beforeLabel(minutes) {
  if (!minutes) return '';
  if (minutes % 1440 === 0) return `за ${minutes / 1440} сут.`;
  if (minutes % 60 === 0) return `за ${minutes / 60} ч.`;
  return `за ${minutes} мин.`;
}

export default function NotificationsPanel() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;

  const [tab, setTab] = useState(isAdmin ? 'templates' : 'log');
  const [data, setData] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [preview, setPreview] = useState({});
  const [log, setLog] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  const loadTemplates = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data } = await api.templates();
      setData(data);
      setDrafts({});
    } catch {
      toast.error('Не удалось загрузить шаблоны');
    }
  }, [isAdmin]);

  const loadLog = useCallback(async () => {
    try {
      const { data } = await api.outbox(statusFilter ? { status: statusFilter } : {});
      setLog(data);
    } catch (err) {
      if (err.response?.status !== 403) toast.error('Не удалось загрузить журнал');
    }
  }, [statusFilter]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { if (tab === 'log') loadLog(); }, [tab, loadLog]);

  const textOf = (t) => (drafts[t.id] !== undefined ? drafts[t.id] : t.text);

  const save = async (t) => {
    try {
      await api.updateTemplate(t.id, { text: textOf(t) });
      toast.success('Текст сохранён');
      loadTemplates();
    } catch {
      toast.error('Не удалось сохранить');
    }
  };

  const toggle = async (t, field) => {
    try {
      await api.updateTemplate(t.id, { [field]: !t[field] });
      loadTemplates();
    } catch {
      toast.error('Не удалось изменить');
    }
  };

  const showPreview = async (t) => {
    try {
      const { data } = await api.preview(textOf(t));
      setPreview(p => ({ ...p, [t.id]: data.text }));
    } catch {
      toast.error('Предпросмотр не получился');
    }
  };

  const insert = (t, key) => {
    setDrafts(d => ({ ...d, [t.id]: `${textOf(t)}{{${key}}}` }));
  };

  return (
    <div className="nt-root">
      <nav className="nt-tabs">
        {isAdmin && (
          <button className={`nt-tab ${tab === 'templates' ? 'active' : ''}`} onClick={() => setTab('templates')}>
            <FileText size={15} /> Тексты
          </button>
        )}
        <button className={`nt-tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>
          <ScrollText size={15} /> Журнал отправок
        </button>
      </nav>

      {/* Предохранители показываем крупно: пока вторая ступень выключена,
          половина отправок помечается пропущенной, и это надо понимать, а не
          выяснять по журналу. */}
      {isAdmin && data && !data.safety.fromniAllowed && (
        <div className="nt-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>Вторая ступень каскада выключена.</strong> Уведомления уходят только
            подписчикам ботов; всё остальное помечается пропущенным. Включается в <code>.env</code>
            {' '}(<code>NOTIFIER_ALLOW_FROMNI=true</code>) — вместе со снятием галок «Отправлять
            сообщение» в МИС у той же организации, иначе пациент получит два уведомления.
          </div>
        </div>
      )}

      {tab === 'templates' && data && (
        <div className="nt-templates">
          {data.templates.map(t => (
            <article key={t.id} className={`nt-card ${t.isActive ? '' : 'off'}`}>
              <header>
                <h3>
                  {EVENT_TITLES[t.event] || t.event}
                  {t.event === 'reminder' && <span className="nt-when">{beforeLabel(t.beforeMinutes)}</span>}
                  {t.event === 'review' && (
                    <span className="nt-when">
                      через {beforeLabel(t.afterMinutes).replace('за ', '')} после визита
                      {t.frequency === 'daily' ? ', один раз за день' : ', по каждому визиту'}
                    </span>
                  )}
                </h3>
                <div className="nt-card-actions">
                  <label className="nt-check">
                    <input type="checkbox" checked={t.withConfirm} onChange={() => toggle(t, 'withConfirm')} />
                    кнопка «Подтверждаю»
                  </label>
                  <label className="nt-check">
                    <input type="checkbox" checked={t.isActive} onChange={() => toggle(t, 'isActive')} />
                    включено
                  </label>
                </div>
              </header>

              <textarea
                value={textOf(t)}
                onChange={e => setDrafts(d => ({ ...d, [t.id]: e.target.value }))}
                rows={3}
              />

              <div className="nt-placeholders">
                {data.placeholders.map(p => (
                  <button key={p.key} type="button" title={p.title} onClick={() => insert(t, p.key)}>
                    {`{{${p.key}}}`}
                  </button>
                ))}
              </div>

              {preview[t.id] && <div className="nt-preview">{preview[t.id]}</div>}

              <footer>
                <button className="nt-btn" onClick={() => showPreview(t)}>
                  <Eye size={14} /> Посмотреть
                </button>
                <button
                  className="nt-btn primary"
                  onClick={() => save(t)}
                  disabled={drafts[t.id] === undefined || drafts[t.id] === t.text}
                >
                  <Save size={14} /> Сохранить
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}

      {tab === 'log' && (
        <div className="nt-log">
          <div className="nt-log-head">
            {log && Object.entries(STATUS_VIEW).map(([key, view]) => (
              <button
                key={key}
                className={`nt-stat ${view.cls} ${statusFilter === key ? 'active' : ''}`}
                onClick={() => setStatusFilter(statusFilter === key ? '' : key)}
              >
                <span className="nt-stat-value">{log.counts[key] ?? 0}</span>
                <span className="nt-stat-label">{view.label}</span>
              </button>
            ))}
            <span className="nt-log-note">за сутки</span>
          </div>

          {log && log.rows.length === 0 && <p className="nt-empty">Отправок пока не было</p>}

          {log && log.rows.map(row => {
            const view = STATUS_VIEW[row.status] || STATUS_VIEW.pending;
            const Icon = view.icon;
            return (
              <article key={row.id} className={`nt-row ${view.cls}`}>
                <div className="nt-row-top">
                  <Icon size={14} />
                  <span className="nt-row-event">{EVENT_TITLES[row.event] || row.event}</span>
                  <span className="nt-row-phone">{row.phone || 'без телефона'}</span>
                  <span className="nt-row-time">
                    {new Date(row.sentAt || row.plannedAt).toLocaleString('ru-RU')}
                  </span>
                  {row.channel && <span className="nt-chip">{row.channel}</span>}
                </div>
                <div className="nt-row-text">{row.text}</div>
                {row.error && <div className="nt-row-error">{row.error}</div>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
