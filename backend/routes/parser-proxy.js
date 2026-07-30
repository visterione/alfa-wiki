'use strict';

/**
 * Прокси к alfa-parser — парсеру прайсов клиник-конкурентов.
 *
 * Парсер работает на отдельной машине в локальной сети и слушает по HTTP.
 * Страница вики открыта по HTTPS, поэтому дёрнуть его из браузера напрямую
 * нельзя — браузер запретит смешанный контент. Ходит сюда фронт, а в парсер
 * идёт уже этот бэкенд: ему смешанный контент не помеха, а парсер благодаря
 * этому не нужно ни выставлять наружу, ни переводить на HTTPS.
 *
 * Настройка — в services/parserClient.js. Снаружи всё закрыто JWT:
 * маршруты только для сотрудников вики.
 */

const express = require('express');
const { Op } = require('sequelize');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const {
  sequelize,
  CompetitorSource,
  CompetitorLocation,
  PriceComparison,
  PriceComparisonItem
} = require('../models');
const parser = require('../services/parserClient');
const { syncAll } = require('../services/competitorPricesSync');

const router = express.Router();

// Заводить источники и запускать обходы может не всякий сотрудник: это
// действия с внешними последствиями — мы ходим на чужие сайты. Доступ даётся
// тумблером «Парсер» в настройках пользователя. Сами цены смотреть можно
// шире — они лежат в модуле сравнения цен.
const canManage = [authenticate, requireAdminAccess('parser')];

/** Ошибку парсера показываем так, чтобы по ней было понятно, что чинить. */
function fail(res, err, what) {
  const described = parser.describeError(err);
  console.error(`❌ Парсер (${what}): ${described.error} — ${err.message}`);
  return res.status(described.status).json({
    success: false,
    error: described.error,
    message: described.message
  });
}

// ═══════════════════════════════════════════════════════════════
// ДИАГНОСТИКА
// ═══════════════════════════════════════════════════════════════

/**
 * Связь с парсером: настроено ли на нашей стороне и отвечает ли он.
 *
 * /api/ping на парсере отвечает без ключа — поэтому «адрес неверный» и
 * «ключ неверный» тут не сливаются в одну неисправность.
 */
