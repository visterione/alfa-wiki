import { pages } from '../services/api';
import '../index.css';
import './PageView.css';

// Снимок html-страницы для документа Word (ver. 9.04).
//
// html-страницы — это приложения: в базе у них почти пустая разметка, а
// данные они подгружают своими запросами с токеном сотрудника. Сервер при
// сборке документа видел только заготовку. Поэтому страницу запускаем
// по-настоящему — в невидимом окне внутри портала, от имени того, кто
// выгружает, — ждём, пока она догрузится, и отдаём родительскому окну
// разметку, в которую вписаны реальные цвета и начертание. Дальше её
// разбирает тот же конвертер, что и страницы редактора.
//
// Страница рендерится мимо App: там SocketProvider, и каждое невидимое окно
// открыло бы свой сокет — со звуком уведомлений и отметкой «в сети».
// Права соблюдаются сами собой: запросы идут с токеном из localStorage, то
// есть страница получает ровно то, что этот сотрудник видит на экране.
//
// Контракт для самих страниц: пока идёт печать, window.__ALFA_PRINT_MODE__
// равен true, и страница может показать всё сразу (раскрыть вкладки, спрятать
// поиск). Если она сама знает, когда готова, достаточно отправить
// window.dispatchEvent(new Event('alfa:print-ready')) — иначе ждём тишины.
// Параметры документа страница кладёт в window.__ALFA_PRINT_OPTIONS__:
// { hideMeta: true } — не печатать под заголовком дату правки и снимка.
// В разметке понимаются data-print-layout="grid" (таблица только для
// раскладки, без рамок), ширина ячейки в style и break-before: page.

const QUIET_MS = 1200;
const MIN_WAIT_MS = 800;
// Страница врачей грузит полные списки услуг по каждому врачу из МИС и на
// больших разделах собирается дольше полуминуты.
const MAX_WAIT_MS = 60000;
const MAX_IMAGE_SIDE = 1400;

// ── Ожидание готовности ──────────────────────────────────

let inflight = 0;
let lastActivity = Date.now();
const touch = () => { lastActivity = Date.now(); };

// Счётчик запросов ставится до запуска скриптов страницы, иначе первые
// запросы (а это обычно и есть загрузка данных) прошли бы мимо него.
function trackNetwork() {
  const origFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    inflight += 1; touch();
    return origFetch(...args).finally(() => { inflight -= 1; touch(); });
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function send(...args) {
    inflight += 1; touch();
    this.addEventListener('loadend', () => { inflight -= 1; touch(); }, { once: true });
    return origSend.apply(this, args);
  };
}

function waitForQuiet(root) {
  return new Promise((resolve) => {
    const started = Date.now();
    const observer = new MutationObserver(touch);
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearInterval(timer);
      // Кадр на отрисовку: после последней мутации стили ещё не пересчитаны.
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    };
    window.addEventListener('alfa:print-ready', finish, { once: true });
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - started >= MAX_WAIT_MS) return finish();
      if (now - started >= MIN_WAIT_MS && inflight === 0 && now - lastActivity >= QUIET_MS) finish();
    }, 100);
  });
}

// ── Запуск страницы ──────────────────────────────────────

// Повторяет PageView.contentRefCallback: разметка без скриптов, затем
// customCss, скрипты страницы по порядку и customJs. Любое расхождение здесь
// — и страница в документе вела бы себя не так, как на экране.
function mountPage(page, container) {
  const content = page.content || '';
  container.innerHTML = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  if (page.customCss) {
    const style = document.createElement('style');
    style.textContent = page.customCss;
    document.head.appendChild(style);
  }

  const doc = new DOMParser().parseFromString(content, 'text/html');
  doc.querySelectorAll('script').forEach((scriptEl) => {
    const script = document.createElement('script');
    if (scriptEl.src) {
      // Загрузка внешней библиотеки — тоже «страница ещё не готова».
      inflight += 1; touch();
      const settle = () => { inflight -= 1; touch(); };
      script.addEventListener('load', settle, { once: true });
      script.addEventListener('error', settle, { once: true });
      script.src = scriptEl.src;
    } else {
      script.textContent = scriptEl.textContent;
    }
    document.body.appendChild(script);
  });

  if (page.customJs) {
    const script = document.createElement('script');
    script.textContent = page.customJs;
    document.body.appendChild(script);
  }
}

