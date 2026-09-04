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
    // Тёмная тема отличается не только цветами: у стекла в ней другая
    // прозрачность, другой блик и другая тень. Экраны получают палитру функцией
    // makeStyles(c) и о схеме иначе не узнают — поэтому она едет вместе с ней.
    isDark: scheme === 'dark',
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

// ── Оформление переписки ──────────────────────────────────────────────────
//
// Рецепты поверхностей чата. Повторяют веб один в один: там они лежат разделом
// «ОБЩЕЕ ОФОРМЛЕНИЕ: стекло и тактильные контролы — переписка» в конце
// frontend/src/pages/Dashboard.css. Правки вносятся сразу в оба файла — общего
// модуля тут быть не может, у веба и React Native разные сборки.
//
// Скругление и срезанный угол обязаны совпадать с браузером до пикселя: одна и
// та же переписка открывается и там, и там, и разъехавшийся угол читается как
// две разные программы.
export const chatSurface = {
  bubbleRadius: 18,
  // Угол со стороны говорящего срезан — он и указывает, чей это пузырь
  bubbleTail: 6,

  // Чужой пузырь приподнят над лентой: тень мягкая и почти без смещения, иначе
  // на длинной переписке из неё складывается серая рябь.
  bubbleOtherShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: {width: 0, height: 3},
    elevation: 2,
  },
};

/**
 * Тень своего пузыря и кнопки отправки — красится акцентом, а не чёрным.
 * Чёрная тень под насыщенной заливкой выглядит грязью, цветная читается как
 * свечение самого материала. То же самое в вебе через rgba(--primary-rgb).
 *
 * @param {string} accent — основной цвет темы (palette.primary)
 */
export function accentShadow(accent) {
  return {
    shadowColor: accent,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: {width: 0, height: 4},
    elevation: 3,
  };
}

/**
 * Блик по верхней кромке акцентной поверхности: свой пузырь и кнопка отправки.
 * Кладётся отдельным слоем поверх заливки, а не подмешивается в цвет, — цвет
 * тут личный, его выбирает человек, и подмешивать пришлось бы в каждый из
 * восьми акцентов.
 *
 * Свет падает сверху в обеих темах, поэтому слои не переворачиваются: белый
 * сверху, чёрный снизу. В вебе тот же приём — color-mix с белым и чёрным, а не
 * ступени рампы, которые в тёмной теме идут в обратную сторону.
 */
export const ACCENT_SHEEN = {
  colors: ['rgba(255,255,255,0.14)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.07)'],
  locations: [0, 0.58, 1],
};

/**
 * Цвет с прозрачностью. Нужен там, где в вебе стоит color-mix с акцентом:
 * акцент личный, литералом его не написать, а без прозрачности подложка цитаты
 * и кромка вокруг неё выходят плотнее самого текста.
 *
 * @param {string} hex — цвет вида #RRGGBB
 * @param {number} alpha — от 0 до 1
 */
export function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}

/**
 * Приподнятая карточка: список участников, полоса вкладок, строки галереи.
 * Тот же материал, что у чужого пузыря, — в вебе это `--msg-bubble-*` из
 * раздела оформления в конце Dashboard.css.
 */
export function cardSurface(c) {
  return {
    backgroundColor: c.bgPrimary,
    borderWidth: 1,
    borderColor: c.borderLight,
    ...chatSurface.bubbleOtherShadow,
  };
}


// ── Стекло и объём: склад (ver. 7.77) ─────────────────────────────────────────
//
// Тот же язык, что в вебе после 7.73–7.75, и тот же, что у переписки выше:
// поверхность не рисуется цветом, а собирается из четырёх слоёв — полупрозрачной
// заливки, светлой кромки, блика по верхней грани и мягкой тени. Разница с
// чатом одна: там стекло лежало на ленте сообщений, здесь ему нужна своя
// подложка, иначе прозрачности не сквозь что смотреть.
//
// Настоящее размытие (BlurView) стоит дорого и кладётся только на слои, которые
// лежат ПОВЕРХ содержимого: шторка, нижняя панель, липкая строка. Карточки в
// длинных списках размытия не получают — тридцать проходов блюра на прокрутке
// роняют её на Android, а разницы в них почти не видно. Проверено там же, где
// обод колеса разделов (см. AlfaTabBar).

