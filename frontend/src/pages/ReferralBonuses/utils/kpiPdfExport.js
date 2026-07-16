import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import { DEFAULT_CLINICS } from './clinicUtils';
import { rbParseFullName, rbParseAbbrevName } from './nameMatching';

pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts;

// ── Org groups ─────────────────────────────────────────────────────────────────
const ORG_GROUPS = [
  { key: 'prestige', label: 'Альфа Престиж', color: '#de64a1', ids: ['2','3','6'],
    nameMatch: n => (n.includes('альфа') || n.includes('кидс') || n.includes('kids') || n.includes('линия')) && !n.includes('проф') },
  { key: 'prof',     label: 'Проф',           color: '#9999ff', ids: ['1'],
    nameMatch: n => n.includes('проф') },
  { key: 'labgroup', label: 'Лабгрупп',       color: '#800080', ids: ['4','7'],
    nameMatch: n => n.includes('3к') || n.includes('3k') || n.includes('смайл') || n.includes('лабгрупп') },
  { key: 'sukko',    label: 'Алекс',          color: '#2d7055', ids: ['11','12'],
    nameMatch: n => n.includes('сукко') || n.includes('алекс') },
];
const CLINIC_COLOR_MAP = Object.fromEntries(DEFAULT_CLINICS.map(c => [String(c.id), c.color]));

