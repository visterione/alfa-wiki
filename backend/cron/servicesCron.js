/**
 * Cron-задача для автоматического обновления цен услуг из МИС
 * Запускается раз в 7 дней (каждое воскресенье в 03:00 МСК)
 */

const cron = require('node-cron');
const axios = require('axios');
const qs = require('qs');
const { Service, SearchIndex } = require('../models');
const { Op } = require('sequelize');

// MIS API конфигурация
const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT = 15000;

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

// === HELPER: Индексация услуги ===
const indexService = async (service) => {
  const searchContent = [
    service.medCenter,
    service.serviceCode,
    service.serviceName,
    service.price ? `${service.price} руб` : '',
    service.isStopped ? 'не выполняется' : 'выполняется',
    service.comment
  ].filter(Boolean).join(' | ');

  const keywords = [
    service.medCenter?.toLowerCase(),
    service.serviceCode?.toLowerCase(),
    service.serviceName?.toLowerCase().split(' '),
    'услуга',
    'сервис',
    'медицинская услуга'
  ].flat().filter(Boolean);

  await SearchIndex.upsert({
    entityType: 'service',
    entityId: service.id,
    title: service.serviceName,
    content: searchContent,
    keywords: keywords,
    url: `/page/${service.pageSlug}?highlight=${service.id}`,
    metadata: {
      pageSlug: service.pageSlug,
      medCenter: service.medCenter,
      serviceCode: service.serviceCode,
      serviceName: service.serviceName,
      price: service.price,
      isStopped: service.isStopped
    }
  });
};

// === Функция обновления цен ===
const updateServicesPrices = async () => {
  try {
    console.log('🔄 [CRON] Начало обновления цен услуг из МИС...');

    const servicesWithMisId = await Service.findAll({
      where: {
        misServiceId: { [Op.ne]: null }
      }
    });

    if (servicesWithMisId.length === 0) {
      console.log('ℹ️ [CRON] Нет услуг с привязкой к МИС');
      return;
    }

    console.log(`📊 [CRON] Найдено услуг с MIS ID: ${servicesWithMisId.length}`);

    const batchSize = 100;
    let totalUpdated = 0;

    for (let i = 0; i < servicesWithMisId.length; i += batchSize) {
      const batch = servicesWithMisId.slice(i, i + batchSize);
      const serviceIds = batch.map(s => s.misServiceId).join(',');

      console.log(`🔍 [CRON] Запрос batch ${Math.floor(i / batchSize) + 1}: ${batch.length} услуг`);

      const misData = await misRequest('getServices', {
        service_id: serviceIds
      });

      if (!misData || misData.error !== 0 || !Array.isArray(misData.data)) {
        console.error('❌ [CRON] Ошибка получения данных из МИС для batch');
        continue;
      }

      const priceMap = new Map();
      misData.data.forEach(service => {
        priceMap.set(service.service_id.toString(), parseFloat(service.price) || 0);
      });

      for (const service of batch) {
        const newPrice = priceMap.get(service.misServiceId);
        if (newPrice !== undefined && Math.abs(newPrice - parseFloat(service.price)) > 0.01) {
          const oldPrice = service.price;
          await service.update({
            price: newPrice,
            lastPriceUpdate: new Date()
          });
          await indexService(service);
          totalUpdated++;
          console.log(`💰 [CRON] ${service.serviceName} (${service.medCenter}): ${oldPrice} → ${newPrice}`);
        }
      }

      if (i + batchSize < servicesWithMisId.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`✅ [CRON] Обновление завершено. Обновлено: ${totalUpdated} из ${servicesWithMisId.length}`);
  } catch (error) {
    console.error('❌ [CRON] Ошибка при обновлении цен услуг:', error);
  }
};

// Запуск каждый день в 03:00 (час после анализов)
cron.schedule('0 3 * * *', async () => {
  console.log('⏰ [CRON] Запуск ежедневного обновления цен услуг...');
  await updateServicesPrices();
}, {
  scheduled: true,
  timezone: "Europe/Moscow"
});

console.log('✅ Cron для обновления цен услуг инициализирован (ежедневно в 03:00)');

module.exports = { updateServicesPrices };
