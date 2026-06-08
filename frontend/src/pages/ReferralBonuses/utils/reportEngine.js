/**
 * Report calculation engine — ported from backend/bot/referral-bonuses.html
 * All logic preserved verbatim, adapted to ES module + async/await with axios API calls.
 */
import { referralBonuses as rbApi, executorSettings, hourNorms as hourNormsApi, roleNorms as roleNormsApi, categoryNorms as categoryNormsApi, rbScheduleDicts } from '../../../services/api';
import { rbNormalizeName, rbNamesMatch } from './nameMatching';
import { rbMatchClinicId, rbGetClinicName, rbGetClinicColor, rbCabMatch, rbProfessionTitle } from './clinicUtils';
import { rbParseDate } from './excelUtils';
import { calcScheduleHoursForPeriod, calcHolidayHoursForPeriod } from './scheduleUtils';

// ── Default executor clinic settings ──────────────────────────────────────────
export function execClinicDefault() {
  return {
    payType: 'salary',
    fixedSalary: 0,
    hourlyRate: 0,
    hoursWorked: 0,
    executorPercent: 0,
    plusPercent: false,
    paymentMethod: 'card',
    mainPaymentMethod: 'card',
    advance: 0,
    mainPayment: 0,
    includeReferralBonuses: true,
    includeReferralDeductions: true,
    includeCorpInvoices: true,
    assistancePercent: 0,
    assistanceValueType: 'percent',
    cabinets: [],
    deductions: [],
    materials: [],
    serviceMaterials: [],
    extras: [],
    normServices: [],
  };
}

export function rbGetClinicSettings(execData, clinicId) {
  const cs = execData?.clinicSettings || {};
  const found = (clinicId && cs[clinicId]) || cs['global'];
  if (!found) return execClinicDefault();
  // Merge with defaults so fields added later (e.g. includeCorpInvoices) are always present
  return { ...execClinicDefault(), ...found };
}

// ── In-memory cache for executor settings (per session) ───────────────────────
const _execCache = {};

export function clearExecCache(misUserId) {
  if (misUserId) delete _execCache[misUserId];
  else Object.keys(_execCache).forEach(k => delete _execCache[k]);
}

export async function loadExecSettings(misUserId, roles) {
  if (!_execCache[misUserId]) {
    try {
      const res = await executorSettings.get(misUserId);
      const raw = res.data;
      if (!raw || !Object.keys(raw).length) {
        _execCache[misUserId] = { clinicSettings: { global: execClinicDefault() } };
      } else if (!raw.clinicSettings) {
        // Old format migration
        const global = execClinicDefault();
        global.deductions = raw.deductions || [];
        global.materials  = raw.materials  || [];
        global.extras     = raw.extras     || [];
        global.payType = 'salary';
        global.fixedSalary = raw.wage || raw.payment || 0;
        global.advance = raw.advance || 0;
        global.paymentMethod = raw.method || 'card';
        _execCache[misUserId] = { clinicSettings: { global } };
      } else {
        _execCache[misUserId] = raw;
      }
    } catch {
      _execCache[misUserId] = { clinicSettings: { global: execClinicDefault() } };
    }
  }
  return _execCache[misUserId];
}

// ── Core calculation engine ────────────────────────────────────────────────────
/**
 * @param {object[]} rows - Parsed Excel rows (from parseExcelFile + rbMapNewColumns)
 * @param {object} colMap - Column map from rbMapNewColumns
 * @param {object} doctor - Selected doctor { id, name, ... }
 * @param {object[]} referralBonuses - Referral bonuses from DB for this doctor
 * @param {object[]} performedDbBonuses - Performed service bonuses from DB for this doctor
 * @param {object} execSettings - Executor settings from DB
 * @param {string|null} dateFrom - ISO date string or null
 * @param {string|null} dateTo - ISO date string or null
 * @param {object[]} allDoctors - All doctors list (for assistant income)
 * @returns {Promise<{clinicReports, grandTotal, periodLabel}>}
 */
/**
 * Extract corp-paid rows from the data for a given period.
 * Returns array of { row, key } where key is the stable string index.
 */
export function extractCorpRows(rows, colMap, dateFrom, dateTo) {
  if (!colMap.invoiceType) return [];
  const dfDate = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
  const dtDate = dateTo   ? new Date(dateTo   + 'T23:59:59') : null;
  return rows
    .map((row, idx) => ({ row, key: String(idx) }))
    .filter(({ row }) => {
      const t = String(row[colMap.invoiceType] || '').toLowerCase().trim();
      if (t !== 'юр. компания' && t !== 'юр.компания') return false;
      if (colMap.invoiceCreatedDate) {
        const invoiceDate = rbParseDate(row[colMap.invoiceCreatedDate]);
        if (invoiceDate && invoiceDate < new Date(2026, 1, 1)) return false;
      }
      if (colMap.date) {
        const rowDate = rbParseDate(row[colMap.date]);
        if (rowDate && dfDate && rowDate < dfDate) return false;
        if (rowDate && dtDate && rowDate > dtDate) return false;
      }
      return true;
    });
}

// Проверяет совпадение правила анестезиолога с услугой по названию и/или специальности
function anestRuleMatches(rule, svcName, svcSpec) {
  const hasContains  = !!(rule.contains  || '').trim();
  const hasSpecialty = !!(rule.specialty || '').trim();
  if (!hasContains && !hasSpecialty) return false;
  const nameMatch = hasContains  && svcName.includes(rule.contains);
  const specMatch = hasSpecialty && svcSpec.toLowerCase().includes((rule.specialty || '').toLowerCase());
  if (hasContains && hasSpecialty)
    return (rule.matchMode || 'or') === 'and' ? (nameMatch && specMatch) : (nameMatch || specMatch);
  return nameMatch || specMatch;
}

function splitPersonNames(str) {
  if (!str) return [];
  return String(str).split(',').map(s => s.trim()).filter(Boolean);
}

