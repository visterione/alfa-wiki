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

const fmtN   = n => Math.round(n || 0).toLocaleString('ru-RU');
const fmtRub = n => fmtN(n) + ' ₽';

// ── Canvas chart rendering (offscreen — показывает все данные) ─────────────────
function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return { c, ctx };
}
function toPng(canvas) { return canvas.toDataURL('image/png').split(',')[1]; }

function renderDonutAt(ctx, cx, cy, R, segments) {
  const r = R * 0.52;
  const total = segments.reduce((s, d) => s + d.value, 0);
  if (!total) return;
  let angle = -Math.PI / 2;
  for (const seg of segments) {
    const sweep = (seg.value / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    ctx.arc(cx, cy, R, angle, angle + sweep);
    ctx.arc(cx, cy, r, angle + sweep, angle, true);
    ctx.closePath();
    ctx.fillStyle = seg.color || '#94a3b8';
    ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
    if (sweep > 0.2) {
      const mid = angle + sweep / 2;
      ctx.font = 'bold 10px Arial';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((seg.value / total * 100).toFixed(0) + '%',
        cx + (R + r) / 2 * Math.cos(mid), cy + (R + r) / 2 * Math.sin(mid));
    }
    angle += sweep;
  }
}

function renderLegendAt(ctx, lx, startY, segments, maxW, formatter) {
  let y = startY;
  for (const seg of segments) {
    if (y > 1400) break;
    ctx.fillStyle = seg.color || '#94a3b8';
    ctx.fillRect(lx, y, 10, 10);
    ctx.fillStyle = '#374151';
    ctx.font = '11px Arial';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const raw = String(seg.label || ''), mc = Math.floor(maxW / 6.5);
    ctx.fillText(raw.length > mc ? raw.slice(0, mc - 1) + '…' : raw, lx + 14, y + 1);
    ctx.fillStyle = '#64748b'; ctx.font = '10px Arial';
    ctx.fillText(formatter ? formatter(seg.value) : fmtN(seg.value), lx + 14, y + 15);
    y += 30;
  }
}

// Donut chart — показывает все сегменты
function chartDonut(title, segments, formatter, W = 600, H = 320) {
  if (!segments?.length) return null;
  const { c, ctx } = mkCanvas(W, H);
  ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#1e293b';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(title, 12, 10);
  const top = 36, avH = H - top - 12;
  const cx = 130, cy = top + avH / 2, R = Math.min(avH / 2 - 6, 100);
  renderDonutAt(ctx, cx, cy, R, segments);
  renderLegendAt(ctx, cx + R + 20, top + 4, segments, W - cx - R - 30, formatter);
  return toPng(c);
}

// Horizontal bar chart — показывает все данные (без ограничения viewport)
function chartHBar(title, data, valueKey, labelKey, colorKey, defColor, formatter, maxItems = 60) {
  const items = [...data].sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0)).slice(0, maxItems);
  if (!items.length) return null;

  const ROW_H = 22, TOP = 44, LABEL_W = 240, W = 900;
  const BAR_X = LABEL_W + 10, BAR_W = W - BAR_X - 130;
  const H = TOP + items.length * ROW_H + 16;
  const maxVal = Math.max(...items.map(d => d[valueKey] || 0), 1);

  const { c, ctx } = mkCanvas(W, H);
  ctx.font = 'bold 13px Arial'; ctx.fillStyle = '#1e293b';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(title, 12, 12);

  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(LABEL_W, TOP - 2); ctx.lineTo(LABEL_W, H - 14); ctx.stroke();

  for (let i = 0; i < items.length; i++) {
    const d = items[i];
    const y = TOP + i * ROW_H;
    const barH = ROW_H - 5;
    const val = d[valueKey] || 0;
    const fw = Math.max((val / maxVal) * BAR_W, val > 0 ? 2 : 0);
    const color = (colorKey && d[colorKey]) ? d[colorKey] : (defColor || '#4f8ef7');

    if (i % 2 === 1) { ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, y - 1, W, ROW_H); }

    const raw = String(d[labelKey] || ''), mc = Math.floor((LABEL_W - 10) / 6.5);
    ctx.font = '10px Arial'; ctx.fillStyle = '#374151';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(raw.length > mc ? raw.slice(0, mc - 1) + '…' : raw, LABEL_W - 7, y + barH / 2 + 1);

    ctx.fillStyle = '#f1f5f9'; ctx.fillRect(BAR_X, y + 1, BAR_W, barH);
    if (fw > 0) { ctx.globalAlpha = 0.85; ctx.fillStyle = color; ctx.fillRect(BAR_X, y + 1, fw, barH); ctx.globalAlpha = 1; }

    ctx.fillStyle = '#1e293b'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(formatter ? formatter(val) : fmtN(val), BAR_X + fw + 6, y + barH / 2 + 1);
  }
  return toPng(c);
}