// ── Clinic schedules (mirrored from StepKpi) ───────────────────────────────────
const CLINIC_SCHEDULES = {
  '2':  { minPerDay: (24   - 8)   * 60, workDays: [0,1,2,3,4,5,6] },
  '3':  { minPerDay: (23   - 7.5) * 60, workDays: [0,1,2,3,4,5,6] },
  '6':  { minPerDay: (21   - 8)   * 60, workDays: [0,1,2,3,4,5,6] },
  '1':  { minPerDay: (20   - 7.5) * 60, workDays: [0,1,2,3,4,5,6] },
  '7':  { minPerDay: (21   - 8)   * 60, workDays: [0,1,2,3,4,5,6] },
  '4':  { minPerDay: (20   - 8)   * 60, workDays: [0,1,2,3,4,5,6] },
  '11': { minPerDay: (17   - 8)   * 60, workDays: [1,2,3,4,5]     },
  '12': { minPerDay: (17   - 8)   * 60, workDays: [1,2,3,4,5]     },
};

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
function getClinicColorById(clinicId) {
  return CLINIC_COLOR_MAP[String(clinicId)] || '#94a3b8';
}
// ── Heatmap helpers ────────────────────────────────────────────────────────────
function blendHex(hex, ratio) {
  if (!hex || hex.length < 7) return '#f5f5f5';
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  const ar = 0.25 + ratio * 0.75;
  return `#${[r,g,b].map(c => Math.round(255+(c-255)*ar).toString(16).padStart(2,'0')).join('')}`;
}
function hslHex(hue, sat, lig) {
  sat /= 100; lig /= 100;
  const a = sat * Math.min(lig, 1-lig);
  const f = n => { const k=(n+hue/30)%12; return Math.round(255*(lig-a*Math.max(Math.min(k-3,9-k,1),-1))).toString(16).padStart(2,'0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function heatDays(periodStart, periodEnd) {
  if (!periodStart || !periodEnd) return [];
  const days = [], cur = new Date(periodStart); cur.setHours(0,0,0,0);
  const fin = new Date(periodEnd); fin.setHours(23,59,59,999);
  while (cur <= fin) { days.push(new Date(cur)); cur.setDate(cur.getDate()+1); }
  return days;
}
function heatTable(body, days, labelW) {
  const pageW = 515; // A4 usable
  const dayW  = Math.max(4, Math.floor((pageW - labelW - 14) / days.length));
  return {
    table: {
      headerRows: 1,
      widths: [labelW, ...days.map(() => dayW), 14],
      body,
    },
    layout: {
      hLineWidth: () => 0.3, vLineWidth: () => 0.3,
      hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0',
      paddingLeft: () => 1, paddingRight: () => 1,
      paddingTop: () => 0.5, paddingBottom: () => 0.5,
    },
    margin: [0, 2, 0, 10],
  };
}
function heatHeader(days) {
  return [
    { text: '', fillColor: '#f1f5f9', border: [false, false, false, true] },
    ...days.map(d => ({
      text: String(d.getDate()), fontSize: 5, alignment: 'center',
      fillColor: [0,6].includes(d.getDay()) ? '#e2e8f0' : '#f1f5f9',
      border: [false, false, false, true],
    })),
    { text: 'Σ', fontSize: 5, alignment: 'center', fillColor: '#f1f5f9', border: [false, false, false, true] },
  ];
}

function buildDoctorHeatmapPdf(rows, periodStart, periodEnd, content) {
  const days = heatDays(periodStart, periodEnd);
  if (!days.length || days.length > 65) return;

  const colorByDoc = {}, byDoc = {};
  for (const r of rows) {
    if (!r.executor) continue;
    if (r.clinicId && !colorByDoc[r.executor]) colorByDoc[r.executor] = getClinicColorById(r.clinicId);
    if (!r.date) continue;
    const dk = r.date.toISOString().slice(0,10), pk = getPatientKey(r);
    if (!pk) continue;
    if (!byDoc[r.executor]) byDoc[r.executor] = {};
    if (!byDoc[r.executor][dk]) byDoc[r.executor][dk] = new Set();
    byDoc[r.executor][dk].add(pk);
  }
  const docList = Object.entries(byDoc).map(([name, dd]) => {
    const dc = {}, total = Object.values(dd).reduce((s,v) => s+v.size, 0);
    for (const [d,s] of Object.entries(dd)) dc[d] = s.size;
    return { name, color: colorByDoc[name]||'#94a3b8', dc, total };
  }).sort((a,b) => b.total - a.total);
  if (!docList.length) return;

  const mx = Math.max(1, ...docList.flatMap(d => Object.values(d.dc)));
  const showN = days.length <= 31;
  const body  = [heatHeader(days)];
  for (const doc of docList) {
    body.push([
      { text: doc.name, fontSize: 5.5, border: [false,false,false,false] },
      ...days.map(d => {
        const count = doc.dc[d.toISOString().slice(0,10)] || 0;
        const ratio = count / mx;
        return { text: showN && count ? String(count) : '', fontSize: 5, alignment: 'center',
          fillColor: count ? blendHex(doc.color, ratio) : '#f8fafc',
          color: ratio > 0.6 ? '#fff' : '#333', border: [false,false,false,false] };
      }),
      { text: String(doc.total), fontSize: 5, alignment: 'center', color: '#64748b', border: [false,false,false,false] },
    ]);
  }
  content.push(heatTable(body, days, 90));
}

function buildStaffHeatmapPdf(rows, doctors, periodStart, periodEnd, content) {
  const days = heatDays(periodStart, periodEnd);
  if (!days.length || days.length > 65 || !doctors?.length) return;

  const cabinets = doctors.filter(d => d.roles?.includes('КабинетыИРабота'));
  if (!cabinets.length) return;
  const staffKeys = new Map();
  for (const d of cabinets) { const k = nameToKey(d.name); if (k) staffKeys.set(k, d.name); }

  const sets = {};
  for (const r of rows) {
    if (!r.executor || !r.date) continue;
    const k = nameToKey(r.executor);
    if (!staffKeys.has(k)) continue;
    const name = staffKeys.get(k), dk = r.date.toISOString().slice(0,10), pk = getPatientKey(r);
    if (!pk) continue;
    if (!sets[name]) sets[name] = {};
    if (!sets[name][dk]) sets[name][dk] = new Set();
    sets[name][dk].add(pk);
  }
  const staffList = Object.entries(sets).map(([name, dd]) => {
    const dc = {}, total = Object.values(dd).reduce((s,v) => s+v.size, 0);
    for (const [d,s] of Object.entries(dd)) dc[d] = s.size;
    return { name, dc, total };
  }).filter(s => s.total > 0).sort((a,b) => b.total - a.total);
  if (!staffList.length) return;

  const mx = Math.max(1, ...staffList.flatMap(s => Object.values(s.dc)));
  const showN = days.length <= 31;
  const body  = [heatHeader(days)];
  for (const s of staffList) {
    body.push([
      { text: s.name, fontSize: 5.5, border: [false,false,false,false] },
      ...days.map(d => {
        const count = s.dc[d.toISOString().slice(0,10)] || 0;
        const ratio = count / mx;
        const hue = ratio * 120, lig = ratio < 0.5 ? 50+ratio*10 : 60-(ratio-0.5)*32;
        return { text: showN && count ? String(count) : '', fontSize: 5, alignment: 'center',
          fillColor: count ? hslHex(hue, 82, lig) : '#f8fafc',
          color: ratio > 0.6 ? '#fff' : '#333', border: [false,false,false,false] };
      }),
      { text: String(s.total), fontSize: 5, alignment: 'center', color: '#64748b', border: [false,false,false,false] },
    ]);
  }
  content.push(heatTable(body, days, 90));
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
function buildReturnVisits_data(rows) {
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
      else { if (ch.length >= 2) cc[ch.join(' -> ')] = (cc[ch.join(' -> ')] || 0) + 1; ch = [from, to]; }
    }
    if (ch && ch.length >= 2) cc[ch.join(' -> ')] = (cc[ch.join(' -> ')] || 0) + 1;
  }
  return Object.entries(cc).map(([name, count]) => ({ name, count, steps: name.split(' -> ').length - 1 })).sort((a, b) => b.count - a.count);
}

// ── Room stat helpers (mirrored from StepKpi) ──────────────────────────────────
function parseApptTime(str) {
  if (!str) return null;
  const iso = Date.parse(str.replace(' ', 'T'));
  if (!isNaN(iso)) return new Date(iso);
  const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
  return null;
}
function clinicWorkMinutesInPeriod(clinicId, start, end) {
  const sched = CLINIC_SCHEDULES[String(clinicId)];
  const minPerDay = sched ? sched.minPerDay : 480;
  const workDays  = sched ? sched.workDays  : [1,2,3,4,5,6];
  let count = 0;
  const cur = new Date(start); cur.setHours(0,0,0,0);
  const fin = new Date(end);   fin.setHours(23,59,59,999);
  while (cur <= fin) { if (workDays.includes(cur.getDay())) count++; cur.setDate(cur.getDate() + 1); }
  return count * minPerDay;
}
function unionIntervalMinutes(ranges) {
  if (!ranges.length) return 0;
  const sorted = [...ranges].sort((a, b) => a.t0 - b.t0);
  let total = 0, curStart = sorted[0].t0, curEnd = sorted[0].t1;
  for (let i = 1; i < sorted.length; i++) {
    const { t0, t1 } = sorted[i];
    if (t0 <= curEnd) { if (t1 > curEnd) curEnd = t1; }
    else { total += (curEnd - curStart) / 60000; curStart = t0; curEnd = t1; }
  }
  total += (curEnd - curStart) / 60000;
  return total;
}
function buildRoomStats(appointments, start, end) {
  const map = {};
  for (const a of appointments) {
    if (a.status_id === 5 || a.status === 'refused') continue;
    const room = (a.room || '').trim(); if (!room) continue;
    const t0 = parseApptTime(a.time_start), t1 = parseApptTime(a.time_end);
    if (!t0 || !t1) continue;
    const dur = (t1 - t0) / 60000; if (dur <= 0 || dur > 720) continue;
    const clinicId = String(a.clinic_id || '');
    const key = `${clinicId}|${room}`;
    if (!map[key]) map[key] = { room, clinicId, ranges: [] };
    map[key].ranges.push({ t0, t1 });
  }
  return Object.values(map).map(d => {
    const clinic   = DEFAULT_CLINICS.find(c => String(c.id) === d.clinicId);
    const capacity = clinicWorkMinutesInPeriod(d.clinicId, start, end);
    const totalMin = unionIntervalMinutes(d.ranges);
    return {
      name:        d.room,
      clinicId:    d.clinicId,
      clinicName:  clinic?.name || (d.clinicId ? `Клиника ${d.clinicId}` : ''),
      totalHours:  totalMin / 60,
      capacity,
      utilPct:     capacity > 0 ? (totalMin / capacity * 100) : 0,
      color:       getClinicColorById(d.clinicId),
    };
  }).sort((a, b) => b.utilPct - a.utilPct);
}
function buildRoomGapStats(appointments) {
  const byRoom = {};
  for (const a of appointments) {
    if (a.status_id === 5 || a.status === 'refused') continue;
    const room = (a.room || '').trim(); if (!room) continue;
    const t0 = parseApptTime(a.time_start), t1 = parseApptTime(a.time_end);
    if (!t0 || !t1) continue;
    const clinicId = String(a.clinic_id || '');
    const key = `${clinicId}|${room}`;
    if (!byRoom[key]) byRoom[key] = { room, clinicId, appts: [] };
    byRoom[key].appts.push({ start: t0, end: t1 });
  }
  const results = [];
  for (const d of Object.values(byRoom)) {
    d.appts.sort((a, b) => a.start - b.start);
    const gaps = [];
    for (let i = 1; i < d.appts.length; i++) {
      const prev = d.appts[i - 1], cur = d.appts[i];
      if (prev.end.toDateString() !== cur.start.toDateString()) continue;
      const gapMin = (cur.start - prev.end) / 60000;
      if (gapMin >= 0) gaps.push(gapMin);
    }
    if (!gaps.length) continue;
    const avg    = gaps.reduce((s, v) => s + v, 0) / gaps.length;
    const sorted = [...gaps].sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const clinic = DEFAULT_CLINICS.find(c => String(c.id) === d.clinicId);
    results.push({
      name: d.room, clinicId: d.clinicId,
      clinicName: clinic?.name || (d.clinicId ? `Клиника ${d.clinicId}` : ''),
      color:      getClinicColorById(d.clinicId),
      avgGap: avg, median, gapCount: gaps.length,
    });
  }
  results.sort((a, b) => a.avgGap - b.avgGap);
  const overallAvg = results.length ? results.reduce((s, r) => s + r.avgGap, 0) / results.length : 0;
  return { rooms: results, overallAvg };
}

const fmtN   = n => Math.round(n || 0).toLocaleString('ru-RU');
const fmtRub = n => fmtN(n) + ' ₽';  // ₽ via code point — always safe
const fmtMin = v => {
  if (v < 1) return '< 1 мин';
  const h = Math.floor(v / 60), m = Math.round(v % 60);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
};

// Strips chars outside the Roboto subset bundled with pdfmake.
// Safe: ASCII, Cyrillic (U+0400–U+04FF), common Latin Extended,
//   spaces, digits, punctuation.
// Replaced: arrows (→ ← ↑ ↓), checkmarks (✓ ✗), fancy quotes, etc.
function safeStr(s) {
  return String(s || '')
    .replace(/→/g, '->')   // → rightwards arrow
    .replace(/←/g, '<-')   // ← leftwards arrow
    .replace(/↑/g, '^')    // ↑
    .replace(/↓/g, 'v')    // ↓
    .replace(/✓/g, '+')    // ✓ check mark
    .replace(/✗/g, 'x')    // ✗ ballot x
    .replace(/—/g, '-')    // — em dash (usually ok, but safe fallback)
    .replace(/…/g, '...')  // …
    .replace(/[‘’]/g, "'")  // curly single quotes
    .replace(/[“”]/g, '"'); // curly double quotes
}

// ── Layout (A4 portrait, margins 25 each side → usable ~545pt) ────────────────
const PW          = 545;
const BAR_LABEL_W = 185;
const BAR_MAX_W   = PW - BAR_LABEL_W - 90; // 270

// ── PDF element helpers ────────────────────────────────────────────────────────
// pageBreak: 'before' starts each section on a new page (pass false for first).
function pdfSection(text, pageBreak = true) {
  return {
    text, fontSize: 12, bold: true, color: '#1e3a8a', margin: [0, 16, 0, 5],
    // Always specify portrait so a landscape margin section is properly closed
    ...(pageBreak ? { pageBreak: 'before', pageOrientation: 'portrait' } : {}),
  };
}
function pdfSubsection(text) {
  return { text, fontSize: 10, bold: true, color: '#374151', margin: [0, 10, 0, 3] };
}

function pdfTable(headers, rows, widths) {
  if (!rows.length) return null;
  return {
    table: {
      headerRows: 1,
      widths: widths || headers.map(() => '*'),
      body: [
        headers.map(h => ({ text: h, fontSize: 8, bold: true, fillColor: '#e2e8f0', color: '#374151' })),
        ...rows,
      ],
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length) ? 1 : 0.3,
      vLineWidth: () => 0,
      hLineColor: (i) => (i === 0 || i === 1) ? '#94a3b8' : '#e2e8f0',
      fillColor:  (i) => i % 2 === 0 && i > 0 ? '#f8fafc' : null,
      paddingLeft: () => 4, paddingRight: () => 4,
      paddingTop:  () => 3, paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 10],
  };
}

