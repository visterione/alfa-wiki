'use strict';

/**
 * Ночная синхронизация прайсов конкурентов из alfa-parser.
 *
 * Обход сайтов планирует сам парсер (у него свой systemd-таймер), а мы только
 * забираем текущие цены. Расписания намеренно не связаны: забор идемпотентен —
 * его можно повторить, прервать и позвать днём, ничего не сломается. Данные
 * от этого будут не свежее последнего обхода, и это нормально.
 *
 * Стратегия записи: услуги обновляются на месте, цены переписываются целиком.
 *   — у услуги id обязан пережить синхронизацию, иначе сопоставления с нашими
 *     услугами рвались бы каждую ночь;
 *   — на цены никто не ссылается, поэтому «удалить и вставить» и проще,
 *     и быстрее, чем 67 тысяч точечных UPDATE.
 */

const { sequelize, CompetitorSource, CompetitorService, CompetitorPrice } = require('../models');
const parser = require('./parserClient');
const { normalizeName, normalizeCode } = require('./competitorMatching');

// В запрос Postgres влезает 65535 параметров, а в строке услуги их около
// десятка — на 6778 услугах одним INSERT'ом лимит выносится. Режем с запасом.
const INSERT_CHUNK = 1000;

const chunk = (items, size) => {
  const parts = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
};

/** Строка источника в вики: заводим при первой встрече, дальше обновляем. */
async function upsertSource(remote) {
  const lastRun = remote.last_run || null;
  const fields = {
    name: remote.name,
    baseUrl: remote.base_url,
    city: remote.city || null,
    servicesTotal: remote.services_total || 0,
    lastRunAt: lastRun?.finished_at || lastRun?.started_at || null,
    lastRunStatus: lastRun?.status || null
  };

  const existing = await CompetitorSource.findOne({ where: { parserSourceId: remote.id } });
  if (existing) {
    await existing.update(fields);
    return existing;
  }
  return CompetitorSource.create({ parserSourceId: remote.id, ...fields });
}

/**
 * Один источник целиком: забрать каталог и переписать его у себя.
 *
 * Сеть и база разведены намеренно: сначала выкачиваем все страницы, и только
 * потом открываем транзакцию. Иначе она висела бы открытой всё время, пока
 * мы ходим по сети.
 */
async function syncSource(remote) {
  const source = await upsertSource(remote);

  try {
    const { services } = await parser.fetchCatalog(remote.id);
    const now = new Date();

    await sequelize.transaction(async (transaction) => {
      // Гасим всё разом, а поимённая перекличка ниже зажжёт обратно тех, кто
      // пришёл. Так не нужен NOT IN со списком в семь тысяч идентификаторов.
      await CompetitorService.update(
        { isActive: false },
        { where: { sourceId: source.id }, transaction }
      );

      const serviceRows = services.map(service => ({
        sourceId: source.id,
        parserServiceId: service.id,
        externalId: service.external_id || null,
        name: service.name,
        // под триграммный поиск при сопоставлении — считаем здесь, чтобы
        // не пересчитывать на каждый запрос
        nameNormalized: normalizeName(service.name),
        url: service.url || null,
        category: service.category || null,
        categoryPath: service.category_path || [],
        turnaround: service.turnaround || null,
        // коды приводим к одному алфавиту здесь: сравнивать их придётся
        // с нашими, а там кириллическая «А» соседствует с латинской
        codes: (service.codes || []).map(normalizeCode).filter(Boolean),
        isActive: true,
        lastSeenAt: service.last_seen || null
      }));

      for (const part of chunk(serviceRows, INSERT_CHUNK)) {
        await CompetitorService.bulkCreate(part, {
          transaction,
          updateOnDuplicate: [
            'sourceId', 'externalId', 'name', 'nameNormalized', 'url', 'category',
            'categoryPath', 'turnaround', 'codes', 'isActive', 'lastSeenAt', 'updatedAt'
          ]
        });
      }

      // id услуг в вики — свои (UUID), поэтому цены раскладываем по карте
      // «id в парсере → id у нас», собранной уже после записи услуг
      const stored = await CompetitorService.findAll({
        where: { sourceId: source.id },
        attributes: ['id', 'parserServiceId'],
        transaction,
        raw: true
      });
      const idByParserId = new Map(stored.map(row => [row.parserServiceId, row.id]));

      // Подзапросом, а не списком id: услуг тысячи, и IN на них раздувает запрос
      await sequelize.query(
        'DELETE FROM competitor_prices WHERE "serviceId" IN (SELECT id FROM competitor_services WHERE "sourceId" = :sourceId)',
        { replacements: { sourceId: source.id }, transaction }
      );

      const priceRows = [];
      for (const service of services) {
        const serviceId = idByParserId.get(service.id);
        if (!serviceId) continue;

        for (const price of service.prices || []) {
          priceRows.push({
            serviceId,
            filialId: price.filial_id ?? null,
            filialName: price.filial_name || null,
            // цены приходят строками и строками же ложатся в numeric:
            // в JS-число они бы приехали как 1234.5600000000001
            price: price.price,
            priceMin: price.price_min,
            priceMax: price.price_max,
            priceDiscount: price.price_discount,
            currency: price.currency || 'RUB',
            observedAt: price.updated_at || null
          });
        }
      }

      for (const part of chunk(priceRows, INSERT_CHUNK)) {
        await CompetitorPrice.bulkCreate(part, { transaction });
      }

      await source.update(
        { syncedAt: now, syncStatus: 'ok', syncError: null, servicesTotal: services.length },
        { transaction }
      );

      console.log(`   ✅ ${remote.name}${remote.city ? ` (${remote.city})` : ''}: услуг ${services.length}, цен ${priceRows.length}`);
    });

    return { ok: true, source: remote.name, services: services.length };
  } catch (err) {
    // Источник, который не забрался, не должен ронять остальные:
    // отмечаем и идём дальше
    const described = parser.describeError(err);
    const message = described.error === 'parser_error' ? err.message : described.message;
    await source.update({ syncStatus: 'failed', syncError: message });
    console.error(`   ❌ ${remote.name}: ${message}`);
    return { ok: false, source: remote.name, error: message };
  }
}

/** Все источники парсера подряд. */
async function syncAll() {
  const started = Date.now();
  console.log('🔄 Синхронизация прайсов конкурентов: запрашиваем список источников...');

  let sources;
  try {
    sources = await parser.listSources();
  } catch (err) {
    // Список не отдался — значит связи нет вовсе, и по источникам идти незачем
    const { message } = parser.describeError(err);
    console.error('❌ Синхронизация прайсов конкурентов не начата:', message);
    throw new Error(message);
  }

  console.log(`   источников у парсера: ${sources.length}`);
  const results = [];
  for (const remote of sources) {
    results.push(await syncSource(remote));
  }

  const failed = results.filter(r => !r.ok);
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(
    `🏁 Синхронизация прайсов конкурентов завершена за ${seconds} с: ` +
    `успешно ${results.length - failed.length} из ${results.length}` +
    (failed.length ? `, с ошибкой: ${failed.map(f => f.source).join(', ')}` : '')
  );

  return { total: results.length, failed: failed.length, results, seconds };
}

module.exports = { syncAll, syncSource };