router.get('/ping', ...canManage, async (req, res) => {
  try {
    const data = await parser.ping();
    res.json({
      success: true,
      parserUrl: parser.parserUrl(),
      tokenConfiguredInWiki: parser.hasToken(),
      tokenConfiguredInParser: Boolean(data?.auth_configured),
      parser: data
    });
  } catch (err) {
    const described = parser.describeError(err);
    console.error(`❌ Парсер (ping): ${described.error} — ${err.message}`);
    // адрес отдаём и в случае неудачи: без него не видно, куда не достучались
    res.status(described.status).json({
      success: false,
      error: described.error,
      message: described.message,
      parserUrl: parser.parserUrl(),
      tokenConfiguredInWiki: parser.hasToken()
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ИСТОЧНИКИ (напрямую из парсера)
// ═══════════════════════════════════════════════════════════════

/**
 * Список клиник-конкурентов со сводкой последнего обхода.
 *
 * Заодно заводим строки зеркала для источников, которых там ещё нет. Без
 * этого «название в сравнениях» нельзя было указать, пока не прошёл первый
 * забор цен, — а понять это по интерфейсу было невозможно.
 */
router.get('/sources', ...canManage, async (req, res) => {
  try {
    const sources = await parser.listSources();

    const known = await CompetitorSource.findAll({ attributes: ['parserSourceId'], raw: true });
    const seen = new Set(known.map(row => row.parserSourceId));
    const fresh = sources.filter(source => !seen.has(source.id));
    if (fresh.length) {
      await CompetitorSource.bulkCreate(fresh.map(source => ({
        parserSourceId: source.id,
        name: source.name,
        displayName: source.display_name || null,
        baseUrl: source.base_url,
        city: source.city || null,
        servicesTotal: source.services_total || 0,
        syncStatus: 'pending'
      })));
    }

    res.json({ success: true, data: sources });
  } catch (err) {
    fail(res, err, 'sources');
  }
});

/**
 * Правка карточки клиники руками: название и город.
 *
 * Город правится здесь, а не при вводе ссылки: у сайта без переключателя
 * городов взять его неоткуда, а для карты он нужен. Передаём только те поля,
 * которые пришли, — иначе правка названия стирала бы город.
 */
router.patch('/sources/:id', ...canManage, async (req, res) => {
  const patch = {};
  if ('displayName' in (req.body || {})) patch.display_name = req.body.displayName ?? '';
  if ('city' in (req.body || {})) patch.city = req.body.city ?? '';
  if (!Object.keys(patch).length) {
    return res.status(400).json({ success: false, error: 'nothing_to_change', message: 'Нечего менять' });
  }

  try {
    const data = await parser.patch(`/api/sources/${encodeURIComponent(req.params.id)}`, patch);
    // в зеркале держим ту же подпись, чтобы страница сравнения не ходила
    // за ней в парсер
    await CompetitorSource.update(
      { displayName: data.display_name || null, city: data.city || null },
      { where: { parserSourceId: Number(req.params.id) } }
    );
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, `patch source ${req.params.id}`);
  }
});

/** Сходить на сайт клиники за названием и значком заново. */
router.post('/sources/:id/branding', ...canManage, async (req, res) => {
  try {
    const data = await parser.post(`/api/sources/${encodeURIComponent(req.params.id)}/branding`);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, `branding ${req.params.id}`);
  }
});

/**
 * Клиники-конкуренты для страницы сравнения цен.
 *
 * Отдаётся из зеркала одним запросом: название, город, подпись в сравнениях
 * и значок готовым data-URI. Доступно любому сотруднику, а не только
 * администратору парсера: добавить колонку конкурента в сравнение может
 * каждый, у кого открыта та страница, — значит и список клиник ему нужен.
 */
router.get('/competitors', authenticate, async (req, res) => {
  try {
    const sources = await CompetitorSource.findAll({
      order: [['displayName', 'ASC'], ['city', 'ASC']],
      attributes: [
        'id', 'parserSourceId', 'name', 'displayName', 'city', 'servicesTotal',
        'competitorLabel', 'lastRunAt', 'logoData', 'logoContentType'
      ]
    });
    const [filialRows] = await sequelize.query(
      `SELECT DISTINCT ON (cs."sourceId", p."filialId")
              cs."sourceId", p."filialId", p."filialName",
              loc.name AS "locationName", loc.address
         FROM competitor_services cs
         JOIN competitor_prices p ON p."serviceId" = cs.id
         LEFT JOIN LATERAL (
           SELECT l.name, l.address
             FROM competitor_locations l
            WHERE l."sourceId" = cs."sourceId"
              AND l."parserFilialId" = p."filialId"
            ORDER BY (l.origin = 'manual') DESC, l."updatedAt" DESC
            LIMIT 1
         ) loc ON true
        WHERE p."filialId" IS NOT NULL OR p."filialName" IS NOT NULL
        ORDER BY cs."sourceId", p."filialId", p."filialName"`
    );
    const filialsBySource = new Map();
    for (const row of filialRows) {
      if (!filialsBySource.has(row.sourceId)) filialsBySource.set(row.sourceId, []);
      filialsBySource.get(row.sourceId).push({
        id: row.filialId,
        name: row.filialName || row.locationName || row.address || `Филиал ${row.filialId}`,
        address: row.address || null
      });
    }

    res.json({
      success: true,
      data: sources.map(source => ({
        parserSourceId: source.parserSourceId,
        name: source.name,
        displayName: source.displayName,
        city: source.city,
        servicesTotal: source.servicesTotal,
        filials: filialsBySource.get(source.id) || [],
        competitorLabel: source.competitorLabel,
        lastRunAt: source.lastRunAt,
        logo: source.logoData
          ? `data:${source.logoContentType || 'image/png'};base64,${source.logoData.toString('base64')}`
          : null
      }))
    });
  } catch (err) {
    console.error('❌ Список конкурентов не отдался:', err.message);
    res.status(500).json({ success: false, error: 'competitors_failed', message: 'Не удалось прочитать список клиник' });
  }
});

// ═══════════════════════════════════════════════════════════════
// АДРЕСА ТОЧЕК
// ═══════════════════════════════════════════════════════════════

/**
 * Точки клиники на карте.
 *
 * Отдаём из своей копии: карту рисует вики, и ходить за адресами в парсер
 * на каждый показ незачем. Смотреть может любой сотрудник — адреса нужны
 * и на странице сравнения цен.
 */
router.get('/sources/:id/locations', authenticate, async (req, res) => {
  try {
    const source = await CompetitorSource.findOne({
      where: { parserSourceId: Number(req.params.id) },
      attributes: ['id']
    });
    if (!source) return res.json({ success: true, data: [] });

    const locations = await CompetitorLocation.findAll({
      where: { sourceId: source.id },
      order: [['city', 'ASC'], ['name', 'ASC']]
    });
    res.json({ success: true, data: locations });
  } catch (err) {
    console.error('❌ Адреса не отдались:', err.message);
    res.status(500).json({ success: false, error: 'locations_failed', message: 'Не удалось прочитать адреса' });
  }
});

/** Сходить на сайт за адресами точек заново. */
router.post('/sources/:id/locations/collect', ...canManage, async (req, res) => {
  try {
    const data = await parser.post(`/api/sources/${encodeURIComponent(req.params.id)}/locations/collect`);
    await mirrorLocations(Number(req.params.id), data.locations || []);
    console.log(`📍 Адреса источника ${req.params.id}: найдено ${data.found}, со страницы ${data.page || '—'}`);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, `locations ${req.params.id}`);
  }
});

/**
 * Вписать точку руками.
 *
 * Нужно там, где автосбор бессилен: инвитро рисует страницу скриптами,
 * kdl отбивает запросы антиботом, у cl-lab самоподписанный сертификат.
 */
router.post('/sources/:id/locations', ...canManage, async (req, res) => {
  try {
    const data = await parser.post(`/api/sources/${encodeURIComponent(req.params.id)}/locations`, {
      address: req.body?.address,
      name: req.body?.name,
      city: req.body?.city
    });
    await refreshMirror(Number(req.params.id));
    res.json({ success: true, data });
  } catch (err) {
    if (err.response?.status === 409) {
      return res.status(409).json({ success: false, error: 'duplicate', message: 'Такой адрес уже есть' });
    }
    fail(res, err, `add location ${req.params.id}`);
  }
});

/** Правка точки. После неё автосбор её не перетирает. */
router.patch('/locations/:locationId', ...canManage, async (req, res) => {
  try {
    const data = await parser.patch(`/api/locations/${encodeURIComponent(req.params.locationId)}`, {
      address: req.body?.address,
      name: req.body?.name,
      city: req.body?.city
    });
    await CompetitorLocation.update(
      {
        address: data.address,
        name: data.name || null,
        city: data.city || null,
        origin: data.origin
      },
      { where: { parserLocationId: Number(req.params.locationId) } }
    );
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, `patch location ${req.params.locationId}`);
  }
});

router.delete('/locations/:locationId', ...canManage, async (req, res) => {
  try {
    await parser.del(`/api/locations/${encodeURIComponent(req.params.locationId)}`);
    await CompetitorLocation.destroy({ where: { parserLocationId: Number(req.params.locationId) } });
    res.json({ success: true });
  } catch (err) {
    fail(res, err, `delete location ${req.params.locationId}`);
  }
});

/** Перечитать точки источника из парсера в нашу копию. */
async function refreshMirror(parserSourceId) {
  const data = await parser.get(`/api/sources/${parserSourceId}/locations`);
  await mirrorLocations(parserSourceId, data.locations || []);
}

/** Список приходит целиком и целиком же замещает прежний: точек десятки. */
async function mirrorLocations(parserSourceId, locations) {
  const source = await CompetitorSource.findOne({ where: { parserSourceId }, attributes: ['id'] });
  if (!source) return;

  const rows = locations.map(item => ({
    sourceId: source.id,
    parserLocationId: item.id,
    name: item.name || null,
    address: item.address,
    city: item.city || null,
    origin: item.origin || 'text',
    parserFilialId: item.filial_id ?? null
  }));

  await CompetitorLocation.destroy({ where: { sourceId: source.id } });
  if (rows.length) await CompetitorLocation.bulkCreate(rows);
}

/**
 * Все значки разом, готовыми data-URI.
 *
 * Тег <img> не умеет отправлять заголовок авторизации, а весь API вики закрыт
 * JWT — поэтому обычной ссылкой на картинку не обойтись. Отдаём их одним
 * запросом при загрузке страницы: значков пара десятков и они по несколько
 * килобайт, это дешевле, чем городить отдельную схему доступа к файлам.
 *
 * Намеренно отдельно от /sync/status: тот опрашивается раз в несколько секунд,
 * пока идёт забор, и таскать в нём картинки было бы расточительно.
 */
router.get('/logos', authenticate, async (req, res) => {
  try {
    const sources = await CompetitorSource.findAll({
      where: { logoData: { [Op.ne]: null } },
      attributes: ['parserSourceId', 'logoData', 'logoContentType']
    });

    const logos = {};
    for (const source of sources) {
      const type = source.logoContentType || 'image/png';
      logos[source.parserSourceId] = `data:${type};base64,${source.logoData.toString('base64')}`;
    }
    res.json({ success: true, data: logos });
  } catch (err) {
    console.error('❌ Логотипы не отдались:', err.message);
    res.status(500).json({ success: false, error: 'logos_failed', message: 'Не удалось загрузить логотипы' });
  }
});

/**
 * Значок клиники отдельным файлом. Отдаём из своей копии, а не из парсера:
 * страница сравнения цен должна показывать логотипы и когда парсер выключен.
 */
router.get('/sources/:id/logo', authenticate, async (req, res) => {
  try {
    const source = await CompetitorSource.findOne({
      where: { parserSourceId: Number(req.params.id) },
      attributes: ['logoData', 'logoContentType']
    });
    if (!source?.logoData) return res.status(404).end();

    res.set('Content-Type', source.logoContentType || 'image/png');
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(source.logoData);
  } catch (err) {
    console.error('❌ Логотип не отдался:', err.message);
    res.status(500).end();
  }
});

/**
 * Убрать клинику вместе со всем, что по ней собрано.
 *
 * Цены, уже подставленные в сравнения, остаются: их подтвердил человек,
 * и это снимок на момент решения. Обновляться они перестанут — источника
 * больше нет.
 */
router.delete('/sources/:id', ...canManage, async (req, res) => {
  try {
    const data = await parser.del(`/api/sources/${encodeURIComponent(req.params.id)}`);
    // соответствия уходят каскадом вместе со строками зеркала
    const removed = await CompetitorSource.destroy({ where: { parserSourceId: Number(req.params.id) } });
    console.log(`🗑  Клиника «${data.deleted}» удалена пользователем ${req.user?.username} (строк зеркала: ${removed})`);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, `delete source ${req.params.id}`);
  }
});

