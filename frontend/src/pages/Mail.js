import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Inbox, Send, FileText, Trash2, AlertOctagon, Archive, Folder as FolderIcon,
  Paperclip, Flag, Search, RefreshCw, Mail as MailIcon, ArrowLeft,
  Download, Loader, Bookmark,
  BookmarkPlus, X, HelpCircle, Reply, ReplyAll, Forward, FileEdit,
  Trash, MessagesSquare, ChevronDown, ChevronRight, SlidersHorizontal, FolderPlus, Plus,
  File, FileArchive, FileAudio, FileCode, FileSpreadsheet, FileVideo, Image, Presentation
} from 'lucide-react';
import { mail as mailApi } from '../services/api';
import toast from 'react-hot-toast';
import Compose from '../components/mail/Compose';
import { fileUrl } from '../utils/fileUrl';
import './Mail.css';

/**
 * Почта: чтение и поиск по общим ящикам сети (ver. 8.58).
 *
 * Ящики заводит администратор, человек приходит на готовое — своих паролей
 * здесь никто не вводит. У одного сотрудника доступ бывает к нескольким ящикам
 * сразу. В рабочем окне выбран один ящик, его папки постоянно видны слева.
 *
 * Поиск работает внутри выбранного ящика и при необходимости уточняется
 * фильтрами. Переключение ящика очищает открытое письмо и выбранную папку.
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

function rowDate(value) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) return time;

  const datePart = date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: '2-digit' }),
  });
  return `${datePart}, ${time}`;
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

function attachmentExtension(attachment) {
  const filename = String(attachment?.filename || '');
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** Тип определяем по MIME, а расширение оставляем запасным вариантом для старой почты. */
function attachmentPresentation(attachment) {
  const mime = String(attachment?.mimeType || '').toLowerCase();
  const ext = attachmentExtension(attachment);
  const byExtension = (list) => list.includes(ext);

  if ((mime.startsWith('image/') && mime !== 'image/svg+xml') || byExtension(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'])) {
    return { kind: 'image', label: 'Изображение', Icon: Image, canPreview: true };
  }
  if (mime === 'application/pdf' || ext === 'pdf') return { kind: 'pdf', label: 'PDF', Icon: FileText };
  if (mime.includes('spreadsheet') || mime.includes('excel') || byExtension(['xls', 'xlsx', 'csv', 'ods'])) {
    return { kind: 'sheet', label: 'Таблица', Icon: FileSpreadsheet };
  }
  if (mime.includes('presentation') || byExtension(['ppt', 'pptx', 'odp'])) {
    return { kind: 'slides', label: 'Презентация', Icon: Presentation };
  }
  if (mime.includes('word') || mime.includes('document') || mime === 'text/rtf' || byExtension(['doc', 'docx', 'odt', 'rtf'])) {
    return { kind: 'document', label: 'Документ', Icon: FileText };
  }
  if (mime.startsWith('audio/') || byExtension(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'])) {
    return { kind: 'audio', label: 'Аудио', Icon: FileAudio };
  }
  if (mime.startsWith('video/') || byExtension(['mp4', 'mov', 'avi', 'mkv', 'webm'])) {
    return { kind: 'video', label: 'Видео', Icon: FileVideo };
  }
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z') || mime.includes('tar') || byExtension(['zip', 'rar', '7z', 'tar', 'gz'])) {
    return { kind: 'archive', label: 'Архив', Icon: FileArchive };
  }
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || byExtension(['txt', 'json', 'xml', 'html', 'css', 'js', 'ts', 'sql', 'log'])) {
    return { kind: 'code', label: 'Текст', Icon: FileCode };
  }
  return { kind: 'file', label: ext ? ext.toUpperCase() : 'Файл', Icon: File };
}

