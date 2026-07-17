/**
 * Сервис синхронизации финансовых списаний из МИС (getPayments, type=2) → таблица mis_payments
 *
 * В getPayments нет фильтра "только возвраты": забираем все списания (type=2) и
 * помечаем возвраты флагом is_refund (по type_name). Статистику возвратов затем
 * строим из локальной БД, не дёргая МИС на каждый запрос.
 *
 * getPayments не возвращает уникальный id операции → синхронизация идемпотентна
 * по дню: перед вставкой строки за этот день удаляются (delete-by-day + insert).
 *
 * Экспортирует:
 *   syncState         – текущее состояние синхронизации (in-memory, сбрасывается при рестарте)
 *   fetchAndUpsertDay – загрузить один день и сохранить в БД
 *   syncDateRange     – запустить синхронизацию диапазона (fire-and-forget async)
 *   isRefundName      – эвристика: является ли type_name возвратом
 */

const axios = require('axios');
const qs    = require('qs');
const { Op } = require('sequelize');

const MIS_API_KEY  = process.env.MIS_API_KEY  || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT  = 30000;
const DELAY_BETWEEN_DAYS_MS = 400; // пауза между запросами, чтобы не перегружать МИС

// ── In-memory sync state ──────────────────────────────────────────────────────
const syncState = {
  syncing:  false,
  done:     0,
  total:    0,
  phase:    '',
  error:    null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
// getPayments принимает даты в формате dd.mm.yyyy (без времени)
function formatMisDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}.${m}.${date.getFullYear()}`;
}

function parsePayDate(str) {
  if (!str) return null;
  const d = new Date(String(str).replace(' ', 'T'));
  if (!isNaN(d)) return d;
  const m = String(str).match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`);
  return null;
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/**
 * Эвристика "это возврат".
 *
 * ВАЖНО (проверено на реальных данных МИС): у ВСЕХ списаний type_name = "Списание",
 * поэтому по type_name возвраты не отделить. Реальный признак возврата — поле title
 * ("Возврат средств пациенту"); остальные списания — зарплатные (Аванс, ЗП, Отпускные…).
 * Проверяем title в первую очередь, type_name — как запасной вариант на будущее.
 *
 * Все списания сохраняются в БД в любом случае — флаг лишь помечает возвраты,
 * поэтому при неточности эвристики данные не теряются и is_refund можно пересчитать.
 */
function isRefundOp(payment) {
  const p = payment || {};
  return /возврат/i.test(String(p.title || '')) || /возврат/i.test(String(p.type_name || ''));
}

async function misRequest(endpoint, params) {
  const resp = await axios.post(
    `${MIS_BASE_URL}/${endpoint}`,
    qs.stringify({ api_key: MIS_API_KEY, ...params }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: MIS_TIMEOUT }
  );
  return resp.data;
}

async function fetchDayFromMis(date) {
  const params = {
    date_from: formatMisDate(date),
    date_to:   formatMisDate(date),
    type:      2, // списания (в т.ч. возвраты)
  };
  const data = await misRequest('getPayments', params);
  if (!data || data.error !== 0 || !Array.isArray(data.data)) return [];
  return data.data;
}

// ── Public: upsert one day ────────────────────────────────────────────────────
async function fetchAndUpsertDay(date) {
  // Lazy-require to avoid circular deps at module load time
  const { MisPayment, sequelize } = require('../models');

  const payments = await fetchDayFromMis(date);

  const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
  const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 999);

  const records = payments.map(p => ({
    opDate:         parsePayDate(p.date),
    value:          toNum(p.value),
    type:           p.type != null ? Number(p.type) : null,
    typeName:       p.type_name || null,
    isRefund:       isRefundOp(p),
    incomeType:     p.income_type != null ? Number(p.income_type) : null,
    incomeTypeName: p.income_type_name || null,
    invoiceNumber:  p.invoice_number != null ? String(p.invoice_number) : null,
    title:          p.title || null,
    patientId:      p.patient_id != null ? Number(p.patient_id) : null,
    patient:        p.patient || null,
    clinicId:       p.clinic_id != null ? Number(p.clinic_id) : null,
    clinicName:     p.clinic_name || null,
    isCompany:      toBool(p.is_company),
    authorId:       p.author_id != null ? Number(p.author_id) : null,
    authorName:     p.author_name || null,
    device:         p.device != null ? String(p.device) : null,
    isDeleted:      toBool(p.is_deleted),
    data:           p,
    syncedAt:       new Date(),
  }));

  // Идемпотентность по дню: удаляем существующие записи за день, затем вставляем свежие
  await sequelize.transaction(async (t) => {
    await MisPayment.destroy({
      where: { opDate: { [Op.gte]: dayStart, [Op.lte]: dayEnd } },
      transaction: t,
    });
    if (records.length) {
      await MisPayment.bulkCreate(records, { transaction: t });
    }
  });

  return records.length;
}

// ── Public: sync a date range (fire-and-forget) ───────────────────────────────
async function syncDateRange(start, end) {
  if (syncState.syncing) {
    console.warn('[misPaymentsSync] Синхронизация уже запущена, пропускаем запрос');
    return;
  }

  const days = [];
  const cur = new Date(start); cur.setHours(12, 0, 0, 0);
  const fin = new Date(end);   fin.setHours(12, 0, 0, 0);
  while (cur <= fin) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

  Object.assign(syncState, { syncing: true, done: 0, total: days.length, phase: 'Запуск…', error: null });
  console.log(`💸 [misPaymentsSync] Начало синхронизации: ${days.length} дней [${formatMisDate(start)} → ${formatMisDate(end)}]`);

  (async () => {
    for (let i = 0; i < days.length; i++) {
      syncState.done  = i;
      syncState.phase = `${days[i].toLocaleDateString('ru-RU')} (${i + 1}/${days.length})`;
      try {
        const cnt = await fetchAndUpsertDay(days[i]);
        if (cnt) console.log(`  ✓ ${days[i].toLocaleDateString('ru-RU')}: ${cnt} списаний`);
      } catch (e) {
        console.error(`  ✗ ${days[i].toLocaleDateString('ru-RU')}:`, e.message);
      }
      if (i < days.length - 1) await new Promise(r => setTimeout(r, DELAY_BETWEEN_DAYS_MS));
    }
    Object.assign(syncState, { syncing: false, done: days.length, phase: 'Завершено', error: null });
    console.log(`✅ [misPaymentsSync] Синхронизация завершена (${days.length} дней)`);
  })().catch(e => {
    Object.assign(syncState, { syncing: false, error: e.message });
    console.error('❌ [misPaymentsSync]', e.message);
  });
}

module.exports = { syncState, fetchAndUpsertDay, syncDateRange, isRefundOp };