// ── PDF helpers ────────────────────────────────────────────────────────────────
// A4 landscape 841pt, margins 30pt each side → usable ≈ 781pt
const PW = 751;

function pdfSection(text) {
  return { text, fontSize: 12, bold: true, color: '#1e3a8a', margin: [0, 14, 0, 4] };
}
function pdfSubsection(text) {
  return { text, fontSize: 10, bold: true, color: '#374151', margin: [0, 8, 0, 3] };
}

function pdfImg(base64, w = PW) {
  if (!base64) return null;
  return { image: 'data:image/png;base64,' + base64, width: w, margin: [0, 4, 0, 8] };
}

const H_FILL = '#d1d5db';
const H_STYLE = { fontSize: 8, bold: true, fillColor: H_FILL, alignment: 'center' };
const D_STYLE = { fontSize: 8 };

function pdfTable(headers, rows, widths) {
  return {
    table: {
      headerRows: 1,
      widths: widths || headers.map(() => '*'),
      body: [
        headers.map(h => ({ text: h, ...H_STYLE })),
        ...rows,
      ],
    },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 10],
  };
}

function cell(text, align = 'left') {
  return { text: String(text ?? ''), ...D_STYLE, alignment: align };
}
function rCell(text) { return cell(text, 'right'); }

// ── Section builders ───────────────────────────────────────────────────────────

function buildGeneral(rows, content) {
  const totalRev = rows.reduce((s, r) => s + r.totalCost, 0);
  const totalPat = new Set(rows.map(getPatientKey).filter(Boolean)).size;

  content.push(pdfSection('Общая статистика'));
  content.push(pdfTable(
    ['Показатель', 'Значение'],
    [
      [cell('Всего строк'),     rCell(rows.length.toLocaleString('ru-RU'))],
      [cell('Уникальных пациентов'), rCell(fmtN(totalPat))],
      [cell('Общая выручка, ₽'),    rCell(fmtRub(totalRev))],
      [cell('Средний чек, ₽'),      rCell(fmtRub(totalPat ? totalRev / totalPat : 0))],
    ],
    [200, '*'],
  ));

  // Org groups
  const orgStats = ORG_GROUPS.map(g => ({
    name: g.label, color: g.color, ...rev_pat(rows.filter(r => getOrgGroup(r)?.key === g.key)),
  }));
  content.push(pdfSubsection('Выручка по организациям'));
  const orgPng = chartHBar('Выручка по организациям', orgStats, 'revenue', 'name', 'color', '#4f8ef7', fmtRub, 10);
  if (orgPng) content.push(pdfImg(orgPng, PW));
  content.push(pdfTable(
    ['Организация', 'Выручка, ₽', 'Пациентов', 'Средний чек, ₽'],
    orgStats.map(d => [cell(d.name), rCell(fmtRub(d.revenue)), rCell(fmtN(d.patients)), rCell(fmtRub(d.avgCheck))]),
    ['*', 100, 80, 110],
  ));

  // Clinics
  const clinicStats = Object.entries(groupBy(rows, r => r.clinicRaw || '—'))
    .map(([name, rs]) => ({ name, color: clinicColor(rs), ...rev_pat(rs) }))
    .sort((a, b) => b.revenue - a.revenue);
  content.push(pdfSubsection('По клиникам'));
  const donutPng = chartDonut(
    `Выручка по клиникам · ${fmtRub(totalRev)}`,
    clinicStats.map(c => ({ label: c.name, value: c.revenue, color: c.color })),
    fmtRub, 700, Math.max(280, clinicStats.length * 32 + 50),
  );
  if (donutPng) content.push(pdfImg(donutPng, 600));
  content.push(pdfTable(
    ['Клиника', 'Выручка, ₽', 'Пациентов', 'Средний чек, ₽'],
    clinicStats.map(d => [cell(d.name), rCell(fmtRub(d.revenue)), rCell(fmtN(d.patients)), rCell(fmtRub(d.avgCheck))]),
    ['*', 100, 80, 110],
  ));

  // Specialty
  const specStats = Object.entries(groupByMulti(rows, r => splitComma(r.executorSpec)))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) })).sort((a, b) => b.patients - a.patients);
  content.push(pdfSubsection('Пациентов по специальностям'));
  const specPng = chartHBar('Пациентов по специальностям', specStats, 'patients', 'name', null, '#8b5cf6', fmtN);
  if (specPng) content.push(pdfImg(specPng));
  content.push(pdfTable(
    ['Специальность', 'Пациентов', 'Выручка, ₽', 'Средний чек, ₽'],
    specStats.map(d => [cell(d.name), rCell(fmtN(d.patients)), rCell(fmtRub(d.revenue)), rCell(fmtRub(d.avgCheck))]),
    ['*', 80, 100, 110],
  ));
}

