import ExcelJS from 'exceljs';
import { DEFAULT_CLINICS } from './clinicUtils';
import { rbParseFullName, rbParseAbbrevName } from './nameMatching';

// ── Org groups ─────────────────────────────────────────────────────────────────
const ORG_GROUPS = [
  // 12 — пункт забора «Нео»: по справочнику med_centers он относится к Престижу.
  // До ver. 6.90 этот id считался вторым id Сукко и попадал в группу «Алекс».
  { key: 'prestige', label: 'Альфа Престиж', color: '#de64a1', ids: ['2','3','6','12'],
    nameMatch: n => (n.includes('альфа') || n.includes('кидс') || n.includes('kids') || n.includes('линия') || n.includes('нео')) && !n.includes('проф') },
  { key: 'prof',     label: 'Проф',           color: '#9999ff', ids: ['1'],
    nameMatch: n => n.includes('проф') },
  { key: 'labgroup', label: 'Лабгрупп',       color: '#800080', ids: ['4','7'],
    nameMatch: n => n.includes('3к') || n.includes('3k') || n.includes('смайл') || n.includes('лабгрупп') },
  { key: 'sukko',    label: 'Алекс',          color: '#2d7055', ids: ['11'],
    nameMatch: n => n.includes('сукко') || n.includes('алекс') },
];

const CLINIC_COLOR_MAP = Object.fromEntries(DEFAULT_CLINICS.map(c => [String(c.id), c.color]));

