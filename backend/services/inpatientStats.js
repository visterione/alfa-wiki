'use strict';

/**
 * Статистика стационара: случаи стационарного лечения и деньги по ним.
 *
 * Кто и сколько дней лежал — знает порционное требование, а не МИС. Медсестра
 * фиксирует палату и пациента, а мы по этому списку поднимаем из МИС все услуги,
 * оказанные ему за дни пребывания. Считать эпизоды из одних счетов МИС не
 * годится: там видно только выставленное, и в отчёт попадали бы все, кто прошёл
 * через стационар мимо требования.
 *
 * Отсюда порядок: meal_requirement_stays → эпизоды → getInvoices по patient_id
 * за даты эпизода. Услуги приходят прямо внутри счёта (services[]), поэтому
 * одного запроса на пациента достаточно; getInvoiceServices бесполезен — id
 * счёта в ответе МИС всегда null.
 *
 * Клиникой не ограничиваемся сознательно: если пациент в дни лечения
 * съездил на МРТ в другой филиал, это всё равно деньги его лечения.
 */

const axios = require('axios');
const qs = require('qs');
const { Op } = require('sequelize');

const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const MIS_TIMEOUT = 60000;

// Отчёт за месяц — это десяток-другой пациентов и столько же запросов к МИС по
// секунде каждый; больше трёх месяцев за раз просить незачем.
const MAX_PERIOD_DAYS = 92;
const CONCURRENCY = 3;

// На сколько заглядываем за границы периода, чтобы достроить случай целиком:
// три месяца перекрывают любое стационарное лечение с большим запасом
const LOOKAROUND_DAYS = 92;

// ── Признаки стационарных услуг ───────────────────────────────────────────────
//
// Нужны не для отбора пациентов (их даёт требование), а для сверки: койко-день в
// прайсе называется «Ежедневный осмотр врачом-… с наблюдением и уходом» и
// выставляется по строке на каждый день лежания. Сравнив его с днями из
// требования, видно невыставленные дни.
//
// В шаблонах не используем \w: в JavaScript он значит [A-Za-z0-9_] и кириллицу
// не покрывает.
const isBedDayService = (s) =>
  /стационар/i.test(s.profession) && /ежедневн[а-яё]*\s+осмотр/i.test(s.title);
const isInpatientService = (s) => /стационар/i.test(s.profession);

// ── Мелочи ────────────────────────────────────────────────────────────────────

function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/\s| /g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoToRu(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

function ruToIso(ru) {
  const m = String(ru || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function shiftIso(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso + 'T00:00:00Z') - new Date(fromIso + 'T00:00:00Z')) / 86400000);
}

function eachDay(fromIso, toIso) {
  const out = [];
  for (let d = fromIso; d <= toIso; d = shiftIso(d, 1)) out.push(d);
  return out;
}

async function misRequest(endpoint, params) {
  const resp = await axios.post(
    `${MIS_BASE_URL}/${endpoint}`,
    qs.stringify({ api_key: MIS_API_KEY, ...params }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: MIS_TIMEOUT }
  );
  return resp.data;
}

function compactInvoice(inv) {
  return {
    number: inv.number != null ? String(inv.number) : '',
    date: ruToIso(inv.date),
    patientId: inv.patient_id != null ? String(inv.patient_id) : '',
    patient: inv.patient || '',
    value: toNum(inv.value),
    statusCode: inv.status_code != null ? Number(inv.status_code) : null,
    companyId: inv.company_id != null ? String(inv.company_id) : '',
    company: inv.company || '',
    clinic: inv.clinic || '',
    services: (Array.isArray(inv.services) ? inv.services : [])
      .filter(s => s && !s.is_deleted)
      .map(s => ({
        title: s.title || '',
        count: toNum(s.count) || 1,
        // У части операций price = 0, а value заполнено вручную, поэтому
        // выручку берём только из value
        value: toNum(s.value),
        origPrice: toNum(s.original_price),
        doctorName: s.doctor_name || '',
        profession: s.profession_title || ''
      }))
  };
}

// Счета эпизода задним числом не меняются, а вот статус оплаты живёт своей
// жизнью — счёт по ДМС висит неоплаченным неделями. Полчаса кэша: отчёт
// пересматривают подряд по нескольку раз, дёргать МИС на каждый показ незачем.
const invoiceCache = new Map();
const INVOICE_TTL = 30 * 60 * 1000;
const INVOICE_CACHE_MAX = 500;