function buildPatients(rows, content) {
  const patMap   = buildPatientMap(rows);
  const patients = Array.from(patMap.values());
  const lkCount  = patients.filter(p => p.hasLK).length;
  const discRows = rows.filter(r => r.discount > 0);
  const discPat  = new Set(discRows.map(getPatientKey).filter(Boolean)).size;
  const totalDisc  = discRows.reduce((s, r) => s + r.discount, 0);
  const vipDisc    = rows.filter(r => r.isVip && r.discount > 0).reduce((s, r) => s + r.discount, 0);
  const vipDiscPat = new Set(discRows.filter(r => r.isVip).map(getPatientKey).filter(Boolean)).size;

  content.push(pdfSection('Пациенты'));
  content.push(pdfTable(
    ['Показатель', 'Значение'],
    [
      [cell('Всего пациентов'),           rCell(fmtN(patients.length))],
      [cell('С Личным кабинетом'),        rCell(fmtN(lkCount))],
      [cell('Без Личного кабинета'),      rCell(fmtN(patients.length - lkCount))],
      [cell('% пациентов с ЛК'),          rCell((patients.length ? lkCount / patients.length * 100 : 0).toFixed(1) + '%')],
      [cell('Пациентов со скидками'),     rCell(fmtN(discPat))],
      [cell('Из них VIP'),                rCell(fmtN(vipDiscPat))],
      [cell('Скидки VIP, ₽'),             rCell(fmtRub(vipDisc))],
      [cell('Скидки прочих, ₽'),          rCell(fmtRub(totalDisc - vipDisc))],
      [cell('Итого скидок, ₽'),           rCell(fmtRub(totalDisc))],
    ],
    [220, '*'],
  ));

  // LK pie
  const lkSeg = [
    { label: 'С ЛК', value: lkCount, color: '#10b981' },
    { label: 'Без ЛК', value: patients.length - lkCount, color: '#ef4444' },
  ].filter(s => s.value > 0);
  const lkPng = chartDonut(`Личный кабинет (${fmtN(patients.length)} пац.)`, lkSeg, fmtN, 480, 260);
  if (lkPng) content.push(pdfImg(lkPng, 400));

  const avgByDoc = Object.entries(groupBy(rows, r => r.executor || null))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) })).filter(d => d.patients > 0).sort((a, b) => b.avgCheck - a.avgCheck);
  content.push(pdfSubsection('Средний чек по врачам'));
  const docPng = chartHBar('Средний чек по врачам', avgByDoc, 'avgCheck', 'name', null, '#4f8ef7', fmtRub);
  if (docPng) content.push(pdfImg(docPng));
  content.push(pdfTable(
    ['Врач', 'Пациентов', 'Выручка, ₽', 'Средний чек, ₽'],
    avgByDoc.map(d => [cell(d.name), rCell(fmtN(d.patients)), rCell(fmtRub(d.revenue)), rCell(fmtRub(d.avgCheck))]),
    ['*', 80, 100, 110],
  ));

  const avgBySpec = Object.entries(groupByMulti(rows, r => splitComma(r.executorSpec)))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) })).filter(d => d.patients > 0).sort((a, b) => b.avgCheck - a.avgCheck);
  content.push(pdfSubsection('Средний чек по специальностям'));
  const specPng = chartHBar('Средний чек по специальностям', avgBySpec, 'avgCheck', 'name', null, '#8b5cf6', fmtRub);
  if (specPng) content.push(pdfImg(specPng));
  content.push(pdfTable(
    ['Специальность', 'Пациентов', 'Выручка, ₽', 'Средний чек, ₽'],
    avgBySpec.map(d => [cell(d.name), rCell(fmtN(d.patients)), rCell(fmtRub(d.revenue)), rCell(fmtRub(d.avgCheck))]),
    ['*', 80, 100, 110],
  ));

  const avgBySrc = Object.entries(groupBy(rows, r => r.sourceEntry || 'Не указан'))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) })).filter(d => d.patients > 0).sort((a, b) => b.avgCheck - a.avgCheck);
  content.push(pdfSubsection('Средний чек по источнику записи'));
  const srcPng = chartHBar('Средний чек по источнику записи', avgBySrc, 'avgCheck', 'name', null, '#14b8a6', fmtRub);
  if (srcPng) content.push(pdfImg(srcPng));
  content.push(pdfTable(
    ['Источник', 'Пациентов', 'Выручка, ₽', 'Средний чек, ₽'],
    avgBySrc.map(d => [cell(d.name), rCell(fmtN(d.patients)), rCell(fmtRub(d.revenue)), rCell(fmtRub(d.avgCheck))]),
    ['*', 80, 100, 110],
  ));
}