// ── Data helpers ───────────────────────────────────────────────────────────────
function nameToKey(name) {
  if (!name) return '';
  const parts = String(name).replace(/\./g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().split(' ').filter(Boolean);
  if (!parts[0]) return '';
  const parsed = parts[1]?.length === 1 ? rbParseAbbrevName(name) : rbParseFullName(name);
  return parsed.last + (parsed.fi || '') + (parsed.mi || '');
}

function getPatientKey(row) { return row.patientCard || row.patientName || null; }

function getOrgGroupByName(n) { return ORG_GROUPS.find(g => g.nameMatch(n)) || null; }

function getOrgGroup(row) {
  if (row.clinicId) { const g = ORG_GROUPS.find(g => g.ids.includes(row.clinicId)); if (g) return g; }
  if (row.clinicRaw) return getOrgGroupByName(row.clinicRaw.toLowerCase());
  return null;
}

function clinicColor(rs) {
  const counts = {};
  for (const r of rs) if (r.clinicId) counts[r.clinicId] = (counts[r.clinicId] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ? (CLINIC_COLOR_MAP[top] || '#94a3b8') : '#94a3b8';
}

function groupBy(rows, fn) {
  const m = {};
  for (const r of rows) { const k = fn(r); if (k != null && k !== '') { if (!m[k]) m[k] = []; m[k].push(r); } }
  return m;
}
function splitComma(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }
function groupByMulti(rows, fn) {
  const m = {};
  for (const r of rows) { for (const k of fn(r)) { if (k) { if (!m[k]) m[k] = []; m[k].push(r); } } }
  return m;
}
function rev_pat(rows) {
  const revenue  = rows.reduce((s, r) => s + r.totalCost, 0);
  const patients = new Set(rows.map(getPatientKey).filter(Boolean)).size;
  const invoices = new Set(rows.map(r => r.invoiceNum).filter(Boolean));
  const checkCount = invoices.size > 0 ? invoices.size : rows.length;
  return { revenue, patients, avgCheck: checkCount > 0 ? revenue / checkCount : 0 };
}
function buildPatientMap(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = getPatientKey(r); if (!k) continue;
    if (!m.has(k)) m.set(k, { card: r.patientCard, name: r.patientName, revenue: 0, isVip: false, hasLK: false });
    const p = m.get(k); p.revenue += r.totalCost;
    if (r.isVip) p.isVip = true; if (r.hasLK) p.hasLK = true;
  }
  return m;
}
function top20pct(patients) {
  const s = [...patients].sort((a, b) => b.revenue - a.revenue);
  return s.slice(0, Math.max(1, Math.ceil(s.length * 0.2)));
}
function buildReferralPairs(rows) {
  const p = {};
  for (const r of rows) {
    const ref = r.referrer?.trim(), exec = r.executor?.trim();
    const rk = nameToKey(ref), ek = nameToKey(exec);
    if (!rk || !ek || rk === ek) continue;
    const k = `${rk}\x00${ek}`;
    if (!p[k]) p[k] = { referrer: ref, executor: exec, refKey: rk, execKey: ek, count: 0, revenue: 0 };
    p[k].count++; p[k].revenue += r.totalCost;
  }
  return Object.values(p).sort((a, b) => b.count - a.count);
}
function buildReturnVisits(rows) {
  const byPat = {};
  for (const r of rows) { const k = getPatientKey(r); if (k) { if (!byPat[k]) byPat[k] = []; byPat[k].push(r); } }
  const stats = {};
  for (const pr of Object.values(byPat)) {
    for (const doc of [...new Set(pr.map(r => r.executor).filter(Boolean))]) {
      if (!stats[doc]) stats[doc] = { name: doc, total: 0, notReturned: 0, sameDoctor: 0, otherReferred: 0, otherSelf: 0 };
      const s = stats[doc], dk = nameToKey(doc);
      const dv = pr.filter(r => r.executor === doc), ov = pr.filter(r => r.executor && r.executor !== doc);
      s.total++;
      if (!ov.length && dv.length === 1) s.notReturned++;
      if (dv.length >= 2) s.sameDoctor++;
      if (ov.length > 0) {
        if (ov.some(r => nameToKey(r.referrer || '') === dk)) s.otherReferred++;
        if (ov.some(r => nameToKey(r.referrer || '') !== dk)) s.otherSelf++;
      }
    }
  }
  return Object.values(stats).filter(d => d.total > 0).sort((a, b) => b.total - a.total);
}
function buildChains(rows) {
  const fs = s => String(s || '').split(',')[0].trim();
  const sd = {};
  for (const r of rows) { if (r.executor && !sd[r.executor]) { const s = fs(r.serviceSpec || r.executorSpec); if (s) sd[r.executor] = s; } }
  const bp = {};
  for (const r of rows) { const k = getPatientKey(r); if (k) { if (!bp[k]) bp[k] = []; bp[k].push(r); } }
  const cc = {};
  for (const pr of Object.values(bp)) {
    const ls = {};
    for (const r of pr) { if (r.executor) { const s = fs(r.serviceSpec || r.executorSpec); if (s) ls[r.executor] = s; } }
    const rr = pr.filter(r => r.referrer).sort((a, b) => (!a.date || !b.date ? 0 : a.date - b.date));
    if (!rr.length) continue;
    let ch = null;
    for (const r of rr) {
      const from = fs(r.referrerSpec) || ls[r.referrer] || sd[r.referrer] || '', to = fs(r.serviceSpec) || fs(r.executorSpec) || '';
      if (!from || !to || from === to) continue;
      if (!ch) { ch = [from, to]; }
      else if (ch[ch.length - 1] === from) { ch.push(to); }
      else { if (ch.length >= 2) cc[ch.join(' → ')] = (cc[ch.join(' → ')] || 0) + 1; ch = [from, to]; }
    }
    if (ch && ch.length >= 2) cc[ch.join(' → ')] = (cc[ch.join(' → ')] || 0) + 1;
  }
  return Object.entries(cc).map(([name, count]) => ({ name, count, steps: name.split(' → ').length - 1 })).sort((a, b) => b.count - a.count);
}

// ── Excel style helpers ────────────────────────────────────────────────────────
const FONT   = 'Calibri';
const BORDER = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
const FILL_H = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D5DB' } };
const FILL_S = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };

function colLetter(n) { let s = ''; while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); } return s; }

