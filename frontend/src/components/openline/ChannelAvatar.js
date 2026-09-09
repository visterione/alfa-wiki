import React from 'react';
import { CHANNEL_BRANDS, brandGlyph } from './channelBrands';

/**
 * Аватар собеседника открытой линии (ver. 7.99).
 *
 * Настоящих аватаров у пациентов нет и взять их неоткуда: собеседник здесь —
 * подписчик бота, а не пользователь портала. Раньше вместо аватара в строке
 * было пусто, а канал связи подписывался словом в ряду плашек над перепиской.
 *
 * Теперь канал показывает сам знак: серый силуэт человека и цветной значок
 * мессенджера в углу. Один взгляд на список, и видно, откуда пишут, без чтения.
 *
 * ЦВЕТ ПЕРЕЕХАЛ СО СТОРОНЫ НА СТОРОНУ (ver. 8.09). До этого было наоборот: круг
 * заливался фирменным цветом канала, а значок сидел белым кружком поверх него.
 * В списке из двадцати обращений это давало двадцать синих и фиолетовых пятен —
 * цвета получалось больше, чем сведений, и разглядеть в нём знак мессенджера
 * было тем труднее, чем ярче подложка. Теперь цветной только значок, и он же
 * единственное, что цвет здесь означает; сам человек — серый, потому что
 * плейсхолдер и есть отсутствие лица.
 *
 * Значок вынесен отдельным элементом поверх круга, а не нарисован внутри него:
 * круг обрезан по границе (overflow: hidden), и значок внутри пришлось бы
 * сжимать до нечитаемого. Тот же приём, что у кружка «в сети» в мессенджере.
 */

// Знаки и фирменные цвета — из channelBrands.js: с приходом настоящих знаков
// (ver. 8.07) держать их копию здесь стало нельзя. Цвет марки достаётся значку
// в углу — единственному цветному месту аватара.
const CHANNELS = CHANNEL_BRANDS;

function Mark({ platform }) {
  // currentColor, а не значение: цвет знака задаёт CSS значка — белым на
  // цветном кружке, — и здесь его повторять нельзя, разъедется.
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
          {/* Подложка серая и задаётся из CSS (класс, а не атрибут fill):
              оттенок должен меняться вместе с темой, а атрибут про тему не
              знает. */}
          <circle cx="24" cy="24" r="24" className="ol-avatar-ground" />
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
