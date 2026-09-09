'use strict';

// Метаданные живут рядом со ставкой в JSONB. Они не влияют на расчёт зарплаты,
// зато позволяют снять именно ставку подразделения и восстановить прежнюю личную.
const SOURCES = 'divisionRateSources';
const BASE = 'divisionRateBase';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizedRate(entry) {
  if (!entry || entry.value == null || entry.value === '') return null;
  const rate = Number(entry.rate);
  if (!Number.isFinite(rate) || rate < 0) return null;
  return {
    ...entry,
    id: String(entry.id || ''),
    value: String(entry.value),
    clinic: String(entry.clinic || 'global'),
    rate,
    overwrite: !!entry.overwrite,
  };
}

function normalizedRates(rates) {
  return (Array.isArray(rates) ? rates : []).map(normalizedRate).filter(Boolean);
}

function cloneSettings(raw) {
  const settings = clone(raw && typeof raw === 'object' ? raw : {}) || {};
  if (!settings.clinicSettings || typeof settings.clinicSettings !== 'object') {
    settings.clinicSettings = {};
  }
  if (!settings.clinicSettings.global) settings.clinicSettings.global = { roleRates: [] };
  return settings;
}

function ensureClinic(settings, clinic) {
  if (!settings.clinicSettings[clinic]) {
    const global = settings.clinicSettings.global || { roleRates: [] };
    settings.clinicSettings[clinic] = {
      ...clone(global),
      roleRates: clone(global.roleRates || []),
    };
  }
  const data = settings.clinicSettings[clinic];
  if (!Array.isArray(data.roleRates)) data.roleRates = [];
  return data;
}

function clinicEligible(entry, eligibleClinicIds) {
  if (entry.clinic === 'global' || !eligibleClinicIds) return true;
  return eligibleClinicIds.has(entry.clinic);
}

function rateWasApplied(settings, divisionId, entry) {
  const clinic = settings.clinicSettings?.[entry.clinic];
  const current = clinic?.roleRates?.find(item => String(item.roleTitle) === entry.value);
  if (!current) return false;
  const sources = Array.isArray(current[SOURCES]) ? current[SOURCES] : [];
  if (sources.some(item =>
    String(item.divisionId) === String(divisionId) && String(item.rateId) === entry.id
  )) return true;
  // До появления метаданных принадлежность можно определить только по точному
  // совпадению ключа и суммы. Это тот же безопасный fallback, что и при снятии.
  return sources.length === 0 && Number(current.rate) === entry.rate;
}

function applyOne(settings, divisionId, entry, { force = false, eligibleClinicIds = null } = {}) {
  if (!clinicEligible(entry, eligibleClinicIds)) return false;
  const clinic = ensureClinic(settings, entry.clinic);
  const index = clinic.roleRates.findIndex(item => String(item.roleTitle) === entry.value);
  const source = { divisionId: String(divisionId), rateId: entry.id, rate: entry.rate };

  if (index < 0) {
    clinic.roleRates.push({
      roleTitle: entry.value,
      rate: entry.rate,
      [SOURCES]: [source],
      [BASE]: { hadItem: false },
    });
    return true;
  }

  const current = clinic.roleRates[index];
  const sources = Array.isArray(current[SOURCES]) ? current[SOURCES] : [];
  const ownedIndex = sources.findIndex(item =>
    String(item.divisionId) === String(divisionId) && String(item.rateId) === entry.id
  );
  if (ownedIndex < 0 && !entry.overwrite && !force) return false;

  const base = current[BASE] || { hadItem: true, rate: current.rate };
  const nextSources = sources.filter((_, i) => i !== ownedIndex);
  nextSources.push(source);
  clinic.roleRates[index] = {
    ...current,
    rate: entry.rate,
    [SOURCES]: nextSources,
    [BASE]: base,
  };
  return Number(current.rate) !== entry.rate || ownedIndex < 0;
}

