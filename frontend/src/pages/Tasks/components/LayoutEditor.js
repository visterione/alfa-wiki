/**
 * Раскладка часов многодневной подзадачи по дням её окна (ver. 8.48).
 *
 * До этого релиза подзадача обязана была поместиться в один рабочий день:
 * работа на двадцать часов не ставилась в план вообще, и её резали на четыре
 * подзадачи «Вёрстка (1/4)». Теперь у подзадачи есть окно дат, а здесь человек
 * говорит, сколько часов сидит над ней в каждый его день.
 *
 * Раскладывает человек, а не система. Кнопки «разложить поровну» здесь нет
 * намеренно: ровный слой выглядит безобидно и молча влезает в уже плотный день —
 * ровно то, против чего модуль затевался. Зато у каждого дня есть его свободное
 * время, и нажатие по нему заполняет строку ровно этим остатком: это решение про
 * один день, принятое человеком, а не расчёт за него.
 *
 * Сумма обязана сойтись с оценкой до копейки, и кнопка до этого не работает.
 * Принимать «почти столько» нельзя: оценка — то, что автор и исполнитель друг
 * другу обещали, и раскладка, которая её не покрывает, означает недоговорённость,
 * а не округление.
 *
 * Переработка допускается — взять сверх нормы это своё решение исполнителя, — но
 * не молча: перегруженные дни краснеют, а кнопка меняет надпись и требует
 * подтверждения.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { CalendarClock } from 'lucide-react';
import { tasks as api } from '../../../services/api';
import { dshort, dnum, hoursText, estimateText, fromKey, toKey } from '../utils/dates';
import { LoadBar } from './Bits';

/** Шаг ввода — те же четверть часа, что и на шкале дня в форме постановки. */
const STEP = 0.25;

const round = value => Math.round(value * 100) / 100;

