'use strict';

// Сборка страниц вики в один документ Word для печати (ver. 8.99).
//
// Оба печатаемых типа страниц хранятся как HTML: редактор TipTap сохраняет
// HTML, html-страница им и является. Поэтому путь один — разобрать HTML и
// переложить его на абзацы, списки и таблицы docx. Готовый конвертер
// html-to-docx пробовали выбрать первым, но он заброшен с 2023 года и не даёт
// ни оглавления, ни управления картинками, а без того и другого бумажная
// версия теряет смысл. Свой разбор короче, чем кажется: TipTap выдаёт узкий
// набор тегов, а от произвольной html-страницы на бумаге нужны только текст,
// таблицы и картинки — скрипты и вёрстка туда всё равно не переносятся.

const fs = require('fs');
const path = require('path');
const { parseDocument } = require('htmlparser2');
const sharp = require('sharp');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
  TableOfContents, ExternalHyperlink, HeadingLevel, AlignmentType, LevelFormat,
  PageNumber, Footer, BorderStyle, WidthType, ShadingType,
} = require('docx');

const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');
// Части uploads за проверкой доступа (см. server.js). Картинку оттуда в
// документ не кладём, даже если html-страница на неё ссылается: иначе через
// выгрузку можно было бы вынести вложение чужого чата.
const GUARDED_UPLOADS = new Set(['chat-attachments', 'vacancies', 'open-line']);
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

// A4 с полями 2 см: ширина текста 17 см, при 96 dpi это около 640 пикселей.
// Картинку шире Word не ужимает сам — она уходит за поле.
const CONTENT_WIDTH_PX = 640;
// Исходник ужимаем до 1600 пикселей: на 17 см это около 240 dpi, для печати
// с запасом, а документ с полусотней скриншотов не весит сотни мегабайт.
const STORED_WIDTH_PX = 1600;

const FONT = 'Arial';
const MONO_FONT = 'Consolas';
const TEXT_COLOR = '1F2937';
const MUTED_COLOR = '6B7280';
const LINK_COLOR = '0563C1';

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'details',
  'dialog', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'html', 'li', 'main',
  'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul',
  'iframe', 'video', 'audio',
]);

// На бумаге от них ничего не остаётся, а текст внутри (подписи кнопок, опции
// выпадающих списков, код скриптов) только засорил бы документ.
const SKIP_TAGS = new Set([
  'head', 'title', 'meta', 'link', 'script', 'style', 'noscript', 'template',
  'svg', 'canvas', 'button', 'input', 'select', 'textarea', 'option', 'object',
  'embed', 'map', 'source', 'track',
]);

const NAMED_COLORS = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF',
  yellow: 'FFFF00', orange: 'FFA500', purple: '800080', gray: '808080', grey: '808080',
};

// ── Разбор атрибутов ─────────────────────────────────────

function parseStyle(str) {
  const out = {};
  if (!str) return out;
  for (const part of String(str).split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim().replace(/\s*!important$/i, '');
    if (key) out[key] = value;
  }
  return out;
}

// Цвет в hex без решётки, как его ждёт docx. Всё, что не разобрать (var(--…),
// currentColor, hsl), даёт null — и текст остаётся цветом документа: для
// печати это лучше, чем угадывать.
function parseColor(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (NAMED_COLORS[v]) return NAMED_COLORS[v];
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) return m[1].split('').map(c => c + c).join('').toUpperCase();
  m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return m[2] === '00' ? null : m[1].toUpperCase();
  m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return [m[1], m[2], m[3]]
      .map(n => Math.min(255, parseInt(n, 10)).toString(16).padStart(2, '0'))
      .join('').toUpperCase();
  }
  return null;
}

// Размер шрифта в полупунктах. Границы — чтобы заголовок html-страницы в
// 72px не занял на бумаге половину листа.
function parseFontSize(value) {
  const m = String(value || '').trim().match(/^([\d.]+)(px|pt)$/i);
  if (!m) return null;
  const pt = m[2].toLowerCase() === 'pt' ? parseFloat(m[1]) : parseFloat(m[1]) * 0.75;
  if (!pt) return null;
  return Math.round(Math.min(28, Math.max(7, pt)) * 2);
}

