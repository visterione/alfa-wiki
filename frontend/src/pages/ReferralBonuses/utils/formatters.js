// ═══════════════════════════════════════
// FORMATTERS
// ported from referral-bonuses.html
// ═══════════════════════════════════════

export function fmtRub(v) {
  return parseFloat(v || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' ₽';
}

export function rbEsc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('ru-RU');
  } catch {
    return dateStr;
  }
}

export function getInitials(name) {
  return String(name || '').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

// Специальность сотрудника как в списке врачей: профессии, а если их нет — роли
export function getDoctorSpecialty(doctor) {
  if (!doctor || typeof doctor === 'string') return '';
  const specialty = (doctor.professions || [])
    .map(p => (typeof p === 'object' ? (p.title || '') : String(p || '')))
    .filter(Boolean)
    .join(', ');
  return specialty || (doctor.roles || []).filter(Boolean).join(', ');
}

const MONTHS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

export function histShortLabel(rec) {
  if (rec.dateFrom) {
    const d = new Date(rec.dateFrom);
    if (!isNaN(d)) return MONTHS[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
  }
  const raw = rec.periodLabel || rec.dateFrom || '';
  const m = raw.match(/(\d{4})-(\d{2})/);
  if (m) return MONTHS[parseInt(m[2]) - 1] + " '" + m[1].slice(2);
  return raw.slice(0, 7) || '?';
}
