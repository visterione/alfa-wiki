/**
 * Cron-задача для автоматического обновления цен анализов из МИС
 * Запускается раз в 7 дней
 * 
 * Добавь в server.js:
 * require('./cron/analysesCron');
 */

const cron = require('node-cron');
const axios = require('axios');
const qs = require('qs');
const { Analysis, SearchIndex } = require('../models');
const { Op } = require('sequelize');

// MIS API конфигурация
const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT = 15000;

const ANALYSES_PAGE_SLUG = 'analyses';

// === HELPER: Запрос к MIS API ===
const misRequest = async (endpoint, params = {}) => {
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
    console.error(`MIS API error (${endpoint}):`, err.message);
    return null;
  }
};

// === HELPER: Индексация анализа ===
const indexAnalysis = async (analysis) => {
  const searchContent = [
    analysis.lab,
    analysis.serviceCode,
    analysis.serviceName,
    analysis.price ? `${analysis.price} руб` : '',
    analysis.isStopped ? 'не выполняется' : 'выполняется',
    analysis.comment
  ].filter(Boolean).join(' | ');

  const title = `${analysis.serviceName} (${analysis.lab})`;

  const keywords = [
    analysis.lab?.toLowerCase(),
    analysis.serviceCode?.toLowerCase(),
    analysis.serviceName?.toLowerCase().split(' '),
    'анализ',
    'лаборатория',
    'исследование',
    'диагностика'
  ].flat().filter(Boolean);

  await SearchIndex.upsert({
    entityType: 'analysis',
    entityId: analysis.id,
    title: title,
    content: searchContent,
    keywords: keywords,
    url: `/page/${ANALYSES_PAGE_SLUG}?highlight=${analysis.id}`,
    metadata: {
      pageSlug: ANALYSES_PAGE_SLUG,
      lab: analysis.lab,
      serviceCode: analysis.serviceCode,
      serviceName: analysis.serviceName,
      price: analysis.price,
      isStopped: analysis.isStopped
    }
  });
};

// === Функция обновления цен ===
const updateAnalysesPrices = async () => {
  try {
    console.log('🔄 [CRON] Начало обновления цен анализов из МИС...');

    const analysesWithMisId = await Analysis.findAll({
      where: {
        misServiceId: { [Op.ne]: null }
      }
    });

    if (analysesWithMisId.length === 0) {
      console.log('ℹ️ [CRON] Нет анализов с привязкой к МИС');
      return;
    }

    console.log(`📊 [CRON] Найдено анализов с MIS ID: ${analysesWithMisId.length}`);

    // Группируем ID услуг для массового запроса (МИС принимает до ~100 ID за раз)
    const batchSize = 100;
    let totalUpdated = 0;

    for (let i = 0; i < analysesWithMisId.length; i += batchSize) {
      const batch = analysesWithMisId.slice(i, i + batchSize);
      const serviceIds = batch.map(a => a.misServiceId).join(',');

      console.log(`🔍 [CRON] Запрос batch ${Math.floor(i / batchSize) + 1}: ${batch.length} услуг`);

      const misData = await misRequest('getServices', {
        service_id: serviceIds
      });

      if (!misData || misData.error !== 0 || !Array.isArray(misData.data)) {
        console.error('❌ [CRON] Ошибка получения данных из МИС для batch');
        continue;
      }

      // Создаем карту цен из МИС
      const priceMap = new Map();
      misData.data.forEach(service => {
        priceMap.set(service.service_id.toString(), parseFloat(service.price) || 0);
      });

      // Обновляем цены в этом batch
      for (const analysis of batch) {
        const newPrice = priceMap.get(analysis.misServiceId);
        if (newPrice !== undefined && Math.abs(newPrice - parseFloat(analysis.price)) > 0.01) {
          const oldPrice = analysis.price;
          await analysis.update({
            price: newPrice,
            lastPriceUpdate: new Date()
          });
          await indexAnalysis(analysis);
          totalUpdated++;
          console.log(`💰 [CRON] ${analysis.serviceName}: ${oldPrice} → ${newPrice}`);
        }
      }

      // Небольшая задержка между batch-ами
      if (i + batchSize < analysesWithMisId.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`✅ [CRON] Обновление завершено. Обновлено: ${totalUpdated} из ${analysesWithMisId.length}`);
  } catch (error) {
    console.error('❌ [CRON] Ошибка при обновлении цен анализов:', error);
  }
};

// ═══════════════════════════════════════════════════════════════
// НАСТРОЙКА РАСПИСАНИЯ
// ═══════════════════════════════════════════════════════════════

// Запуск каждые 7 дней в 02:00
// Формат: секунды минуты часы день месяц день_недели
cron.schedule('0 2 * * 0', async () => {
  console.log('⏰ [CRON] Запуск еженедельного обновления цен анализов...');
  await updateAnalysesPrices();
}, {
  scheduled: true,
  timezone: "Europe/Moscow"
});

// Также можно запустить сразу при старте сервера (закомментируй если не нужно)
// setTimeout(() => {
//   console.log('🚀 [CRON] Первичное обновление цен анализов при старте сервера...');
//   updateAnalysesPrices();
// }, 10000); // Через 10 секунд после запуска

console.log('✅ Cron для обновления цен анализов инициализирован (каждое воскресенье в 02:00)');

module.exports = { updateAnalysesPrices };