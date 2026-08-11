/**
 * Cron-задача для ночного кэширования услуг всех медцентров из МИС
 * Запускается каждую ночь в 02:00 МСК
 *
 * Стратегия:
 * - Получаем категории, затем для каждого медцентра × категория делаем отдельный запрос
 * - show_children: false — только текущая категория, контроль объёма
 * - Задержка 1.5 сек между запросами, чтобы не перегружать МИС
 * - ECONNRESET/таймаут → retry × 2, потом пропуск с логом
 * - UPSERT по (clinicId, serviceId) — обновляем только изменившиеся записи
 */

const axios = require('axios');
const qs = require('qs');
const { PartnerServiceCache, sequelize } = require('../models');
const { Op } = require('sequelize');

const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT = 30000; // 30 сек — категории могут быть большими
const DELAY_BETWEEN_REQUESTS = 1500; // 1.5 сек между запросами к МИС
const MAX_RETRIES = 2;

// Список медцентров приходит из справочника (ver. 6.67): новый филиал попадает в
// синхронизацию сам, без правки этого файла. Раньше список был захардкожен здесь
// и дублировал такой же в routes/partner-services.js.
const medCenters = require('../services/medCenters');

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const misRequest = async (endpoint, params = {}, attempt = 1) => {
  try {
    const response = await axios.post(
      `${MIS_BASE_URL}/${endpoint}`,
      qs.stringify({ api_key: MIS_API_KEY, ...params }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: MIS_TIMEOUT
      }
    );
    return response.data;
  } catch (err) {
    const retryable = ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND'].includes(err.code)
      || (err.response && err.response.status >= 500);

    if (retryable && attempt <= MAX_RETRIES) {
      console.warn(`⚠️  [PARTNER-SYNC] Retry ${attempt}/${MAX_RETRIES} для ${endpoint}: ${err.message}`);
      await sleep(DELAY_BETWEEN_REQUESTS * attempt);
      return misRequest(endpoint, params, attempt + 1);
    }

    console.error(`❌ [PARTNER-SYNC] МИС ошибка (${endpoint}): ${err.message}`);
    return null;
  }
};

// Строим плоский список листовых категорий из дерева
const flattenCategories = (categories, parentPath = '') => {
  const result = [];
  if (!Array.isArray(categories)) return result;

  for (const cat of categories) {
    const path = parentPath ? `${parentPath} > ${cat.title}` : cat.title;
    if (Array.isArray(cat.children) && cat.children.length > 0) {
      result.push(...flattenCategories(cat.children, path));
    } else {
      result.push({ id: cat.id, title: cat.title, path });
    }
  }
  return result;
};

// ─── Основная функция синхронизации ─────────────────────────────────────────

// Защита от параллельного запуска в рамках одного процесса (ночной крон + ручной /sync)
let isSyncing = false;

