// ═══════════════════════════════════════
// CLINIC UTILITIES
// Ported verbatim from referral-bonuses.html
// ═══════════════════════════════════════

export const CLINIC_EXCEL_MAP = {
  'альфа': '2',
  'альфа kids': '3',
  'альфа кидс': '3',
  'кидс': '3',
  'kids': '3',
  'альфа линия': '6',
  'линия': '6',
  'альфа проф': '1',
  'проф': '1',
  'альфа смайл': '7',
  'смайл': '7',
  '3к': '4',
  '3k': '4',
};

export const DEFAULT_CLINICS = [
  { id: 2,    name: 'Альфа',        color: '#de64a1' },
  { id: 3,    name: 'Кидс',         color: '#ed9121' },
  { id: 1,    name: 'Проф',         color: '#9999ff' },
  { id: 6,    name: 'Линия',        color: '#e2d1bb' },
  { id: 4,    name: '3К',           color: '#800080' },
  { id: 7,    name: 'Смайл',        color: '#999999' },
  { id: 8,    name: 'Направители',  color: '#00bfff' },
  { id: 11,   name: 'Сукко',        color: '#2d7055' },
  { id: 'ip', name: 'ИП Микаелян',  color: '#e05252' },
];

// Нормализует clinic из МИС в id (может быть объект {id,name} или просто число)
export function rbClinicId(c) {
  return String(typeof c === 'object' ? c.id : c);
}

// Нормализует profession из МИС (может быть объект {title} или строка)
export function rbProfessionTitle(p) {
  return typeof p === 'object' ? (p.title || '') : String(p || '');
}

export function rbGetClinicColor(clinicsOrId, clinicIdOrUndef) {
  const [clinics, clinicId] = clinicIdOrUndef !== undefined
    ? [clinicsOrId, clinicIdOrUndef]
    : [DEFAULT_CLINICS, clinicsOrId];
  if (!Array.isArray(clinics)) return '#94a3b8';
  const c = clinics.find(x => String(x.id) === String(clinicId) || x.name === clinicId);
  return c?.color || '#94a3b8';
}

export function rbGetClinicName(clinicsOrId, clinicIdOrUndef) {
  const [clinics, clinicId] = clinicIdOrUndef !== undefined
    ? [clinicsOrId, clinicIdOrUndef]
    : [DEFAULT_CLINICS, clinicsOrId];
  if (!Array.isArray(clinics)) return String(clinicsOrId);
  const c = clinics.find(x => String(x.id) === String(clinicId) || x.name === clinicId);
  return c?.name || clinicId;
}

export function rbMatchClinicId(name) {
  if (!name) return null;
  return CLINIC_EXCEL_MAP[String(name).toLowerCase().trim()] || null;
}

// Сравнивает ID кабинета из БД со значением из Excel-колонки «Кабинет».
// Убираем невидимые символы (zero-width space, неразрывный пробел и т.п.)
export function rbCabMatch(storedId, excelVal) {
  const norm = s => String(s || '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200D\u2060\uFEFF]/g, '') // убираем управляющие/невидимые символы
    .replace(/\u00A0/g, ' ') // неразрывный пробел → обычный
    .replace(/\s+/g, ' ')    // схлопываем пробелы
    .trim()
    .toLowerCase();
  const a = norm(storedId);
  const b = norm(excelVal);
  if (storedId && excelVal && a !== b) {
    console.log(`[rbCabMatch] MISMATCH: stored="${storedId}" [${[...String(storedId)].map(c=>c.codePointAt(0).toString(16)).join(',')}] vs excel="${excelVal}" [${[...String(excelVal)].map(c=>c.codePointAt(0).toString(16)).join(',')}]`);
  }
  if (!a || !b) return false;
  return a === b;
}
