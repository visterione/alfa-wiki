import React from 'react';

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

// Фирменные цвета мессенджеров. Единственное место в модуле, где цвет задан
// значением, а не токеном: это чужая айдентика, и рампами проекта её подменять
// нельзя — узнаваемость знака в том и состоит.
const CHANNELS = {
  telegram: { from: '#2AABEE', to: '#1E96C8', mark: '#229ED9', title: 'Telegram' },
  max: { from: '#8E5BFF', to: '#4B6BFB', mark: '#6C4BFB', title: 'MAX' }
};

function Mark({ platform }) {
  if (platform === 'max') {
    // Буква M ломаной линией: у MAX знак строится именно на ней, а рисовать
    // текстом нельзя — шрифт на чужой машине окажется другим.
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M5 17.5V7l7 7.2L19 7v10.5"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9.78 14.8l-.15 3.3c.22 0 .32-.1.44-.21l2.1-2 4.35 3.19c.8.44 1.37.21 1.58-.74l2.87-13.4c.26-1.2-.43-1.66-1.2-1.37L2.1 9.4c-1.17.45-1.15 1.1-.2 1.4l4.3 1.34 9.98-6.29c.47-.28.9-.13.55.18z"
      />
    </svg>
  );
}

export default function ChannelAvatar({ platform, size = 48, className = '' }) {
  const key = platform === 'max' ? 'max' : 'telegram';
  const channel = CHANNELS[key];
  const gradientId = `ol-avatar-${key}`;

  return (
    <span
      className={`ol-avatar ${className}`}
      style={{ '--ol-avatar-size': `${size}px`, '--ol-avatar-mark': channel.mark }}
      title={`Пишет из ${channel.title}`}
    >
      <span className="ol-avatar-face">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={channel.from} />
              <stop offset="1" stopColor={channel.to} />
            </linearGradient>
            <clipPath id={`${gradientId}-clip`}>
              <circle cx="24" cy="24" r="24" />
            </clipPath>
          </defs>
          <circle cx="24" cy="24" r="24" fill={`url(#${gradientId})`} />
          {/* Силуэт обрезан по кругу: плечи шире знака и без обрезки вылезли бы
              за него углами. */}
          <g clipPath={`url(#${gradientId}-clip)`} fill="#FFFFFF" fillOpacity=".92">
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