function cell(text, align = 'left') {
  return { text: safeStr(text), fontSize: 8, color: '#374151', alignment: align };
}
function rCell(text) { return cell(text, 'right'); }
function cCell(text) { return cell(text, 'center'); }

// ── Horizontal bar chart (native pdfMake — unlimited rows, auto-paginates) ─────
function pdfHBar(data, {
  valueKey   = 'value',
  labelKey   = 'name',
  colorKey,
  defColor   = '#4f8ef7',
  formatter,
  labelWidth = BAR_LABEL_W,
  barMaxW    = BAR_MAX_W,
} = {}) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d[valueKey] || 0), 1);
  return {
    table: {
      widths: [labelWidth, barMaxW, 88],
      body: data.map(d => {
        const val   = d[valueKey] || 0;
        const barW  = Math.max((val / max) * barMaxW, val > 0 ? 1.5 : 0);
        const color = colorKey ? (d[colorKey] || defColor) : defColor;
        return [
          { text: safeStr(d[labelKey]), fontSize: 8, color: '#374151', margin: [0, 2, 4, 2] },
          { canvas: barW > 0 ? [{ type: 'rect', x: 0, y: 4, w: barW, h: 9, r: 2, color }] : [], margin: [0,0,0,0] },
          { text: formatter ? formatter(val) : val.toLocaleString('ru-RU'), fontSize: 8, color: '#374151', alignment: 'right', margin: [4, 2, 0, 2] },
        ];
      }),
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 0 : 0.3,
      vLineWidth: () => 0,
      hLineColor: () => '#e2e8f0',
      fillColor:  (i) => i % 2 === 1 ? '#f8fafc' : null,
      paddingTop: () => 0, paddingBottom: () => 0,
      paddingLeft: () => 2, paddingRight: () => 2,
    },
    margin: [0, 0, 0, 12],
  };
}

// ── Donut chart (SVG arcs + pdfMake legend — no Cyrillic in SVG paths) ─────────
function pdfPie(segments, { size = 140, formatter } = {}) {
  const segs = segments.filter(s => s.value > 0);
  if (!segs.length) return null;
  const total = segs.reduce((s, d) => s + d.value, 0);
  const cx = size / 2, cy = size / 2, R = size * 0.44, r = size * 0.24;
  let angle = -Math.PI / 2, svgPaths = '';
  for (const seg of segs) {
    const sweep = (seg.value / total) * 2 * Math.PI;
    const end = angle + sweep, large = sweep > Math.PI ? 1 : 0;
    const [c0, s0] = [Math.cos(angle), Math.sin(angle)];
    const [c1, s1] = [Math.cos(end),   Math.sin(end)];
    const d = [
      `M ${(cx + r * c0).toFixed(2)} ${(cy + r * s0).toFixed(2)}`,
      `L ${(cx + R * c0).toFixed(2)} ${(cy + R * s0).toFixed(2)}`,
      `A ${R} ${R} 0 ${large} 1 ${(cx + R * c1).toFixed(2)} ${(cy + R * s1).toFixed(2)}`,
      `L ${(cx + r * c1).toFixed(2)} ${(cy + r * s1).toFixed(2)}`,
      `A ${r} ${r} 0 ${large} 0 ${(cx + r * c0).toFixed(2)} ${(cy + r * s0).toFixed(2)} Z`,
    ].join(' ');
    svgPaths += `<path d="${d}" fill="${seg.color||'#94a3b8'}" stroke="white" stroke-width="1.5"/>`;
    // Only ASCII numbers in SVG — no Cyrillic risk
    if (sweep > 0.25) {
      const mid = angle + sweep / 2;
      svgPaths += `<text x="${(cx+(R+r)/2*Math.cos(mid)).toFixed(1)}" y="${(cy+(R+r)/2*Math.sin(mid)).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="bold" fill="white">${(seg.value/total*100).toFixed(0)}%</text>`;
    }
    angle = end;
  }
  const legendBody = segs.map(seg => [
    { canvas: [{ type: 'rect', x: 0, y: 2, w: 8, h: 8, r: 1, color: seg.color||'#94a3b8' }], width: 14, margin: [0,0,0,0] },
    { text: safeStr(seg.label), fontSize: 8, color: '#374151', margin: [0, 1, 0, 1] },
    { text: formatter ? formatter(seg.value) : seg.value.toLocaleString('ru-RU'), fontSize: 8, bold: true, color: '#374151', alignment: 'right', margin: [0,1,0,1] },
  ]);
  return {
    columns: [
      { svg: `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${svgPaths}</svg>`, width: size, height: size },
      {
        stack: [{ table: { widths: [12,'*',80], body: legendBody }, layout: { hLineWidth: ()=>0, vLineWidth: ()=>0, paddingTop:()=>2, paddingBottom:()=>2 } }],
        margin: [12, Math.max(0, (size - segs.length * 20) / 2), 0, 0],
        width: '*',
      },
    ],
    margin: [0, 4, 0, 10],
  };
}

// ── Section builders ───────────────────────────────────────────────────────────

