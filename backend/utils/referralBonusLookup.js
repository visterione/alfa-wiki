'use strict';

function normalizeServiceCode(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeRequestedCodes(values, maxLength = 100) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map(value => String(value || '').trim().slice(0, maxLength))
    .filter(Boolean))];
}

function filterBonusesByCodes(bonuses, requestedCodes) {
  const normalized = new Set(requestedCodes.map(normalizeServiceCode).filter(Boolean));
  return bonuses.filter(bonus => normalized.has(normalizeServiceCode(bonus.serviceCode)));
}

function bonusesByServiceCode(serviceCodes, bonuses) {
  const result = Object.fromEntries(serviceCodes.map(code => [code, {}]));
  bonuses.forEach(bonus => {
    if (!result[bonus.serviceCode]) result[bonus.serviceCode] = {};
    result[bonus.serviceCode][bonus.misUserId] = {
      id: bonus.id,
      bonusPercent: bonus.bonusPercent,
      bonusRub: bonus.bonusRub,
    };
  });
  return result;
}

module.exports = {
  normalizeServiceCode,
  normalizeRequestedCodes,
  filterBonusesByCodes,
  bonusesByServiceCode,
};
