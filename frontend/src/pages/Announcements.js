import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Clock, Copy, Mail, Megaphone, Plus, RefreshCw } from 'lucide-react';
import BroadcastsTab from './admin/BroadcastsTab';
import EmailComposeModal from '../components/EmailComposeModal';
import { email } from '../services/api';
import toast from 'react-hot-toast';
import './admin/AdminOpenLine.css';
import './Announcements.css';

const EMAIL_STATUS = {
  scheduled: 'запланирована',
  sending: 'отправляется',
  canceled: 'отменена',
  sent: 'отправлена',
  partial: 'частично',
  failed: 'ошибка'
};

function fmt(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value));
}

function EmailAnnouncements() {
  const [compose, setCompose] = useState(null);
  const [logs, setLogs] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await email.getHistory({ limit: 100 });
      setLogs(data.logs || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось загрузить почтовые рассылки');
      setLogs([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const cancel = async (id) => {
    try {
      await email.cancelScheduled(id);
      toast.success('Отложенная отправка отменена');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось отменить');
    }
  };

  return (
    <section className="ann-email">
      <div className="ann-email-toolbar">
        <button className="ola-btn primary" onClick={() => setCompose({})}>
          <Plus size={15} /> Новая почтовая рассылка
        </button>
        <button className="ola-btn" onClick={load} title="Обновить"><RefreshCw size={15} /></button>
      </div>

      <div className="ola-card">
        <header><span className="ola-card-icon accent"><Mail size={17} /></span><h3>История</h3></header>
        <div className="ola-card-body ann-email-list">
          {logs === null && <div className="ola-loading">Загрузка…</div>}
          {logs?.length === 0 && <div className="ola-empty"><Mail size={28} /><span>Почтовых рассылок пока нет</span></div>}
          {logs?.map(log => (
            <article className="ann-email-item" key={log.id}>
              <div>
                <strong>{log.subject}</strong>
                <span>{log.sender?.displayName || log.sender?.username || 'Система'} · {log.recipients?.length || 0} получателей</span>
              </div>
              <div className="ann-email-state">
                <span className={`ola-badge ${log.status === 'failed' ? 'bad' : ['scheduled', 'sending'].includes(log.status) ? 'wait' : log.status === 'canceled' ? 'muted' : 'ok'}`}>
                  {log.status === 'scheduled' && <Clock size={12} />}
                  {EMAIL_STATUS[log.status] || log.status}
                </span>
                <time>{fmt(log.scheduledAt || log.sentAt || log.createdAt)}</time>
                {log.status === 'scheduled' && <button className="ola-btn ann-repeat danger" onClick={() => cancel(log.id)}>Отменить</button>}
                <button className="ola-btn ann-repeat" onClick={() => setCompose(log)}><Copy size={13} /> Повторить</button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {compose && <EmailComposeModal initialDraft={compose.id ? compose : null} onClose={() => { setCompose(null); load(); }} />}
    </section>
  );
}

export default function Announcements() {
  const [channel, setChannel] = useState('bots');

  return (
    <div className="admin-page">
      <div className="ola-shell ann-shell">
        <div className="ola-head ann-head">
          <span className="ann-title-icon"><Megaphone size={22} /></span>
          <div><h1>Анонсы</h1><p>Рекламные рассылки через ботов и электронную почту</p></div>
        </div>
        <nav className="ola-tabs ann-tabs">
          <button className={`ola-tab ${channel === 'bots' ? 'active' : ''}`} onClick={() => setChannel('bots')}>
            <Bot size={15} /> Боты
          </button>
          <button className={`ola-tab ${channel === 'email' ? 'active' : ''}`} onClick={() => setChannel('email')}>
            <Mail size={15} /> Почта
          </button>
        </nav>
        {channel === 'bots' ? <BroadcastsTab /> : <EmailAnnouncements />}
      </div>
    </div>
  );
}