function buildGeneral(rows, content, pageBreak) {
  content.push(pdfSection('Общая статистика', pageBreak));

  // Org groups — chart only (table would duplicate)
  const orgStats = ORG_GROUPS.map(g => ({
    name: g.label, color: g.color, ...rev_pat(rows.filter(r => getOrgGroup(r)?.key === g.key)),
  }));
  content.push(pdfSubsection('Выручка по организациям'));
  content.push(pdfHBar(orgStats, { valueKey: 'revenue', labelKey: 'name', colorKey: 'color', formatter: fmtRub, labelWidth: 140 }));

  // Clinics — pies stacked full-width so legend has enough room for long names
  const clinicStats = Object.entries(groupBy(rows, r => r.clinicRaw || '-'))
    .map(([name, rs]) => ({ name, color: clinicColor(rs), ...rev_pat(rs) }))
    .sort((a, b) => b.revenue - a.revenue);
  content.push(pdfSubsection('По клиникам — выручка'));
  const revPie = pdfPie(clinicStats.map(c => ({ label: c.name, value: c.revenue, color: c.color })), { size: 190, formatter: fmtRub });
  if (revPie) content.push(revPie);
  content.push(pdfSubsection('По клиникам — пациентов'));
  const patPie = pdfPie(clinicStats.map(c => ({ label: c.name, value: c.patients, color: c.color })), { size: 190 });
  if (patPie) content.push(patPie);

  // Specialties — chart only
  const specStats = Object.entries(groupByMulti(rows, r => splitComma(r.executorSpec)))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) })).sort((a, b) => b.patients - a.patients);
  content.push(pdfSubsection('Пациентов по специальностям'));
  content.push(pdfHBar(specStats, { valueKey: 'patients', labelKey: 'name', defColor: '#8b5cf6', formatter: fmtN }));
}

function buildPatients(rows, content, pageBreak) {
  const patMap   = buildPatientMap(rows);
  const patients = Array.from(patMap.values());
  const lkCount  = patients.filter(p => p.hasLK).length;
  const discRows  = rows.filter(r => r.discount > 0);
  const discPat   = new Set(discRows.map(getPatientKey).filter(Boolean)).size;
  const vipDiscPat = new Set(discRows.filter(r => r.isVip).map(getPatientKey).filter(Boolean)).size;

  content.push(pdfSection('Пациенты', pageBreak));

  content.push({
    columns: [
      { stack: [
        { text: 'Личный кабинет', fontSize: 8, bold: true, margin: [0,0,0,3] },
        pdfPie([
          { label: 'С ЛК',   value: lkCount,                   color: '#10b981' },
          { label: 'Без ЛК', value: patients.length - lkCount, color: '#ef4444' },
        ].filter(s => s.value > 0), { size: 130 }) || { text: '' },
      ], width: '*' },
      discPat > 0 ? { stack: [
        { text: 'Пациенты со скидками', fontSize: 8, bold: true, margin: [0,0,0,3] },
        pdfPie([
          { label: 'VIP',    value: vipDiscPat,           color: '#f59e0b' },
          { label: 'Прочие', value: discPat - vipDiscPat, color: '#f97316' },
        ].filter(s => s.value > 0), { size: 130 }) || { text: '' },
      ], width: '*' } : { text: '', width: '*' },
    ],
    columnGap: 16, margin: [0, 0, 0, 4],
  });

  const avgByDoc = Object.entries(groupBy(rows, r => r.executor || null))
    .map(([name, rs]) => ({ name, color: clinicColor(rs), ...rev_pat(rs) }))
    .filter(d => d.patients > 0).sort((a, b) => b.avgCheck - a.avgCheck);
  content.push(pdfSubsection('Средний чек по врачам'));
  content.push(pdfHBar(avgByDoc, { valueKey: 'avgCheck', labelKey: 'name', colorKey: 'color', formatter: fmtRub }));

  const avgBySpec = Object.entries(groupByMulti(rows, r => splitComma(r.executorSpec)))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) })).filter(d => d.patients > 0).sort((a, b) => b.avgCheck - a.avgCheck);
  content.push(pdfSubsection('Средний чек по специальностям'));
  content.push(pdfHBar(avgBySpec, { valueKey: 'avgCheck', labelKey: 'name', defColor: '#8b5cf6', formatter: fmtRub }));

  const avgBySrc = Object.entries(groupBy(rows, r => r.sourceEntry || 'Не указан'))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) })).filter(d => d.patients > 0).sort((a, b) => b.avgCheck - a.avgCheck);
  content.push(pdfSubsection('Средний чек по источнику записи'));
  content.push(pdfHBar(avgBySrc, { valueKey: 'avgCheck', labelKey: 'name', defColor: '#14b8a6', formatter: fmtRub }));
}

function buildTop20(rows, content, pageBreak) {
  const all   = Array.from(buildPatientMap(rows).values());
  const top20 = top20pct(all);
  content.push(pdfSection(`Топ 20% пациентов (${top20.length} из ${all.length})`, pageBreak));
  content.push(pdfTable(
    ['#', 'N карты', 'ФИО', 'Выручка', 'VIP', 'ЛК'],
    top20.map((p, i) => [
      rCell(i + 1), cell(p.card || ''), cell(p.name || ''),
      rCell(fmtRub(p.revenue)), cCell(p.isVip ? 'да' : ''), cCell(p.hasLK ? 'да' : ''),
    ]),
    [24, 65, '*', 95, 28, 28],
  ));
}

const TOP_N = 50; // rows shown per «top» and «bottom» slice

function buildMargin(rows, content, pageBreak) {
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
    ...s,
    price:     s.count ? s.sumPrice / s.count : 0,
    cost:      s.count ? s.sumCost  / s.count : 0,
    margin:    s.sumPrice - s.sumCost,
    marginPct: s.sumPrice ? ((s.sumPrice - s.sumCost) / s.sumPrice * 100) : 0,
  }));
  const hasCost = services.some(s => s.sumCost > 0);
  const hasCode = services.some(s => s.code);

  content.push(pdfSection('Маржинальность', pageBreak));

  // ── Popular services: top N most + top N least ────────────────────────────
  const popTop    = popular.slice(0, TOP_N);
  const popBottom = popular.length > TOP_N
    ? popular.slice(-Math.min(TOP_N, popular.length - TOP_N))
    : [];
  const hidden    = popular.length - popTop.length - popBottom.length;

  const popNote = popular.length > TOP_N
    ? ` (из ${popular.length}${hidden > 0 ? `, скрыто ${hidden}` : ''})`
    : '';

  content.push(pdfSubsection(`Топ ${popTop.length} — наиболее популярные услуги${popNote}`));
  content.push(pdfHBar(popTop, { valueKey: 'count', labelKey: 'name', defColor: '#8b5cf6', formatter: fmtN }));

  if (popBottom.length) {
    content.push(pdfSubsection(`Топ ${popBottom.length} — наименее популярные услуги`));
    content.push(pdfHBar(popBottom, { valueKey: 'count', labelKey: 'name', defColor: '#94a3b8', formatter: fmtN }));
  }

  // ── Margin table: top N highest + top N lowest — landscape for column fit ─
  if (hasCost) {
    const byHigh = [...services].sort((a, b) => b.margin - a.margin).slice(0, TOP_N);
    const byLow  = [...services].sort((a, b) => a.margin - b.margin).slice(0, TOP_N);
    const totalSvc = services.length;

    const mHeaders = hasCode
      ? ['Код', 'Услуга', 'Кол-во', 'Стоимость', 'Себест.', 'Маржа', 'Марж.%']
      : ['Услуга', 'Кол-во', 'Стоимость', 'Себест.', 'Маржа', 'Марж.%'];
    const mWidths = hasCode ? [45, '*', 48, 90, 90, 90, 48] : ['*', 48, 90, 90, 90, 48];
    const mRow = s => hasCode
      ? [cell(s.code||''), cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price)), rCell(s.cost>0?fmtRub(s.cost):'-'), rCell(fmtRub(s.margin)), rCell(s.cost>0?s.marginPct.toFixed(1)+'%':'-')]
      : [cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price)), rCell(s.cost>0?fmtRub(s.cost):'-'), rCell(fmtRub(s.margin)), rCell(s.cost>0?s.marginPct.toFixed(1)+'%':'-')];

    // Landscape so all 7 columns fit; next pdfSection restores portrait automatically
    content.push({
      text: `Топ ${byHigh.length} — наибольшая маржа (из ${totalSvc})`,
      fontSize: 10, bold: true, color: '#374151', margin: [0, 10, 0, 3],
      pageBreak: 'before', pageOrientation: 'landscape',
    });
    content.push(pdfTable(mHeaders, byHigh.map(mRow), mWidths));

    if (byLow.length) {
      content.push(pdfSubsection(`Топ ${byLow.length} — наименьшая маржа`));
      content.push(pdfTable(mHeaders, byLow.map(mRow), mWidths));
    }
  } else {
    const byPop = [...services].sort((a, b) => b.count - a.count).slice(0, TOP_N);
    content.push(pdfTable(
      hasCode ? ['Код', 'Услуга', 'Кол-во', 'Стоимость'] : ['Услуга', 'Кол-во', 'Стоимость'],
      byPop.map(s => hasCode
        ? [cell(s.code||''), cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price))]
        : [cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price))]),
      hasCode ? [55, '*', 65, 100] : ['*', 65, 100],
    ));
  }
}

