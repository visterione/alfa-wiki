// Снимки html-страниц для документа Word (ver. 9.04): каждая страница
// запускается в невидимом окне на /page/<slug>?alfa-print=<id> и присылает
// обратно разметку с данными (см. pages/PrintRender.js).
//
// Окно на каждую страницу своё, а не одно на всех с переходами: скрипты
// страниц объявляют глобальные переменные и вешают обработчики на window, и
// вторая страница того же шаблона в том же окне падала бы на повторном
// объявлении. Два окна сразу — компромисс: быстрее вдвое, а МИС и браузер
// не захлёбываются от десятка одновременно грузящихся приложений.

const CONCURRENCY = 2;
// Сама страница ждёт тишины не дольше 30 секунд; сверху запас на загрузку
// бандла в окно. Не дождались — страница уйдёт в документ без данных.
const PAGE_TIMEOUT_MS = 45000;
// Ширина окна — настольная: на ней приложения показывают сетки карточек,
// которые снимок перекладывает в таблицы. На узкой они сложились бы в столбик.
const FRAME_WIDTH = 1100;

function snapshotOne({ id: pageId, slug }, signal) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // Не display:none и не visibility:hidden — в таком окне браузер не
    // считает раскладку, и снимок не отличит видимое от скрытого.
    Object.assign(frame.style, {
      position: 'fixed', left: '-20000px', top: '0', width: `${FRAME_WIDTH}px`, height: '900px',
      opacity: '0', pointerEvents: 'none', border: '0',
    });

    let settled = false;
    const finish = (html) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      frame.remove();
      resolve(html || null);
    };
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
      if (event.data?.type !== 'alfa-print-snapshot' || event.data.pageId !== pageId) return;
      finish(event.data.html);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), PAGE_TIMEOUT_MS);

    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort);
    frame.src = `/page/${encodeURIComponent(slug)}?alfa-print=${encodeURIComponent(pageId)}`;
    document.body.appendChild(frame);
  });
}

/**
 * Снять html-страницы по очереди: pages — [{ id, slug }]. Возвращает
 * { [pageId]: html } — только удавшиеся; остальные сервер соберёт из
 * сохранённой разметки.
 */
export async function snapshotPages(pages, { onProgress, signal } = {}) {
  const result = {};
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < pages.length && !signal?.aborted) {
      const page = pages[next++];
      const html = await snapshotOne(page, signal);
      if (html) result[page.id] = html;
      done += 1;
      onProgress?.(done, pages.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker));
  return result;
}