/**
 * Подложка модуля: фон, на котором стекло вообще имеет смысл.
 *
 * Красится акцентом человека, а не собственным цветом склада: акцент выбирают в
 * оформлении (ver. 7.60), и модуль с чужим оттенком читался бы как чужая
 * программа. Насыщенность нарочно на грани различимости — это фон, а не пятно.
 */
export function glassBackdrop(c) {
  return {
    colors: [
      withAlpha(c.primary, c.isDark ? 0.22 : 0.14),
      withAlpha(c.primary, c.isDark ? 0.06 : 0.04),
      c.bgSecondary,
    ],
    locations: [0, 0.4, 1],
  };
}

/**
 * Стеклянная поверхность: карточка, строка списка, шапка блока.
 *
 * Кромка светлая в обеих темах, но с разной силой: в светлой она почти белая и
 * читается как фаска, в тёмной — едва заметный волосок, потому что белая рамка
 * на тёмном стекле выглядит наклейкой.
 */
export function glassSurface(c) {
  return {
    backgroundColor: withAlpha(c.bgPrimary, c.isDark ? 0.55 : 0.72),
    borderWidth: 1,
    borderColor: c.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.75)',
    shadowColor: '#000',
    shadowOpacity: c.isDark ? 0.32 : 0.07,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 5},
    elevation: 3,
  };
}

/**
 * Плотное стекло — для того, что лежит поверх содержимого и обязано его
 * заглушить: шторка, нижняя панель, форма операции. Под ним стоит BlurView, но
 * заливка держит читаемость и там, где размытие выключено системной настройкой
 * «Уменьшение прозрачности».
 */
export function glassOverlay(c) {
  return {
    backgroundColor: withAlpha(c.bgPrimary, c.isDark ? 0.78 : 0.86),
    borderColor: c.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.8)',
  };
}

/** Тип размытия для BlurView под стеклом: у тёмной темы своё. */
export const blurKind = c => (c.isDark ? 'dark' : 'light');

/**
 * Блик по верхней грани поверхности. Кладётся отдельным слоем поверх заливки —
 * подмешать его в цвет нельзя: заливка полупрозрачная, и свет должен идти
 * поверх того, что сквозь неё видно.
 *
 * Свет падает сверху в обеих темах, поэтому слои не переворачиваются.
 */
export function glassSheen(c) {
  return {
    colors: c.isDark
      ? ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)']
      : ['rgba(255,255,255,0.75)', 'rgba(255,255,255,0)'],
    locations: [0, 0.6],
  };
}

/**
 * Тактильная кнопка: заливка не плоская, а с перепадом сверху вниз, и тень под
 * ней цветная. Ровно тот же приём, что у кнопки отправки в переписке
 * (accentShadow + ACCENT_SHEEN) — там он уже прижился.
 */
export function tactileButton(c) {
  return {
    colors: [c.primary, c.primaryHover],
    shadow: accentShadow(c.primary),
  };
}

/**
 * Разделитель внутри стеклянной карточки.
 *
 * Не токен border из палитры: сплошная серая линия на полупрозрачном материале
 * читается как приклеенная сверху, а не как грань между строками. Здесь линия
 * того же рода, что и сама поверхность, — просто тень или свет в её толще.
 */
export const glassLine = c => (c.isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)');

/**
 * Капсула состояния: статус прибора, срок годности, счётчик. Цвет приходит
 * снаружи (у статусов он свой), здесь только материал — заливка в четверть силы
 * и кромка того же цвета.
 */
export function glassChip(c, color) {
  return {
    backgroundColor: withAlpha(color, c.isDark ? 0.22 : 0.14),
    borderWidth: 1,
    borderColor: withAlpha(color, c.isDark ? 0.35 : 0.28),
  };
}
