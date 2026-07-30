/**
 * Leaflet по требованию.
 *
 * Карта нужна на двух экранах из полусотни, и тащить её в общий бандл ради
 * этого незачем — подключаем скрипт с CDN при первом открытии. Тот же приём
 * и та же версия, что на странице карты медцентров (bot/map.html), чтобы
 * браузер брал файл из кэша, а не качал второй раз.
 *
 * Промис общий на всё приложение: одновременное открытие двух карт не должно
 * приводить к двум вставкам одного и того же тега.
 */

const VERSION = '1.9.4';
const CSS_URL = `https://unpkg.com/leaflet@${VERSION}/dist/leaflet.css`;
const JS_URL = `https://unpkg.com/leaflet@${VERSION}/dist/leaflet.js`;

let loading = null;

export function ensureLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${CSS_URL}"]`)) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = CSS_URL;
      document.head.appendChild(css);
    }

    const script = document.createElement('script');
    script.src = JS_URL;
    script.async = true;
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      // Следующая попытка должна начаться с чистого листа, иначе экран
      // навсегда останется с обещанием, которое уже никогда не исполнится
      loading = null;
      reject(new Error('Не удалось загрузить карту'));
    };
    document.head.appendChild(script);
  });

  return loading;
}
