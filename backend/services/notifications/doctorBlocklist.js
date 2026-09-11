'use strict';

/**
 * Служебные врачи, для которых пациентские уведомления запрещены (ver. 8.12).
 *
 * В МИС процедурный кабинет или дневной стационар заведены как врач. Для
 * расписания это удобно, но фраза «вы записаны к врачу Дневной стационар» не
 * должна попадать ни в один канал. Храним стабильный id МИС и имя для
 * отображения; имя также служит запасным сопоставлением для старых снимков,
 * где doctor_id ещё не сохранялся.
 */

const { Setting } = require('../../models');
const branchDirectory = require('./branches');

const KEY = 'notif_blocked_doctors';
const CACHE_MS = 60 * 1000;
let cache = { at: 0, state: { default: [], branches: {} } };

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizedName(value) {
  return cleanName(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function normalizeDoctors(value) {
  const result = [];
  const seen = new Set();

  for (const raw of (Array.isArray(value) ? value : [])) {
    const id = String(raw && typeof raw === 'object' ? raw.id : raw || '').trim();
    const name = cleanName(raw && typeof raw === 'object' ? raw.name : '');
    if (!id && !name) continue;
    const key = id ? `id:${id}` : `name:${normalizedName(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ id: id || null, name });
  }

  return result;
}

function normalizeState(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.branches) {
    const branches = {};
    for (const [medCenterId, doctors] of Object.entries(value.branches || {})) {
      branches[String(medCenterId)] = normalizeDoctors(doctors);
    }
    return { default: normalizeDoctors(value.default || value.doctors || []), branches };
  }
  return { default: normalizeDoctors(value?.doctors || value || []), branches: {} };
}

async function readAll({ fresh = false } = {}) {
  if (!fresh && Date.now() - cache.at < CACHE_MS) return cache.state;
  const row = await Setting.findByPk(KEY);
  const state = normalizeState(row?.value);
  cache = { at: Date.now(), state };
  return state;
}

function doctorsFor(state, medCenterId) {
  const key = medCenterId == null ? '' : String(medCenterId);
  if (key && Object.prototype.hasOwnProperty.call(state?.branches || {}, key)) {
    return state.branches[key];
  }
  return state?.default || [];
}

async function read({ fresh = false, medCenterId = null } = {}) {
  return doctorsFor(await readAll({ fresh }), medCenterId);
}

async function write(medCenterId, doctors) {
  const key = String(medCenterId || '').trim();
  if (!key) throw new Error('Не указан филиал');
  const normalized = normalizeDoctors(doctors);
  const current = await readAll({ fresh: true });
  const state = {
    // Первый переход со старого общего списка превращает выбранный филиал в
    // явную настройку, а остальные оставляет пустыми. Иначе старый Кузин
    // продолжал бы блокироваться в Kids до ручного сохранения каждого филиала.
    default: Object.keys(current.branches).length ? current.default : [],
    branches: { ...current.branches, [key]: normalized }
  };
  await Setting.upsert({
    key: KEY,
    value: state,
    description: 'Врачи и служебные ресурсы МИС, для которых запрещены уведомления в конкретных филиалах'
  });
  cache = { at: Date.now(), state };
  return normalized;
}

function matches(snap, doctors) {
  const id = snap?.doctorId == null ? '' : String(snap.doctorId).trim();
  const name = normalizedName(snap?.doctorName);
  return normalizeDoctors(doctors).some(doctor => (
    (id && doctor.id && doctor.id === id) ||
    ((!id || !doctor.id) && name && doctor.name && normalizedName(doctor.name) === name)
  ));
}

// Филиал портала по клинике визита — общим сопоставлением модуля (ver. 8.17).
// Здесь промах опаснее, чем кажется: не найдя филиала, стоп-лист берёт список
// default, а он с 8.15 пуст у сети, где настроен хотя бы один филиал. То есть
// служебный врач филиала, чьё имя разошлось со справочником, переставал
// блокироваться — и «вы записаны к врачу Дневной стационар» уходило пациенту.
const medCenterIdFor = (snap) => branchDirectory.idFor(snap);

function matchesFor(snap, state, medCenterId) {
  return matches(snap, doctorsFor(state, medCenterId));
}

async function isBlocked(snap, medCenterId = null) {
  const branchId = medCenterId || await medCenterIdFor(snap);
  return matchesFor(snap, await readAll(), branchId);
}

module.exports = {
  KEY, normalizeDoctors, normalizeState, doctorsFor, matches, matchesFor,
  read, readAll, write, medCenterIdFor, isBlocked
};
