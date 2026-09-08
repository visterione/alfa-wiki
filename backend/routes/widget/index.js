'use strict';

/**
 * Публичный контур виджета связи (ver. 8.06).
 *
 * Два маршрута, оба без авторизации и оба только на чтение: сам скрипт и его
 * настройка. Ничего больше здесь появиться не должно — это единственная часть
 * вики, которую вызывает браузер случайного человека с улицы.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ РОУТЕР, А НЕ ВЕТКА В /api/public. У публичного API своя
 * аутентификация по ключу api_clients и запись каждого обращения в
 * api_request_logs. Виджет запрашивают на каждом показе страницы сайта: ключа у
 * него быть не может (он лежал бы открыто), а журнал вырос бы на строку с
 * каждого посетителя. Общее у контуров — только лимит по IP, он и переиспользован.
 *
 * ПОЧЕМУ АДРЕС НАЧИНАЕТСЯ С /api. На бою nginx проксирует в Node только /api,
 * /socket.io и /uploads, а остальное отдаёт из frontend/build. Скрипт по любому
 * другому пути пришлось бы заводить отдельным location — и до тех пор он молча
 * отдавался бы страницей портала: try_files подставляет index.html.
 *
 * МОНТИРУЕТСЯ ДО express.json() — как /api/public и /api/wh-public: тела запросов
 * здесь нет вовсе, и общий лимит в 10 gb на этих маршрутах не нужен.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const { rateLimitByIp } = require('../../middleware/publicApi');
const { SiteWidget } = require('../../models');
const { publicView, originAllowed } = require('../../services/siteWidget');

const router = express.Router();

const EMBED_PATH = path.join(__dirname, '..', '..', 'widget', 'embed.js');

// Лимит щедрый: одна страница сайта — один запрос настройки, а за одним адресом
// может сидеть целая клиника или мобильный оператор.
router.use(rateLimitByIp(240));

/**
 * Сам скрипт. В бою читается один раз: файл не меняется между перезапусками, а
 * дисковое чтение на каждый показ чужой страницы — лишнее. В разработке
 * читается каждый раз, чтобы правка была видна без перезапуска.
 */
let cached = null;

function embedSource() {
  if (process.env.NODE_ENV === 'production') {
    if (!cached) cached = fs.readFileSync(EMBED_PATH, 'utf8');
    return cached;
  }
  return fs.readFileSync(EMBED_PATH, 'utf8');
}

router.get('/v1/embed.js', (req, res) => {
  let source;
  try {
    source = embedSource();
  } catch (err) {
    console.error('[widget] не читается embed.js:', err.message);
    return res.status(500).type('application/javascript').send('/* widget unavailable */');
  }

  // Час — компромисс: правку виджета (в отличие от настройки) мы делаем сами и
  // редко, а лишний запрос за неизменным файлом на каждый показ страницы дорог
  // для сайта клиники. ETag Express проставит сам, и повторный заход обойдётся
  // ответом 304.
  //
  // В разработке кэш выключен: правка виджета проверяется на тестовой странице,
  // а с часовым кэшем браузер час показывает прежний файл — и выглядит это как
  // «правка не работает», а не как «страница не перезагрузилась».
  res.set('Cache-Control', process.env.NODE_ENV === 'production'
    ? 'public, max-age=3600'
    : 'no-store');
  res.type('application/javascript; charset=utf-8').send(source);
});

/**
 * Настройка виджета. Отдаётся только то, что и так видно на сайте: каналы,
 * цвет, подписи (см. publicView). Ключ виджета лежит в открытом коде страницы,
 * поэтому секретов здесь быть не может по определению.
 */
router.get('/v1/config/:key', async (req, res) => {
  try {
    const widget = await SiteWidget.findOne({ where: { key: String(req.params.key || '') } });

    // Одинаковый ответ на «нет такого» и «выключен» — чтобы перебором ключей
    // нельзя было узнать, какие виджеты вообще заведены.
    if (!widget || !widget.isActive) {
      return res.status(404).json({ error: 'not_found' });
    }

    if (!originAllowed(widget, req.headers.origin)) {
      return res.status(403).json({ error: 'origin_denied' });
    }

    // Пять минут: правка в вики доезжает до сайта за время кофе, а на каждый
    // показ страницы мы в базу не ходим.
    res.set('Cache-Control', 'public, max-age=300');
    res.json(publicView(widget));
  } catch (err) {
    console.error('[widget] GET /config:', err);
    res.status(500).json({ error: 'internal' });
  }
});

router.use((req, res) => res.status(404).json({ error: 'not_found' }));

module.exports = router;
