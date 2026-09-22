'use strict';

/**
 * Разбор содержимого письма (ver. 8.58).
 *
 * Здесь три задачи, и все три влияют на то, каким получится поиск.
 *
 * Первая — отрезать процитированную переписку. В деловой почте цитата занимает
 * бо́льшую часть тела: ветка из двадцати писем содержит одни и те же строки
 * двадцать раз. Если индексировать как есть, любой запрос выдаёт одну и ту же
 * переписку двадцатью одинаковыми строками, и поиском перестают пользоваться.
 *
 * Вторая — привести HTML к тексту. Индексировать надо слова, а не разметку.
 *
 * Третья — подготовить HTML к показу. Письмо приходит от постороннего, и его
 * разметка не должна ни расползтись по интерфейсу портала, ни сходить за
 * картинкой на чужой сервер: картинка размером в пиксель — это отчёт
 * отправителю о том, что письмо открыли, и кем.
 */

const sanitizeHtml = require('sanitize-html');

// Версия профиля очистки. Лежит рядом с очищенным HTML в базе: когда правила
// станут строже, по ней видно, какие письма пересчитать, не перебирая все.
const SANITIZER_VERSION = 1;

// ── Цитаты ────────────────────────────────────────────────────────────────

/**
 * Строки, ниже которых начинается чужой текст. Проверяются по одной, но вместе
 * со следующей: вступление к цитате часто переносится на две строки —
 * «В пн, 12 июн. 2023 г. в 14:32,\nИван Петров <i@x.ru> написал(а):».
 */
const CUT_PATTERNS = [
  // Gmail и почти все русские клиенты.
  /^\s*(?:В|в)\s+.{0,160}?(?:написал|написала|пишет|wrote)\s*\(?\s*а?\s*\)?\s*:\s*$/i,
  /^\s*(?:пн|вт|ср|чт|пт|сб|вс)[,.]?\s+\d{1,2}\s+\S+\.?\s+\d{4}.{0,160}?(?:написал|пишет|wrote)/i,
  /^\s*On\s+.{0,200}?\s+wrote\s*:\s*$/i,
  // Outlook и Mail.ru.
  /^\s*-{2,}\s*(?:Original Message|Исходное сообщение|Пересылаемое сообщение|Forwarded message|Начало пересылаемого сообщения)\s*-{2,}\s*$/i,
  /^\s*-{3,}\s*Пересылаемое сообщение\s*-{3,}\s*$/i,
  // Горизонтальная черта, которой Outlook отделяет цитату.
  /^\s*_{10,}\s*$/,
];

// Шапка процитированного письма в русском Outlook: «От:», следом «Кому:» или
// «Тема:». Одна строка «От:» сама по себе встречается в живом тексте, поэтому
// нужен именно блок.
const OUTLOOK_HEADER = /^\s*(?:От|From)\s*:\s*\S/i;
const OUTLOOK_HEADER_NEXT = /^\s*(?:Кому|Отправлено|Тема|Копия|Sent|To|Subject|Cc)\s*:/i;

/** Подпись по RFC 3676: строка из двух дефисов и пробела. */
const SIGNATURE = /^--\s?$/;

/**
 * Возвращает текст без цитат и подписи. Если отрезать пришлось всё — значит
 * письмо написано под цитатой (так тоже пишут), и тогда мы не выбрасываем
 * ничего, а лишь убираем строки с «>». Пустой текст в индексе хуже лишнего.
 */
function stripQuotedText(input) {
  const text = String(input || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';

  const lines = text.split('\n');
  let cutAt = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*>/.test(line)) { cutAt = i; break; }
    if (SIGNATURE.test(line)) { cutAt = i; break; }

    if (OUTLOOK_HEADER.test(line)) {
      // Смотрим на три следующие непустые строки: шапка идёт подряд.
      const near = lines.slice(i + 1, i + 5).filter((l) => l.trim());
      if (near.some((l) => OUTLOOK_HEADER_NEXT.test(l))) { cutAt = i; break; }
    }

    // Вступление к цитате проверяем и по одной строке, и склеенным с
    // продолжением: перенос посередине — обычное дело.
    const joined = `${line} ${lines[i + 1] || ''}`.trim();
    if (CUT_PATTERNS.some((re) => re.test(line) || re.test(joined))) { cutAt = i; break; }
  }

  const kept = cutAt >= 0 ? lines.slice(0, cutAt) : lines;
  const result = collapseBlankLines(kept.join('\n')).trim();

  if (result.length >= 15 || cutAt < 0) return result;

  // Отрезали почти всё — значит ответ написан снизу. Оставляем только не
  // процитированные строки.
  const fallback = lines.filter((l) => !/^\s*>/.test(l) && !OUTLOOK_HEADER.test(l) && !OUTLOOK_HEADER_NEXT.test(l));
  return collapseBlankLines(fallback.join('\n')).trim() || result;
}

function collapseBlankLines(text) {
  return text.replace(/\n{3,}/g, '\n\n');
}

// ── HTML в текст ──────────────────────────────────────────────────────────

const BLOCK_TAGS = 'address|article|aside|blockquote|br|div|dd|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tr|td|th|ul';

/**
 * Достаточно грубое преобразование: нам нужен не внешний вид, а слова для
 * индекса и для превью. Библиотеку ради этого не тянем — у неё был бы свой
 * набор особенностей, а здесь важна предсказуемость.
 */