function MailAttachment({ attachment, messageId, downloading, onDownload }) {
  const presentation = attachmentPresentation(attachment);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    if (!presentation.canPreview || !messageId || !attachment?.id) return undefined;
    let active = true;
    let url = null;

    mailApi.attachmentPreview(messageId, attachment.id)
      .then(({ data }) => {
        url = URL.createObjectURL(data);
        if (active) setPreviewUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch(() => { /* иконка типа файла остаётся запасным вариантом */ });

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [attachment?.id, attachment?.mimeType, messageId, presentation.canPreview]);

  const { Icon } = presentation;
  return (
    <button
      type="button"
      className={`mail-attachment mail-attachment--${presentation.kind} ${previewUrl ? 'has-preview' : ''}`}
      onClick={() => onDownload(attachment)}
      disabled={downloading}
      title={`Скачать ${attachment.filename || 'вложение'}`}
    >
      <span className="mail-attachment__visual" aria-hidden="true">
        {previewUrl
          ? <img src={previewUrl} alt="" onError={() => setPreviewUrl(null)} />
          : <Icon size={22} strokeWidth={1.8} />}
      </span>
      <span className="mail-attachment__details">
        <span className="mail-attachment__name">{attachment.filename || 'Без названия'}</span>
        <span className="mail-attachment__meta">{presentation.label} · {fileSize(attachment.size)}</span>
      </span>
      <span className="mail-attachment__action" aria-hidden="true">
        {downloading ? <Loader size={16} className="mail-spin" /> : <Download size={16} />}
      </span>
    </button>
  );
}

/**
 * Собирает документ для iframe. Письмо всегда рисуется на светлом фоне, даже
 * когда портал в тёмной теме: деловая почта свёрстана в расчёте на белый лист,
 * и половина писем на тёмном фоне превращается в чёрный текст на чёрном.
 */
function normalizeContentId(value) {
  let id = String(value || '').trim().replace(/^cid:/i, '').replace(/^<|>$/g, '');
  try { id = decodeURIComponent(id); } catch (e) { /* content-id не обязан быть URL */ }
  return id.toLowerCase();
}

function buildFrameDoc(html, showImages, cidSources = {}) {
  let body = String(html || '').replace(/\bsrc=(['"])cid:([^'"]+)\1/gi, (whole, quote, cid) => {
    const src = cidSources[normalizeContentId(cid)];
    return src ? `src=${quote}${src}${quote}` : whole;
  });
  if (showImages) body = body.replace(/data-mail-src=/g, 'src=');

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

function AccountLogo({ account, className = '', showProvider = false }) {
  const [failed, setFailed] = useState(false);
  const medCenter = account?.medCenter;
  const src = !failed ? fileUrl(medCenter?.logoUrl) : null;
  const name = medCenter?.displayName || medCenter?.name || account?.displayName || account?.email || '';

  return (
    <span className={`mail-account-logo ${className}`} style={{ '--mail-brand': medCenter?.color || 'var(--primary)' }}>
      <span className="mail-account-logo__main">
        {src
          ? <img src={src} alt="" onError={() => setFailed(true)} />
          : <span>{name.trim().charAt(0).toUpperCase() || 'П'}</span>}
      </span>
      {showProvider && <MailProviderLogo domain={account?.providerLogoDomain} />}
    </span>
  );
}

const senderLogoCache = new Map();
const senderLogoQueue = [];
let activeSenderLogoRequests = 0;
const SENDER_COLORS = ['#5965d8', '#2e8b74', '#c56b38', '#9a5bc4', '#3278bd', '#b6526d', '#6f7f35'];

function senderDomain(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  const domain = at >= 0 ? value.slice(at + 1).replace(/\.$/, '') : '';
  return domain.includes('.') && /^[a-z0-9.-]+$/.test(domain) ? domain : null;
}

function senderColor(value) {
  const hash = [...String(value || '')].reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) | 0, 0);
  return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

function drainSenderLogoQueue() {
  while (activeSenderLogoRequests < 4 && senderLogoQueue.length) {
    const task = senderLogoQueue.shift();
    activeSenderLogoRequests += 1;
    mailApi.senderLogo(task.domain)
      .then(({ data }) => task.resolve(URL.createObjectURL(data)))
      .catch(() => task.resolve(null))
      .finally(() => {
        activeSenderLogoRequests -= 1;
        drainSenderLogoQueue();
      });
  }
}

function cachedSenderLogo(domain) {
  if (!domain) return Promise.resolve(null);
  if (!senderLogoCache.has(domain)) {
    senderLogoCache.set(domain, new Promise((resolve) => {
      senderLogoQueue.push({ domain, resolve });
      drainSenderLogoQueue();
    }));
  }
  return senderLogoCache.get(domain);
}

function MailProviderLogo({ domain }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!domain) return undefined;
    let active = true;
    cachedSenderLogo(domain).then((value) => { if (active) setSrc(value); });
    return () => { active = false; };
  }, [domain]);

  if (!src) return null;
  return (
    <span className="mail-account-logo__provider" aria-hidden="true">
      <img src={src} alt="" onError={() => setSrc(null)} />
    </span>
  );
}