function buildEfficiency(rows, opts, content, pageBreak) {
  content.push(pdfSection('Эффективность', pageBreak));

  const docData = Object.entries(groupBy(rows, r => r.executor || null))
    .map(([name, rs]) => ({ name, color: clinicColor(rs), ...rev_pat(rs) }))
    .filter(d => d.patients > 0).sort((a, b) => b.patients - a.patients);
  content.push(pdfSubsection('Пациентов у врача'));
  content.push(pdfHBar(docData, { valueKey: 'patients', labelKey: 'name', colorKey: 'color', formatter: fmtN }));
  buildDoctorHeatmapPdf(rows, opts?.periodStart, opts?.periodEnd, content);

  const referrals = buildReferralPairs(rows);
  if (referrals.length) {
    const refMap = {}, execMap = {};
    for (const r of referrals) {
      if (!refMap[r.referrer]) refMap[r.referrer] = { name: r.referrer, count: 0, revenue: 0 };
      refMap[r.referrer].count += r.count; refMap[r.referrer].revenue += r.revenue;
      if (!execMap[r.executor]) execMap[r.executor] = { name: r.executor, count: 0, revenue: 0 };
      execMap[r.executor].count += r.count; execMap[r.executor].revenue += r.revenue;
    }
    const topRefs  = Object.values(refMap).sort((a, b) => b.count - a.count);
    const topByRev = Object.values(execMap).sort((a, b) => b.revenue - a.revenue);

    content.push(pdfSubsection('Кто чаще направляет'));
    content.push(pdfHBar(topRefs, { valueKey: 'count', labelKey: 'name', defColor: '#f97316', formatter: fmtN }));

    content.push(pdfSubsection('Кто приносит больше через направления'));
    content.push(pdfHBar(topByRev, { valueKey: 'revenue', labelKey: 'name', defColor: '#10b981', formatter: fmtRub }));

    const lookup = {};
    for (const r of referrals) lookup[`${r.refKey} ${r.execKey}`] = r;
    const seenPairs = new Set();
    const mutual = [];
    for (const r of referrals) {
      const pk = [r.refKey, r.execKey].sort().join(' ');
      if (seenPairs.has(pk)) continue;
      seenPairs.add(pk);
      const rev = lookup[`${r.execKey} ${r.refKey}`];
      if (!rev) continue;
      mutual.push({ docA: r.referrer, docB: r.executor, aToB: r.count, bToA: rev.count, total: r.count + rev.count });
    }
    mutual.sort((a, b) => b.total - a.total);
    if (mutual.length) {
      content.push(pdfSubsection('Взаимные направления'));
      content.push(pdfTable(
        ['#', 'Врач А', 'A->B', 'B->A', 'Врач Б', 'Итого'],
        mutual.slice(0, 50).map((p, i) => [rCell(i+1), cell(p.docA), cCell(p.aToB), cCell(p.bToA), cell(p.docB), rCell(p.total)]),
        [22, '*', 42, 42, '*', 42],
      ));
    }

    content.push(pdfSubsection('Все направления между врачами'));
    content.push(pdfTable(
      ['Рекомендатель', 'Исполнитель', 'Кол-во', 'Сумма'],
      referrals.map(r => [cell(r.referrer), cell(r.executor), rCell(fmtN(r.count)), rCell(fmtRub(r.revenue))]),
      ['*', '*', 60, 100],
    ));
  } else {
    content.push({ text: 'Данные о направлениях отсутствуют', fontSize: 9, color: '#94a3b8', margin: [0, 4, 0, 8] });
  }

  const retVisits = buildReturnVisits_data(rows);
  content.push(pdfSubsection('Повторные визиты'));
  if (retVisits.length) {
    content.push(pdfTable(
      ['Врач', 'Всего', 'Не верн.', 'К тому же', 'По направл.', 'Самост.'],
      retVisits.map(d => [cell(d.name), rCell(fmtN(d.total)), rCell(fmtN(d.notReturned)), rCell(fmtN(d.sameDoctor)), rCell(fmtN(d.otherReferred)), rCell(fmtN(d.otherSelf))]),
      ['*', 48, 52, 60, 68, 55],
    ));
  } else {
    content.push({ text: 'Недостаточно данных', fontSize: 8, color: '#94a3b8', margin: [0, 2, 0, 8] });
  }

  const chains = buildChains(rows);
  content.push(pdfSubsection(`Цепочки направлений (${chains.length})`));
  if (chains.length) {
    content.push(pdfTable(
      ['Цепочка', 'Пациентов', 'Шагов'],
      chains.map(c => [cell(c.name), rCell(fmtN(c.count)), cCell(c.steps)]),
      ['*', 65, 45],
    ));
  } else {
    content.push({ text: 'Цепочки не найдены', fontSize: 8, color: '#94a3b8', margin: [0, 2, 0, 8] });
  }
}

function buildRooms(appointments, rows, doctors, periodStart, periodEnd, content, pageBreak) {
  if (!appointments.length || !periodStart || !periodEnd) return;

  const roomStats = buildRoomStats(appointments, periodStart, periodEnd);
  const gapStats  = buildRoomGapStats(appointments);

  content.push(pdfSection('Кабинеты', pageBreak));

  content.push(pdfSubsection('Загрузка кабинетов (% от рабочего времени)'));
  if (roomStats.length) {
    content.push(pdfHBar(
      roomStats.map(d => ({ name: d.name, sub: d.clinicName, value: d.utilPct, color: d.color })),
      { valueKey: 'value', labelKey: 'name', colorKey: 'color', formatter: v => v.toFixed(1) + '%' },
    ));
  } else {
    content.push({ text: 'Нет данных по кабинетам (поле "кабинет" не заполнено)', fontSize: 8, color: '#94a3b8', margin: [0, 2, 0, 8] });
  }

  content.push(pdfSubsection('Средний интервал между визитами в кабинете'));
  if (gapStats.rooms.length) {
    content.push({ text: `Средний по всем кабинетам: ${fmtMin(gapStats.overallAvg)}`, fontSize: 8, color: '#64748b', margin: [0, 0, 0, 4] });
    content.push(pdfHBar(
      gapStats.rooms.map(d => ({ name: d.name, sub: d.clinicName, value: d.avgGap, color: d.color })),
      { valueKey: 'value', labelKey: 'name', colorKey: 'color', formatter: fmtMin },
    ));
  } else {
    content.push({ text: 'Недостаточно данных (нужны кабинеты с 2+ визитами в один день)', fontSize: 8, color: '#94a3b8', margin: [0, 2, 0, 8] });
  }

  if (rows?.length && doctors?.length) {
    content.push(pdfSubsection('Сотрудники кабинетов — пациентов по дням'));
    buildStaffHeatmapPdf(rows, doctors, periodStart, periodEnd, content);
  }
}