function parseAlign(value) {
  switch (String(value || '').trim().toLowerCase()) {
    case 'center': return AlignmentType.CENTER;
    case 'right': case 'end': return AlignmentType.RIGHT;
    case 'justify': return AlignmentType.JUSTIFIED;
    case 'left': case 'start': return AlignmentType.LEFT;
    default: return null;
  }
}

function isHidden(node) {
  if (node.attribs?.hidden !== undefined) return true;
  const style = parseStyle(node.attribs?.style);
  return style.display === 'none' || style.visibility === 'hidden';
}

// ── Картинки ─────────────────────────────────────────────

// Путь к файлу в uploads по src картинки или null. Абсолютный адрес принимаем
// по пути: страницы, скопированные с боя, несут полный https://…/uploads/…,
// и сам файл при этом лежит у нас.
function resolveUploadPath(src) {
  let pathname;
  try {
    pathname = /^https?:\/\//i.test(src) ? new URL(src).pathname : src.split(/[?#]/)[0];
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!pathname.startsWith('/uploads/')) return null;
  const rel = pathname.slice('/uploads/'.length);
  if (GUARDED_UPLOADS.has(rel.split('/')[0])) return null;
  const full = path.resolve(UPLOADS_DIR, rel);
  if (!full.startsWith(UPLOADS_DIR + path.sep)) return null;
  return full;
}

async function readImageSource(src) {
  // data: бывает и без base64 — так снимок html-страницы приносит SVG-иконки
  // (data:image/svg+xml;charset=UTF-8,%3Csvg…), закодированные в адрес.
  const data = String(src).match(/^data:image\/[a-z0-9.+-]+((?:;[^,;]+)*),(.*)$/is);
  if (data) {
    if (/;base64/i.test(data[1])) return Buffer.from(data[2], 'base64');
    try { return Buffer.from(decodeURIComponent(data[2]), 'utf8'); } catch { return null; }
  }
  const file = resolveUploadPath(src);
  if (!file) return null;
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
  return fs.promises.readFile(file);
}

// Word не читает webp и svg, поэтому всё перекладываем в png (если есть
// прозрачность) или jpeg. Заодно поворачиваем по EXIF — фото с телефона
// иначе ложатся на бок.
async function loadImage(src) {
  try {
    const input = await readImageSource(src);
    if (!input) return null;
    const pipeline = sharp(input, { animated: false })
      .rotate()
      .resize({ width: STORED_WIDTH_PX, withoutEnlargement: true });
    const meta = await sharp(input, { animated: false }).metadata();
    const { data, info } = meta.hasAlpha
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
      : await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
    return { data, type: meta.hasAlpha ? 'png' : 'jpg', width: info.width, height: info.height };
  } catch {
    return null;
  }
}

function collectImageSources(node, out) {
  if (node.type === 'tag' && node.name === 'img' && node.attribs?.src) out.add(node.attribs.src);
  for (const child of node.children || []) collectImageSources(child, out);
}

// Загружаем все картинки документа заранее и параллельно понемногу, а разбор
// HTML оставляем синхронным: так в нём не приходится протаскивать async
// через каждую ветку.
async function loadImages(sources, concurrency = 4) {
  const list = [...sources];
  const result = new Map();
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const src = list[next++];
      result.set(src, await loadImage(src));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return result;
}

// Экранный размер: из атрибутов или style, иначе натуральный, и не шире
// доступного места. Натуральный считаем по уже ужатому исходнику, но с
// потолком в ширину текста — шире он всё равно бы не встал.
function imageDisplaySize(node, img, maxWidth) {
  const style = parseStyle(node.attribs?.style);
  const px = (v) => {
    const m = String(v || '').trim().match(/^([\d.]+)(px)?$/i);
    return m ? parseFloat(m[1]) : null;
  };
  const pct = String(style.width || node.attribs?.width || '').trim().match(/^([\d.]+)%$/);
  let width = pct ? maxWidth * parseFloat(pct[1]) / 100 : (px(style.width) || px(node.attribs?.width));
  let height = px(style.height) || px(node.attribs?.height);
  const ratio = img.height / img.width;
  if (!width && height) width = height / ratio;
  if (!width) width = img.width;
  if (!height || width > maxWidth) height = width * ratio;
  if (width > maxWidth) { width = maxWidth; height = width * ratio; }
  return { width: Math.round(width), height: Math.round(height) };
}

