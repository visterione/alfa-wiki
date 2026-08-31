/**
 * Фоны переписки.
 *
 * Узоры повторяют мобильные один в один (mobile/src/components/ChatBackground.js):
 * выбор синхронизируется, и «Соты» на телефоне и в браузере обязаны быть одними
 * и теми же сотами. Правки вносятся сразу в оба файла.
 *
 * Рисуются вектором, а не картинками: файл не нужно хранить в двух плотностях,
 * он ничего не весит и перекрашивается под тему одним параметром. В вебе узор
 * уезжает в data-URI и подставляется в background-image — CSS не умеет красить
 * внешний SVG, поэтому цвет вшивается в разметку при сборке строки.
 *
 * Все узоры намеренно малоконтрастные: они лежат под текстом, и любая пестрота
 * бьёт по читаемости. Часть узоров — про медицину: это фон рабочего мессенджера
 * клиники, и профиль организации в оформлении уместнее абстрактных ромбов.
 */

// Непрозрачность узора. Разная для тем: на тёмном фоне тот же контраст
// выглядит заметно грубее, чем на светлом.
const PATTERN_OPACITY = { light: 0.055, dark: 0.075 };

// Шестиугольник с плоским верхом и стороной s, вписанный центром в (cx, cy)
function hexagon(cx, cy, s) {
  const h = s * 0.866; // s·√3/2 — половина высоты
  return `M${cx - s} ${cy} L${cx - s / 2} ${cy - h} L${cx + s / 2} ${cy - h} ` +
    `L${cx + s} ${cy} L${cx + s / 2} ${cy + h} L${cx - s / 2} ${cy + h} Z`;
}

/**
 * Содержимое одной плитки.
 *
 * Фигуры либо целиком помещаются внутрь плитки, либо доходят до её края ровно
 * там же, где начинаются с противоположной стороны, — иначе на стыках появятся
 * обрывы.
 *
 * weight — поправка к непрозрачности. Залитые фигуры при одинаковом значении
 * выглядят плотнее контурных, и без поправки одни узоры лезли бы в глаза,
 * а другие терялись.
 */
export const CHAT_BACKGROUNDS = [
  { key: 'plain', label: 'Без узора' },
  {
    key: 'dots', label: 'Точки', tile: [20, 20],
    tile_svg: c => `<circle cx="10" cy="10" r="1.6" fill="${c}"/>`
  },
  {
    key: 'hex', label: 'Соты', tile: [30, 17.32],
    // Соты складываются из двух рядов со сдвигом на полшага. Шестиугольники
    // по углам плитки дорисовываются соседними плитками
    tile_svg: c => `<g stroke="${c}" stroke-width="1" fill="none">` +
      [[0, 0], [30, 0], [0, 17.32], [30, 17.32], [15, 8.66]]
        .map(([x, y]) => `<path d="${hexagon(x, y, 10)}"/>`).join('') + '</g>'
  },
  {
    key: 'waves', label: 'Волны', tile: [20, 20],
    tile_svg: c => `<path d="M0 14 Q5 8 10 14 T20 14" stroke="${c}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`
  },
  {
    key: 'confetti', label: 'Конфетти', tile: [48, 48],
    tile_svg: c => `<g stroke="${c}" stroke-width="1.6" stroke-linecap="round" fill="none">` +
      ['M6 8 L12 4', 'M20 6 L24 12', 'M36 4 L40 10', 'M4 22 L8 28', 'M18 24 L24 22',
       'M32 26 L36 20', 'M8 38 L14 42', 'M24 40 L28 34', 'M38 36 L42 42']
        .map(d => `<path d="${d}"/>`).join('') + '</g>' +
      [[30, 14, 1.4], [14, 18, 1.2], [44, 26, 1.2], [20, 34, 1.4]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join('')
  },
  {
    key: 'pulse', label: 'Кардиограмма', tile: [60, 28],
    // Линия входит и выходит на одной высоте — иначе на стыке плиток
    // получилась бы ступенька
    tile_svg: c => `<path d="M0 20 H14 L17 19 L20 8 L23 26 L26 16 L29 20 H42 L45 15 L47 20 H60" ` +
      `stroke="${c}" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
  },
  {
    key: 'care', label: 'Забота', tile: [44, 44],
    tile_svg: c => `<g stroke="${c}" fill="none" stroke-linecap="round" stroke-linejoin="round">` +
      '<path d="M22 34 C22 34 8 25.5 8 16 C8 11.6 11.4 8 15.6 8 C18.2 8 20.7 9.4 22 11.6 ' +
      'C23.3 9.4 25.8 8 28.4 8 C32.6 8 36 11.6 36 16 C36 25.5 22 34 22 34 Z" stroke-width="1.3"/>' +
      '<path d="M12 19 H17 L19.5 14 L22.5 24 L25 19 H32" stroke-width="1.2"/></g>'
  },
  {
    key: 'crosses', label: 'Медкресты', tile: [40, 40], weight: 0.85,
    tile_svg: c => `<g fill="${c}">` +
      [[8.2, 5, 3.6, 10], [5, 8.2, 10, 3.6], [28.2, 25, 3.6, 10], [25, 28.2, 10, 3.6]]
        .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.3"/>`).join('') + '</g>'
  },
  {
    key: 'pills', label: 'Таблетки', tile: [56, 56],
    tile_svg: c => `<g stroke="${c}" stroke-width="1.3" fill="none">` +
      '<g transform="rotate(-35 15 15)"><rect x="4" y="10" width="22" height="10" rx="5"/><path d="M15 10 V20"/></g>' +
      '<g transform="rotate(30 44 10)"><rect x="36" y="6" width="16" height="8" rx="4"/><path d="M44 6 V14"/></g>' +
      '<circle cx="40" cy="38" r="8.5"/><path d="M31.5 38 H48.5"/>' +
      '<circle cx="12" cy="44" r="6"/><path d="M6 44 H18"/></g>'
  }
];

export function chatBackground(key) {
  return CHAT_BACKGROUNDS.find(b => b.key === key) || CHAT_BACKGROUNDS[0];
}

/**
 * Узор как значение background-image.
 *
 * @param {string} key      выбранный узор
 * @param {string} color    цвет линий — обычно основной цвет текста темы
 * @param {'light'|'dark'} scheme
 * @param {number} boost    усиление для образца в настройках: в настоящей
 *                          бледности на маленьком квадрате все варианты
 *                          выглядели бы одинаково пустыми
 */
export function patternImage(key, color, scheme, boost = 1) {
  const bg = chatBackground(key);
  if (!bg.tile) return 'none';

  const [w, h] = bg.tile;
  const opacity = Math.min(1, (PATTERN_OPACITY[scheme] || PATTERN_OPACITY.light) * (bg.weight || 1) * boost);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<g opacity="${opacity.toFixed(3)}">${bg.tile_svg(color)}</g></svg>`;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