async function fetchPatientInvoices(patientId, fromIso, toIso) {
  const key = `${patientId}|${fromIso}|${toIso}`;
  const hit = invoiceCache.get(key);
  if (hit && Date.now() - hit.at < INVOICE_TTL) return hit.rows;

  try {
    const data = await misRequest('getInvoices', {
      patient_id: patientId,
      date_from: isoToRu(fromIso),
      date_to: isoToRu(toIso)
    });
    const raw = Array.isArray(data && data.data) ? data.data : (data && data.data ? [data.data] : []);
    const rows = raw.filter(inv => inv && !inv.is_deleted).map(compactInvoice);
    invoiceCache.set(key, { at: Date.now(), rows });
    while (invoiceCache.size > INVOICE_CACHE_MAX) invoiceCache.delete(invoiceCache.keys().next().value);
    return rows;
  } catch (err) {
    console.warn(`[inpatient] счета пациента ${patientId} не загрузились: ${err.message}`);
    return hit ? hit.rows : null;
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 0 }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

// ── Случаи лечения из требования ─────────────────────────────────────────────────────

/**
 * Случай стационарного лечения — непрерывная череда дней, когда пациента
 * кормили. Разрыв в один день случай не разрывает: требование могли не
 * заполнить, а выписка с поступлением назавтра — редкость. Два дня подряд без
 * записи считаем уже новым случаем.
 */
const MAX_GAP_DAYS = 1;

function buildEpisodes(stays) {
  const byPatient = new Map();
  const unlinked = [];

  for (const row of stays) {
    const iso = String(row.stayDate).slice(0, 10);
    if (!row.misPatientId) {
      unlinked.push({ date: iso, name: row.name, room: row.room, department: row.department });
      continue;
    }
    if (!byPatient.has(row.misPatientId)) {
      byPatient.set(row.misPatientId, { patientId: row.misPatientId, name: row.name, days: new Map() });
    }
    byPatient.get(row.misPatientId).days.set(iso, { room: row.room, department: row.department });
  }

  const episodes = [];
  for (const p of byPatient.values()) {
    let cur = null;
    for (const iso of [...p.days.keys()].sort()) {
      const info = p.days.get(iso);
      if (cur && daysBetween(cur.end, iso) <= MAX_GAP_DAYS + 1) {
        cur.gaps += daysBetween(cur.end, iso) - 1;
        cur.end = iso;
        cur.bedDays += 1;
        cur.rooms.add(info.room || '');
      } else {
        if (cur) episodes.push(cur);
        cur = {
          patientId: p.patientId, name: p.name, department: info.department,
          start: iso, end: iso, bedDays: 1, gaps: 0, rooms: new Set([info.room || ''])
        };
      }
    }
    if (cur) episodes.push(cur);
  }

  return { episodes, unlinked };
}

// ── Отчёт ─────────────────────────────────────────────────────────────────────

function addTo(map, key, init, apply) {
  const cur = map.get(key) || init();
  apply(cur);
  map.set(key, cur);
  return cur;
}

async function getReport({ from, to, department, onProgress } = {}) {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw new Error('Даты должны быть в формате ГГГГ-ММ-ДД');
  if (from > to) throw new Error('Начало периода позже конца');
  if (daysBetween(from, to) + 1 > MAX_PERIOD_DAYS) throw new Error(`Период больше ${MAX_PERIOD_DAYS} дней — разбейте на части`);

  const { MealRequirementStay } = require('../models');
  // Смотрим шире запрошенного периода: пациент, поступивший 31 августа и
  // выписанный 6 сентября, должен показывать восемь дней лечения, а не шесть,
  // просто потому что в отчёте выбран сентябрь. Границы случая — это факт, и от
  // выбранного периода они зависеть не могут.
  const where = {
    stayDate: { [Op.gte]: shiftIso(from, -LOOKAROUND_DAYS), [Op.lte]: shiftIso(to, LOOKAROUND_DAYS) }
  };
  if (department) where.department = department;

  const stays = await MealRequirementStay.findAll({ where, order: [['stayDate', 'ASC']] });
  const built = buildEpisodes(stays);
  // В отчёт попадает случай, который хотя бы одним днём пересёкся с периодом
  const episodes = built.episodes.filter(ep => ep.start <= to && ep.end >= from);
  const unlinked = built.unlinked.filter(u => u.date >= from && u.date <= to);

  // Счета тянем по одному пациенту на эпизод: это один запрос и секунда, а
  // выгружать все счета клиники ради десятка человек незачем
  // Деньги считаем за дни, попавшие в выбранный период: длительность лечения
  // берётся целиком, а суммы должны относиться к тому месяцу, который смотрят
  const window = (ep) => ({
    from: ep.start > from ? ep.start : from,
    to: ep.end < to ? ep.end : to
  });

  const fetched = await mapWithConcurrency(episodes, CONCURRENCY, async (ep, idx) => {
    const w = window(ep);
    const rows = await fetchPatientInvoices(ep.patientId, w.from, w.to);
    if (onProgress) onProgress(idx + 1, episodes.length);
    return rows;
  });

  const byService = new Map();
  const byDoctor = new Map();
  const byProfession = new Map();
  const byPatient = new Map();
  const daily = new Map();
  const payment = { paid: 0, partial: 0, unpaid: 0, unpaidSum: 0, companySum: 0, personSum: 0 };
  const failed = [];

  let revenue = 0, inpatientRevenue = 0, bedDayRevenue = 0, cost = 0, revenueNoCost = 0, servicesCount = 0;
  let bedDaysBilled = 0;

  const rows = episodes.map((ep, idx) => {
    const invoices = fetched[idx];
    if (invoices === null) failed.push(ep.name);

    const services = [];
    const billedDays = new Set();
    let epRevenue = 0, epCost = 0, epUnpaid = 0;

    for (const inv of (invoices || [])) {
      if (inv.statusCode === 2) payment.paid += 1;
      else if (inv.statusCode === 1) payment.partial += 1;
      else { payment.unpaid += 1; payment.unpaidSum += inv.value; epUnpaid += inv.value; }
      if (inv.companyId) payment.companySum += inv.value; else payment.personSum += inv.value;

      for (const s of inv.services) {
        const v = s.value;
        const c = s.origPrice * s.count;
        epRevenue += v;
        epCost += c;
        revenue += v;
        cost += c;
        servicesCount += s.count;
        if (!(s.origPrice > 0)) revenueNoCost += v;
        if (isInpatientService(s)) inpatientRevenue += v;
        if (isBedDayService(s)) { bedDayRevenue += v; billedDays.add(inv.date); }

        services.push({
          date: inv.date, title: s.title, count: s.count, value: v,
          cost: c, doctor: s.doctorName, profession: s.profession, clinic: inv.clinic
        });

        addTo(byService, s.title,
          () => ({ title: s.title, count: 0, sum: 0, cost: 0, patients: new Set() }),
          (r) => { r.count += s.count; r.sum += v; r.cost += c; r.patients.add(ep.patientId); });
        addTo(byDoctor, s.doctorName || '—',
          () => ({ name: s.doctorName || '—', count: 0, sum: 0, patients: new Set() }),
          (r) => { r.count += s.count; r.sum += v; r.patients.add(ep.patientId); });
        addTo(byProfession, s.profession || '—',
          () => ({ title: s.profession || '—', count: 0, sum: 0 }),
          (r) => { r.count += s.count; r.sum += v; });
        addTo(daily, inv.date,
          () => ({ date: inv.date, bedDays: 0, revenue: 0 }),
          (r) => { r.revenue += v; });
      }
    }

    // В динамику по дням идут только дни внутри периода: график рисует
    // выбранный отрезок, а не весь случай
    const w = window(ep);
    for (const iso of eachDay(w.from, w.to)) {
      addTo(daily, iso, () => ({ date: iso, bedDays: 0, revenue: 0 }), (r) => { r.bedDays += 1; });
    }

    bedDaysBilled += billedDays.size;

    addTo(byPatient, ep.patientId,
      () => ({ patientId: ep.patientId, patient: ep.name, sum: 0, bedDays: 0, episodes: 0 }),
      (r) => { r.sum += epRevenue; r.bedDays += ep.bedDays; r.episodes += 1; });

    return {
      patientId: ep.patientId,
      patient: ep.name,
      department: ep.department,
      rooms: [...ep.rooms].filter(Boolean).join(', '),
      start: ep.start,
      end: ep.end,
      // Длительность лечения — фактическая, целиком; в периоде мог оказаться
      // только её кусок, и он считается отдельно, для сумм и загрузки коек
      bedDays: ep.bedDays,
      bedDaysInPeriod: daysBetween(window(ep).from, window(ep).to) + 1,
      // Сверка: сколько дней лежания выставлено в счетах. Меньше факта — койко-день
      // не выставили, и это ровно то, ради чего требование связывали с МИС
      bedDaysBilled: billedDays.size,
      gaps: ep.gaps,
      revenue: epRevenue,
      cost: epCost,
      unpaid: epUnpaid,
      failed: invoices === null,
      services: services.sort((a, b) => (a.date === b.date ? b.value - a.value : a.date.localeCompare(b.date)))
    };
  }).sort((a, b) => b.revenue - a.revenue);

  // Койко-дни отделения за период — из дней, попавших в период: по ним считается
  // загрузка и выручка на койко-день. Средняя длительность, наоборот, берётся по
  // фактическим случаям целиком.
  const bedDays = rows.reduce((a, r) => a + r.bedDaysInPeriod, 0);
  const bedDaysFact = rows.reduce((a, r) => a + r.bedDays, 0);
  const distribution = { '1': 0, '2': 0, '3-5': 0, '6-10': 0, '11+': 0 };
  rows.forEach(r => {
    const d = r.bedDays;   // фактическая длительность случая, не обрезанная периодом
    if (d <= 1) distribution['1'] += 1;
    else if (d === 2) distribution['2'] += 1;
    else if (d <= 5) distribution['3-5'] += 1;
    else if (d <= 10) distribution['6-10'] += 1;
    else distribution['11+'] += 1;
  });

  const top = (map, key, limit) => [...map.values()]
    .map(r => ({ ...r, patients: r.patients ? r.patients.size : undefined }))
    .sort((a, b) => b[key] - a[key])
    .slice(0, limit);

  // Непривязанные строки — это качество данных: пациента внесли, но карточку не
  // выбрали, и его деньги в отчёт не попали
  const unlinkedNames = new Map();
  unlinked.forEach(u => {
    addTo(unlinkedNames, String(u.name).toLowerCase(),
      () => ({ name: u.name, days: 0, rooms: new Set() }),
      (r) => { r.days += 1; r.rooms.add(u.room || ''); });
  });

  return {
    period: { from, to, days: daysBetween(from, to) + 1 },
    department: department || null,
    summary: {
      episodes: rows.length,
      patients: new Set(rows.map(r => r.patientId)).size,
      bedDays,
      bedDaysFact,
      bedDaysBilled,
      avgStay: rows.length ? bedDaysFact / rows.length : 0,
      gaps: rows.reduce((a, r) => a + r.gaps, 0),
      revenue,
      inpatientRevenue,
      bedDayRevenue,
      avgCheck: rows.length ? revenue / rows.length : 0,
      revenuePerBedDay: bedDays ? revenue / bedDays : 0,
      servicesCount,
      cost,
      revenueNoCost,
      noCostShare: revenue ? revenueNoCost / revenue : 0,
      unlinkedDays: unlinked.length,
      unlinkedPatients: unlinkedNames.size,
      failedPatients: failed.length,
      payment
    },
    distribution,
    episodes: rows,
    unlinked: [...unlinkedNames.values()].map(u => ({
      name: u.name, days: u.days, rooms: [...u.rooms].filter(Boolean).join(', ')
    })),
    services: top(byService, 'sum', 40),
    servicesByCount: top(byService, 'count', 20),
    doctors: top(byDoctor, 'sum', 30),
    professions: top(byProfession, 'sum', 20),
    patientsTop: [...byPatient.values()].sort((a, b) => b.sum - a.sum).slice(0, 30),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date))
  };
}

