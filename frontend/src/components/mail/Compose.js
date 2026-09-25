import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Send, Paperclip, Trash2, Bold, Italic, List, Link2, Minimize2, Maximize2, Loader
} from 'lucide-react';
import { mail as mailApi } from '../../services/api';
import toast from 'react-hot-toast';
import { useStoredSize, startDrag } from './resize';
import './Compose.css';

/**
 * Окно написания письма (ver. 8.58).
 *
 * Черновик заводится на сервере сразу при открытии окна и сохраняется по ходу
 * набора. Так текст переживает и случайно закрытую вкладку, и перезагрузку —
 * а терять набранный ответ на жалобу нельзя, его пишут по двадцать минут.
 *
 * Ответ и пересылку заполняет сервер: получатели, тема с приставкой и цитата
 * приходят уже готовыми. Собирать цитату в браузере значило бы получить у
 * каждого свой вид ответа.
 *
 * Редактор — contentEditable с коротким набором кнопок. Полноценный редактор
 * здесь был бы лишним: деловое письмо это абзацы, список и ссылка, а всё, что
 * сложнее, получатель всё равно увидит по-своему — почтовые клиенты режут
 * разметку каждый на свой лад.
 */

const AUTOSAVE_MS = 1500;

// Окно прижато к правому нижнему углу, поэтому тянется оно за левый и верхний
// край: правый и нижний упираются в экран. Меньше этих размеров в окне уже не
// помещаются поля и хоть несколько строк текста.
const COMPOSE_MIN_W = 480;
const COMPOSE_MIN_H = 360;

/** Разбирает строку адресов: через запятую, точку с запятой или перевод строки. */
function parseAddresses(value) {
  return String(value || '')
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(.*?)\s*<([^>]+)>$/.exec(part);
      return m ? { name: m[1].replace(/^"|"$/g, '').trim() || undefined, address: m[2].trim() } : { address: part };
    });
}

function formatAddresses(list) {
  return (list || [])
    .map((r) => (r.name ? `${r.name} <${r.address}>` : (r.address || r)))
    .join(', ');
}