function addTitle(ws, text, span) {
  const r = ws.addRow([text]);
  r.getCell(1).font = { name: FONT, size: 14, bold: true };
  r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  if (span > 1) ws.mergeCells(`A${r.number}:${colLetter(span)}${r.number}`);
  r.height = 22; return r;
}
function addSubtitle(ws, text, span) {
  const r = ws.addRow([text]);
  r.getCell(1).font = { name: FONT, size: 11, italic: true, color: { argb: 'FF64748B' } };
  if (span > 1) ws.mergeCells(`A${r.number}:${colLetter(span)}${r.number}`);
}
function addSection(ws, text, span) {
  ws.addRow([]);
  const r = ws.addRow([text]);
  r.getCell(1).font = { name: FONT, size: 11, bold: true };
  r.getCell(1).fill = FILL_S;
  r.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  if (span > 1) ws.mergeCells(`A${r.number}:${colLetter(span)}${r.number}`);
  r.height = 18; return r;
}
function addHeaders(ws, labels) {
  const r = ws.addRow(labels);
  r.eachCell({ includeEmpty: true }, (cell, c) => {
    if (c > labels.length) return;
    cell.font = { name: FONT, size: 11, bold: true };
    cell.fill = FILL_H; cell.border = BORDER;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  r.height = 20; return r;
}
function addData(ws, values, n) {
  const r = ws.addRow(values);
  r.eachCell({ includeEmpty: true }, (cell, c) => {
    if (c > n) return;
    cell.font = { name: FONT, size: 11 };
    cell.border = BORDER; cell.alignment = { vertical: 'middle' };
  });
  return r;
}
function rAlign(r, cols) { cols.forEach(c => { r.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' }; }); }

const RUB = '#,##0';

// ── Sheet: Общая ───────────────────────────────────────────────────────────────
function sheetGeneral(wb, rows, label) {
  const ws = wb.addWorksheet('Общая');

  const orgStats = ORG_GROUPS.map(g => {
    const gr = rows.filter(r => getOrgGroup(r)?.key === g.key);
    return { name: g.label, color: g.color, ...rev_pat(gr) };
  });

  const byClinic = groupBy(rows, r => r.clinicRaw || '—');
  const clinicStats = Object.entries(byClinic)
    .map(([name, rs]) => ({ name, color: clinicColor(rs), ...rev_pat(rs) }))
    .sort((a, b) => b.revenue - a.revenue);

  const bySpec = groupByMulti(rows, r => splitComma(r.executorSpec));
  const specStats = Object.entries(bySpec)
    .map(([name, rs]) => ({ name, ...rev_pat(rs) }))
    .sort((a, b) => b.patients - a.patients);

  const totalRev = rows.reduce((s, r) => s + r.totalCost, 0);
  const totalPat = new Set(rows.map(getPatientKey).filter(Boolean)).size;

  addTitle(ws, `KPI — Общая · ${label}`, 4);
  addSubtitle(ws, `Строк: ${rows.length.toLocaleString('ru-RU')} · Пациентов: ${totalPat.toLocaleString('ru-RU')} · Выручка: ${Math.round(totalRev).toLocaleString('ru-RU')} ₽`, 4);

  addSection(ws, 'Выручка по организациям', 4);
  addHeaders(ws, ['Организация', 'Выручка, ₽', 'Пациентов', 'Средний чек, ₽']);
  for (const d of orgStats) {
    const r = addData(ws, [d.name, Math.round(d.revenue), d.patients, Math.round(d.avgCheck)], 4);
    r.getCell(2).numFmt = RUB; r.getCell(4).numFmt = RUB; rAlign(r, [2, 3, 4]);
  }

  addSection(ws, 'По клиникам', 4);
  addHeaders(ws, ['Клиника', 'Выручка, ₽', 'Пациентов', 'Средний чек, ₽']);
  for (const d of clinicStats) {
    const r = addData(ws, [d.name, Math.round(d.revenue), d.patients, Math.round(d.avgCheck)], 4);
    r.getCell(2).numFmt = RUB; r.getCell(4).numFmt = RUB; rAlign(r, [2, 3, 4]);
  }

  addSection(ws, 'Пациентов по специальностям', 4);
  addHeaders(ws, ['Специальность', 'Пациентов', 'Выручка, ₽', 'Средний чек, ₽']);
  for (const d of specStats) {
    const r = addData(ws, [d.name, d.patients, Math.round(d.revenue), Math.round(d.avgCheck)], 4);
    r.getCell(3).numFmt = RUB; r.getCell(4).numFmt = RUB; rAlign(r, [2, 3, 4]);
  }

  ws.columns = [{ width: 42 }, { width: 18 }, { width: 14 }, { width: 18 }];
}

// ── Sheet: Пациенты ────────────────────────────────────────────────────────────
function sheetPatients(wb, rows, label) {
  const ws = wb.addWorksheet('Пациенты');

  const patMap   = buildPatientMap(rows);
  const patients = Array.from(patMap.values());
  const lkCount  = patients.filter(p => p.hasLK).length;
  const lkPct    = patients.length ? lkCount / patients.length * 100 : 0;
  const discRows = rows.filter(r => r.discount > 0);
  const discPat  = new Set(discRows.map(getPatientKey).filter(Boolean)).size;
  const totalDisc  = discRows.reduce((s, r) => s + r.discount, 0);
  const vipDisc    = rows.filter(r => r.isVip && r.discount > 0).reduce((s, r) => s + r.discount, 0);
  const vipDiscPat = new Set(discRows.filter(r => r.isVip).map(getPatientKey).filter(Boolean)).size;

  const avgByDoc = Object.entries(groupBy(rows, r => r.executor || null))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) })).filter(d => d.patients > 0).sort((a, b) => b.avgCheck - a.avgCheck);
  const avgBySpec = Object.entries(groupByMulti(rows, r => splitComma(r.executorSpec)))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) })).filter(d => d.patients > 0).sort((a, b) => b.avgCheck - a.avgCheck);
  const avgBySrc = Object.entries(groupBy(rows, r => r.sourceEntry || 'Не указан'))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) })).filter(d => d.patients > 0).sort((a, b) => b.avgCheck - a.avgCheck);

  addTitle(ws, `KPI — Пациенты · ${label}`, 4);

  addSection(ws, 'Общие показатели', 2);
  addHeaders(ws, ['Показатель', 'Значение']);
  const metrics = [
    ['Всего пациентов', patients.length],
    ['С Личным кабинетом', lkCount],
    ['Без Личного кабинета', patients.length - lkCount],
    ['% пациентов с ЛК', +lkPct.toFixed(1)],
    ['Пациентов со скидками', discPat],
    ['Из них VIP', vipDiscPat],
    ['Скидки VIP, ₽', Math.round(vipDisc)],
    ['Скидки прочих, ₽', Math.round(totalDisc - vipDisc)],
    ['Итого скидок, ₽', Math.round(totalDisc)],
  ];
  for (const [lbl, val] of metrics) {
    const r = addData(ws, [lbl, val], 2); rAlign(r, [2]);
    if (String(lbl).endsWith('₽')) r.getCell(2).numFmt = RUB;
  }

  addSection(ws, 'Средний чек по врачам', 4);
  addHeaders(ws, ['Врач', 'Пациентов', 'Выручка, ₽', 'Средний чек, ₽']);
  for (const d of avgByDoc) {
    const r = addData(ws, [d.name, d.patients, Math.round(d.revenue), Math.round(d.avgCheck)], 4);
    r.getCell(3).numFmt = RUB; r.getCell(4).numFmt = RUB; rAlign(r, [2, 3, 4]);
  }

  addSection(ws, 'Средний чек по специальностям', 4);
  addHeaders(ws, ['Специальность', 'Пациентов', 'Выручка, ₽', 'Средний чек, ₽']);
  for (const d of avgBySpec) {
    const r = addData(ws, [d.name, d.patients, Math.round(d.revenue), Math.round(d.avgCheck)], 4);
    r.getCell(3).numFmt = RUB; r.getCell(4).numFmt = RUB; rAlign(r, [2, 3, 4]);
  }

  addSection(ws, 'Средний чек по источнику записи', 4);
  addHeaders(ws, ['Источник', 'Пациентов', 'Выручка, ₽', 'Средний чек, ₽']);
  for (const d of avgBySrc) {
    const r = addData(ws, [d.name, d.patients, Math.round(d.revenue), Math.round(d.avgCheck)], 4);
    r.getCell(3).numFmt = RUB; r.getCell(4).numFmt = RUB; rAlign(r, [2, 3, 4]);
  }

  ws.columns = [{ width: 42 }, { width: 14 }, { width: 18 }, { width: 18 }];
}

