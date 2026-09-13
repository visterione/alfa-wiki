/**
 * Оболочка публичных страниц вакансий (ver. 8.21).
 *
 * Направление «Стекло», выбранное заказчиком по макету: фон — мягкий разлив
 * фирменного цвета филиала, поверх него полупрозрачные карточки с размытием.
 * Страница узнаётся раньше, чем прочитан заголовок.
 *
 * Цвет и знак берутся из справочника медцентров как есть. Две вещи, всплывшие
 * на живых данных, учтены прямо здесь:
 *
 * У «Проф» фирменный цвет #9999ff, у «Смайл» — #999999, оба почти белые. На
 * стекле такой цвет исчезает, а кнопка теряет контраст. Поэтому для текста и
 * кнопок берётся не сам цвет, а его затемнённая производная (--clinic-ink), и
 * бледный филиал остаётся читаемым.
 *
 * Логотип заполнен не у всех, адрес тоже. Запасной знак — кружок с первой
 * буквой названия, а строка адреса просто не рисуется: пустое место в шапке
 * выглядит поломкой.
 */

import React from 'react';

import { BASE_URL } from '../../services/api';
import './Vacancy.css';

const FALLBACK_COLOR = '#3d7ea6';

export default function Shell({ branch, children }) {
  const color = branch?.color || FALLBACK_COLOR;

  return (
    <div className="vcy" style={{ '--clinic': color }}>
      <div className="vcy-glow" aria-hidden="true" />
      <div className="vcy-page">
        {branch && <Brand branch={branch} />}
        <div className="vcy-card">{children}</div>
      </div>
    </div>
  );
}

function Brand({ branch }) {
  const logo = logoUrl(branch.logoUrl);
  const initial = (branch.name || '?').trim()[0]?.toUpperCase() || '?';
  const place = [branch.city, branch.address].filter(Boolean).join(', ');

  return (
    <header className="vcy-brand">
      <span className="vcy-logo">
        {logo
          ? <img src={logo} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
          : initial}
      </span>
      <span className="vcy-brand-text">
        <b>{branch.name}</b>
        {place && <small>{place}</small>}
      </span>
    </header>
  );
}

function logoUrl(value) {
  if (!value) return null;
  // Адрес с localhost остаётся в базе от загрузок на машине разработки: файл
  // лежит там же, где и всё остальное, а хост в ссылке чужой.
  if (value.startsWith('http://localhost')) {
    return `${BASE_URL}/${value.replace(/^http:\/\/localhost:\d+\//, '')}`;
  }
  if (value.startsWith('http')) return value;
  return `${BASE_URL}/${value.replace(/^\/+/, '')}`;
}
