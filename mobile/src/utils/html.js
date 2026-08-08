/**
 * Разбор HTML уроков в плоский список блоков.
 *
 * Уроки пишутся в вебе редактором TipTap и хранятся готовым HTML. На телефоне
 * его нечем показать: WebView в проекте нет, а ставить его ради статьи — это
 * нативная зависимость, отдельный процесс на каждый урок и чужая прокрутка
 * внутри нашей. Поэтому HTML разбирается здесь, а рисуется обычными Text/Image
 * (см. components/HtmlContent) — текст выделяется, тема применяется, прокрутка
 * одна на экран.
 *
 * Разбор намеренно неполный: он покрывает то, что умеет ставить редактор, —
 * абзацы и заголовки, списки, цитаты, код, картинки, видео, ролики YouTube,
 * таблицы и разделители. Незнакомые теги не ломают разметку, а просто отдают
 * своё содержимое дальше.
 *
 * Результат — плоский массив: вложенность в мобильной вёрстке всё равно
 * сводится к отступу, а плоский список рисуется одним проходом.
 *
 *   {type: 'paragraph', align, runs}
 *   {type: 'heading', level, align, runs}
 *   {type: 'list-item', ordered, index, depth, runs}
 *   {type: 'quote', runs}
 *   {type: 'code', text}
 *   {type: 'image', src, alt, width, height}
 *   {type: 'video', src, poster}
 *   {type: 'embed', src}
 *   {type: 'divider'}
 *   {type: 'table', rows: [[{runs, header}]]}
 *
 * runs — куски строки с одинаковым оформлением:
 *   {text, bold, italic, underline, strike, code, link, color, highlight, sup, sub}
 */

// Тег целиком либо комментарий. Кавычки в атрибутах учитываются: в них может
// стоять «>» (например, в data-атрибутах редактора), и без этого тег обрезался
// бы посередине.
const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/g;
const ATTR_RE = /([\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', bdquo: '„',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•',
  deg: '°', plusmn: '±', times: '×', divide: '÷', copy: '©', reg: '®',
  trade: '™', euro: '€', rarr: '→', larr: '←', shy: '',
};

export function decodeEntities(text) {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, code) => {
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : full;
    }
    const known = ENTITIES[code.toLowerCase()];
    return known === undefined ? full : known;
  });
}

function parseAttrs(raw) {
  const attrs = {};
  if (!raw) return attrs;
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(raw))) {
    const value = m[2].replace(/^['"]|['"]$/g, '');
    attrs[m[1].toLowerCase()] = decodeEntities(value);
  }
  return attrs;
}

// Значение свойства из инлайнового style. Регулярка собирается на каждый вызов:
// свойств за урок разбирается немного, а общая с флагом g хранила бы lastIndex
// между вызовами и через раз промахивалась.
function styleProp(style, prop) {
  if (!style) return null;
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'));
  return m ? m[1].trim() : null;
}

function alignOf(attrs) {
  const align = styleProp(attrs.style, 'text-align');
  return align === 'center' || align === 'right' || align === 'justify' ? align : null;
}

// Размер картинки редактор пишет то атрибутом, то в style — берём откуда есть.
// Проценты не переводим: ширину на телефоне всё равно задаёт колонка текста.
function sizeOf(attrs, key) {
  const raw = attrs[key] ?? styleProp(attrs.style, key);
  if (!raw) return null;
  const num = parseFloat(String(raw).replace('px', ''));
  return Number.isFinite(num) && !String(raw).includes('%') ? num : null;
}

const HEADINGS = {h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6};

// Теги, которые начинают новый блок. Всё, чего здесь нет, считается строчным.
const BLOCK_STARTERS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'div',
  'figcaption', 'section', 'article',
]);

/**
 * @param {string} html
 * @returns {Array} блоки для рендера
 */