// Источник целиком: филиалы и последние обходы
router.get('/sources/:id', ...canManage, async (req, res) => {
  try {
    res.json({ success: true, data: await parser.getSource(req.params.id) });
  } catch (err) {
    fail(res, err, `source ${req.params.id}`);
  }
});

/**
 * Страница каталога с ценами.
 *
 * Листается курсором `after`, а не постранично: у clinic23 по Краснодару
 * 6778 услуг и 67 тысяч строк цен, и offset на таком объёме способен
 * пропустить услугу, если обход допишет строки посреди выгрузки.
 * В ответе `next_after` — с чем звать следующий раз, null — каталог кончился.
 */
router.get('/sources/:id/services', ...canManage, async (req, res) => {
  try {
    const data = await parser.listServices(req.params.id, {
      after: req.query.after || 0,
      limit: req.query.limit || 500
    });
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, `services ${req.params.id}`);
  }
});

/**
 * Каталог услуг источника из НАШЕЙ копии — то, что видит сопоставление.
 *
 * Смотреть парсер напрямую для разбора «почему цена не подтянулась» мало:
 * сопоставление читает зеркало, и расхождение между ним и парсером — сама
 * по себе частая причина. Поэтому вместе со страницей отдаём и обе цифры:
 * сколько услуг у нас и сколько их было на последнем заборе.
 *
 * Листается смещением, а не курсором, в отличие от проксирующего маршрута
 * выше: зеркало между запросами не меняется — его перезаписывает только
 * синхронизация, — а человеку нужно уметь прыгнуть на страницу назад.
 */
