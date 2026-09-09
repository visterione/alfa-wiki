import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UserCheck, Circle } from 'lucide-react';
import { openLine as openLineApi } from '../../services/api';
import toast from 'react-hot-toast';

/**
 * Передать обращение другому сотруднику (ver. 8.09).
 *
 * До этого передать чат было нечем: взявший его либо доводил разговор сам, либо
 * закрывал обращение — а закрытие отправляет пациенту просьбу оценить работу,
 * которой ещё не было. Оператор, у которого кончилась смена или который не
 * знает ответа, оставался с чужим вопросом на руках.
 *
 * Список — состав линии этого обращения, а не все сотрудники портала: передать
 * можно только тому, кто эту линию видит, иначе чат уедет человеку, который его
 * даже не откроет. Спрашивается он у сервера в момент открытия меню: состав
 * меняется редко, а держать его загруженным на каждом обращении незачем.
 *
 * Кто сейчас на смене — показано, но не ограничивает: передать вечернему
 * сотруднику вопрос, ответ на который нужен утром, вполне разумно.
 */
export default function TransferMenu({ conversationId, onDone }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef(null);

  // Закрытие по щелчку мимо: меню перекрывает переписку, и оставлять его
  // висеть, когда человек уже смотрит в другое место, нельзя.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const load = useCallback(async () => {
    try {
      const { data } = await openLineApi.transferTargets(conversationId);
      setTargets(data);
    } catch {
      setTargets([]);
      toast.error('Не удалось получить состав линии');
    }
  }, [conversationId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Перечитываем на каждое открытие: за время разговора кто-то мог выйти на
    // смену, и список «кому передать» должен это отражать.
    if (next) { setTargets(null); load(); }
  };

  const pass = async (user) => {
    if (busy) return;
    setBusy(true);
    try {
      await openLineApi.transfer(conversationId, user.id);
      toast.success(`Обращение передано: ${user.displayName || user.username}`);
      setOpen(false);
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось передать обращение');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ol-transfer" ref={boxRef}>
      <button type="button" className="btn ol-head-btn" onClick={toggle} title="Передать другому сотруднику">
        <UserCheck size={15} /> Передать
      </button>

      {open && (
        <div className="ol-pop ol-transfer-pop">
          <div className="ol-pop-title">Кому передать</div>

          {targets === null && <div className="ol-pop-note">Загружаем состав линии…</div>}

          {targets && targets.length === 0 && (
            <div className="ol-pop-note">
              На этой линии больше никого нет. Состав задаёт администратор в настройках линий.
            </div>
          )}

          {targets && targets.map(u => (
            <button
              key={u.id}
              type="button"
              className="ol-pop-row"
              disabled={busy}
              onClick={() => pass(u)}
            >
              <Circle size={8} className={`ol-shift-dot ${u.onShift ? 'on' : ''}`} />
              <span className="ol-pop-row-name">{u.displayName || u.username}</span>
              {u.onShift && <em>на смене</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
