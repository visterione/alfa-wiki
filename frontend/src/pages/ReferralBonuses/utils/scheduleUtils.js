/**
 * Shared schedule utilities used by StepSchedule (UI) and reportEngine (calculations).
 */
import { rbCanonicalClinicId } from './clinicUtils';

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Rounds a shift duration (in minutes) to the nearest 5 minutes.
 * Avoids "искривлённые" totals from imported times like 8:00–23:59 (959 → 960 min = 16h).
 */
export function roundShiftMinutes(mins) {
  return Math.round(mins / 5) * 5;
}

/**
 * Оплачиваемый короткий перерыв: разбитый рабочий день (напр. 8:00–12:30 + 13:00–17:00)
 * приезжает двумя отдельными сменами, а промежуток между ними по факту оплачивается.
 * Промежуток ≤ этого порога (минут) засчитывается как отработанное время; больший
 * промежуток — это настоящий разрыв дня и не оплачивается.
 */
export const MAX_PAID_BREAK_MIN = 60;

/**
 * Кредитует минуты оплачиваемого короткого перерыва: между соседними сменами одной
 * клиники с промежутком 0 < gap ≤ MAX_PAID_BREAK_MIN промежуток начисляется на более
 * раннюю смену. Мутирует поле `mins` смен. shifts: [{ startMin, endMin, mins, clinic }].
 */
export function applyPaidBreaks(shifts) {
  const byClinic = new Map();
  for (const s of shifts) {
    const key = s.clinic || '';
    if (!byClinic.has(key)) byClinic.set(key, []);
    byClinic.get(key).push(s);
  }
  for (const list of byClinic.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.startMin - b.startMin);
    for (let i = 0; i < list.length - 1; i++) {
      const gap = list[i + 1].startMin - list[i].endMin;
      if (gap > 0 && gap <= MAX_PAID_BREAK_MIN) list[i].mins += roundShiftMinutes(gap);
    }
  }
}

export function formatDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Returns true if the given schedule entry is active on (year, month, day).
 * Mirrors isDayScheduled in StepSchedule.js.
 */
export function isDayScheduled(entry, year, month, day) {
  const d    = new Date(year, month - 1, day);
  const from = parseDate(entry.dateFrom);
  const to   = parseDate(entry.dateTo);
  if (d < from || d > to) return false;

  const { pattern } = entry;
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1; // 0=Mon … 6=Sun

  // Weekday filter: applies to all patterns except 'weekdays' (which already IS the day filter)
  if (pattern.type !== 'weekdays') {
    const allowed = pattern.allowedWeekdays;
    if (allowed && allowed.length > 0 && allowed.length < 7) {
      if (!allowed.includes(dow)) return false;
    }
  }

  switch (pattern.type) {
    case 'daily':    return true;
    case 'workdays': return dow <= 4;
    case 'two_two': {
      const anchor = pattern.phaseAnchor ? parseDate(pattern.phaseAnchor) : from;
      const diff = Math.round((d - anchor) / 86400000);
      return diff % 4 < 2;
    }
    case 'weekdays': return (pattern.weekdays || []).includes(dow);
    case 'even_odd': return pattern.evenOdd === 'even'
      ? d.getDate() % 2 === 0
      : d.getDate() % 2 === 1;
    case 'custom': {
      const anchor = pattern.phaseAnchor ? parseDate(pattern.phaseAnchor) : from;
      const diff  = Math.round((d - anchor) / 86400000);
      const cycle = (pattern.workDays || 1) + (pattern.restDays || 1);
      return diff % cycle < (pattern.workDays || 1);
    }
    default: return false;
  }
}

/**
 * Returns an override exception { date, timeFrom, timeTo } for the given dateStr, or null.
 * Override = смена отработана, но с изменённым (обычно сокращённым) временем.
 */
export function getEntryOverride(entry, dateStr) {
  return (entry.exceptions || []).find(ex =>
    ex && typeof ex === 'object' && ex.date === dateStr && ex.timeFrom && ex.timeTo && !ex.code
  ) || null;
}