function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`;
  if (n >= 1024) return `${Math.round(n / 1024)} КБ`;
  return `${n} Б`;
}

export default function Compose({ draft: initialDraft, accountEmail, onClose, onSent }) {
  const [draft, setDraft] = useState(initialDraft);
  const [to, setTo] = useState(formatAddresses(initialDraft.toList));
  const [cc, setCc] = useState(formatAddresses(initialDraft.ccList));
  const [bcc, setBcc] = useState(formatAddresses(initialDraft.bccList));
  const [showCopies, setShowCopies] = useState(
    Boolean((initialDraft.ccList || []).length || (initialDraft.bccList || []).length)
  );
  const [subject, setSubject] = useState(initialDraft.subject || '');
  const [attachments, setAttachments] = useState(initialDraft.attachments || []);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [quota, setQuota] = useState(null);

  // Размер окна, подобранный человеком (ver. 8.78). null — размер из CSS.
  const [size, setSize, saveSize] = useStoredSize('mail.composeSize');
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const boxRef = useRef(null);

  const bodyRef = useRef(null);
  const fileRef = useRef(null);
  const saveTimer = useRef(null);
  // Черновик уже отправлен или удалён — дальнейшее автосохранение ни к чему и
  // только вернёт к жизни то, чего уже нет.
  const closedRef = useRef(false);

  // Тело ставим один раз при открытии. Перерисовывать contentEditable из
  // состояния на каждый набранный символ нельзя — курсор прыгает в начало.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = initialDraft.bodyHtml || '';
    // Курсор в начало, перед цитатой: отвечают сверху, а не под чужим текстом.
    if (bodyRef.current) bodyRef.current.focus();
  }, [initialDraft.bodyHtml]);

  useEffect(() => {
    mailApi.quota(initialDraft.accountId)
      .then(({ data }) => setQuota(data))
      .catch(() => {});
  }, [initialDraft.accountId]);

  const collect = useCallback(() => ({
    subject,
    toList: parseAddresses(to),
    ccList: parseAddresses(cc),
    bccList: parseAddresses(bcc),
    bodyHtml: bodyRef.current ? bodyRef.current.innerHTML : '',
  }), [subject, to, cc, bcc]);

  const save = useCallback(async () => {
    if (closedRef.current) return;
    setSaving(true);
    try {
      await mailApi.saveDraft(draft.id, collect());
    } catch (e) {
      // Молча: автосохранение не должно перебивать работу всплывашками, а
      // отправка всё равно сохранит текст заново.
    } finally {
      setSaving(false);
    }
  }, [draft.id, collect]);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, AUTOSAVE_MS);
  }, [save]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // ── Размер окна ─────────────────────────────────────────────────────────

  const resize = (event, edges) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cursor = edges === 'both' ? 'nwse-resize' : edges === 'x' ? 'ew-resize' : 'ns-resize';
    startDrag(event, cursor, (dx, dy) => {
      const maxW = window.innerWidth - 40;
      const maxH = window.innerHeight - 20;
      setSize({
        w: edges === 'y' ? Math.round(rect.width) : Math.round(Math.min(maxW, Math.max(COMPOSE_MIN_W, rect.width - dx))),
        h: edges === 'x' ? Math.round(rect.height) : Math.round(Math.min(maxH, Math.max(COMPOSE_MIN_H, rect.height - dy))),
      });
    }, () => saveSize(sizeRef.current));
  };

  // Двойной щелчок по краю — обратно к размеру по умолчанию.
  const resetSize = () => {
    setSize(null);
    saveSize(null);
  };

  // ── Действия ────────────────────────────────────────────────────────────

  const exec = (command, value) => {
    bodyRef.current?.focus();
    document.execCommand(command, false, value);
    scheduleSave();
  };

  const addLink = () => {
    const url = window.prompt('Адрес ссылки:', 'https://');
    if (url && /^https?:\/\//i.test(url)) exec('createLink', url);
  };

  const attach = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const { data } = await mailApi.attachToDraft(draft.id, file);
      setAttachments((prev) => [...prev, data.attachment]);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Файл не приложился');
    }
  };

  const detach = async (attachment) => {
    try {
      await mailApi.detachFromDraft(draft.id, attachment.id);
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
    } catch (e) {
      toast.error('Не удалось убрать файл');
    }
  };

  const send = async () => {
    setSending(true);
    clearTimeout(saveTimer.current);
    try {
      // Сохраняем перед отправкой синхронно: уйти должно то, что человек видит
      // на экране, а не то, что успело долететь автосохранением.
      await mailApi.saveDraft(draft.id, collect());
      await mailApi.sendDraft(draft.id);
      closedRef.current = true;
      toast.success('Письмо отправлено');
      onSent?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Письмо не отправилось', { duration: 6000 });
    } finally {
      setSending(false);
    }
  };

  const discard = async () => {
    if (!window.confirm('Удалить черновик? Написанное пропадёт.')) return;
    clearTimeout(saveTimer.current);
    closedRef.current = true;
    try {
      await mailApi.removeDraft(draft.id);
    } catch (e) { /* черновик мог не успеть создаться — не страшно */ }
    onClose();
  };

  const closeKeepingDraft = async () => {
    clearTimeout(saveTimer.current);
    await save();
    closedRef.current = true;
    onClose();
  };

  return (
    <div
      ref={boxRef}
      className={`compose ${collapsed ? 'compose--collapsed' : ''}`}
      style={size ? { '--compose-w': `${size.w}px`, '--compose-h': `${size.h}px` } : undefined}
    >
      {!collapsed && (
        <>
          <div className="compose__grip compose__grip--x" onPointerDown={(e) => resize(e, 'x')} onDoubleClick={resetSize} />
          <div className="compose__grip compose__grip--y" onPointerDown={(e) => resize(e, 'y')} onDoubleClick={resetSize} />
          <div
            className="compose__grip compose__grip--xy"
            onPointerDown={(e) => resize(e, 'both')}
            onDoubleClick={resetSize}
            title="Потяните, чтобы изменить размер. Двойной щелчок — как было"
          />
        </>
      )}
      <header className="compose__head">
        <span className="compose__title">
          {subject || (draft.kind === 'reply' ? 'Ответ' : draft.kind === 'forward' ? 'Пересылка' : 'Новое письмо')}
        </span>
        <div className="compose__head-actions">
          {saving && <span className="compose__saving">сохраняем…</span>}
          <button type="button" onClick={() => setCollapsed((v) => !v)} title={collapsed ? 'Развернуть' : 'Свернуть'}>
            {collapsed ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
          </button>
          <button type="button" onClick={closeKeepingDraft} title="Закрыть, сохранив черновик">
            <X size={16} />
          </button>
        </div>
      </header>

      {!collapsed && (
        <>
          <div className="compose__fields">
            <div className="compose__row">
              <span className="compose__label">От</span>
              <span className="compose__from">{accountEmail}</span>
            </div>

            <div className="compose__row">
              <span className="compose__label">Кому</span>
              <input
                type="text" value={to}
                onChange={(e) => { setTo(e.target.value); scheduleSave(); }}
                placeholder="адрес@почта.ру, можно несколько через запятую"
              />
              {!showCopies && (
                <button type="button" className="compose__copies" onClick={() => setShowCopies(true)}>
                  Копия
                </button>
              )}
            </div>

            {showCopies && (
              <>
                <div className="compose__row">
                  <span className="compose__label">Копия</span>
                  <input type="text" value={cc} onChange={(e) => { setCc(e.target.value); scheduleSave(); }} />
                </div>
                <div className="compose__row">
                  <span className="compose__label">Скрытая</span>
                  <input type="text" value={bcc} onChange={(e) => { setBcc(e.target.value); scheduleSave(); }} />
                </div>
              </>
            )}

            <div className="compose__row">
              <span className="compose__label">Тема</span>
              <input
                type="text" value={subject}
                onChange={(e) => { setSubject(e.target.value); scheduleSave(); }}
                placeholder="О чём письмо"
              />
            </div>
          </div>

          <div className="compose__toolbar">
            <button type="button" onClick={() => exec('bold')} title="Жирный"><Bold size={14} /></button>
            <button type="button" onClick={() => exec('italic')} title="Курсив"><Italic size={14} /></button>
            <button type="button" onClick={() => exec('insertUnorderedList')} title="Список"><List size={14} /></button>
            <button type="button" onClick={addLink} title="Ссылка"><Link2 size={14} /></button>
          </div>

          <div
            ref={bodyRef}
            className="compose__body"
            contentEditable
            suppressContentEditableWarning
            onInput={scheduleSave}
            onBlur={save}
          />

          {attachments.length > 0 && (
            <div className="compose__attachments">
              {attachments.map((a) => (
                <span key={a.id} className="compose__attachment">
                  <Paperclip size={13} />
                  {a.filename}
                  <small>{fileSize(a.size)}</small>
                  <button type="button" onClick={() => detach(a)} title="Убрать"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}

          <footer className="compose__foot">
            <button type="button" className="compose__send" disabled={sending} onClick={send}>
              {sending ? <Loader size={15} className="compose__spin" /> : <Send size={15} />}
              {sending ? 'Отправляем…' : 'Отправить'}
            </button>

            <button type="button" className="compose__icon" onClick={() => fileRef.current?.click()} title="Приложить файл">
              <Paperclip size={16} />
            </button>
            <input ref={fileRef} type="file" hidden onChange={attach} />

            <button type="button" className="compose__icon compose__icon--danger" onClick={discard} title="Удалить черновик">
              <Trash2 size={16} />
            </button>

            {/* Предел показываем, только когда он близко: постоянный счётчик
                внизу окна превращается в шум, который перестают замечать. */}
            {quota && quota.left <= 20 && (
              <span className="compose__quota">
                Сегодня осталось {quota.left} из {quota.limit} писем
              </span>
            )}
          </footer>
        </>
      )}
    </div>
  );
}
