'use strict';

/**
 * Как письмо будет выглядеть в тёмной теме почты (ver. 8.57).
 *
 * ── Зачем это вообще нужно ───────────────────────────────────────────────────
 *
 * Письмо собирают на светлом холсте, и там оно красивое. Дальше Gmail открывает
 * его у получателя с тёмной темой системы и ПЕРЕКРАШИВАЕТ сам — не спрашивая и
 * не глядя на `<meta name="color-scheme" content="light">`, который мы честно
 * ставим в шапке (его уважают Apple Mail и Outlook, Gmail — нет). Светлая
 * карточка становится тёмной, чёрный текст — белым, а вот аккуратная тёмная
 * шапка с белым логотипом выворачивается в светлую, и логотип на ней пропадает.
 * Узнать об этом, отправив письмо себе, можно только после того, как оно уже
 * ушло людям.
 *
 * ── Что именно здесь делается ────────────────────────────────────────────────
 *
 * Это СИМУЛЯЦИЯ, а не второй рендер. На вход приходит готовый HTML из
 * emailRenderer — тот самый, что уйдёт получателям, — и в нём подменяются
 * только цвета. Разметка, отступы, картинки и текст не трогаются вообще: иначе
 * мы показывали бы не то письмо, которое отправляем.
 *
 * Правило подмены одно: у цвета инвертируется светлота, тон и насыщенность
 * остаются. Ровно так ведёт себя Gmail, и именно поэтому фирменный синий в
 * тёмной теме остаётся синим, а белый фон становится почти чёрным. Дальше
 * светлота ужимается в диапазон 8–92%: чистого чёрного и чистого белого в
 * тёмной теме Gmail не бывает, там поверхности серые.
 *
 * ── Чего симуляция не покажет ────────────────────────────────────────────────
 *
 * Точного попадания в пиксель не будет и быть не может: у Gmail, Outlook.com и
 * Apple Mail три разных правила, и меняются они без предупреждения. Задача
 * скромнее и полезнее — увидеть заранее, что тёмная шапка вывернулась, что
 * текст лёг на фон того же тона и что логотип с прозрачностью исчез. Именно на
 * этом письма и ломаются.
 *
 * Картинки не перекрашиваются — их не перекрашивает и почта. PNG с
 * прозрачностью так и останется тёмным по тёмному, и это не ошибка симуляции,
 * а то, что увидит получатель.
 */

// Цвета правим только там, где цвет и может стоять: в атрибутах style, bgcolor
// и color и внутри <style> шапки. Разбирать весь документ регуляркой нельзя —
// «#abc123» встречается и в адресе ссылки, и в тексте письма, и перекрашивать
// его значило бы портить содержимое.
const STYLE_ATTR = /(\sstyle=")([^"]*)(")/gi;
const STYLE_TAG = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi;
const COLOR_ATTR = /(\s(?:bgcolor|color|bordercolor)=")([^"]*)(")/gi;

const HEX = /#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
const RGB = /\brgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)/gi;

// Словесные цвета в письме редки, но white и black попадаются в заготовках, и
// оставлять их светлыми посреди перекрашенного письма нельзя.
const NAMED = {
  white: '#FFFFFF',
  black: '#000000',
  silver: '#C0C0C0',
  gray: '#808080',
  grey: '#808080',
  whitesmoke: '#F5F5F5',
};
// Слово-цвет ловим только там, где цвет и может стоять: сразу после двоеточия,
// запятой или скобки и до конца объявления. Без этой рамки `\bwhite\b`
// попадает в `white-space:nowrap`, и свойство превращается в мусор.
const NAMED_RE = new RegExp(
  `(^|[:,(\\s])(${Object.keys(NAMED).join('|')})(?=$|[;,)"'\\s}])`,
  'gi',
);

// Границы светлоты в тёмной теме. Верхняя не 100, потому что белого текста
// почта не делает — делает очень светло-серый; нижняя не 0 по той же причине.
const MIN_L = 8;
const MAX_L = 92;

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a,
  };
}

function rgbToHsl(r, g, b) {
  const rr = r / 255; const gg = g / 255; const bb = b / 255;
  const max = Math.max(rr, gg, bb); const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0));
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToRgb(h, s, l) {
  const ss = s / 100; const ll = l / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ll - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map(v => Math.round((v + m) * 255));
}

