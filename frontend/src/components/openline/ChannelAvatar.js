import React from 'react';
import { CHANNEL_BRANDS, brandGlyph } from './channelBrands';

/**
 * Аватар собеседника открытой линии (ver. 7.99).
 *
 * Настоящих аватаров у пациентов нет и взять их неоткуда: собеседник здесь —
 * подписчик бота, а не пользователь портала. Раньше вместо аватара в строке
 * было пусто, а канал связи подписывался словом в ряду плашек над перепиской.
 *
 * Теперь канал показывает сам знак: два плейсхолдера, по одному на мессенджер.
 * Силуэт одинаковый — человек и есть человек, — а различает их подложка и
 * значок в углу. Один взгляд на список, и видно, откуда пишут, без чтения.
 *
 * Значок вынесен отдельным элементом поверх круга, а не нарисован внутри него:
 * круг обрезан по границе (overflow: hidden), и значок внутри пришлось бы
 * сжимать до нечитаемого. Тот же приём, что у кружка «в сети» в мессенджере.
 */

// Знаки и фирменные цвета — из channelBrands.js: с приходом настоящих знаков
// (ver. 8.07) держать их копию здесь стало нельзя. Подложка круга и значок в
// углу берут один и тот же цвет марки: разные оттенки на одном аватаре читались
// бы как две разные вещи.
const CHANNELS = CHANNEL_BRANDS;

function Mark({ platform }) {
  const brand = brandGlyph(platform, 'currentColor');
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g transform={brand.transform}>
        <path d={brand.d} fill={brand.fill} fillRule={brand.fillRule} clipRule={brand.fillRule} />
      </g>
    </svg>
  );
}

export default function ChannelAvatar({ platform, size = 48, className = '' }) {
  const key = platform === 'max' ? 'max' : 'telegram';
  const channel = CHANNELS[key];
  // Идентификатор обрезки: у каждого канала свой, иначе два аватара на странице
  // делят одну обрезку и вторая перестаёт применяться.
  const clipId = `ol-avatar-${key}-clip`;

  return (
    <span
      className={`ol-avatar ${className}`}
      style={{ '--ol-avatar-size': `${size}px`, '--ol-avatar-mark': channel.color }}
      title={`Пишет из ${channel.title}`}
    >
      <span className="ol-avatar-face">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <defs>
            <clipPath id={clipId}>
              <circle cx="24" cy="24" r="24" />
            </clipPath>
          </defs>
          {/* Плоский фирменный цвет: градиент был нашей выдумкой времён
              самодельных знаков, у настоящей марки цвет один. */}
          <circle cx="24" cy="24" r="24" fill={channel.color} />
          {/* Силуэт обрезан по кругу: плечи шире знака и без обрезки вылезли бы
              за него углами. */}
          <g clipPath={`url(#${clipId})`} fill="#FFFFFF" fillOpacity=".92">
            <circle cx="24" cy="19" r="7.6" />
            <ellipse cx="24" cy="43" rx="14.2" ry="11.4" />
          </g>
        </svg>
      </span>
      <span className="ol-avatar-badge">
        <Mark platform={key} />
      </span>
    </span>
  );
}
