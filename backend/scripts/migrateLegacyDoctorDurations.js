#!/usr/bin/env node
'use strict';

/**
 * Переносит однозначные aliasDuration из doctor_cards.metadata в таблицу
 * doctor_service_durations. По умолчанию только печатает аудит; запись — с --apply.
 */

const { DoctorCard, DoctorServiceDuration, sequelize } = require('../models');
const { parseDurationMinutes } = require('../services/bookingDurationService');

const OLD_TO_MIS_CLINIC = { 1: 2, 2: 3, 3: 1, 4: 6, 5: 4, 6: 7 };
const canonicalClinicId = value => String(OLD_TO_MIS_CLINIC[value] || value || '').trim();

async function main() {
  const apply = process.argv.includes('--apply');
  await sequelize.authenticate();
  const cards = await DoctorCard.findAll({ attributes: ['id', 'fullName', 'pageSlug', 'metadata'] });
  const candidates = new Map();
  const invalid = [];

  for (const card of cards) {
    const meta = card.metadata || {};
    const doctorId = String(meta.misUserId || '').trim();
    if (!doctorId) continue;
    const clinics = [...new Set((meta.clinics || []).map(canonicalClinicId).filter(Boolean))];
    for (const [serviceId, override] of Object.entries(meta.serviceOverrides || {})) {
      const raw = override?.aliasDuration;
      if (raw == null || String(raw).trim() === '') continue;
      const duration = parseDurationMinutes(raw);
      if (!duration || clinics.length === 0) {
        invalid.push({ card: card.fullName, page: card.pageSlug, serviceId, value: raw, reason: duration ? 'нет клиники' : 'неоднозначное значение' });
        continue;
      }
      for (const clinicId of clinics) {
        const key = `${doctorId}:${clinicId}:${serviceId}`;
        if (!candidates.has(key)) candidates.set(key, []);
        candidates.get(key).push({ doctorId, clinicId, serviceId, duration, cardId: card.id, cardName: card.fullName, page: card.pageSlug });
      }
    }
  }

  const ready = [];
  const conflicts = [];
  for (const [key, rows] of candidates) {
    const values = [...new Set(rows.map(row => row.duration))];
    if (values.length > 1) conflicts.push({ key, values, rows });
    else ready.push(rows[0]);
  }

  console.log(`Карточек просмотрено: ${cards.length}`);
  console.log(`Однозначных комбинаций: ${ready.length}`);
  console.log(`Некорректных/неполных значений: ${invalid.length}`);
  console.log(`Конфликтующих комбинаций: ${conflicts.length}`);
  if (invalid.length) {
    console.log('\nНекорректные значения:');
    invalid.slice(0, 100).forEach(item => console.log(`- ${item.card} [${item.page}], услуга ${item.serviceId}: «${item.value}» (${item.reason})`));
  }
  if (conflicts.length) {
    console.log('\nКонфликты (не переносятся автоматически):');
    conflicts.slice(0, 100).forEach(item => console.log(`- ${item.key}: ${item.values.join(' / ')} мин; карточки: ${item.rows.map(r => r.page).join(', ')}`));
  }
  if (!apply) {
    console.log('\nРежим аудита: данные не изменены. Для переноса запустите с --apply.');
    return;
  }

  await sequelize.transaction(async transaction => {
    for (const row of ready) {
      await DoctorServiceDuration.upsert({
        misUserId: row.doctorId,
        clinicId: row.clinicId,
        serviceId: row.serviceId,
        durationMinutes: row.duration,
        sourceCardId: row.cardId
      }, { transaction });
    }
  });
  console.log(`\n✅ Перенесено комбинаций: ${ready.length}. Конфликты и ошибки оставлены без изменений.`);
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error('❌ Аудит/перенос не выполнен:', error.message);
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