/** Инверсия светлоты с сохранением тона — то, что делает с письмом Gmail. */
function invert({ r, g, b, a = 1 }) {
  const { h, s, l } = rgbToHsl(r, g, b);
  const flipped = 100 - l;
  const clamped = Math.min(MAX_L, Math.max(MIN_L, flipped));
  const [nr, ng, nb] = hslToRgb(h, s, clamped);
  return { r: nr, g: ng, b: nb, a };
}

const toHex = ({ r, g, b }) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** Перекраска одного объявления стилей (содержимого style="..." или <style>). */
function invertDeclarations(css) {
  return String(css)
    .replace(HEX, (match) => {
      const rgb = hexToRgb(match);
      const next = invert(rgb);
      // Полупрозрачность сохраняем в том же восьмизначном виде, в каком пришла.
      if (match.length === 5 || match.length === 9) {
        return `${toHex(next)}${Math.round(rgb.a * 255).toString(16).padStart(2, '0').toUpperCase()}`;
      }
      return toHex(next);
    })
    .replace(RGB, (match, r, g, b, a) => {
      const next = invert({ r: Number(r), g: Number(g), b: Number(b) });
      return a === undefined
        ? `rgb(${next.r}, ${next.g}, ${next.b})`
        : `rgba(${next.r}, ${next.g}, ${next.b}, ${a})`;
    })
    .replace(NAMED_RE, (m, before, name) => before + toHex(invert(hexToRgb(NAMED[name.toLowerCase()]))));
}

/**
 * Готовый HTML письма → тот же HTML, перекрашенный как в тёмной теме почты.
 */
function simulate(html) {
  if (!html) return html;

  let out = String(html)
    .replace(STYLE_ATTR, (m, open, css, close) => open + invertDeclarations(css) + close)
    .replace(STYLE_TAG, (m, open, css, close) => open + invertDeclarations(css) + close)
    .replace(COLOR_ATTR, (m, open, value, close) => open + invertDeclarations(value) + close);

  // Шапка объявляет письмо светлым — в тёмном снимке это неправда, и Apple Mail
  // в предпросмотре по этой строке отказался бы что-либо перекрашивать сам.
  out = out
    .replace(/<meta name="color-scheme" content="light">/i, '<meta name="color-scheme" content="dark">')
    .replace(/<meta name="supported-color-schemes" content="light">/i, '<meta name="supported-color-schemes" content="dark">');

  return out;
}

/**
 * Что в тёмной теме сломается. Считается по документу, а не по HTML: тип блока
 * из разметки уже не вытащить.
 */
function inspect(doc) {
  const warnings = [];
  const blocks = [];
  const walk = (list) => {
    (Array.isArray(list) ? list : []).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      blocks.push(b);
      if (b.type === 'columns') (b.columns || []).forEach(c => walk(c.blocks));
    });
  };
  (Array.isArray(doc?.sections) ? doc.sections : []).forEach((section) => {
    (section?.columns || []).forEach(col => walk(col.blocks));
  });

  // Тёмная полоса — самая частая потеря. В светлом письме это шапка или подвал,
  // и в тёмной теме она станет светлой: белый логотип на ней исчезнет.
  const darkSections = (doc?.sections || []).filter((s) => {
    const bg = String(s?.bg || '').trim();
    if (!/^#[0-9a-f]{3,8}$/i.test(bg)) return false;
    const { r, g, b } = hexToRgb(bg);
    return rgbToHsl(r, g, b).l < 45;
  }).length;
  if (darkSections) {
    warnings.push(`Тёмных полос в письме: ${darkSections}. В тёмной теме Gmail они станут светлыми, и белый текст или логотип на них пропадёт. Надёжнее держать на такой полосе картинку с собственным фоном, а не прозрачный PNG.`);
  }

  const png = blocks.filter(b => /\.png(\?|$)/i.test(String(b.src || ''))).length;
  if (png) {
    warnings.push(`Картинок PNG: ${png}. Если у них прозрачный фон, в тёмной теме под ними окажется тёмная подложка — тёмный логотип на ней не виден. Почта картинки не перекрашивает.`);
  }

  return warnings;
}

module.exports = { simulate, inspect, invertDeclarations };
