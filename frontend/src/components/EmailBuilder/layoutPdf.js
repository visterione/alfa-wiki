/**
 * Макеты письма одним PDF (ver. 8.57).
 *
 * ── Зачем ────────────────────────────────────────────────────────────────────
 *
 * Согласование письма до этого выглядело так: отправить его себе, открыть в
 * приложении почты, сделать снимок экрана и переслать коллеге. В снимке едет
 * шапка Gmail, адрес отправителя и кнопки ответа — всё, кроме того, что надо
 * посмотреть, и ровно в одном виде из четырёх. Здесь письмо выгружается как
 * есть: четыре макета (компьютер и телефон, светлая тема и тёмная), каждый на
 * своём листе целиком, без разрывов.
 *
 * ── Чем рисуется ────────────────────────────────────────────────────────────
 *
 * Письмо заворачивается в SVG (foreignObject) и рисуется на холст как картинка.
 * Разметку при этом раскладывает сам браузер — тот же движок, что показывает
 * предпросмотр, — поэтому текст, переносы и межсловные пробелы в PDF ровно
 * такие же, как на экране.
 *
 * Первая попытка была на html2canvas, и от неё пришлось отказаться: он
 * раскладывает текст средствами DOM, а РИСУЕТ его вызовами canvas.fillText по
 * отдельным словам. Как только в письме появляется веб-шрифт, ширины при
 * раскладке и при отрисовке расходятся, слова уезжают, знаки препинания
 * отрываются от слов, и письмо в PDF выглядит рассыпавшимся. У foreignObject
 * этой развилки нет: раскладка и отрисовка — один и тот же проход браузера.
 *
 * Плата за это — автономность. Внутрь SVG-картинки браузер не пускает ни одной
 * внешней ссылки, поэтому и картинки письма, и гарнитуры приходится сначала
 * скачать и вшить в документ (inlineImages и collectFontCss ниже).
 *
 * ── Почему один макет = один лист ───────────────────────────────────────────
 *
 * Лист с подписью «2 из 3» читается как испорченный файл: человек, которому его
 * прислали на согласование, видит письмо разорванным пополам и первым делом
 * спрашивает, что сломалось. Поэтому макет вписывается в лист целиком, а
 * ориентация листа выбирается та, при которой он выйдет крупнее: высокому
 * письму лучше книжная, широкому и короткому — альбомная.
 */

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';

pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts;

// Лист A4 в пунктах, поля и место под подпись макета.
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 24;
const CAPTION = 24;

// Плотность снимка. Двойная — запас, с которым текст остаётся чётким при
// увеличении на экране и при печати; тройная утраивает вес файла ради разницы,
// заметной только в лупу.
const SCALE = 2;

/*
  Ширина макетов. 700 для компьютера, а не 600: письмо держит свои 600px, но
  вокруг него видна полоса фона — именно по ней видно, что тёмная шапка идёт от
  края до края. 390 — ширина обычного телефона, на ней срабатывает медиазапрос,
  складывающий колонки в столбик.
*/
const LAYOUTS = [
  { width: 700, theme: 'light', label: 'Компьютер · светлая тема' },
  { width: 700, theme: 'dark', label: 'Компьютер · тёмная тема' },
  { width: 390, theme: 'light', label: 'Телефон · светлая тема' },
  { width: 390, theme: 'dark', label: 'Телефон · тёмная тема' },
];

/**
 * Ожидание с предохранителем.
 *
 * Все ожидания здесь — чужие обещания: загрузка гарнитуры, декодирование
 * картинки, следующий кадр отрисовки. Любое из них может не наступить никогда
 * (заблокированный шрифт, битый файл, вкладка в фоне), а зависшая навсегда
 * выгрузка выглядит для человека как сломанная кнопка. Предел ожидания
 * превращает это в «нарисовали, как успели», что всегда лучше.
 */
const within = (promise, ms) => Promise.race([
  Promise.resolve(promise).catch(() => {}),
  new Promise(resolve => setTimeout(resolve, ms)),
]);

/** Следующий кадр отрисовки — но не дольше, чем ms. */
const nextFrame = (ms = 1000) => new Promise((resolve) => {
  const done = () => resolve();
  const timer = setTimeout(done, ms);
  requestAnimationFrame(() => { clearTimeout(timer); done(); });
});

const dataUrlOf = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

/**
 * Картинки письма — внутрь документа, а не ссылкой.
 *
 * Внутри SVG-картинки внешние ссылки не работают вовсе: браузер не пустит
 * запрос наружу, и на месте фотографий окажется пустота. Поэтому файлы
 * скачиваются заранее и подставляются как data:-URI.
 *
 * Что не скачалось — оставляем ссылкой. Пустое место на одном макете лучше,
 * чем несобравшийся файл.
 */
