import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Inbox, MessageCircle, Archive, Power, Send, Check, User as UserIcon,
  Phone, AlertTriangle, RefreshCw, Paperclip
} from 'lucide-react';
import { openLine as openLineApi } from '../services/api';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import NotificationsPanel from './NotificationsPanel';
import OpenLineSettings from './OpenLineSettings';
import toast from 'react-hot-toast';
import './OpenLine.css';
import './NotificationsPanel.css';

/**
 * Открытая линия: обращения пациентов из ботов (ver. 7.85).
 *
 * Три списка, а не один с фильтром: очередь — то, что надо разобрать, «мои» —
 * то, что надо довести, архив — то, куда лезут раз в месяц при разборе жалобы.
 * В одном списке эти три состояния мешали бы друг другу.
 *
 * Обновление списков опросом раз в несколько секунд. Сокета здесь намеренно нет:
 * входящие разбирает отдельный процесс забора обновлений, у которого своего
 * Socket.IO нет, а тянуть межпроцессную рассылку ради очереди из десятка
 * обращений — дороже, чем она стоит.
 */

const POLL_MS = 5000;

const SCOPES = [
  { key: 'queue',  label: 'Очередь', icon: Inbox },
  { key: 'mine',   label: 'Мои',     icon: MessageCircle },
  { key: 'closed', label: 'Архив',   icon: Archive }
];

function personName(subscriber) {
  if (!subscriber) return 'Неизвестный';
  const name = [subscriber.lastName, subscriber.firstName].filter(Boolean).join(' ');
  return name || subscriber.username || subscriber.phone || 'Без имени';
}

function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}


/**
 * Вложение в переписке. Картинку показываем сразу — обычно это фотография
 * направления или анализа, и открывать её отдельным кликом только мешает.
 * Токен в ?t= обязателен: файлы пациентов закрыты проверкой доступа, а в <img>
 * заголовок не подставить.
 */
function renderAttachment(a, key, fileToken) {
  if (a.tooLarge) {
    return <span key={key} className="ol-chip">Файл слишком большой — попросите прислать иначе</span>;
  }
  if (!a.url) {
    return <span key={key} className="ol-chip">{a.title || a.kind}</span>;
  }

  const href = fileToken ? `${a.url}?t=${encodeURIComponent(fileToken)}` : a.url;

  if (a.kind === 'photo') {
    return (
      <a key={key} href={href} target="_blank" rel="noreferrer" className="ol-photo">
        <img src={href} alt={a.title || 'Вложение'} loading="lazy" />
      </a>
    );
  }
  if (a.kind === 'voice') {
    return <audio key={key} className="ol-audio" src={href} controls preload="none" />;
  }
  return (
    <a key={key} href={href} target="_blank" rel="noreferrer" className="ol-chip ol-file">
      <Paperclip size={11} />{a.title || 'Файл'}
    </a>
  );
}