router.get('/sources/:id/catalog', ...canManage, async (req, res) => {
  try {
    const source = await CompetitorSource.findOne({
      where: { parserSourceId: Number(req.params.id) },
      attributes: [
        'id', 'name', 'displayName', 'city', 'competitorLabel',
        'servicesTotal', 'syncedAt', 'syncStatus', 'syncError', 'lastRunAt'
      ]
    });
    if (!source) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Источника нет в нашей копии — сначала заберите цены'
      });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const search = String(req.query.search || '').trim();
    // «Погашенные» услуги показываем по запросу: пропавшая из прайса позиция —
    // как раз то, что ищут, когда цена вчера была, а сегодня нет.
    const onlyActive = req.query.status !== 'all';

    const where = ['cs."sourceId" = :sourceId'];
    const replacements = { sourceId: source.id, limit, offset: (page - 1) * limit };
    if (onlyActive) where.push('cs."isActive"');
    if (search) {
      // Код 804н ищем по jsonb как по тексту: массив из одного-двух значений,
      // разворачивать его ради LIKE не за чем.
      where.push('(cs.name ILIKE :like OR cs.codes::text ILIKE :like OR cs."externalId" ILIKE :like)');
      replacements.like = `%${search}%`;
    }
    const filter = where.join(' AND ');

    const [[counts]] = await sequelize.query(
      `SELECT count(*)                                  AS "mirrorTotal",
              count(*) FILTER (WHERE cs."isActive")     AS "activeTotal",
              count(*) FILTER (WHERE NOT cs."isActive") AS "inactiveTotal",
              count(*) FILTER (
                WHERE cs.codes IS NOT NULL AND jsonb_array_length(cs.codes) > 0
              )                                         AS "withCodesTotal"
         FROM competitor_services cs
        WHERE cs."sourceId" = :sourceId`,
      { replacements: { sourceId: source.id } }
    );

    const [[filtered]] = await sequelize.query(
      `SELECT count(*) AS total FROM competitor_services cs WHERE ${filter}`,
      { replacements }
    );

    const [rows] = await sequelize.query(
      `SELECT cs.id, cs."parserServiceId", cs."externalId", cs.name, cs.category,
              cs.codes, cs.url, cs.turnaround, cs."isActive", cs."lastSeenAt",
              COALESCE(p.prices, '[]'::jsonb) AS prices
         FROM competitor_services cs
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(
                    jsonb_build_object(
                      'filialId',   pr."filialId",
                      'filialName', pr."filialName",
                      'price',      pr.price,
                      'priceMin',   pr."priceMin",
                      'priceMax',   pr."priceMax",
                      'observedAt', pr."observedAt"
                    )
                    ORDER BY pr."filialId" NULLS FIRST, pr.price
                  ) AS prices
             FROM competitor_prices pr
            WHERE pr."serviceId" = cs.id
         ) p ON true
        WHERE ${filter}
        ORDER BY cs."isActive" DESC, cs.name
        LIMIT :limit OFFSET :offset`,
      { replacements }
    );

    res.json({
      success: true,
      data: {
        source: {
          parserSourceId: Number(req.params.id),
          name: source.displayName || source.name,
          city: source.city,
          competitorLabel: source.competitorLabel,
          // Сколько услуг было на последнем заборе. Расходится с mirrorTotal,
          // если забор упал на середине.
          servicesTotal: source.servicesTotal,
          syncedAt: source.syncedAt,
          syncStatus: source.syncStatus,
          syncError: source.syncError,
          lastRunAt: source.lastRunAt
        },
        counts: {
          mirrorTotal: Number(counts.mirrorTotal),
          activeTotal: Number(counts.activeTotal),
          inactiveTotal: Number(counts.inactiveTotal),
          withCodesTotal: Number(counts.withCodesTotal)
        },
        page,
        limit,
        total: Number(filtered.total),
        items: rows
      }
    });
  } catch (err) {
    console.error('❌ Каталог услуг не отдался:', err.message);
    res.status(500).json({ success: false, error: 'catalog_failed', message: 'Не удалось прочитать каталог услуг' });
  }
});

