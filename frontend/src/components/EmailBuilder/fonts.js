/**
 * Шрифты писем — тот же список, что в backend/services/emailFonts.js.
 *
 * Повторён здесь по той же причине, что и градиенты: рендерер живёт на сервере
 * и в браузер не попадает, а холст обязан показывать то же, что уедет
 * получателю. Ключи и стеки должны совпадать дословно — правишь один файл,
 * правь и второй.
 */

export const FONTS = {
  system: { label: 'Системный', stack: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  arial: { label: 'Arial', stack: "Arial, Helvetica, sans-serif" },
  verdana: { label: 'Verdana', stack: "Verdana, Geneva, sans-serif" },
  tahoma: { label: 'Tahoma', stack: "Tahoma, Verdana, sans-serif" },
  trebuchet: { label: 'Trebuchet MS', stack: "'Trebuchet MS', Tahoma, sans-serif" },
  georgia: { label: 'Georgia', stack: "Georgia, 'Times New Roman', serif" },
  times: { label: 'Times New Roman', stack: "'Times New Roman', Times, serif" },
  courier: { label: 'Courier New', stack: "'Courier New', Courier, monospace" },

  montserrat: { label: 'Montserrat', web: 'Montserrat:wght@400;700', stack: "'Montserrat', 'Trebuchet MS', Arial, sans-serif" },
  roboto: { label: 'Roboto', web: 'Roboto:wght@400;700', stack: "'Roboto', Arial, Helvetica, sans-serif" },
  opensans: { label: 'Open Sans', web: 'Open+Sans:wght@400;700', stack: "'Open Sans', Arial, Helvetica, sans-serif" },
  lato: { label: 'Lato', web: 'Lato:wght@400;700', stack: "'Lato', Tahoma, Arial, sans-serif" },
  ptserif: { label: 'PT Serif', web: 'PT+Serif:wght@400;700', stack: "'PT Serif', Georgia, 'Times New Roman', serif" },
  playfair: { label: 'Playfair Display', web: 'Playfair+Display:wght@400;700', stack: "'Playfair Display', Georgia, 'Times New Roman', serif" },
};

export const SAFE_FONT_KEYS = Object.keys(FONTS).filter(k => !FONTS[k].web);
export const WEB_FONT_KEYS = Object.keys(FONTS).filter(k => FONTS[k].web);

export const fontStack = (key) => (FONTS[key] || FONTS.system).stack;

/**
 * Подгружает веб-шрифты в саму страницу конструктора.
 *
 * Без этого холст показывал бы Montserrat системным шрифтом: браузер портала о
 * нём не знает, гарнитуру подключает само письмо. Ссылка добавляется один раз
 * на шрифт и остаётся — снимать её при смене шрифта незачем, она ничего не
 * весит, а вернуться к прежнему шрифту человек может через секунду.
 */
const loaded = new Set();

export const ensureWebFont = (key) => {
  const font = FONTS[key];
  if (!font?.web || loaded.has(key) || typeof document === 'undefined') return;
  loaded.add(key);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${font.web}&display=swap`;
  document.head.appendChild(link);
};

/**
 * Собирает шрифты, которыми пользуется документ, и подгружает их разом.
 *
 * Обходит обе раскладки документа. Со второй версии (ver. 8.43) блоки лежат в
 * секциях и колонках, а плоский design.blocks остался только у писем первой
 * версии. Пока обход шёл по одному design.blocks, шрифт, назначенный ОТДЕЛЬНОМУ
 * блоку, не подгружался вовсе: на холсте заголовок показывался запасным
 * шрифтом, и человек правил письмо, не видя настоящей гарнитуры.
 */
export const ensureDocumentFonts = (design) => {
  if (!design) return;
  ensureWebFont(design.settings?.font);
  const walk = (list) => (Array.isArray(list) ? list : []).forEach((b) => {
    if (!b) return;
    ensureWebFont(b.font);
    if (b.type === 'columns') (b.columns || []).forEach(c => walk(c.blocks));
  });
  walk(design.blocks);
  (Array.isArray(design.sections) ? design.sections : []).forEach((section) => {
    (section?.columns || []).forEach(col => walk(col.blocks));
  });
};
