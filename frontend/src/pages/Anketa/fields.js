/**
 * Виджеты анкеты: телефон, дни недели, интервал времени.
 *
 * Все три раньше были обычными текстовыми полями, и все три давали данные, с
 * которыми потом нельзя работать: «8-900-111» без кода города, «пн-пт кроме
 * второй среды», «с утра до обеда». Расписание по такому строит не система, а
 * переписка с врачом.
 */

import React from 'react';

// ── Телефон ────────────────────────────────────────────────────────────────

/** В анкете лежат 11 цифр, показывается маска. */
export function formatPhone(digits) {
  const value = String(digits || '').replace(/\D/g, '').slice(0, 11);
  if (!value) return '';
  const rest = value.startsWith('7') || value.startsWith('8') ? value.slice(1) : value;
  const parts = [
    rest.slice(0, 3),
    rest.slice(3, 6),
    rest.slice(6, 8),
    rest.slice(8, 10),
  ];
  let out = '+7';
  if (parts[0]) out += ` (${parts[0]}`;
  if (parts[0].length === 3) out += ')';
  if (parts[1]) out += ` ${parts[1]}`;
  if (parts[2]) out += `-${parts[2]}`;
  if (parts[3]) out += `-${parts[3]}`;
  return out;
}

/** Из набранного текста обратно в цифры. Ведущая восьмёрка считается семёркой. */
export function phoneDigits(text) {
  let digits = String(text || '').replace(/\D/g, '');
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits && !digits.startsWith('7')) digits = `7${digits}`;
  return digits.slice(0, 11);
}

export function PhoneInput({ value, onChange, invalid }) {
  return (
    <input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="+7 (___) ___-__-__"
      value={formatPhone(value)}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(phoneDigits(event.target.value))}
      onKeyDown={(event) => {
        // Backspace на разделителе иначе «не работает»: маска дорисовывает знак
        // обратно, и человек жмёт клавишу впустую.
        if (event.key !== 'Backspace') return;
        const digits = phoneDigits(event.target.value);
        if (digits.length <= 1) return;
        event.preventDefault();
        onChange(digits.slice(0, -1));
      }}
    />
  );
}

// ── Дни недели ─────────────────────────────────────────────────────────────

const DAYS = [
  [1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [7, 'Вс'],
];

export function WeekdayPicker({ value, onChange }) {
  const chosen = Array.isArray(value) ? value : [];
  const toggle = (day) => {
    const next = chosen.includes(day)
      ? chosen.filter(d => d !== day)
      : [...chosen, day].sort((a, b) => a - b);
    onChange(next.length ? next : null);
  };

  return (
    <div className="ank__days">
      {DAYS.map(([day, label]) => (
        <button
          type="button"
          key={day}
          className={chosen.includes(day) ? 'is-on' : ''}
          aria-pressed={chosen.includes(day)}
          onClick={() => toggle(day)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function weekdaysText(value) {
  if (!Array.isArray(value) || !value.length) return '';
  const byNumber = new Map(DAYS);
  return value.map(day => byNumber.get(day)).filter(Boolean).join(', ').toLowerCase();
}

// ── Интервал времени ───────────────────────────────────────────────────────

export function TimeRange({ value, onChange }) {
  const from = value?.from || '';
  const to = value?.to || '';
  const set = (key, next) => {
    const merged = { from, to, [key]: next };
    onChange(merged.from && merged.to ? merged : { ...merged });
  };

  return (
    <div className="ank__timerange">
      <input
        type="time"
        step="300"
        value={from}
        aria-label="Начало приёма"
        onChange={(event) => set('from', event.target.value)}
      />
      <span>—</span>
      <input
        type="time"
        step="300"
        value={to}
        aria-label="Конец приёма"
        onChange={(event) => set('to', event.target.value)}
      />
    </div>
  );
}

export function timeRangeText(value) {
  if (!value?.from || !value?.to) return '';
  return `${value.from}–${value.to}`;
}
