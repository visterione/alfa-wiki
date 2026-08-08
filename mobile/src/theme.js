// ── Typography ────────────────────────────────────────────────────────────────
// Inter font family — matches the web frontend
export const font = {
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semiBold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
};

// ── Colors ────────────────────────────────────────────────────────────────────
// Design token system — mirrors the web frontend CSS variables.
//
// Светлая и тёмная палитры описаны одними и теми же ключами: экраны обращаются
// к токенам (bgPrimary, textSecondary), а не к конкретным цветам, поэтому смена
// темы не требует правок в разметке.
export const lightColors = {
  // Primary
  primary: '#007AFF',
  primaryHover: '#0056CC',
  primaryLight: '#E5F2FF',
  secondary: '#5856D6',

  // Semantic
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
  info: '#5AC8FA',

  // Backgrounds
  bgPrimary: '#FFFFFF',
  bgSecondary: '#F5F5F7',
  bgTertiary: '#E8E8ED',

  // Text
  textPrimary: '#1D1D1F',
  textSecondary: '#86868B',
  textTertiary: '#AEAEB2',

  // Borders
  border: '#D2D2D7',
  borderLight: '#E5E5EA',

  // Chat bubbles
  bubbleOwn: '#007AFF',
  bubbleOther: '#FFFFFF',
  bubbleOwnText: '#FFFFFF',
  bubbleOtherText: '#1D1D1F',

  // Header gradient
  headerGradientStart: '#0056CC',
  headerGradientEnd: '#007AFF',
};

// Тёмная палитра. Фоны не чёрные, а тёмно-серые: на OLED чистый чёрный даёт
// заметный ореол вокруг светлого текста и режет глаз в темноте.
export const darkColors = {
  primary: '#0A84FF',
  primaryHover: '#409CFF',
  primaryLight: '#1C3A5E',
  secondary: '#5E5CE6',

  success: '#30D158',
  warning: '#FF9F0A',
  error: '#FF453A',
  info: '#64D2FF',

  bgPrimary: '#1C1C1E',
  bgSecondary: '#121214',
  bgTertiary: '#2C2C2E',

  textPrimary: '#F2F2F7',
  textSecondary: '#98989F',
  textTertiary: '#6E6E73',

  border: '#38383A',
  borderLight: '#2C2C2E',

  bubbleOwn: '#0A6CDB',
  bubbleOther: '#2C2C2E',
  bubbleOwnText: '#FFFFFF',
  bubbleOtherText: '#F2F2F7',

  headerGradientStart: '#0A2A52',
  headerGradientEnd: '#0A4A94',
};

// Фон экрана запуска. Совпадает с splash_background в colors.xml: системный
// экран Android и наш обязаны быть одного цвета, иначе переход между ними
// читается как смена экранов. Не зависит от темы — системный о ней не знает.
export const SPLASH_BACKGROUND = '#0A5BD3';

// ── Акцентные цвета ───────────────────────────────────────────────────────────
//
// У каждого акцента свой оттенок для светлой и тёмной темы: один и тот же цвет
// не может быть читаемым на обоих фонах. Песочный на белом даёт контраст 1.5 —
// текст таким цветом попросту не виден, а белые надписи на кнопке такого цвета
// тем более. Поэтому для светлой темы оттенки затемнены, для тёмной осветлены,
// пока контраст с фоном не дошёл до 4.5 по WCAG.
//
// tint — бледная подложка под иконки и чипы (там, где раньше был primaryLight).
//
// Исключение — синий: он фирменный и остаётся как есть, хотя формально даёт
// 4.02. Менять узнаваемый цвет ради трёх сотых не стоит.
export const ACCENTS = [
  {key: 'blue',     label: 'Синий',      light: '#007AFF', dark: '#0A84FF', tintLight: '#E0EDFB', tintDark: '#1C3854'},
  {key: 'pink',     label: 'Розовый',    light: '#D43685', dark: '#DB67A1', tintLight: '#F9E2ED', tintDark: '#541C38'},
  {key: 'orange',   label: 'Оранжевый',  light: '#AA6613', dark: '#D18E3D', tintLight: '#FBEEE0', tintDark: '#543B1C'},
  {key: 'sand',     label: 'Песочный',   light: '#936E3E', dark: '#E2D1BB', tintLight: '#F4EEE6', tintDark: '#4F3B22'},
  {key: 'lavender', label: 'Лавандовый', light: '#6363EE', dark: '#ACACEC', tintLight: '#E0E0FB', tintDark: '#1C1C54'},
  {key: 'graphite', label: 'Графитовый', light: '#757575', dark: '#999999', tintLight: '#EDEDED', tintDark: '#383838'},
  {key: 'purple',   label: 'Пурпурный',  light: '#730D73', dark: '#D346D3', tintLight: '#FBE0FB', tintDark: '#541C54'},
  {key: 'green',    label: 'Зелёный',    light: '#2D7055', dark: '#3C9471', tintLight: '#E6F5EF', tintDark: '#20503D'},
];

export function accentOption(key) {
  return ACCENTS.find(a => a.key === key) ?? ACCENTS[0];
}

/**
 * Палитра по названию схемы и выбранному акценту.
 *
 * Акцент подменяет только связанные с ним токены — фоны, текст и границы
 * остаются нейтральными. Иначе смена цвета перекрасила бы весь интерфейс.
 *
 * @param {'light'|'dark'} scheme
 * @param {string} accentKey
 */
export function getPalette(scheme, accentKey = 'blue') {
  const base = scheme === 'dark' ? darkColors : lightColors;
  const accent = accentOption(accentKey);
  const main = scheme === 'dark' ? accent.dark : accent.light;
  const tint = scheme === 'dark' ? accent.tintDark : accent.tintLight;

  return {
    ...base,
    primary: main,
    // Наведение и градиенты — тот же цвет на шаг темнее/светлее
    primaryHover: scheme === 'dark' ? accent.light : shade(main, -0.12),
    primaryLight: tint,
    bubbleOwn: main,
    headerGradientStart: scheme === 'dark' ? shade(main, -0.35) : shade(main, -0.18),
    headerGradientEnd: main,
  };
}

/**
 * Затемнить (amount < 0) или осветлить (amount > 0) цвет.
 * Простое смешивание с чёрным или белым — точности тут не требуется.
 */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const ch = i => {
    const v = (n >> (16 - i * 8)) & 0xff;
    return Math.round(v + (mix - v) * k);
  };
  return '#' + [ch(0), ch(1), ch(2)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// Обратная совместимость: часть кода ещё обращается к статичной палитре.
// Это всегда светлая — динамику даёт useTheme().
export const colors = lightColors;

// ── Масштаб шрифта ────────────────────────────────────────────────────────────
// Множитель для текста в чате. Отдельно от системного размера шрифта: люди
// нередко не трогают системные настройки, но в переписке им нужен текст крупнее.
export const fontScales = {
  normal: {key: 'normal', label: 'Обычный', scale: 1},
  large: {key: 'large', label: 'Крупный', scale: 1.15},
  huge: {key: 'huge', label: 'Очень крупный', scale: 1.3},
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  xxl: 24,
};

export const shadow = {
  sm: {
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: {width: 0, height: 1},
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: {width: 0, height: 8},
    elevation: 8,
  },
};
