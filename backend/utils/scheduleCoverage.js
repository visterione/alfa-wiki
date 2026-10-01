'use strict';

/**
 * Покрытие направления расписанием: где и когда по специальности не принимает
 * ни один врач (ver. 9.17).
 *
 * Здесь только арифметика над интервалами — без МИС, базы и часовых поясов,
 * чтобы её можно было проверить тестами на придуманных сменах. Походы в МИС и
 * настройки — в services/scheduleCoverage.js.
 *
 * Как МИС отдаёт расписание (getSchedulePeriods), проверено на октябре 2026:
 * отпуск или отгул не удаляет смену, а ложится поверх неё записью type=3 с тем
 * же временем. Смена type=1 при этом остаётся. Поэтому «врач на месте» — это
 * смены минус отмены, а «врач был бы на месте» — просто смены. Разница между
 * ними и есть ответ на вопрос «дыра из-за отпуска или так спланировано».
 *
 * Причину отмены МИС не называет: cancellation_reason_id приходит null, а
 * справочник getCancellationScheduleReasons пуст. Отличить отпуск от больничного
 * нельзя, и интерфейс говорит просто «отмена».
 *
 * Время — минуты от полуночи, даты — строки YYYY-MM-DD. Смены через полночь в
 * МИС не встречаются (сутки режутся на две записи), но конец «00:00» на всякий
 * случай читается как конец суток, а не как начало.
 */