// ── Ссылки ───────────────────────────────────────────────

// Ссылки внутри портала (/page/…, /explorer/…) в документе бесполезны без
// адреса сервера. Если PUBLIC_BASE_URL задан — делаем их полными, иначе
// оставляем просто текстом.
function resolveHref(href, baseUrl) {
  const h = String(href || '').trim();
  if (!h || h.startsWith('#') || /^javascript:/i.test(h)) return null;
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h;
  if (h.startsWith('/') && baseUrl) return baseUrl.replace(/\/+$/, '') + h;
  return null;
}

// ── Разбор HTML в блоки docx ─────────────────────────────
//
// Абзац копится как список кусков (текст, перенос, картинка) с их
// оформлением, а в абзац docx превращается только когда встречен блочный
// элемент или закончился контейнер. Так смешанное содержимое вида
// «текст <div>…</div> ещё текст» раскладывается на три абзаца, как в браузере.

const LIST_INDENT = 360;

class Converter {
  constructor({ images, baseUrl }) {
    this.images = images;
    this.baseUrl = baseUrl;
    this.listInstance = 0;
    this.pendingBreak = false;
  }

  convert(html) {
    const dom = parseDocument(String(html || ''), { decodeEntities: true });
    const out = [];
    this.nodes(dom.children, {}, { maxWidth: CONTENT_WIDTH_PX, lists: [] }, out);
    return out;
  }

  // Последовательность узлов одного контейнера.
  nodes(nodes, fmt, ctx, out) {
    let pieces = [];
    const flush = () => {
      if (pieces.length) this.paragraph(pieces, ctx, out, {});
      pieces = [];
    };
    for (const node of nodes || []) {
      if (node.type === 'text') {
        this.text(node.data, fmt, ctx, pieces);
        continue;
      }
      if (node.type !== 'tag') continue;
      const tag = node.name.toLowerCase();
      if (SKIP_TAGS.has(tag) || isHidden(node)) continue;
      if (BLOCK_TAGS.has(tag)) {
        flush();
        this.block(node, tag, fmt, ctx, out);
      } else {
        this.inline(node, tag, fmt, ctx, pieces);
      }
    }
    flush();
  }