function buildTop20(rows, content) {
  const all   = Array.from(buildPatientMap(rows).values());
  const top20 = top20pct(all);
  content.push(pdfSection(`Топ 20% пациентов (${top20.length} из ${all.length})`));
  content.push(pdfTable(
    ['#', '№ карты', 'ФИО', 'Выручка, ₽', 'VIP', 'ЛК'],
    top20.map((p, i) => [
      rCell(i + 1), cell(p.card || ''), cell(p.name || ''),
      rCell(fmtRub(p.revenue)),
      cell(p.isVip ? 'Да' : '', 'center'), cell(p.hasLK ? 'Да' : '', 'center'),
    ]),
    [24, 70, '*', 100, 30, 30],
  ));
}

function buildMargin(rows, content) {
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
    margin: s.sumPrice - s.sumCost,
  })).sort((a, b) => b.sumPrice - a.sumPrice);
  const hasCost = services.some(s => s.sumCost > 0);
  const hasCode = services.some(s => s.code);

  content.push(pdfSection('Маржинальность'));

  content.push(pdfSubsection('Популярные услуги (по количеству)'));
  const popPng = chartHBar('Популярные услуги', popular, 'count', 'name', null, '#8b5cf6', fmtN);
  if (popPng) content.push(pdfImg(popPng));
  content.push(pdfTable(
    hasCode ? ['Код', 'Услуга', 'Количество'] : ['Услуга', 'Количество'],
    popular.map(s => hasCode
      ? [cell(s.code || ''), cell(s.name), rCell(fmtN(s.count))]
      : [cell(s.name), rCell(fmtN(s.count))]),
    hasCode ? [60, '*', 80] : ['*', 80],
  ));

  if (hasCost) {
    const byMargin = [...services].sort((a, b) => b.margin - a.margin);
    content.push(pdfSubsection('Маржинальность услуг'));
    const mrgPng = chartHBar('Маржа по услугам', byMargin, 'margin', 'name', null, '#10b981', fmtRub);
    if (mrgPng) content.push(pdfImg(mrgPng));
    content.push(pdfTable(
      hasCode ? ['Код', 'Услуга', 'Кол-во', 'Стоимость, ₽', 'Себест., ₽', 'Маржа, ₽'] : ['Услуга', 'Кол-во', 'Стоимость, ₽', 'Себест., ₽', 'Маржа, ₽'],
      services.map(s => (hasCode
        ? [cell(s.code || ''), cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price)), rCell(s.cost > 0 ? fmtRub(s.cost) : '—'), rCell(fmtRub(s.margin))]
        : [cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price)), rCell(s.cost > 0 ? fmtRub(s.cost) : '—'), rCell(fmtRub(s.margin))])),
      hasCode ? [50, '*', 60, 90, 90, 90] : ['*', 60, 90, 90, 90],
    ));
  } else {
    content.push(pdfTable(
      hasCode ? ['Код', 'Услуга', 'Кол-во', 'Стоимость, ₽'] : ['Услуга', 'Кол-во', 'Стоимость, ₽'],
      services.map(s => hasCode
        ? [cell(s.code || ''), cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price))]
        : [cell(s.name), rCell(fmtN(s.count)), rCell(fmtRub(s.price))]),
      hasCode ? [60, '*', 70, 110] : ['*', 70, 110],
    ));
  }
}

function buildDoctorPatients(rows, content) {
  const data = Object.entries(groupBy(rows, r => r.executor || null))
    .map(([name, rs]) => ({ name, ...rev_pat(rs) })).filter(d => d.patients > 0).sort((a, b) => b.patients - a.patients);

  content.push(pdfSection('Пациентов у врача'));
  const png = chartHBar('Пациентов у врача', data, 'patients', 'name', null, '#4f8ef7', fmtN);
  if (png) content.push(pdfImg(png));
  content.push(pdfTable(
    ['Врач', 'Пациентов', 'Выручка, ₽', 'Средний чек, ₽'],
    data.map(d => [cell(d.name), rCell(fmtN(d.patients)), rCell(fmtRub(d.revenue)), rCell(fmtRub(d.avgCheck))]),
    ['*', 80, 100, 110],
  ));
}