// ── Sheet: Топ 20% пациентов ───────────────────────────────────────────────────
function sheetTop20(wb, rows, label) {
  const ws = wb.addWorksheet('Топ 20% пациентов');
  const all   = Array.from(buildPatientMap(rows).values());
  const top20 = top20pct(all);

  addTitle(ws, `KPI — Топ 20% пациентов · ${label}`, 6);
  addSubtitle(ws, `${top20.length} из ${all.length} пациентов`, 6);
  ws.addRow([]);

  addHeaders(ws, ['#', '№ карты', 'ФИО', 'Выручка, ₽', 'VIP', 'ЛК']);
  for (let i = 0; i < top20.length; i++) {
    const p = top20[i];
    const r = addData(ws, [i + 1, p.card || '', p.name || '', Math.round(p.revenue), p.isVip ? 'Да' : '', p.hasLK ? 'Да' : ''], 6);
    r.getCell(4).numFmt = RUB;
    r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    rAlign(r, [4]); r.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
    r.getCell(6).alignment = { horizontal: 'center', vertical: 'middle' };
  }
  ws.columns = [{ width: 6 }, { width: 14 }, { width: 44 }, { width: 18 }, { width: 8 }, { width: 8 }];
  ws.views = [{ state: 'frozen', ySplit: 4 }];
}

