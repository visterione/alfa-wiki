/**
 * Shared schedule utilities used by StepSchedule (UI) and reportEngine (calculations).
 */

function pad2(n) { return String(n).padStart(2, '0'); }

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
 * Returns true if the entry is cancelled (has an exception) on the given dateStr (YYYY-MM-DD).
 */
export function isEntryCancelled(entry, dateStr) {
  return (entry.exceptions || []).some(ex =>
    typeof ex === 'string' ? ex === dateStr : ex.date === dateStr
  );
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

  const cidStr = clinicId != null ? String(clinicId) : null;

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
    let dayHadWork = false;

    for (const entry of entries) {
      if (cidStr && String(entry.clinicId) !== cidStr) continue;
      if (!isDayScheduled(entry, year, month, day)) continue;
      if (isEntryCancelled(entry, dateStr)) continue;

      const [fh, fm] = entry.timeFrom.split(':').map(Number);
      const [th, tm] = entry.timeTo.split(':').map(Number);
      let mins = (th * 60 + tm) - (fh * 60 + fm);
      if (mins <= 0) mins += 24 * 60; // overnight shift (e.g. 21:00–06:00)
      if (mins > 0) {
        totalMinutes += mins;
        dayHadWork = true;
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
    if (dayHadWork) scheduledDays++;

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

  const cidStr = clinicId != null ? String(clinicId) : null;
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

      for (const entry of entries) {
        if (cidStr && String(entry.clinicId) !== cidStr) continue;
        if (!isDayScheduled(entry, year, month, day)) continue;
        if (isEntryCancelled(entry, dateStr)) continue;

        const [fh, fm] = entry.timeFrom.split(':').map(Number);
        const [th, tm] = entry.timeTo.split(':').map(Number);
        let mins = (th * 60 + tm) - (fh * 60 + fm);
        if (mins <= 0) mins += 24 * 60;
        if (mins > 0) {
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
    }
    d.setDate(d.getDate() + 1);
  }

  const byRole = {};
  for (const [r, m] of Object.entries(byRoleMinutes)) byRole[r] = m / 60;
  const byCategory = {};
  for (const [c, m] of Object.entries(byCategoryMinutes)) byCategory[c] = m / 60;

  return { byRole, byCategory, categoryRoles };
}
