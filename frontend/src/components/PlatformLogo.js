import React, { useState } from 'react';
import { getPlatformLogo } from '../utils/reviewConstants';

/**
 * Значок площадки отзыва — рядом с её названием, не вместо него.
 *
 * Названия площадок сеть читает каждый день, и логотип нужен не для узнавания,
 * а для скорости: на доске карточку оценивают за полсекунды, и цветной кружок
 * находится взглядом раньше, чем серая подпись под именем пациента.
 *
 * Если площадки нет в списке или файл не загрузился — не показываем ничего.
 * Отсутствие знака у редкой площадки задумано (см. PLATFORM_LOGOS), а дырка с
 * битой картинкой в строке подписей выглядела бы поломкой.
 */
function PlatformLogo({ name, size = 14 }) {
  // Храним не флаг, а сам сломавшийся адрес: карточки в списке переиспользуют
  // React-узлы, и флаг «не загрузилось» после прокрутки погасил бы знак у
  // соседней площадки, с которой всё в порядке.
  const [brokenSrc, setBrokenSrc] = useState(null);

  const src = getPlatformLogo(name);
  if (!src || src === brokenSrc) return null;

  return (
    <img
      className="platform-logo"
      src={src}
      alt=""
      draggable={false}
      onError={() => setBrokenSrc(src)}
      style={{
        width: size,
        height: size,
        // Оформление держим здесь, а не в трёх местах: знак одинаков на доске,
        // в архиве и в статистике, и разъезжаться ему незачем.
        objectFit: 'contain',
        borderRadius: 3,
        flexShrink: 0,
        verticalAlign: 'text-bottom'
      }}
    />
  );
}

export default PlatformLogo;