// ── Sheet: Маржинальность ──────────────────────────────────────────────────────
function sheetMargin(wb, rows, label) {
  const ws = wb.addWorksheet('Маржинальность');

  const popMap = {}, svcMap = {};
  for (const r of rows) {
    const name = r.serviceName; if (!name) continue;
    const qty = r.qty || 1;
    if (!popMap[name]) popMap[name] = { name, code: r.serviceCode || '', count: 0 };
    popMap[name].count += qty;
    if (!svcMap[name]) svcMap[name] = { name, code: r.serviceCode || '', count: 0, sumPrice: 0, sumCost: 0 };
    svcMap[name].count += qty; svcMap[name].sumPrice += r.servicePrice * qty; svcMap[name].sumCost += r.costPrice * qty;
  }
  const popular  = Object.values(popMap).sort((a, b) => b.count - a.count);
  const services = Object.values(svcMap).map(s => ({
    ...s, price: s.count ? s.sumPrice / s.count : 0, cost: s.count ? s.sumCost / s.count : 0,
    margin: s.sumPrice - s.sumCost, marginPct: s.sumPrice ? (s.sumPrice - s.sumCost) / s.sumPrice * 100 : 0,
  })).sort((a, b) => b.sumPrice - a.sumPrice);
  const hasCost = services.some(s => s.sumCost > 0);
  const hasCode = services.some(s => s.code);

  const maxSpan = hasCode ? (hasCost ? 7 : 4) : (hasCost ? 6 : 3);
  addTitle(ws, `KPI — Маржинальность · ${label}`, maxSpan);

  addSection(ws, 'Популярные услуги (по количеству)', hasCode ? 3 : 2);
  addHeaders(ws, hasCode ? ['Код', 'Услуга', 'Количество'] : ['Услуга', 'Количество']);
  for (const s of popular) {
    const vals = hasCode ? [s.code || '', s.name, s.count] : [s.name, s.count];
    const r = addData(ws, vals, vals.length); rAlign(r, [vals.length]);
  }

  const mH = ['Услуга'];
  if (hasCode) mH.unshift('Код');
  mH.push('Кол-во', 'Стоимость, ₽');
  if (hasCost) mH.push('Себест., ₽', 'Маржа ₽', 'Маржа %');

  addSection(ws, 'Маржинальность услуг', mH.length);
  addHeaders(ws, mH);
  const pc = hasCode ? 4 : 3;
  for (const s of services) {
    const vals = hasCode ? [s.code || '', s.name] : [s.name];
    vals.push(s.count, Math.round(s.price));
    if (hasCost) { vals.push(s.cost > 0 ? Math.round(s.cost) : null, Math.round(s.margin), s.cost > 0 ? +s.marginPct.toFixed(1) : null); }
    const r = addData(ws, vals, vals.length);
    r.getCell(pc).numFmt = RUB; rAlign(r, [pc - 1, pc]);
    if (hasCost) { r.getCell(pc + 1).numFmt = RUB; r.getCell(pc + 2).numFmt = RUB; rAlign(r, [pc + 1, pc + 2]); }
  }

  const cols = [...(hasCode ? [{ width: 12 }] : []), { width: 58 }, { width: 12 }, { width: 16 }, ...(hasCost ? [{ width: 16 }, { width: 16 }, { width: 12 }] : [])];
  ws.columns = cols;
}