// ── Поиск пациента для порционного требования ─────────────────────────────────
//
// Запасной путь для подсказки: локальный справочник карточек (mis_patients)
// может ещё не знать о карточке, заведённой час назад. МИС ищет по ТОЧНОЙ
// фамилии — «Курочк» вернёт ноль, «Курочкин» — 52 карточки.

const surnameCache = new Map();
const SURNAME_TTL = 5 * 60 * 1000;
const SURNAME_CACHE_MAX = 200;

async function searchPatientsBySurname(surname, limit = 40) {
  const query = String(surname || '').trim();
  if (query.length < 3) return [];

  const key = query.toLowerCase();
  const hit = surnameCache.get(key);
  if (hit && Date.now() - hit.at < SURNAME_TTL) return hit.rows.slice(0, limit);

  let rows = [];
  try {
    const data = await misRequest('getPatient', { last_name: query });
    rows = Array.isArray(data && data.data) ? data.data : (data && data.data ? [data.data] : []);
  } catch (err) {
    console.warn('[inpatient] поиск по фамилии не удался:', err.message);
    return hit ? hit.rows.slice(0, limit) : [];
  }

  const stamp = (p) => {
    const m = String(p.date_updated || p.date_created || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  };

  const mapped = rows
    .sort((a, b) => stamp(b).localeCompare(stamp(a)))
    .map(p => ({
      patientId: String(p.patient_id),
      name: [p.last_name, p.first_name, p.third_name].filter(Boolean).join(' '),
      birthDate: p.birth_date || '',
      cardNumber: p.number != null ? String(p.number) : ''
    }));

  surnameCache.set(key, { at: Date.now(), rows: mapped });
  while (surnameCache.size > SURNAME_CACHE_MAX) surnameCache.delete(surnameCache.keys().next().value);
  return mapped.slice(0, limit);
}

function clearCache() {
  invoiceCache.clear();
}

module.exports = {
  getReport,
  searchPatientsBySurname,
  clearCache,
  MAX_PERIOD_DAYS
};
