import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle, Plus, EyeOff, Eye, Pencil } from 'lucide-react';
import { openLine as openLineApi } from '../../services/api';
import toast from 'react-hot-toast';

/**
 * Закрытие обращения с темой (ver. 8.29).
 *
 * Раньше кнопка закрывала сразу. Теперь между ней и закрытием стоит один
 * вопрос — о чём был разговор, — и это единственное место, где на него можно
 * ответить дёшево: оператор только что говорил с человеком и помнит, зачем тот
 * писал. Через день по переписке это восстанавливают дольше, чем она того
 * стоит, а по отчёту — уже никак.
 *
 * Меню, а не окно поверх экрана: закрытие происходит десятки раз за смену, и
 * модальное окно на каждое из них — это лишнее движение мышью к «крестику» и
 * потерянный из виду разговор, к которому тема и относится.
 *
 * Справочник правит старший оператор, прямо отсюда. Отдельная страница
 * настроек для десяти строк означала бы, что чинить формулировку пойдут в
 * лучшем случае через неделю, а до тех пор весь поток будет падать в «Другое».
 */
export default function CloseMenu({ conversationId, canEditTopics, onDone }) {
  const [open, setOpen] = useState(false);
  const [topics, setTopics] = useState(null);
  const [busy, setBusy] = useState(false);
  // Правка справочника развёрнута отдельно: обычному закрытию она не нужна и
  // только удлиняет список, по которому оператор ведёт глазами.
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const load = useCallback(async () => {
    try {
      // Старшему показываем и выключенные — иначе вернуть тему обратно неоткуда.
      const { data } = await openLineApi.topics(canEditTopics);
      setTopics(data);
    } catch {
      setTopics([]);
      toast.error('Не удалось загрузить темы обращений');
    }
  }, [canEditTopics]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) { setEditing(false); load(); }
  };

  const finish = async (topic) => {
    if (busy) return;
    setBusy(true);
    try {
      await openLineApi.close(conversationId, topic ? topic.id : null);
      setOpen(false);
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось закрыть обращение');
    } finally {
      setBusy(false);
    }
  };

  const addTopic = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;

    setBusy(true);
    try {
      await openLineApi.createTopic({ name });
      setNewName('');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось добавить тему');
    } finally {
      setBusy(false);
    }
  };

  const rename = async (topic) => {
    // window.prompt, а не своё окно: правка названия темы случается раз в месяц,
    // и своя форма ради неё — это лишний узел в меню, которое открывают, чтобы
    // закрыть обращение. Так же сделана вставка ссылки в редакторе.
    const name = window.prompt('Название темы', topic.name);
    if (name === null || !name.trim() || name.trim() === topic.name) return;

    try {
      await openLineApi.updateTopic(topic.id, { name: name.trim() });
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось переименовать тему');
    }
  };

  // Выключение, а не удаление: на тему уже ссылаются закрытые обращения, и
  // удаление стёрло бы кусок отчёта за прошлые месяцы.
  const toggleActive = async (topic) => {
    try {
      await openLineApi.updateTopic(topic.id, { isActive: !topic.isActive });
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось изменить тему');
    }
  };

  const visible = (topics || []).filter(t => t.isActive);

  return (
    <div className="ol-close" ref={boxRef}>
      <button type="button" className="btn ol-head-btn" onClick={toggle} title="Закрыть обращение">
        <CheckCircle size={15} /> Закрыть
      </button>

      {open && (
        <div className="ol-pop ol-close-pop">
          <div className="ol-pop-title">О чём было обращение</div>

          {topics === null && <div className="ol-pop-note">Загружаем темы…</div>}

          {topics && visible.length === 0 && !editing && (
            <div className="ol-pop-note">
              {canEditTopics
                ? 'Тем пока нет — заведите первую, и обращения начнут попадать в отчёт.'
                : 'Тем пока нет. Их заводит старший оператор линии.'}
            </div>
          )}

          {topics && !editing && visible.map(t => (
            <button
              key={t.id}
              type="button"
              className="ol-pop-row"
              disabled={busy}
              onClick={() => finish(t)}
            >
              <span className="ol-pop-row-name">{t.name}</span>
            </button>
          ))}

          {/* Закрыть без темы можно только тогда, когда выбирать не из чего.
              Иначе кнопка «пропустить» собрала бы на себя весь поток — она
              всегда быстрее, чем прочитать десять строк. */}
          {topics && visible.length === 0 && !editing && (
            <button type="button" className="ol-pop-row" disabled={busy} onClick={() => finish(null)}>
              <span className="ol-pop-row-name">Закрыть без темы</span>
            </button>
          )}

          {canEditTopics && (
            <>
              <div className="ol-pop-sep" />
              <button
                type="button"
                className="ol-pop-row ol-pop-row-muted"
                onClick={() => setEditing(v => !v)}
              >
                <Pencil size={13} />
                <span className="ol-pop-row-name">{editing ? 'Вернуться к выбору' : 'Править справочник'}</span>
              </button>
            </>
          )}

          {editing && (
            <div className="ol-close-edit">
              {(topics || []).map(t => (
                <div key={t.id} className={`ol-close-edit-row ${t.isActive ? '' : 'off'}`}>
                  <span className="ol-pop-row-name">{t.name}</span>
                  <button type="button" className="btn-icon-chat" title="Переименовать" onClick={() => rename(t)}>
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn-icon-chat"
                    title={t.isActive ? 'Убрать из выбора' : 'Вернуть в выбор'}
                    onClick={() => toggleActive(t)}
                  >
                    {t.isActive ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              ))}

              <form className="ol-close-add" onSubmit={addTopic}>
                <input
                  className="input"
                  maxLength={80}
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Новая тема"
                />
                <button type="submit" className="btn-icon-chat" disabled={!newName.trim() || busy} title="Добавить">
                  <Plus size={16} />
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