export async function buildReport({
  rows, colMap, doctor, referralBonuses, performedDbBonuses,
  execSettings, dateFrom, dateTo, allDoctors, savedAssistanceIncome,
  interim = false, normedOnly = false,
  corpIncludedKeys = null, // Set<string> of row indices; null = use legacy logic
  scheduleEntries = null,  // Array of schedule entries from doctorSchedules.list API (optional)
  holidayDates = null,     // Set<string> of "YYYY-MM-DD" public holidays — hours on these days count x2
}) {
  const doctorName = doctor.name;
  const doctorClinicIds = new Set((doctor.clinics || []).map(String));
  const disabledClinicIds = new Set((execSettings?.disabledClinics || []).map(String));
  if (execSettings?.clinicSettings && doctorClinicIds.size > 0) {
    const clinicSettings = {};
    Object.entries(execSettings.clinicSettings || {}).forEach(([clinicId, settings]) => {
      if (clinicId === 'global' || doctorClinicIds.has(String(clinicId))) {
        clinicSettings[clinicId] = settings;
      }
    });
    execSettings = { ...execSettings, clinicSettings };
  }

  // If doctor has no percent clinics — Excel rows are not required (normed/hourly/salary calculate from settings)
  const _clinicPayTypes = execSettings
    ? Object.values(execSettings.clinicSettings || {}).map(cs => cs.payType).filter(Boolean)
    : [];
  const _hasPercentClinic = _clinicPayTypes.some(pt => pt === 'percent');
  const _hasNonExcelClinic = _clinicPayTypes.some(pt => pt === 'normed' || pt === 'hourly' || pt === 'salary');
  if (_hasNonExcelClinic && !_hasPercentClinic) normedOnly = true;

  function parseDateBound(s, endOfDay) {
    if (!s) return null;
    const parts = s.split('-').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    return endOfDay
      ? new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999)
      : new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
  }
  const dateFromDate = parseDateBound(dateFrom, false);
  const dateToDate   = parseDateBound(dateTo,   true);
  const periodLabel = (dateFromDate || dateToDate)
    ? `${dateFrom ? new Date(dateFrom).toLocaleDateString('ru-RU') : '…'} — ${dateTo ? new Date(dateTo).toLocaleDateString('ru-RU') : '…'}`
    : '';

  // ── Error: no referrer/executor columns (skip for normedOnly — Excel not needed) ──
  if (!normedOnly && !colMap.referrer && !colMap.executor) {
    const keys = rows.length ? Object.keys(rows[0]) : [];
    throw new Error(
      `Не удалось определить колонки ФИО рекомендателя/исполнителя.\nДоступные колонки: ${keys.join(', ')}`
    );
  }

  // ── Date range filter ──
  const GLOBAL_DATE_CUTOFF = new Date(2026, 1, 1); // 01.02.2026 — раньше не берём ничего
  function rbRowInDateRange(r) {
    if (!dateFromDate && !dateToDate) return true;
    const rowDate = rbParseDate(r[colMap.date]);
    if (!rowDate) return true;
    if (rowDate < GLOBAL_DATE_CUTOFF) return false;
    if (dateFromDate && rowDate < dateFromDate) return false;
    if (dateToDate   && rowDate > dateToDate)   return false;
    return true;
  }

  // ── Row quantity helper (для правила VIP/Сотрудник со скидкой) ──
  function rbGetRowQty(r) {
    if (!colMap.qty) return 1;
    const q = parseFloat(String(r[colMap.qty] || '1').replace(',', '.'));
    return (isFinite(q) && q > 0) ? q : 1;
  }

  // Возвращает true если строка попадает под правило VIP/Сотрудник + скидка 50%/100%
  function rbIsSpecialDiscountRow(r) {
    if (!colMap.category || !colMap.discount || !colMap.servicePrice) return false;
    const categoryVal = String(r[colMap.category] || '').toUpperCase();
    if (!categoryVal.includes('VIP') && !categoryVal.includes('СОТРУДНИК')) return false;
    const discountRaw = String(r[colMap.discount] || '').replace('%', '').trim();
    const discountRawVal = parseFloat(discountRaw.replace(',', '.')) || 0;
    const discountVal = (discountRawVal > 0 && discountRawVal <= 1) ? discountRawVal * 100 : discountRawVal;
    return discountVal === 50 || discountVal >= 100;
  }

  // ── Cost parser ──
  function rbParseCost(r) {
    // Особые случаи: VIP или Сотрудник со скидкой 50%/100% — врач получает 80% от прайса × количество
    if (rbIsSpecialDiscountRow(r)) {
      const price = parseFloat(String(r[colMap.servicePrice] || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
      return price * 0.80 * rbGetRowQty(r);
    }

    if (colMap.totalCost != null) {
      const tv = r[colMap.totalCost];
      if (tv !== '' && tv !== null && tv !== undefined) {
        return parseFloat(String(tv).replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
      }
    }
    const raw = r[colMap.servicePrice] || '0';
    return parseFloat(String(raw).replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
  }

  // ── Calc helpers ──
  function calcItemRub(item, base) {
    const v = parseFloat(item.value) || 0;
    return item.valueType === 'percent' ? base * v / 100 : v;
  }
  function calcExtraRub(extra) {
    const amt = parseFloat(extra.amount) || 0;
    const hrs = parseFloat(extra.hours) || 0;
    return hrs > 0 ? amt * hrs : amt;
  }

  // ── Filter relevant rows ──
  const allRelevant = rows.filter(r => {
    const isRef  = colMap.referrer && rbNamesMatch(doctorName, r[colMap.referrer]);
    const isExec = colMap.executor && rbNamesMatch(doctorName, r[colMap.executor]);
    if (!isRef && !isExec) return false;
    return rbRowInDateRange(r);
  });

  if (!allRelevant.length && !normedOnly) {
    throw new Error(
      `В файле не найдено строк для врача «${doctorName}»${periodLabel ? ` за период ${periodLabel}` : ''}.\nПроверьте что в файле есть колонки "ФИО исполнителя" или "ФИО рекомендателя" с данным врачом.`
    );
  }

  // ── Group by clinic ──
  const rawByClinic = {};
  allRelevant.forEach(r => {
    const clinicRaw = colMap.clinic ? String(r[colMap.clinic] || '').trim() : '';
    const clinicId  = rbMatchClinicId(clinicRaw) || 'unknown';
    const clinicLabel = clinicRaw || 'Не указана';
    if (!rawByClinic[clinicId]) rawByClinic[clinicId] = { id: clinicId, label: clinicLabel, rows: [] };
    rawByClinic[clinicId].rows.push(r);
  });

  const byClinic = {};
  const orphanReferrerRows = [];
  Object.entries(rawByClinic).forEach(([clinicId, group]) => {
    if (disabledClinicIds.has(String(clinicId))) return;
    const hasExecRows = group.rows.some(r =>
      colMap.executor && rbNamesMatch(doctorName, r[colMap.executor] || '')
    );
    if (hasExecRows) {
      byClinic[clinicId] = group;
    } else {
      orphanReferrerRows.push(...group.rows);
    }
  });
  if (!Object.keys(byClinic).length) {
    if (normedOnly) {
      // Типы без Excel (normed/hourly/salary) — создаём синтетические записи по настроенным клиникам
      const cs = execSettings?.clinicSettings || {};
      const noExcelClinicIds = Object.keys(cs).filter(cid => {
        if (cid === 'global') return false;
        if (disabledClinicIds.has(String(cid))) return false;
        const pt = cs[cid].payType || 'salary'; // default matches execClinicDefault
        return pt === 'normed' || pt === 'hourly' || pt === 'salary';
      });
      if (noExcelClinicIds.length > 0) {
        noExcelClinicIds.forEach(cid => {
          byClinic[cid] = { id: cid, label: rbGetClinicName(cid), rows: [] };
        });
      } else {
        // Только global настройки
        byClinic['unknown'] = { id: 'unknown', label: 'Расчёт', rows: [] };
      }
    } else {
      Object.entries(rawByClinic).forEach(([clinicId, group]) => {
        if (!disabledClinicIds.has(String(clinicId))) byClinic[clinicId] = group;
      });
    }
  } else if (orphanReferrerRows.length) {
    byClinic[Object.keys(byClinic)[0]].rows.push(...orphanReferrerRows);
  }

  // ── Load bonuses by service code (for referral payments to referrers) ──
  const allServiceCodes = [...new Set(allRelevant
    .filter(r => colMap.executor && rbNamesMatch(doctorName, r[colMap.executor] || ''))
    .map(r => colMap.serviceCode ? String(r[colMap.serviceCode] || '').trim() : '')
    .filter(Boolean))];

  const bonusesByServiceCode = {};
  if (allServiceCodes.length) {
    await Promise.all(allServiceCodes.map(async code => {
      try {
        const res = await rbApi.getByService(code);
        bonusesByServiceCode[code] = res.data;
      } catch {
        bonusesByServiceCode[code] = {};
      }
    }));
  }

  // ── Load hour norms for normed/hourly pay types ──
  // _normsByRole:     roleTitle     → normHours (roles + specialties)
  // _normsByCategory: categoryId   → normHours
  // _normHoursForPeriod: backward-compat single value (first found)
  let _normHoursForPeriod = null;
  const _normsByRole      = {};
  const _normsByCategory  = {}; // categoryId → normHours
  const _categoryLabels   = {}; // categoryId → name
  {
    const hasNormedOrHourly = Object.values(execSettings?.clinicSettings || {}).some(cs => cs.payType === 'normed' || cs.payType === 'hourly');
    if (hasNormedOrHourly && dateFrom) {
      try {
        const periodDate = new Date(dateFrom);
        const year = periodDate.getFullYear();
        const month = periodDate.getMonth() + 1;
        const doctorRoles = Array.isArray(doctor.roles) ? doctor.roles
          : doctor.role_titles ? String(doctor.role_titles).split(',').map(s => s.trim()).filter(Boolean)
          : Array.isArray(doctor.role_names) ? doctor.role_names
          : doctor.role ? [doctor.role] : [];

        const [roleRes, res, allCatsRes, catNormRes] = await Promise.all([
          roleNormsApi.get(year, month),
          hourNormsApi.get(year, month),
          rbScheduleDicts.listCategories().catch(() => ({ data: [] })),
          categoryNormsApi.get(year, month),
        ]);

        const roleNormsData = roleRes.data || [];
        for (const roleTitle of doctorRoles) {
          const norm = roleNormsData.find(n => n.roleTitle === roleTitle);
          if (norm && norm.normHours != null) _normsByRole[roleTitle] = parseFloat(norm.normHours);
        }

        const norms = res.data || [];
        for (const p of (doctor.professions || [])) {
          const profTitle = rbProfessionTitle(p);
          if (profTitle && !_normsByRole[profTitle]) {
            const norm = norms.find(n => n.professionTitle === profTitle);
            if (norm && norm.normHours != null) _normsByRole[profTitle] = parseFloat(norm.normHours);
          }
        }

        for (const c of (allCatsRes.data || [])) {
          if (c.id && c.name) _categoryLabels[c.id] = c.name;
        }

        for (const n of (catNormRes.data || [])) {
          if (n.categoryId && n.normHours != null) {
            _normsByCategory[n.categoryId] = parseFloat(n.normHours);
            if (n.category?.name) _categoryLabels[n.categoryId] = n.category.name;
          }
        }

        // Backward compat: first found norm
        const firstNorm = Object.values(_normsByRole)[0];
        if (firstNorm != null) _normHoursForPeriod = firstNorm;
      } catch { /* continue without norm hours */ }
    }
  }

  // ── Build per-clinic reports ──
  const clinicReports = [];
  let globalGrandTotal = 0;
  // Track assistant income already credited across clinics to prevent double-counting
  const assistedExecutorNamesUsed = new Set();

  // Stable row → key map for per-transaction corp selection
  const rowKeyMap = new Map(rows.map((r, i) => [r, String(i)]));

  for (const [clinicId, clinicGroup] of Object.entries(byClinic)) {
    const clinicRows = clinicGroup.rows;
    const clinicLabel = clinicId !== 'unknown' ? rbGetClinicName(clinicId) : clinicGroup.label;
    const clinicSettings = rbGetClinicSettings(execSettings, clinicId);

    const _corpOk = r => {
      if (!colMap.invoiceType) return true;
      const t = String(r[colMap.invoiceType] || '').toLowerCase().trim();
      if (t !== 'юр. компания' && t !== 'юр.компания') return true;
      // Hard rule: corp services before Feb 2026 are never included in salary
      if (colMap.invoiceCreatedDate) {
        const invoiceDate = rbParseDate(r[colMap.invoiceCreatedDate]);
        if (invoiceDate && invoiceDate < new Date(2026, 1, 1)) return false;
      }
      // New: per-transaction selection from report modal (takes priority over legacy)
      if (corpIncludedKeys !== null) {
        return corpIncludedKeys.has(rowKeyMap.get(r));
      }
      // Legacy: per-service-code from executorSettings
      const corpMap = execSettings?.corpIncludedServices;
      if (corpMap != null) {
        const code = colMap.serviceCode ? String(r[colMap.serviceCode] || '').trim() : '';
        return corpMap[code] !== false;
      }
      return !!clinicSettings.includeCorpInvoices;
    };

    // Corp filter for referral rows: ignores corpIncludedKeys (which is executor-scoped),
    // uses only the doctor's own includeCorpInvoices setting — keeps individual/bulk consistent.
    const _corpOkForReferral = r => {
      if (!colMap.invoiceType) return true;
      const t = String(r[colMap.invoiceType] || '').toLowerCase().trim();
      if (t !== 'юр. компания' && t !== 'юр.компания') return true;
      if (colMap.invoiceCreatedDate) {
        const invoiceDate = rbParseDate(r[colMap.invoiceCreatedDate]);
        if (invoiceDate && invoiceDate < new Date(2026, 1, 1)) return false;
      }
      const corpMap = execSettings?.corpIncludedServices;
      if (corpMap != null) {
        const code = colMap.serviceCode ? String(r[colMap.serviceCode] || '').trim() : '';
        return corpMap[code] !== false;
      }
      return !!clinicSettings.includeCorpInvoices;
    };

    // 1. Rows where doctor is referrer
    const referrerRows = colMap.referrer
      ? clinicRows.filter(r => _corpOkForReferral(r) && rbNamesMatch(doctorName, r[colMap.referrer] || ''))
      : [];

    // 2. Rows where doctor is executor
    const executorRows = colMap.executor
      ? clinicRows.filter(r => _corpOk(r) && rbNamesMatch(doctorName, r[colMap.executor] || ''))
      : [];

    // ── Referral bonuses (doctor is referrer) ──
    const byExecutor = {};
    referrerRows.forEach(r => {
      const exec = String(r[colMap.executor] || 'Неизвестный').trim();
      if (!byExecutor[exec]) byExecutor[exec] = [];
      byExecutor[exec].push(r);
    });

    const referralSections = [];
    let referralBonusTotal = 0;

    Object.entries(byExecutor).sort(([a],[b]) => a.localeCompare(b)).forEach(([executor, eRows]) => {
      const byService = {};
      eRows.forEach(r => {
        const code = String(r[colMap.serviceCode] || '').trim();
        const name = String(r[colMap.serviceName] || '').trim();
        const key  = code || name || 'unknown';
        if (!byService[key]) byService[key] = { code, name, cost: 0, count: 0 };
        byService[key].cost += rbParseCost(r);
        byService[key].count += rbIsSpecialDiscountRow(r) ? rbGetRowQty(r) : 1;
      });
      const dbClinicId = (clinicId !== 'unknown') ? String(clinicId) : '';
      const services = Object.values(byService).map(s => {
        const bonus = (dbClinicId
          ? referralBonuses.find(b => b.serviceCode && s.code && rbNormalizeName(b.serviceCode) === rbNormalizeName(s.code) && (b.clinicId || '') === dbClinicId)
          : null)
          || referralBonuses.find(b => b.serviceCode && s.code && rbNormalizeName(b.serviceCode) === rbNormalizeName(s.code) && (!b.clinicId || b.clinicId === ''));
        let bonusAmount = 0, bonusLabel = '—';
        if (bonus) {
          if (bonus.bonusPercent != null) {
            bonusAmount = s.cost * parseFloat(bonus.bonusPercent) / 100;
            bonusLabel = `${parseFloat(bonus.bonusPercent)}%`;
          } else if (bonus.bonusRub != null) {
            bonusAmount = parseFloat(bonus.bonusRub) * s.count;
            bonusLabel = `${parseFloat(bonus.bonusRub).toFixed(2)} ₽`;
          }
        }
        referralBonusTotal += bonusAmount;
        return { ...s, bonusAmount, bonusLabel };
      });
      referralSections.push({ executor, services });
    });

    // ── Payments to referrers (doctor is executor) ──
    const executorByReferrer = {};
    executorRows.forEach(r => {
      const refName = colMap.referrer ? String(r[colMap.referrer] || '').trim() : '';
      if (!refName || rbNamesMatch(doctorName, refName)) return;
      const code    = colMap.serviceCode ? String(r[colMap.serviceCode] || '').trim() : '';
      const svcName = colMap.serviceName ? String(r[colMap.serviceName] || '').trim() : '';
      const cost    = rbParseCost(r);
      const bonusMap = bonusesByServiceCode[code] || {};
      const refDoctor = (allDoctors || []).find(d => rbNamesMatch(d.name, refName));
      if (!refDoctor) return;
      const bonus = bonusMap[refDoctor.id];
      const key = code || svcName;
      if (!executorByReferrer[refDoctor.name]) executorByReferrer[refDoctor.name] = {};
      if (!executorByReferrer[refDoctor.name][key]) {
        executorByReferrer[refDoctor.name][key] = { code, name: svcName, cost: 0, count: 0, bonusAmount: 0, bonusLabel: '—' };
      }
      const entry = executorByReferrer[refDoctor.name][key];
      entry.cost += cost;
      entry.count += rbIsSpecialDiscountRow(r) ? rbGetRowQty(r) : 1;
      if (bonus) {
        if (bonus.bonusPercent != null) {
          entry.bonusAmount += cost * parseFloat(bonus.bonusPercent) / 100;
          entry.bonusLabel = `${parseFloat(bonus.bonusPercent)}%`;
        } else if (bonus.bonusRub != null) {
          entry.bonusAmount += parseFloat(bonus.bonusRub);
          entry.bonusLabel = `${parseFloat(bonus.bonusRub).toFixed(2)} ₽`;
        }
      }
    });

    const executorSections = Object.entries(executorByReferrer)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([referrer, sm]) => ({
        referrer, services: Object.values(sm),
        total: Object.values(sm).reduce((s, x) => s + x.bonusAmount, 0),
      }));
    const referralCostItems = executorSections.map(s => ({ name: s.referrer, amount: s.total }));
    const referralCostTotal = referralCostItems.reduce((s, x) => s + x.amount, 0);

    // ── Performed service bonuses ──
    const perfByService = {};
    executorRows.forEach(r => {
      const code    = colMap.serviceCode ? String(r[colMap.serviceCode] || '').trim() : '';
      const name    = colMap.serviceName ? String(r[colMap.serviceName] || '').trim() : '';
      const cabinet = colMap.cabinet     ? String(r[colMap.cabinet]     || '').trim() : '';
      const key = code || name;
      if (!key) return;
      if (!perfByService[key]) perfByService[key] = { code, name, cost: 0, count: 0, _rows: [] };
      const rowCost = rbParseCost(r);
      perfByService[key].cost  += rowCost;
      perfByService[key].count += rbIsSpecialDiscountRow(r) ? rbGetRowQty(r) : 1;
      perfByService[key]._rows.push({
        cost: rowCost,
        cabinet,
        assistant: colMap.assistant ? String(r[colMap.assistant] || '').trim() : '',
        anesthesiologist: colMap.anesthesiologist ? String(r[colMap.anesthesiologist] || '').trim() : '',
        nurse: colMap.nurse ? String(r[colMap.nurse] || '').trim() : '',
        serviceSpec: colMap.serviceSpec ? String(r[colMap.serviceSpec] || '').trim() : '',
      });
    });

    const performedServicesSum = executorRows.reduce((s, r) => s + rbParseCost(r), 0);
    const totalServiceCount = executorRows.reduce((s, r) => s + (rbIsSpecialDiscountRow(r) ? rbGetRowQty(r) : 1), 0);

    const execDeductions = clinicSettings.deductions || [];
    // НДФЛ выносится в футер отчёта после «К выплате» — не участвует в расчёте finalSalary
    const ndflDeduction = execDeductions.find(d => (d.name || '').trim() === 'НДФЛ');
    const execDeductionsFiltered = ndflDeduction
      ? execDeductions.filter(d => d !== ndflDeduction)
      : execDeductions;
    // Для нормированного типа материалы не применяются (секция скрыта в UI)
    const _isNormedPt = (clinicSettings.payType || 'salary') === 'normed';
    const execMaterials  = _isNormedPt ? [] : (clinicSettings.materials  || []);
    const execExtras     = clinicSettings.extras     || [];
    const execServiceMaterials = _isNormedPt ? [] : (clinicSettings.serviceMaterials || []);
    const extrasTotal = execExtras.reduce((s, e) => s + calcExtraRub(e), 0);

    const turnoverDeductions = execDeductionsFiltered.filter(d => d.deductionType !== 'final');
    const finalDeductions    = execDeductionsFiltered.filter(d => d.deductionType === 'final');
    const turnoverMaterials  = execMaterials.filter(m => m.deductionType !== 'final');
    const finalMaterials     = execMaterials.filter(m => m.deductionType === 'final');

    const svcMatTurnoverMap = {};
    const svcMatFinalItems = [];
    // Вспомогательная функция: ключ для поиска по коду или по имени (если код пустой)
    const svcKey = (m) => m.serviceCode ? rbNormalizeName(m.serviceCode) : ('name:' + rbNormalizeName(m.serviceName || m.name || ''));
    const svcLookup = (svc) => svcMatTurnoverMap[rbNormalizeName(svc.code)] || svcMatTurnoverMap['name:' + rbNormalizeName(svc.name)];
    execServiceMaterials.forEach(m => {
      if (m.deductionType === 'final') { svcMatFinalItems.push(m); }
      else { svcMatTurnoverMap[svcKey(m)] = m; }
    });

    const nonOverrideSum   = Object.values(perfByService).reduce((s, svc) => svcLookup(svc) ? s : s + svc.cost, 0);
    const turnoverDeductionsTotal = turnoverDeductions.reduce((s, d) => s + calcItemRub(d, performedServicesSum), 0);
    const turnoverMaterialsTotal  = turnoverMaterials.reduce((s, m) => s + calcItemRub(m, nonOverrideSum), 0);
    const deductionPerService = totalServiceCount > 0 ? (turnoverDeductionsTotal + turnoverMaterialsTotal) / totalServiceCount : 0;
    // Пропорциональные факторы: удержание/материалы применяются как % от стоимости строки,
    // а не равномерно по количеству. Это гарантирует, что полная сумма удержания учтётся
    // только в тех строках, где реально начисляется бонус (нет «потерянных» долей).
    const deductionFactor = performedServicesSum > 0 ? turnoverDeductionsTotal / performedServicesSum : 0;
    const materialFactor  = nonOverrideSum > 0 ? turnoverMaterialsTotal / nonOverrideSum : 0;
    // В промежуточном отчёте применяем только взыскание "Удержание" (тип оборот)
    const uderzhanieDeduction = execDeductions.find(
      d => (d.name || '').trim() === 'Удержание' && d.deductionType !== 'final'
    );
    const uderzhanieDeductionFactor = (interim && uderzhanieDeduction && performedServicesSum > 0)
      ? calcItemRub(uderzhanieDeduction, performedServicesSum) / performedServicesSum
      : 0;

    const _psvcClinicId = clinicId !== 'unknown' ? String(clinicId) : '';
    let performedBonusTotal = 0;
    const assistancePayments = {};
    const anesthesiologistPayments = {};
    const nursePayments = {};

    // Pre-load own settings for each unique anesthesiologist/assistant/nurse in parallel
    const anestSettingsCache = {};
    const asstSettingsCache  = {};
    const nurseSettingsCache = {};
    await Promise.all([
      ...(colMap.anesthesiologist ? [...new Set(
        rows.filter(rbRowInDateRange).flatMap(r => splitPersonNames(r[colMap.anesthesiologist])).filter(Boolean)
      )].map(async name => {
        const doc = (allDoctors || []).find(d => rbNamesMatch(d.name, name));
        if (doc) try { anestSettingsCache[name] = await loadExecSettings(doc.id); } catch {}
      }) : []),
      ...(colMap.assistant ? [...new Set(
        rows.filter(rbRowInDateRange).flatMap(r => splitPersonNames(r[colMap.assistant])).filter(Boolean)
      )].map(async name => {
        const doc = (allDoctors || []).find(d => rbNamesMatch(d.name, name));
        if (doc) try { asstSettingsCache[name] = await loadExecSettings(doc.id); } catch {}
      }) : []),
      ...(colMap.nurse ? [...new Set(
        rows.filter(rbRowInDateRange).flatMap(r => splitPersonNames(r[colMap.nurse])).filter(Boolean)
      )].map(async name => {
        const doc = (allDoctors || []).find(d => rbNamesMatch(d.name, name));
        if (doc) try { nurseSettingsCache[name] = await loadExecSettings(doc.id); } catch {}
      }) : []),
    ]);

    const performedSections = Object.values(perfByService).map(s => {
      let bonusAmount = 0;
      const bonusLabels = new Set();
      const svcOverrideMat = svcLookup(s);

      (s._rows || [{ cost: s.cost, cabinet: '' }]).forEach(row => {
        const cab = row.cabinet || '';
        const bonus = (
          (cab ? performedDbBonuses.find(b =>
            b.serviceCode && s.code &&
            rbNormalizeName(b.serviceCode) === rbNormalizeName(s.code) &&
            b.clinicId === _psvcClinicId &&
            rbCabMatch(b.cabinetId, cab)
          ) : null)
          || (cab ? performedDbBonuses.find(b =>
            b.serviceCode && s.code &&
            rbNormalizeName(b.serviceCode) === rbNormalizeName(s.code) &&
            (!b.clinicId || b.clinicId === '') &&
            rbCabMatch(b.cabinetId, cab)
          ) : null)
          || performedDbBonuses.find(b =>
            b.serviceCode && s.code &&
            rbNormalizeName(b.serviceCode) === rbNormalizeName(s.code) &&
            b.clinicId === _psvcClinicId &&
            (!b.cabinetId || b.cabinetId === '')
          )
          || performedDbBonuses.find(b =>
            b.serviceCode && s.code &&
            rbNormalizeName(b.serviceCode) === rbNormalizeName(s.code) &&
            (!b.clinicId || b.clinicId === '') &&
            (!b.cabinetId || b.cabinetId === '')
          )
        );

        if (bonus) {
          if (bonus.bonusPercent != null) {
            const matForRow = interim ? 0 : (svcOverrideMat
              ? (svcOverrideMat.valueType === 'percent'
                  ? row.cost * parseFloat(svcOverrideMat.value) / 100
                  : parseFloat(svcOverrideMat.value) / (s.count || 1))
              : row.cost * materialFactor);
            const effectiveCost = interim
              ? row.cost * (1 - uderzhanieDeductionFactor)
              : row.cost * (1 - deductionFactor) - matForRow;
            const grossBonus = effectiveCost * parseFloat(bonus.bonusPercent) / 100;

            // ── Вспомогательная функция: поиск услуги в roleServices по коду ──
            const findRoleService = (roleServicesMap, role, code) => {
              const clinicArr = (roleServicesMap?.[role] || {})[_psvcClinicId] || [];
              const globalArr = (roleServicesMap?.[role] || {})[''] || [];
              return clinicArr.find(rs => rs.serviceCode && code && rbNormalizeName(rs.serviceCode) === rbNormalizeName(code))
                || globalArr.find(rs => rs.serviceCode && code && rbNormalizeName(rs.serviceCode) === rbNormalizeName(code))
                || null;
            };

            // ── Assistant deduction ──
            let asstBonus = 0;
            let asstMatchedEntry = null;
            if (!interim && row.assistant) {
              for (const assistantName of splitPersonNames(row.assistant)) {
                const asstOwnData = asstSettingsCache[assistantName];
                let nameBonus = 0, nameEntry = null;
                // Новая система: roleServices.assistant (точный код услуги)
                const roleMatch = asstOwnData ? findRoleService(asstOwnData.roleServices, 'assistant', s.code) : null;
                if (roleMatch) {
                  const val = parseFloat(roleMatch.value) || 0;
                  if (val > 0) {
                    nameBonus = roleMatch.valueType === 'rub' ? val : effectiveCost * val / 100;
                    nameEntry = roleMatch;
                  }
                } else {
                  // Старая система: assistants[] у основного врача или глобальный процент
                  const _indivAsst = (execSettings.assistants || []).find(a => rbNamesMatch(a.name, assistantName));
                  if (_indivAsst != null) {
                    const vt = _indivAsst.valueType || 'percent';
                    const val = parseFloat(_indivAsst.value ?? _indivAsst.percent) || 0;
                    nameBonus = vt === 'rub' ? val : effectiveCost * val / 100;
                  } else {
                    const vt = clinicSettings.assistanceValueType || 'percent';
                    const val = parseFloat(clinicSettings.assistancePercent) || 0;
                    nameBonus = vt === 'rub' ? val : effectiveCost * val / 100;
                  }
                }
                asstBonus += nameBonus;
                if (nameEntry && !asstMatchedEntry) asstMatchedEntry = nameEntry;
                if (nameBonus > 0) {
                  if (!assistancePayments[assistantName]) assistancePayments[assistantName] = { total: 0, services: {} };
                  assistancePayments[assistantName].total += nameBonus;
                  const svcKey = s.code || s.name;
                  if (!assistancePayments[assistantName].services[svcKey])
                    assistancePayments[assistantName].services[svcKey] = { code: s.code, name: s.name, income: 0, count: 0, aValue: nameEntry?.value, aValueType: nameEntry?.valueType };
                  assistancePayments[assistantName].services[svcKey].income += nameBonus;
                  assistancePayments[assistantName].services[svcKey].count++;
                }
              }
            }

            // ── Anesthesiologist deduction: сначала roleServices (точный код), затем правила (текст) ──
            let anestBonus = 0;
            let anestMatchedRule = null;
            if (!interim && row.anesthesiologist) {
              for (const anesthesiologistName of splitPersonNames(row.anesthesiologist)) {
                const anestOwnData = anestSettingsCache[anesthesiologistName];
                if (anestOwnData) {
                  let nameBonus = 0, nameRule = null;
                  const roleMatch = findRoleService(anestOwnData.roleServices, 'anesthesiologist', s.code);
                  if (roleMatch) {
                    const val = parseFloat(roleMatch.value) || 0;
                    if (val > 0) nameBonus = roleMatch.valueType === 'rub' ? val : effectiveCost * val / 100;
                  } else if ((anestOwnData.anesthesiologistRules || []).length) {
                    // Fallback на старую систему (текстовый поиск)
                    const svcSpec = row.serviceSpec || '';
                    nameRule = anestOwnData.anesthesiologistRules.find(r => anestRuleMatches(r, s.name || '', svcSpec)) || null;
                    if (nameRule) {
                      const val = parseFloat(nameRule.value) || 0;
                      if (val > 0) nameBonus = nameRule.valueType === 'rub' ? val : effectiveCost * val / 100;
                    }
                  }
                  anestBonus += nameBonus;
                  if (nameRule && !anestMatchedRule) anestMatchedRule = nameRule;
                  if (nameBonus > 0) {
                    if (!anesthesiologistPayments[anesthesiologistName]) anesthesiologistPayments[anesthesiologistName] = { total: 0, services: {} };
                    anesthesiologistPayments[anesthesiologistName].total += nameBonus;
                    const svcKey = s.code || s.name;
                    if (!anesthesiologistPayments[anesthesiologistName].services[svcKey])
                      anesthesiologistPayments[anesthesiologistName].services[svcKey] = {
                        code: s.code, name: s.name, income: 0, count: 0,
                        ruleContains: nameRule?.contains, aValue: nameRule?.value, aValueType: nameRule?.valueType,
                      };
                    anesthesiologistPayments[anesthesiologistName].services[svcKey].income += nameBonus;
                    anesthesiologistPayments[anesthesiologistName].services[svcKey].count++;
                  }
                }
              }
            }

            // ── Nurse deduction (новая система: roleServices.nurse) ──
            let nurseBonus = 0;
            if (!interim && row.nurse) {
              for (const nurseName of splitPersonNames(row.nurse)) {
                const nurseOwnData = nurseSettingsCache[nurseName];
                if (nurseOwnData) {
                  const roleMatch = findRoleService(nurseOwnData.roleServices, 'nurse', s.code);
                  if (roleMatch) {
                    const val = parseFloat(roleMatch.value) || 0;
                    if (val > 0) {
                      nurseBonus = roleMatch.valueType === 'rub' ? val : effectiveCost * val / 100;
                      if (!nursePayments[nurseName]) nursePayments[nurseName] = { total: 0, services: {} };
                      nursePayments[nurseName].total += nurseBonus;
                      const svcKey = s.code || s.name;
                      if (!nursePayments[nurseName].services[svcKey])
                        nursePayments[nurseName].services[svcKey] = { code: s.code, name: s.name, income: 0, count: 0 };
                      nursePayments[nurseName].services[svcKey].income += nurseBonus;
                      nursePayments[nurseName].services[svcKey].count++;
                      break;
                    }
                  }
                }
              }
            }

            bonusAmount += Math.max(0, grossBonus - asstBonus - anestBonus - nurseBonus);
            bonusLabels.add(`${parseFloat(bonus.bonusPercent)}%`);
          } else if (bonus.bonusRub != null) {
            bonusAmount += parseFloat(bonus.bonusRub);
            bonusLabels.add(`${parseFloat(bonus.bonusRub).toFixed(2)} ₽`);
          }
        }
      });

      const bonusLabel = bonusLabels.size === 0 ? '—' : bonusLabels.size === 1 ? [...bonusLabels][0] : [...bonusLabels].join(', ');
      performedBonusTotal += bonusAmount;
      return { ...s, bonusAmount, bonusLabel };
    }).filter(s => s.bonusAmount !== 0 || s.code);

    const assistancePaidTotal = Object.values(assistancePayments).reduce((s, x) => s + x.total, 0);
    const assistanceSections  = Object.entries(assistancePayments).map(([name, data]) => ({
      name, total: data.total, services: Object.values(data.services),
    }));

    const anesthesiologistPaidTotal = Object.values(anesthesiologistPayments).reduce((s, x) => s + x.total, 0);
    const anesthesiologistSections  = Object.entries(anesthesiologistPayments).map(([name, data]) => ({
      name, total: data.total, services: Object.values(data.services),
    }));

    const nursePaidTotal = Object.values(nursePayments).reduce((s, x) => s + x.total, 0);
    const nurseSections  = Object.entries(nursePayments).map(([name, data]) => ({
      name, total: data.total, services: Object.values(data.services),
    }));

    // ── Вспомогательная функция: поиск услуги в roleServices по коду, с учётом clinicId ──
    const findMyRoleService = (role, svcCode, cId) => {
      const rs = execSettings.roleServices?.[role] || {};
      const clinicArr = rs[cId !== 'unknown' ? cId : ''] || [];
      const globalArr = rs[''] || [];
      return clinicArr.find(e => e.serviceCode && svcCode && rbNormalizeName(e.serviceCode) === rbNormalizeName(svcCode))
        || globalArr.find(e => e.serviceCode && svcCode && rbNormalizeName(e.serviceCode) === rbNormalizeName(svcCode))
        || null;
    };

    // ── Corp filter helper for role-income sections ──
    // Returns true if the row is a corp row that should be excluded based on executor's clinic settings.
    const _roleCorpExclude = (r, execClinicSettings) => {
      if (!colMap.invoiceType) return false;
      const t = String(r[colMap.invoiceType] || '').toLowerCase().trim();
      if (t !== 'юр. компания' && t !== 'юр.компания') return false;
      // Hard rule: corp before Feb 2026 always excluded
      if (colMap.invoiceCreatedDate) {
        const invoiceDate = rbParseDate(r[colMap.invoiceCreatedDate]);
        if (invoiceDate && invoiceDate < new Date(2026, 1, 1)) return true;
      }
      // Per-transaction selection from modal takes priority
      if (corpIncludedKeys !== null) {
        return !corpIncludedKeys.has(rowKeyMap.get(r));
      }
      // Fallback: executor's clinic setting
      return !execClinicSettings?.includeCorpInvoices;
    };

    // ── Assistance income (rows where THIS doctor is listed as assistant) ──
    let assistanceIncomeTotal = 0;
    const assistanceIncomeSections = [];
    if (colMap.assistant) {
      const asstIncRows = rows.filter(r =>
        splitPersonNames(r[colMap.assistant]).some(n => rbNamesMatch(doctorName, n)) && rbRowInDateRange(r)
      );
      if (asstIncRows.length) {
        const byExec = {};
        asstIncRows.forEach(r => {
          const execName   = colMap.executor ? String(r[colMap.executor] || '').trim() : '';
          const clinicRaw2 = colMap.clinic ? String(r[colMap.clinic] || '').trim() : '';
          const cId2  = rbMatchClinicId(clinicRaw2) || 'unknown';
          const cost2 = rbParseCost(r);
          const svcCode2 = colMap.serviceCode ? String(r[colMap.serviceCode] || '').trim() : '';
          const svcName2 = colMap.serviceName ? String(r[colMap.serviceName] || '').trim() : '';
          if (!execName) return;
          if (!byExec[execName]) byExec[execName] = {};
          if (!byExec[execName][cId2]) byExec[execName][cId2] = [];
          byExec[execName][cId2].push({ cost: cost2, svcCode: svcCode2, svcName: svcName2, _raw: r });
        });

        const _asstIncExecCache = {};
        await Promise.all(Object.keys(byExec).map(async execName => {
          const doc = (allDoctors || []).find(d => rbNamesMatch(d.name, execName));
          if (doc) try { _asstIncExecCache[execName] = await loadExecSettings(doc.id); } catch {}
        }));

        for (const [execName, byClinicMap2] of Object.entries(byExec)) {
          let secTotal = 0;
          const svcBreakdown2 = {};

          const execData2 = _asstIncExecCache[execName];
          if (!execData2) continue;
          for (const [cId3, cRows3] of Object.entries(byClinicMap2)) {
            const eCS = rbGetClinicSettings(execData2, cId3);
            const filteredRows3 = cRows3.filter(r2 => !_roleCorpExclude(r2._raw, eCS));
            if (!filteredRows3.length) continue;
            const _indivEntry = (execData2.assistants || []).find(a => rbNamesMatch(a.name, doctorName));
            let aValueType, aValue;
            if (_indivEntry != null) {
              aValueType = _indivEntry.valueType || 'percent';
              aValue = parseFloat(_indivEntry.value ?? _indivEntry.percent) || 0;
            } else {
              aValueType = eCS.assistanceValueType || 'percent';
              aValue = parseFloat(eCS.assistancePercent) || 0;
            }
            if (!aValue) continue;
            filteredRows3.forEach(row2 => {
              const inc = aValueType === 'rub' ? aValue : row2.cost * aValue / 100;
              secTotal += inc;
              assistanceIncomeTotal += inc;
              const k2 = row2.svcCode || row2.svcName;
              if (!svcBreakdown2[k2])
                svcBreakdown2[k2] = { code: row2.svcCode, name: row2.svcName, cost: 0, count: 0, income: 0, aValueType, aValue };
              svcBreakdown2[k2].cost   += row2.cost;
              svcBreakdown2[k2].count++;
              svcBreakdown2[k2].income += inc;
            });
          }

          if (secTotal > 0) {
            assistanceIncomeSections.push({ execName, total: secTotal, services: Object.values(svcBreakdown2) });
          }
        }
      }
    }

    // ── Supplement assistance income from saved salary records ──
    // Covers cases where Doctor B's Excel doesn't contain Doctor A's rows,
    // or name matching fails. Uses exactly the amount Doctor A saved (post-deductions).
    // Requires Doctor A to have saved their salary record for the same period.
    assistanceIncomeSections.forEach(s => assistedExecutorNamesUsed.add(rbNormalizeName(s.execName)));
    for (const entry of (savedAssistanceIncome || [])) {
      if (!rbNamesMatch(doctorName, entry.assistantName)) continue;
      const key = rbNormalizeName(entry.executorDoctorName);
      if (assistedExecutorNamesUsed.has(key)) continue;
      if (entry.total > 0) {
        assistedExecutorNamesUsed.add(key);
        assistanceIncomeTotal += entry.total;
        assistanceIncomeSections.push({
          execName: entry.executorDoctorName,
          total: entry.total,
          services: entry.services || [],
        });
      }
    }

    // ── Anesthesiologist income (rows where THIS doctor is listed as anesthesiologist) ──
    let anesthesiologistIncomeTotal = 0;
    const anesthesiologistIncomeSections = [];
    const myAnestRules = execSettings.anesthesiologistRules || [];
    const myAnestRoleServices = execSettings.roleServices?.anesthesiologist || {};
    const hasAnestRoleServices = Object.values(myAnestRoleServices).some(arr => arr.length > 0);
    if (colMap.anesthesiologist && (myAnestRules.length || hasAnestRoleServices)) {
      const anestIncRows = rows.filter(r =>
        splitPersonNames(r[colMap.anesthesiologist]).some(n => rbNamesMatch(doctorName, n)) && rbRowInDateRange(r)
      );
      if (anestIncRows.length) {
        const byExec = {};
        anestIncRows.forEach(r => {
          const execName = colMap.executor ? String(r[colMap.executor] || '').trim() : '';
          const cost2    = rbParseCost(r);
          const svcCode2 = colMap.serviceCode ? String(r[colMap.serviceCode] || '').trim() : '';
          const svcName2 = colMap.serviceName ? String(r[colMap.serviceName] || '').trim() : '';
          const svcSpec2 = colMap.serviceSpec ? String(r[colMap.serviceSpec] || '').trim() : '';
          const clinicRaw2 = colMap.clinic ? String(r[colMap.clinic] || '').trim() : '';
          const cId2 = rbMatchClinicId(clinicRaw2) || 'unknown';
          if (!execName) return;
          if (!byExec[execName]) byExec[execName] = [];
          byExec[execName].push({ cost: cost2, svcCode: svcCode2, svcName: svcName2, svcSpec: svcSpec2, cId: cId2, _raw: r });
        });

        const _anestIncExecCache = {};
        await Promise.all(Object.keys(byExec).map(async execName => {
          const doc = (allDoctors || []).find(d => rbNamesMatch(d.name, execName));
          if (doc) try { _anestIncExecCache[execName] = await loadExecSettings(doc.id); } catch {}
        }));

        for (const [execName, svcRows] of Object.entries(byExec)) {
          const execData2Anest = _anestIncExecCache[execName] ?? null;

          let secTotal = 0;
          const svcBreakdown2 = {};
          svcRows.forEach(row2 => {
            const eCS2 = execData2Anest ? rbGetClinicSettings(execData2Anest, row2.cId) : null;
            if (_roleCorpExclude(row2._raw, eCS2)) return;
            let inc = 0, aValue, aValueType, ruleContains;
            if (hasAnestRoleServices) {
              // Новая система: точный код услуги
              const match = findMyRoleService('anesthesiologist', row2.svcCode, row2.cId);
              if (!match) return;
              const val = parseFloat(match.value) || 0;
              inc = match.valueType === 'rub' ? val : row2.cost * val / 100;
              aValue = match.value; aValueType = match.valueType;
            } else {
              // Старая система: правила (текстовый поиск)
              const matchedRule = myAnestRules.find(r => anestRuleMatches(r, row2.svcName || '', row2.svcSpec || ''));
              if (!matchedRule) return;
              const val = parseFloat(matchedRule.value) || 0;
              inc = matchedRule.valueType === 'rub' ? val : row2.cost * val / 100;
              aValue = matchedRule.value; aValueType = matchedRule.valueType; ruleContains = matchedRule.contains;
            }
            if (inc === 0) return;
            secTotal += inc;
            anesthesiologistIncomeTotal += inc;
            const k2 = row2.svcCode || row2.svcName;
            if (!svcBreakdown2[k2])
              svcBreakdown2[k2] = { code: row2.svcCode, name: row2.svcName, cost: 0, count: 0, income: 0, ruleContains, aValue, aValueType };
            svcBreakdown2[k2].cost   += row2.cost;
            svcBreakdown2[k2].count++;
            svcBreakdown2[k2].income += inc;
          });
          if (secTotal !== 0) {
            anesthesiologistIncomeSections.push({ execName, total: secTotal, services: Object.values(svcBreakdown2) });
          }
        }
      }
    }

    // ── Nurse income (rows where THIS doctor is listed as nurse) ──
    let nurseIncomeTotal = 0;
    const nurseIncomeSections = [];
    const myNurseRoleServices = execSettings.roleServices?.nurse || {};
    const hasNurseRoleServices = Object.values(myNurseRoleServices).some(arr => arr.length > 0);
    if (colMap.nurse && hasNurseRoleServices) {
      const nurseIncRows = rows.filter(r =>
        splitPersonNames(r[colMap.nurse]).some(n => rbNamesMatch(doctorName, n)) && rbRowInDateRange(r)
      );
      if (nurseIncRows.length) {
        const byExec = {};
        nurseIncRows.forEach(r => {
          const execName = colMap.executor ? String(r[colMap.executor] || '').trim() : '';
          const cost2    = rbParseCost(r);
          const svcCode2 = colMap.serviceCode ? String(r[colMap.serviceCode] || '').trim() : '';
          const svcName2 = colMap.serviceName ? String(r[colMap.serviceName] || '').trim() : '';
          const clinicRaw2 = colMap.clinic ? String(r[colMap.clinic] || '').trim() : '';
          const cId2 = rbMatchClinicId(clinicRaw2) || 'unknown';
          if (!execName) return;
          if (!byExec[execName]) byExec[execName] = [];
          byExec[execName].push({ cost: cost2, svcCode: svcCode2, svcName: svcName2, cId: cId2, _raw: r });
        });

        const _nurseIncExecCache = {};
        await Promise.all(Object.keys(byExec).map(async execName => {
          const doc = (allDoctors || []).find(d => rbNamesMatch(d.name, execName));
          if (doc) try { _nurseIncExecCache[execName] = await loadExecSettings(doc.id); } catch {}
        }));

        for (const [execName, svcRows] of Object.entries(byExec)) {
          const execData2Nurse = _nurseIncExecCache[execName] ?? null;

          let secTotal = 0;
          const svcBreakdown2 = {};
          svcRows.forEach(row2 => {
            const eCS2 = execData2Nurse ? rbGetClinicSettings(execData2Nurse, row2.cId) : null;
            if (_roleCorpExclude(row2._raw, eCS2)) return;
            const match = findMyRoleService('nurse', row2.svcCode, row2.cId);
            if (!match) return;
            const val = parseFloat(match.value) || 0;
            const inc = match.valueType === 'rub' ? val : row2.cost * val / 100;
            if (inc === 0) return;
            secTotal += inc;
            nurseIncomeTotal += inc;
            const k2 = row2.svcCode || row2.svcName;
            if (!svcBreakdown2[k2])
              svcBreakdown2[k2] = { code: row2.svcCode, name: row2.svcName, cost: 0, count: 0, income: 0, aValue: match.value, aValueType: match.valueType };
            svcBreakdown2[k2].cost   += row2.cost;
            svcBreakdown2[k2].count++;
            svcBreakdown2[k2].income += inc;
          });
          if (secTotal > 0) {
            nurseIncomeSections.push({ execName, total: secTotal, services: Object.values(svcBreakdown2) });
          }
        }
      }
    }

    // ── Base pay calculation ──
    const pt = clinicSettings.payType || 'salary';
    let basePay = 0, basePayLabel = '';
    let normTotalHours = 0, normPremiumAmount = 0;
    let effectiveHoursWorked = 0;
    let effectiveDaysWorked = 0;
    const normPremiumByRole = []; // [{ roleTitle, categoryId, premiumAmount, workedHours, norm }]
    const hourlyRatesBreakdown = []; // { label, rate, hours, pay } — populated only for pt==='hourly'
    const _schedClinicId = (clinicId === 'global' || clinicId === 'unknown') ? null : clinicId;

    if (pt === 'salary') {
      basePay = parseFloat(clinicSettings.fixedSalary) || 0;
      basePayLabel = 'Фиксированный оклад';
    } else if (pt === 'hourly') {
      const baseRate = parseFloat(clinicSettings.hourlyRate) || 0;
      const roleRates = clinicSettings.roleRates || [];
      basePayLabel = 'Почасовой оклад';

      if (clinicSettings.hoursFromSchedule && scheduleEntries && dateFrom && dateTo) {
        const { total: schedTotal, days: schedDays, byRole: schedByRole, byCategory: schedByCategory, categoryRoles: schedCategoryRoles } = calcScheduleHoursForPeriod(scheduleEntries, dateFrom, dateTo, _schedClinicId);
        effectiveHoursWorked = schedTotal;
        effectiveDaysWorked  = schedDays || 0;

        const roleNormOverrides = clinicSettings.roleNormOverrides || [];

        for (const [roleTitle, hours] of Object.entries(schedByRole)) {
          const rr = roleTitle ? roleRates.find(r => r.roleTitle === roleTitle) : null;
          const rate = rr ? (parseFloat(rr.rate) || baseRate) : baseRate;
          const pay = Math.round(rate * hours);
          basePay += pay;
          hourlyRatesBreakdown.push({ label: roleTitle || 'Без указания', rate, hours, pay });
          const normOverride = roleTitle ? roleNormOverrides.find(n => n.roleTitle === roleTitle) : null;
          const norm = normOverride ? parseFloat(normOverride.normHours) : (roleTitle ? (_normsByRole[roleTitle] ?? null) : _normHoursForPeriod);
          if (norm != null && hours > 0 && hours >= 2 * norm) {
            const premiumHours = hours - 2 * norm;
            const premiumAmt = rate * premiumHours;
            normPremiumAmount += premiumAmt;
            normPremiumByRole.push({ roleTitle: roleTitle || null, categoryId: null, premiumAmount: premiumAmt, workedHours: hours, norm, premiumHours });
          }
        }

        for (const [categoryId, hours] of Object.entries(schedByCategory)) {
          const rr = roleRates.find(r => r.roleTitle === categoryId);
          const rate = rr ? (parseFloat(rr.rate) || baseRate) : baseRate;
          const pay = Math.round(rate * hours);
          basePay += pay;
          hourlyRatesBreakdown.push({ label: _categoryLabels[categoryId] || categoryId, rate, hours, pay });
          const roleForNorm = schedCategoryRoles?.[categoryId] || null;
          const normOverride = roleForNorm ? roleNormOverrides.find(n => n.roleTitle === roleForNorm) : null;
          const norm = normOverride ? parseFloat(normOverride.normHours) : (roleForNorm ? (_normsByRole[roleForNorm] ?? _normsByCategory[categoryId] ?? null) : (_normsByCategory[categoryId] ?? null));
          if (norm != null && hours > 0 && hours >= 2 * norm) {
            const premiumHours = hours - 2 * norm;
            const premiumAmt = rate * premiumHours;
            normPremiumAmount += premiumAmt;
            normPremiumByRole.push({ roleTitle: null, categoryId, label: _categoryLabels[categoryId] || null, premiumAmount: premiumAmt, workedHours: hours, norm, premiumHours });
          }
        }
      } else {
        const hasPerRoleHours = roleRates.some(rr => (parseFloat(rr.hoursWorked) || 0) > 0);
        if (hasPerRoleHours) {
          for (const rr of roleRates) {
            const hours = parseFloat(rr.hoursWorked) || 0;
            const rate  = parseFloat(rr.rate) || baseRate;
            const pay = Math.round(rate * hours);
            basePay += pay;
            effectiveHoursWorked += hours;
            hourlyRatesBreakdown.push({ label: rr.roleTitle || 'Без указания', rate, hours, pay });
          }
        } else {
          effectiveHoursWorked = parseFloat(clinicSettings.hoursWorked) || 0;
          basePay = baseRate * effectiveHoursWorked;
          if (_normHoursForPeriod != null && effectiveHoursWorked > 0 && effectiveHoursWorked >= 2 * _normHoursForPeriod) {
            const premiumHours = effectiveHoursWorked - 2 * _normHoursForPeriod;
            normPremiumAmount = baseRate * premiumHours;
            normPremiumByRole.push({ roleTitle: null, premiumAmount: normPremiumAmount, workedHours: effectiveHoursWorked, norm: _normHoursForPeriod, premiumHours });
          }
        }
        // Fallback: count scheduled days even when hours are entered manually
        if (effectiveDaysWorked === 0 && scheduleEntries?.length && dateFrom && dateTo) {
          const { days: sDays } = calcScheduleHoursForPeriod(scheduleEntries, dateFrom, dateTo, _schedClinicId);
          effectiveDaysWorked = sDays || 0;
        }
      }
      basePay = Math.round(basePay);
    } else if (pt === 'percent') {
      basePay = performedBonusTotal;
      basePayLabel = 'Выполненные услуги';
    } else if (pt === 'normed') {
      const fixedSalary  = parseFloat(clinicSettings.fixedSalary) || 0;
      const normServices = clinicSettings.normServices || [];
      let normServicesTotal = 0;
      basePayLabel = 'Нормированный оклад';

      if (clinicSettings.hoursFromSchedule && scheduleEntries && dateFrom && dateTo) {
        const { total: schedTotal, days: schedDays, byRole: schedByRole, byCategory: schedByCategory } = calcScheduleHoursForPeriod(scheduleEntries, dateFrom, dateTo, _schedClinicId);
        effectiveDaysWorked = schedDays || 0;

        // Group normServices by roleTitle; '' = untagged
        const roleGroups = {};
        normServices.forEach(ns => {
          const role = ns.roleTitle || '';
          if (!roleGroups[role]) roleGroups[role] = { items: [], manualHours: 0 };
          roleGroups[role].items.push(ns);
          roleGroups[role].manualHours += parseFloat(ns.hours) || 0;
        });

        for (const [roleTitle, group] of Object.entries(roleGroups)) {
          // For tagged roles use schedule hours for that role; for untagged use total
          const schedRoleHours = roleTitle ? (schedByRole[roleTitle] ?? 0) : schedTotal;
          const ratio = group.manualHours > 0 ? schedRoleHours / group.manualHours : 0;
          let groupPay = 0;
          group.items.forEach(ns => {
            groupPay += (parseFloat(ns.rate) || 0) * (parseFloat(ns.hours) || 0) * ratio;
          });
          normServicesTotal += groupPay;
          normTotalHours   += schedRoleHours;

          const norm = roleTitle ? (_normsByRole[roleTitle] ?? null) : _normHoursForPeriod;
          if (norm != null && schedRoleHours > 0 && schedRoleHours >= 2 * norm) {
            const premiumHours = schedRoleHours - 2 * norm;
            const premiumAmt = groupPay > 0 ? groupPay * (premiumHours / schedRoleHours) : 0;
            normPremiumAmount += premiumAmt;
            normPremiumByRole.push({ roleTitle: roleTitle || null, categoryId: null, premiumAmount: premiumAmt, workedHours: schedRoleHours, norm, premiumHours });
          }
        }

        // Category-based schedule hours: use fixedSalary rate per hour (fixedSalary / normHours)
        for (const [categoryId, hours] of Object.entries(schedByCategory)) {
          const norm = _normsByCategory[categoryId] ?? null;
          normTotalHours += hours;
          const catRate = norm && norm > 0 ? parseFloat(clinicSettings.fixedSalary || 0) / norm : 0;
          const catPay = catRate * hours;
          normServicesTotal += catPay;
          if (norm != null && hours > 0 && hours >= 2 * norm) {
            const premiumHours = hours - 2 * norm;
            const premiumAmt = catPay > 0 ? catPay * (premiumHours / hours) : 0;
            normPremiumAmount += premiumAmt;
            normPremiumByRole.push({ roleTitle: null, categoryId, label: _categoryLabels[categoryId] || null, premiumAmount: premiumAmt, workedHours: hours, norm, premiumHours });
          }
        }
      } else {
        // Manual hours — group by roleTitle for per-role premium check
        const roleGroups = {};
        normServices.forEach(ns => {
          const role = ns.roleTitle || '';
          if (!roleGroups[role]) roleGroups[role] = { hours: 0, total: 0 };
          const hours = parseFloat(ns.hours) || 0;
          roleGroups[role].hours += hours;
          roleGroups[role].total += (parseFloat(ns.rate) || 0) * hours;
        });

        normServicesTotal = normServices.reduce((s, ns) => s + (parseFloat(ns.rate) || 0) * (parseFloat(ns.hours) || 0), 0);
        normTotalHours    = normServices.reduce((s, ns) => s + (parseFloat(ns.hours) || 0), 0);

        for (const [roleTitle, group] of Object.entries(roleGroups)) {
          const norm = roleTitle ? (_normsByRole[roleTitle] ?? null) : _normHoursForPeriod;
          if (norm != null && group.hours > 0 && group.hours >= 2 * norm) {
            const premiumHours = group.hours - 2 * norm;
            const premiumAmt = group.total * (premiumHours / group.hours);
            normPremiumAmount += premiumAmt;
            normPremiumByRole.push({ roleTitle: roleTitle || null, premiumAmount: premiumAmt, workedHours: group.hours, norm, premiumHours });
          }
        }
      }

      basePay = fixedSalary + normServicesTotal;
    }

    // ── Holiday surcharge (x2 rate): surcharge = rate × holiday_hours per role/category ──
    const holidaySurchargeBreakdown = []; // [{ label, hours, rate, amount }]
    let holidaySurchargeTotal = 0;
    if (holidayDates?.size && scheduleEntries?.length && dateFrom && dateTo &&
        (pt === 'hourly' || pt === 'normed') && clinicSettings.hoursFromSchedule && clinicSettings.holidayDoubleRate) {
      const { byRole: hByRole, byCategory: hByCategory } = calcHolidayHoursForPeriod(scheduleEntries, dateFrom, dateTo, _schedClinicId, holidayDates);

      if (pt === 'hourly') {
        const baseRate  = parseFloat(clinicSettings.hourlyRate) || 0;
        const roleRates = clinicSettings.roleRates || [];
        for (const [roleTitle, hours] of Object.entries(hByRole)) {
          if (hours <= 0) continue;
          const rr   = roleTitle ? roleRates.find(r => r.roleTitle === roleTitle) : null;
          const rate = rr ? (parseFloat(rr.rate) || baseRate) : baseRate;
          if (rate <= 0) continue;
          const amount = rate * hours;
          holidaySurchargeBreakdown.push({ label: roleTitle || 'Без указания', hours, rate, amount });
          holidaySurchargeTotal += amount;
        }
        for (const [categoryId, hours] of Object.entries(hByCategory)) {
          if (hours <= 0) continue;
          const rr   = roleRates.find(r => r.roleTitle === categoryId);
          const rate = rr ? (parseFloat(rr.rate) || baseRate) : baseRate;
          if (rate <= 0) continue;
          const amount = rate * hours;
          holidaySurchargeBreakdown.push({ label: _categoryLabels[categoryId] || categoryId, categoryId, hours, rate, amount });
          holidaySurchargeTotal += amount;
        }
      } else if (pt === 'normed') {
        const normServices = clinicSettings.normServices || [];
        // Build effective rate per role: sum(ns.rate * ns.hours) / sum(ns.hours)
        const roleRateMap = {};
        normServices.forEach(ns => {
          const role = ns.roleTitle || '';
          if (!roleRateMap[role]) roleRateMap[role] = { pay: 0, hours: 0 };
          const h = parseFloat(ns.hours) || 0;
          roleRateMap[role].pay   += (parseFloat(ns.rate) || 0) * h;
          roleRateMap[role].hours += h;
        });
        for (const [roleTitle, hours] of Object.entries(hByRole)) {
          if (hours <= 0) continue;
          const grp = roleRateMap[roleTitle] || roleRateMap[''] || null;
          const rate = grp && grp.hours > 0 ? grp.pay / grp.hours : 0;
          if (rate <= 0) continue;
          const amount = rate * hours;
          holidaySurchargeBreakdown.push({ label: roleTitle || 'Без указания', hours, rate, amount });
          holidaySurchargeTotal += amount;
        }
        for (const [categoryId, hours] of Object.entries(hByCategory)) {
          if (hours <= 0) continue;
          const norm = _normsByCategory[categoryId];
          const rate = norm && norm > 0 ? (parseFloat(clinicSettings.fixedSalary || 0) / norm) : 0;
          if (rate <= 0) continue;
          const amount = rate * hours;
          holidaySurchargeBreakdown.push({ label: _categoryLabels[categoryId] || categoryId, categoryId, hours, rate, amount });
          holidaySurchargeTotal += amount;
        }
      }
    }

    const harmfulnessDeduction = 0;

    const includePerformedBonus = pt !== 'percent' && !!clinicSettings.plusPercent;
    const includePerformedServices = pt === 'percent' || includePerformedBonus;
    const effectiveReferralBonusTotal = clinicSettings.includeReferralBonuses !== false ? referralBonusTotal : 0;
    const effectiveReferralCostTotal  = clinicSettings.includeReferralDeductions !== false ? referralCostTotal : 0;
    const effectiveAssistanceIncomeTotal = includePerformedServices ? assistanceIncomeTotal : 0;
    const effectiveAnesthesiologistIncomeTotal = includePerformedServices ? anesthesiologistIncomeTotal : 0;
    const effectiveNurseIncomeTotal = includePerformedServices ? nurseIncomeTotal : 0;
    const preFinalSalary = basePay + holidaySurchargeTotal + effectiveReferralBonusTotal + (includePerformedBonus ? performedBonusTotal : 0) + extrasTotal + effectiveAssistanceIncomeTotal + effectiveAnesthesiologistIncomeTotal + effectiveNurseIncomeTotal - effectiveReferralCostTotal;
    const finalDeductionsTotal = finalDeductions.reduce((s, d) => s + calcItemRub(d, preFinalSalary), 0);
    const finalMaterialsTotal  = finalMaterials.reduce((s, m) => s + calcItemRub(m, preFinalSalary), 0);
    const svcMatBreakdown = [];
    const svcMatFinalTotal = Object.values(perfByService).reduce((sum, svc) => {
      const matching = svcMatFinalItems.filter(sm => {
        // Ищем по коду если оба заданы, и/или по имени — любое совпадение подходит
        const byCode = sm.serviceCode && svc.code &&
          rbNormalizeName(sm.serviceCode) === rbNormalizeName(svc.code);
        const byName = rbNormalizeName(sm.serviceName || sm.name || '') === rbNormalizeName(svc.name);
        return byCode || byName;
      });
      const itemTotal = matching.reduce((s, m) => {
        const rub = m.valueType === 'percent' ? svc.cost * parseFloat(m.value) / 100 : parseFloat(m.value);
        if (rub > 0) {
          svcMatBreakdown.push({
            name: m.name || svc.name,
            serviceCode: svc.code,
            serviceName: svc.name,
            value: m.value,
            valueType: m.valueType,
            rub,
          });
        }
        return s + rub;
      }, 0);
      return sum + itemTotal;
    }, 0);

    // Индивидуальные расходники типа "оборот" — уже учтены в бонусах, показываем как справочную строку
    const svcMatTurnoverBreakdown = [];
    Object.values(perfByService).forEach(svc => {
      const mat = svcLookup(svc);
      if (!mat) return;
      const rub = mat.valueType === 'percent'
        ? svc.cost * parseFloat(mat.value) / 100
        : parseFloat(mat.value);
      if (rub > 0) {
        svcMatTurnoverBreakdown.push({
          name: mat.name || svc.name,
          serviceCode: svc.code,
          serviceName: svc.name,
          value: mat.value,
          valueType: mat.valueType,
          rub,
        });
      }
    });

    const materialsTotal = finalMaterialsTotal + svcMatFinalTotal;
    const finalSalary = preFinalSalary - finalDeductionsTotal - finalMaterialsTotal - svcMatFinalTotal;
    const ndflTotal = ndflDeduction ? calcItemRub(ndflDeduction, finalSalary) : 0;

    if (effectiveReferralBonusTotal) globalGrandTotal += effectiveReferralBonusTotal;

    const salary = {
      basePay, basePayLabel, payType: pt,
      interim,
      hourlyRate: pt === 'hourly' ? (parseFloat(clinicSettings.hourlyRate) || 0) : 0,
      hoursWorked: pt === 'hourly' ? effectiveHoursWorked : 0,
      daysWorked: effectiveDaysWorked,
      hourlyRatesBreakdown,
      holidaySurchargeTotal,
      holidaySurchargeBreakdown,
      harmfulnessDeduction,
      normServices: clinicSettings.normServices || [],
      fixedSalary: pt === 'normed' ? (parseFloat(clinicSettings.fixedSalary) || 0) : 0,
      normTotalHours,
      normPremiumAmount,
      normPremiumByRole,
      normHoursForPeriod: _normHoursForPeriod,
      referralBonuses: effectiveReferralBonusTotal,
      referralSections,
      performedBonusTotal: includePerformedBonus ? performedBonusTotal : 0,
      performedSections: includePerformedBonus ? performedSections : [],
      basePerformedSections: pt === 'percent' ? performedSections : [],
      extrasTotal,
      deductionsTotal: finalDeductionsTotal,
      materialsTotal,
      turnoverDeductionsTotal, finalDeductionsTotal,
      turnoverMaterialsTotal, finalMaterialsTotal,
      svcMatFinalTotal, svcMatBreakdown, svcMatTurnoverBreakdown,
      serviceMaterials: execServiceMaterials,
      performedServicesSum, deductionPerService, totalServiceCount,
      referralCostTotal: effectiveReferralCostTotal,
      referralCostItems, executorSections,
      assistancePaidTotal: includePerformedServices ? assistancePaidTotal : 0,
      assistanceSections: includePerformedServices ? assistanceSections : [],
      assistanceIncomeTotal: effectiveAssistanceIncomeTotal,
      assistanceIncomeSections: includePerformedServices ? assistanceIncomeSections : [],
      anesthesiologistPaidTotal: includePerformedServices ? anesthesiologistPaidTotal : 0,
      anesthesiologistSections: includePerformedServices ? anesthesiologistSections : [],
      anesthesiologistIncomeTotal: effectiveAnesthesiologistIncomeTotal,
      anesthesiologistIncomeSections: includePerformedServices ? anesthesiologistIncomeSections : [],
      nursePaidTotal: includePerformedServices ? nursePaidTotal : 0,
      nurseSections: includePerformedServices ? nurseSections : [],
      nurseIncomeTotal: effectiveNurseIncomeTotal,
      nurseIncomeSections: includePerformedServices ? nurseIncomeSections : [],
      finalSalary,
      advance: clinicSettings.advance || 0,
      paymentMethod: clinicSettings.paymentMethod,
      mainPayment: clinicSettings.mainPayment || 0,
      mainPaymentMethod: clinicSettings.mainPaymentMethod || 'card',
      extraPayments: clinicSettings.extraPayments || [],
      ndflTotal,
      deductions: execDeductionsFiltered,
      materials: execMaterials,
      extras: execExtras,
    };

    if (interim) {
      salary.referralCostTotal = 0;
      salary.referralCostItems = [];
      salary.executorSections = [];
      salary.deductions = [];
      salary.materials = [];
      salary.deductionsTotal = 0;
      salary.materialsTotal = 0;
      salary.harmfulnessDeduction = 0;
      salary.finalDeductionsTotal = 0;
      salary.turnoverDeductionsTotal = 0;
      salary.finalMaterialsTotal = 0;
      salary.turnoverMaterialsTotal = 0;
      salary.assistancePaidTotal = 0;
      salary.assistanceSections = [];
      salary.anesthesiologistPaidTotal = 0;
      salary.anesthesiologistSections = [];
      salary.nursePaidTotal = 0;
      salary.nurseSections = [];
      salary.advance = 0;
      salary.mainPayment = 0;
      salary.ndflTotal = 0;
      salary.finalSalary = salary.basePay
        + holidaySurchargeTotal
        + effectiveReferralBonusTotal
        + (pt !== 'percent' && !!clinicSettings.plusPercent ? performedBonusTotal : 0)
        + extrasTotal
        + effectiveAssistanceIncomeTotal
        + effectiveAnesthesiologistIncomeTotal
        + effectiveNurseIncomeTotal;
    }

    clinicReports.push({
      clinicId,
      clinicLabel,
      clinicColor: rbGetClinicColor(clinicId),
      referralSections,
      executorSections: interim ? [] : executorSections,
      salary,
      performedSections,
    });
  }

  const grandTotal = interim
    ? clinicReports.reduce((s, cr) => s + (cr.salary?.finalSalary || 0), 0)
    : globalGrandTotal;

  return { clinicReports, grandTotal, periodLabel };
}