function htmlToPlain(html) {
  if (!html) return '';
  let out = String(html);

  // Невидимое содержимое выбрасываем целиком, вместе с текстом: стили и
  // скрипты в индексе дали бы совпадения по словам вроде «font» и «display».
  out = out.replace(/<(script|style|head|noscript)[\s\S]*?<\/\1>/gi, ' ');
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');

  // Блочные теги — это перенос строки, иначе весь текст слипнется в одну.
  out = out.replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n');
  out = out.replace(/<[^>]+>/g, ' ');

  out = decodeEntities(out);

  // Строчные теги заменились пробелом, и «<b>претензия</b>.» превратилось в
  // «претензия .». В индексе и превью это уже другой текст, поэтому пробел
  // перед закрывающей пунктуацией и после открывающей убираем.
  out = out.replace(/[ \t]+([,.;:!?%)\]»”…])/g, '$1');
  out = out.replace(/([(\[«“])[ \t]+/g, '$1');

  return collapseBlankLines(
    out.split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n')
  ).trim();
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»',
  mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', middot: '·', bull: '•', deg: '°', euro: '€', pound: '£', sect: '§',
};

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : m;
    });
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try { return String.fromCodePoint(code); } catch (e) { return ''; }
}

// ── Превью для списка ─────────────────────────────────────────────────────

/**
 * Первые строки письма для списка. Берём уже очищенный от цитат текст: иначе у
 * половины переписки превью было бы «> > > С уважением».
 */
function buildPreview(strippedText, limit = 280) {
  const flat = String(strippedText || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  // Режем по границе слова, чтобы в списке не висел обрубок.
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

// ── Безопасный HTML для показа ────────────────────────────────────────────

/**
 * Профиль намеренно скупой. Письмо рисуется в изолированном iframe, но
 * полагаться только на изоляцию нельзя: часть писем придётся показывать и в
 * списке, и в уведомлении.
 *
 * Внешние картинки не остаются ссылками, а переносятся в data-mail-src. Это не
 * борьба с рекламой: картинка в один пиксель сообщает отправителю, что письмо
 * открыли, когда и с какого адреса. Решение показать её принимает человек.
 */
function sanitizeEmailHtml(html) {
  if (!html) return { html: '', blockedImages: 0, version: SANITIZER_VERSION };

  let blockedImages = 0;

  const clean = sanitizeHtml(String(html), {
    allowedTags: [
      'a', 'b', 'i', 'em', 'strong', 'u', 's', 'sub', 'sup', 'br', 'p', 'div', 'span',
      'blockquote', 'pre', 'code', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
      'img', 'figure', 'figcaption', 'center', 'font',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['alt', 'title', 'width', 'height', 'data-mail-src', 'src'],
      font: ['color', 'face', 'size'],
      '*': ['style', 'align', 'valign', 'colspan', 'rowspan', 'width', 'height', 'bgcolor', 'border', 'cellpadding', 'cellspacing'],
    },
    // Никаких javascript: и data: в ссылках. cid: остаётся — это вложенная
    // картинка самого письма, её мы отдаём со своего сервера.
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'cid'],
    allowedSchemesByTag: { img: ['cid', 'data'] },
    allowProtocolRelative: false,
    // position:fixed и подобное вырвало бы письмо за пределы своего окна.
    allowedStyles: {
      '*': {
        color: [/^.*$/],
        'background-color': [/^.*$/],
        'text-align': [/^.*$/],
        'font-size': [/^.*$/],
        'font-family': [/^.*$/],
        'font-weight': [/^.*$/],
        'font-style': [/^.*$/],
        'text-decoration': [/^.*$/],
        padding: [/^.*$/], 'padding-top': [/^.*$/], 'padding-bottom': [/^.*$/],
        'padding-left': [/^.*$/], 'padding-right': [/^.*$/],
        margin: [/^.*$/], 'margin-top': [/^.*$/], 'margin-bottom': [/^.*$/],
        'margin-left': [/^.*$/], 'margin-right': [/^.*$/],
        border: [/^.*$/], 'border-top': [/^.*$/], 'border-bottom': [/^.*$/],
        'border-left': [/^.*$/], 'border-right': [/^.*$/], 'border-radius': [/^.*$/],
        width: [/^.*$/], 'max-width': [/^.*$/], height: [/^.*$/],
        'line-height': [/^.*$/], 'vertical-align': [/^.*$/], display: [/^(?!.*fixed).*$/],
      },
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: 'a',
        attribs: {
          ...attribs,
          target: '_blank',
          // noopener обязателен: без него открытая страница получает доступ к
          // нашему окну через window.opener и может его перебросить.
          rel: 'noopener noreferrer nofollow',
        },
      }),
      img: (tagName, attribs) => {
        const src = attribs.src || '';
        // cid: — картинка из самого письма, она уже у нас. Внешние прячем.
        if (/^cid:/i.test(src)) return { tagName: 'img', attribs };
        if (src) {
          blockedImages += 1;
          const { src: _dropped, ...rest } = attribs;
          return { tagName: 'img', attribs: { ...rest, 'data-mail-src': src } };
        }
        return { tagName: 'img', attribs };
      },
    },
  });

  return { html: clean, blockedImages, version: SANITIZER_VERSION };
}

module.exports = {
  stripQuotedText,
  htmlToPlain,
  buildPreview,
  sanitizeEmailHtml,
  decodeEntities,
  SANITIZER_VERSION,
};
