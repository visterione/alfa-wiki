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
  return { revenue, patients, avgCheck: patients ? revenue / patients : 0 };
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
  })).sort((a, b) => b.sumPrice - a.sumPrice);
  const hasCost = services.some(s => s.sumCost > 0);
  const hasCode = services.some(s => s.code);

  content.push(pdfSection('Маржинальность', pageBreak));
  content.push(pdfSubsection('Популярные услуги (по количеству)'));
  content.push(pdfHBar(popular, { valueKey: 'count', labelKey: 'name', defColor: '#8b5cf6', formatter: fmtN }));

  if (hasCost) {
    // Wide table — render on a landscape page so all columns fit
    content.push({
      text: 'Маржинальность услуг',
      fontSize: 10, bold: true, color: '#374151', margin: [0, 10, 0, 3],
      pageBreak: 'before', pageOrientation: 'landscape',
    });
    // Landscape usable width: 841 - 25 - 25 = 791pt
    content.push(pdfTable(
      hasCode
        ? ['Код', 'Услуга', 'Кол-во', 'Стоимость', 'Себестоимость', 'Маржа', 'Марж.%']
        : ['Услуга', 'Кол-во', 'Стоимость', 'Себестоимость', 'Маржа', 'Марж.%'],
      services.map(s => hasCode
        ? [cell(s.code||''), cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price)), rCell(s.cost>0?fmtRub(s.cost):'-'), rCell(fmtRub(s.margin)), rCell(s.cost>0?s.marginPct.toFixed(1)+'%':'-')]
        : [cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price)), rCell(s.cost>0?fmtRub(s.cost):'-'), rCell(fmtRub(s.margin)), rCell(s.cost>0?s.marginPct.toFixed(1)+'%':'-')]),
      hasCode ? [45, '*', 48, 95, 95, 95, 48] : ['*', 48, 95, 95, 95, 48],
    ));
    // Next section's pdfSection() has pageBreak:'before',pageOrientation:'portrait' — auto-restores portrait
  } else {
    content.push(pdfTable(
      hasCode ? ['Код', 'Услуга', 'Кол-во', 'Стоимость'] : ['Услуга', 'Кол-во', 'Стоимость'],
      services.map(s => hasCode
        ? [cell(s.code||''), cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price))]
        : [cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price))]),
      hasCode ? [55, '*', 65, 100] : ['*', 65, 100],
    ));
  }
}

function buildEfficiency(rows, content, pageBreak) {
  content.push(pdfSection('Эффективность', pageBreak));

  const docData = Object.entries(groupBy(rows, r => r.executor || null))
    .map(([name, rs]) => ({ name, color: clinicColor(rs), ...rev_pat(rs) }))
    .filter(d => d.patients > 0).sort((a, b) => b.patients - a.patients);
  content.push(pdfSubsection('Пациентов у врача'));
  content.push(pdfHBar(docData, { valueKey: 'patients', labelKey: 'name', colorKey: 'color', formatter: fmtN }));

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

function buildRooms(appointments, periodStart, periodEnd, content, pageBreak) {
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
}

// ── Public API ─────────────────────────────────────────────────────────────────
// config = {
//   sections:     { general, patients, top20, margin, efficiency, rooms }
//   clinicFilter: string
//   specFilter:   string
//   appointments: array   — required for rooms section
//   periodStart:  Date
//   periodEnd:    Date
// }
export function buildKpiPdf(rows, periodLabel, config = {}) {
  const {
    sections     = {},
    clinicFilter = '',
    specFilter   = '',
    appointments = [],
    periodStart  = null,
    periodEnd    = null,
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
  push('efficiency', buildEfficiency, filteredRows);
  if (sec('rooms') && appointments.length) {
    buildRooms(appointments, periodStart, periodEnd, content, !isFirst);
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