const DAY_END = 24 * 60;
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// "01.10.2026" → "2026-10-01"
function misDateToIso(value) {
  const m = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// "01.10.2026 08:30" → 510
function misTimeToMin(value) {
  const m = String(value || '').match(/(\d{1,2}):(\d{2})\s*$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// "08:30" → 510
function hhmmToMin(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function minToHhmm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function weekdayKey(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function daysBetween(fromIso, toIso) {
  const out = [];
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  const end = Date.UTC(y2, m2 - 1, d2);
  for (let t = Date.UTC(y1, m1 - 1, d1); t <= end; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// ── Интервалы ────────────────────────────────────────────────────────────────

function union(intervals) {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function subtract(base, cut) {
  let out = union(base);
  for (const [cs, ce] of union(cut)) {
    const next = [];
    for (const [s, e] of out) {
      if (ce <= s || cs >= e) { next.push([s, e]); continue; }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    out = next;
  }
  return out;
}

function intersect(a, b) {
  const out = [];
  for (const [s1, e1] of union(a)) {
    for (const [s2, e2] of union(b)) {
      const s = Math.max(s1, s2);
      const e = Math.min(e1, e2);
      if (e > s) out.push([s, e]);
    }
  }
  return union(out);
}

const total = (intervals) => intervals.reduce((sum, [s, e]) => sum + (e - s), 0);
const overlaps = (intervals, [s, e]) => intervals.some(([a, b]) => a < e && b > s);

/**
 * Разбирает ответ getSchedulePeriods в смены по врачу, дню и медцентру.
 * clinicKeyOf сворачивает clinic_id МИС в медцентр: у Сукко исторически два
 * id, и считать их двумя филиалами значило бы найти «дыру» там, где врач просто
 * записан под соседним номером.
 *
 * @returns Map `${clinicKey}|${date}` → Map userId → { work, cancel }
 */
function groupPeriods(records, clinicKeyOf = (id) => String(id)) {
  const byCell = new Map();
  for (const r of records) {
    const date = misDateToIso(r.date);
    const start = misTimeToMin(r.time_start);
    let end = misTimeToMin(r.time_end);
    if (!date || start == null || end == null) continue;
    if (end <= start || misDateToIso(r.time_end) !== date) end = DAY_END;

    const clinicKey = clinicKeyOf(r.clinic_id);
    if (clinicKey == null) continue;
    const cellKey = `${clinicKey}|${date}`;
    if (!byCell.has(cellKey)) byCell.set(cellKey, new Map());
    const users = byCell.get(cellKey);
    const userId = String(r.user_id);
    if (!users.has(userId)) users.set(userId, { work: [], cancel: [] });
    const lane = users.get(userId);
    if (Number(r.type) === 3) lane.cancel.push([start, end]);
    else if (Number(r.type) === 1) lane.work.push([start, end]);
  }
  for (const users of byCell.values()) {
    for (const lane of users.values()) {
      lane.work = union(lane.work);
      lane.cancel = union(lane.cancel);
      // Отмена имеет смысл только там, где была смена: отмена «в пустоту» ничего
      // не отнимает у приёма и в причины дыры попадать не должна.
      lane.cancelled = intersect(lane.work, lane.cancel);
      lane.effective = subtract(lane.work, lane.cancel);
    }
  }
  return byCell;
}

/**
 * Одна ячейка «медцентр × день»: кто работал, где дыры и почему.
 *
 * lanes — Map userId → lane из groupPeriods (для строки «Вся сеть» — слитые по
 * всем медцентрам). window — часы, в которые направление должно быть покрыто:
 * [from, to] или список таких интервалов. Списком оно приходит в режиме
 * эталона — там «должно быть покрыто» не часы работы медцентра, а смены
 * эталонного врача, и их за день бывает несколько.
 */
function analyzeCell(lanes, window, minGap) {
  const windows = Array.isArray(window[0]) ? union(window) : [window];
  const wFrom = windows[0][0];
  const wTo = windows[windows.length - 1][1];
  const windowLen = total(windows);

  const effectiveAll = [];
  const workAll = [];
  let doctors = 0;
  let cancelledDoctors = 0;
  for (const lane of lanes.values()) {
    const eff = intersect(lane.effective, windows);
    const work = intersect(lane.work, windows);
    if (eff.length) doctors++;
    if (work.length && total(intersect(lane.cancelled, windows)) > 0) cancelledDoctors++;
    effectiveAll.push(...eff);
    workAll.push(...work);
  }

  const covered = union(effectiveAll);
  const planned = union(workAll);

  // Дыры короче порога — это обеды и пересменки, а не отсутствие направления:
  // отмены по 30 минут в середине дня МИС ставит почти каждому врачу.
  const gaps = subtract(windows, covered)
    .filter(([s, e]) => e - s >= minGap)
    .map(([s, e]) => {
      // Кто стоял в графике на это время, но был снят отменой. Если таких нет —
      // дыра заложена самим графиком, а не отпуском.
      const cancelledBy = [];
      for (const [userId, lane] of lanes) {
        if (overlaps(lane.cancelled, [s, e])) cancelledBy.push(userId);
      }
      return {
        from: s,
        to: e,
        minutes: e - s,
        cause: cancelledBy.length ? 'cancel' : 'plan',
        cancelledBy,
        // Сколько минут дыры закрылись бы, не будь отмен
        plannedMinutes: total(intersect(planned, [[s, e]])),
      };
    });

  const uncovered = gaps.reduce((sum, g) => sum + g.minutes, 0);
  let status = 'ok';
  if (uncovered >= windowLen) status = 'none';
  else if (gaps.length) status = 'gap';

  // «Держится на одном враче» — весь день покрыт, но ни минуты не пересеклись
  // двое. Не дыра, но первый кандидат в дыру при любом больничном.
  let single = false;
  if (status === 'ok' && doctors > 0) {
    const events = [];
    for (const [s, e] of effectiveAll) { events.push([s, 1], [e, -1]); }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let depth = 0;
    let maxDepth = 0;
    for (const [, d] of events) { depth += d; maxDepth = Math.max(maxDepth, depth); }
    single = maxDepth <= 1;
  }

  return { status, doctors, cancelledDoctors, uncovered, gaps, single, window: { from: wFrom, to: wTo }, windows };
}

/**
 * Весь отчёт.
 *
 * @param {object} p
 * @param {string[]} p.days            даты периода, YYYY-MM-DD
 * @param {Array}    p.records         getSchedulePeriods только по врачам группы
 * @param {Set}      p.excluded        userId, которых не считаем (служебные
 *                                     «сотрудники» вроде КТГ, совместители)
 * @param {object}   [p.anchor]        режим эталона: { lead: Set, cover: Set } —
 *                                     чьи смены должны быть покрыты и кем
 * @param {Array}    p.clinics         [{ key, name, color }] — медцентры, по которым
 *                                     вообще ищем дыры
 * @param {Function} p.clinicKeyOf     clinic_id МИС → key медцентра
 * @param {Function} p.windowOf        (clinicKey, date) → [from, to] | null (выходной)
 * @param {number}   p.minGap          минимальная длина дыры, минут
 *
 * Режим эталона (ver. 9.20). Сводная группа «флеболог + УЗИ» без него считает
 * дырой любой час, когда нет никого из двух специальностей, и хуже того —
 * часы, когда флеболог не принимает, а УЗИ есть, тоже выглядят покрытыми,
 * хотя вопрос был другой: «когда флеболог отправит пациента на УЗИ, будет ли
 * кому его принять». Связь направленная: УЗИстов много, флеболог один, и
 * обратный вопрос («почему флеболог не закрывает часы УЗИ») смысла не имеет.
 * Поэтому в этом режиме окном служат смены эталонных врачей, а покрывают его
 * только остальные врачи группы.
 */
function buildReport({ days, records, excluded = new Set(), anchor = null, clinics, clinicKeyOf, windowOf, minGap = 60 }) {
  const byCell = groupPeriods(records, clinicKeyOf);

  // Горизонт: после последнего дня, на который у группы вообще заведены смены,
  // пустота значит «расписание ещё не составили», а не «никого нет». Считаем по
  // всей группе вместе с исключёнными — их смены тоже говорят, что график есть.
  // С эталоном — по меньшему из двух горизонтов: если УЗИ на ноябрь ещё не
  // расписано, а флеболог уже да, весь ноябрь иначе стал бы «флеболог один».
  const horizonOf = (only) => {
    let h = null;
    for (const [cellKey, users] of byCell) {
      const date = cellKey.split('|')[1];
      for (const [userId, lane] of users) {
        if (only && !only.has(userId)) continue;
        if (lane.work.length && (!h || date > h)) h = date;
      }
    }
    return h;
  };
  let horizon = horizonOf(null);
  if (anchor) {
    const a = horizonOf(anchor.lead);
    const b = horizonOf(anchor.cover);
    horizon = a && b ? (a < b ? a : b) : null;
  }

  const clinicKeys = new Set(clinics.map(c => c.key));
  const cells = {};
  const lanesOut = {};

  const lanesFor = (clinicKey, date) => {
    const users = byCell.get(`${clinicKey}|${date}`) || new Map();
    const kept = new Map();
    for (const [userId, lane] of users) if (!excluded.has(userId)) kept.set(userId, lane);
    return kept;
  };
  const pick = (lanes, set) => new Map([...lanes].filter(([userId]) => set.has(userId)));
  // Кто закрывает дыры: в обычном режиме — вся группа, с эталоном — остальные
  const coverOf = (lanes) => (anchor ? pick(lanes, anchor.cover) : lanes);
  const leadWindows = (lanes) => union([...pick(lanes, anchor.lead).values()].flatMap(l => l.effective));

  const analyze = (lanes, plainWindow) => {
    if (!anchor) return analyzeCell(lanes, plainWindow, minGap);
    const lead = leadWindows(lanes);
    if (!lead.length) return { status: 'idle' };
    return analyzeCell(coverOf(lanes), lead, minGap);
  };

  for (const clinic of clinics) {
    cells[clinic.key] = {};
    lanesOut[clinic.key] = {};
    for (const date of days) {
      const lanes = lanesFor(clinic.key, date);
      lanesOut[clinic.key][date] = [...lanes].map(([userId, l]) => ({
        userId, work: l.work, cancel: l.cancelled,
      }));
      const window = windowOf(clinic.key, date);
      // С эталоном часы медцентра не нужны: окно задают его смены
      if (!window && !anchor) { cells[clinic.key][date] = { status: 'closed' }; continue; }
      if (!horizon || date > horizon) { cells[clinic.key][date] = { status: 'unplanned', window: window ? { from: window[0], to: window[1] } : null }; continue; }
      cells[clinic.key][date] = analyze(lanes, window);
    }
  }

  // «Вся сеть»: экстренного пациента можно перенаправить в соседний филиал, и
  // день, когда направление закрыто во всех медцентрах сразу, — самый тяжёлый
  // случай. Окно сети — от самого раннего открытия до самого позднего закрытия
  // среди медцентров группы.
  const network = {};
  for (const date of days) {
    const windows = clinics.map(c => windowOf(c.key, date)).filter(Boolean);
    if (!windows.length && !anchor) { network[date] = { status: 'closed' }; continue; }
    const window = windows.length ? [Math.min(...windows.map(w => w[0])), Math.max(...windows.map(w => w[1]))] : null;
    if (!horizon || date > horizon) { network[date] = { status: 'unplanned', window: window ? { from: window[0], to: window[1] } : null }; continue; }
    const merged = new Map();
    for (const clinic of clinics) {
      for (const [userId, lane] of lanesFor(clinic.key, date)) {
        // Один врач в двух филиалах за день — одна дорожка сети
        const prev = merged.get(userId);
        if (!prev) { merged.set(userId, { ...lane }); continue; }
        prev.work = union([...prev.work, ...lane.work]);
        prev.cancelled = union([...prev.cancelled, ...lane.cancelled]);
        prev.effective = union([...prev.effective, ...lane.effective]);
      }
    }
    network[date] = analyze(merged, window);
  }

  // Своё здание важнее соседнего: до другого медцентра пациенту ещё нужно
  // доехать. Поэтому дыра в медцентре остаётся дырой, но у неё помечено, где в
  // эти часы принимают, — и если её целиком закрывают соседи, находка по ней
  // становится на ступень мягче (см. buildFindings).
  if (clinics.length > 1) {
    const coverCache = new Map();
    const coverUnion = (key, date) => {
      const k = `${key}|${date}`;
      if (!coverCache.has(k)) coverCache.set(k, union([...coverOf(lanesFor(key, date)).values()].flatMap(l => l.effective)));
      return coverCache.get(k);
    };
    for (const clinic of clinics) {
      for (const date of days) {
        for (const g of cells[clinic.key][date].gaps || []) {
          const others = [];
          g.elsewhere = [];
          for (const other of clinics) {
            if (other.key === clinic.key) continue;
            const ov = intersect(coverUnion(other.key, date), [[g.from, g.to]]);
            if (!ov.length) continue;
            others.push(...ov);
            g.elsewhere.push({ clinic: other.key, minutes: total(ov) });
          }
          g.elsewhereFull = total(union(others)) >= g.minutes;
        }
      }
    }
  }

  const findings = buildFindings({ days, clinics, cells, network });

  const summary = { noneDays: 0, gapDays: 0, uncovered: 0, byCancelMinutes: 0, byCancelDays: 0, singleDays: 0, networkNoneDays: 0 };
  for (const clinic of clinics) {
    for (const date of days) {
      const c = cells[clinic.key][date];
      if (c.status === 'none') summary.noneDays++;
      if (c.status === 'gap') summary.gapDays++;
      if (c.single) summary.singleDays++;
      if (!c.gaps) continue;
      summary.uncovered += c.uncovered;
      const cancelMin = c.gaps.filter(g => g.cause === 'cancel').reduce((s, g) => s + g.minutes, 0);
      summary.byCancelMinutes += cancelMin;
      if (cancelMin) summary.byCancelDays++;
    }
  }
  for (const date of days) if (network[date].status === 'none') summary.networkNoneDays++;

  return { horizon, mode: anchor ? 'anchor' : 'plain', cells, network, lanes: lanesOut, findings, summary, clinicKeys: [...clinicKeys] };
}

/**
 * Находки — то, ради чего страницу открывают: список «что поправить в графике».
 *
 * Повторяющееся сворачивается. «По воскресеньям в Альфе никого» — это одно
 * решение о графике, и четыре одинаковые строки про каждое воскресенье
 * читатель пролистает не глядя. Так же с вечерами: дыра 20:00–24:00 каждый день
 * — одна находка, а не тридцать одна. Отдельными строками остаются только
 * разовые случаи — как правило, это отпуска и отгулы.
 *
 * Отмены сворачиваются только внутри одного и того же набора людей: регулярная
 * отмена одного врача в одни и те же часы — это фактически его график, а не
 * отпуск. Дни, опустевшие целиком, всегда идут поштучно: у каждого своя причина.
 */
const WEEKDAY_SHARE = 0.75;
const RECURRING_MIN_DAYS = 3;

function buildFindings({ days, clinics, cells, network }) {
  const findings = [];
  const rows = [{ key: 'all', name: 'Вся сеть', data: network }, ...clinics.map(c => ({ key: c.key, name: c.name, data: cells[c.key] }))];

  for (const row of rows) {
    const isNet = row.key === 'all';
    const base = { clinic: row.key, clinicName: row.name };
    const planOnly = (c) => c.gaps && c.gaps.length && c.gaps.every(g => g.cause === 'plan');

    // 1. Дни недели, в которые направления нет «по графику». Порог — три
    // четверти таких дней, а не все: одно случайно закрытое воскресенье из
    // четырёх не делает правило исключением, а находку бы спрятало.
    const byWeekday = {};
    for (const date of days) {
      const c = row.data[date];
      if (c.status === 'closed' || c.status === 'unplanned' || c.status === 'idle') continue;
      const wd = weekdayKey(date);
      if (!byWeekday[wd]) byWeekday[wd] = { open: 0, none: [] };
      byWeekday[wd].open++;
      if (c.status === 'none' && planOnly(c)) byWeekday[wd].none.push(date);
    }
    const weekdays = [];
    const patternDays = new Set();
    for (const wd of WEEKDAY_KEYS) {
      const v = byWeekday[wd];
      if (!v || v.none.length < 2 || v.none.length / v.open < WEEKDAY_SHARE) continue;
      weekdays.push({ weekday: wd, dates: v.none, open: v.open });
      v.none.forEach(d => patternDays.add(d));
    }
    if (weekdays.length) {
      findings.push({ ...base, kind: 'weekday', severity: isNet ? 3 : 2, weekdays, dates: weekdays.flatMap(w => w.dates).sort() });
    }

    // 2. Одна и та же дыра по графику в разные дни — одной строкой
    const recurring = new Map();
    for (const date of days) {
      const c = row.data[date];
      if (!c.gaps || patternDays.has(date) || c.status === 'none') continue;
      for (const g of c.gaps) {
        const who = [...g.cancelledBy].sort().join(',');
        const key = `${g.from}-${g.to}|${who}`;
        if (!recurring.has(key)) recurring.set(key, { from: g.from, to: g.to, cause: g.cause, cancelledBy: g.cancelledBy, dates: [] });
        recurring.get(key).dates.push(date);
      }
    }
    const consumed = new Set();
    for (const [key, r] of recurring) {
      if (r.dates.length < RECURRING_MIN_DAYS) continue;
      findings.push({ ...base, kind: 'recurring', severity: isNet ? 2 : 1, from: r.from, to: r.to, cause: r.cause, cancelledBy: r.cancelledBy, dates: r.dates });
      r.dates.forEach(d => consumed.add(`${d}|${key}`));
    }

    // 3. Разовое — поштучно
    for (const date of days) {
      const c = row.data[date];
      if (!c.gaps || !c.gaps.length || patternDays.has(date)) continue;
      const cancelledBy = [...new Set(c.gaps.flatMap(g => g.cancelledBy))];
      if (c.status === 'none') {
        findings.push({ ...base, kind: 'day', severity: isNet ? 3 : 2, date, dates: [date], cancelledBy, cause: cancelledBy.length ? 'cancel' : 'plan', window: c.window });
        continue;
      }
      const gaps = c.gaps.filter(g => !consumed.has(`${date}|${g.from}-${g.to}|${[...g.cancelledBy].sort().join(',')}`));
      if (!gaps.length) continue;
      findings.push({
        ...base, kind: 'gaps', severity: isNet ? 2 : 1, date, dates: [date],
        cancelledBy: [...new Set(gaps.flatMap(g => g.cancelledBy))],
        gaps: gaps.map(g => ({ from: g.from, to: g.to, cause: g.cause })),
      });
    }
  }

  // Где в часы находки принимают в других медцентрах. Находка, которую
  // целиком закрывают соседи, — на ступень мягче: пациента есть куда
  // отправить, хоть и с дорогой. По сети такой поправки нет — соседей у неё нет.
  for (const f of findings) {
    if (f.clinic === 'all') continue;
    const data = cells[f.clinic];
    const gaps = f.dates.flatMap(d => (data[d].gaps || []).filter(g =>
      f.kind === 'recurring' ? g.from === f.from && g.to === f.to
        : f.kind === 'gaps' ? f.gaps.some(x => x.from === g.from && x.to === g.to)
          : true));
    if (!gaps.length || !gaps.every(g => g.elsewhere)) continue;
    const minutes = {};
    for (const g of gaps) for (const e of g.elsewhere) minutes[e.clinic] = (minutes[e.clinic] || 0) + e.minutes;
    f.elsewhere = Object.keys(minutes).sort((a, b) => minutes[b] - minutes[a]);
    f.elsewhereFull = gaps.every(g => g.elsewhereFull);
    if (f.elsewhereFull) f.severity = Math.max(1, f.severity - 1);
  }

  const kindOrder = { weekday: 0, day: 1, recurring: 2, gaps: 3 };
  findings.sort((a, b) =>
    b.severity - a.severity
    || kindOrder[a.kind] - kindOrder[b.kind]
    || a.dates[0].localeCompare(b.dates[0]));
  return findings;
}

module.exports = {
  DAY_END,
  WEEKDAY_KEYS,
  misDateToIso,
  misTimeToMin,
  hhmmToMin,
  minToHhmm,
  weekdayKey,
  daysBetween,
  union,
  subtract,
  intersect,
  groupPeriods,
  analyzeCell,
  buildReport,
};