/**
 * Returns the effective shift times for the day (override if present, else the planned times).
 */
export function effectiveEntryTimes(entry, dateStr) {
  const ov = getEntryOverride(entry, dateStr);
  return { timeFrom: ov ? ov.timeFrom : entry.timeFrom, timeTo: ov ? ov.timeTo : entry.timeTo };
}

/**
 * Returns true if the entry is fully cancelled on the given dateStr (YYYY-MM-DD).
 * A time-override exception is NOT a cancellation — the shift is still worked.
 */
export function isEntryCancelled(entry, dateStr) {
  return (entry.exceptions || []).some(ex => {
    const matchesDate = typeof ex === 'string' ? ex === dateStr : ex.date === dateStr;
    if (!matchesDate) return false;
    if (ex && typeof ex === 'object' && ex.timeFrom && ex.timeTo && !ex.code) return false; // override
    return true;
  });
}

/**
 * Calculates worked hours from schedule entries for a given period and optional clinic.
 *
 * @param {Array}  entries   - Schedule entries (from doctorSchedules.list API)
 * @param {string} dateFrom  - "YYYY-MM-DD"
 * @param {string} dateTo    - "YYYY-MM-DD"
 * @param {string|number|null} clinicId - filter by clinic; null/undefined = all clinics
 * @returns {{ total: number, days: number, byRole: Object.<string, number>, byCategory: Object.<string, number>, categoryRoles: Object.<string, string> }}
 *   total         — total hours
 *   days          — number of distinct calendar days with any scheduled time
 *   byRole        — hours per roleTitle; key '' covers entries with neither roleTitle nor categoryId
 *   byCategory    — hours per categoryId (category takes priority over roleTitle)
 *   categoryRoles — categoryId → roleTitle map (when entry has both set)
 */
export function calcScheduleHoursForPeriod(entries, dateFrom, dateTo, clinicId) {
  if (!entries || !entries.length || !dateFrom || !dateTo) return { total: 0, byRole: {}, byCategory: {}, categoryRoles: {} };

  const cidStr = clinicId != null ? rbCanonicalClinicId(clinicId) : null;

  const byRoleMinutes     = {};
  const byCategoryMinutes = {};
  const categoryRoles     = {};
  let totalMinutes = 0;
  let scheduledDays = 0;

  const from = new Date(dateFrom + 'T00:00:00');
  const to   = new Date(dateTo   + 'T00:00:00');

  const d = new Date(from);
  while (d <= to) {
    const year    = d.getFullYear();
    const month   = d.getMonth() + 1;
    const day     = d.getDate();
    const dateStr = formatDateStr(d);

    // Собираем смены дня, затем склеиваем короткие оплачиваемые перерывы между ними.
    const dayShifts = [];
    for (const entry of entries) {
      if (cidStr && rbCanonicalClinicId(entry.clinicId) !== cidStr) continue;
      if (!isDayScheduled(entry, year, month, day)) continue;
      if (isEntryCancelled(entry, dateStr)) continue;

      const eff = effectiveEntryTimes(entry, dateStr);
      const [fh, fm] = eff.timeFrom.split(':').map(Number);
      const [th, tm] = eff.timeTo.split(':').map(Number);
      const startMin = fh * 60 + fm;
      let endMin = th * 60 + tm;
      if (endMin <= startMin) endMin += 24 * 60; // overnight shift (e.g. 21:00–06:00)
      const mins = roundShiftMinutes(endMin - startMin);
      if (mins > 0) dayShifts.push({ startMin, endMin, mins, clinic: rbCanonicalClinicId(entry.clinicId), entry });
    }

    if (dayShifts.length) {
      applyPaidBreaks(dayShifts);
      scheduledDays++;
      for (const { mins, entry } of dayShifts) {
        totalMinutes += mins;
        if (entry.categoryId) {
          byCategoryMinutes[entry.categoryId] = (byCategoryMinutes[entry.categoryId] || 0) + mins;
          if (entry.roleTitle) categoryRoles[entry.categoryId] = entry.roleTitle;
        } else if (entry.roleTitle) {
          byRoleMinutes[entry.roleTitle] = (byRoleMinutes[entry.roleTitle] || 0) + mins;
        } else {
          byRoleMinutes[''] = (byRoleMinutes[''] || 0) + mins;
        }
      }
    }

    d.setDate(d.getDate() + 1);
  }

  const byRole = {};
  for (const [role, mins] of Object.entries(byRoleMinutes)) byRole[role] = mins / 60;

  const byCategory = {};
  for (const [cat, mins] of Object.entries(byCategoryMinutes)) byCategory[cat] = mins / 60;

  return { total: totalMinutes / 60, days: scheduledDays, byRole, byCategory, categoryRoles };
}

