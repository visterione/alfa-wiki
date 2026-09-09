import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Zap, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { openLine as openLineApi } from '../../services/api';
import toast from 'react-hot-toast';

/**
 * Быстрые ответы оператора (ver. 8.09).
 *
 * Комплект один на всю сеть, а не по сотруднику. Это решение заказчика и оно
 * осмысленное: колл-центр отвечает от лица клиники, и «как проехать» должно
 * звучать одинаково у всех, кто сегодня на смене. Персональные заготовки этого
 * не дают — они дают пять разных ответов на один вопрос.
 *
 * Правит их сам оператор, без администратора. Заготовка нужна тому, кто
 * отвечает, и правится в тот момент, когда стало ясно, что формулировка не
 * работает; заявка администратору на такое — способ не завести заготовок вовсе.
 * Обратная сторона названа вслух в самом окне: правка видна всем.
 *
 * ЗАГОТОВКА ВСТАВЛЯЕТСЯ В ПОЛЕ, А НЕ УХОДИТ ПАЦИЕНТУ. Почти всегда её надо
 * дописать — поздороваться, назвать время, добавить «до встречи». Отправка по
 * щелчку экономила бы одно нажатие и стоила бы неверно отправленного ответа,
 * который уже не отозвать.
 */
export default function QuickReplyPicker({ onPick, disabled }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [editing, setEditing] = useState(null);   // id правимой заготовки | 'new'
  const [draft, setDraft] = useState({ title: '', text: '' });
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      // Пока правят заготовку, щелчок мимо не закрывает: набранный текст
      // пропал бы вместе с окном, а набирают его небыстро.
      if (editing) return;
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open, editing]);

  const load = useCallback(async () => {
    try {
      const { data } = await openLineApi.quickReplies();
      setItems(data);
    } catch (err) {
      setItems([]);
      if (err.response?.status !== 403) toast.error('Не удалось загрузить заготовки');
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setEditing(null);
    // Комплект общий, и правит его кто угодно — читаем заново на каждое
    // открытие, иначе оператор пользовался бы вчерашней редакцией.
    if (next) { setItems(null); load(); }
  };

  const startNew = () => { setEditing('new'); setDraft({ title: '', text: '' }); };
  const startEdit = (item) => { setEditing(item.id); setDraft({ title: item.title, text: item.text }); };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (editing === 'new') await openLineApi.createQuickReply(draft);
      else await openLineApi.updateQuickReply(editing, draft);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить заготовку');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item) => {
    // Заготовка общая, и удаляет её один человек у всех — спрашиваем, прежде
    // чем убрать то, чем пользуется вся смена.
    if (!window.confirm(`Удалить заготовку «${item.title}»? Она пропадёт у всех операторов.`)) return;
    try {
      await openLineApi.deleteQuickReply(item.id);
      await load();
    } catch {
      toast.error('Не удалось удалить заготовку');
    }
  };

  const pick = (item) => {
    onPick(item.text);
    setOpen(false);
  };

  return (
    <div className="ol-quick" ref={boxRef}>
      <button
        type="button"
        className="btn-icon-chat"
        onClick={toggle}
        disabled={disabled}
        title="Быстрые ответы"
      >
        <Zap size={20} />
      </button>

      {open && (
        <div className="ol-pop ol-quick-pop">
          <div className="ol-pop-title">
            Быстрые ответы
            {!editing && (
              <button type="button" className="ol-pop-add" onClick={startNew} title="Добавить заготовку">
                <Plus size={14} />
              </button>
            )}
          </div>

          {editing ? (
            <div className="ol-quick-form">
              <input
                className="ol-quick-input"
                placeholder="Название — коротко, чтобы найти в списке"
                value={draft.title}
                maxLength={80}
                autoFocus
                onChange={e => setDraft({ ...draft, title: e.target.value })}
              />
              <textarea
                className="ol-quick-area"
                placeholder="Текст ответа"
                value={draft.text}
                rows={5}
                onChange={e => setDraft({ ...draft, text: e.target.value })}
              />
              <div className="ol-quick-form-actions">
                <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
                  <Check size={14} /> Сохранить
                </button>
                <button type="button" className="btn" onClick={() => setEditing(null)} disabled={busy}>
                  <X size={14} /> Отмена
                </button>
              </div>
              <div className="ol-pop-note">Комплект общий: правка видна всем операторам.</div>
            </div>
          ) : (
            <>
              {items === null && <div className="ol-pop-note">Загружаем…</div>}

              {items && items.length === 0 && (
                <div className="ol-pop-note">
                  Заготовок пока нет. Заведите первую — она появится у всех операторов.
                </div>
              )}

              {items && items.map(item => (
                <div key={item.id} className="ol-quick-row">
                  <button type="button" className="ol-quick-pick" onClick={() => pick(item)}>
                    <span className="ol-quick-name">{item.title}</span>
                    <span className="ol-quick-text">{item.text}</span>
                  </button>
                  <div className="ol-quick-tools">
                    <button type="button" onClick={() => startEdit(item)} title="Изменить">
                      <Pencil size={13} />
                    </button>
                    <button type="button" onClick={() => remove(item)} title="Удалить">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
