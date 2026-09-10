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

const KEY = 'notif_blocked_doctors';
const CACHE_MS = 60 * 1000;
let cache = { at: 0, doctors: [] };

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

async function read({ fresh = false } = {}) {
  if (!fresh && Date.now() - cache.at < CACHE_MS) return cache.doctors;
  const row = await Setting.findByPk(KEY);
  const doctors = normalizeDoctors(row?.value?.doctors || row?.value || []);
  cache = { at: Date.now(), doctors };
  return doctors;
}

async function write(doctors) {
  const normalized = normalizeDoctors(doctors);
  await Setting.upsert({
    key: KEY,
    value: { doctors: normalized },
    description: 'Врачи и служебные ресурсы МИС, для которых запрещены пациентские уведомления'
  });
  cache = { at: Date.now(), doctors: normalized };
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

async function isBlocked(snap) {
  return matches(snap, await read());
}

module.exports = { KEY, normalizeDoctors, matches, read, write, isBlocked };