/** Внутренний сотрудник получает фото профиля, внешний бренд — BIMI/favicon. */
function SenderAvatar({ message }) {
  const internalSrc = fileUrl(message.senderAvatar);
  const [internalFailed, setInternalFailed] = useState(false);
  const [brandSrc, setBrandSrc] = useState(null);
  const domain = senderDomain(message.fromEmail);
  const name = message.fromName || message.fromEmail || '?';

  useEffect(() => {
    if ((internalSrc && !internalFailed) || !domain) return undefined;
    let active = true;
    cachedSenderLogo(domain).then((src) => { if (active) setBrandSrc(src); });
    return () => { active = false; };
  }, [domain, internalFailed, internalSrc]);

  const src = internalSrc && !internalFailed ? internalSrc : brandSrc;
  return (
    <span
      className="mail-row__avatar"
      style={{ '--mail-sender-color': senderColor(message.fromEmail || name) }}
      aria-hidden="true"
    >
      {src
        ? <img src={src} alt="" loading="lazy" onError={() => {
          if (src === internalSrc) setInternalFailed(true);
          else setBrandSrc(null);
        }} />
        : <span>{name.trim().charAt(0).toUpperCase() || '?'}</span>}
    </span>
  );
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
  if ((parsed.is || []).includes('unflagged')) chips.push('без флажка');
  if ((parsed.is || []).includes('answered')) chips.push('с ответом');
  if ((parsed.is || []).includes('unanswered')) chips.push('без ответа');
  if (parsed.after) chips.push(`после ${shortDate(parsed.after)}`);
  if (parsed.before) chips.push(`до ${shortDate(parsed.before)}`);
  if (parsed.larger !== null && parsed.larger !== undefined) chips.push(`от ${fileSize(parsed.larger)}`);
  if (parsed.smaller !== null && parsed.smaller !== undefined) chips.push(`до ${fileSize(parsed.smaller)}`);
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
  ['больше:5мб', 'письма тяжелее указанного размера'],
  ['"акт сверки"', 'слова подряд, а не по отдельности'],
];

// Горячие клавиши. Их немного намеренно: набор, который надо заучивать,
// не использует никто, а эти пять повторяют привычки любого почтового клиента.
const HOTKEYS = [
  ['J / K', 'следующее и предыдущее письмо'],
  ['R', 'ответить'],
  ['/', 'перейти к поиску'],
  ['Esc', 'сбросить поиск'],
];

