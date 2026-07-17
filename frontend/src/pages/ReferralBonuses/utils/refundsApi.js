import { misPayments } from '../../../services/api';

/**
 * Загружает возвраты из локальной БД (таблица mis_payments, is_refund = true).
 * Данные пишет синк getPayments — сюда не ходим в МИС напрямую.
 *
 * @param {Date}   start     — начало периода
 * @param {Date}   end       — конец периода
 * @param {Object} options   — доп. фильтры (clinic_id, author_id, refunds_only, show_deleted)
 * @returns {Promise<Array>} — массив объектов возврата в snake_case
 */
export async function fetchRefundsFromDB(start, end, options = {}) {
  const params = {
    date_from: start.toISOString(),
    date_to:   end.toISOString(),
    ...options,
  };
  const resp = await misPayments.query(params);
  const body = resp?.data;
  if (body?.error === 0 && Array.isArray(body?.data)) return body.data;
  return [];
}