// ── Задолженности (данные из МИС, приходят готовыми в config.debtorsData) ───────
function buildDebtors(data, content, pageBreak) {
  const totals   = data?.totals || {};
  const rows     = Array.isArray(data?.data)      ? data.data      : [];
  const byClinic = Array.isArray(data?.by_clinic) ? data.by_clinic : [];
  const aging    = Array.isArray(data?.aging)     ? data.aging     : [];

  content.push(pdfSection('Задолженности', pageBreak));

  content.push(pdfTable(
    ['Общий долг', 'Физ. лица', 'Юр. лица', 'Должников', 'Счетов'],
    [[
      rCell(fmtRub(totals.debt_total)), rCell(fmtRub(totals.debt_individual)),
      rCell(fmtRub(totals.debt_company)), cCell(fmtN(totals.patients)), cCell(fmtN(totals.invoices)),
    ]],
    ['*', '*', '*', 'auto', 'auto']
  ));

  if (byClinic.length) {
    content.push(pdfSubsection('По медцентрам'));
    content.push(pdfTable(
      ['Медцентр', 'Физ. ₽', 'Юр. ₽', 'Всего ₽', 'Должников'],
      byClinic.map(c => [
        cell(c.clinic), rCell(fmtRub(c.debt_individual)), rCell(fmtRub(c.debt_company)),
        rCell(fmtRub(c.debt_total)), cCell(fmtN(c.patients)),
      ]),
      ['*', 'auto', 'auto', 'auto', 'auto']
    ));
  }

  if (rows.length) {
    const top = rows.slice(0, 15);
    content.push(pdfSubsection(`Крупнейшие задолженности (топ ${top.length} из ${rows.length})`));
    content.push(pdfTable(
      ['№ карты', 'Пациент', 'Физ. ₽', 'Юр. ₽', 'Всего ₽'],
      top.map(r => [
        cell(r.card_number || '—'), cell(r.patient || `ID ${r.patient_id}`),
        rCell(fmtRub(r.debt_individual)), rCell(fmtRub(r.debt_company)), rCell(fmtRub(r.debt_total)),
      ]),
      ['auto', '*', 'auto', 'auto', 'auto']
    ));
  }

  if (aging.some(a => a.debt_total > 0)) {
    content.push(pdfSubsection('Возраст задолженности'));
    content.push(pdfTable(
      ['Возраст', 'Физ. ₽', 'Юр. ₽', 'Всего ₽'],
      aging.map(a => [
        cell(a.bucket), rCell(fmtRub(a.debt_individual)), rCell(fmtRub(a.debt_company)), rCell(fmtRub(a.debt_total)),
      ]),
      ['*', 'auto', 'auto', 'auto']
    ));
  }
}

// ── Репутация (данные приходят готовыми в config.reputationData) ────────────────
function buildReputation(data, content, pageBreak) {
  const totals    = data?.totals || {};
  const boards    = Array.isArray(data?.boards)    ? data.boards    : [];
  const negatives = Array.isArray(data?.negatives) ? data.negatives : [];

  content.push(pdfSection('Репутация', pageBreak));

  content.push(pdfTable(
    ['Всего отзывов', 'Средний рейтинг', 'Отработано', 'В работе'],
    [[
      cCell(fmtN(totals.total)),
      cCell(totals.avgRating != null ? totals.avgRating.toFixed(2) : '—'),
      cCell(fmtN(totals.finalized)), cCell(fmtN(totals.pending)),
    ]],
    ['*', '*', '*', '*']
  ));

  if (boards.length) {
    content.push(pdfSubsection('По площадкам'));
    content.push(pdfTable(
      ['Площадка', 'Отзывов', 'Рейтинг', 'Отработано', 'В работе'],
      boards.map(b => [
        cell(b.name), cCell(fmtN(b.total)),
        cCell(b.avgRating != null ? b.avgRating.toFixed(2) : '—'),
        cCell(fmtN(b.finalized)), cCell(fmtN(b.pending)),
      ]),
      ['*', 'auto', 'auto', 'auto', 'auto']
    ));
  }

  if (negatives.length) {
    const shown = negatives.slice(0, 40);
    content.push(pdfSubsection(`Негативные отзывы (${negatives.length}${negatives.length > shown.length ? `, показаны ${shown.length}` : ''})`));
    content.push(pdfTable(
      ['Дата', 'Площадка', 'Оценка', 'Отзыв'],
      shown.map(n => [
        cCell(n.date || '—'), cell(n.board || '—'), cCell(String(n.rating ?? '—')),
        cell((n.text || '').slice(0, 180)),
      ]),
      ['auto', 'auto', 'auto', '*']
    ));
  }
}

// ── Боты (подписчики Telegram/MAX, данные приходят готовыми в config.botsData) ──
const BOT_PLATFORM = {
  telegram: { label: 'Telegram', color: '#2a78d6' },
  max:      { label: 'MAX',      color: '#7c3aed' },
};
// Секвенциальная палитра экосистемы (голубой → тёмно-синий), как в UI
const CENTERS_RAMP = ['#cfe0f7', '#9dc3ef', '#6ba3e5', '#3d82d6', '#245fac', '#123f7a'];
const centersWord = n => (n === 1 ? 'центр' : n >= 5 ? 'центров' : 'центра');
const shortOrg = name => safeStr(name).replace('Медцентр ', '');
const GRAN_LABEL = { day: 'по дням', week: 'по неделям', month: 'по месяцам' };
const MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const ddmm = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
function fmtBotPeriod(p, gran) {
  if (gran === 'day') { const [, m, d] = p.split('-'); return `${d}.${m}`; }
  if (gran === 'week') {
    const s = new Date(`${p}T00:00:00`); const e = new Date(s); e.setDate(s.getDate() + 6);
    return `${ddmm(s)}-${ddmm(e)}`;
  }
  const [y, mo] = p.split('-'); return `${MONTHS_RU[Number(mo) - 1]} ${y.slice(2)}`;
}

// Стек-гистограмма по медцентрам (Telegram + MAX в одной полосе, как в вебе)
function pdfBotsStackedBar(orgAgg, { labelWidth = 150, barMaxW = BAR_MAX_W } = {}) {
  if (!orgAgg.length) return null;
  const max = Math.max(...orgAgg.map(d => d.total || 0), 1);
  return {
    table: {
      widths: [labelWidth, barMaxW, 60],
      body: orgAgg.map(d => {
        const canvas = []; let x = 0;
        for (const pf of ['telegram', 'max']) {
          const w = (d[pf] / max) * barMaxW;
          if (d[pf] > 0) { canvas.push({ type: 'rect', x, y: 4, w: Math.max(w, 1), h: 9, color: BOT_PLATFORM[pf].color }); x += w; }
        }
        return [
          { text: safeStr(d.name), fontSize: 8, color: '#374151', margin: [0, 2, 4, 2] },
          { canvas, margin: [0, 0, 0, 0] },
          { text: fmtN(d.total), fontSize: 8, color: '#374151', alignment: 'right', margin: [4, 2, 0, 2] },
        ];
      }),
    },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 0 : 0.3,
      vLineWidth: () => 0, hLineColor: () => '#e2e8f0',
      fillColor: (i) => i % 2 === 1 ? '#f8fafc' : null,
      paddingTop: () => 0, paddingBottom: () => 0, paddingLeft: () => 2, paddingRight: () => 2,
    },
    margin: [0, 0, 0, 6],
  };
}