// ═══════════════════════════════════════════════════════════════
// СИНХРОНИЗАЦИЯ (наша копия прайсов)
// ═══════════════════════════════════════════════════════════════

// Синхронизация идёт минутами, поэтому её нельзя выполнять внутри запроса:
// маршрут только запускает её и сразу отвечает, а ход дела виден в /sync/status
let syncRunning = false;

/**
 * Что и когда мы забрали. Свежесть здесь двойная, и обе даты важны:
 * `syncedAt` — когда мы забирали данные, `lastRunAt` — когда парсер видел сайт.
 * Свежая синхронизация недельного обхода — это всё ещё недельные цены.
 */
router.get('/sync/status', ...canManage, async (req, res) => {
  try {
    const sources = await CompetitorSource.findAll({
      order: [['name', 'ASC']],
      attributes: [
        'id', 'parserSourceId', 'name', 'displayName', 'baseUrl', 'city', 'servicesTotal',
        'lastRunAt', 'lastRunStatus', 'syncedAt', 'syncStatus', 'syncError',
        'competitorLabel', 'logoContentType'
      ]
    });
    res.json({ success: true, running: syncRunning, data: sources });
  } catch (err) {
    console.error('❌ Не удалось прочитать состояние синхронизации:', err.message);
    res.status(500).json({ success: false, error: 'status_failed', message: 'Не удалось прочитать состояние синхронизации' });
  }
});

