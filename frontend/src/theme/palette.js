/**
 * Акцентные цвета и их рампа.
 *
 * Набор акцентов один в один повторяет мобильный (mobile/src/theme.js): выбор
 * синхронизируется между приложениями, и значение `purple` обязано означать в
 * браузере ровно тот же цвет, что на телефоне. Правки вносятся сразу в оба
 * файла — общий модуль тут невозможен, у веба и React Native разные сборки.
 *
 * У каждого акцента свой оттенок для светлой и тёмной темы: один и тот же цвет
 * не может быть читаемым на обоих фонах. Песочный на белом даёт контраст 1.5 —
 * текст таким цветом попросту не виден. Поэтому для светлой темы оттенки
 * затемнены, для тёмной осветлены, пока контраст с фоном не дошёл до 4.5 по WCAG.
 *
 * Исключение — синий: он фирменный и остаётся как есть, хотя формально даёт
 * 4.02. Менять узнаваемый цвет ради трёх сотых не стоит.
 */
export const ACCENTS = [
  { key: 'blue', label: 'Синий', light: '#007AFF', dark: '#0A84FF', tintLight: '#E0EDFB', tintDark: '#1C3854' },
  { key: 'pink', label: 'Розовый', light: '#D43685', dark: '#DB67A1', tintLight: '#F9E2ED', tintDark: '#541C38' },
  { key: 'orange', label: 'Оранжевый', light: '#AA6613', dark: '#D18E3D', tintLight: '#FBEEE0', tintDark: '#543B1C' },
  { key: 'sand', label: 'Песочный', light: '#936E3E', dark: '#E2D1BB', tintLight: '#F4EEE6', tintDark: '#4F3B22' },
  { key: 'lavender', label: 'Лавандовый', light: '#6363EE', dark: '#ACACEC', tintLight: '#E0E0FB', tintDark: '#1C1C54' },
  { key: 'graphite', label: 'Графитовый', light: '#757575', dark: '#999999', tintLight: '#EDEDED', tintDark: '#383838' },
  { key: 'purple', label: 'Пурпурный', light: '#730D73', dark: '#D346D3', tintLight: '#FBE0FB', tintDark: '#541C54' },
  { key: 'green', label: 'Зелёный', light: '#2D7055', dark: '#3C9471', tintLight: '#E6F5EF', tintDark: '#20503D' }
];

export const DEFAULT_ACCENT = 'blue';

export function accentOption(key) {
  return ACCENTS.find(a => a.key === key) || ACCENTS[0];
}

/**
 * Затемнить (amount < 0) или осветлить (amount > 0) цвет.
 * Простое смешивание с чёрным или белым — точности тут не требуется.
 */
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const ch = i => {
    const v = (n >> (16 - i * 8)) & 0xff;
    return Math.round(v + (mix - v) * k);
  };
  return '#' + [ch(0), ch(1), ch(2)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Рампа акцента: девять ступеней от бледной подложки до насыщенного текста.
 *
 * Ступени нужны потому, что синий в вёрстке использовался не одним значением, а
 * целой линейкой (#eff6ff под плашками, #3b82f6 на кнопках, #1e40af в заголовках).
 * Свести их к одному --primary значило бы потерять глубину, поэтому вся линейка
 * пересчитывается от выбранного акцента.
 *
 * Направление ступеней в темах противоположное. В светлой чем больше номер, тем
 * цвет темнее: он ложится текстом на белое. В тёмной — наоборот светлее, потому
 * что текст лежит на почти чёрном. Благодаря этому одна и та же пара «фон 50 +
 * текст 700» остаётся читаемой в обеих темах без правок в разметке.
 */
export function accentRamp(scheme, accentKey) {
  const accent = accentOption(accentKey);
  const dark = scheme === 'dark';
  const base = dark ? accent.dark : accent.light;
  const tint = dark ? accent.tintDark : accent.tintLight;

  return dark
    ? {
        50: shade(tint, -0.35),
        100: tint,
        200: shade(tint, 0.12),
        300: shade(base, -0.3),
        400: shade(base, -0.15),
        500: base,
        600: shade(base, 0.14),
        700: shade(base, 0.3),
        800: shade(base, 0.46),
        900: shade(base, 0.62)
      }
    : {
        50: shade(tint, 0.55),
        100: tint,
        200: shade(tint, -0.14),
        300: shade(base, 0.42),
        400: shade(base, 0.2),
        500: base,
        600: shade(base, -0.15),
        700: shade(base, -0.3),
        800: shade(base, -0.45),
        900: shade(base, -0.6)
      };
}

/**
 * CSS-переменные акцента для :root.
 *
 * Пишутся из JavaScript, а не лежат в index.css, потому что зависят от выбора
 * человека. Всё остальное — нейтральные и семантические рампы — статично и
 * живёт в index.css.
 *
 * `prefix` нужен, чтобы рядом с рабочей рампой отдать ещё и светлую: рабочая
 * область страницы остаётся белым листом при любой теме, и акцент внутри неё
 * обязан быть светлым вариантом. Тёмный на белом местами нечитаем — песочный
 * даёт там контраст 1.5.
 */
export function accentVariables(scheme, accentKey, prefix = 'accent') {
  const ramp = accentRamp(scheme, accentKey);
  const vars = {};
  for (const [step, value] of Object.entries(ramp)) {
    vars[`--${prefix}-${step}`] = value;
  }

  vars[`--${prefix}-rgb`] = hexToRgb(ramp[500]).join(', ');

  // Именованные переменные нужны только основной рампе: у светлой копии свои
  // потребители — блок листа в index.css, и он обращается к ступеням напрямую
  if (prefix === 'accent') {
    vars['--primary'] = ramp[500];
    vars['--primary-hover'] = ramp[600];
    vars['--primary-light'] = ramp[100];
    vars['--primary-rgb'] = hexToRgb(ramp[500]).join(', ');

    // Градиент шапки. Тот же цвет на пару шагов темнее — как в мобильном приложении
    vars['--header-gradient-start'] = scheme === 'dark' ? ramp[300] : ramp[700];
    vars['--header-gradient-end'] = ramp[500];
  }

  return vars;
}
