import React from 'react';
import { CHANNEL_BRANDS, brandGlyph } from './channelBrands';

/**
 * Знак канала связи (ver. 8.03).
 *
 * Понадобился, когда каналов стало больше двух: в настройке каскада, в текстах
 * шаблонов и в разрезе статистики строка «SMS · Имобис» ничем не отличалась от
 * строки «Telegram-бот · Вики», и список читался только чтением. Знак различает
 * их раньше, чем человек дочитает подпись.
 *
 * Знаки Telegram и MAX и их фирменные цвета лежат в channelBrands.js — там же,
 * откуда их берут аватар собеседника и виджет для сайтов. Раньше знаки
 * рисовались от руки и в каждом месте по-своему; с приходом настоящих (ver.
 * 8.07) копии стали недопустимы: разъехавшийся знак виден сразу.
 *
 * SMS и Notify своего знака не имеют и иметь не могут: SMS — это не бренд, а
 * услуга оператора связи, а Notify живёт под маркой агрегатора, которая нам не
 * принадлежит. Им рисуется нейтральная плитка со значком.
 */

const BRANDS = CHANNEL_BRANDS;

function Glyph({ channel }) {
  const brand = brandGlyph(channel);
  if (brand) {
    return (
      <g transform={brand.transform}>
        <path d={brand.d} fill={brand.fill} fillRule={brand.fillRule} clipRule={brand.fillRule} />
      </g>
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

  return (
    <span
      className={`ch-logo ch-logo-${key} ${className}`}
      style={{ '--ch-logo-size': `${size}px` }}
      title={title || (brand ? brand.title : undefined)}
      aria-hidden={title ? undefined : 'true'}
    >
      <svg viewBox="0 0 24 24">
        {/* Плоский фирменный цвет, а не градиент: градиент был нашей выдумкой
            времён самодельных знаков, а у настоящей марки цвет один. */}
        {brand && <rect x="0" y="0" width="24" height="24" rx="7" fill={brand.color} />}
        <Glyph channel={key} />
      </svg>
    </span>
  );
}