// ── Снимок разметки ──────────────────────────────────────

// На бумаге от них ничего не остаётся, а подписи кнопок и опции списков
// только засорили бы текст. Тот же список, что и в конвертере на сервере.
const SKIP = new Set([
  'script', 'style', 'link', 'meta', 'title', 'noscript', 'template', 'svg', 'canvas',
  'button', 'input', 'select', 'textarea', 'option', 'object', 'embed', 'iframe', 'video', 'audio',
]);
const KEEP_TAGS = new Set([
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'pre', 'blockquote', 'hr', 'br',
  'a', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'code', 'mark',
]);
const CSS_TABLE = { table: 'table', 'table-row-group': 'tbody', 'table-header-group': 'thead', 'table-row': 'tr', 'table-cell': 'td' };

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeHtml(String(s)).replace(/"/g, '&quot;');

function parseRgb(value) {
  const m = String(value || '').match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (alpha < 0.3) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
const toHex = (rgb) => '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join('');
const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// Раскладка детей контейнера по геометрии: сколько колонок и строк на экране.
function layoutOf(el) {
  const kids = [...el.children].filter((k) => {
    const r = k.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(k).position !== 'absolute';
  });
  const rows = new Map();
  for (const k of kids) {
    const r = k.getBoundingClientRect();
    const top = Math.round(r.top / 8);
    if (!rows.has(top)) rows.set(top, []);
    rows.get(top).push({ el: k, rect: r });
  }
  const rowList = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, items]) => items.sort((a, b) => a.rect.left - b.rect.left));
  const cols = Math.max(0, ...rowList.map(r => r.length));
  return { kids, rowList, cols };
}