  block(node, tag, fmt, ctx, out) {
    const style = parseStyle(node.attribs?.style);
    // Разрыв страницы перед блоком (снимок html-страницы переносит его из
    // break-before: page) достаётся первому абзацу, который блок создаст.
    if (/always|page/.test(style['page-break-before'] || style['break-before'] || '')) this.pendingBreak = true;
    const align = parseAlign(style['text-align'] || node.attribs?.align) || ctx.align;
    const nextFmt = this.formatFor(tag, style, fmt);
    const c = { ...ctx, align };

    if (/^h[1-6]$/.test(tag)) {
      const level = Math.min(4, Number(tag[1]));
      const pieces = [];
      this.children(node, nextFmt, c, pieces);
      this.paragraph(pieces, c, out, { style: `WikiH${level}` });
      return;
    }

    switch (tag) {
      case 'p': case 'dt': case 'summary': case 'figcaption': {
        const pieces = [];
        this.children(node, tag === 'dt' ? { ...nextFmt, bold: true } : nextFmt, c, pieces);
        // Пустой <p></p> — это пустая строка, которую автор поставил для
        // отступа. Сохраняем её, в отличие от пробелов между тегами.
        this.paragraph(pieces, c, out, { keepEmpty: true });
        return;
      }
      case 'ul': case 'ol': {
        this.listInstance += 1;
        const level = Math.min(8, ctx.lists.length);
        const list = { ordered: tag === 'ol', level, instance: this.listInstance };
        this.nodes(node.children, nextFmt, { ...c, lists: [...ctx.lists, list] }, out);
        return;
      }
      case 'li': {
        const list = ctx.lists[ctx.lists.length - 1];
        // Маркер получает только первый абзац пункта, остальные идут
        // с тем же отступом без маркера — так в TipTap выглядит <li><p>…</p><p>…</p></li>.
        const marker = { pending: true };
        const liCtx = { ...c, marker: list ? marker : null };
        this.nodes(node.children, nextFmt, liCtx, out);
        if (list && marker.pending) this.paragraph([], liCtx, out, { keepEmpty: true });
        return;
      }
      case 'blockquote': case 'dd':
        this.nodes(node.children, nextFmt, { ...c, quote: (ctx.quote || 0) + 1, quoteBorder: tag === 'blockquote' }, out);
        return;
      case 'pre': {
        const pieces = [];
        this.children(node, { ...nextFmt, code: true }, { ...c, pre: true }, pieces);
        this.paragraph(pieces, c, out, { keepEmpty: true, code: true });
        return;
      }
      case 'hr':
        out.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } },
          spacing: { before: 120, after: 240 },
        }));
        return;
      case 'table':
        this.table(node, nextFmt, c, out);
        return;
      case 'iframe': case 'video': case 'audio': {
        // Видео на бумаге не показать, но ссылку на него — можно.
        const src = node.attribs?.src || node.children?.find(ch => ch.name === 'source')?.attribs?.src;
        const href = resolveHref(src, this.baseUrl);
        if (!href) return;
        const label = tag === 'audio' ? 'Аудио: ' : 'Видео: ';
        this.paragraph([
          { kind: 'text', text: label, fmt: { ...fmt, color: MUTED_COLOR } },
          { kind: 'text', text: href, fmt: { ...fmt, href } },
        ], c, out, {});
        return;
      }
      default:
        this.nodes(node.children, nextFmt, c, out);
    }
  }

  children(node, fmt, ctx, pieces) {
    for (const child of node.children || []) {
      if (child.type === 'text') this.text(child.data, fmt, ctx, pieces);
      else if (child.type === 'tag' && !SKIP_TAGS.has(child.name) && !isHidden(child)) {
        this.inline(child, child.name.toLowerCase(), fmt, ctx, pieces);
      }
    }
  }

  inline(node, tag, fmt, ctx, pieces) {
    if (tag === 'br') { pieces.push({ kind: 'break' }); return; }
    if (tag === 'img') { this.image(node, fmt, ctx, pieces); return; }
    const style = parseStyle(node.attribs?.style);
    const nextFmt = this.formatFor(tag, style, fmt);
    if (tag === 'a') {
      const href = resolveHref(node.attribs?.href, this.baseUrl);
      if (href) nextFmt.href = href;
    }
    // Блок внутри строчного элемента (<a><div>…</div></a>) — невалидно, но
    // в html-страницах встречается. Отделяем его переносами строки.
    const block = BLOCK_TAGS.has(tag);
    if (block && pieces.length) pieces.push({ kind: 'break' });
    this.children(node, nextFmt, ctx, pieces);
    if (block) pieces.push({ kind: 'break' });
  }

  text(data, fmt, ctx, pieces) {
    if (!data) return;
    if (ctx.pre) {
      const lines = data.replace(/\r\n?/g, '\n').split('\n');
      lines.forEach((line, i) => {
        if (i > 0) pieces.push({ kind: 'break' });
        if (line) pieces.push({ kind: 'text', text: line, fmt, pre: true });
      });
      return;
    }
    pieces.push({ kind: 'text', text: data, fmt });
  }

  image(node, fmt, ctx, pieces) {
    const src = node.attribs?.src;
    const img = src ? this.images.get(src) : null;
    if (!img) {
      // Внешние картинки не скачиваем: сервер ходил бы по произвольным адресам
      // из содержимого страниц. На их месте — пометка, чтобы читатель знал,
      // что здесь что-то было.
      const alt = (node.attribs?.alt || '').trim();
      pieces.push({ kind: 'text', text: alt ? `[Изображение: ${alt}]` : '[Изображение]', fmt: { ...fmt, color: MUTED_COLOR, italics: true } });
      return;
    }
    pieces.push({ kind: 'image', img, size: imageDisplaySize(node, img, ctx.maxWidth), fmt });
  }

  formatFor(tag, style, fmt) {
    const f = { ...fmt };
    switch (tag) {
      case 'b': case 'strong': case 'th': f.bold = true; break;
      case 'i': case 'em': case 'cite': case 'var': f.italics = true; break;
      case 'u': case 'ins': f.underline = true; break;
      case 's': case 'strike': case 'del': f.strike = true; break;
      case 'sub': f.subScript = true; break;
      case 'sup': f.superScript = true; break;
      case 'code': case 'kbd': case 'samp': f.code = true; break;
      case 'mark': f.shading = parseColor(style['background-color']) || 'FFF59D'; break;
      default: break;
    }
    const weight = style['font-weight'];
    if (weight === 'bold' || parseInt(weight, 10) >= 600) f.bold = true;
    if (style['font-style'] === 'italic') f.italics = true;
    if (/underline/.test(style['text-decoration'] || '')) f.underline = true;
    if (/line-through/.test(style['text-decoration'] || '')) f.strike = true;
    const color = parseColor(style.color);
    if (color) f.color = color;
    const background = parseColor(style['background-color'] || style.background);
    if (background && background !== 'FFFFFF') f.shading = background;
    const size = parseFontSize(style['font-size']);
    if (size) f.size = size;
    const family = (style['font-family'] || '').split(',')[0].replace(/["']/g, '').trim();
    if (family && !/^(inherit|initial|sans-serif|serif|monospace|system-ui|-apple-system|var\()/i.test(family)) f.font = family;
    return f;
  }

  paragraph(pieces, ctx, out, { style, keepEmpty, code }) {
    const children = this.runs(pieces);
    if (!children.length && !keepEmpty) return;

    const opts = { children };
    if (style) opts.style = style;
    if (this.pendingBreak) {
      opts.pageBreakBefore = true;
      this.pendingBreak = false;
    }
    if (ctx.align) opts.alignment = ctx.align;

    let left = 0;
    const list = ctx.lists?.[ctx.lists.length - 1];
    if (list && ctx.marker) {
      if (ctx.marker.pending) {
        ctx.marker.pending = false;
        // Каждый список — свой экземпляр нумерации на нулевом уровне, а
        // глубину задаёт отступ абзаца. docx перезапускает счёт только на
        // нулевом уровне, и вложенный список, объявленный уровнем 1, во втором
        // пункте родителя продолжал бы номера первого.
        const reference = `wiki-${list.ordered ? 'ordered' : 'bullet'}-${list.level % 3}`;
        opts.numbering = { reference, level: 0, instance: list.instance };
        opts.indent = { left: LIST_INDENT * (list.level + 1), hanging: LIST_INDENT };
      } else {
        left = LIST_INDENT * (list.level + 1);
      }
    }
    if (ctx.quote) {
      left += 567 * ctx.quote;
      if (ctx.quoteBorder) opts.border = { left: { style: BorderStyle.SINGLE, size: 12, color: 'BFBFBF', space: 8 } };
    }
    if (left) opts.indent = opts.indent ? { ...opts.indent, left: opts.indent.left + left } : { left };
    if (code) {
      opts.shading = { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' };
      opts.spacing = { before: 60, after: 120, line: 240 };
    }
    out.push(new Paragraph(opts));
  }

  // Куски абзаца → ранны docx. Пробелы сворачиваем как браузер: подряд идущие
  // — в один, в начале и конце абзаца и после переноса строки — убираем.
  runs(pieces) {
    const items = [];
    let atLineStart = true;
    for (const piece of pieces) {
      if (piece.kind === 'break') {
        const last = items[items.length - 1];
        if (last?.kind === 'text' && !last.pre) last.text = last.text.replace(/ +$/, '');
        items.push({ kind: 'break', fmt: {} });
        atLineStart = true;
        continue;
      }
      if (piece.kind === 'text') {
        let text = piece.pre ? piece.text : piece.text.replace(/\s+/g, ' ');
        if (!piece.pre && atLineStart) text = text.replace(/^ /, '');
        if (!text) continue;
        items.push({ ...piece, text });
        atLineStart = !piece.pre && text.endsWith(' ');
        continue;
      }
      items.push(piece);
      atLineStart = false;
    }
    // Хвост: пробел в конце и висящие переносы.
    while (items.length) {
      const last = items[items.length - 1];
      if (last.kind === 'break') { items.pop(); continue; }
      if (last.kind === 'text' && !last.pre) {
        last.text = last.text.replace(/ +$/, '');
        if (!last.text) { items.pop(); continue; }
      }
      break;
    }

    // Соседние куски с одной и той же ссылкой собираем в одну гиперссылку.
    const result = [];
    let group = null;
    for (const item of items) {
      const run = this.run(item);
      const href = item.fmt?.href;
      if (href) {
        if (!group || group.href !== href) {
          group = { href, children: [] };
          result.push(group);
        }
        group.children.push(run);
      } else {
        group = null;
        result.push(run);
      }
    }
    return result.map(r => (r instanceof TextRun || r instanceof ImageRun)
      ? r
      : new ExternalHyperlink({ link: r.href, children: r.children }));
  }

  run(item) {
    const f = item.fmt || {};
    if (item.kind === 'image') {
      return new ImageRun({ type: item.img.type, data: item.img.data, transformation: item.size });
    }
    const opts = {};
    if (item.kind === 'break') opts.break = 1;
    else opts.text = item.text;
    if (f.bold) opts.bold = true;
    if (f.italics) opts.italics = true;
    if (f.strike) opts.strike = true;
    if (f.subScript) opts.subScript = true;
    if (f.superScript) opts.superScript = true;
    if (f.size) opts.size = f.size;
    if (f.code) opts.font = MONO_FONT;
    else if (f.font) opts.font = f.font;
    if (f.href) {
      opts.color = LINK_COLOR;
      opts.underline = {};
    } else {
      if (f.color) opts.color = f.color;
      if (f.underline) opts.underline = {};
    }
    if (f.shading) opts.shading = { type: ShadingType.CLEAR, fill: f.shading, color: 'auto' };
    else if (f.code && item.kind === 'text' && !item.pre) opts.shading = { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' };
    return new TextRun(opts);
  }

  table(node, fmt, ctx, out) {
    // pageBreakBefore у абзаца внутри ячейки Word соблюдает не всегда,
    // поэтому разрыв перед таблицей — отдельным пустым абзацем.
    if (this.pendingBreak) {
      this.pendingBreak = false;
      out.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [new TextRun({ text: '', size: 2 })] }));
    }
    const rows = [];
    const collectRows = (n) => {
      for (const child of n.children || []) {
        if (child.type !== 'tag' || isHidden(child)) continue;
        if (child.name === 'tr') rows.push(child);
        else if (['thead', 'tbody', 'tfoot'].includes(child.name)) collectRows(child);
      }
    };
    collectRows(node);
    if (!rows.length) return;

    const cellsOf = (tr) => (tr.children || []).filter(ch => ch.type === 'tag' && (ch.name === 'td' || ch.name === 'th'));
    const columns = Math.max(1, ...rows.map(tr => cellsOf(tr).reduce((n, td) => n + (parseInt(td.attribs?.colspan, 10) || 1), 0)));
    // Картинка в ячейке не должна раздвигать таблицу за поле листа.
    const cellMaxWidth = Math.max(80, Math.floor(ctx.maxWidth / columns) - 16);

    const tableRows = rows.map((tr, rowIndex) => {
      const cells = cellsOf(tr).map(td => {
        const style = parseStyle(td.attribs?.style);
        const isHeader = td.name === 'th';
        const cellFmt = this.formatFor(td.name, style, fmt);
        delete cellFmt.shading;
        const children = [];
        this.nodes(td.children, cellFmt, {
          maxWidth: cellMaxWidth,
          lists: [],
          align: parseAlign(style['text-align'] || td.attribs?.align),
        }, children);
        // Ячейка docx без абзаца — битый файл, Word откажется его открыть.
        if (!children.length) children.push(new Paragraph({}));
        const background = parseColor(style['background-color'] || style.background || td.attribs?.bgcolor);
        const opts = {
          children,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
        };
        const colspan = parseInt(td.attribs?.colspan, 10);
        const rowspan = parseInt(td.attribs?.rowspan, 10);
        if (colspan > 1) opts.columnSpan = colspan;
        // Ширина из style ячейки — для раскладочных таблиц снимка: колонка
        // с фото врача должна остаться узкой, а текст забрать остальное.
        const widthPx = String(style.width || '').match(/^([\d.]+)px$/);
        if (widthPx) opts.width = { size: Math.round(parseFloat(widthPx[1]) * 15), type: WidthType.DXA };
        if (rowspan > 1) opts.rowSpan = rowspan;
        if (background && background !== 'FFFFFF') opts.shading = { type: ShadingType.CLEAR, fill: background, color: 'auto' };
        else if (isHeader) opts.shading = { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' };
        return new TableCell(opts);
      });
      const isHeaderRow = rowIndex === 0 && cellsOf(tr).every(td => td.name === 'th');
      return new TableRow({ children: cells.length ? cells : [new TableCell({ children: [new Paragraph({})] })], tableHeader: isHeaderRow });
    });

    // Сетка карточек из снимка html-страницы (data-print-layout="grid") —
    // таблица только для раскладки, рамки на бумаге превратили бы её в бланк.
    const layoutOnly = node.attribs?.['data-print-layout'] === 'grid';
    const none = { style: BorderStyle.NONE, size: 0, color: 'auto' };
    out.push(new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      ...(layoutOnly && { borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none } }),
    }));
    // Две таблицы подряд без абзаца между ними Word склеивает в одну.
    out.push(new Paragraph({ spacing: { after: 0 } }));
  }
}