/**
 * Calculates hours worked ONLY on public holiday dates (used to compute holiday pay surcharge).
 * The surcharge = rate × these hours (on top of the regular pay for those hours).
 *
 * @param {Array}       entries      - Schedule entries
 * @param {string}      dateFrom     - "YYYY-MM-DD"
 * @param {string}      dateTo       - "YYYY-MM-DD"
 * @param {string|null} clinicId     - filter by clinic; null = all clinics
 * @param {Set<string>} holidayDates - set of "YYYY-MM-DD" public holiday date strings
 * @returns {{ byRole: Object.<string, number>, byCategory: Object.<string, number> }}
 */
export function calcHolidayHoursForPeriod(entries, dateFrom, dateTo, clinicId, holidayDates) {
  if (!entries?.length || !dateFrom || !dateTo || !holidayDates?.size) {
    return { byRole: {}, byCategory: {} };
  }

  const cidStr = clinicId != null ? rbCanonicalClinicId(clinicId) : null;
  const byRoleMinutes     = {};
  const byCategoryMinutes = {};
  const categoryRoles     = {};

  const from = new Date(dateFrom + 'T00:00:00');
  const to   = new Date(dateTo   + 'T00:00:00');
  const d    = new Date(from);

  while (d <= to) {
    const dateStr = formatDateStr(d);
    if (holidayDates.has(dateStr)) {
      const year  = d.getFullYear();
      const month = d.getMonth() + 1;
      const day   = d.getDate();

      const dayShifts = [];
      for (const entry of entries) {
        if (cidStr && rbCanonicalClinicId(entry.clinicId) !== cidStr) continue;
        if (!isDayScheduled(entry, year, month, day)) continue;
        if (isEntryCancelled(entry, dateStr)) continue;

        const eff = effectiveEntryTimes(entry, dateStr);
        const [fh, fm] = eff.timeFrom.split(':').map(Number);
        const [th, tm] = eff.timeTo.split(':').map(Number);
        const startMin = fh * 60 + fm;
        let endMin = th * 60 + tm;
        if (endMin <= startMin) endMin += 24 * 60;
        const mins = roundShiftMinutes(endMin - startMin);
        if (mins > 0) dayShifts.push({ startMin, endMin, mins, clinic: rbCanonicalClinicId(entry.clinicId), entry });
      }

      applyPaidBreaks(dayShifts);
      for (const { mins, entry } of dayShifts) {
        if (entry.categoryId) {
          byCategoryMinutes[entry.categoryId] = (byCategoryMinutes[entry.categoryId] || 0) + mins;
          if (entry.roleTitle) categoryRoles[entry.categoryId] = entry.roleTitle;
        } else if (entry.roleTitle) {
          byRoleMinutes[entry.roleTitle] = (byRoleMinutes[entry.roleTitle] || 0) + mins;
        } else {
          byRoleMinutes[''] = (byRoleMinutes[''] || 0) + mins;
        }
      }
    }
    d.setDate(d.getDate() + 1);
  }

  const byRole = {};
  for (const [r, m] of Object.entries(byRoleMinutes)) byRole[r] = m / 60;
  const byCategory = {};
  for (const [c, m] of Object.entries(byCategoryMinutes)) byCategory[c] = m / 60;

  return { byRole, byCategory, categoryRoles };
}