// Картинку, которую сервер сам не прочитает (фото врача из МИС, blob:),
// перекладываем в data: через canvas, заодно ужимая. Чужой домен без CORS
// «пачкает» canvas — тогда остаётся как есть, и на сервере будет пометка.
function inlineImage(img) {
  const src = img.currentSrc || img.src || '';
  const url = (() => { try { return new URL(src, window.location.href); } catch { return null; } })();
  if (!url) return null;
  if (url.origin === window.location.origin && url.pathname.startsWith('/uploads/')) return url.pathname + url.search;
  if (src.startsWith('data:')) return src;
  if (!img.complete || !img.naturalWidth) return null;
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

function snapshot(root) {
  const styleOf = (el, cs, { inline, cell }) => {
    const out = [];
    const bg = (inline || cell) ? parseRgb(cs.backgroundColor) : null;
    const keepBg = bg && luminance(bg) < 0.97;
    if (keepBg) out.push(`background-color:${toHex(bg)}`);
    const color = parseRgb(cs.color);
    // Белый текст без своей заливки на бумаге невидим: заливку карточек мы
    // не переносим, поэтому и светлый цвет поверх неё отбрасываем.
    if (color && (keepBg || luminance(color) < 0.85)) out.push(`color:${toHex(color)}`);
    if (parseInt(cs.fontWeight, 10) >= 600) out.push('font-weight:bold');
    if (cs.fontStyle === 'italic') out.push('font-style:italic');
    const deco = cs.textDecorationLine || '';
    if (deco.includes('underline') && el.tagName !== 'A') out.push('text-decoration:underline');
    if (deco.includes('line-through')) out.push('text-decoration:line-through');
    const size = parseFloat(cs.fontSize);
    if (size) out.push(`font-size:${Math.round(size)}px`);
    if (!inline && (cs.breakBefore === 'page' || cs.breakBefore === 'always')) out.push('page-break-before:always');
    if (cell && el.style.width) out.push(`width:${el.style.width}`);
    if (!inline && ['center', 'right', 'justify'].includes(cs.textAlign)) out.push(`text-align:${cs.textAlign}`);
    return out.join(';');
  };

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.data);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node;
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag)) return '';
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return '';

    if (tag === 'img') {
      const src = inlineImage(el);
      if (!src) return el.alt ? `<img alt="${escapeAttr(el.alt)}">` : '';
      const width = Math.round(el.getBoundingClientRect().width);
      return `<img src="${escapeAttr(src)}"${width ? ` width="${width}"` : ''} alt="${escapeAttr(el.alt || '')}">`;
    }
    if (tag === 'br') return '<br>';

    const inline = cs.display.startsWith('inline') && !['inline-flex', 'inline-grid'].includes(cs.display);
    let outTag = KEEP_TAGS.has(tag) ? tag : (CSS_TABLE[cs.display] || (inline ? 'span' : 'div'));
    const cell = outTag === 'td' || outTag === 'th';
    const style = styleOf(el, cs, { inline: outTag === 'span' || outTag === 'mark', cell });
    const attrs = [];
    if (style) attrs.push(`style="${escapeAttr(style)}"`);
    if (outTag === 'a' && el.href) attrs.push(`href="${escapeAttr(el.href)}"`);
    if (cell && el.colSpan > 1) attrs.push(`colspan="${el.colSpan}"`);
    if (cell && el.rowSpan > 1) attrs.push(`rowspan="${el.rowSpan}"`);
    if (outTag === 'table' && el.dataset.printLayout) attrs.push(`data-print-layout="${escapeAttr(el.dataset.printLayout)}"`);

    // Сетка карточек (grid или flex с переносом) в Word превратилась бы в
    // столбик: кладём её таблицей без рамок, по строкам как на экране.
    // Условие на размер детей — чтобы строка «Телефон: 123» из двух
    // маленьких блоков не стала таблицей.
    if (outTag === 'div' && /flex|grid/.test(cs.display) && el.children.length > 1) {
      const { kids, rowList, cols } = layoutOf(el);
      const blocky = kids.every(k => k.getBoundingClientRect().width >= 120 && k.getBoundingClientRect().height >= 48);
      if (cols >= 2 && cols <= 4 && blocky) {
        const rowsHtml = rowList.map(items => {
          const cells = items.map(({ el: k }) => `<td>${walk(k)}</td>`);
          while (cells.length < cols) cells.push('<td></td>');
          return `<tr>${cells.join('')}</tr>`;
        }).join('');
        return `<table data-print-layout="grid"><tbody>${rowsHtml}</tbody></table>`;
      }
      // Одна короткая строка — подпись и значение, иконка и текст: держим в
      // одном абзаце через точку, а не столбиком из отдельных абзацев.
      if (rowList.length === 1 && el.getBoundingClientRect().height < 48) {
        const parts = kids.map(k => walk(k)).filter(h => h.replace(/<[^>]*>/g, '').trim());
        return `<div${attrs.length ? ' ' + attrs.join(' ') : ''}>${parts.map(p => `<span>${p}</span>`).join(' · ')}</div>`;
      }
    }

    const inner = [...el.childNodes].map(walk).join('');
    if (!inner.replace(/<(?!img)[^>]*>/g, '').trim() && !/<img|<hr/.test(inner) && !['hr', 'td', 'th', 'tr'].includes(outTag)) return '';
    if (outTag === 'hr') return '<hr>';
    return `<${outTag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</${outTag}>`;
  };

  return [...root.childNodes].map(walk).join('');
}

// ── Точка входа ──────────────────────────────────────────

export default async function runPrintRender(rootEl) {
  // Читаем до запуска скриптов: шаблоны чистят search через replaceState.
  const id = new URLSearchParams(window.location.search).get('alfa-print');
  const post = (payload) => window.parent.postMessage({ type: 'alfa-print-snapshot', pageId: id, ...payload }, window.location.origin);

  window.__ALFA_PRINT_MODE__ = true;
  trackNetwork();

  rootEl.innerHTML = '<div class="card page-sheet"><div class="page-content"></div></div>';
  const container = rootEl.querySelector('.page-content');

  try {
    const { data: page } = await pages.get(id);
    if (page.contentType !== 'html') {
      post({ error: 'not-html' });
      return;
    }
    mountPage(page, container);
    await waitForQuiet(container);
    const options = window.__ALFA_PRINT_OPTIONS__ || {};
    post({ html: snapshot(container), hideMeta: options.hideMeta === true });
  } catch (error) {
    post({ error: error?.response?.status ? `http-${error.response.status}` : 'failed' });
  }
}