// ── Документ ─────────────────────────────────────────────

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

function formatDate(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function formatTime(date) {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// По определению на каждую глубину (по кругу из трёх): вид маркера и формат
// номера зависят от глубины, а используется всегда только нулевой уровень —
// см. Converter.paragraph.
function numberingConfig() {
  const bullets = ['•', '◦', '▪'];
  const formats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
  const level = (format, text) => [{
    level: 0,
    format,
    text,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: LIST_INDENT, hanging: LIST_INDENT } } },
  }];
  return [0, 1, 2].flatMap(depth => [
    { reference: `wiki-bullet-${depth}`, levels: level(LevelFormat.BULLET, bullets[depth]) },
    { reference: `wiki-ordered-${depth}`, levels: level(formats[depth], '%1.') },
  ]);
}

function headingStyle(size, before) {
  return {
    run: { font: FONT, size, bold: true, color: '111827' },
    paragraph: { spacing: { before, after: 120 }, keepNext: true, keepLines: true },
  };
}

// Заголовки внутри страниц — отдельные стили без уровня структуры. В
// оглавление и в область навигации Word попадают только папки и страницы:
// с заголовками содержимого оглавление полусотни страниц заняло бы десяток
// листов.
function contentHeadingStyles() {
  const sizes = { 1: 28, 2: 26, 3: 24, 4: 22 };
  return Object.entries(sizes).map(([level, size]) => ({
    id: `WikiH${level}`,
    name: `Заголовок в тексте ${level}`,
    basedOn: 'Normal',
    next: 'Normal',
    quickFormat: true,
    run: { font: FONT, size, bold: true, color: TEXT_COLOR },
    paragraph: { spacing: { before: 240, after: 100 }, keepNext: true, keepLines: true },
  }));
}