// opts.clinicIds — необязательный массив id медцентров для частичной синхронизации
// (например, чтобы догрузить только новый медцентр). По умолчанию — все клиники,
// которые есть в МИС, по справочнику медцентров.
const syncPartnerServicesCache = async (opts = {}) => {
  if (isSyncing) {
    console.warn('⚠️  [PARTNER-SYNC] Синхронизация уже выполняется — пропуск повторного запуска.');
    return { success: false, reason: 'already_running' };
  }
  isSyncing = true;
  const startTime = Date.now();
  const clinicIds = Array.isArray(opts.clinicIds) && opts.clinicIds.length ? opts.clinicIds : null;
  const allClinics = await medCenters.misClinics();
  const clinicsToSync = clinicIds ? allClinics.filter(c => clinicIds.includes(c.id)) : allClinics;
  console.log(`🚀 [PARTNER-SYNC] Начало синхронизации кэша услуг партнёров${clinicIds ? ` (только медцентры: ${clinicIds.join(', ')})` : ''}...`);

  // Убеждаемся что таблица существует
  try {
    await PartnerServiceCache.sync({ alter: false });
  } catch (e) {
    // таблица уже есть — ок
  }

  // 1. Получаем дерево категорий (один раз для всех медцентров)
  console.log('📂 [PARTNER-SYNC] Получение категорий из МИС...');
  const catData = await misRequest('getServiceCategories', {});
  if (!catData || catData.error !== 0 || !Array.isArray(catData.data)) {
    console.error('❌ [PARTNER-SYNC] Не удалось получить категории. Прерываем.');
    isSyncing = false;
    return { success: false, reason: 'categories_failed' };
  }

  const leafCategories = flattenCategories(catData.data);
  console.log(`📋 [PARTNER-SYNC] Найдено листовых категорий: ${leafCategories.length}`);

  let totalUpserted = 0;
  let totalSkipped = 0;
  const syncedAt = new Date();
  const clinicStats = {};

  // 2. Для каждого медцентра — обходим категории по одной
  for (const clinic of clinicsToSync) {
    console.log(`\n🏥 [PARTNER-SYNC] Медцентр: ${clinic.name} (id=${clinic.id})`);
    let clinicUpserted = 0;
    let clinicSkipped = 0;

    for (let i = 0; i < leafCategories.length; i++) {
      const cat = leafCategories[i];

      const data = await misRequest('getServices', {
        category_id: cat.id,
        clinic_id: clinic.id,
        show_children: false,
        show_all: 1,
        show_deleted: 0
      });

      await sleep(DELAY_BETWEEN_REQUESTS);

      if (!data || data.error !== 0) {
        console.warn(`  ⚠️  Пропуск категории "${cat.title}" (ошибка МИС)`);
        clinicSkipped++;
        continue;
      }

      const services = Array.isArray(data.data) ? data.data : [];
      if (services.length === 0) continue;

      // UPSERT пачками
      const records = services.map(s => ({
        clinicId: clinic.id,
        serviceId: parseInt(s.service_id),
        code: s.code || null,
        subCode: s.sub_code || null,
        title: s.title || '',
        categoryId: parseInt(s.category_id) || null,
        categoryTitle: s.category_title || cat.title,
        categoryPath: s.category_path || cat.path,
        price: parseFloat(s.price) || 0,
        costPrice: parseFloat(s.original_price) || null,
        duration: parseInt(s.duration) || null,
        lab: s.lab || null,
        isHidden: s.is_hidden ? true : false,
        isDeleted: s.is_deleted ? true : false,
        syncedAt
      }));

      try {
        await sequelize.transaction(async (t) => {
          for (const rec of records) {
            await PartnerServiceCache.upsert(rec, {
              conflictFields: ['clinicId', 'serviceId'],
              transaction: t
            });
          }
        });
        clinicUpserted += records.length;
      } catch (dbErr) {
        console.error(`  ❌ DB ошибка для категории "${cat.title}":`, dbErr.message);
        clinicSkipped++;
      }

      if ((i + 1) % 20 === 0) {
        console.log(`  📊 ${clinic.name}: ${i + 1}/${leafCategories.length} категорий, ${clinicUpserted} услуг`);
      }
    }

    totalUpserted += clinicUpserted;
    totalSkipped += clinicSkipped;
    clinicStats[clinic.name] = { upserted: clinicUpserted, skipped: clinicSkipped };
    console.log(`  ✅ ${clinic.name}: ${clinicUpserted} услуг (пропущено категорий: ${clinicSkipped})`);

    // Поклиничная очистка устаревших записей сразу после завершения медцентра.
    // Делает синк устойчивым к прерыванию: каждый завершённый медцентр остаётся
    // полностью свежим, без «хвостов» старых service_id (как было со stale-записями).
    // Защита: пропускаем очистку, если слишком много категорий не загрузилось
    // (сбой МИС) — иначе можно удалить ещё валидные услуги.
    const skipThreshold = Math.max(5, Math.ceil(leafCategories.length * 0.05));
    if (clinicUpserted > 0 && clinicSkipped <= skipThreshold) {
      try {
        const removed = await PartnerServiceCache.destroy({
          where: { clinicId: clinic.id, syncedAt: { [Op.lt]: syncedAt } }
        });
        if (removed > 0) console.log(`  🗑️  ${clinic.name}: удалено устаревших записей: ${removed}`);
      } catch (e) {
        console.warn(`  ⚠️  ${clinic.name}: не удалось очистить устаревшие записи:`, e.message);
      }
    } else if (clinicSkipped > skipThreshold) {
      console.warn(`  ⚠️  ${clinic.name}: очистка пропущена (пропущено категорий ${clinicSkipped} > ${skipThreshold}), чтобы не удалить валидные услуги.`);
    }
  }

  // 3. Глобальный «страховочный» проход: удаляем записи старше 2 суток
  // (на случай медцентров, по которым поклиничная очистка была пропущена из-за сбоев МИС).
  // Для частичной синхронизации пропускаем — иначе удалим записи нетронутых медцентров.
  if (!clinicIds) {
    try {
      const twoDaysAgo = new Date(startTime - 2 * 24 * 60 * 60 * 1000);
      const deleted = await PartnerServiceCache.destroy({
        where: { syncedAt: { [Op.lt]: twoDaysAgo } }
      });
      if (deleted > 0) {
        console.log(`🗑️  [PARTNER-SYNC] Удалено устаревших записей: ${deleted}`);
      }
    } catch (e) {
      console.warn('⚠️  [PARTNER-SYNC] Не удалось удалить устаревшие записи:', e.message);
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n✅ [PARTNER-SYNC] Синхронизация завершена за ${elapsed} сек.`);
  console.log(`   Всего записей: ${totalUpserted}, пропущено категорий: ${totalSkipped}`);
  console.log('   По медцентрам:', JSON.stringify(clinicStats));

  isSyncing = false;
  return { success: true, totalUpserted, totalSkipped, elapsed, clinicStats };
};

// Расписание вынесено в отдельный кросс-платформенный воркер scripts/syncWorker.js
// (запускается отдельным процессом, не зависит от веб-сервера/nodemon).
// Здесь модуль только экспортирует функцию синхронизации.

module.exports = { syncPartnerServicesCache };
