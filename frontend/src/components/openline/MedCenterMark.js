import React, { useState } from 'react';
import { fileUrl } from '../../utils/fileUrl';
import './ChannelAvatar.css';

/**
 * Знак медцентра линии (ver. 9.23): на аватаре обращения, в отборе по линиям и
 * в меню передачи.
 *
 * На аватаре он заменил подпись медцентра под именем пациента в шапке
 * переписки: у оператора с несколькими линиями вопрос «чей это пациент» встаёт
 * на каждой строке списка, а подпись была только у открытого чата.
 *
 * Квадратный логотип, если заведён, — в кружке широкий сжимается в полоску.
 * Логотипа нет или он не загрузился — первая буква названия на фирменном цвете
 * медцентра: пустой кружок ничего бы не сказал.
 *
 * Размер и место задаёт класс снаружи — знак один, а гнёзда у него разные.
 */
export default function MedCenterMark({ medCenter, className = '' }) {
  const [broken, setBroken] = useState(false);
  if (!medCenter) return null;

  const src = fileUrl(medCenter.logoSquareUrl || medCenter.logoUrl);
  const showLogo = Boolean(src) && !broken;

  return (
    <span
      className={`ol-mc-mark ${showLogo ? '' : 'is-letter'} ${className}`}
      style={{ '--ol-mc-color': medCenter.color || 'var(--primary)' }}
      title={medCenter.name}
    >
      {showLogo
        ? <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />
        : (medCenter.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}
