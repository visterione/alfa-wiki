/**
 * Report calculation engine — ported from backend/bot/referral-bonuses.html
 * All logic preserved verbatim, adapted to ES module + async/await with axios API calls.
 */
import { referralBonuses as rbApi, executorSettings } from '../../../services/api';
import { rbNormalizeName, rbNamesMatch } from './nameMatching';
import { rbMatchClinicId, rbGetClinicName, rbGetClinicColor, rbCabMatch } from './clinicUtils';
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
    cabinets: [],
    deductions: [],
    materials: [],
    serviceMaterials: [],
    extras: [],
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
export async function buildReport({
  rows, colMap, doctor, referralBonuses, performedDbBonuses,
  execSettings, dateFrom, dateTo, allDoctors, savedAssistanceIncome,
  interim = false,
}) {
  const doctorName = doctor.name;

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

  // ── Error: no referrer/executor columns ──
  if (!colMap.referrer && !colMap.executor) {
    const keys = rows.length ? Object.keys(rows[0]) : [];
    throw new Error(
      `Не удалось определить колонки ФИО рекомендателя/исполнителя.\nДоступные колонки: ${keys.join(', ')}`
    );
  }

  // ── Date range filter ──
  function rbRowInDateRange(r) {
    if (!dateFromDate && !dateToDate) return true;
    const rowDate = rbParseDate(r[colMap.date]);
    if (!rowDate) return true;
    if (dateFromDate && rowDate < dateFromDate) return false;
    if (dateToDate   && rowDate > dateToDate)   return false;
    return true;
  }

  // ── Cost parser ──
  function rbParseCost(r) {
    // Особый случай: категория содержит "VIP" + скидка 100%
    // Услуга бесплатна для пациента, но врач получает оплату: стоимость услуги − 30%
    if (colMap.category && colMap.discount && colMap.servicePrice) {
      const categoryVal = String(r[colMap.category] || '').toUpperCase();
      if (categoryVal.includes('VIP')) {
        const discountRaw = String(r[colMap.discount] || '').replace('%', '').trim();
        const discountVal = parseFloat(discountRaw.replace(',', '.')) || 0;
        if (discountVal >= 100) {
          const price = parseFloat(String(r[colMap.servicePrice] || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
          return price * 0.70;
        }
      }
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

  if (!allRelevant.length) {
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
    Object.assign(byClinic, rawByClinic);
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

  // ── Build per-clinic reports ──
  const clinicReports = [];
  let globalGrandTotal = 0;
  // Track assistant income already credited across clinics to prevent double-counting
  const assistedExecutorNamesUsed = new Set();

  for (const [clinicId, clinicGroup] of Object.entries(byClinic)) {
    const clinicRows = clinicGroup.rows;
    const clinicLabel = clinicId !== 'unknown' ? rbGetClinicName(clinicId) : clinicGroup.label;
    const clinicSettings = rbGetClinicSettings(execSettings, clinicId);

    const _corpOk = r => {
      if (!colMap.invoiceType) return true;
      const t = String(r[colMap.invoiceType] || '').toLowerCase().trim();
      if (t !== 'юр. компания' && t !== 'юр.компания') return true;
      // Per-service corp check from StepPerformed checkboxes
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
        byService[key].count++;
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
      entry.count++;
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
      perfByService[key].count++;
      perfByService[key]._rows.push({
        cost: rowCost,
        cabinet,
        assistant: colMap.assistant ? String(r[colMap.assistant] || '').trim() : '',
      });
    });

    const performedServicesSum = executorRows.reduce((s, r) => s + rbParseCost(r), 0);
    const totalServiceCount = executorRows.length;

    const execDeductions = clinicSettings.deductions || [];
    const execMaterials  = clinicSettings.materials  || [];
    const execExtras     = clinicSettings.extras     || [];
    const execServiceMaterials = clinicSettings.serviceMaterials || [];
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
    const nonOverrideCount = Object.values(perfByService).reduce((s, svc) => svcLookup(svc) ? s : s + svc.count, 0);
    const turnoverDeductionsTotal = turnoverDeductions.reduce((s, d) => s + calcItemRub(d, performedServicesSum), 0);
    const turnoverMaterialsTotal  = turnoverMaterials.reduce((s, m) => s + calcItemRub(m, nonOverrideSum), 0);
    const globalDeductionPerOccurrence = totalServiceCount > 0 ? turnoverDeductionsTotal / totalServiceCount : 0;
    const globalMaterialPerOccurrence  = nonOverrideCount > 0 ? turnoverMaterialsTotal / nonOverrideCount : 0;
    const deductionPerService = totalServiceCount > 0 ? (turnoverDeductionsTotal + turnoverMaterialsTotal) / totalServiceCount : 0;

    const _psvcClinicId = clinicId !== 'unknown' ? String(clinicId) : '';
    let performedBonusTotal = 0;
    const assistancePayments = {};

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
            const assistantName = row.assistant || '';
            const asstPct = (!interim && assistantName) ? (clinicSettings.assistancePercent || 0) : 0;
            const effectiveBonusPct = Math.max(0, parseFloat(bonus.bonusPercent) - asstPct);
            const matForRow = interim ? 0 : (svcOverrideMat
              ? (svcOverrideMat.valueType === 'percent'
                  ? row.cost * parseFloat(svcOverrideMat.value) / 100
                  : parseFloat(svcOverrideMat.value))
              : globalMaterialPerOccurrence);
            const effectiveCost = interim ? row.cost : row.cost - globalDeductionPerOccurrence - matForRow;
            bonusAmount += effectiveCost * effectiveBonusPct / 100;
            bonusLabels.add(`${parseFloat(bonus.bonusPercent)}%`);
            if (asstPct > 0 && assistantName) {
              const asstBonus = effectiveCost * asstPct / 100;
              if (!assistancePayments[assistantName]) assistancePayments[assistantName] = { total: 0, services: {} };
              assistancePayments[assistantName].total += asstBonus;
              const svcKey = s.code || s.name;
              if (!assistancePayments[assistantName].services[svcKey])
                assistancePayments[assistantName].services[svcKey] = { code: s.code, name: s.name, income: 0, count: 0 };
              assistancePayments[assistantName].services[svcKey].income += asstBonus;
              assistancePayments[assistantName].services[svcKey].count++;
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
          byExec[execName][cId2].push({ cost: cost2, svcCode: svcCode2, svcName: svcName2 });
        });

        for (const [execName, byClinicMap2] of Object.entries(byExec)) {
          const execDoc = (allDoctors || []).find(d => rbNamesMatch(d.name, execName));
          if (!execDoc) continue;
          let execData2;
          try { execData2 = await loadExecSettings(execDoc.id); } catch { continue; }
          let secTotal = 0;
          const svcBreakdown2 = {};
          for (const [cId3, cRows3] of Object.entries(byClinicMap2)) {
            const eCS = rbGetClinicSettings(execData2, cId3);
            const aPct = eCS.assistancePercent || 0;
            if (!aPct) continue;
            cRows3.forEach(row2 => {
              const inc = row2.cost * aPct / 100;
              secTotal += inc;
              assistanceIncomeTotal += inc;
              const k2 = row2.svcCode || row2.svcName;
              if (!svcBreakdown2[k2])
                svcBreakdown2[k2] = { code: row2.svcCode, name: row2.svcName, cost: 0, count: 0, income: 0, aPct };
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

    // ── Base pay calculation ──
    const pt = clinicSettings.payType || 'salary';
    let basePay = 0, basePayLabel = '';
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
      basePayLabel = 'Бонусы за выполненные услуги (по тарифам)';
    }

    const includePerformedBonus = pt !== 'percent' && !!clinicSettings.plusPercent;
    const effectiveReferralBonusTotal = clinicSettings.includeReferralBonuses !== false ? referralBonusTotal : 0;
    const effectiveReferralCostTotal  = clinicSettings.includeReferralDeductions !== false ? referralCostTotal : 0;
    const preFinalSalary = basePay + effectiveReferralBonusTotal + (includePerformedBonus ? performedBonusTotal : 0) + extrasTotal + assistanceIncomeTotal - effectiveReferralCostTotal;
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
        const rub = m.valueType === 'percent' ? svc.cost * parseFloat(m.value) / 100 : parseFloat(m.value) * svc.count;
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
        : parseFloat(mat.value) * svc.count;
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
      finalSalary,
      advance: clinicSettings.advance || 0,
      paymentMethod: clinicSettings.paymentMethod,
      mainPayment: clinicSettings.mainPayment || 0,
      mainPaymentMethod: clinicSettings.mainPaymentMethod || 'card',
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