/** Дни окна в виде ключей, включая границы. */
function daysBetween(from, to) {
  const out = [];
  const cursor = fromKey(from);
  const last = fromKey(to);
  while (cursor <= last) {
    out.push(toKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export default function LayoutEditor({
  window: frame,
  estimateHours,
  days: given,
  userId,
  submitLabel = 'Поставить в план',
  busy,
  onSubmit,
  onCancel,
}) {
  const [days, setDays] = useState(given || null);
  const [hours, setHours] = useState({});
  const [loading, setLoading] = useState(!given);

  /**
   * Загрузка по дням окна: своя или того, за кого раскладывают.
   *
   * Дни могут приехать готовыми — их отдаёт 409 requiresLayout, и лишний запрос
   * за теми же числами был бы вторым способом их посчитать.
   */
  useEffect(() => {
    if (given) { setDays(given); setLoading(false); return undefined; }
    if (!frame?.from || !frame?.to) return undefined;
    let alive = true;
    setLoading(true);
    api.getPersonLoad(userId, frame.from, frame.to)
      .then(res => { if (alive) setDays(res.data?.days || []); })
      .catch(() => { if (alive) setDays([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [given, userId, frame?.from, frame?.to]);

  const byDate = useMemo(
    () => new Map((days || []).map(day => [day.date, day])),
    [days]
  );
  const keys = frame?.from && frame?.to ? daysBetween(frame.from, frame.to) : [];

  const rows = keys.map(date => {
    const day = byDate.get(date) || {};
    // Запятая вместо точки — обычный ввод в русской раскладке, и в number-поле
    // она даёт NaN, из которого получается «NaN ч» в итоге и заблокированная
    // кнопка без объяснения причины.
    const typed = Number(String(hours[date] ?? '').replace(',', '.'));
    const planned = Number.isFinite(typed) && typed > 0 ? typed : 0;
    const free = Number(day.free || 0);
    const norm = day.norm === null || day.norm === undefined ? null : Number(day.norm);
    const after = round(Number(day.hours || 0) + planned);
    return {
      date,
      day,
      planned,
      free,
      norm,
      after,
      // День, в который раскладывать нельзя: выходной, отпуск или человек не
      // заведён в модуле. Такие строки не запрещены «на всякий случай» — сервер
      // отказал бы в раскладке по ним, и поле для ввода обещало бы невозможное.
      closed: !!day.onVacation || !!day.onDayOff || !norm,
      over: norm !== null && after > norm + 1e-9 ? round(after - norm) : 0,
    };
  });

  const total = round(rows.reduce((sum, row) => sum + row.planned, 0));
  const need = round(Number(estimateHours) || 0);
  const left = round(need - total);
  const overloaded = rows.filter(row => row.planned > 0 && row.over > 0);
  const capacity = round(rows.filter(row => !row.closed).reduce((sum, row) => sum + row.free, 0));

  const set = (date, value) => setHours(prev => ({ ...prev, [date]: value }));

  /**
   * «Всё свободное этого дня» — но не больше того, что осталось разложить.
   *
   * Иначе кнопка заполняла бы день целиком и тут же делала сумму больше оценки,
   * то есть предлагала бы сделать неверно.
   */
  const fill = row => {
    if (row.closed) return;
    const take = Math.min(row.free, round(left + row.planned));
    if (take <= 0) return;
    set(row.date, round(Math.round(take / STEP) * STEP));
  };

  const ready = total > 0 && Math.abs(total - need) < 0.005;

  const submit = () => {
    if (!ready) return;
    onSubmit(
      rows.filter(row => row.planned > 0).map(row => ({ date: row.date, hours: row.planned })),
      overloaded.length > 0
    );
  };

  return (
    <div className="tsk-layout">
      <div className="tsk-layout-head">
        <span className="tsk-layout-window">
          <CalendarClock size={14} strokeWidth={1.9} />
          {dnum(frame.from)} — {dnum(frame.to)}
        </span>
        <span className="tsk-layout-need">
          разложить <b>{estimateText(need)}</b>
          {!loading && capacity < need && (
            <em> · свободно в окне только {hoursText(capacity)}</em>
          )}
        </span>
      </div>

      {loading ? (
        <div className="tsk-scale-hint">Смотрим свободное время…</div>
      ) : (
        <>
          <div className="tsk-layout-rows">
            {rows.map(row => (
              <div className={`tsk-layout-row ${row.closed ? 'is-closed' : ''} ${
                row.planned > 0 && row.over > 0 ? 'is-over' : ''}`} key={row.date}>
                <span className="tsk-layout-day">{dshort(row.date)}</span>

                <input
                  className="tsk-input tsk-layout-input"
                  type="number"
                  min="0"
                  step={STEP}
                  inputMode="decimal"
                  placeholder="0"
                  disabled={row.closed || busy}
                  value={hours[row.date] ?? ''}
                  onChange={event => set(row.date, event.target.value)}
                />

                <LoadBar
                  hours={row.after}
                  done={row.day.done}
                  norm={row.norm}
                  onVacation={row.day.onVacation}
                  onDayOff={row.day.onDayOff}
                  compact
                />

                {/* Свободное время дня — не подпись, а кнопка: нажатие
                    заполняет строку этим остатком. Про один день, а не про всё
                    окно: раскладывает человек. */}
                {row.closed ? (
                  <span className="tsk-layout-closed">
                    {row.day.onVacation ? 'отпуск' : row.day.onDayOff ? 'выходной' : 'нет нормы'}
                  </span>
                ) : row.over > 0 && row.planned > 0 ? (
                  <span className="tsk-layout-over">
                    станет {hoursText(row.after)} из {hoursText(row.norm)} — переработка {hoursText(row.over)}
                  </span>
                ) : (
                  <button type="button" className="tsk-layout-free" disabled={busy || row.free <= 0}
                    title="Заполнить свободным временем этого дня"
                    onClick={() => fill(row)}>
                    {row.free > 0 ? `свободно ${hoursText(row.free)}` : 'день занят'}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="tsk-layout-foot">
            <span className={`tsk-layout-total ${ready ? 'is-ready' : ''}`}>
              разложено <b>{hoursText(total)}</b> из {hoursText(need)}
              {!ready && left > 0 && <em> · осталось {hoursText(left)}</em>}
              {!ready && left < 0 && <em> · лишние {hoursText(-left)}</em>}
            </span>
            <div className="tsk-layout-btns">
              {onCancel && <button className="tsk-btn" onClick={onCancel}>Отмена</button>}
              <button
                className={`tsk-btn ${overloaded.length ? 'is-danger' : 'is-primary'}`}
                disabled={!ready || busy}
                onClick={submit}
              >
                {overloaded.length
                  ? `Всё равно взять — переработка в ${overloaded.length} дн.`
                  : submitLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