// ── Sheet: Пациентов у врача ───────────────────────────────────────────────────
function sheetDoctorPatients(wb, rows, label) {
  const ws = wb.addWorksheet('Пациентов у врача');
  const data = Object.entries(groupBy(rows, r => r.executor || null))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) }))
    .filter(d => d.patients > 0).sort((a, b) => b.patients - a.patients);

  addTitle(ws, `KPI — Пациентов у врача · ${label}`, 4);
  addHeaders(ws, ['Врач', 'Пациентов', 'Выручка, ₽', 'Средний чек, ₽']);
  for (const d of data) {
    const r = addData(ws, [d.name, d.patients, Math.round(d.revenue), Math.round(d.avgCheck)], 4);
    r.getCell(3).numFmt = RUB; r.getCell(4).numFmt = RUB; rAlign(r, [2, 3, 4]);
  }
  ws.columns = [{ width: 42 }, { width: 12 }, { width: 18 }, { width: 18 }];
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// ── Sheet: Направления ─────────────────────────────────────────────────────────
function sheetReferrals(wb, rows, label) {
  const ws = wb.addWorksheet('Направления');
  const referrals = buildReferralPairs(rows);
  addTitle(ws, `KPI — Направления · ${label}`, 4);

  if (!referrals.length) {
    ws.addRow(['Данные о направлениях отсутствуют']);
    ws.columns = [{ width: 50 }]; return;
  }

  const refMap = {}, execMap = {};
  for (const r of referrals) {
    if (!refMap[r.referrer]) refMap[r.referrer] = { name: r.referrer, count: 0, revenue: 0 };
    refMap[r.referrer].count += r.count; refMap[r.referrer].revenue += r.revenue;
    if (!execMap[r.executor]) execMap[r.executor] = { name: r.executor, count: 0, revenue: 0 };
    execMap[r.executor].count += r.count; execMap[r.executor].revenue += r.revenue;
  }
  const topRefs  = Object.values(refMap).sort((a, b) => b.count - a.count);
  const topByRev = Object.values(execMap).sort((a, b) => b.revenue - a.revenue);

  const lookup = {}, seen = new Set(), mutual = [];
  for (const r of referrals) lookup[`${r.refKey} ${r.execKey}`] = r;
  for (const r of referrals) {
    const pk = [r.refKey, r.execKey].sort().join(' '); if (seen.has(pk)) continue; seen.add(pk);
    const rev = lookup[`${r.execKey} ${r.refKey}`]; if (!rev) continue;
    mutual.push({ docA: r.referrer, docB: r.executor, aToB: r.count, bToA: rev.count, total: r.count + rev.count });
  }
  mutual.sort((a, b) => b.total - a.total);

  addSection(ws, 'Кто чаще направляет', 3);
  addHeaders(ws, ['Врач', 'Направлений', 'Сумма, ₽']);
  for (const d of topRefs) { const r = addData(ws, [d.name, d.count, Math.round(d.revenue)], 3); r.getCell(3).numFmt = RUB; rAlign(r, [2, 3]); }

  addSection(ws, 'Кто приносит больше через направления', 3);
  addHeaders(ws, ['Врач', 'Направлений', 'Сумма, ₽']);
  for (const d of topByRev) { const r = addData(ws, [d.name, d.count, Math.round(d.revenue)], 3); r.getCell(3).numFmt = RUB; rAlign(r, [2, 3]); }

  addSection(ws, 'Все направления между врачами', 4);
  addHeaders(ws, ['Рекомендатель', 'Исполнитель', 'Кол-во', 'Сумма, ₽']);
  for (const r of referrals) { const row = addData(ws, [r.referrer, r.executor, r.count, Math.round(r.revenue)], 4); row.getCell(4).numFmt = RUB; rAlign(row, [3, 4]); }

  if (mutual.length) {
    addSection(ws, 'Взаимные направления', 6);
    addHeaders(ws, ['#', 'Врач А', 'А → Б', 'Б → А', 'Врач Б', 'Итого']);
    for (let i = 0; i < mutual.length; i++) {
      const p = mutual[i];
      const r = addData(ws, [i + 1, p.docA, p.aToB, p.bToA, p.docB, p.total], 6);
      r.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
      r.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      rAlign(r, [6]);
    }
  }
  ws.columns = [{ width: 40 }, { width: 40 }, { width: 12 }, { width: 16 }];
}