async function renameComparisonLabel(oldLabel, newLabel, transaction) {
  if (!oldLabel || !newLabel || oldLabel === newLabel) return 0;

  const comparisons = await PriceComparison.findAll({
    where: { competitors: { [Op.contains]: [oldLabel] } },
    transaction
  });
  let movedItems = 0;

  for (const comparison of comparisons) {
    const renamed = (comparison.competitors || []).map(label =>
      label === oldLabel ? newLabel : label
    );
    comparison.competitors = [...new Set(renamed)];
    comparison.changed('competitors', true);
    await comparison.save({ transaction });

    const items = await PriceComparisonItem.findAll({
      where: { comparisonId: comparison.id },
      transaction
    });
    for (const item of items) {
      let changed = false;
      for (const field of ['prices', 'priceSources', 'priceHistory', 'costPrices']) {
        const values = { ...(item[field] || {}) };
        if (!Object.prototype.hasOwnProperty.call(values, oldLabel)) continue;
        // Если уточнённая колонка уже существует, её значение приоритетнее.
        if (!Object.prototype.hasOwnProperty.call(values, newLabel)) {
          values[newLabel] = values[oldLabel];
        }
        delete values[oldLabel];
        item[field] = values;
        item.changed(field, true);
        changed = true;
      }
      if (changed) {
        await item.save({ transaction });
        movedItems += 1;
      }
    }
  }
  return movedItems;
}

/**
 * Как эта клиника называется в сравнениях цен.
 *
 * В сравнении конкуренты перечислены человеческими названиями («Неомед»),
 * а в зеркале источники зовутся по домену («clinic23-krd»). Пока связь
 * не проставлена, цены источника подставлять некуда, и в сопоставлении
 * он не участвует.
 */
