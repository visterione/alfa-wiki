/**
 * Макеты письма одним PDF (ver. 8.57).
 *
 * ── Зачем ────────────────────────────────────────────────────────────────────
 *
 * Согласование письма до этого выглядело так: отправить его себе, открыть в
 * приложении почты, сделать снимок экрана и переслать коллеге. В снимке едет
 * шапка Gmail, адрес отправителя, кнопки ответа — всё, кроме того, что надо
 * посмотреть, и ровно в одном виде из четырёх. Здесь письмо выгружается как
 * есть: четыре макета (компьютер и телефон, светлая тема и тёмная) в одном
 * файле, который можно отправить на проверку и получить «да» или «нет».
 *
 * ── Почему снимок, а не вёрстка PDF ──────────────────────────────────────────
 *
 * Письмо рисуется браузером из того же HTML, который уйдёт получателям, и
 * снимается как картинка. Собирать PDF из документа конструктора значило бы
 * завести ТРЕТИЙ способ превратить письмо в изображение (после рендерера и
 * холста) — и однажды согласовать одно, а отправить другое.
 *
 * ── Почему страницы режутся, а не ужимаются ──────────────────────────────────
 *
 * Письмо высокое: полторы-две тысячи пикселей обычное дело. Вписать такую
 * ленту в один лист A4 можно, но читать в ней будет нечего — текст станет
 * мельче типографской точки. Поэтому масштаб фиксированный (лист держит
 * привычные 600px ширины письма), а то, что не поместилось, переносится на
 * следующую страницу. Лист с подписью «(2 из 3)» понятнее листа с лупой.
 */

import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import html2canvas from 'html2canvas';

pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts;

// Лист A4 в пунктах и поля. Ширина содержимого — то, во что укладывается
// письмо шириной 600px; из их отношения и берётся единый масштаб всех снимков.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const CAPTION_H = 26;
const CONTENT_H = PAGE_H - MARGIN * 2 - CAPTION_H;

// Пунктов на пиксель письма. Один на все четыре макета: иначе телефонная
// версия, вписанная в ту же ширину листа, оказывалась бы увеличенной втрое, и
// сравнить её с компьютерной было бы не с чем.
const PT_PER_PX = CONTENT_W / 600;

// Плотность снимка. Двойная — это ровно тот запас, с которым текст письма
// остаётся чётким при печати и при увеличении на экране; тройная утраивает вес
// файла ради разницы, которую видно только в лупу.
const SCALE = 2;

const LAYOUTS = [
  { device: 'desktop', theme: 'light', width: 700, label: 'Компьютер · светлая тема' },
  { device: 'desktop', theme: 'dark', width: 700, label: 'Компьютер · тёмная тема' },
  { device: 'mobile', theme: 'light', width: 390, label: 'Телефон · светлая тема' },
  { device: 'mobile', theme: 'dark', width: 390, label: 'Телефон · тёмная тема' },
];

/**
 * Картинки письма — внутрь снимка, а не ссылкой.
 *
 * Картинки в письме лежат по адресу портала (PUBLIC_BASE_URL), и для страницы
 * конструктора это чужой источник: на бою совпадает домен, но не всегда порт, а
 * в разработке фронтенд стоит на 9000, бэкенд на 9001. Холст, в который попала
 * картинка с чужого источника, браузер помечает «испорченным» и больше не даёт
 * прочитать — снимок из него не достать. html2canvas в таком случае просто
 * пропускает картинку, и в PDF на её месте оказывается пустота: согласовывать
 * такой макет нельзя, а понять, почему он пустой, невозможно.
 *
 * Поэтому картинки заранее скачиваются и подставляются в письмо как data:-URI.
 * Запрос идёт тем же способом, каким страница ходит в API, и /uploads отвечает
 * с нужными заголовками (cors в server.js стоит раньше раздачи файлов). Что не
 * скачалось — оставляем ссылкой: пустое место в одном макете лучше, чем
 * несобравшийся файл.
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
      const blob = await response.blob();
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return [raw, data];
    } catch {
      return null;
    }
  }));

  let out = html;
  pairs.filter(Boolean).forEach(([raw, data]) => {
    out = out.split(raw).join(data);
  });
  return out;
}

/**
 * Ждём, пока письмо действительно нарисовано.
 *
 * `load` у iframe срабатывает раньше, чем доезжают картинки с портала, и снимок
 * без ожидания получается с пустыми рамками вместо фотографий. `decode()`
 * вместо события `load` — он честно отвечает и по уже загруженной картинке,
 * тогда как обработчик `load` на ней уже никогда не позовут.
 */