export default function OpenLine() {
  const { user } = useAuth();
  // Экран держим в адресе, как в «Задачах»: ссылка на журнал уведомлений должна
  // открываться журналом, а не сбрасывать человека в очередь обращений.
  const [params, setParams] = useSearchParams();
  const asked = params.get('screen');
  const screen = ['notifications', 'settings'].includes(asked) ? asked : 'conversations';

  const [state, setState] = useState(null);          // смена и линии сотрудника
  const [scope, setScope] = useState('queue');
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [thread, setThread] = useState(null);        // { conversation, messages }
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const bottomRef = useRef(null);

  // ── Загрузка ────────────────────────────────────────────────────────────

  const loadState = useCallback(async () => {
    try {
      const { data } = await openLineApi.state();
      setState(data);
    } catch {
      // Молча: состояние смены перезапросится следующим тиком.
    }
  }, []);

  const loadList = useCallback(async () => {
    try {
      const { data } = await openLineApi.conversations(scope);
      setConversations(data);
    } catch (err) {
      if (err.response?.status !== 403) toast.error('Не удалось загрузить список обращений');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  const loadThread = useCallback(async (id) => {
    if (!id) return;
    try {
      const { data } = await openLineApi.conversation(id);
      setThread(data);
    } catch {
      toast.error('Не удалось открыть переписку');
    }
  }, []);

  // Состояние перечитываем и по таймеру: вместе с ним приезжает токен доступа к
  // вложениям, а он живёт сутки — у оператора, не закрывавшего вкладку смену
  // подряд, картинки иначе однажды перестанут открываться.
  useEffect(() => {
    loadState();
    const timer = setInterval(loadState, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [loadState]);
  useEffect(() => { setLoading(true); loadList(); }, [loadList]);
  useEffect(() => { loadThread(activeId); }, [activeId, loadThread]);

  // Опрос: список и открытая переписка. Пока оператор печатает, черновик не
  // трогаем — обновляется только то, что пришло с сервера.
  useEffect(() => {
    const timer = setInterval(() => {
      loadList();
      if (activeId) loadThread(activeId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [loadList, loadThread, activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages?.length]);

  // ── Действия ────────────────────────────────────────────────────────────

  const toggleShift = async () => {
    try {
      const { data } = await openLineApi.shift(!state?.onShift);
      setState(data);
      if (data.returnedToQueue > 0) {
        toast(`Возвращено в очередь: ${data.returnedToQueue}`, { icon: '↩️' });
      }
      loadList();
    } catch {
      toast.error('Не удалось переключить смену');
    }
  };

  const take = async (id) => {
    try {
      await openLineApi.assign(id);
      setScope('mine');
      setActiveId(id);
      loadList();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось взять обращение');
      loadList();
    }
  };

  const closeConversation = async (id) => {
    try {
      await openLineApi.close(id);
      toast.success('Обращение закрыто');
      setActiveId(null);
      setThread(null);
      loadList();
    } catch {
      toast.error('Не удалось закрыть обращение');
    }
  };

  const send = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending || !activeId) return;

    setSending(true);
    try {
      const { data } = await openLineApi.send(activeId, text);
      setDraft('');
      // Недоставленное показываем сразу: оператор должен узнать об этом от нас,
      // а не по молчанию пациента.
      if (data.deliveryError) toast.error(data.deliveryError);
      await loadThread(activeId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Сообщение не отправлено');
    } finally {
      setSending(false);
    }
  };

  // ── Отрисовка ───────────────────────────────────────────────────────────

  const screenTabs = (
    <nav className="ol-screens">
      <button
        className={screen === 'conversations' ? 'active' : ''}
        onClick={() => setParams({})}
      >Обращения</button>
      <button
        className={screen === 'notifications' ? 'active' : ''}
        onClick={() => setParams({ screen: 'notifications' })}
      >Уведомления</button>
      {user?.isAdmin && (
        <button
          className={screen === 'settings' ? 'active' : ''}
          onClick={() => setParams({ screen: 'settings' })}
        >Настройка линий</button>
      )}
    </nav>
  );

  if (screen === 'notifications') {
    return (
      <div className="ol-page">
        {screenTabs}
        <NotificationsPanel />
      </div>
    );
  }

  if (screen === 'settings') {
    return (
      <div className="ol-page">
        {screenTabs}
        <OpenLineSettings />
      </div>
    );
  }

  // Администратор может не работать ни на одной линии, но тексты уведомлений
  // правит именно он — переключатель разделов нужен и на этом экране.
  if (state && !state.isOperator) {
    return (
      <div className="ol-page">
        {screenTabs}
        <div className="ol-empty-page">
        <Inbox size={40} />
        <h2>Вы не заведены ни в одну линию</h2>
        <p>Открытая линия работает по составу: администратор добавляет сотрудников в линию медцентра.</p>
        </div>
      </div>
    );
  }

  const conversation = thread?.conversation;
  const isMine = conversation?.assigneeUserId === user?.id;
  const canWrite = conversation && conversation.status !== 'closed' && (isMine || !conversation.assigneeUserId);

  return (
    <div className="ol-page">
      {screenTabs}
      {/* has-active нужен только узкому экрану: там список и переписка не
          помещаются рядом, и класс переключает, что из них показывать. */}
      <div className={`ol-root ${activeId ? 'has-active' : ''}`}>
      <aside className="ol-side">
        <div className="ol-shift">
          <button
            className={`ol-shift-btn ${state?.onShift ? 'on' : ''}`}
            onClick={toggleShift}
          >
            <Power size={16} />
            {state?.onShift ? 'Закончить день' : 'Начать день'}
          </button>
          <p className="ol-shift-hint">
            {state?.onShift
              ? 'Новые обращения приходят вам'
              : 'Пока день не начат, очередь скрыта'}
          </p>
        </div>

        <nav className="ol-tabs">
          {SCOPES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={`ol-tab ${scope === key ? 'active' : ''}`}
              onClick={() => setScope(key)}
            >
              <Icon size={15} />
              {label}
              {key === scope && conversations.length > 0 && (
                <span className="ol-tab-count">{conversations.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="ol-list">
          {loading && <div className="ol-list-note"><RefreshCw size={14} className="ol-spin" /> Загрузка…</div>}

          {!loading && conversations.length === 0 && (
            <div className="ol-list-note">
              {scope === 'queue' && (state?.onShift ? 'Очередь пуста' : 'Начните день, чтобы видеть очередь')}
              {scope === 'mine' && 'Взятых обращений нет'}
              {scope === 'closed' && 'Архив пуст'}
            </div>
          )}

          {conversations.map(c => (
            <button
              key={c.id}
              className={`ol-item ${activeId === c.id ? 'active' : ''}`}
              onClick={() => setActiveId(c.id)}
            >
              <div className="ol-item-top">
                <span className="ol-item-name">{personName(c.subscriber)}</span>
                <span className="ol-item-time">{timeLabel(c.lastMessageAt)}</span>
              </div>
              <div className="ol-item-bottom">
                <span className="ol-item-line">{c.line?.medCenter?.name || c.line?.name}</span>
                {c.status === 'assigned' && c.assignee && (
                  <span className="ol-item-who">{c.assignee.displayName || c.assignee.username}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="ol-thread">
        {!conversation && (
          <div className="ol-placeholder">
            <MessageCircle size={36} />
            <p>Выберите обращение слева</p>
          </div>
        )}

        {conversation && (
          <>
            <header className="ol-thread-head">
              <div>
                <h3>{personName(conversation.subscriber)}</h3>
                <div className="ol-thread-meta">
                  <span className="ol-chip">{conversation.subscriber?.platform === 'max' ? 'MAX' : 'Telegram'}</span>
                  {conversation.subscriber?.phone && (
                    <span className="ol-chip"><Phone size={11} />{conversation.subscriber.phone}</span>
                  )}
                  <span className="ol-chip">{conversation.line?.medCenter?.name || conversation.line?.name}</span>
                  {conversation.subscriber?.patientIds?.length > 0 && (
                    <span className="ol-chip ok"><UserIcon size={11} />карта найдена</span>
                  )}
                </div>
              </div>

              <div className="ol-thread-actions">
                {conversation.status === 'queued' && (
                  <button className="ol-btn primary" onClick={() => take(conversation.id)}>Взять себе</button>
                )}
                {conversation.status === 'assigned' && isMine && (
                  <button className="ol-btn" onClick={() => closeConversation(conversation.id)}>
                    <Check size={14} /> Закрыть
                  </button>
                )}
                {conversation.status === 'assigned' && !isMine && (
                  <span className="ol-taken">Ведёт {conversation.assignee?.displayName || conversation.assignee?.username}</span>
                )}
                {conversation.status === 'closed' && <span className="ol-taken">Закрыто</span>}
              </div>
            </header>

            <div className="ol-messages">
              {thread.messages.map(m => (
                <div key={m.id} className={`ol-msg ${m.direction === 'out' ? 'out' : 'in'}`}>
                  <div className="ol-msg-body">
                    {m.text}
                    {m.attachments?.length > 0 && (
                      <div className="ol-msg-files">
                        {m.attachments.map((a, i) => renderAttachment(a, i, state?.fileToken))}
                      </div>
                    )}
                  </div>
                  <div className="ol-msg-foot">
                    {m.direction === 'out' && (m.author?.displayName || m.author?.username) && (
                      <span>{m.author.displayName || m.author.username}</span>
                    )}
                    <span>{timeLabel(m.createdAt)}</span>
                    {m.deliveryError && (
                      <span className="ol-msg-error" title={m.deliveryError}>
                        <AlertTriangle size={11} /> не доставлено
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <form className="ol-composer" onSubmit={send}>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); }
                }}
                placeholder={
                  conversation.status === 'closed'
                    ? 'Обращение закрыто'
                    : canWrite ? 'Ответ пациенту…' : 'Обращение ведёт другой сотрудник'
                }
                disabled={!canWrite || sending}
                rows={2}
              />
              <button type="submit" className="ol-send" disabled={!canWrite || sending || !draft.trim()}>
                <Send size={16} />
              </button>
            </form>
          </>
        )}
      </section>
      </div>
    </div>
  );
}