async function inlineImages(html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|background)\s*=\s*"(https?:\/\/[^"]+)"/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/url\((['"]?)(https?:\/\/[^'")]+)\1\)/gi)) urls.add(m[2]);
  if (!urls.size) return html;

  const pairs = await Promise.all([...urls].map(async (raw) => {
    try {
      // В атрибуте адрес экранирован (&amp;), а скачивать надо настоящий.
      const response = await fetch(raw.replace(/&amp;/g, '&'), { mode: 'cors', credentials: 'omit' });
      if (!response.ok) return null;
      return [raw, await dataUrlOf(await response.blob())];
    } catch {
      return null;
    }
  }));

  let out = html;
  pairs.filter(Boolean).forEach(([raw, data]) => { out = out.split(raw).join(data); });
  return out;
}

/**
 * Гарнитуры письма — тоже внутрь документа.
 *
 * Письмо подключает веб-шрифты ссылкой на Google Fonts, а внутри SVG эта ссылка
 * мертва. Забираем таблицу стилей (она отдаётся с разрешающим заголовком), а из
 * неё — сами файлы гарнитур, и вшиваем их в документ как data:-URI.
 *
 * Если не получилось — не беда: письмо нарисуется запасным шрифтом из того же
 * стека. Получатели Gmail и Outlook увидят ровно его же, потому что веб-шрифты
 * эти клиенты вырезают.
 */
async function collectFontCss(html) {
  const hrefs = [...html.matchAll(/<link[^>]+href="(https:\/\/fonts\.googleapis\.com[^"]+)"/gi)]
    .map(m => m[1].replace(/&amp;/g, '&'));
  if (!hrefs.length) return '';

  const sheets = await Promise.all(hrefs.map(async (href) => {
    try {
      const response = await fetch(href);
      if (!response.ok) return '';
      let css = await response.text();
      const files = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)].map(m => m[1]);
      const inlined = await Promise.all(files.map(async (url) => {
        try {
          const file = await fetch(url);
          return file.ok ? [url, await dataUrlOf(await file.blob())] : null;
        } catch {
          return null;
        }
      }));
      inlined.filter(Boolean).forEach(([url, data]) => { css = css.split(url).join(data); });
      // Начертания, которые скачать не удалось, выкидываем: ссылка на gstatic
      // внутри SVG всё равно не сработает, а @font-face с мёртвым адресом
      // заставляет браузер ждать его впустую.
      return css.replace(/@font-face\s*{[^}]*fonts\.gstatic\.com[^}]*}/g, '');
    } catch {
      return '';
    }
  }));

  return sheets.join('\n');
}

/**
 * Высота письма при заданной ширине.
 *
 * Меряем в настоящем iframe, а не в блоке на странице: складывание колонок в
 * столбик на телефоне держится на медиазапросе, а он считается от ширины окна.
 * В блоке внутри страницы окно осталось бы компьютерным, и «телефонный» макет
 * вышел бы таким же, как обычный.
 */
async function measure(html, width) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;border:0;width:${width}px;height:600px;`;
  document.body.appendChild(frame);
  try {
    await within(new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      frame.srcdoc = html;
    }), 15000);
    const doc = frame.contentDocument;
    // `load` срабатывает раньше, чем доезжают картинки, а без них высота
    // письма получается меньше настоящей и низ макета обрежется.
    await within(Promise.all([...doc.images].map(img => (
      img.decode ? img.decode().catch(() => {}) : Promise.resolve()
    ))), 15000);
    if (doc.fonts?.ready) await within(doc.fonts.ready, 8000);
    await nextFrame();
    await nextFrame();

    return {
      height: Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight, 200),
      background: getComputedStyle(doc.body).backgroundColor || '#ffffff',
    };
  } finally {
    frame.remove();
  }
}

/**
 * Письмо → самодостаточный SVG.
 *
 * Разметка пересобирается через DOMParser и XMLSerializer, а не склеивается
 * строками: внутри SVG действуют правила XML, и незакрытый <meta> или <br> из
 * обычного HTML ломает картинку целиком, без объяснений.
 */
function buildSvg(html, width, height, fontCss) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const css = [...doc.querySelectorAll('style')].map(s => s.textContent).join('\n');
  doc.querySelectorAll('style, link, script, title, meta, base').forEach(n => n.remove());

  // Условные комментарии для Outlook в XML недопустимы и браузеру не нужны:
  // всё, что внутри них, он и так не показывает.
  const comments = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_COMMENT);
  const trash = [];
  while (comments.nextNode()) trash.push(comments.currentNode);
  trash.forEach(n => n.remove());

  const wrap = doc.createElement('div');
  wrap.setAttribute('style', `${doc.body.getAttribute('style') || ''};width:${width}px;`);
  while (doc.body.firstChild) wrap.appendChild(doc.body.firstChild);
  wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

  const body = new XMLSerializer().serializeToString(wrap);
  const styles = `${fontCss}\n${css}`.replace(/]]>/g, ']]&gt;');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<foreignObject x="0" y="0" width="${width}" height="${height}">`
    + `<style xmlns="http://www.w3.org/1999/xhtml"><![CDATA[${styles}]]></style>`
    + body
    + '</foreignObject></svg>';
}

