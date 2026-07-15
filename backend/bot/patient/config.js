/**
 * Справочник организаций для синка подписчиков из Fromni.
 * (Свои боты Telegram/MAX не поднимаем — источник только Fromni, см. services/fromniSync.js.)
 *
 * org key -> человекочитаемое имя. Ключи Fromni берутся из .env (FROMNI_KEY_*).
 */
const ORGANIZATIONS = {
  'alfa':        'Медцентр Альфа',
  'alfa-deti':   'Медцентр Альфа Дети',
  'alfa-liniya': 'Медцентр Альфа Линия',
  'alfa-prof':   'Медцентр Альфа Проф',
  'alfa-smile':  'Медцентр Альфа Смайл',
  'alfa-3k':     'Медцентр Альфа 3К'
};

module.exports = { ORGANIZATIONS };
