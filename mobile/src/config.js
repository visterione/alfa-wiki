/**
 * Адрес сервера. Единственное место, где он задаётся.
 *
 * Раньше здесь лежали три отдельных константы с http и IP, и в vpn.js был ещё
 * четвёртый хардкод. Теперь всё считается от одного BASE_URL.
 *
 * ВАЖНО про HTTPS: релизная сборка Android не умеет открытый http —
 * React Native ставит usesCleartextTraffic=false для buildType release.
 * То есть с http-адресом debug работает, а release молча теряет сеть целиком.
 * Поэтому боевой адрес обязан быть https.
 *
 * Боевой контур: TLS терминирует nginx на 443, Node слушает 9001 открытым http
 * внутри машины. Значит мобилка ходит на домен без порта, а nginx проксирует
 * /api, /socket.io и /uploads на 9001 (см. docs/mobile-nginx.md).
 */

// __DEV__ — глобальная переменная React Native: true в Metro-сборке, false в release
//
// Домен используется и в разработке: он доступен откуда угодно, тогда как
// прежний адрес 'http://192.168.22.39:9001' виден только из офисной сети —
// с машины разработки он не отвечает. Если понадобится отлаживать против
// локального бэкенда, подставьте его в DEV_HOST, но помните, что открытый http
// работает только в debug-сборке.
const DEV_HOST = 'https://wiki.medcentralfa.ru';
const PROD_HOST = 'https://wiki.medcentralfa.ru';

export const BASE_URL = __DEV__ ? DEV_HOST : PROD_HOST;

const CONFIG = {
  BASE_URL,
  API_URL: `${BASE_URL}/api`,
  SOCKET_URL: BASE_URL,
  // Полный URL к файлу в uploads. Заменяет копипасту fixUrl/avatarUrl,
  // которые собирали адрес каждый по-своему.
  fileUrl(pathOrUrl) {
    if (!pathOrUrl) return null;
    if (pathOrUrl.startsWith('http')) {
      // Абсолютный URL из БД может указывать на старый хост (в базе лежат адреса
      // вида http://localhost:9001/uploads/...) — берём только путь
      try {
        const {pathname} = new URL(pathOrUrl);
        return `${BASE_URL}${pathname}`;
      } catch {
        return null;
      }
    }
    const p = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${BASE_URL}${p}`;
  },
};

export default CONFIG;
