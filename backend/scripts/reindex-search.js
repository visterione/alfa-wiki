#!/usr/bin/env node
/**
 * Скрипт для переиндексации поисковых данных
 * Исправляет проблему с отсутствующим metadata.pageSlug
 */

const { Analysis, Accreditation, Vehicle, SearchIndex } = require('../models');

const ANALYSES_PAGE_SLUG = 'analyses';
const ACCREDITATIONS_PAGE_SLUG = 'accreditations';
const VEHICLES_PAGE_SLUG = 'vehicles';

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

  const title = analysis.serviceName;

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

// === HELPER: Индексация аккредитации ===
const indexAccreditation = async (accreditation) => {
  const searchContent = [
    accreditation.fullName,
    accreditation.specialty,
    accreditation.medCenter,
    accreditation.comment
  ].filter(Boolean).join(' | ');

  const title = `${accreditation.fullName} — ${accreditation.specialty}`;

  const keywords = [
    accreditation.medCenter?.toLowerCase(),
    accreditation.specialty?.toLowerCase(),
    'аккредитация',
    'сертификат',
    'врач'
  ].filter(Boolean);

  await SearchIndex.upsert({
    entityType: 'accreditation',
    entityId: accreditation.id,
    title: title,
    content: searchContent,
    keywords: keywords,
    url: `/page/${ACCREDITATIONS_PAGE_SLUG}?highlight=${accreditation.id}`,
    metadata: {
      pageSlug: ACCREDITATIONS_PAGE_SLUG,
      medCenter: accreditation.medCenter,
      specialty: accreditation.specialty,
      expirationDate: accreditation.expirationDate,
      fullName: accreditation.fullName
    }
  });
};

// === HELPER: Индексация транспорта ===
const indexVehicle = async (vehicle) => {
  const searchContent = [
    vehicle.carBrand,
    vehicle.organization,
    vehicle.licensePlate,
    vehicle.condition,
    vehicle.comment
  ].filter(Boolean).join(' | ');

  const title = `${vehicle.carBrand} — ${vehicle.licensePlate}`;

  const keywords = [
    vehicle.organization?.toLowerCase(),
    vehicle.carBrand?.toLowerCase(),
    vehicle.licensePlate?.toLowerCase(),
    'авто',
    'машина',
    'транспорт',
    'то',
    'страховка'
  ].filter(Boolean);

  await SearchIndex.upsert({
    entityType: 'vehicle',
    entityId: vehicle.id,
    title: title,
    content: searchContent,
    keywords: keywords,
    url: `/page/${VEHICLES_PAGE_SLUG}?highlight=${vehicle.id}`,
    metadata: {
      pageSlug: VEHICLES_PAGE_SLUG,
      organization: vehicle.organization,
      licensePlate: vehicle.licensePlate,
      carBrand: vehicle.carBrand,
      insuranceDate: vehicle.insuranceDate,
      mileage: vehicle.mileage,
      nextTO: vehicle.nextTO
    }
  });
};

// === MAIN ===
const main = async () => {
  try {
    console.log('🔄 Начинаем переиндексацию...\n');

    // 1. Переиндексация анализов
    console.log('📊 Переиндексация анализов...');
    const analyses = await Analysis.findAll();
    for (const analysis of analyses) {
      await indexAnalysis(analysis);
    }
    console.log(`✅ Проиндексировано ${analyses.length} анализов\n`);

    // 2. Переиндексация аккредитаций
    console.log('🎓 Переиндексация аккредитаций...');
    const accreditations = await Accreditation.findAll();
    for (const accreditation of accreditations) {
      await indexAccreditation(accreditation);
    }
    console.log(`✅ Проиндексировано ${accreditations.length} аккредитаций\n`);

    // 3. Переиндексация транспорта
    console.log('🚗 Переиндексация транспорта...');
    const vehicles = await Vehicle.findAll();
    for (const vehicle of vehicles) {
      await indexVehicle(vehicle);
    }
    console.log(`✅ Проиндексировано ${vehicles.length} единиц транспорта\n`);

    console.log('🎉 Переиндексация завершена успешно!');
    console.log('\nПроверим результат:');

    // Проверка
    const analysisCheck = await SearchIndex.findOne({
      where: { entityType: 'analysis' }
    });
    console.log('Пример анализа:');
    console.log('  - Title:', analysisCheck.title);
    console.log('  - pageSlug:', analysisCheck.metadata?.pageSlug);

    const accrCheck = await SearchIndex.findOne({
      where: { entityType: 'accreditation' }
    });
    if (accrCheck) {
      console.log('Пример аккредитации:');
      console.log('  - Title:', accrCheck.title);
      console.log('  - pageSlug:', accrCheck.metadata?.pageSlug);
    }

    const vehCheck = await SearchIndex.findOne({
      where: { entityType: 'vehicle' }
    });
    if (vehCheck) {
      console.log('Пример транспорта:');
      console.log('  - Title:', vehCheck.title);
      console.log('  - pageSlug:', vehCheck.metadata?.pageSlug);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при переиндексации:', error);
    process.exit(1);
  }
};

// Запуск
main();
