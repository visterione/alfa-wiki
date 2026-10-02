import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Forward, Circle } from 'lucide-react';
import { openLine as openLineApi } from '../../services/api';
import MedCenterMark from './MedCenterMark';
import toast from 'react-hot-toast';

/**
 * Передать обращение (ver. 8.09, линии — 9.23).
 *
 * До 8.09 передать чат было нечем: взявший его либо доводил разговор сам, либо
 * закрывал обращение — а закрытие отправляет пациенту просьбу оценить работу,
 * которой ещё не было.
 *
 * Передают двумя способами, и первый в списке — тот, что нужен чаще (9.23):
 *
 *   • на линию другого медцентра — человек написал не по адресу. Конкретного
 *     сотрудника там выбирать незачем, да часто и некого: обращение уходит в
 *     очередь той линии ничьим, и его возьмёт первый, кто на ней работает. На
 *     пустую линию передать тоже можно — дождётся, пока кто-нибудь заступит;
 *   • сотруднику своей линии — у передающего кончается смена или он не знает
 *     ответа. Список — состав линии этого обращения, а не все сотрудники
 *     портала: иначе чат уедет человеку, который его даже не откроет.
 *
 * Кто на смене — показано, но не ограничивает: передать вечернему сотруднику
 * вопрос, ответ на который нужен утром, вполне разумно.
 *
 * Кнопка — значком «переслать», как в мессенджерах (9.23): подпись «Передать»
 * рядом с «Закрыть» занимала полшапки, а знак пересылки узнаётся и без неё.
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
      setTargets({ users: [], lines: [] });
      toast.error('Не удалось получить, кому передать');
    }
  }, [conversationId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Перечитываем на каждое открытие: за время разговора кто-то мог выйти на
    // смену, и список «кому передать» должен это отражать.
    if (next) { setTargets(null); load(); }
  };

  const run = async (request, message, result) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await request();
      toast.success(message);
      setOpen(false);
      onDone?.(result(data));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось передать обращение');
    } finally {
      setBusy(false);
    }
  };

  const toUser = (user) => run(
    () => openLineApi.transfer(conversationId, user.id),
    `Обращение передано: ${user.displayName || user.username}`,
    () => ({ kind: 'user' })
  );

  const toLine = (line) => run(
    () => openLineApi.transferToLine(conversationId, line.id),
    `Обращение передано на линию «${lineTitle(line)}»`,
    // Видно ли обращение после передачи, знает сервер: передавший мог состоять
    // и на новой линии, и тогда закрывать ему чат незачем.
    (data) => ({ kind: 'line', visible: Boolean(data?.visible) })
  );

  const users = targets?.users || [];
  const lines = targets?.lines || [];

  return (
    <div className="ol-transfer" ref={boxRef}>
      <button
        type="button"
        className={`btn ol-head-btn ol-head-icon ${open ? 'active' : ''}`}
        onClick={toggle}
        title="Передать на другую линию или сотруднику"
        aria-label="Передать обращение"
      >
        <Forward size={18} />
      </button>

      {open && (
        <div className="ol-pop ol-transfer-pop">
          {targets === null && <div className="ol-pop-note">Загружаем, кому можно передать…</div>}

          {targets && (
            <>
              <div className="ol-pop-title">На линию</div>
              {lines.length === 0 && (
                <div className="ol-pop-note">Других линий в сети нет.</div>
              )}
              {lines.map(l => (
                <button
                  key={l.id}
                  type="button"
                  className="ol-pop-row"
                  disabled={busy}
                  onClick={() => toLine(l)}
                >
                  <MedCenterMark medCenter={l.medCenter || { name: l.name }} className="ol-mc-row" />
                  <span className="ol-pop-row-name">{lineTitle(l)}</span>
                  {l.onShift > 0
                    ? <em>на смене {l.onShift}</em>
                    : <em className="off" title="Обращение подождёт в очереди линии">никого на смене</em>}
                </button>
              ))}

              <div className="ol-pop-sep" />

              <div className="ol-pop-title">Сотруднику этой линии</div>
              {users.length === 0 && (
                <div className="ol-pop-note">
                  На этой линии больше никого нет. Состав задаёт администратор в настройках линий.
                </div>
              )}
              {users.map(u => (
                <button
                  key={u.id}
                  type="button"
                  className="ol-pop-row"
                  disabled={busy}
                  onClick={() => toUser(u)}
                >
                  <Circle size={8} className={`ol-shift-dot ${u.onShift ? 'on' : ''}`} />
                  <span className="ol-pop-row-name">{u.displayName || u.username}</span>
                  {u.onShift && <em>на смене</em>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Линия называется медцентром: «Линия Альфа Кидс» оператору ничего не добавляет. */
function lineTitle(line) {
  return line.medCenter?.name || line.name;
}