// Под обычной авторизацией, а не под админской: колонку конкурента в сравнение
// добавляет любой сотрудник со страницы сравнения, и привязка колонки к клинике
// парсера — продолжение того же действия, а не администрирование
router.put('/sources/:parserSourceId/label', authenticate, async (req, res) => {
  try {
    const source = await CompetitorSource.findOne({
      where: { parserSourceId: Number(req.params.parserSourceId) }
    });
    if (!source) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: 'Источника нет в нашей копии — сначала заберите цены'
      });
    }

    let label = (req.body?.competitorLabel || '').trim();
    const city = (source.city || '').trim();
    // «Инвитро» в двух городах — два разных прайса и две разные колонки.
    // Поэтому город является частью сохраняемого ключа, а не только
    // декоративной подписью в браузере.
    if (label && city &&
        !label.toLocaleLowerCase('ru-RU').includes(city.toLocaleLowerCase('ru-RU'))) {
      label = `${label} (${city})`;
    }

    if (label) {
      const duplicate = await CompetitorSource.findOne({
        where: {
          competitorLabel: label,
          parserSourceId: { [Op.ne]: source.parserSourceId }
        },
        attributes: ['parserSourceId']
      });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          error: 'label_already_used',
          message: `Название «${label}» уже привязано к другому источнику`
        });
      }
    }

    const oldLabel = source.competitorLabel;
    let movedItems = 0;
    await sequelize.transaction(async transaction => {
      await source.update({ competitorLabel: label || null }, { transaction });
      movedItems = await renameComparisonLabel(oldLabel, label, transaction);
    });
    res.json({
      success: true,
      data: { competitorLabel: source.competitorLabel, movedItems }
    });
  } catch (err) {
    console.error('❌ Не удалось сохранить название конкурента:', err.message);
    res.status(500).json({ success: false, error: 'label_failed', message: 'Не удалось сохранить название' });
  }
});

/** Забрать прайсы прямо сейчас, не дожидаясь ночного расписания. */
router.post('/sync', ...canManage, async (req, res) => {
  if (syncRunning) {
    return res.status(409).json({
      success: false,
      error: 'sync_already_running',
      message: 'Синхронизация уже идёт — дождитесь её окончания'
    });
  }

  syncRunning = true;
  res.status(202).json({
    success: true,
    message: 'Синхронизация запущена. Ход дела — в /api/parser/sync/status'
  });

  // Ответ уже ушёл: дальше работаем в фоне и общаемся с интерфейсом
  // через состояние в базе
  syncAll()
    .catch(err => console.error('❌ Ручная синхронизация прайсов конкурентов не удалась:', err.message))
    .finally(() => { syncRunning = false; });
});

// ═══════════════════════════════════════════════════════════════
// РАЗБОР ССЫЛКИ И ОБХОД
// ═══════════════════════════════════════════════════════════════

/**
 * Завести новый источник: разобрать ссылку на страницу с ценами.
 *
 * Отвечает сразу и обход не начинает. Разбор идёт минутами, а его результат
 * человек сначала смотрит глазами: сколько строк нашлось, что в превью, какие
 * у парсера сомнения. Дальше страница опрашивает /jobs/:id и, когда задача
 * встанет в `awaiting_confirm`, показывает экран подтверждения.
 */
router.post('/analyze', ...canManage, async (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!url) {
    return res.status(400).json({ success: false, error: 'url_required', message: 'Вставьте ссылку на страницу с ценами' });
  }

  try {
    const data = await parser.post('/api/analyze', { url, city: req.body?.city || null });
    console.log(`🔎 Разбор ссылки ${url} запущен пользователем ${req.user?.username}`);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, 'analyze');
  }
});

// ═══════════════════════════════════════════════════════════════
// ОЧЕРЕДЬ
// ═══════════════════════════════════════════════════════════════

/**
 * Сдать список ссылок на разбор.
 *
 * Каждый сайт разбирается минутами, а выкатывать их приходится десятками.
 * Очередь доводит каждый до состояния «разобрано, проверьте» и останавливается:
 * подтверждение остаётся за человеком, потому что сайт с постраничной
 * навигацией легко отдаёт первую страницу за весь прайс.
 */