export function parseHtml(html) {
  const blocks = [];
  if (!html || typeof html !== 'string') return blocks;

  // Оформление копится стопкой: на каждый открытый тег кладётся копия текущего
  // набора с добавленным признаком, на закрывающий — снимается. Так вложенное
  // «жирный внутри ссылки» разбирается само собой.
  const marks = [{}];
  const lists = [];
  // Открытые пункты списка и цитаты. Именно стопка, а не одно значение: внутри
  // них лежат свои <p>, и без стопки текст пункта уходил бы в обычный абзац —
  // редактор всегда заворачивает содержимое пункта в абзац.
  const containers = [];
  let runs = [];
  let block = {type: 'paragraph'};

  // Таблица собирается отдельно: её ячейки — те же строчные куски, но лечь в
  // общий поток они не могут
  let table = null;
  let row = null;
  let cell = null;

  const mark = () => marks[marks.length - 1];

  const target = () => (cell ? cell.runs : runs);

  const pushText = text => {
    if (!text) return;
    const list = target();
    const style = mark();
    const last = list[list.length - 1];
    // Соседние куски с одинаковым оформлением склеиваем: иначе «<b>с</b><b>ло</b>»
    // даст три <Text> подряд, между которыми перенос строки встанет по-своему
    if (last && sameStyle(last, style)) {
      last.text += text;
      return;
    }
    list.push({...style, text});
  };

  const flush = () => {
    if (cell) return;
    const text = runs.map(r => r.text).join('');
    if (text.trim()) {
      const holder = containers[containers.length - 1];
      // Абзац внутри пункта или цитаты — это их содержимое, а не отдельный
      // блок. Заголовок остаётся заголовком: он задан явно.
      const shape = holder && block.type === 'paragraph'
        ? {...holder, align: block.align ?? null}
        : block;
      blocks.push({...shape, runs: trimRuns(runs)});
    }
    runs = [];
    block = {type: 'paragraph'};
  };

  const openCell = header => {
    if (!row) row = [];
    cell = {runs: [], header};
  };

  const closeCell = () => {
    if (!cell) return;
    row.push({runs: trimRuns(cell.runs), header: cell.header});
    cell = null;
  };

  const closeRow = () => {
    closeCell();
    if (table && row && row.length) table.rows.push(row);
    row = null;
  };

  let pos = 0;
  let raw = null; // содержимое <pre>: пробелы и переводы строк в нём значимы
  TAG_RE.lastIndex = 0;
  let m;

  while ((m = TAG_RE.exec(html))) {
    const text = html.slice(pos, m.index);
    pos = TAG_RE.lastIndex;

    if (raw !== null) {
      raw.text += decodeEntities(text);
    } else if (text) {
      // Вне <pre> перевод строки в исходнике — просто перенос в разметке, а не
      // в тексте: абзацы разделяет сам HTML
      const normalized = decodeEntities(text).replace(/\s+/g, ' ');
      // Пробел в начале блока не значит ничего, а отступ рисует
      if (normalized !== ' ' || target().length) pushText(normalized);
    }

    if (m[0].startsWith('<!--')) continue;

    const closing = Boolean(m[1]);
    const tag = m[2].toLowerCase();
    const attrs = closing ? {} : parseAttrs(m[3]);

    if (raw !== null) {
      if (closing && tag === 'pre') {
        blocks.push({type: 'code', text: raw.text.replace(/^\n+|\s+$/g, '')});
        raw = null;
      }
      continue;
    }

    if (!closing) {
      if (openTag(tag, attrs)) continue;
    } else {
      closeTag(tag);
    }
  }

  // Хвост после последнего тега
  const tail = html.slice(pos);
  if (tail) pushText(decodeEntities(tail).replace(/\s+/g, ' '));
  closeRow();
  if (table && table.rows.length) blocks.push(table);
  flush();

  return blocks;

  function openTag(tag, attrs) {
    switch (tag) {
      case 'br':
        pushText('\n');
        return true;
      case 'hr':
        flush();
        blocks.push({type: 'divider'});
        return true;
      case 'img': {
        flush();
        blocks.push({
          type: 'image',
          src: attrs.src || '',
          alt: attrs.alt || '',
          width: sizeOf(attrs, 'width'),
          height: sizeOf(attrs, 'height'),
        });
        return true;
      }
      case 'video':
        flush();
        blocks.push({type: 'video', src: attrs.src || '', poster: attrs.poster || null});
        return true;
      case 'source': {
        // Адрес может стоять не на самом <video>, а во вложенном <source>
        const last = blocks[blocks.length - 1];
        if (last?.type === 'video' && !last.src) last.src = attrs.src || '';
        return true;
      }
      case 'iframe':
        flush();
        blocks.push({type: 'embed', src: attrs.src || ''});
        return true;
      case 'pre':
        flush();
        raw = {text: ''};
        return true;

      case 'ul':
      case 'ol':
        flush();
        lists.push({ordered: tag === 'ol', counter: 0});
        return true;

      case 'table':
        flush();
        table = {type: 'table', rows: []};
        return true;
      case 'tr':
        if (table) {
          closeRow();
          row = [];
        }
        return true;
      case 'td':
      case 'th':
        if (table) openCell(tag === 'th');
        return true;

      default:
        break;
    }

    // Внутри ячейки таблицы блочная разметка ничего не меняет: содержимое
    // ячейки в любом случае рисуется одной строкой
    if (cell && (tag === 'li' || HEADINGS[tag] || tag === 'blockquote' || BLOCK_STARTERS.has(tag))) {
      return true;
    }

    if (tag === 'li') {
      flush();
      // Незакрытый предыдущий пункт: в HTML </li> необязателен
      if (containers[containers.length - 1]?.type === 'list-item') containers.pop();
      const list = lists[lists.length - 1];
      if (list) list.counter += 1;
      containers.push({
        type: 'list-item',
        ordered: Boolean(list?.ordered),
        index: list?.counter ?? 1,
        depth: Math.max(0, lists.length - 1),
      });
      return true;
    }

    if (HEADINGS[tag]) {
      flush();
      block = {type: 'heading', level: HEADINGS[tag], align: alignOf(attrs)};
      return true;
    }

    if (tag === 'blockquote') {
      flush();
      containers.push({type: 'quote'});
      return true;
    }

    if (BLOCK_STARTERS.has(tag)) {
      flush();
      block = {type: 'paragraph', align: alignOf(attrs)};
      return true;
    }

    // Строчное оформление
    const style = {...mark()};
    switch (tag) {
      case 'strong':
      case 'b':
        style.bold = true;
        break;
      case 'em':
      case 'i':
        style.italic = true;
        break;
      case 'u':
      case 'ins':
        style.underline = true;
        break;
      case 's':
      case 'strike':
      case 'del':
        style.strike = true;
        break;
      case 'code':
        style.code = true;
        break;
      case 'sub':
        style.sub = true;
        break;
      case 'sup':
        style.sup = true;
        break;
      case 'a':
        if (attrs.href) style.link = attrs.href;
        break;
      case 'mark':
        style.highlight = attrs['data-color'] || styleProp(attrs.style, 'background-color') || true;
        break;
      default:
        break;
    }
    // Цвет и выделитель редактор вешает на <span style>, а не отдельным тегом
    const color = styleProp(attrs.style, 'color');
    if (color) style.color = color;
    const bg = tag !== 'mark' && styleProp(attrs.style, 'background-color');
    if (bg) style.highlight = bg;

    marks.push(style);
    return true;
  }

  function closeTag(tag) {
    switch (tag) {
      case 'ul':
      case 'ol':
        flush();
        lists.pop();
        return;
      case 'td':
      case 'th':
        closeCell();
        return;
      case 'tr':
        closeRow();
        return;
      case 'table':
        closeRow();
        if (table && table.rows.length) blocks.push(table);
        table = null;
        return;
      case 'br':
      case 'hr':
      case 'img':
      case 'video':
      case 'source':
      case 'iframe':
        return;
      default:
        break;
    }

    if (tag === 'li' || tag === 'blockquote') {
      flush();
      const holder = containers[containers.length - 1];
      const closes = tag === 'li' ? 'list-item' : 'quote';
      if (holder?.type === closes) containers.pop();
      return;
    }

    if (HEADINGS[tag] || BLOCK_STARTERS.has(tag)) {
      flush();
      return;
    }

    // Строчный тег: снимаем последний набор оформления. Проверка на длину
    // страхует от лишнего закрывающего тега в разметке
    if (marks.length > 1) marks.pop();
  }
}

const STYLE_KEYS = [
  'bold', 'italic', 'underline', 'strike', 'code', 'link', 'color',
  'highlight', 'sub', 'sup',
];

function sameStyle(a, b) {
  return STYLE_KEYS.every(k => a[k] === b[k] || (!a[k] && !b[k]));
}

// Пробелы по краям блока не несут смысла, но сдвигают текст и мешают выравниванию
function trimRuns(list) {
  const out = list.filter(r => r.text !== '');
  if (out.length) {
    out[0] = {...out[0], text: out[0].text.replace(/^[ \t]+/, '')};
    const last = out.length - 1;
    out[last] = {...out[last], text: out[last].text.replace(/[ \t]+$/, '')};
  }
  return out.filter(r => r.text !== '');
}

/**
 * Текст урока без разметки — для превью и подсчёта объёма.
 */
export function htmlToPlainText(html) {
  return parseHtml(html)
    .map(b => (b.runs ? b.runs.map(r => r.text).join('') : ''))
    .filter(Boolean)
    .join('\n');
}
