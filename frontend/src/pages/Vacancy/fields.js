/**
 * Виджеты публичной анкеты (ver. 8.20).
 *
 * Телефон, дни недели и интервал времени раньше — в бумажной анкете и в первой
 * версии электронной — были обычными текстовыми полями, и все три давали
 * данные, с которыми потом нельзя работать: «8-900-111» без кода города,
 * «пн-пт кроме второй среды», «с утра до обеда». Расписание по такому строит не
 * система, а переписка с человеком.
 *
 * Свой файл, а не импорт из анкеты первого поколения: тот модуль уедет целиком,
 * и тянуть за собой его файлы значит получить неожиданную поломку здесь в день
 * его удаления.
 */

import React from 'react';

// ── Телефон ────────────────────────────────────────────────────────────────

/** В анкете лежат 11 цифр, показывается маска. */
export function formatPhone(digits) {
  const value = String(digits || '').replace(/\D/g, '').slice(0, 11);
  if (!value) return '';
  const rest = value.startsWith('7') || value.startsWith('8') ? value.slice(1) : value;
  const parts = [rest.slice(0, 3), rest.slice(3, 6), rest.slice(6, 8), rest.slice(8, 10)];
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
      onChange={event => onChange(phoneDigits(event.target.value))}
      onKeyDown={event => {
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

const DAYS = [[1, 'Пн'], [2, 'Вт'], [3, 'Ср'], [4, 'Чт'], [5, 'Пт'], [6, 'Сб'], [7, 'Вс']];

export function WeekdayPicker({ value, onChange }) {
  const chosen = Array.isArray(value) ? value : [];
  const toggle = (day) => {
    const next = chosen.includes(day)
      ? chosen.filter(d => d !== day)
      : [...chosen, day].sort((a, b) => a - b);
    onChange(next.length ? next : null);
  };

  return (
    <div className="vcy-days">
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

// ── Интервал времени ───────────────────────────────────────────────────────

export function TimeRange({ value, onChange }) {
  const from = value?.from || '';
  const to = value?.to || '';
  const set = (key, next) => onChange({ from, to, [key]: next });

  return (
    <div className="vcy-timerange">
      <input type="time" step="300" value={from} aria-label="Начало" onChange={e => set('from', e.target.value)} />
      <span>—</span>
      <input type="time" step="300" value={to} aria-label="Конец" onChange={e => set('to', e.target.value)} />
    </div>
  );
}

// ── Специальности из МИС ───────────────────────────────────────────────────

/**
 * Свободным текстом специальность вводить нельзя: по ней подтягивается прайс на
 * шаге выбора услуг, и текстовое значение обрушило бы всю ветку в ручную работу.
 *
 * Если справочник не приехал (МИС недоступен), поле не исчезает, а честно
 * говорит об этом: остальную анкету заполнить можно, черновик не потеряется.
 */
export function ProfessionPicker({ value, options, onChange }) {
  const chosen = Array.isArray(value) ? value : [];
  const chosenIds = new Set(chosen.map(p => p.id));

  if (!options.length) {
    return <div className="vcy-note">Справочник специальностей сейчас недоступен. Заполните остальное — мы уточним специальность отдельно.</div>;
  }

  const add = (id) => {
    const found = options.find(p => p.id === id);
    if (!found || chosenIds.has(id)) return;
    onChange([...chosen, found]);
  };

  return (
    <div className="vcy-professions">
      {chosen.map(p => (
        <span className="vcy-tag" key={p.id}>
          {p.name}
          <button type="button" aria-label={`Убрать ${p.name}`} onClick={() => onChange(chosen.filter(x => x.id !== p.id))}>×</button>
        </span>
      ))}
      <select value="" onChange={e => { add(e.target.value); e.target.value = ''; }}>
        <option value="">{chosen.length ? 'Добавить ещё' : 'Выберите специальность'}</option>
        {options.filter(p => !chosenIds.has(p.id)).map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </div>
  );
}

// ── Файлы ──────────────────────────────────────────────────────────────────

const ACCEPT_ATTR = {
  image: 'image/*',
  doc: 'application/pdf,image/*'
};

export function FileField({ field, files, busy, onUpload, onRemove }) {
  const multiple = field.type === 'files';

  return (
    <div className="vcy-files">
      {files.map(file => (
        <div className="vcy-file" key={file.id}>
          <span>{file.originalName || file.filename}</span>
          <small>{formatSize(file.size)}</small>
          <button type="button" aria-label="Убрать файл" onClick={() => onRemove(file.id)}>×</button>
        </div>
      ))}

      {(multiple || !files.length) && (
        <label className={`vcy-upload ${busy ? 'is-busy' : ''}`}>
          <input
            type="file"
            accept={ACCEPT_ATTR[field.accept] || 'application/pdf,image/*'}
            disabled={busy}
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onUpload(file);
            }}
          />
          {busy ? 'Загружаем…' : files.length ? 'Добавить ещё файл' : 'Выбрать файл'}
        </label>
      )}

      <small className="vcy-hint">
        {field.accept === 'image' ? 'Картинка' : 'PDF или фотография'}, не больше 10 МБ.
      </small>
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
