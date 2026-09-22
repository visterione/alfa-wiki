import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Inbox, Send, FileText, Trash2, AlertOctagon, Archive, Folder as FolderIcon,
  Paperclip, Star, Search, RefreshCw, Mail as MailIcon, ArrowLeft, Settings,
  Image as ImageIcon, CircleDot, UserCheck, Download, Loader, Bookmark,
  BookmarkPlus, X, HelpCircle, Reply, ReplyAll, Forward, PenSquare, FileEdit,
  Trash, MessagesSquare, ChevronDown, ChevronRight
} from 'lucide-react';
import { mail as mailApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import Compose from '../components/mail/Compose';
import './Mail.css';

/**
 * Почта: чтение и поиск по общим ящикам сети (ver. 8.58).
 *
 * Ящики заводит администратор, человек приходит на готовое — своих паролей
 * здесь никто не вводит. У одного сотрудника доступ бывает к нескольким ящикам
 * сразу, и переключение между ними — левая колонка, а не выпадающий список: с
 * пятью ящиками список означал бы два клика вместо одного на каждое
 * переключение.
 *
 * Список по умолчанию показывает ВСЕ доступные ящики вперемешку, и поиск тоже
 * идёт по всем сразу. Это главное, ради чего модуль затевался: в IMAP такого
 * запроса не существует в принципе — там поиск живёт внутри одной папки одного
 * ящика, и человеку с пятью ящиками приходилось обходить их по очереди.
 *
 * Письмо рисуется в изолированном iframe без доступа к нашему origin. Разметка
 * приходит от постороннего, и пускать её в DOM портала нельзя: чужой CSS
 * расползётся по интерфейсу, а картинка в один пиксель отчитается отправителю,
 * что письмо открыли. Внешние картинки поэтому заблокированы до нажатия.
 */

const FOLDER_ICONS = {
  '\\Sent': Send,
  '\\Drafts': FileText,
  '\\Trash': Trash2,
  '\\Junk': AlertOctagon,
  '\\Archive': Archive,
};

function folderIcon(folder) {
  if (folder.path && folder.path.toUpperCase() === 'INBOX') return Inbox;
  return FOLDER_ICONS[folder.specialUse] || FolderIcon;
}

/**
 * Дата в списке. Сегодняшнее письмо показывается временем, письмо этого года —
 * днём и месяцем, всё остальное — полной датой. В почтовом списке дата нужна,
 * чтобы отличить одно письмо от другого, а не чтобы прочитать её целиком.
 */
function listDate(value) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fullDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function shortDate(value) {
  return value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`;
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
  return `${n} Б`;
}

/**
 * Подсветку совпадения база отдаёт с тегами <em>. Вставлять чужую строку через
 * dangerouslySetInnerHTML не будем даже ради двух тегов: текст письма пришёл
 * снаружи. Разбираем сами и собираем из безопасных узлов.
 */
function renderHighlight(text) {
  if (!text) return null;
  const parts = String(text).split(/(<em>|<\/em>)/);
  const nodes = [];
  let marked = false;

  parts.forEach((part, i) => {
    if (part === '<em>') { marked = true; return; }
    if (part === '</em>') { marked = false; return; }
    if (!part) return;
    nodes.push(marked
      ? <mark key={i} className="mail-mark">{part}</mark>
      : <span key={i}>{part}</span>);
  });

  return nodes;
}

/**
 * Собирает документ для iframe. Письмо всегда рисуется на светлом фоне, даже
 * когда портал в тёмной теме: деловая почта свёрстана в расчёте на белый лист,
 * и половина писем на тёмном фоне превращается в чёрный текст на чёрном.
 */
function buildFrameDoc(html, showImages) {
  const body = showImages
    ? String(html || '').replace(/data-mail-src=/g, 'src=')
    : String(html || '');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
  html, body { margin: 0; padding: 16px; background: #ffffff; color: #14181f;
    font: 14px/1.55 -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    word-wrap: break-word; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  img:not([src]) { display: inline-block; min-width: 24px; min-height: 24px;
    background: #f1f3f6; border: 1px dashed #d2d6dc; border-radius: 4px; }
  table { max-width: 100%; }
  blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #e2e5ea; color: #6b7280; }
  a { color: #0068d9; }
  pre { white-space: pre-wrap; }
</style></head><body>${body}</body></html>`;
}

/** Человеческое описание того, что поиск понял из строки запроса. */
function describeParsed(parsed) {
  if (!parsed) return [];
  const chips = [];
  const add = (label, values) => (values || []).forEach((v) => chips.push(`${label}: ${v}`));

  add('от', parsed.from);
  add('кому', parsed.to);
  add('копия', parsed.cc);
  add('тема', parsed.subject);
  add('файл', parsed.file);
  add('папка', parsed.folder);
  if ((parsed.has || []).includes('attachment')) chips.push('с вложением');
  if ((parsed.is || []).includes('unread')) chips.push('непрочитанные');
  if ((parsed.is || []).includes('read')) chips.push('прочитанные');
  if ((parsed.is || []).includes('flagged')) chips.push('с флажком');
  if ((parsed.is || []).includes('answered')) chips.push('с ответом');
  if (parsed.after) chips.push(`после ${shortDate(parsed.after)}`);
  if (parsed.before) chips.push(`до ${shortDate(parsed.before)}`);
  (parsed.phrases || []).forEach((p) => chips.push(`фраза «${p}»`));

  return chips;
}

const SYNTAX_HINT = [
  ['от:иванов', 'письма от человека — по фамилии или адресу'],
  ['тема:договор', 'слово только в теме письма'],
  ['есть:вложение', 'только с приложенными файлами'],
  ['статус:непрочитанное', 'то, что ещё не читали'],
  ['после:месяц', 'за последний месяц; годится и «после:01.03.2024»'],
  ['файл:претензия', 'по имени вложения и по тексту внутри него'],
  ['"акт сверки"', 'слова подряд, а не по отдельности'],
];

// Горячие клавиши. Их немного намеренно: набор, который надо заучивать,
// не использует никто, а эти пять повторяют привычки любого почтового клиента.
const HOTKEYS = [
  ['J / K', 'следующее и предыдущее письмо'],
  ['R', 'ответить'],
  ['U', 'вернуть в непрочитанные'],
  ['/', 'перейти к поиску'],
  ['Esc', 'сбросить поиск'],
];

export default function Mail() {
  const { user } = useAuth();
  const canAdmin = Boolean(user?.isAdmin || user?.adminAccess?.mail);

  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountId, setAccountId] = useState(null);      // null — все доступные
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const [filters, setFilters] = useState({ unread: false, attachments: false });

  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [searchInfo, setSearchInfo] = useState(null);
  const [showHint, setShowHint] = useState(false);

  const [saved, setSaved] = useState([]);

  const [openId, setOpenId] = useState(null);
  const [opened, setOpened] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [thread, setThread] = useState([]);
  const [threadOpen, setThreadOpen] = useState(false);

  const [composeDraft, setComposeDraft] = useState(null);
  const [drafts, setDrafts] = useState([]);

  const [mobilePane, setMobilePane] = useState('list');
  const listRef = useRef(null);

  const LIMIT = 50;
  const searching = activeQuery.trim().length > 0;

  // Производные величины объявлены здесь, до обработчиков: ниже они попадают в
  // списки зависимостей useCallback, а те вычисляются на каждом рендере —
  // объявление после первого же использования уронило бы страницу.
  const activeAccount = accounts.find((a) => a.id === accountId) || null;
  const totalUnread = accounts.reduce((sum, a) => sum + (a.unread || 0), 0);

  // ── Загрузка ────────────────────────────────────────────────────────────

  const loadAccounts = useCallback(async () => {
    try {
      const { data } = await mailApi.accounts();
      setAccounts(data.accounts || []);
    } catch (e) {
      toast.error('Не удалось получить список ящиков');
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const { data } = await mailApi.savedSearches();
      setSaved(data.items || []);
    } catch (e) { /* без сохранённых поисков модуль вполне живёт */ }
  }, []);

  const loadDrafts = useCallback(async () => {
    try {
      const { data } = await mailApi.drafts();
      setDrafts(data.drafts || []);
    } catch (e) { /* без списка черновиков модуль работает */ }
  }, []);

  useEffect(() => { loadAccounts(); loadSaved(); loadDrafts(); }, [loadAccounts, loadSaved, loadDrafts]);

  useEffect(() => {
    if (!accountId) { setFolders([]); setFolderId(null); return; }
    let cancelled = false;
    mailApi.folders(accountId)
      .then(({ data }) => { if (!cancelled) setFolders(data.folders || []); })
      .catch(() => { if (!cancelled) setFolders([]); });
    return () => { cancelled = true; };
  }, [accountId]);

  // Задержка перед запросом: искать на каждое нажатие клавиши — значит слать
  // десяток запросов на одно слово и показывать выдачу, которая скачет.
  useEffect(() => {
    const timer = setTimeout(() => setActiveQuery(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (nextOffset = 0, append = false) => {
    setLoadingList(true);
    try {
      const params = { limit: LIMIT, offset: nextOffset };
      if (accountId) params.accountId = accountId;
      if (folderId) params.folderId = folderId;

      let data;
      if (activeQuery.trim()) {
        params.q = activeQuery.trim();
        ({ data } = await mailApi.search(params));
        setSearchInfo({ parsed: data.parsed, ms: data.ms, empty: data.empty });
      } else {
        if (filters.unread) params.unread = 'true';
        if (filters.attachments) params.attachments = 'true';
        ({ data } = await mailApi.messages(params));
        setSearchInfo(null);
      }

      setMessages((prev) => (append ? [...prev, ...(data.messages || [])] : (data.messages || [])));
      setHasMore(Boolean(data.hasMore));
      setOffset(nextOffset);
      if (!append && listRef.current) listRef.current.scrollTop = 0;
    } catch (e) {
      toast.error(activeQuery ? 'Поиск не отработал' : 'Не удалось загрузить письма');
    } finally {
      setLoadingList(false);
    }
  }, [accountId, folderId, filters.unread, filters.attachments, activeQuery]);

  useEffect(() => { load(0, false); }, [load]);

  // Непрочитанное обновляем сами раз в минуту. Синхронизатор ходит за почтой
  // отдельным процессом и о вкладках ничего не знает, а держать ради счётчика
  // живое соединение — несоразмерно: минута задержки в почте не замечается.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') loadAccounts();
    }, 60_000);
    return () => clearInterval(timer);
  }, [loadAccounts]);

  // ── Открытие письма ─────────────────────────────────────────────────────

  const openMessage = useCallback(async (id) => {
    setOpenId(id);
    setMobilePane('read');
    setLoadingMessage(true);
    setShowImages(false);
    try {
      const { data } = await mailApi.message(id);
      setOpened(data);

      // Переписка подтягивается отдельно и молча: она приятное дополнение, и
      // если не соберётся — письмо всё равно должно открыться.
      setThread([]);
      setThreadOpen(false);
      mailApi.thread(id)
        .then(({ data: t }) => setThread(t.messages || []))
        .catch(() => {});

      // Отмечаем прочитанным сразу при открытии, как в любом почтовом клиенте.
      // Флаг общий на ящик, и это правильно: пока часть людей в Roundcube, их
      // и наш список непрочитанного должны сходиться.
      if (!data.message.isSeen) {
        mailApi.setFlag(id, 'seen').catch(() => {});
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, isSeen: true } : m)));
        setAccounts((prev) => prev.map((a) => (
          a.id === data.message.accountId ? { ...a, unread: Math.max(0, a.unread - 1) } : a
        )));
        // Значок на кнопке в панели быстрого доступа живёт в другом дереве и о
        // нашем состоянии не знает — сообщаем ему событием.
        window.dispatchEvent(new Event('mail-changed'));
      }
    } catch (e) {
      toast.error('Не удалось открыть письмо');
      setOpened(null);
    } finally {
      setLoadingMessage(false);
    }
  }, []);

  const toggleFlag = useCallback(async (message, op) => {
    try {
      await mailApi.setFlag(message.id, op);
      const patch = {
        seen: { isSeen: true }, unseen: { isSeen: false },
        flag: { isFlagged: true }, unflag: { isFlagged: false },
      }[op];
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, ...patch } : m)));
      setOpened((prev) => (prev && prev.message.id === message.id
        ? { ...prev, message: { ...prev.message, ...patch } } : prev));
    } catch (e) {
      toast.error('Отметка не поставилась');
    }
  }, []);

  const toggleTaken = useCallback(async (message, taken) => {
    try {
      await mailApi.setTaken(message.id, taken);
      setMessages((prev) => prev.map((m) => (
        m.id === message.id ? { ...m, takenByMe: taken ? new Date().toISOString() : null } : m
      )));
      toast.success(taken ? 'Письмо взято в работу' : 'Отметка снята');
    } catch (e) {
      toast.error('Не получилось отметить');
    }
  }, []);

  const removeMessage = useCallback(async (message) => {
    const account = accounts.find((a) => a.id === message.accountId);
    const ok = window.confirm(
      `Удалить письмо «${message.subject || 'без темы'}»?\n\n` +
      `Оно уедет в «Корзину» на сервере ${account?.email || ''} и пропадёт у всех, ` +
      'в том числе у тех, кто работает через Roundcube. Кто удалил — останется в журнале.'
    );
    if (!ok) return;

    try {
      await mailApi.removeMessage(message.id);
      setMessages((prev) => prev.filter((m) => m.id !== message.id));
      setOpenId(null);
      setOpened(null);
      setMobilePane('list');
      window.dispatchEvent(new Event('mail-changed'));
      toast.success('Письмо удалено');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось удалить письмо');
    }
  }, [accounts]);

  // ── Написание письма ────────────────────────────────────────────────────

  /**
   * Заводит черновик на сервере и открывает окно. Ответ и пересылку заполняет
   * сервер: получатели, тема с приставкой и цитата должны выглядеть одинаково
   * у всех, а не так, как сумел собрать конкретный браузер.
   */
  const startCompose = useCallback(async ({ kind = 'new', replyToId = null, replyAll = false } = {}) => {
    const targetAccount = replyToId
      ? accounts.find((a) => a.id === opened?.message.accountId)
      : (activeAccount || accounts.find((a) => a.canSend));

    if (!targetAccount) {
      toast.error('Нет ящика, с которого можно писать');
      return;
    }
    if (!targetAccount.canSend) {
      toast.error(`Отправка с ящика ${targetAccount.email} вам не разрешена`);
      return;
    }

    try {
      const { data } = await mailApi.createDraft({
        accountId: targetAccount.id, kind, replyToId, replyAll,
      });
      setComposeDraft({ ...data.draft, accountEmail: targetAccount.email });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось создать письмо');
    }
  }, [accounts, activeAccount, opened]);

  const openDraft = useCallback((item) => {
    const account = accounts.find((a) => a.id === item.accountId);
    setComposeDraft({ ...item, accountEmail: account?.email || item.account?.email });
  }, [accounts]);

  const closeCompose = useCallback(() => {
    setComposeDraft(null);
    loadDrafts();
  }, [loadDrafts]);

  // ── Сохранённые поиски ──────────────────────────────────────────────────

  const saveCurrentSearch = useCallback(async () => {
    const name = window.prompt('Как назвать этот поиск?', activeQuery.slice(0, 40));
    if (!name || !name.trim()) return;

    // Общий на ящик — только когда ящик выбран: «гарантийные письма» без
    // указания, где их искать, это не папка, а недоразумение.
    const shared = Boolean(accountId) && window.confirm(
      'Сделать этот поиск общим для всех, у кого есть доступ к ящику?\n\n' +
      'Отмена — поиск останется только у вас.'
    );

    try {
      await mailApi.saveSearch({ name: name.trim(), query: activeQuery, accountId, shared });
      toast.success('Поиск сохранён');
      loadSaved();
    } catch (e) {
      toast.error('Не удалось сохранить');
    }
  }, [activeQuery, accountId, loadSaved]);

  const removeSaved = useCallback(async (item, event) => {
    event.stopPropagation();
    if (!window.confirm(`Убрать «${item.name}»?`)) return;
    try {
      await mailApi.removeSearch(item.id);
      loadSaved();
    } catch (e) {
      toast.error('Не удалось убрать');
    }
  }, [loadSaved]);

  const applySaved = useCallback((item) => {
    if (item.accountId) setAccountId(item.accountId);
    setQuery(item.query);
    setActiveQuery(item.query);
    setMobilePane('list');
  }, []);

  const clearSearch = useCallback(() => { setQuery(''); setActiveQuery(''); }, []);

  const parsedChips = useMemo(() => describeParsed(searchInfo?.parsed), [searchInfo]);

  const blockedImages = useMemo(() => {
    const html = opened?.body?.html || '';
    return (html.match(/data-mail-src=/g) || []).length;
  }, [opened]);

  // ── Горячие клавиши ─────────────────────────────────────────────────────

  const searchRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      // Пока человек печатает — никаких сочетаний. Иначе буква «r» в теле
      // письма открывала бы окно ответа.
      const target = event.target;
      const typing = target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      );
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (typing) {
        if (event.key === 'Escape') target.blur();
        return;
      }

      // Окно написания открыто — список ему не мешаем.
      if (composeDraft) return;

      const index = messages.findIndex((m) => m.id === openId);

      switch (event.key) {
        case '/':
          event.preventDefault();
          searchRef.current?.focus();
          break;
        case 'j':
        case 'ArrowDown': {
          const next = messages[index + 1] || messages[0];
          if (next) { event.preventDefault(); openMessage(next.id); }
          break;
        }
        case 'k':
        case 'ArrowUp': {
          const prev = index > 0 ? messages[index - 1] : messages[messages.length - 1];
          if (prev) { event.preventDefault(); openMessage(prev.id); }
          break;
        }
        case 'r':
          if (opened && accounts.find((a) => a.id === opened.message.accountId)?.canSend) {
            event.preventDefault();
            startCompose({ kind: 'reply', replyToId: opened.message.id });
          }
          break;
        case 'u':
          if (opened) { event.preventDefault(); toggleFlag(opened.message, 'unseen'); }
          break;
        case 'Escape':
          if (activeQuery) clearSearch();
          else setMobilePane('list');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [messages, openId, opened, accounts, composeDraft, activeQuery, openMessage, startCompose, toggleFlag, clearSearch]);

  // ── Пустые состояния ────────────────────────────────────────────────────

  if (loadingAccounts) {
    return (
      <div className="mail-page mail-page--empty">
        <Loader className="mail-spin" size={28} />
        <p>Загружаем ящики…</p>
      </div>
    );
  }

  if (!accounts.length) {
    return (
      <div className="mail-page mail-page--empty">
        <MailIcon size={40} />
        <h2>Доступа к ящикам нет</h2>
        <p>
          Почтовые ящики заводит администратор и он же выдаёт к ним доступ.
          {canAdmin
            ? ' У вас есть право настраивать почту — заведите ящик и выдайте себе доступ.'
            : ' Попросите администратора добавить вас к нужному ящику.'}
        </p>
        {canAdmin && (
          <a className="mail-btn mail-btn--primary" href="/admin/mail">
            <Settings size={16} /> Настройка ящиков
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={`mail-page mail-pane-${mobilePane}`}>

      {/* ── Ящики, папки, сохранённые поиски ── */}
      <aside className="mail-sidebar">
        <div className="mail-sidebar__head">
          <h2>Почта</h2>
          {canAdmin && (
            <a className="mail-icon-btn" href="/admin/mail" title="Настройка ящиков" data-icon-motion="settings">
              <Settings size={16} />
            </a>
          )}
        </div>

        {accounts.some((a) => a.canSend) && (
          <button type="button" className="mail-compose-btn" onClick={() => startCompose({ kind: 'new' })}>
            <PenSquare size={16} /> Написать
          </button>
        )}

        <button
          type="button"
          className={`mail-account ${!accountId ? 'active' : ''}`}
          onClick={() => { setAccountId(null); setFolderId(null); setMobilePane('list'); }}
        >
          <MailIcon size={16} />
          <span className="mail-account__name">Все ящики</span>
          {totalUnread > 0 && <span className="mail-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
        </button>

        <div className="mail-accounts">
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              className={`mail-account ${accountId === account.id ? 'active' : ''}`}
              onClick={() => { setAccountId(account.id); setFolderId(null); setMobilePane('list'); }}
              title={account.email}
            >
              <span className="mail-account__dot" aria-hidden="true" />
              <span className="mail-account__name">
                {account.displayName}
                <small>{account.email}</small>
              </span>
              {account.unread > 0 && <span className="mail-badge">{account.unread > 99 ? '99+' : account.unread}</span>}
            </button>
          ))}
        </div>

        {activeAccount && folders.length > 0 && (
          <div className="mail-folders">
            <div className="mail-folders__title">Папки</div>
            {folders.map((folder) => {
              const Icon = folderIcon(folder);
              return (
                <button
                  key={folder.id}
                  type="button"
                  className={`mail-folder ${folderId === folder.id ? 'active' : ''}`}
                  onClick={() => { setFolderId(folder.id === folderId ? null : folder.id); setMobilePane('list'); }}
                >
                  <Icon size={15} />
                  <span className="mail-folder__name">{folder.name}</span>
                  {folder.unread > 0 && <span className="mail-badge mail-badge--soft">{folder.unread}</span>}
                </button>
              );
            })}
            {activeAccount.syncState !== 'ready' && (
              <div className="mail-sync-note">
                {activeAccount.syncState === 'headers' && 'Идёт первичная загрузка: письма появляются по мере готовности.'}
                {activeAccount.syncState === 'bodies' && 'Заголовки загружены, тела писем докачиваются.'}
                {activeAccount.syncState === 'error' && 'Ящик не синхронизируется — сообщите администратору.'}
                {activeAccount.syncState === 'idle' && 'Синхронизация ещё не запускалась.'}
              </div>
            )}
          </div>
        )}

        {drafts.length > 0 && (
          <div className="mail-folders">
            <div className="mail-folders__title">Черновики</div>
            {drafts.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`mail-folder ${item.status === 'error' ? 'mail-folder--error' : ''}`}
                onClick={() => openDraft(item)}
                title={item.status === 'error' ? item.error || 'Письмо не отправилось' : item.subject}
              >
                <FileEdit size={15} />
                <span className="mail-folder__name">{item.subject || '(без темы)'}</span>
                {item.status === 'error' && <span className="mail-tag mail-tag--error">сбой</span>}
              </button>
            ))}
          </div>
        )}

        {/* Сохранённые поиски. Почти все просьбы «заведите папку» на деле
            означают фильтр: письма никто не собирается перекладывать, их нужно
            видеть вместе. */}
        {saved.length > 0 && (
          <div className="mail-folders">
            <div className="mail-folders__title">Сохранённые поиски</div>
            {saved.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`mail-folder ${activeQuery === item.query ? 'active' : ''}`}
                onClick={() => applySaved(item)}
                title={item.query}
              >
                <Bookmark size={15} />
                <span className="mail-folder__name">{item.name}</span>
                {!item.userId && <span className="mail-tag mail-tag--soft">общий</span>}
                <span
                  className="mail-folder__remove"
                  role="button"
                  tabIndex={-1}
                  title="Убрать"
                  onClick={(e) => removeSaved(item, e)}
                >
                  <X size={13} />
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* ── Список писем ── */}
      <section className="mail-list">
        <div className="mail-list__head">
          <div className="mail-search">
            <Search size={15} />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setActiveQuery(query); if (e.key === 'Escape') clearSearch(); }}
              placeholder={accountId ? 'Поиск в этом ящике' : 'Поиск по всем ящикам'}
            />
            {query && (
              <button type="button" className="mail-search__clear" onClick={clearSearch} title="Очистить">
                <X size={14} />
              </button>
            )}
            <button
              type="button"
              className={`mail-search__hint ${showHint ? 'active' : ''}`}
              onClick={() => setShowHint((v) => !v)}
              title="Как уточнить поиск"
            >
              <HelpCircle size={14} />
            </button>
          </div>
          <button
            type="button"
            className="mail-icon-btn"
            onClick={() => { loadAccounts(); load(0, false); }}
            title="Обновить"
            data-icon-motion="refresh"
          >
            <RefreshCw size={16} className={loadingList ? 'mail-spin' : ''} />
          </button>
        </div>

        {showHint && (
          <div className="mail-hint">
            <p>
              Обычные слова ищутся везде сразу — в теме, тексте, именах отправителей
              и внутри вложений. Уточнить можно так:
            </p>
            <dl>
              {SYNTAX_HINT.map(([example, what]) => (
                <div key={example}>
                  <dt onClick={() => setQuery((q) => `${q} ${example}`.trim())}>{example}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>

            <p className="mail-hint__keys">Клавиши</p>
            <dl>
              {HOTKEYS.map(([key, what]) => (
                <div key={key}>
                  <dt className="mail-hint__key">{key}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {searching ? (
          <div className="mail-search-state">
            <div className="mail-search-state__row">
              <span>
                {loadingList
                  ? 'Ищем…'
                  : `Найдено ${messages.length}${hasMore ? ' и ещё' : ''}`}
                {!loadingList && searchInfo?.ms !== undefined && (
                  <small> за {searchInfo.ms} мс</small>
                )}
              </span>
              <button type="button" className="mail-chip" onClick={saveCurrentSearch}>
                <BookmarkPlus size={13} /> Сохранить поиск
              </button>
            </div>
            {parsedChips.length > 0 && (
              // Показываем, что именно поиск понял. Без этого человек, ошибившийся
              // в приставке, решит, что поиск врёт, — а он просто искал слово
              // «темма:договор» целиком.
              <div className="mail-parsed">
                {parsedChips.map((chip) => <span key={chip} className="mail-tag mail-tag--soft">{chip}</span>)}
              </div>
            )}
          </div>
        ) : (
          <div className="mail-filters">
            <button
              type="button"
              className={`mail-chip ${filters.unread ? 'active' : ''}`}
              onClick={() => setFilters((f) => ({ ...f, unread: !f.unread }))}
            >
              <CircleDot size={13} /> Непрочитанные
            </button>
            <button
              type="button"
              className={`mail-chip ${filters.attachments ? 'active' : ''}`}
              onClick={() => setFilters((f) => ({ ...f, attachments: !f.attachments }))}
            >
              <Paperclip size={13} /> С вложениями
            </button>
          </div>
        )}

        <div className="mail-list__scroll" ref={listRef}>
          {!loadingList && !messages.length && (
            <div className="mail-empty-list">
              {searching ? 'Ничего не нашлось' : 'Писем нет'}
            </div>
          )}

          {messages.map((message) => (
            <button
              key={message.id}
              type="button"
              className={`mail-row ${message.isSeen ? '' : 'unread'} ${openId === message.id ? 'open' : ''}`}
              onClick={() => openMessage(message.id)}
            >
              <div className="mail-row__top">
                <span className="mail-row__from">{message.fromName || message.fromEmail || 'Без отправителя'}</span>
                <span className="mail-row__date">{listDate(message.receivedAt)}</span>
              </div>
              <div className="mail-row__subject">
                {message.isFlagged && <Star size={13} className="mail-row__star" />}
                {message.subject || '(без темы)'}
              </div>
              <div className="mail-row__preview">
                {/* В выдаче поиска показываем не начало письма, а место
                    совпадения: список из двухсот одинаковых начал бесполезен. */}
                {message.highlight ? renderHighlight(message.highlight) : (message.preview || '')}
              </div>
              <div className="mail-row__meta">
                {!accountId && <span className="mail-tag">{message.accountEmail}</span>}
                {(!folderId || !accountId) && message.folderName && (
                  <span className="mail-tag mail-tag--soft">{message.folderName}</span>
                )}
                {message.hasAttachments && (
                  <span className="mail-tag mail-tag--soft"><Paperclip size={11} /> {message.attachmentsCount || 1}</span>
                )}
                {message.takenByMe && (
                  <span className="mail-tag mail-tag--taken"><UserCheck size={11} /> в работе</span>
                )}
              </div>
            </button>
          ))}

          {hasMore && (
            <button
              type="button"
              className="mail-more"
              disabled={loadingList}
              onClick={() => load(offset + LIMIT, true)}
            >
              {loadingList ? 'Загружаем…' : 'Показать ещё'}
            </button>
          )}
        </div>
      </section>

      {/* ── Чтение ── */}
      <section className="mail-reader">
        {!openId && (
          <div className="mail-reader__empty">
            <MailIcon size={36} />
            <p>Выберите письмо</p>
          </div>
        )}

        {openId && loadingMessage && (
          <div className="mail-reader__empty"><Loader className="mail-spin" size={26} /></div>
        )}

        {openId && !loadingMessage && opened && (
          <>
            <header className="mail-reader__head">
              <button
                type="button"
                className="mail-icon-btn mail-back"
                onClick={() => setMobilePane('list')}
                title="К списку"
              >
                <ArrowLeft size={18} />
              </button>

              <h1>{opened.message.subject || '(без темы)'}</h1>

              <div className="mail-reader__people">
                <span className="mail-reader__from">
                  {opened.message.fromName
                    ? <>{opened.message.fromName} <small>{opened.message.fromEmail}</small></>
                    : opened.message.fromEmail}
                </span>
                <span className="mail-reader__date">{fullDate(opened.message.receivedAt)}</span>
              </div>

              {opened.addresses?.filter((a) => a.role === 'to' || a.role === 'cc').length > 0 && (
                <div className="mail-reader__recipients">
                  {['to', 'cc'].map((role) => {
                    const list = opened.addresses.filter((a) => a.role === role);
                    if (!list.length) return null;
                    return (
                      <div key={role}>
                        <span className="mail-reader__role">{role === 'to' ? 'Кому:' : 'Копия:'}</span>
                        {list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ')}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mail-actions">
                {accounts.find((a) => a.id === opened.message.accountId)?.canSend && (
                  <>
                    <button
                      type="button"
                      className="mail-btn mail-btn--primary"
                      onClick={() => startCompose({ kind: 'reply', replyToId: opened.message.id })}
                    >
                      <Reply size={15} /> Ответить
                    </button>
                    <button
                      type="button"
                      className="mail-btn"
                      onClick={() => startCompose({ kind: 'reply', replyToId: opened.message.id, replyAll: true })}
                      title="Ответить отправителю и всем, кто был в копии"
                    >
                      <ReplyAll size={15} /> Всем
                    </button>
                    <button
                      type="button"
                      className="mail-btn"
                      onClick={() => startCompose({ kind: 'forward', replyToId: opened.message.id })}
                    >
                      <Forward size={15} /> Переслать
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className="mail-btn"
                  onClick={() => toggleFlag(opened.message, opened.message.isSeen ? 'unseen' : 'seen')}
                >
                  <CircleDot size={15} /> {opened.message.isSeen ? 'Непрочитанным' : 'Прочитано'}
                </button>
                <button
                  type="button"
                  className={`mail-btn ${opened.message.isFlagged ? 'active' : ''}`}
                  onClick={() => toggleFlag(opened.message, opened.message.isFlagged ? 'unflag' : 'flag')}
                >
                  <Star size={15} /> {opened.message.isFlagged ? 'Снять флажок' : 'Флажок'}
                </button>
                <button
                  type="button"
                  className="mail-btn"
                  onClick={() => {
                    const row = messages.find((m) => m.id === opened.message.id);
                    toggleTaken(opened.message, !row?.takenByMe);
                  }}
                >
                  <UserCheck size={15} />
                  {messages.find((m) => m.id === opened.message.id)?.takenByMe ? 'Не в работе' : 'Взять в работу'}
                </button>

                {/* Удаление стоит последним и отделено: оно настоящее, письмо
                    пропадает и на сервере. Соседство с «прочитано» было бы
                    приглашением промахнуться. */}
                {accounts.find((a) => a.id === opened.message.accountId)?.canDelete && (
                  <button
                    type="button"
                    className="mail-btn mail-btn--danger"
                    onClick={() => removeMessage(opened.message)}
                  >
                    <Trash size={15} /> Удалить
                  </button>
                )}
              </div>
            </header>

            {/* Переписка. Сворачиваема и по умолчанию свёрнута: в большинстве
                писем ветка состоит из одного письма, и разворачивать её в
                каждом — значит отодвигать текст вниз без пользы. */}
            {thread.length > 1 && (
              <div className="mail-thread">
                <button type="button" className="mail-thread__toggle" onClick={() => setThreadOpen((v) => !v)}>
                  {threadOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <MessagesSquare size={14} />
                  Переписка: {thread.length} {thread.length < 5 ? 'письма' : 'писем'}
                </button>

                {threadOpen && (
                  <div className="mail-thread__list">
                    {thread.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`mail-thread__item ${item.id === opened.message.id ? 'current' : ''}`}
                        onClick={() => item.id !== opened.message.id && openMessage(item.id)}
                      >
                        <span className="mail-thread__who">{item.fromName || item.fromEmail}</span>
                        <span className="mail-thread__when">{listDate(item.receivedAt)}</span>
                        {item.hasAttachments && <Paperclip size={11} />}
                        {item.specialUse === '\\Sent' && <span className="mail-tag mail-tag--soft">мы</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {opened.attachments?.length > 0 && (
              <div className="mail-attachments">
                {opened.attachments.map((a) => (
                  <a
                    key={a.id}
                    className="mail-attachment"
                    href={mailApi.attachmentUrl(opened.message.id, a.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download size={15} />
                    <span className="mail-attachment__name">{a.filename}</span>
                    <span className="mail-attachment__size">{fileSize(a.size)}</span>
                  </a>
                ))}
              </div>
            )}

            {blockedImages > 0 && !showImages && (
              <div className="mail-images-bar">
                <ImageIcon size={15} />
                <span>
                  Внешние картинки не загружены ({blockedImages}). Загрузка сообщит отправителю,
                  что письмо открыли.
                </span>
                <button type="button" className="mail-btn mail-btn--small" onClick={() => setShowImages(true)}>
                  Показать
                </button>
              </div>
            )}

            <div className="mail-body">
              {opened.message.bodyState === 'pending' && (
                <div className="mail-body__pending">
                  Тело письма ещё не загружено с сервера. Заголовки приходят первыми,
                  содержимое докачивается фоном — загляните чуть позже.
                </div>
              )}

              {opened.body?.html && (
                // sandbox без allow-same-origin: письмо не получает доступа ни к
                // нашим кукам, ни к нашему origin. allow-popups нужен, чтобы
                // ссылки в письме открывались в новой вкладке.
                <iframe
                  className="mail-frame"
                  title="Текст письма"
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={buildFrameDoc(opened.body.html, showImages)}
                />
              )}

              {!opened.body?.html && opened.body?.text && (
                <pre className="mail-plain">{opened.body.text}</pre>
              )}

              {opened.message.bodyState === 'error' && (
                <div className="mail-body__pending">
                  Это письмо не удалось разобрать — скорее всего повреждена кодировка
                  или вложение. Оригинал на сервере не пострадал.
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {composeDraft && (
        <Compose
          key={composeDraft.id}
          draft={composeDraft}
          accountEmail={composeDraft.accountEmail}
          onClose={closeCompose}
          onSent={() => {
            // После отправки обновляем список: письмо приедет в «Отправленные»
            // обычной синхронизацией, а вот стрелка «отвечено» на исходном
            // проставляется сразу и должна стать видна.
            load(0, false);
            loadAccounts();
          }}
        />
      )}
    </div>
  );
}
