import React, { useState, useEffect, useCallback, useImperativeHandle, useMemo } from 'react';
import { useAuth } from '../../../context/AuthContext';

export const STATUS_CODES = [
  { code: '',    label: '— (не задано)' },
  { code: 'Я',   label: 'Я — Явка' },
  { code: 'Н',   label: 'Н — Ночные часы' },
  { code: 'РВ',  label: 'РВ — Праздники' },
  { code: 'С',   label: 'С — Сверхурочно' },
  { code: 'К',   label: 'К — Командировка' },
  { code: 'ПК',  label: 'ПК — Повышение квалификации' },
  { code: 'ЛЧ',  label: 'ЛЧ — Сокращённое рабочее время' },
  { code: 'НС',  label: 'НС — Неполное рабочее время' },
  { code: 'МО',  label: 'МО — Обязательный медосмотр' },
  { code: 'ОТ',  label: 'ОТ — Отпуск' },
  { code: 'ОД',  label: 'ОД — Дополнительный отпуск' },
  { code: 'Р',   label: 'Р — Отпуск по беременности и родам' },
  { code: 'ОЖ',  label: 'ОЖ — Отпуск по уходу за ребёнком' },
  { code: 'Б',   label: 'Б — Больничный' },
  { code: 'Т',   label: 'Т — Больничный неоплачиваемый' },
  { code: 'ПВ',  label: 'ПВ — Вынужденный прогул' },
  { code: 'ПР',  label: 'ПР — Прогул' },
  { code: 'НН',  label: 'НН — Неявка (невыясненная причина)' },
  { code: 'В',   label: 'В — Выходной день' },
  { code: 'ПТД', label: 'ПТД — Приостановление трудового договора (мобилизация)' },
  { code: 'ДО',  label: 'ДО — Отпуск без сохранения заработной платы' },
];

// Коды, которые засчитываются как отработанные дни/часы
export const WORKING_CODES = new Set(['Я', 'Н', 'РВ', 'С', 'К', 'ПК', 'ЛЧ', 'НС', 'МО']);

export function pad2(n) { return String(n).padStart(2, '0'); }

// ── Signature / underline field ───────────────────────────────────────────────
export function UnderlineField({ label, value, minWidth = 140 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: minWidth || undefined, width: minWidth ? undefined : '100%' }}>
      <div style={{
        borderBottom: '1px solid #000', width: '100%',
        minHeight: 22, paddingBottom: 2, textAlign: 'center',
        fontSize: 13, fontFamily: 'Times New Roman, serif',
      }}>
        {value}
      </div>
      <span style={{ fontSize: 10, fontFamily: 'Times New Roman, serif', color: '#000', marginTop: 2 }}>
        ({label})
      </span>
    </div>
  );
}

const SIG_ROWS = [
  { role: 'Ответственное лицо' },
  { role: 'Руководитель структурного подразделения' },
  { role: 'Работник кадровой службы' },
];

