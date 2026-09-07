import React from 'react';

/**
 * Знак канала связи (ver. 8.03).
 *
 * Понадобился, когда каналов стало больше двух: в настройке каскада, в текстах
 * шаблонов и в разрезе статистики строка «SMS · Имобис» ничем не отличалась от
 * строки «Telegram-бот · Вики», и список читался только чтением. Знак различает
 * их раньше, чем человек дочитает подпись.
 *
 * Знаки Telegram и MAX взяты из ChannelAvatar.js — того же вида, что в списке
 * обращений, чтобы одно и то же в двух местах не выглядело разным. Там они
 * лежат аватаром собеседника, здесь — плиткой канала, и общий у них только
 * контур; выносить в третий файл ради двух path незачем.
 *
 * SMS и Notify своего знака не имеют и иметь не могут: SMS — это не бренд, а
 * услуга оператора связи, а Notify живёт под маркой агрегатора, которая нам не
 * принадлежит. Им рисуется нейтральная плитка со значком.
 */

// Фирменные цвета мессенджеров. Единственное место, где цвет задан значением, а
// не токеном: это чужая айдентика, и рампами проекта её подменять нельзя —
// узнаваемость знака в том и состоит. Совпадает с ChannelAvatar.js.
const BRANDS = {
  telegram: { from: '#2AABEE', to: '#1E96C8', title: 'Telegram' },
  max:      { from: '#8E5BFF', to: '#4B6BFB', title: 'MAX' }
};

function Glyph({ channel }) {
  if (channel === 'telegram') {
    return (
      <path
        fill="#FFFFFF"
        d="M9.78 14.8l-.15 3.3c.22 0 .32-.1.44-.21l2.1-2 4.35 3.19c.8.44 1.37.21 1.58-.74l2.87-13.4c.26-1.2-.43-1.66-1.2-1.37L2.1 9.4c-1.17.45-1.15 1.1-.2 1.4l4.3 1.34 9.98-6.29c.47-.28.9-.13.55.18z"
      />
    );
  }

  if (channel === 'max') {
    // Буква M ломаной линией: у MAX знак строится именно на ней. Текстом
    // рисовать нельзя — шрифт на чужой машине окажется другим.
    return (
      <path
        d="M5 17.5V7l7 7.2L19 7v10.5"
        stroke="#FFFFFF" strokeWidth="2.8"
        strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
    );
  }

  if (channel === 'sms') {
    // Облако с точками: сообщение как таковое, без чьей-либо марки.
    return (
      <g stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 12a7.6 7.6 0 0 1-8 7.5c-1 0-2-.2-2.9-.5L4 20.5l1.6-4.4A7.3 7.3 0 0 1 4.4 12 7.6 7.6 0 0 1 12 4.5 7.6 7.6 0 0 1 20 12z" />
        <path d="M8.8 12h.01M12 12h.01M15.2 12h.01" strokeWidth="2.4" />
      </g>
    );
  }

  // Notify и всё прочее через агрегатора: волны рассылки.
  return (
    <g stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round">
      <path d="M12 15.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
      <path d="M7.8 17.7a6 6 0 0 1 0-7.4M16.2 10.3a6 6 0 0 1 0 7.4" />
      <path d="M5 20.5a10 10 0 0 1 0-13M19 7.5a10 10 0 0 1 0 13" />
    </g>
  );
}

/**
 * @param {string} channel  telegram | max | sms | notify | иное
 * @param {number} size     сторона плитки в пикселях
 */
export default function ChannelLogo({ channel, size = 26, title, className = '' }) {
  const key = ['telegram', 'max', 'sms'].includes(channel) ? channel : 'notify';
  const brand = BRANDS[key];
  const gradientId = `ch-logo-${key}`;

  return (
    <span
      className={`ch-logo ch-logo-${key} ${className}`}
      style={{ '--ch-logo-size': `${size}px` }}
      title={title || (brand ? brand.title : undefined)}
      aria-hidden={title ? undefined : 'true'}
    >
      <svg viewBox="0 0 24 24">
        {brand && (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={brand.from} />
              <stop offset="1" stopColor={brand.to} />
            </linearGradient>
          </defs>
        )}
        {brand && <rect x="0" y="0" width="24" height="24" rx="7" fill={`url(#${gradientId})`} />}
        <Glyph channel={key} />
      </svg>
    </span>
  );
}