/**
 * Собрать документ.
 * @param {object} opts
 * @param {Array} opts.entries — по порядку: { kind: 'folder', title, level }
 *   или { kind: 'page', title, level, contentHtml, updatedAt }; level с нуля.
 * @param {string} opts.siteName
 * @param {string} opts.generatedBy — кто выгрузил, печатается на титуле
 * @param {Date} opts.generatedAt
 * @param {string} [opts.baseUrl] — адрес портала для внутренних ссылок
 * @returns {Promise<Buffer>}
 */
async function buildPrintDocument({ entries, siteName, generatedBy, generatedAt = new Date(), baseUrl }) {
  const sources = new Set();
  const doms = new Map();
  for (const entry of entries) {
    if (entry.kind !== 'page') continue;
    const dom = parseDocument(String(entry.contentHtml || ''), { decodeEntities: true });
    doms.set(entry, dom);
    collectImageSources(dom, sources);
  }
  const images = await loadImages(sources);
  const converter = new Converter({ images, baseUrl });

  const pageCount = entries.filter(e => e.kind === 'page').length;
  const children = [
    new Paragraph({ spacing: { before: 3600, after: 240 }, children: [new TextRun({ text: siteName, size: 48, bold: true, color: '111827' })] }),
    new Paragraph({ spacing: { after: 960 }, children: [new TextRun({ text: 'Материалы для печати', size: 32, color: MUTED_COLOR })] }),
    new Paragraph({ children: [new TextRun({ text: `Страниц: ${pageCount}`, color: MUTED_COLOR })] }),
    new Paragraph({ children: [new TextRun({ text: `Сформировано ${formatDate(generatedAt)}`, color: MUTED_COLOR })] }),
    ...(generatedBy ? [new Paragraph({ children: [new TextRun({ text: `Выгрузил: ${generatedBy}`, color: MUTED_COLOR })] })] : []),
    new Paragraph({
      pageBreakBefore: true,
      spacing: { after: 240 },
      children: [new TextRun({ text: 'Содержание', size: 32, bold: true, color: '111827' })],
    }),
    new TableOfContents('Содержание', { hyperlink: true, headingStyleRange: '1-6' }),
  ];

  // Каждая страница начинается с нового листа. Заголовок папки делит лист с
  // первой страницей папки — иначе на бумаге оставались бы листы с одной
  // строкой. Поэтому разрыв ставим перед первым заголовком после содержимого.
  let sheetHasContent = true;
  for (const entry of entries) {
    const heading = HEADINGS[Math.min(entry.level, HEADINGS.length - 1)];
    children.push(new Paragraph({ heading, pageBreakBefore: sheetHasContent, text: entry.title }));
    sheetHasContent = false;
    if (entry.kind !== 'page') continue;

    // У html-страницы со снимком данные живые — расписания и цены из МИС на
    // бумаге устаревают, поэтому время снимка печатаем рядом с датой правки.
    const meta = `Обновлено ${formatDate(entry.updatedAt)}` + (entry.dataAt ? ` · данные на ${formatDate(entry.dataAt)} ${formatTime(entry.dataAt)}` : '');
    if (!entry.hideMeta) {
      children.push(new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: meta, size: 18, color: MUTED_COLOR })],
      }));
    }
    const blocks = [];
    // Каждая страница вики и так начинается с нового листа — несработавший
    // разрыв из прошлой страницы сюда не переносим.
    converter.pendingBreak = false;
    converter.nodes(doms.get(entry).children, {}, { maxWidth: CONTENT_WIDTH_PX, lists: [] }, blocks);
    if (blocks.length) children.push(...blocks);
    else children.push(new Paragraph({ children: [new TextRun({ text: 'На странице нет содержимого для печати.', italics: true, color: MUTED_COLOR })] }));
    sheetHasContent = true;
  }

  const doc = new Document({
    creator: generatedBy || siteName,
    title: `${siteName} — материалы для печати`,
    // Оглавление в docx — поле, которое заполняет сам Word. С этим флагом он
    // предлагает обновить поля при открытии; без него оглавление пустое.
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: FONT, size: 22, color: TEXT_COLOR }, paragraph: { spacing: { after: 120, line: 276 } } },
        heading1: headingStyle(34, 0),
        heading2: headingStyle(30, 240),
        heading3: headingStyle(28, 240),
        heading4: headingStyle(26, 200),
        heading5: headingStyle(24, 200),
        heading6: headingStyle(24, 200),
      },
      paragraphStyles: contentHeadingStyles(),
    },
    numbering: { config: numberingConfig() },
    sections: [{
      properties: {
        titlePage: true,
        page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } },
      },
      footers: {
        first: new Footer({ children: [new Paragraph({})] }),
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: ['Стр. ', PageNumber.CURRENT, ' из ', PageNumber.TOTAL_PAGES], size: 18, color: MUTED_COLOR })],
          })],
        }),
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = {
  buildPrintDocument,
  // Для тестов
  Converter, parseColor, parseStyle, resolveUploadPath, resolveHref,
};
