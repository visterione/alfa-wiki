import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Inbox, MessageCircle, Archive, Send, Check, Search, ArrowLeft,
  AlertTriangle, Paperclip, Headphones, Star, CornerDownRight
} from 'lucide-react';
import { openLine as openLineApi } from '../services/api';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import NotificationsPanel from './NotificationsPanel';
import OpenLineSettings from './OpenLineSettings';
import OpenLineStats from './OpenLineStats';
import ChannelAvatar from '../components/openline/ChannelAvatar';
import toast from 'react-hot-toast';
// Оформление берём у мессенджера целиком, а не повторяем своим набором классов:
// это одна и та же работа, только собеседник другой — сотрудник там, пациент
// здесь. Свой файл ниже добавляет лишь то, чего в мессенджере нет (см. шапку
// OpenLine.css).
import './Dashboard.css';
import './OpenLine.css';
import './NotificationsPanel.css';

/**
 * Открытая линия: обращения пациентов из ботов (ver. 7.85, интерфейс — 7.99).
 *
 * Три списка, а не один с фильтром: очередь — то, что надо разобрать, «мои» —
 * то, что надо довести, архив — то, куда лезут раз в месяц при разборе жалобы.
 * В одном списке эти три состояния мешали бы друг другу.
 *
 * Переписка с человеком одна и вечная: повторный вопрос через месяц ложится в
 * тот же чат, а прошлые обращения отбиваются в ленте разделителями. До 7.99
 * каждое обращение было отдельной карточкой, и оператор начинал разговор с
 * чистого листа, ничего не зная о предыдущем.
 *
 * Кнопки «начать день» здесь больше нет — смена переехала в виджет в меню
 * пользователя (Header.js): её включают один раз за смену, а место в рабочем
 * окне она занимала постоянно.
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

/** «79001234567» → «+7 (900) 123-45-67». Хранится нормализованным, читается — нет. */
function formatPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length !== 11) return String(raw || '');
  return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`;
}

/** Короткое имя для строки списка: длинная подпись туда не влезает. */
function personShort(s) {
  if (!s) return 'Неизвестный';
  if (s.patientName) return s.patientName;
  if (s.phone) return formatPhone(s.phone);
  const name = [s.lastName, s.firstName].filter(Boolean).join(' ');
  return name || s.username || 'Без номера';
}

/**
 * Подпись в шапке переписки: «№123456 Иванов Иван Иванович (01.01.1999)
 * +7 (900) 123-45-67».
 *
 * Пациент, пишущий впервые, карты в МИС ещё не имеет — тогда остаётся один
 * телефон, и это нормальное состояние, а не пробел в данных.
 */
function personTitle(s) {
  if (!s) return 'Неизвестный';
  const phone = s.phone ? formatPhone(s.phone) : '';
  if (!s.patientName) return phone || 'Без номера';

  const card = s.patientCard ? `№${s.patientCard} ` : '';
  const birth = s.patientBirthDate ? ` (${s.patientBirthDate})` : '';
  return `${card}${s.patientName}${birth}${phone ? ` ${phone}` : ''}`;
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

function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'Сегодня';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const dayKey = (value) => new Date(value).toDateString();
const userName = (u) => (u ? (u.displayName || u.username) : '');

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

/** Оценка пациента — пятью звёздами, а не цифрой: цифру без шкалы не прочесть. */
function Stars({ value }) {
  return (
    <span className="ol-stars" aria-label={`Оценка ${value} из 5`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={12} className={n <= value ? 'on' : ''} />
      ))}
    </span>
  );
}

export default function OpenLine() {
  const { user } = useAuth();
  // Экран держим в адресе, как в «Задачах»: ссылка на журнал уведомлений должна
  // открываться журналом, а не сбрасывать человека в очередь обращений.
  const [params, setParams] = useSearchParams();
  const asked = params.get('screen');
  const screen = ['notifications', 'settings', 'stats'].includes(asked) ? asked : 'conversations';

  const [state, setState] = useState(null);          // смена и линии сотрудника
  const [scope, setScope] = useState('queue');
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [thread, setThread] = useState(null);        // { conversation, messages, sessions }
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const bottomRef = useRef(null);
  const fieldRef = useRef(null);

  /**
   * Поле ответа растёт под текст: оператор пишет абзацами, а в одну строку из
   * них видно только конец. Считаем по scrollHeight, потолок — в CSS
   * (max-height), дальше поле прокручивается.
   */
  const fitField = useCallback(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

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
      const { data } = await openLineApi.conversations(scope, query.trim());
      setConversations(data);
    } catch (err) {
      if (err.response?.status !== 403) toast.error('Не удалось загрузить список обращений');
    } finally {
      setLoading(false);
    }
  }, [scope, query]);

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

  // Поиск по списку — с задержкой: запрос на каждую букву не нужен ни серверу,
  // ни человеку, который ещё набирает фамилию.
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(loadList, query.trim() ? 300 : 0);
    return () => clearTimeout(timer);
  }, [loadList, query]);

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
  }, [thread?.messages?.length, activeId]);

  // ── Действия ────────────────────────────────────────────────────────────

  const take = async (id) => {
    try {
      await openLineApi.assign(id);
      setScope('mine');
      setActiveId(id);
      loadList();
      loadThread(id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось взять обращение');
      loadList();
    }
  };

  const closeConversation = async (id) => {
    try {
      await openLineApi.close(id);
      toast.success('Обращение закрыто — пациенту отправлена просьба оценить работу');
      loadList();
      loadThread(id);
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
      // Высоту сбрасываем руками: она выставлена стилем, и очистка значения сама
      // её не вернёт — поле осталось бы растянутым на пять пустых строк.
      if (fieldRef.current) fieldRef.current.style.height = 'auto';
      // Недоставленное показываем сразу: оператор должен узнать об этом от нас,
      // а не по молчанию пациента.
      if (data.deliveryError) toast.error(data.deliveryError);
      await loadThread(activeId);
      loadList();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Сообщение не отправлено');
    } finally {
      setSending(false);
    }
  };

  // ── Лента ───────────────────────────────────────────────────────────────

  /**
   * Раскладывает переписку на строки: сообщения вперемешку с разделителями.
   *
   * Разделителей два вида, и оба нужны. Начало обращения — то, ради чего лента
   * вообще стала сплошной: без него полугодовая переписка читается как один
   * бесконечный разговор. Смена дня внутри обращения — обычная подпись, как в
   * мессенджере. Конец обращения показывается только у закрытых: по нему видно,
   * кто довёл разговор и как это оценили.
   */
  const rows = useMemo(() => {
    if (!thread) return [];

    const sessions = new Map((thread.sessions || []).map(s => [s.id, s]));
    const out = [];
    let prevSessionId;
    let prevDay;

    const endOf = (sessionId) => {
      const s = sessions.get(sessionId);
      if (s && s.closedAt) out.push({ kind: 'session-end', key: `end-${s.id}`, session: s });
    };

    for (const m of thread.messages) {
      const day = dayKey(m.createdAt);

      if (m.sessionId !== prevSessionId) {
        if (prevSessionId !== undefined) endOf(prevSessionId);
        out.push({
          kind: 'session-start',
          key: `start-${m.sessionId || m.id}`,
          session: sessions.get(m.sessionId),
          at: m.createdAt
        });
        prevSessionId = m.sessionId;
        prevDay = day;
      } else if (day !== prevDay) {
        out.push({ kind: 'day', key: `day-${m.id}`, at: m.createdAt });
        prevDay = day;
      }

      out.push({ kind: 'message', key: m.id, message: m });
    }

    if (prevSessionId !== undefined) endOf(prevSessionId);
    return out;
  }, [thread]);

  // ── Отрисовка ───────────────────────────────────────────────────────────

  const screenTabs = (
    <nav className="ol-screens">
      <button
        className={screen === 'conversations' ? 'active' : ''}
        onClick={() => setParams({})}
      >Обращения</button>
      <button
        className={screen === 'stats' ? 'active' : ''}
        onClick={() => setParams({ screen: 'stats' })}
      >Показатели</button>
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

  if (screen === 'stats') {
    return (
      <div className="ol-page">
        {screenTabs}
        <OpenLineStats />
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
  const subscriber = conversation?.subscriber;

  return (
    <div className="ol-page">
      {screenTabs}

      <div className="ol-chat">
        <div className="alfa-chat">
          <div className={`chat-sidebar ${activeId ? 'mobile-hidden' : ''}`}>
            <div className="chat-sidebar-header">
              <h2><Headphones size={20} /> Открытая линия</h2>
            </div>

            <div className="chat-search-row">
              <div className="chat-search">
                <Search size={18} />
                <input
                  placeholder="Поиск по ФИО, карте и телефону…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>

            <nav className="ol-scopes">
              {SCOPES.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  className={`ol-scope ${scope === key ? 'active' : ''}`}
                  onClick={() => setScope(key)}
                >
                  <Icon size={15} />
                  {label}
                  {key === scope && conversations.length > 0 && (
                    <span className="ol-scope-count">{conversations.length}</span>
                  )}
                </button>
              ))}
            </nav>

            <div className="chat-list">
              {loading && <div className="chat-loading"><div className="loading-spinner" /></div>}

              {!loading && conversations.length === 0 && (
                <div className="chat-empty">
                  {query.trim()
                    ? 'Ничего не найдено'
                    : scope === 'queue'
                      ? (state?.onShift ? 'Очередь пуста' : 'Начните смену в меню пользователя, чтобы видеть очередь')
                      : scope === 'mine' ? 'Взятых обращений нет' : 'Архив пуст'}
                </div>
              )}

              {!loading && conversations.map(c => (
                <div
                  key={c.id}
                  className={`chat-item ${activeId === c.id ? 'active' : ''} ${c.status === 'queued' ? 'has-unread' : ''}`}
                  onClick={() => setActiveId(c.id)}
                >
                  <div className="chat-item-avatar-wrap">
                    <ChannelAvatar platform={c.subscriber?.platform} size={48} />
                  </div>
                  <div className="chat-item-content">
                    <div className="chat-item-name">{personShort(c.subscriber)}</div>
                    <div className="chat-item-preview">
                      {c.preview
                        ? `${c.preview.direction === 'out' ? 'Вы: ' : ''}${c.preview.text || 'Вложение'}`
                        : (c.line?.medCenter?.name || c.line?.name || 'Нет сообщений')}
                    </div>
                  </div>
                  <div className="chat-item-right">
                    <div className="chat-item-time">{timeLabel(c.lastMessageAt)}</div>
                    <div className="chat-item-right-meta">
                      {c.status === 'queued' && <span className="ol-tag new">новое</span>}
                      {c.status === 'assigned' && c.assignee && !isMineAssignee(c, user) && (
                        <span className="ol-tag">{userName(c.assignee)}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={`chat-main ${activeId ? '' : 'mobile-hidden'}`}>
            {!conversation ? (
              <div className="chat-placeholder">
                <MessageCircle size={64} />
                <h3>Открытая линия</h3>
                <p>Выберите обращение слева</p>
              </div>
            ) : (
              <>
                <div className="chat-main-header">
                  <button className="btn-icon-chat mobile-only" onClick={() => setActiveId(null)}>
                    <ArrowLeft size={20} />
                  </button>
                  <div className="chat-main-avatar ol-head-avatar">
                    <ChannelAvatar platform={subscriber?.platform} size={40} />
                  </div>
                  <div className="chat-main-info">
                    <div className="chat-main-name" title={personTitle(subscriber)}>
                      {personTitle(subscriber)}
                    </div>
                    <div className="chat-main-status">
                      {conversation.line?.medCenter?.name || conversation.line?.name}
                      {conversation.status === 'queued' && ' · в очереди'}
                      {conversation.status === 'assigned' && (isMine ? ' · у вас' : ` · ведёт ${userName(conversation.assignee)}`)}
                      {conversation.status === 'closed' && ' · обращение закрыто'}
                    </div>
                  </div>

                  <div className="ol-head-actions">
                    {conversation.status === 'queued' && (
                      <button className="btn btn-primary ol-head-btn" onClick={() => take(conversation.id)}>
                        Взять себе
                      </button>
                    )}
                    {conversation.status === 'assigned' && isMine && (
                      <button className="btn ol-head-btn" onClick={() => closeConversation(conversation.id)}>
                        <Check size={15} /> Закрыть
                      </button>
                    )}
                  </div>
                </div>

                <div className="chat-messages">
                  {rows.map(row => {
                    if (row.kind === 'day') {
                      return (
                        <div key={row.key} className="date-separator">
                          <span>{dayLabel(row.at)}</span>
                        </div>
                      );
                    }

                    if (row.kind === 'session-start') {
                      return (
                        <div key={row.key} className="date-separator ol-session">
                          <span><CornerDownRight size={12} /> Обращение · {dayLabel(row.at)}</span>
                        </div>
                      );
                    }

                    if (row.kind === 'session-end') {
                      const s = row.session;
                      return (
                        <div key={row.key} className="ol-session-end">
                          <span>
                            Закрыто{s.assignee ? ` · ${userName(s.assignee)}` : ''}
                            {s.rating ? <> · <Stars value={s.rating} /></> : s.ratingAskedAt ? ' · без оценки' : ''}
                          </span>
                        </div>
                      );
                    }

                    const m = row.message;
                    const own = m.direction === 'out';
                    const hasAttachments = (m.attachments || []).length > 0;

                    return (
                      <div key={row.key} className={`message ${own ? 'own' : ''}`}>
                        {!own && (
                          <div className="message-avatar ol-message-avatar">
                            <ChannelAvatar platform={subscriber?.platform} size={32} />
                          </div>
                        )}
                        <div className={`message-bubble ${hasAttachments ? 'has-attachments' : ''}`}>
                          {own && m.author && (
                            <div className="message-sender">{userName(m.author)}</div>
                          )}
                          {hasAttachments && (
                            <div className="ol-msg-files">
                              {m.attachments.map((a, i) => renderAttachment(a, i, state?.fileToken))}
                            </div>
                          )}
                          {m.text && <div className="message-content">{m.text}</div>}
                          <div className="message-meta">
                            <span className="message-time">{timeLabel(m.createdAt)}</span>
                            {m.deliveryError && (
                              <span className="ol-msg-error" title={m.deliveryError}>
                                <AlertTriangle size={12} /> не доставлено
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>

                <form className="chat-input" onSubmit={send}>
                  <div className="chat-input-wrapper">
                    <textarea
                      ref={fieldRef}
                      className="ol-field"
                      value={draft}
                      onChange={e => { setDraft(e.target.value); fitField(); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); }
                      }}
                      placeholder={
                        conversation.status === 'closed'
                          ? 'Обращение закрыто — ответить можно, когда пациент напишет снова'
                          : canWrite ? 'Ответ пациенту…' : 'Обращение ведёт другой сотрудник'
                      }
                      disabled={!canWrite || sending}
                      rows={1}
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary btn-icon"
                    disabled={!canWrite || sending || !draft.trim()}
                    title="Отправить"
                  >
                    <Send size={20} />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Взято ли обращение самим смотрящим — в строке списка его имя показывать незачем. */
function isMineAssignee(conversation, user) {
  return conversation.assigneeUserId === user?.id;
}