function removeOne(settings, divisionId, entry, { legacyFallback = true } = {}) {
  const clinic = settings.clinicSettings?.[entry.clinic];
  if (!clinic || !Array.isArray(clinic.roleRates)) return false;
  const index = clinic.roleRates.findIndex(item => String(item.roleTitle) === entry.value);
  if (index < 0) return false;

  const current = clinic.roleRates[index];
  const sources = Array.isArray(current[SOURCES]) ? current[SOURCES] : [];
  const remaining = sources.filter(item => !(
    String(item.divisionId) === String(divisionId) &&
    (!entry.id || String(item.rateId) === entry.id)
  ));

  if (remaining.length !== sources.length) {
    if (remaining.length > 0) {
      clinic.roleRates[index] = { ...current, rate: remaining[remaining.length - 1].rate, [SOURCES]: remaining };
    } else if (current[BASE]?.hadItem) {
      const restored = { ...current, rate: current[BASE].rate };
      delete restored[SOURCES];
      delete restored[BASE];
      clinic.roleRates[index] = restored;
    } else {
      clinic.roleRates.splice(index, 1);
    }
    return true;
  }

  // Ставки, применённые старой версией, не имели метки подразделения. Снимаем
  // такую запись только при полном совпадении ключа и суммы; личную изменённую
  // ставку сотрудника это сохраняет.
  if (legacyFallback && sources.length === 0 && Number(current.rate) === entry.rate) {
    clinic.roleRates.splice(index, 1);
    return true;
  }
  return false;
}

function applyDivisionRates(rawSettings, divisionId, rates, options = {}) {
  const settings = cloneSettings(rawSettings);
  let changed = false;
  for (const entry of normalizedRates(rates)) {
    changed = applyOne(settings, divisionId, entry, options) || changed;
  }
  return { settings, changed };
}

function removeDivisionRates(rawSettings, divisionId, rates, options = {}) {
  const settings = cloneSettings(rawSettings);
  let changed = false;
  for (const entry of normalizedRates(rates)) {
    changed = removeOne(settings, divisionId, entry, options) || changed;
  }
  return { settings, changed };
}

function syncDivisionRates(rawSettings, divisionId, oldRates, newRates, options = {}) {
  let settings = cloneSettings(rawSettings);
  let changed = false;
  const oldList = normalizedRates(oldRates);
  const newList = normalizedRates(newRates);
  const newById = new Map(newList.map(entry => [entry.id, entry]));
  const oldById = new Map(oldList.map(entry => [entry.id, entry]));
  const appliedBeforeSync = new Map(oldList.map(entry => [
    entry.id,
    rateWasApplied(settings, divisionId, entry),
  ]));

  for (const oldEntry of oldList) {
    const next = newById.get(oldEntry.id);
    const unchanged = next && ['value', 'clinic', 'rate', 'overwrite'].every(key => next[key] === oldEntry[key]);
    if (unchanged) continue;
    const result = removeDivisionRates(settings, divisionId, [oldEntry]);
    settings = result.settings;
    changed = result.changed || changed;
  }

  for (const newEntry of newList) {
    const oldEntry = oldById.get(newEntry.id);
    const unchanged = oldEntry && ['value', 'clinic', 'rate', 'overwrite'].every(key => newEntry[key] === oldEntry[key]);
    if (unchanged) continue;
    const result = applyDivisionRates(settings, divisionId, [newEntry], {
      ...options,
      // Редактирование уже существующей ставки подразделения всегда должно
      // обновить уже применённую запись. Если ставка ранее не применялась из-за
      // личной ставки и выключенного overwrite, личное значение не захватываем.
      force: !!oldEntry && appliedBeforeSync.get(oldEntry.id),
    });
    settings = result.settings;
    changed = result.changed || changed;
  }

  return { settings, changed };
}

module.exports = {
  applyDivisionRates,
  removeDivisionRates,
  syncDivisionRates,
  normalizedRates,
};
