import React from 'react';

// Индикатор заполнения расписания по сотруднику.
// status: 0 — не заполнено, 1 — заполнена 1-я половина месяца, 2 — обе половины.
// Клик циклит статус (0 → 1 → 2 → 0) через onClick родителя.
// Заполненный флажок — чёрно-белый шахматный узор.
export default function ScheduleFillFlags({ status = 0, onClick, readOnly = false }) {
  const Flag = ({ filled }) => (
    <svg viewBox="0 0 24 24" width="13" height="13" style={{ display: 'block' }}>
      {filled && (
        <defs>
          {/* Паттерны идентичны во всех строках, поэтому дубли id безвредны */}
          <pattern id="rbFlagChecker" patternUnits="userSpaceOnUse" width="8" height="8">
            <rect width="8" height="8" fill="#fff" />
            <rect x="0" y="0" width="4" height="4" fill="#111" />
            <rect x="4" y="4" width="4" height="4" fill="#111" />
          </pattern>
        </defs>
      )}
      <path
        d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"
        fill={filled ? 'url(#rbFlagChecker)' : 'none'}
        stroke={filled ? '#111' : '#cbd5e1'} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      />
      <line
        x1="4" y1="22" x2="4" y2="15"
        fill="none" stroke={filled ? '#111' : '#cbd5e1'} strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );

  const title =
    status >= 2 ? 'Расписание заполнено (обе половины месяца)'
    : status === 1 ? 'Заполнена 1-я половина месяца'
    : 'Расписание не заполнено';

  return (
    <div
      onClick={readOnly ? undefined : (e) => { e.stopPropagation(); onClick?.(); }}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0,
        cursor: readOnly ? 'default' : 'pointer',
        padding: '3px 4px', borderRadius: 6,
        background: status > 0 ? 'rgba(0,0,0,0.05)' : 'transparent',
      }}
    >
      <Flag filled={status >= 1} />
      <Flag filled={status >= 2} />
    </div>
  );
}
