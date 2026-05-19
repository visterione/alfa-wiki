import { misAppointments } from '../../../services/api';

/**
 * Загружает визиты из локальной БД (таблица mis_appointments).
 *
 * @param {Date}   start     — начало периода
 * @param {Date}   end       — конец периода
 * @param {Object} options   — доп. фильтры (clinic_id, status_id, …)
 * @returns {Promise<Array>} — массив объектов визита в snake_case
 */
export async function fetchAppointmentsFromDB(start, end, options = {}) {
  const params = {
    date_from: start.toISOString(),
    date_to:   end.toISOString(),
    ...options,
  };
  const resp = await misAppointments.query(params);
  const body = resp?.data;
  if (body?.error === 0 && Array.isArray(body?.data)) return body.data;
  return [];
}

export async function getSyncStatus() {
  const resp = await misAppointments.syncStatus();
  return resp?.data || null;
}

export async function triggerSync(params) {
  const resp = await misAppointments.syncTrigger(params);
  return resp?.data || null;
}