router.post('/queue', ...canManage, async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
  if (!urls.length) {
    return res.status(400).json({ success: false, error: 'urls_required', message: 'Вставьте хотя бы одну ссылку' });
  }

  try {
    const data = await parser.post('/api/queue', { urls });
    console.log(`📋 В очередь добавлено ${data.added} ссылок пользователем ${req.user?.username}`);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, 'queue add');
  }
});

/** Очередь целиком: сначала то, что ждёт человека. */
router.get('/queue', ...canManage, async (req, res) => {
  try {
    res.json({ success: true, data: await parser.get('/api/queue') });
  } catch (err) {
    fail(res, err, 'queue');
  }
});

/** Принять разбор из очереди и запустить обход. */
router.post('/queue/:itemId/confirm', ...canManage, async (req, res) => {
  const cities = Array.isArray(req.body?.cities) ? req.body.cities : [];
  try {
    const data = await parser.post(`/api/queue/${encodeURIComponent(req.params.itemId)}/confirm`, { cities });
    res.json({ success: true, data });
  } catch (err) {
    if (err.response?.status === 409) {
      return res.status(409).json({
        success: false,
        error: 'not_ready',
        message: 'Эта ссылка не ждёт подтверждения — обновите список'
      });
    }
    fail(res, err, `queue confirm ${req.params.itemId}`);
  }
});

/** Убрать ссылку из очереди. То, что сейчас в работе, снять нельзя. */
router.delete('/queue/:itemId', ...canManage, async (req, res) => {
  try {
    res.json({ success: true, data: await parser.del(`/api/queue/${encodeURIComponent(req.params.itemId)}`) });
  } catch (err) {
    if (err.response?.status === 409) {
      return res.status(409).json({
        success: false,
        error: 'busy',
        message: 'Эту ссылку сейчас нельзя убрать — она в работе'
      });
    }
    fail(res, err, `queue drop ${req.params.itemId}`);
  }
});

/** Прибрать доведённое до конца, чтобы список не разрастался. */
router.post('/queue/clear', ...canManage, async (req, res) => {
  try {
    res.json({ success: true, data: await parser.post('/api/queue/clear') });
  } catch (err) {
    fail(res, err, 'queue clear');
  }
});

/**
 * Состояние задачи — это опрашивает страница разбора.
 *
 * Состояние `lost` означает, что парсер перезапускался: его реестр задач живёт
 * в памяти процесса. Это не сбой связи, и показывать его надо иначе.
 */
router.get('/jobs/:jobId', ...canManage, async (req, res) => {
  try {
    const data = await parser.get(`/api/jobs/${encodeURIComponent(req.params.jobId)}`);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, `job ${req.params.jobId}`);
  }
});

/** Человек принял разбор: заводим источники по отмеченным городам и обходим сайт. */
router.post('/jobs/:jobId/confirm', ...canManage, async (req, res) => {
  const cities = Array.isArray(req.body?.cities) ? req.body.cities : [];

  try {
    const data = await parser.post(`/api/jobs/${encodeURIComponent(req.params.jobId)}/confirm`, { cities });
    console.log(`✅ Разбор ${req.params.jobId} подтверждён пользователем ${req.user?.username}` + (cities.length ? `, города: ${cities.join(', ')}` : ''));
    res.json({ success: true, data });
  } catch (err) {
    // 409 — задача уже подтверждена или потеряна; это не поломка связи,
    // и страницу надо просто перечитать
    if (err.response?.status === 409) {
      return res.status(409).json({
        success: false,
        error: 'job_not_awaiting',
        message: 'Задача уже подтверждена или потеряна — обновите страницу'
      });
    }
    fail(res, err, `confirm ${req.params.jobId}`);
  }
});

/** Обойти заново уже заведённый источник — без подтверждения. */
router.post('/sources/:id/refresh', ...canManage, async (req, res) => {
  try {
    const data = await parser.post(`/api/sources/${encodeURIComponent(req.params.id)}/refresh`);
    console.log(`🔄 Обход источника ${req.params.id} запущен пользователем ${req.user?.username}`);
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, `refresh ${req.params.id}`);
  }
});

module.exports = router;
