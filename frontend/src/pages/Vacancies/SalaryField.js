/**
 * Зарплата на вкладке «Основное» (ver. 8.35).
 *
 * Четыре случая, названные заказчиком: не указывать, фиксированная, вилка,
 * договорная. Поэтому вид выбирается списком, а суммы появляются только там,
 * где они вообще бывают, — два поля, из которых одно всегда серое, читаются
 * хуже, чем их отсутствие.
 *
 * Суммы правятся строками, а не number-полями. У input[type=number] в вакансии
 * два недостатка и ни одного достоинства: колёсико мыши незаметно меняет
 * значение при прокрутке страницы, а «100 000» с пробелом он не принимает
 * вовсе — хотя именно так сумму и копируют из письма. Здесь цифры вынимаются из
 * чего угодно, а показываются разрядами.
 *
 * Готовую строку («100 000 — 120 000 ₽») рядом не показываем: из выбранного
 * вида и двух сумм и так видно, что получится, а подпись рядом с полями только
 * добавляла шума — тем более что собирается она на сервере и до сохранения
 * показывала предыдущее значение.
 */

import React from 'react';
import { Wallet } from 'lucide-react';

/** Значение поля из того, что пришло с сервера. */
export function fromVacancy(vacancy) {
  return {
    kind: vacancy?.salaryKind || 'none',
    from: vacancy?.salaryFrom ? String(vacancy.salaryFrom) : '',
    to: vacancy?.salaryTo ? String(vacancy.salaryTo) : ''
  };
}

/** То, что уходит в PUT. Суммы у видов, где их не бывает, не отправляются вовсе. */
export function toPayload(value) {
  if (value.kind === 'exact') {
    return { salaryKind: 'exact', salaryFrom: digits(value.from), salaryTo: null };
  }
  if (value.kind === 'range') {
    return { salaryKind: 'range', salaryFrom: digits(value.from), salaryTo: digits(value.to) };
  }
  return { salaryKind: value.kind, salaryFrom: null, salaryTo: null };
}

function digits(raw) {
  const only = String(raw || '').replace(/\D/g, '');
  return only ? Number(only) : null;
}

/** Разряды пробелами, пока человек набирает: «100000» → «100 000». */
function grouped(raw) {
  const only = String(raw || '').replace(/\D/g, '');
  if (!only) return '';
  return Number(only).toLocaleString('ru-RU');
}

export default function SalaryField({ meta, value, onChange }) {
  const kinds = meta?.salaryKinds || [];
  const set = (patch) => onChange({ ...value, ...patch });

  const amount = (field, placeholder) => (
    <input
      className="vac-input is-amount"
      inputMode="numeric"
      value={grouped(value[field])}
      placeholder={placeholder}
      onChange={e => set({ [field]: e.target.value.replace(/\D/g, '') })}
    />
  );

  return (
    <div className="vac-salary-row">
      <Wallet size={14} />

      <select
        className="vac-input is-narrow"
        value={value.kind}
        onChange={e => set({ kind: e.target.value })}
      >
        {kinds.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
      </select>

      {value.kind === 'exact' && amount('from', 'сумма')}

      {value.kind === 'range' && (
        <>
          {amount('from', 'от')}
          <span className="vac-sub">—</span>
          {amount('to', 'до')}
        </>
      )}
    </div>
  );
}