// ── Sheet: Повторные визиты ────────────────────────────────────────────────────
function sheetReturnVisits(wb, rows, label) {
  const ws   = wb.addWorksheet('Повторные визиты');
  const data = buildReturnVisits(rows);
  addTitle(ws, `KPI — Повторные визиты · ${label}`, 6);
  ws.addRow([]);
  addHeaders(ws, ['Врач', 'Всего пац.', 'Не вернулся', 'К тому же врачу', 'К другому по направлению', 'К другому самостоятельно']);
  for (const d of data) {
    const r = addData(ws, [d.name, d.total, d.notReturned, d.sameDoctor, d.otherReferred, d.otherSelf], 6);
    rAlign(r, [2, 3, 4, 5, 6]);
  }
  ws.columns = [{ width: 42 }, { width: 12 }, { width: 14 }, { width: 18 }, { width: 28 }, { width: 28 }];
  ws.views = [{ state: 'frozen', ySplit: 3 }];
}

// ── Sheet: Цепочки направлений ────────────────────────────────────────────────
function sheetChains(wb, rows, label) {
  const ws     = wb.addWorksheet('Цепочки направлений');
  const chains = buildChains(rows);
  addTitle(ws, `KPI — Внутренняя сеть направлений · ${label}`, 3);
  addSubtitle(ws, `${chains.length} уникальных цепочек`, 3);
  ws.addRow([]);
  addHeaders(ws, ['Цепочка', 'Пациентов', 'Шагов']);
  for (const c of chains) { const r = addData(ws, [c.name, c.count, c.steps], 3); rAlign(r, [2, 3]); }
  ws.columns = [{ width: 80 }, { width: 14 }, { width: 10 }];
  ws.views = [{ state: 'frozen', ySplit: 4 }];
}

// ── Public API ─────────────────────────────────────────────────────────────────
export async function buildKpiWorkbook(rows, periodLabel) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'alfa-wiki';
  wb.created = new Date();

  sheetGeneral(wb, rows, periodLabel);
  sheetPatients(wb, rows, periodLabel);
  sheetTop20(wb, rows, periodLabel);
  sheetMargin(wb, rows, periodLabel);
  sheetDoctorPatients(wb, rows, periodLabel);
  sheetReferrals(wb, rows, periodLabel);
  sheetReturnVisits(wb, rows, periodLabel);
  sheetChains(wb, rows, periodLabel);

  return wb;
}