export default function Mail() {
  const [accounts, setAccounts] = useState([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountId, setAccountId] = useState(null);
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState(null);

  const [messages, setMessages] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const [showFilter, setShowFilter] = useState(false);
  const [busyFolders, setBusyFolders] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [moveFolders, setMoveFolders] = useState([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [cidSources, setCidSources] = useState({});
  const [advanced, setAdvanced] = useState({
    text: '', from: '', to: '', cc: '', subject: '', file: '', folder: '',
    after: '', before: '', larger: '', smaller: '', status: '', attachments: false,
  });

  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [searchInfo, setSearchInfo] = useState(null);
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
  const accountPickerRef = useRef(null);
  const movePickerRef = useRef(null);

  const LIMIT = 50;
  const searching = activeQuery.trim().length > 0;

  // Производные величины объявлены здесь, до обработчиков: ниже они попадают в
  // списки зависимостей useCallback, а те вычисляются на каждом рендере —
  // объявление после первого же использования уронило бы страницу.
  const activeAccount = accounts.find((a) => a.id === accountId) || null;
  const accountGroups = useMemo(() => {
    const groups = new Map();
    accounts.forEach((account) => {
      const label = account.medCenter?.name || 'Другие ящики';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(account);
    });
    return [...groups.entries()];
  }, [accounts]);
  const accountDrafts = useMemo(
    () => drafts.filter((item) => item.accountId === accountId),
    [drafts, accountId]
  );
  const accountSaved = useMemo(
    () => saved.filter((item) => !item.accountId || item.accountId === accountId),
    [saved, accountId]
  );

  // ── Загрузка ────────────────────────────────────────────────────────────

  const loadAccounts = useCallback(async () => {
    try {
      const { data } = await mailApi.accounts();
      const next = data.accounts || [];
      setAccounts(next);
      setAccountId((current) => {
        if (current && next.some((account) => account.id === current)) return current;
        return (next.find((account) => account.isDefault) || next[0])?.id || null;
      });
    } catch (e) {
      toast.error('Не удалось получить список ящиков');
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    const close = (event) => {
      if (!accountPickerRef.current?.contains(event.target)) setAccountMenuOpen(false);
      if (!movePickerRef.current?.contains(event.target)) setMoveMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
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

  const loadFolders = useCallback(async (id) => {
    const { data } = await mailApi.folders(id);
    setFolders(data.folders || []);
  }, []);

  useEffect(() => {
    if (!accountId) { setFolders([]); setFolderId(null); return; }
    let cancelled = false;
    mailApi.folders(accountId)
      .then(({ data }) => { if (!cancelled) setFolders(data.folders || []); })
      .catch(() => { if (!cancelled) setFolders([]); });
    return () => { cancelled = true; };
  }, [accountId]);

  const refreshFolders = useCallback(async () => {
    if (!accountId) return;
    setBusyFolders(true);
    try {
      await mailApi.refreshFolders(accountId);
      await loadFolders(accountId);
      toast.success('Папки получены с почтового сервера. Письма загружаются в фоне.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось обновить папки');
    } finally { setBusyFolders(false); }
  }, [accountId, loadFolders]);

  const createFolder = useCallback(async () => {
    if (!accountId) return;
    const name = window.prompt('Название новой папки');
    if (!name?.trim()) return;
    setBusyFolders(true);
    try {
      await mailApi.createFolder(accountId, { name: name.trim() });
      await loadFolders(accountId);
      toast.success('Папка создана на почтовом сервере');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось создать папку');
    } finally { setBusyFolders(false); }
  }, [accountId, loadFolders]);

  const applyAdvanced = useCallback((event) => {
    event.preventDefault();
    const quote = (value) => `"${String(value).trim().replace(/"/g, ' ')}"`;
    const parts = [advanced.text.trim()];
    [['от', 'from'], ['кому', 'to'], ['копия', 'cc'], ['тема', 'subject'], ['файл', 'file'], ['папка', 'folder']]
      .forEach(([key, field]) => { if (advanced[field].trim()) parts.push(`${key}:${quote(advanced[field])}`); });
    if (advanced.after) parts.push(`после:${advanced.after}`);
    if (advanced.before) {
      const exclusive = new Date(`${advanced.before}T00:00:00`);
      exclusive.setDate(exclusive.getDate() + 1);
      parts.push(`до:${exclusive.getFullYear()}-${String(exclusive.getMonth() + 1).padStart(2, '0')}-${String(exclusive.getDate()).padStart(2, '0')}`);
    }
    if (advanced.larger) parts.push(`больше:${advanced.larger}мб`);
    if (advanced.smaller) parts.push(`меньше:${advanced.smaller}мб`);
    if (advanced.status) parts.push(`статус:${advanced.status}`);
    if (advanced.attachments) parts.push('есть:вложение');
    const next = parts.filter(Boolean).join(' ');
    setQuery(next);
    setActiveQuery(next);
    setShowFilter(false);
  }, [advanced]);

  // Задержка перед запросом: искать на каждое нажатие клавиши — значит слать
  // десяток запросов на одно слово и показывать выдачу, которая скачет.
  useEffect(() => {
    const timer = setTimeout(() => setActiveQuery(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async (nextOffset = 0, append = false) => {
    if (!accountId) {
      setMessages([]);
      setHasMore(false);
      return;
    }
    setLoadingList(true);
    try {
      const params = { limit: LIMIT, offset: nextOffset, accountId };
      if (folderId) params.folderId = folderId;

      let data;
      if (activeQuery.trim()) {
        params.q = activeQuery.trim();
        ({ data } = await mailApi.search(params));
        setSearchInfo({ parsed: data.parsed, ms: data.ms, empty: data.empty });
      } else {
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
  }, [accountId, folderId, activeQuery]);

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
    setMoveMenuOpen(false);
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
    if (item.accountId) {
      setAccountId(item.accountId);
      setFolderId(null);
    }
    setQuery(item.query);
    setActiveQuery(item.query);
    setMobilePane('list');
  }, []);

  const selectAccount = useCallback((id) => {
    setAccountId(id);
    setFolderId(null);
    setOpenId(null);
    setOpened(null);
    setAccountMenuOpen(false);
    setMobilePane('list');
  }, []);

  const clearSearch = useCallback(() => { setQuery(''); setActiveQuery(''); }, []);

  const downloadAttachment = useCallback(async (attachment) => {
    if (!opened) return;
    setDownloading(attachment.id);
    try {
      const { data } = await mailApi.attachment(opened.message.id, attachment.id);
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename || 'вложение';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось скачать вложение');
    } finally { setDownloading(null); }
  }, [opened]);

  const moveOpened = useCallback(async (targetId) => {
    if (!opened || !targetId) return;
    setMoveMenuOpen(false);
    try {
      const { data } = await mailApi.moveMessage(opened.message.id, targetId);
      setMessages((prev) => prev.filter((m) => m.id !== opened.message.id));
      setOpenId(null);
      setOpened(null);
      setMobilePane('list');
      toast.success(data.pendingSync
        ? 'Письмо перенесено. Оно появится в папке после синхронизации.'
        : 'Письмо перенесено');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось перенести письмо');
    }
  }, [opened]);

  useEffect(() => {
    const id = opened?.message?.accountId;
    if (!id) { setMoveFolders([]); return; }
    let cancelled = false;
    mailApi.folders(id).then(({ data }) => {
      if (!cancelled) setMoveFolders(data.folders || []);
    }).catch(() => { if (!cancelled) setMoveFolders([]); });
    return () => { cancelled = true; };
  }, [opened?.message?.accountId]);

  useEffect(() => {
    let cancelled = false;
    const urls = [];
    setCidSources({});

    const loadInline = async () => {
      const inline = opened?.inlineAttachments || [];
      if (!opened || !inline.length) return;

      const entries = await Promise.all(inline.map(async (attachment) => {
        try {
          const { data } = await mailApi.attachment(opened.message.id, attachment.id);
          const typed = data.slice(0, data.size, attachment.mimeType || 'application/octet-stream');
          const url = URL.createObjectURL(typed);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return null;
          }
          urls.push(url);
          return [normalizeContentId(attachment.contentId), url];
        } catch (e) {
          return null;
        }
      }));

      if (cancelled) return;
      setCidSources(Object.fromEntries(entries.filter((entry) => entry && entry[0])));
    };

    loadInline();
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [opened]);

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
        case 'Escape':
          if (moveMenuOpen) setMoveMenuOpen(false);
          else if (accountMenuOpen) setAccountMenuOpen(false);
          else if (activeQuery) clearSearch();
          else setMobilePane('list');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [messages, openId, opened, accounts, composeDraft, activeQuery, accountMenuOpen, moveMenuOpen, openMessage, startCompose, clearSearch]);

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
          {' Попросите администратора добавить вас к нужному ящику.'}
        </p>
      </div>
    );
  }

  return (
    <div className={`mail-page mail-pane-${mobilePane}`}>
      <div className="mail-workspace">

      {/* ── Ящик, папки и сохранённые подборки ── */}
      <aside className="mail-sidebar">
        <div className="mail-sidebar__top">
          <div className="mail-account-picker" ref={accountPickerRef}>
            <button
              type="button"
              className="mail-account-picker__trigger"
              onClick={() => setAccountMenuOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={accountMenuOpen}
            >
              <AccountLogo account={activeAccount} showProvider />
              <span className="mail-account-picker__text">
                <strong>{activeAccount?.displayName || activeAccount?.email}</strong>
                <small>{activeAccount?.email}</small>
              </span>
              <ChevronDown size={15} className={accountMenuOpen ? 'is-open' : ''} />
            </button>

            {accountMenuOpen && (
              <div className="mail-account-menu" role="listbox" aria-label="Почтовые ящики">
                {accountGroups.map(([name, items]) => (
                  <div className="mail-account-menu__group" key={name}>
                    <div className="mail-account-menu__label">{name}</div>
                    {items.map((account) => (
                      <button
                        key={account.id}
                        type="button"
                        role="option"
                        aria-selected={account.id === accountId}
                        className={account.id === accountId ? 'active' : ''}
                        onClick={() => selectAccount(account.id)}
                      >
                        <AccountLogo account={account} showProvider />
                        <span><strong>{account.displayName}</strong><small><MailIcon size={12} />{account.email}</small></span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {activeAccount?.canSend && (
            <button type="button" className="mail-compose-icon" onClick={() => startCompose({ kind: 'new' })} title="Написать письмо" aria-label="Написать письмо">
              <Plus size={20} />
            </button>
          )}
        </div>

        <div className="mail-folders">
          <div className="mail-folders__title mail-folders__title--actions">
            <span>Папки {busyFolders && <Loader size={12} className="mail-spin" />}</span>
            <span>
              <button type="button" className="mail-icon-btn" onClick={refreshFolders} disabled={busyFolders} title="Обновить папки"><RefreshCw size={14} /></button>
              <button type="button" className="mail-icon-btn" onClick={createFolder} disabled={busyFolders} title="Создать папку"><FolderPlus size={14} /></button>
            </span>
          </div>
          <button type="button" className={`mail-folder ${!folderId ? 'active' : ''}`} onClick={() => setFolderId(null)}>
            <MailIcon size={15} /><span className="mail-folder__name">Все письма</span>
          </button>
          {folders.map((folder) => {
            const Icon = folderIcon(folder);
            return (
              <button key={folder.id} type="button" className={`mail-folder ${folderId === folder.id ? 'active' : ''}`} onClick={() => setFolderId(folder.id)}>
                <Icon size={15} />
                <span className="mail-folder__name">{folder.name}</span>
                {folder.unread > 0 && <span className="mail-badge mail-badge--soft">{folder.unread}</span>}
              </button>
            );
          })}
          {activeAccount?.syncState !== 'ready' && (
            <div className="mail-sync-note">
              {activeAccount?.syncState === 'headers' && 'Письма загружаются с сервера.'}
              {activeAccount?.syncState === 'bodies' && 'Содержимое писем докачивается.'}
              {activeAccount?.syncState === 'error' && 'Синхронизация остановлена с ошибкой.'}
              {activeAccount?.syncState === 'idle' && 'Синхронизация ещё не запускалась.'}
            </div>
          )}
        </div>

        {accountDrafts.length > 0 && (
          <div className="mail-folders">
            <div className="mail-folders__title">Черновики</div>
            {accountDrafts.map((item) => (
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

        {/* Сохранённые поиски доступны рядом с серверными папками. */}
        {accountSaved.length > 0 && (
          <div className="mail-folders">
            <div className="mail-folders__title">Сохранённые поиски</div>
            {accountSaved.map((item) => (
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
              placeholder="Поиск в ящике"
            />
            {query && (
              <button type="button" className="mail-search__clear" onClick={clearSearch} title="Очистить">
                <X size={14} />
              </button>
            )}
            <div className="mail-help">
              <button type="button" className="mail-search__hint" aria-label="Подсказка по поиску">
                <HelpCircle size={14} />
              </button>
              <div className="mail-hint" role="tooltip">
                <p>Обычные слова ищутся в теме, тексте, адресах и вложениях. Уточнить поиск:</p>
                <dl>
                  {SYNTAX_HINT.map(([example, what]) => (
                    <div key={example}><dt>{example}</dt><dd>{what}</dd></div>
                  ))}
                </dl>
                <p className="mail-hint__keys">Клавиши</p>
                <dl>
                  {HOTKEYS.map(([key, what]) => (
                    <div key={key}><dt className="mail-hint__key">{key}</dt><dd>{what}</dd></div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
          <button type="button" className={`mail-icon-btn ${showFilter ? 'active' : ''}`} onClick={() => setShowFilter((v) => !v)} title="Фильтр"><SlidersHorizontal size={17} /></button>
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

        {showFilter && (
          <form className="mail-advanced" onSubmit={applyAdvanced}>
            <div className="mail-advanced__grid">
              {[
                ['text', 'Слова или фраза'], ['from', 'От кого'], ['to', 'Кому'],
                ['cc', 'Копия'], ['subject', 'Тема'], ['file', 'Имя или текст вложения'], ['folder', 'Название папки'],
              ].map(([field, label]) => (
                <label key={field}>{label}<input value={advanced[field]} onChange={(e) => setAdvanced((v) => ({ ...v, [field]: e.target.value }))} /></label>
              ))}
              <label>С даты<input type="date" value={advanced.after} onChange={(e) => setAdvanced((v) => ({ ...v, after: e.target.value }))} /></label>
              <label>По дату включительно<input type="date" value={advanced.before} onChange={(e) => setAdvanced((v) => ({ ...v, before: e.target.value }))} /></label>
              <label>Размер от, МБ<input type="number" min="0" step="0.1" value={advanced.larger} onChange={(e) => setAdvanced((v) => ({ ...v, larger: e.target.value }))} /></label>
              <label>Размер до, МБ<input type="number" min="0" step="0.1" value={advanced.smaller} onChange={(e) => setAdvanced((v) => ({ ...v, smaller: e.target.value }))} /></label>
              <label>Статус<select value={advanced.status} onChange={(e) => setAdvanced((v) => ({ ...v, status: e.target.value }))}>
                <option value="">Любой</option><option value="непрочитанное">Непрочитанные</option><option value="прочитанное">Прочитанные</option>
                <option value="важное">С флажком</option><option value="безфлажка">Без флажка</option>
                <option value="отвеченное">С ответом</option><option value="неотвеченное">Без ответа</option>
              </select></label>
              <label className="mail-advanced__check"><input type="checkbox" checked={advanced.attachments} onChange={(e) => setAdvanced((v) => ({ ...v, attachments: e.target.checked }))} /> Только с вложениями</label>
            </div>
            <div className="mail-advanced__actions"><button type="button" className="mail-chip" onClick={() => { setAdvanced({ text: '', from: '', to: '', cc: '', subject: '', file: '', folder: '', after: '', before: '', larger: '', smaller: '', status: '', attachments: false }); clearSearch(); }}>Сбросить</button><button type="submit" className="mail-btn mail-btn--primary">Применить</button></div>
          </form>
        )}

        {searching && (
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
        )}

        <div className="mail-list__scroll" ref={listRef}>
          {!loadingList && !messages.length && (
            <div className="mail-empty-list">
              {searching ? 'Ничего не нашлось' : 'Писем нет'}
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`mail-row ${message.isSeen ? '' : 'unread'} ${message.isFlagged ? 'flagged' : ''} ${openId === message.id ? 'open' : ''}`}
            >
              <button
                type="button"
                className="mail-row__open"
                onClick={() => openMessage(message.id)}
              >
                <SenderAvatar key={message.id} message={message} />
                <span className="mail-row__content">
                  <span className="mail-row__top">
                    <span className="mail-row__from">
                      {message.fromName || message.fromEmail || 'Без отправителя'}
                    </span>
                    <time className="mail-row__date" dateTime={message.receivedAt || undefined}>
                      {rowDate(message.receivedAt)}
                    </time>
                  </span>
                  <span className="mail-row__subject">
                    {message.subject || '(без темы)'}
                  </span>
                </span>
              </button>
              <span className="mail-row__markers">
                {message.hasAttachments && (
                  <Paperclip size={13} className="mail-row__attachment" aria-label="Есть вложения" />
                )}
                <button
                  type="button"
                  className={`mail-row__flag ${message.isFlagged ? 'active' : ''}`}
                  onClick={() => toggleFlag(message, message.isFlagged ? 'unflag' : 'flag')}
                  aria-label={message.isFlagged ? 'Снять флаг' : 'Установить флаг'}
                  title={message.isFlagged ? 'Снять флаг' : 'Установить флаг'}
                >
                  <Flag size={13} fill={message.isFlagged ? 'currentColor' : 'none'} />
                </button>
              </span>
            </div>
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
      </div>

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

              <div className="mail-reader__recipients">
                <div className="mail-reader__recipient-row">
                  <span className="mail-reader__recipient-main">
                    <span className="mail-reader__role">От:</span>
                    <span className="mail-reader__from">
                      {opened.message.fromName
                        ? <>{opened.message.fromName} <small>{opened.message.fromEmail}</small></>
                        : opened.message.fromEmail}
                    </span>
                  </span>
                  {!opened.addresses?.some((a) => a.role === 'to') && (
                    <time className="mail-reader__date" dateTime={opened.message.receivedAt || undefined}>
                      {fullDate(opened.message.receivedAt)}
                    </time>
                  )}
                </div>
                {['to', 'cc'].map((role) => {
                  const list = (opened.addresses || []).filter((a) => a.role === role);
                  if (!list.length) return null;
                  return (
                    <div className="mail-reader__recipient-row" key={role}>
                      <span className="mail-reader__recipient-main">
                        <span className="mail-reader__role">{role === 'to' ? 'Кому:' : 'Копия:'}</span>
                        {list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ')}
                      </span>
                      {role === 'to' && (
                        <time className="mail-reader__date" dateTime={opened.message.receivedAt || undefined}>
                          {fullDate(opened.message.receivedAt)}
                        </time>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mail-actions">
                <div className="mail-actions__group">
                  {accounts.find((a) => a.id === opened.message.accountId)?.canSend && (
                    <>
                      <button
                        type="button"
                        className="mail-action-icon mail-action-icon--primary"
                        onClick={() => startCompose({ kind: 'reply', replyToId: opened.message.id })}
                        title="Ответить"
                        aria-label="Ответить"
                      >
                        <Reply size={17} />
                      </button>
                      <button
                        type="button"
                        className="mail-action-icon"
                        onClick={() => startCompose({ kind: 'reply', replyToId: opened.message.id, replyAll: true })}
                        title="Ответить всем"
                        aria-label="Ответить всем"
                      >
                        <ReplyAll size={17} />
                      </button>
                      <button
                        type="button"
                        className="mail-action-icon"
                        onClick={() => startCompose({ kind: 'forward', replyToId: opened.message.id })}
                        title="Переслать"
                        aria-label="Переслать"
                      >
                        <Forward size={17} />
                      </button>
                    </>
                  )}
                </div>

                <div className="mail-actions__group mail-actions__group--manage">
                  <button
                    type="button"
                    className={`mail-action-icon mail-action-icon--flag ${opened.message.isFlagged ? 'active' : ''}`}
                    onClick={() => toggleFlag(opened.message, opened.message.isFlagged ? 'unflag' : 'flag')}
                    title={opened.message.isFlagged ? 'Снять флаг' : 'Установить флаг'}
                    aria-label={opened.message.isFlagged ? 'Снять флаг' : 'Установить флаг'}
                  >
                    <Flag size={17} fill={opened.message.isFlagged ? 'currentColor' : 'none'} />
                  </button>

                  <div className="mail-move-picker" ref={movePickerRef}>
                    <button
                      type="button"
                      className={`mail-action-icon mail-move-picker__trigger ${moveMenuOpen ? 'active' : ''}`}
                      onClick={() => setMoveMenuOpen((open) => !open)}
                      title="Переместить в папку"
                      aria-label="Переместить в папку"
                      aria-haspopup="menu"
                      aria-expanded={moveMenuOpen}
                    >
                      <FolderIcon size={17} />
                      <ChevronDown size={11} className={moveMenuOpen ? 'is-open' : ''} />
                    </button>
                    {moveMenuOpen && (
                      <div className="mail-move-menu" role="menu">
                        <div className="mail-move-menu__label">Переместить в</div>
                        {moveFolders.filter((folder) => folder.id !== opened.message.folderId).map((folder) => {
                          const Icon = folderIcon(folder);
                          return (
                            <button key={folder.id} type="button" role="menuitem" onClick={() => moveOpened(folder.id)}>
                              <Icon size={15} />
                              <span>{folder.name || folder.path}</span>
                            </button>
                          );
                        })}
                        {moveFolders.filter((folder) => folder.id !== opened.message.folderId).length === 0 && (
                          <div className="mail-move-menu__empty">Других папок нет</div>
                        )}
                      </div>
                    )}
                  </div>

                  {accounts.find((a) => a.id === opened.message.accountId)?.canDelete && (
                    <button
                      type="button"
                      className="mail-action-icon mail-action-icon--danger"
                      onClick={() => removeMessage(opened.message)}
                      title="Удалить"
                      aria-label="Удалить"
                    >
                      <Trash size={17} />
                    </button>
                  )}
                </div>
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
                  <MailAttachment
                    key={a.id}
                    attachment={a}
                    messageId={opened.message.id}
                    downloading={downloading === a.id}
                    onDownload={downloadAttachment}
                  />
                ))}
              </div>
            )}

            {blockedImages > 0 && !showImages && (
              <div className="mail-images-bar">
                <span>Внешние картинки не загружены</span>
                <button type="button" className="mail-images-bar__show" onClick={() => setShowImages(true)}>
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
                  srcDoc={buildFrameDoc(opened.body.html, showImages, cidSources)}
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