/** SVG → PNG нужной плотности. */
async function rasterize(svg, width, height, background) {
  const image = new Image();
  image.width = width;
  image.height = height;
  let failed = false;
  await within(new Promise((resolve) => {
    image.onload = resolve;
    image.onerror = () => { failed = true; resolve(); };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }), 20000);
  // Браузер отказался разбирать SVG — чаще всего из-за разметки, которую не
  // принял XML. Молча отдать пустой лист нельзя: человек отправит его на
  // согласование и не поймёт, что смотрит в пустоту.
  if (failed || !image.complete) throw new Error('Браузер не смог нарисовать письмо для PDF');

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * SCALE);
  canvas.height = Math.round(height * SCALE);
  const ctx = canvas.getContext('2d');
  // Подложка нужна: прозрачные места в PDF печатаются белым, и у тёмного
  // макета поля вокруг письма оказались бы светлыми.
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(SCALE, SCALE);
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

/**
 * Ориентация листа под конкретный макет.
 *
 * Не по типу устройства, а по пропорции: у высокого письма альбомный лист
 * отнимает высоту, и макет на нём выходит в полтора раза мельче, чем на
 * книжном. Выбираем ту ориентацию, при которой письмо окажется крупнее, —
 * ради этого всё и делается.
 */
function fitPage(widthPx, heightPx) {
  const box = (pw, ph) => [pw - MARGIN * 2, ph - MARGIN * 2 - CAPTION];
  const portrait = box(A4_W, A4_H);
  const landscape = box(A4_H, A4_W);
  const scaleOf = ([w, h]) => Math.min(w / widthPx, h / heightPx);
  return scaleOf(landscape) > scaleOf(portrait)
    ? { orientation: 'landscape', fit: landscape }
    : { orientation: 'portrait', fit: portrait };
}

/**
 * Собирает и отдаёт файл.
 *
 * @param {object}   params
 * @param {string}   params.html      светлое письмо (готовый HTML из предпросмотра)
 * @param {string}   params.htmlDark  оно же, перекрашенное под тёмную тему почты
 * @param {string}   params.subject   тема — она же имя файла
 * @param {function} params.onStep    отчёт о ходе: (готово, всего)
 */
export async function exportLayoutsPdf({ html, htmlDark, subject = '', onStep }) {
  if (!html) throw new Error('Письмо ещё не собрано');

  const title = subject.trim() || 'Письмо без темы';

  // Картинки и гарнитуры скачиваем по одному разу на всю выгрузку: у тёмной
  // темы те же адреса, она меняет только цвета.
  const [light, night, fontCss] = await Promise.all([
    inlineImages(html),
    inlineImages(htmlDark || html),
    collectFontCss(html),
  ]);

  const content = [];
  let firstOrientation = 'portrait';

  for (let i = 0; i < LAYOUTS.length; i += 1) {
    const layout = LAYOUTS[i];
    onStep?.(i, LAYOUTS.length);

    const source = layout.theme === 'dark' ? night : light;
    // eslint-disable-next-line no-await-in-loop
    const { height, background } = await measure(source, layout.width);
    const svg = buildSvg(source, layout.width, height, fontCss);
    // eslint-disable-next-line no-await-in-loop
    const png = await rasterize(svg, layout.width, height, background);

    const page = fitPage(layout.width, height);
    if (i === 0) firstOrientation = page.orientation;

    content.push({
      text: layout.label,
      style: 'caption',
      ...(i === 0 ? {} : { pageBreak: 'before', pageOrientation: page.orientation }),
    });
    content.push({ image: png, fit: page.fit, alignment: 'center' });
  }

  onStep?.(LAYOUTS.length, LAYOUTS.length);

  const stamp = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date());

  const doc = {
    pageSize: 'A4',
    pageOrientation: firstOrientation,
    pageMargins: [MARGIN, MARGIN, MARGIN, MARGIN],
    info: { title: `Макет письма — ${title}` },
    content,
    styles: { caption: { fontSize: 9, color: '#8E8E93', margin: [0, 0, 0, 8] } },
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    footer: (page, total) => ({
      columns: [
        {
          // Оговорка про тёмную тему стоит на каждой странице намеренно: файл
          // уходит человеку, который этой переписки не читал, и принимать
          // тёмный макет за точный снимок он не должен.
          text: `«${title}» · макет от ${stamp} · тёмная тема показана приближённо: Gmail, Outlook и Apple Mail перекрашивают письмо каждый по-своему`,
          fontSize: 7,
          color: '#AEAEB2',
        },
        { text: `${page} / ${total}`, fontSize: 7, color: '#AEAEB2', width: 40, alignment: 'right' },
      ],
      margin: [MARGIN, 0, MARGIN, 0],
    }),
  };

  const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80);
  await new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(doc).download(`Макет письма — ${safe}.pdf`, resolve);
    } catch (error) {
      reject(error);
    }
  });
}