// Легенда каналов
function pdfChannelLegend() {
  return {
    columns: [
      { width: 12, canvas: [{ type: 'rect', x: 0, y: 2, w: 8, h: 8, r: 1, color: BOT_PLATFORM.telegram.color }] },
      { width: 'auto', text: 'Telegram', fontSize: 8, color: '#374151', margin: [2, 1, 14, 0] },
      { width: 12, canvas: [{ type: 'rect', x: 0, y: 2, w: 8, h: 8, r: 1, color: BOT_PLATFORM.max.color }] },
      { width: 'auto', text: 'MAX', fontSize: 8, color: '#374151', margin: [2, 1, 0, 0] },
      { width: '*', text: '' },
    ],
    margin: [0, 0, 0, 6],
  };
}

// Динамика подписок: линии (день/неделя = «график») или столбцы (месяц = «гистограмма»).
// Сам график — SVG (только ASCII-числа внутри), подписи периодов — pdfMake-текст (кириллица безопасна).
function pdfBotsDynamics(periodAgg, gran) {
  const n = periodAgg.length; if (!n) return null;
  const W = 515, H = 150, padL = 30, padR = 8, padT = 8, padB = 6;
  const pw = W - padL - padR, ph = H - padT - padB;
  const isBars = gran === 'month';
  const scale = isBars
    ? Math.max(...periodAgg.map(d => d.total), 1)
    : Math.max(...periodAgg.flatMap(d => [d.telegram, d.max]), 1);
  const y = v => padT + ph - (v / scale) * ph;

  let svg = '';
  svg += `<line x1="${padL}" y1="${padT + ph}" x2="${padL + pw}" y2="${padT + ph}" stroke="#cbd5e1" stroke-width="0.7"/>`;
  svg += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + ph}" stroke="#cbd5e1" stroke-width="0.7"/>`;
  svg += `<text x="${padL - 4}" y="${padT + ph}" text-anchor="end" font-size="7" fill="#94a3b8">0</text>`;
  svg += `<text x="${padL - 4}" y="${padT + 7}" text-anchor="end" font-size="7" fill="#94a3b8">${scale}</text>`;

  if (isBars) {
    const slot = pw / n, bw = Math.min(slot * 0.55, 24);
    periodAgg.forEach((d, i) => {
      const cx = padL + slot * i + slot / 2; let yb = padT + ph;
      for (const pf of ['telegram', 'max']) {
        const h = (d[pf] / scale) * ph;
        if (d[pf] > 0) { svg += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(yb - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${BOT_PLATFORM[pf].color}"/>`; yb -= h; }
      }
    });
    // Месяцы: подписи кириллицей — рендерим pdfMake-текстом под графиком (равные колонки)
    const labels = periodAgg.map(d => ({ text: safeStr(fmtBotPeriod(d.period, gran)), fontSize: 6, alignment: 'center', color: '#64748b' }));
    return {
      stack: [
        { svg: `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`, width: W },
        { columns: labels, columnGap: 0, margin: [padL, 1, padR, 0] },
      ],
      margin: [0, 0, 0, 10],
    };
  }

  // День/неделя: линии + ASCII-подписи (даты) прямо в SVG — точное позиционирование
  const px = i => (n > 1 ? padL + (pw / (n - 1)) * i : padL + pw / 2);
  for (const pf of ['telegram', 'max']) {
    const pts = periodAgg.map((d, i) => `${px(i).toFixed(1)},${y(d[pf]).toFixed(1)}`).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${BOT_PLATFORM[pf].color}" stroke-width="1.5"/>`;
    periodAgg.forEach((d, i) => { svg += `<circle cx="${px(i).toFixed(1)}" cy="${y(d[pf]).toFixed(1)}" r="1.6" fill="${BOT_PLATFORM[pf].color}"/>`; });
  }
  const maxLabels = gran === 'week' ? 9 : 14;
  const step = Math.max(1, Math.ceil(n / maxLabels));
  periodAgg.forEach((d, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    svg += `<text x="${px(i).toFixed(1)}" y="${H - 1}" text-anchor="middle" font-size="6" fill="#64748b">${fmtBotPeriod(d.period, gran)}</text>`;
  });
  return {
    svg: `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
    width: W, margin: [0, 0, 0, 10],
  };
}

// Детализация: тепловая карта период × медцентр (насыщенность = число подписок)
function pdfBotsHeatmap(periodAgg, orgAgg, cellMap, gran, grand) {
  if (!periodAgg.length || !orgAgg.length) return null;
  const maxCell = Math.max(1, ...Object.values(cellMap));
  const hCell = (t, opts = {}) => ({ text: t, fontSize: 7, color: '#374151', ...opts });
  const head = hCell(gran === 'day' ? 'Дата' : gran === 'week' ? 'Период' : 'Месяц', { bold: true, fillColor: '#e2e8f0' });

  const body = [[
    head,
    ...orgAgg.map(o => hCell(shortOrg(o.name), { fontSize: 6.5, bold: true, fillColor: '#e2e8f0', alignment: 'center' })),
    hCell('Итого', { bold: true, fillColor: '#e2e8f0', alignment: 'center' }),
  ]];
  periodAgg.forEach(pr => {
    body.push([
      hCell(safeStr(fmtBotPeriod(pr.period, gran))),
      ...orgAgg.map(o => {
        const v = cellMap[`${pr.period}|${o.key}`] || 0;
        const ratio = v / maxCell;
        return hCell(v ? String(v) : '', { alignment: 'center', fillColor: v ? blendHex('#2a78d6', ratio) : null, color: ratio > 0.55 ? '#fff' : '#374151' });
      }),
      hCell(String(pr.total), { bold: true, alignment: 'center' }),
    ]);
  });
  body.push([
    hCell('Итого', { bold: true }),
    ...orgAgg.map(o => hCell(String(o.total), { bold: true, alignment: 'center' })),
    hCell(String(grand), { bold: true, alignment: 'center' }),
  ]);

  return {
    table: { headerRows: 1, widths: [64, ...orgAgg.map(() => '*'), 34], body },
    layout: {
      hLineWidth: () => 0.3, vLineWidth: () => 0.3, hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0',
      paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 1.5, paddingBottom: () => 1.5,
    },
    margin: [0, 2, 0, 10],
  };
}

function buildBots(data, content, pageBreak) {
  const stats   = data?.stats   || {};
  const overlap = data?.overlap || null;
  const totals  = stats.totals  || {};
  const orgs    = Array.isArray(stats.organizations) ? stats.organizations : [];
  const byPlat  = totals.byPlatform || {};
  const total   = totals.total || 0;

  // Агрегация из строк (период × медцентр × канал)
  const rows = Array.isArray(stats.rows) ? stats.rows : [];
  const gran = stats.granularity || 'month';
  const periods = (stats.periods || []).slice().sort();

  const orgMap = {};
  for (const o of orgs) orgMap[o.key] = { key: o.key, name: o.name, telegram: 0, max: 0, total: 0 };
  const periodMap = {};
  for (const p of periods) periodMap[p] = { period: p, telegram: 0, max: 0, total: 0 };
  const cellMap = {};
  for (const r of rows) {
    if (orgMap[r.organization] && orgMap[r.organization][r.platform] != null) {
      orgMap[r.organization][r.platform] += r.count; orgMap[r.organization].total += r.count;
    }
    if (periodMap[r.period] && periodMap[r.period][r.platform] != null) {
      periodMap[r.period][r.platform] += r.count; periodMap[r.period].total += r.count;
    }
    const k = `${r.period}|${r.organization}`; cellMap[k] = (cellMap[k] || 0) + r.count;
  }
  const orgAgg = Object.values(orgMap).map(o => ({ ...o, name: shortOrg(o.name) }))
    .filter(o => o.total > 0).sort((a, b) => b.total - a.total);
  const periodAgg = periods.map(p => periodMap[p]);

  content.push(pdfSection('Боты', pageBreak));

  // Итог + дельта к предыдущему периоду
  content.push(pdfTable(
    ['Всего подписчиков', 'Telegram', 'MAX'],
    [[ cCell(fmtN(total)), cCell(fmtN(byPlat.telegram)), cCell(fmtN(byPlat.max)) ]],
    ['*', '*', '*']
  ));
  if (data?.prevTotal != null) {
    const diff = total - data.prevTotal;
    const pct  = data.prevTotal > 0 ? Math.round(diff / data.prevTotal * 100) : null;
    const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
    content.push({
      text: `К пред. периоду: ${sign}${fmtN(Math.abs(diff))}${pct != null ? ` (${sign}${Math.abs(pct)}%)` : ''}`,
      fontSize: 8, color: diff < 0 ? '#dc2626' : diff > 0 ? '#16a34a' : '#64748b', margin: [0, 0, 0, 8],
    });
  }

  // Подписчики по медцентрам — стек-гистограмма по каналам
  if (orgAgg.length) {
    content.push(pdfSubsection('Подписчики по медцентрам'));
    content.push(pdfChannelLegend());
    content.push(pdfBotsStackedBar(orgAgg, { labelWidth: 150 }));
  }

  // Экосистема — гистограмма распределения по числу медцентров
  if (overlap && overlap.totalPeople > 0) {
    const dist = Array.isArray(overlap.distribution) ? overlap.distribution : [];
    const multiPct = Math.round(overlap.multiCenter / overlap.totalPeople * 100);
    content.push(pdfSubsection('Экосистема — на сколько медцентров подписан человек'));
    content.push({
      text: `Опознано ${fmtN(overlap.totalPeople)} чел. Пользуются 2+ медцентрами: ${fmtN(overlap.multiCenter)} (${multiPct}%). В среднем ${overlap.avgCenters.toFixed(2)} центра на человека.`,
      fontSize: 8, color: '#64748b', margin: [0, 0, 0, 6],
    });
    const distRows = dist.filter(d => d.subscribers > 0).map(d => ({
      name: `${d.centers} ${centersWord(d.centers)}`,
      value: d.subscribers,
      color: CENTERS_RAMP[d.centers - 1] || CENTERS_RAMP[CENTERS_RAMP.length - 1],
    }));
    content.push(pdfHBar(distRows, {
      valueKey: 'value', labelKey: 'name', colorKey: 'color', labelWidth: 90,
      formatter: v => `${fmtN(v)} · ${(v / overlap.totalPeople * 100).toFixed(0)}%`,
    }));
  }

  // Динамика подписок — график (день/неделя) или гистограмма (месяц)
  if (periodAgg.length) {
    content.push(pdfSubsection(`Динамика подписок ${GRAN_LABEL[gran] || ''}`));
    content.push(pdfChannelLegend());
    content.push(pdfBotsDynamics(periodAgg, gran));
  }

  // Детализация — тепловая карта
  if (periodAgg.length && orgAgg.length) {
    content.push(pdfSubsection('Детализация'));
    content.push(pdfBotsHeatmap(periodAgg, orgAgg, cellMap, gran, total));
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────
// config = {
//   sections:     { general, patients, top20, margin, efficiency, rooms, reputation, debtors, bots }
//   clinicFilter: string
//   specFilter:   string
//   appointments: array   — required for rooms section
//   periodStart:  Date
//   periodEnd:    Date
//   debtorsData:    object — данные /mis/debtors (для раздела Задолженности)
//   reputationData: object — агрегат отзывов (для раздела Репутация)
//   botsData:       object — { stats, overlap, prevTotal } (для раздела Боты)
// }
export function buildKpiPdf(rows, periodLabel, config = {}) {
  const {
    sections     = {},
    clinicFilter = '',
    specFilter   = '',
    appointments = [],
    periodStart  = null,
    periodEnd    = null,
    doctors      = [],
    debtorsData    = null,
    reputationData = null,
    botsData       = null,
  } = config;

  const sec = key => sections[key] !== false; // default: all on

  let filteredRows = rows;
  if (clinicFilter) filteredRows = filteredRows.filter(r => r.clinicRaw === clinicFilter);
  if (specFilter)   filteredRows = filteredRows.filter(r => splitComma(r.executorSpec).includes(specFilter));

  const filterParts = [];
  if (clinicFilter) filterParts.push(`Клиника: ${clinicFilter}`);
  if (specFilter)   filterParts.push(`Спец.: ${specFilter}`);

  const content = [];

  // Title
  content.push({ text: `KPI -- ${periodLabel}`, fontSize: 16, bold: true, margin: [0, 0, 0, 4] });
  if (filterParts.length) {
    content.push({ text: `Фильтр: ${filterParts.join(' | ')}`, fontSize: 9, color: '#64748b', margin: [0, 0, 0, 12] });
  }

  // Track whether first section was pushed (to avoid blank first page)
  let isFirst = true;
  const push = (key, buildFn, ...args) => {
    if (!sec(key)) return;
    buildFn(...args, content, !isFirst);
    isFirst = false;
  };

  push('general',    buildGeneral,    filteredRows);
  push('patients',   buildPatients,   filteredRows);
  push('top20',      buildTop20,      filteredRows);
  push('margin',     buildMargin,     filteredRows);
  push('efficiency', buildEfficiency, filteredRows, { periodStart, periodEnd });
  if (sec('rooms') && appointments.length) {
    buildRooms(appointments, filteredRows, doctors, periodStart, periodEnd, content, !isFirst);
    isFirst = false;
  }
  if (sec('reputation') && reputationData) {
    buildReputation(reputationData, content, !isFirst);
    isFirst = false;
  }
  if (sec('debtors') && debtorsData) {
    buildDebtors(debtorsData, content, !isFirst);
    isFirst = false;
  }
  if (sec('bots') && botsData && ((botsData.stats?.totals?.total || 0) > 0 || (botsData.overlap?.totalPeople || 0) > 0)) {
    buildBots(botsData, content, !isFirst);
    isFirst = false;
  }

  const suffix = [
    clinicFilter ? clinicFilter.replace(/\s+/g, '_') : '',
    specFilter   ? specFilter.replace(/\s+/g, '_')   : '',
  ].filter(Boolean).join('_');

  pdfMake.createPdf({
    pageSize: 'A4',
    pageMargins: [25, 30, 25, 30],
    content: content.filter(Boolean),
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    footer: (page, pages) => ({
      columns: [
        { text: `KPI ${safeStr(periodLabel)}${filterParts.length ? '  |  ' + safeStr(filterParts.join(', ')) : ''}`, fontSize: 7, color: '#94a3b8', margin: [25, 0, 0, 0] },
        { text: `${page} / ${pages}`, fontSize: 7, color: '#94a3b8', alignment: 'right', margin: [0, 0, 25, 0] },
      ],
    }),
  }).download(`KPI_${periodLabel}${suffix ? '_' + suffix : ''}.pdf`);
}