async function waitForPaint(doc) {
  const images = [...doc.images];
  await Promise.all(images.map(img => (
    img.decode ? img.decode().catch(() => {}) : Promise.resolve()
  )));
  if (doc.fonts?.ready) await doc.fonts.ready.catch(() => {});
  // Два кадра: первый отдаёт браузеру перерисовку после загрузки картинок,
  // второй гарантирует, что она уже случилась.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

/**
 * Один макет → canvas.
 *
 * Письмо рисуется в настоящем iframe нужной ширины, а не в блоке на странице:
 * складывание колонок в столбик на телефоне держится на медиазапросе, а он
 * считается от ширины окна. В блоке внутри страницы окно осталось бы
 * компьютерным, и «телефонный» макет вышел бы таким же, как обычный.
 */
async function captureLayout(html, width) {
  const frame = document.createElement('iframe');
  // Уводим за пределы экрана, но не прячем display:none и не сворачиваем в
  // нулевой размер: невидимый элемент браузер не раскладывает, и снимать было
  // бы нечего.
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;border:0;width:${width}px;height:600px;`;
  document.body.appendChild(frame);

  try {
    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      frame.srcdoc = html;
    });

    const doc = frame.contentDocument;
    await waitForPaint(doc);

    const height = Math.max(
      doc.documentElement.scrollHeight,
      doc.body.scrollHeight,
      600,
    );
    frame.style.height = `${height}px`;
    await new Promise(r => requestAnimationFrame(r));

    return await html2canvas(doc.documentElement, {
      backgroundColor: getComputedStyle(doc.body).backgroundColor || '#ffffff',
      scale: SCALE,
      width,
      height,
      // Клон, в котором html2canvas рисует, получает ровно те же размеры окна —
      // иначе медиазапрос в нём пересчитается на другую ширину, и снимок
      // разойдётся с тем, что видно в предпросмотре.
      windowWidth: width,
      windowHeight: height,
      useCORS: true,
      logging: false,
      imageTimeout: 20000,
    });
  } finally {
    frame.remove();
  }
}

/** Вырезает из снимка кусок высотой в страницу и отдаёт его как PNG. */
function slice(canvas, fromPx, heightPx) {
  const cut = document.createElement('canvas');
  cut.width = canvas.width;
  cut.height = Math.round(heightPx * SCALE);
  // Последний кусок берём ровно по остатку письма, а не по высоте страницы:
  // добор до полного листа дал бы прозрачную полосу, которая в PDF печатается
  // белой и в тёмном макете читается как обрыв письма.
  const ctx = cut.getContext('2d');
  ctx.drawImage(
    canvas,
    0, Math.round(fromPx * SCALE), canvas.width, cut.height,
    0, 0, canvas.width, cut.height,
  );
  try {
    return cut.toDataURL('image/png');
  } catch (error) {
    // Холст «испорчен» картинкой с чужого источника, которую не удалось
    // скачать заранее. Сообщение важнее самого сбоя: без него человек видит
    // невнятную SecurityError и не понимает, что чинить.
    throw new Error('В письме есть картинка с чужого адреса — снимок из браузера её не пропускает. Загрузите её в письмо через конструктор.');
  }
}

/**
 * Собирает и отдаёт файл.
 *
 * @param {object}   params
 * @param {string}   params.html      светлое письмо (готовый HTML из предпросмотра)
 * @param {string}   params.htmlDark  оно же, перекрашенное под тёмную тему почты
 * @param {string}   params.subject   тема — она же заголовок файла
 * @param {function} params.onStep    отчёт о ходе: (готово, всего)
 */
export async function exportLayoutsPdf({ html, htmlDark, subject = '', onStep }) {
  if (!html) throw new Error('Письмо ещё не собрано');

  const content = [];
  const title = subject.trim() || 'Письмо без темы';

  // Скачиваем картинки один раз на оба вида: тёмная тема меняет только цвета,
  // адреса картинок в ней те же.
  const [light, night] = await Promise.all([
    inlineImages(html),
    inlineImages(htmlDark || html),
  ]);

  for (let i = 0; i < LAYOUTS.length; i += 1) {
    const layout = LAYOUTS[i];
    onStep?.(i, LAYOUTS.length);

    const source = layout.theme === 'dark' ? night : light;
    // eslint-disable-next-line no-await-in-loop
    const canvas = await captureLayout(source, layout.width);

    const cssHeight = canvas.height / SCALE;
    const pageHeightPx = CONTENT_H / PT_PER_PX;
    const pages = Math.max(1, Math.ceil(cssHeight / pageHeightPx));

    for (let p = 0; p < pages; p += 1) {
      const from = p * pageHeightPx;
      const piece = Math.min(pageHeightPx, cssHeight - from);
      content.push({
        text: pages > 1 ? `${layout.label} · ${p + 1} из ${pages}` : layout.label,
        style: 'caption',
        pageBreak: content.length ? 'before' : undefined,
      });
      content.push({
        image: slice(canvas, from, piece),
        width: layout.width * PT_PER_PX,
        alignment: 'center',
      });
    }
  }

  onStep?.(LAYOUTS.length, LAYOUTS.length);

  const stamp = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date());

  const doc = {
    pageSize: 'A4',
    pageMargins: [MARGIN, MARGIN, MARGIN, MARGIN],
    info: { title: `Макет письма — ${title}` },
    content,
    styles: {
      caption: { fontSize: 9, color: '#8E8E93', margin: [0, 0, 0, 8] },
    },
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

export const LAYOUT_COUNT = LAYOUTS.length;
