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

  switch (pattern.type) {
    case 'daily':    return true;
    case 'workdays': return dow <= 4;
    case 'two_two': {
      const diff = Math.round((d - from) / 86400000);
      return diff % 4 < 2;
    }
    case 'weekdays': return (pattern.weekdays || []).includes(dow);
    case 'even_odd': return pattern.evenOdd === 'even'
      ? d.getDate() % 2 === 0
      : d.getDate() % 2 === 1;
    case 'custom': {
      const diff  = Math.round((d - from) / 86400000);
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
 * Calculates total worked hours from schedule entries for a given period and optional clinic.
 *
 * @param {Array}  entries   - Schedule entries (from doctorSchedules.list API)
 * @param {string} dateFrom  - "YYYY-MM-DD"
 * @param {string} dateTo    - "YYYY-MM-DD"
 * @param {string|number|null} clinicId - filter by clinic; null/undefined = all clinics
 * @returns {number} Total hours (float)
 */
export function calcScheduleHoursForPeriod(entries, dateFrom, dateTo, clinicId) {
  if (!entries || !entries.length || !dateFrom || !dateTo) return 0;

  const cidStr = clinicId != null ? String(clinicId) : null;

  let totalMinutes = 0;

  const from = new Date(dateFrom + 'T00:00:00');
  const to   = new Date(dateTo   + 'T00:00:00');

  const d = new Date(from);
  while (d <= to) {
    const year    = d.getFullYear();
    const month   = d.getMonth() + 1;
    const day     = d.getDate();
    const dateStr = formatDateStr(d);

    for (const entry of entries) {
      if (cidStr && String(entry.clinicId) !== cidStr) continue;
      if (!isDayScheduled(entry, year, month, day)) continue;
      if (isEntryCancelled(entry, dateStr)) continue;

      const [fh, fm] = entry.timeFrom.split(':').map(Number);
      const [th, tm] = entry.timeTo.split(':').map(Number);
      const mins = (th * 60 + tm) - (fh * 60 + fm);
      if (mins > 0) totalMinutes += mins;
    }

    d.setDate(d.getDate() + 1);
  }

  return totalMinutes / 60;
}
