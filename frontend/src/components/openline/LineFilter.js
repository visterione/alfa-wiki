import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, Layers } from 'lucide-react';
import MedCenterMark from './MedCenterMark';

/**
 * Отбор обращений по линии (ver. 9.23).
 *
 * Оператор, заведённый в несколько линий, получает их общей очередью — так
 * задумано с 7.85, и так остаётся по умолчанию. Но разбирать её удобнее
 * по медцентру: «сейчас отвечаю Кидсу, потом Линии». Отбор действует на все
 * три списка сразу — очередь, «мои» и архив, — иначе переключение вкладки
 * молча возвращало бы чужие линии.
 *
 * Рядом с каждой линией — сколько в ней ждёт. Без этого отбор прятал бы ровно
 * то, ради чего на линию смотрят: выбрав один медцентр, оператор не узнал бы,
 * что в соседнем пациент ждёт ответа. По той же причине на самой кнопке горит
 * точка, когда новое есть на линии, которая сейчас скрыта.
 *
 * Показывается, только когда линий больше одной: у остальных отбирать нечего.
 */
export default function LineFilter({ lines, value, onChange, byLine }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const current = lines.find(l => l.id === value) || null;
  const waitingOn = (id) => {
    const c = byLine[id];
    return c ? c.queue + c.mineUnread : 0;
  };
  const hiddenHasNew = Boolean(current) && lines.some(l => l.id !== current.id && waitingOn(l.id) > 0);

  const pick = (id) => { onChange(id); setOpen(false); };

  return (
    <div className="ol-line-filter" ref={boxRef}>
      <button
        type="button"
        className={`ol-line-filter-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title={hiddenHasNew ? 'На других линиях есть новое' : 'Показать обращения одной линии'}
      >
        {current
          ? <MedCenterMark medCenter={current.medCenter || { name: current.name }} className="ol-mc-row" />
          : <Layers size={15} />}
        <span className="ol-line-filter-name">{current ? lineTitle(current) : 'Все линии'}</span>
        {hiddenHasNew && <span className="ol-scope-dot" />}
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="ol-pop ol-line-filter-pop">
          <button type="button" className="ol-pop-row" onClick={() => pick(null)}>
            <span className="ol-line-filter-icon"><Layers size={15} /></span>
            <span className="ol-pop-row-name">Все линии</span>
            {!current && <Check size={15} className="ol-line-filter-check" />}
          </button>
          <div className="ol-pop-sep" />
          {lines.map(l => {
            const c = byLine[l.id];
            return (
              <button key={l.id} type="button" className="ol-pop-row" onClick={() => pick(l.id)}>
                <MedCenterMark medCenter={l.medCenter || { name: l.name }} className="ol-mc-row" />
                <span className="ol-pop-row-name">{lineTitle(l)}</span>
                {/* Очередь числом, непрочитанное в своих — точкой: тот же язык,
                    что у вкладок над списком. */}
                {c?.mineUnread > 0 && <span className="ol-scope-dot" title="Есть непрочитанное в ваших обращениях" />}
                {c?.queue > 0 && <span className="ol-scope-count" title="В очереди">{c.queue}</span>}
                {current?.id === l.id && <Check size={15} className="ol-line-filter-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function lineTitle(line) {
  return line.medCenter?.name || line.name;
}