function buildReferrals(rows, content) {
  const referrals = buildReferralPairs(rows);
  content.push(pdfSection('Направления'));
  if (!referrals.length) { content.push({ text: 'Данные о направлениях отсутствуют', fontSize: 9, color: '#94a3b8' }); return; }

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
  const refPng = chartHBar('Кто чаще направляет', topRefs, 'count', 'name', null, '#f97316', fmtN);
  if (refPng) content.push(pdfImg(refPng));
  content.push(pdfTable(
    ['Врач', 'Направлений', 'Сумма, ₽'],
    topRefs.map(d => [cell(d.name), rCell(fmtN(d.count)), rCell(fmtRub(d.revenue))]),
    ['*', 90, 110],
  ));

  content.push(pdfSubsection('Кто приносит больше через направления'));
  const revPng = chartHBar('Выручка через направления', topByRev, 'revenue', 'name', null, '#10b981', fmtRub);
  if (revPng) content.push(pdfImg(revPng));
  content.push(pdfTable(
    ['Врач', 'Направлений', 'Сумма, ₽'],
    topByRev.map(d => [cell(d.name), rCell(fmtN(d.count)), rCell(fmtRub(d.revenue))]),
    ['*', 90, 110],
  ));

  content.push(pdfSubsection('Все направления между врачами'));
  content.push(pdfTable(
    ['Рекомендатель', 'Исполнитель', 'Кол-во', 'Сумма, ₽'],
    referrals.map(r => [cell(r.referrer), cell(r.executor), rCell(fmtN(r.count)), rCell(fmtRub(r.revenue))]),
    ['*', '*', 70, 110],
  ));
}

function buildReturnVisitsSection(rows, content) {
  const data = buildReturnVisits_data(rows);
  content.push(pdfSection('Повторные визиты'));
  content.push(pdfTable(
    ['Врач', 'Всего пац.', 'Не вернулся', 'К тому же врачу', 'К другому по направлению', 'К другому самост.'],
    data.map(d => [cell(d.name), rCell(fmtN(d.total)), rCell(fmtN(d.notReturned)), rCell(fmtN(d.sameDoctor)), rCell(fmtN(d.otherReferred)), rCell(fmtN(d.otherSelf))]),
    ['*', 65, 70, 80, 110, 90],
  ));
}

function buildChains_section(rows, content) {
  const chains = buildChains(rows);
  content.push(pdfSection(`Цепочки направлений (${chains.length})`));
  content.push(pdfTable(
    ['Цепочка', 'Пациентов', 'Шагов'],
    chains.map(c => [cell(c.name), rCell(fmtN(c.count)), rCell(c.steps)]),
    ['*', 70, 50],
  ));
}

// Rename to avoid conflict with the data helper
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

// ── Public API ─────────────────────────────────────────────────────────────────
export function buildKpiPdf(rows, periodLabel) {
  const totalRev = rows.reduce((s, r) => s + r.totalCost, 0);
  const totalPat = new Set(rows.map(getPatientKey).filter(Boolean)).size;

  const content = [];

  // Заголовок
  content.push({ text: `KPI — ${periodLabel}`, fontSize: 18, bold: true, margin: [0, 0, 0, 4] });
  content.push({
    text: `Строк: ${rows.length.toLocaleString('ru-RU')} · Пациентов: ${fmtN(totalPat)} · Выручка: ${fmtRub(totalRev)}`,
    fontSize: 10, color: '#64748b', margin: [0, 0, 0, 16],
  });

  buildGeneral(rows, content);
  buildPatients(rows, content);
  buildTop20(rows, content);
  buildMargin(rows, content);
  buildDoctorPatients(rows, content);
  buildReferrals(rows, content);
  buildReturnVisitsSection(rows, content);
  buildChains_section(rows, content);

  // Фильтруем null из content
  const filteredContent = content.filter(Boolean);

  pdfMake.createPdf({
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [30, 30, 30, 30],
    content: filteredContent,
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    footer: (page, pages) => ({
      text: `${page} / ${pages}`, fontSize: 8, color: '#94a3b8',
      alignment: 'right', margin: [0, 0, 30, 0],
    }),
  }).download(`KPI_${periodLabel}.pdf`);
}
