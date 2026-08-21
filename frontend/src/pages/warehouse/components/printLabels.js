import toast from 'react-hot-toast';

/**
 * Окно печати пачки этикеток.
 *
 * Общее для оборудования и кабинетов: раскладка страницы у них одна и та же, а
 * различается только то, что нарисовано внутри PNG. Пока функция жила внутри
 * экрана оборудования, кабинетам пришлось бы завести её копию — и разъехались бы
 * они на первой же правке полей страницы.
 *
 * На вход приходят уже растеризованные PNG: сервер формирует их в DPI выбранного
 * принтера, браузер здесь только передаёт готовые пиксели драйверу. Считать
 * размер в миллиметрах ему нельзя — @page задаёт страницу, а картинка обязана
 * лечь в неё ровно, без пересчёта разрешения по дороге.
 */
export function openPrintWindow({ labels, sizeMm, title = 'Этикетки' }) {
  const w = window.open('', '_blank');
  if (!w) return toast.error('Браузер заблокировал окно печати');
  const { w: mmW, h: mmH } = sizeMm;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>${title} (${labels.length})</title>
    <style>
      @page { size: ${mmW}mm ${mmH}mm; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .label { width: ${mmW}mm; height: ${mmH}mm; page-break-after: always; overflow: hidden; }
      .label img { display: block; width: ${mmW}mm; height: ${mmH}mm; image-rendering: pixelated; }
      .label:last-child { page-break-after: auto; }
      @media screen {
        body { background: #eef1f5; padding: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
        .label { background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
      }
    </style></head><body>
    ${labels.map(l => `<div class="label"><img src="${l.png}" alt=""></div>`).join('')}
    <script>window.onload = () => setTimeout(() => window.print(), 250);</script>
    </body></html>`);
  w.document.close();
  return undefined;
}

/** Сохраняет текст файлом — ZPL-задание для термопринтера приходит именно так. */
export function downloadTextFile(contents, filename) {
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
