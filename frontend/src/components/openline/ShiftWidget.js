import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Headphones, Power } from 'lucide-react';
import { openLine as openLineApi } from '../../services/api';
import toast from 'react-hot-toast';

/**
 * Смена открытой линии в меню пользователя (ver. 7.99).
 *
 * Раньше «начать день» была кнопкой в рабочем окне модуля и занимала там место
 * постоянно, хотя нажимают её дважды за смену. Здесь она рядом с выходом из
 * системы — то есть там же, где человек и так отмечает начало и конец работы, —
 * и заодно показывает, сколько смена длится и что успело накопиться в очереди.
 *
 * Виджет широкий на обе колонки сетки: у него три строки содержимого, и в
 * колонке шириной с пункт меню он превратился бы в столбик.
 *
 * Состояние запрашивается только при раскрытом меню. Открытая линия — работа
 * десятка человек из нескольких сотен, и держать ради них опрос на каждой
 * странице у всех незачем; закрытое меню ничего не спрашивает вовсе.
 */
export default function ShiftWidget({ open, onNavigate }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  // Текущий момент отдельным состоянием — им и идут часы смены.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const { data } = await openLineApi.state();
      setState(data);
    } catch {
      // Молча: не заведён в линию либо сеть подвела — виджета просто не будет.
      setState(prev => prev || { isOperator: false });
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    load();
    // Меню дольше пары минут никто не держит, но если держит — счётчики должны
    // обновиться, а не застыть на снимке момента открытия.
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [open, load]);

  useEffect(() => {
    if (!open || !state?.onShift) return undefined;

    // Секундная стрелка. Идёт только у раскрытого меню и только на смене: в
    // остальное время перерисовывать нечего.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, state?.onShift]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await openLineApi.shift(!state?.onShift);
      setState(data);
      if (data.returnedToQueue > 0) {
        toast(`Возвращено в очередь: ${data.returnedToQueue}`, { icon: '↩️' });
      } else {
        toast.success(data.onShift ? 'Смена начата' : 'Смена завершена');
      }
    } catch {
      toast.error('Не удалось переключить смену');
    } finally {
      setBusy(false);
    }
  };

  // Не заведён в линию — виджета нет. Меню пользователя не место для рассказа о
  // том, чего человеку не поручали.
  if (!state?.isOperator) return null;

  const elapsed = (() => {
    if (!state.onShift || !state.since) return null;
    const sec = Math.max(0, Math.floor((now - new Date(state.since).getTime()) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  })();

  return (
    <div className={`header-shift ${state.onShift ? 'on' : ''}`}>
      <div className="header-shift-top">
        <span className="header-shift-icon"><Headphones size={17} /></span>
        <div className="header-shift-title">
          <div className="header-shift-name">Открытая линия</div>
          <div className="header-shift-state">
            {state.onShift ? 'Смена идёт' : 'Смена не начата'}
          </div>
        </div>
        {/* Часы моноширинные: без этого строка дёргается каждую секунду, когда
            в разряде меняется ширина цифры. */}
        {elapsed && <span className="header-shift-clock">{elapsed}</span>}
      </div>

      <div className="header-shift-counts">
        <Link to="/open-line" className="header-shift-count" onClick={onNavigate}>
          <b>{state.queue ?? 0}</b>
          <span>в очереди</span>
        </Link>
        <Link to="/open-line" className="header-shift-count" onClick={onNavigate}>
          <b>{state.mine ?? 0}</b>
          <span>у вас</span>
        </Link>
      </div>

      <button
        type="button"
        className="header-shift-btn"
        onClick={toggle}
        disabled={busy}
      >
        <Power size={16} />
        {state.onShift ? 'Закончить смену' : 'Начать смену'}
      </button>
    </div>
  );
}
