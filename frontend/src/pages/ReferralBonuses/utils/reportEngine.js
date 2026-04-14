/**
 * Report calculation engine — ported from backend/bot/referral-bonuses.html
 * All logic preserved verbatim, adapted to ES module + async/await with axios API calls.
 */
import { referralBonuses as rbApi, executorSettings, hourNorms as hourNormsApi, roleNorms as roleNormsApi } from '../../../services/api';
import { rbNormalizeName, rbNamesMatch } from './nameMatching';
import { rbMatchClinicId, rbGetClinicName, rbGetClinicColor, rbCabMatch, rbProfessionTitle } from './clinicUtils';
import { rbParseDate } from './excelUtils';

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
    harmfulness: false,
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

export async function loadExecSettings(misUserId) {
  if (_execCache[misUserId]) return _execCache[misUserId];
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

export async function buildReport({
  rows, colMap, doctor, referralBonuses, performedDbBonuses,
  execSettings, dateFrom, dateTo, allDoctors, savedAssistanceIncome,
  interim = false, normedOnly = false,
  corpIncludedKeys = null, // Set<string> of row indices; null = use legacy logic
}) {
  const doctorName = doctor.name;

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
      if (tv === '' || tv === null || tv === undefined) return 0;
      return parseFloat(String(tv).replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
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
      const noExcelClinicIds = Object.keys(cs).filter(
        cid => cid !== 'global' && (cs[cid].payType === 'normed' || cs[cid].payType === 'hourly' || cs[cid].payType === 'salary')
      );
      if (noExcelClinicIds.length > 0) {
        noExcelClinicIds.forEach(cid => {
          byClinic[cid] = { id: cid, label: rbGetClinicName(cid), rows: [] };
        });
      } else {
        // Только global настройки
        byClinic['unknown'] = { id: 'unknown', label: 'Расчёт', rows: [] };
      }
    } else {
      Object.assign(byClinic, rawByClinic);
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

  // ── Load hour norms for normed pay type ──
  let _normHoursForPeriod = null;
  {
    const hasNormed = Object.values(execSettings?.clinicSettings || {}).some(cs => cs.payType === 'normed');
    if (hasNormed && dateFrom) {
      try {
        const periodDate = new Date(dateFrom);
        const year = periodDate.getFullYear();
        const month = periodDate.getMonth() + 1;
        // Try by role first
        const roleRes = await roleNormsApi.get(year, month);
        const roleNormsData = roleRes.data || [];
        const doctorRoles = Array.isArray(doctor.roles) ? doctor.roles
          : doctor.role_titles ? String(doctor.role_titles).split(',').map(s => s.trim()).filter(Boolean)
          : Array.isArray(doctor.role_names) ? doctor.role_names
          : doctor.role ? [doctor.role] : [];
        for (const roleTitle of doctorRoles) {
          const norm = roleNormsData.find(n => n.roleTitle === roleTitle);
          if (norm && norm.normHours != null) {
            _normHoursForPeriod = parseFloat(norm.normHours);
            break;
          }
        }
        // Fallback: try by profession/specialty if not found by role
        if (_normHoursForPeriod == null) {
          const res = await hourNormsApi.get(year, month);
          const norms = res.data || [];
          for (const p of (doctor.professions || [])) {
            const profTitle = rbProfessionTitle(p);
            const norm = norms.find(n => n.professionTitle === profTitle);
            if (norm && norm.normHours != null) {
              _normHoursForPeriod = parseFloat(norm.normHours);
              break;
            }
          }
        }
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

    // 1. Rows where doctor is referrer
    const referrerRows = colMap.referrer
      ? clinicRows.filter(r => _corpOk(r) && rbNamesMatch(doctorName, r[colMap.referrer] || ''))
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
    // Для нормированного типа материалы не применяются (секция скрыта в UI)
    const _isNormedPt = (clinicSettings.payType || 'salary') === 'normed';
    const execMaterials  = _isNormedPt ? [] : (clinicSettings.materials  || []);
    const execExtras     = clinicSettings.extras     || [];
    const execServiceMaterials = _isNormedPt ? [] : (clinicSettings.serviceMaterials || []);
    const extrasTotal = execExtras.reduce((s, e) => s + calcExtraRub(e), 0);

    const turnoverDeductions = execDeductions.filter(d => d.deductionType !== 'final');
    const finalDeductions    = execDeductions.filter(d => d.deductionType === 'final');
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

    const _psvcClinicId = clinicId !== 'unknown' ? String(clinicId) : '';
    let performedBonusTotal = 0;
    const assistancePayments = {};
    const anesthesiologistPayments = {};
    const nursePayments = {};

    // Pre-load own settings for each unique anesthesiologist name in rows
    const anestSettingsCache = {};
    if (colMap.anesthesiologist) {
      const anestNames = [...new Set(
        rows.filter(rbRowInDateRange).map(r => String(r[colMap.anesthesiologist] || '').trim()).filter(Boolean)
      )];
      for (const name of anestNames) {
        const doc = (allDoctors || []).find(d => rbNamesMatch(d.name, name));
        if (doc) {
          try { anestSettingsCache[name] = await loadExecSettings(doc.id); } catch {}
        }
      }
    }

    // Pre-load settings for each unique assistant name
    const asstSettingsCache = {};
    if (colMap.assistant) {
      const asstNames = [...new Set(
        rows.filter(rbRowInDateRange).map(r => String(r[colMap.assistant] || '').trim()).filter(Boolean)
      )];
      for (const name of asstNames) {
        const doc = (allDoctors || []).find(d => rbNamesMatch(d.name, name));
        if (doc) {
          try { asstSettingsCache[name] = await loadExecSettings(doc.id); } catch {}
        }
      }
    }

    // Pre-load settings for each unique nurse name
    const nurseSettingsCache = {};
    if (colMap.nurse) {
      const nurseNames = [...new Set(
        rows.filter(rbRowInDateRange).map(r => String(r[colMap.nurse] || '').trim()).filter(Boolean)
      )];
      for (const name of nurseNames) {
        const doc = (allDoctors || []).find(d => rbNamesMatch(d.name, name));
        if (doc) {
          try { nurseSettingsCache[name] = await loadExecSettings(doc.id); } catch {}
        }
      }
    }

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
            const effectiveCost = interim ? row.cost : row.cost * (1 - deductionFactor) - matForRow;
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
            const assistantName = row.assistant || '';
            if (!interim && assistantName) {
              const asstOwnData = asstSettingsCache[assistantName];
              // Новая система: roleServices.assistant (точный код услуги)
              const roleMatch = asstOwnData ? findRoleService(asstOwnData.roleServices, 'assistant', s.code) : null;
              if (roleMatch) {
                const val = parseFloat(roleMatch.value) || 0;
                if (val > 0) {
                  asstBonus = roleMatch.valueType === 'rub' ? val : effectiveCost * val / 100;
                  asstMatchedEntry = roleMatch;
                }
              } else {
                // Старая система: assistants[] у основного врача или глобальный процент
                const _indivAsst = (execSettings.assistants || []).find(a => rbNamesMatch(a.name, assistantName));
                if (_indivAsst != null) {
                  const vt = _indivAsst.valueType || 'percent';
                  const val = parseFloat(_indivAsst.value ?? _indivAsst.percent) || 0;
                  asstBonus = vt === 'rub' ? val : effectiveCost * val / 100;
                } else {
                  const vt = clinicSettings.assistanceValueType || 'percent';
                  const val = parseFloat(clinicSettings.assistancePercent) || 0;
                  asstBonus = vt === 'rub' ? val : effectiveCost * val / 100;
                }
              }
            }

            // ── Anesthesiologist deduction: сначала roleServices (точный код), затем правила (текст) ──
            let anestBonus = 0;
            let anestMatchedRule = null;
            const anesthesiologistName = row.anesthesiologist || '';
            if (!interim && anesthesiologistName) {
              const anestOwnData = anestSettingsCache[anesthesiologistName];
              if (anestOwnData) {
                const roleMatch = findRoleService(anestOwnData.roleServices, 'anesthesiologist', s.code);
                if (roleMatch) {
                  const val = parseFloat(roleMatch.value) || 0;
                  if (val > 0) anestBonus = roleMatch.valueType === 'rub' ? val : effectiveCost * val / 100;
                } else if ((anestOwnData.anesthesiologistRules || []).length) {
                  // Fallback на старую систему (текстовый поиск)
                  const svcSpec = row.serviceSpec || '';
                  anestMatchedRule = anestOwnData.anesthesiologistRules.find(r => anestRuleMatches(r, s.name || '', svcSpec)) || null;
                  if (anestMatchedRule) {
                    const val = parseFloat(anestMatchedRule.value) || 0;
                    if (val > 0) anestBonus = anestMatchedRule.valueType === 'rub' ? val : effectiveCost * val / 100;
                  }
                }
              }
            }

            // ── Nurse deduction (новая система: roleServices.nurse) ──
            let nurseBonus = 0;
            const nurseName = row.nurse || '';
            if (!interim && nurseName) {
              const nurseOwnData = nurseSettingsCache[nurseName];
              if (nurseOwnData) {
                const roleMatch = findRoleService(nurseOwnData.roleServices, 'nurse', s.code);
                if (roleMatch) {
                  const val = parseFloat(roleMatch.value) || 0;
                  if (val > 0) nurseBonus = roleMatch.valueType === 'rub' ? val : effectiveCost * val / 100;
                }
              }
            }

            bonusAmount += Math.max(0, grossBonus - asstBonus - anestBonus - nurseBonus);
            bonusLabels.add(`${parseFloat(bonus.bonusPercent)}%`);

            if (asstBonus > 0 && assistantName) {
              if (!assistancePayments[assistantName]) assistancePayments[assistantName] = { total: 0, services: {} };
              assistancePayments[assistantName].total += asstBonus;
              const svcKey = s.code || s.name;
              if (!assistancePayments[assistantName].services[svcKey])
                assistancePayments[assistantName].services[svcKey] = { code: s.code, name: s.name, income: 0, count: 0, aValue: asstMatchedEntry?.value, aValueType: asstMatchedEntry?.valueType };
              assistancePayments[assistantName].services[svcKey].income += asstBonus;
              assistancePayments[assistantName].services[svcKey].count++;
            }
            if (anestBonus > 0 && anesthesiologistName) {
              if (!anesthesiologistPayments[anesthesiologistName]) anesthesiologistPayments[anesthesiologistName] = { total: 0, services: {} };
              anesthesiologistPayments[anesthesiologistName].total += anestBonus;
              const svcKey = s.code || s.name;
              if (!anesthesiologistPayments[anesthesiologistName].services[svcKey])
                anesthesiologistPayments[anesthesiologistName].services[svcKey] = {
                  code: s.code, name: s.name, income: 0, count: 0,
                  ruleContains: anestMatchedRule?.contains, aValue: anestMatchedRule?.value, aValueType: anestMatchedRule?.valueType,
                };
              anesthesiologistPayments[anesthesiologistName].services[svcKey].income += anestBonus;
              anesthesiologistPayments[anesthesiologistName].services[svcKey].count++;
            }
            if (nurseBonus > 0 && nurseName) {
              if (!nursePayments[nurseName]) nursePayments[nurseName] = { total: 0, services: {} };
              nursePayments[nurseName].total += nurseBonus;
              const svcKey = s.code || s.name;
              if (!nursePayments[nurseName].services[svcKey])
                nursePayments[nurseName].services[svcKey] = { code: s.code, name: s.name, income: 0, count: 0 };
              nursePayments[nurseName].services[svcKey].income += nurseBonus;
              nursePayments[nurseName].services[svcKey].count++;
            }
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
        rbNamesMatch(doctorName, String(r[colMap.assistant] || '').trim()) && rbRowInDateRange(r)
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

        for (const [execName, byClinicMap2] of Object.entries(byExec)) {
          let secTotal = 0;
          const svcBreakdown2 = {};

          // Настройки основного врача (исполнителя)
          const execDoc = (allDoctors || []).find(d => rbNamesMatch(d.name, execName));
          if (!execDoc) continue;
          let execData2;
          try { execData2 = await loadExecSettings(execDoc.id); } catch { continue; }
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
        rbNamesMatch(doctorName, String(r[colMap.anesthesiologist] || '').trim()) && rbRowInDateRange(r)
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

        for (const [execName, svcRows] of Object.entries(byExec)) {
          const execDoc2 = (allDoctors || []).find(d => rbNamesMatch(d.name, execName));
          let execData2Anest = null;
          try { if (execDoc2) execData2Anest = await loadExecSettings(execDoc2.id); } catch {}

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
        rbNamesMatch(doctorName, String(r[colMap.nurse] || '').trim()) && rbRowInDateRange(r)
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

        for (const [execName, svcRows] of Object.entries(byExec)) {
          const execDoc2 = (allDoctors || []).find(d => rbNamesMatch(d.name, execName));
          let execData2Nurse = null;
          try { if (execDoc2) execData2Nurse = await loadExecSettings(execDoc2.id); } catch {}

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
    if (pt === 'salary') {
      basePay = parseFloat(clinicSettings.fixedSalary) || 0;
      basePayLabel = 'Фиксированный оклад';
    } else if (pt === 'hourly') {
      const rate  = parseFloat(clinicSettings.hourlyRate) || 0;
      const hours = parseFloat(clinicSettings.hoursWorked) || 0;
      basePay = rate * hours;
      basePayLabel = `Почасовой оклад (${rate} ₽ × ${hours} ч)`;
    } else if (pt === 'percent') {
      basePay = performedBonusTotal;
      basePayLabel = 'Выполненные услуги';
    } else if (pt === 'normed') {
      const fixedSalary = parseFloat(clinicSettings.fixedSalary) || 0;
      const normServices = clinicSettings.normServices || [];
      const normServicesTotal = normServices.reduce((s, ns) => s + (parseFloat(ns.rate) || 0) * (parseFloat(ns.hours) || 0), 0);
      normTotalHours = normServices.reduce((s, ns) => s + (parseFloat(ns.hours) || 0), 0);
      basePay = fixedSalary + normServicesTotal;
      basePayLabel = 'Нормированный оклад';
      // Если часов отработано х2 и больше от нормы — часть сверх этого считается Премией
      if (_normHoursForPeriod != null && normTotalHours > 0 && normTotalHours >= 2 * _normHoursForPeriod) {
        const premiumHours = normTotalHours - 2 * _normHoursForPeriod;
        normPremiumAmount = normServicesTotal * (premiumHours / normTotalHours);
      }
    }

    const harmfulnessDeduction = (pt === 'normed' && !!clinicSettings.harmfulness) ? basePay * 0.04 : 0;

    const includePerformedBonus = pt !== 'percent' && !!clinicSettings.plusPercent;
    const effectiveReferralBonusTotal = clinicSettings.includeReferralBonuses !== false ? referralBonusTotal : 0;
    const effectiveReferralCostTotal  = clinicSettings.includeReferralDeductions !== false ? referralCostTotal : 0;
    const preFinalSalary = basePay + effectiveReferralBonusTotal + (includePerformedBonus ? performedBonusTotal : 0) + extrasTotal + assistanceIncomeTotal + anesthesiologistIncomeTotal + nurseIncomeTotal - effectiveReferralCostTotal;
    const finalDeductionsTotal = finalDeductions.reduce((s, d) => s + calcItemRub(d, preFinalSalary), 0) + harmfulnessDeduction;
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

    if (effectiveReferralBonusTotal) globalGrandTotal += effectiveReferralBonusTotal;

    const salary = {
      basePay, basePayLabel, payType: pt,
      harmfulnessDeduction,
      normServices: clinicSettings.normServices || [],
      fixedSalary: pt === 'normed' ? (parseFloat(clinicSettings.fixedSalary) || 0) : 0,
      normTotalHours,
      normPremiumAmount,
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
      assistancePaidTotal, assistanceSections,
      assistanceIncomeTotal, assistanceIncomeSections,
      anesthesiologistPaidTotal, anesthesiologistSections,
      anesthesiologistIncomeTotal, anesthesiologistIncomeSections,
      nursePaidTotal, nurseSections,
      nurseIncomeTotal, nurseIncomeSections,
      finalSalary,
      advance: clinicSettings.advance || 0,
      paymentMethod: clinicSettings.paymentMethod,
      mainPayment: clinicSettings.mainPayment || 0,
      mainPaymentMethod: clinicSettings.mainPaymentMethod || 'card',
      extraPayments: clinicSettings.extraPayments || [],
      deductions: execDeductions,
      materials: execMaterials,
      extras: execExtras,
    };

    if (interim) {
      salary.referralBonuses = 0;
      salary.referralSections = [];
      salary.referralCostTotal = 0;
      salary.referralCostItems = [];
      salary.executorSections = [];
      salary.deductions = [];
      salary.materials = [];
      salary.deductionsTotal = 0;
      salary.materialsTotal = 0;
      salary.finalDeductionsTotal = 0;
      salary.turnoverDeductionsTotal = 0;
      salary.finalMaterialsTotal = 0;
      salary.turnoverMaterialsTotal = 0;
      salary.assistancePaidTotal = 0;
      salary.assistanceSections = [];
      salary.assistanceIncomeTotal = 0;
      salary.assistanceIncomeSections = [];
      salary.anesthesiologistPaidTotal = 0;
      salary.anesthesiologistSections = [];
      salary.anesthesiologistIncomeTotal = 0;
      salary.anesthesiologistIncomeSections = [];
      salary.nursePaidTotal = 0;
      salary.nurseSections = [];
      salary.nurseIncomeTotal = 0;
      salary.nurseIncomeSections = [];
      salary.advance = 0;
      salary.mainPayment = 0;
      salary.finalSalary = salary.basePay
        + (pt !== 'percent' && !!clinicSettings.plusPercent ? performedBonusTotal : 0)
        + extrasTotal;
    }

    clinicReports.push({
      clinicId,
      clinicLabel,
      clinicColor: rbGetClinicColor(clinicId),
      referralSections: interim ? [] : referralSections,
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