export function SigBlock({ name }) {
  return (
    <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%' }}>
      <colgroup>
        <col style={{ width: '36%' }} />
        <col style={{ width: '22%' }} />
        <col style={{ width: '14%' }} />
        <col style={{ width: '28%' }} />
      </colgroup>
      <tbody>
        {SIG_ROWS.map(({ role }) => (
          <tr key={role} style={{ verticalAlign: 'bottom' }}>
            <td style={{ paddingBottom: 28, paddingRight: 16, fontSize: 13, fontFamily: 'Times New Roman, serif', fontWeight: 700 }}>
              {role}
            </td>
            <td style={{ paddingBottom: 28, paddingRight: 12 }}>
              <UnderlineField label="должность" minWidth={0} />
            </td>
            <td style={{ paddingBottom: 28, paddingRight: 12 }}>
              <UnderlineField label="подпись" minWidth={0} />
            </td>
            <td style={{ paddingBottom: 28 }}>
              <UnderlineField label="расшифровка подписи" value={name} minWidth={0} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Attendance table ──────────────────────────────────────────────────────────
// Structure: 16 shared day-columns.
// Column i (0-14) → top header = day i+1, bottom header = day i+16
// Column 15       → top header = "Х",     bottom header = last day of month (if > 30)
const TabelTable = React.forwardRef(function TabelTable({ selectedDoctors, year, month, readOnly, initialEntries = {}, initialPayData = {} }, ref) {
  const { isAdmin } = useAuth();
  const lastDay = new Date(year, month, 0).getDate();

  // Half-period edit locks (non-admins only)
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const firstHalfLocked  = !isAdmin && today >= new Date(year, month - 1, 18);
  const secondHalfLocked = !isAdmin && today >= new Date(year, month, 3);

  // Effective per-half readOnly flags
  const readOnly1 = readOnly || firstHalfLocked;
  const readOnly2 = readOnly || secondHalfLocked;

  // Odd number of days → add Х column to balance both halves equally
  const showX      = lastDay % 2 === 1;
  const halfSize   = Math.floor(lastDay / 2);
  const firstHalf  = Array.from({ length: halfSize }, (_, i) => i + 1);
  const secondHalf = Array.from({ length: halfSize + (showX ? 1 : 0) }, (_, i) => halfSize + 1 + i);
  const dayColCount = secondHalf.length;

  const [entries,   setEntries]   = useState(initialEntries);
  const [payData,   setPayData]   = useState(initialPayData); // extra cols (7-13): [docId][`${row}_${col}`]
  const [picker,    setPicker]    = useState(null); // { docId, day, top, left }

  useImperativeHandle(ref, () => ({
    getSnapshot: () => ({ entries, payData }),
  }), [entries, payData]);

  const PAY_COLS = 10; // 6 cols for ЗП data + 4 cols for Неявки

  const getPayCell = useCallback(
    (docId, row, col) => payData[docId]?.[`${row}_${col}`] || '',
    [payData]
  );
  const setPayCell = (docId, row, col, val) =>
    setPayData(prev => ({
      ...prev,
      [docId]: { ...prev[docId], [`${row}_${col}`]: val },
    }));

  const getEntry = useCallback(
    (docId, day) => entries[docId]?.[day] || { code: '', hours: '' },
    [entries]
  );

  const setCode = (docId, day, code) =>
    setEntries(prev => ({
      ...prev,
      [docId]: { ...prev[docId], [day]: { ...(prev[docId]?.[day] || {}), code } },
    }));

  const setHours = (docId, day, val) =>
    setEntries(prev => ({
      ...prev,
      [docId]: { ...prev[docId], [day]: { ...(prev[docId]?.[day] || {}), hours: val } },
    }));

  const calcTotals = useCallback((docId) => {
    const daysI   = firstHalf.filter(d => WORKING_CODES.has(getEntry(docId, d).code)).length;
    const hoursI  = firstHalf.reduce((s, d) => s + (parseFloat(getEntry(docId, d).hours) || 0), 0);
    const daysII  = secondHalf.filter(d => WORKING_CODES.has(getEntry(docId, d).code)).length;
    const hoursII = secondHalf.reduce((s, d) => s + (parseFloat(getEntry(docId, d).hours) || 0), 0);

    return {
      daysI, hoursI, daysII, hoursII,
      totalDays: daysI + daysII,
      totalHours: hoursI + hoursII,
    };
  }, [getEntry, firstHalf, secondHalf]);

  const openPicker = (docId, day, e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    if (spaceBelow >= spaceAbove) {
      setPicker({ docId, day, top: rect.bottom + gap, left: rect.left, maxHeight: spaceBelow });
    } else {
      setPicker({ docId, day, bottom: window.innerHeight - rect.top + gap, left: rect.left, maxHeight: spaceAbove });
    }
  };

  useEffect(() => {
    if (!picker) return;
    const close = e => { if (!e.target.closest('.tabel-picker')) setPicker(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [picker]);

  return (
    <div style={{ overflowX: 'auto', position: 'relative', borderRight: '1px solid #000' }}>

      {picker && (
        <div className="tabel-picker" style={{
          top: picker.top, bottom: picker.bottom,
          left: picker.left, maxHeight: picker.maxHeight,
        }}>
          {STATUS_CODES.map(s => (
            <button key={s.code || '__empty__'} className="tabel-picker-item"
              onClick={() => { setCode(picker.docId, picker.day, s.code); setPicker(null); }}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <table className="tabel-table">
        <thead>
          {/* ── Row 1: group headers ── */}
          <tr>
            <th className="tt-th" rowSpan={3} style={{ width: 24 }}>№</th>
            <th className="tt-th" rowSpan={3} style={{ minWidth: 200 }}>
              Фамилия, инициалы, должность (специальность, профессия)
            </th>
            <th className="tt-th tt-th-rot" rowSpan={3}>
              <div className="tt-th-rot-inner">Табельный номер</div>
            </th>
            {/* shared day-columns */}
            <th className="tt-th" colSpan={dayColCount}>
              Отметки о явках и неявках на работу по числам месяца
            </th>
            <th className="tt-th" colSpan={2}>
              Отработано за
            </th>
            <th className="tt-th" colSpan={6} style={{ fontSize: 10, lineHeight: 1.3 }}>
              Данные для начисления заработной платы по видам и направлениям затрат
            </th>
            <th className="tt-th" colSpan={4}>
              Неявки по причинам
            </th>
          </tr>

          {/* ── Row 2: top day labels + Х (only for odd-day months) and section labels ── */}
          <tr>
            {firstHalf.map(d => (
              <th key={d} className="tt-th tt-th-day">{d}</th>
            ))}
            {showX && <th className="tt-th tt-th-day tt-th-x">Х</th>}
            <th className="tt-th tt-th-section" rowSpan={2} style={{ width: 44 }}>
              половину<br />месяца<br />(I, II)
            </th>
            <th className="tt-th tt-th-section" rowSpan={2} style={{ width: 44 }}>
              месяц
            </th>
            {/* Данные ЗП — 6 колонок, rowSpan=2 */}
            <th className="tt-th tt-th-rot" rowSpan={2}><div className="tt-th-rot-inner">Код вида оплаты</div></th>
            <th className="tt-th tt-th-rot" rowSpan={2}><div className="tt-th-rot-inner">Корр. счёт</div></th>
            <th className="tt-th tt-th-section" rowSpan={2} style={{ width: 30 }}>Часы</th>
            <th className="tt-th tt-th-rot" rowSpan={2}><div className="tt-th-rot-inner">Код вида оплаты</div></th>
            <th className="tt-th tt-th-rot" rowSpan={2}><div className="tt-th-rot-inner">Корр. счёт</div></th>
            <th className="tt-th tt-th-section" rowSpan={2} style={{ width: 30 }}>Часы</th>
            {/* Неявки — 4 колонки, rowSpan=2 */}
            <th className="tt-th tt-th-section" rowSpan={2} style={{ width: 36 }}>Код</th>
            <th className="tt-th tt-th-section" rowSpan={2} style={{ width: 52 }}>Дни (часы)</th>
            <th className="tt-th tt-th-section" rowSpan={2} style={{ width: 36 }}>Код</th>
            <th className="tt-th tt-th-section" rowSpan={2} style={{ width: 52 }}>Дни (часы)</th>
          </tr>

          {/* ── Row 3: bottom day labels ── */}
          <tr>
            {secondHalf.map((d, i) => (
              <th key={i} className="tt-th tt-th-day">{d}</th>
            ))}
            {/* new cols covered by rowSpan=2 above */}
          </tr>

          {/* ── Row 4: column numbers ── */}
          <tr className="tt-col-numbers">
            <td className="tt-th tt-col-num">1</td>
            <td className="tt-th tt-col-num">2</td>
            <td className="tt-th tt-col-num">3</td>
            <td className="tt-th tt-col-num" colSpan={dayColCount}>4</td>
            <td className="tt-th tt-col-num">5</td>
            <td className="tt-th tt-col-num">6</td>
            <td className="tt-th tt-col-num">7</td>
            <td className="tt-th tt-col-num">8</td>
            <td className="tt-th tt-col-num">9</td>
            <td className="tt-th tt-col-num">7</td>
            <td className="tt-th tt-col-num">8</td>
            <td className="tt-th tt-col-num">9</td>
            <td className="tt-th tt-col-num">10</td>
            <td className="tt-th tt-col-num">11</td>
            <td className="tt-th tt-col-num">12</td>
            <td className="tt-th tt-col-num">13</td>
          </tr>
        </thead>

        <tbody>
          {selectedDoctors.length === 0 && (
            <tr>
              <td colSpan={dayColCount + 15} className="tt-td"
                style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>
                Сотрудники не выбраны
              </td>
            </tr>
          )}

          {selectedDoctors.map((doc, idx) => {
            const t    = calcTotals(doc.id);
            const resolveStr = p => typeof p === 'object' ? (p.title || p.name || '') : String(p || '');
            const role = (Array.isArray(doc.roles) && doc.roles.length > 0)
              ? doc.roles.map(resolveStr).filter(Boolean).join(', ')
              : (Array.isArray(doc.professions) && doc.professions.length > 0)
                ? doc.professions.map(resolveStr).filter(Boolean).join(', ')
                : '';
            const displayName = (() => {
              const parts = (doc.name || '').trim().split(/\s+/);
              if (parts.length < 2) return doc.name || '';
              const [last, ...rest] = parts;
              return last + ' ' + rest.map(p => p[0] ? p[0].toUpperCase() + '.' : '').join(' ');
            })();

            return (
              <React.Fragment key={doc.id}>

                {/* ── Row A: codes for first half (days 1-15) + Х ── */}
                <tr className="tt-row-a">
                  <td className="tt-td tt-center" rowSpan={4}>{idx + 1}</td>
                  <td className="tt-td tt-name" rowSpan={4}>
                    <div style={{ lineHeight: 1.3 }}>{displayName}</div>
                    {role && <div style={{ fontSize: 10, color: '#555', marginTop: 2, lineHeight: 1.2 }}>{role}</div>}
                    {doc.categoryLabel && <div style={{ fontSize: 10, color: '#555', marginTop: 2, lineHeight: 1.2 }}>{doc.categoryLabel}</div>}
                  </td>
                  <td className="tt-td tt-center" rowSpan={4}>{doc.tabelNumber || ''}</td>

                  {firstHalf.map(d => (
                    <td key={d}
                      className={`tt-td tt-code${!readOnly1 ? ' tt-clickable' : ''}`}
                      onClick={!readOnly1 ? e => openPicker(doc.id, d, e) : undefined}>
                      {getEntry(doc.id, d).code}
                    </td>
                  ))}
                  {showX && <td className="tt-td tt-x-cell">Х</td>}

                  {/* Summary: days in first half | total days (rowspan 2) */}
                  <td className="tt-td tt-sum">{t.daysI || ''}</td>
                  <td className="tt-td tt-total" rowSpan={2}>{t.totalDays || ''}</td>
                  {/* Данные ЗП + Неявки — строка 0 */}
                  {Array.from({ length: PAY_COLS }, (_, c) => (
                    <td key={c} className="tt-td tt-hours">
                      <input type="text" className="tt-hours-input"
                        value={getPayCell(doc.id, 0, c)}
                        onChange={e => setPayCell(doc.id, 0, c, e.target.value)}
                        disabled={readOnly1} />
                    </td>
                  ))}
                </tr>

                {/* ── Row B: hours for first half (days 1-15) ── */}
                <tr className="tt-row-b">
                  {firstHalf.map(d => (
                    <td key={d} className="tt-td tt-hours">
                      <input
                        type="number" min="0" step="0.5"
                        className="tt-hours-input"
                        value={getEntry(doc.id, d).hours}
                        onChange={e => setHours(doc.id, d, e.target.value)}
                        disabled={readOnly1}
                      />
                    </td>
                  ))}
                  {showX && <td className="tt-td tt-x-cell">Х</td>}
                  <td className="tt-td tt-sum">{t.hoursI || ''}</td>
                  {/* totalDays cell merged from row A */}
                  {/* Данные ЗП + Неявки — строка 1 */}
                  {Array.from({ length: PAY_COLS }, (_, c) => (
                    <td key={c} className="tt-td tt-hours">
                      <input type="text" className="tt-hours-input"
                        value={getPayCell(doc.id, 1, c)}
                        onChange={e => setPayCell(doc.id, 1, c, e.target.value)}
                        disabled={readOnly1} />
                    </td>
                  ))}
                </tr>

                {/* ── Row C: codes for second half ── */}
                <tr className="tt-row-c">
                  {secondHalf.map((d, i) => (
                    <td key={i}
                      className={`tt-td tt-code${!readOnly2 ? ' tt-clickable' : ''}`}
                      onClick={!readOnly2 ? e => openPicker(doc.id, d, e) : undefined}>
                      {getEntry(doc.id, d).code}
                    </td>
                  ))}
                  <td className="tt-td tt-sum">{t.daysII || ''}</td>
                  <td className="tt-td tt-total" rowSpan={2}>{t.totalHours || ''}</td>
                  {/* Данные ЗП + Неявки — строка 2 */}
                  {Array.from({ length: PAY_COLS }, (_, c) => (
                    <td key={c} className="tt-td tt-hours">
                      <input type="text" className="tt-hours-input"
                        value={getPayCell(doc.id, 2, c)}
                        onChange={e => setPayCell(doc.id, 2, c, e.target.value)}
                        disabled={readOnly2} />
                    </td>
                  ))}
                </tr>

                {/* ── Row D: hours for second half ── */}
                <tr className="tt-row-d">
                  {secondHalf.map((d, i) => (
                    <td key={i} className="tt-td tt-hours">
                      <input
                        type="number" min="0" step="0.5"
                        className="tt-hours-input"
                        value={getEntry(doc.id, d).hours}
                        onChange={e => setHours(doc.id, d, e.target.value)}
                        disabled={readOnly2}
                      />
                    </td>
                  ))}
                  <td className="tt-td tt-sum">{t.hoursII || ''}</td>
                  {/* totalHours merged from row C */}
                  {/* Данные ЗП + Неявки — строка 3 */}
                  {Array.from({ length: PAY_COLS }, (_, c) => (
                    <td key={c} className="tt-td tt-hours">
                      <input type="text" className="tt-hours-input"
                        value={getPayCell(doc.id, 3, c)}
                        onChange={e => setPayCell(doc.id, 3, c, e.target.value)}
                        disabled={readOnly2} />
                    </td>
                  ))}
                </tr>

              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

export default TabelTable;
