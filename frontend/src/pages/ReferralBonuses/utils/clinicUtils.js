// ═══════════════════════════════════════
// CLINIC UTILITIES
// Ported verbatim from referral-bonuses.html
// ═══════════════════════════════════════

// Как клинику подписывают в импортируемых Excel. Основной источник — поле
// importAliases в справочнике med_centers: его правят в админке, и новую подпись
// («Забор крови» у Нео) не нужно ждать релизом. Карта ниже осталась фолбэком на
// случай, когда справочник ещё не доехал: страница парсит Excel сразу, а список
// клиник грузится асинхронно, и терять сопоставление из-за гонки нельзя.
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
  'альфа сукко': '11',
  'сукко': '11',
  'нео': '12',
  '3к': '4',
  '3k': '4',
};

// Псевдонимы id: когда в МИС у одной клиники исторически оказывалось два id, их
// сводили к каноническому, чтобы расчёт/настройки/бонусы не двоились.
//
// Сейчас карта пуста, и это не недосмотр. Раньше здесь было '12' → '11': считалось,
// что 12 — второй id того же филиала «Алекс/Сукко». В августе 2026 под id 12 в МИС
// завели самостоятельный пункт забора анализов «Нео», и склейка стала врать —
// сотрудники Нео рисовались чипом Сукко. Справочник med_centers (misClinicIds) —
// единственный источник правды о том, какие id принадлежат одной клинике;
// новые дубли заводятся там, а не здесь.
export const CLINIC_ID_ALIASES = {};

// Приводит любой id клиники к каноническому (учитывает CLINIC_ID_ALIASES).
export function rbCanonicalClinicId(id) {
  const s = String(id);
  return CLINIC_ID_ALIASES[s] || s;
}

export const DEFAULT_CLINICS = [
  { id: 2,    name: 'Альфа',        color: '#de64a1' },
  { id: 3,    name: 'Кидс',         color: '#ed9121' },
  { id: 1,    name: 'Проф',         color: '#9999ff' },
  { id: 6,    name: 'Линия',        color: '#e2d1bb' },
  { id: 4,    name: '3К',           color: '#800080' },
  { id: 7,    name: 'Смайл',        color: '#999999' },
  { id: 8,    name: 'Направители',  color: '#00bfff' },
  { id: 11,   name: 'Сукко',        color: '#2d7055' },
  { id: 12,   name: 'Нео',          color: '#008cb4' },
  { id: 'ip', name: 'ИП Микаелян',  color: '#e05252' },
];

// Нормализует clinic из МИС в id (может быть объект {id,name} или просто число)
export function rbClinicId(c) {
  return rbCanonicalClinicId(typeof c === 'object' ? c.id : c);
}

// Нормализует profession из МИС (может быть объект {title} или строка)
export function rbProfessionTitle(p) {
  return typeof p === 'object' ? (p.title || '') : String(p || '');
}

export function rbGetClinicColor(clinicsOrId, clinicIdOrUndef) {
  const [clinics, clinicId] = clinicIdOrUndef !== undefined
    ? [clinicsOrId, clinicIdOrUndef]
    : [DEFAULT_CLINICS, clinicsOrId];
  if (String(clinicId) === 'aup') return '#111111'; // АУП — чёрный
  if (!Array.isArray(clinics)) return '#94a3b8';
  const c = clinics.find(x => String(x.id) === String(clinicId) || x.name === clinicId);
  return c?.color || '#94a3b8';
}

export function rbGetClinicName(clinicsOrId, clinicIdOrUndef) {
  const [clinics, clinicId] = clinicIdOrUndef !== undefined
    ? [clinicsOrId, clinicIdOrUndef]
    : [DEFAULT_CLINICS, clinicsOrId];
  if (String(clinicId) === 'aup') return 'АУП';
  if (!Array.isArray(clinics)) return String(clinicsOrId);
  const c = clinics.find(x => String(x.id) === String(clinicId) || x.name === clinicId);
  return c?.name || clinicId;
}

// Подписи из справочника: ключ — нормализованная подпись, значение — id клиники в МИС.
// null означает «справочник ещё не подкладывали», и тогда работает CLINIC_EXCEL_MAP.
let RUNTIME_EXCEL_ALIASES = null;

// Excel-подписи приходят из выгрузок 1С и МИС, где хватает неразрывных пробелов и
// двойных пробелов между словами. Сверяем по нормализованной строке, иначе
// «Забор  крови» не совпадёт с «Забор крови».
function normAlias(s) {
  return String(s || '')
    .replace(/\s+/g, ' ') // \s в JS покрывает и \u00A0, так что неразрывный пробел схлопнется тоже
    .trim()
    .toLowerCase();
}

/**
 * Подкладывает подписи клиник из справочника (ответ /mis/clinics).
 * Сверяются name, displayName и importAliases — именно это обещает подпись поля
 * в админке медцентров («Само название и полное название сверяются всегда»).
 */
export function rbSetClinicImportAliases(clinics) {
  if (!Array.isArray(clinics)) return;
  const map = {};
  for (const c of clinics) {
    if (!c || c.id === undefined || c.id === null || c.id === '') continue;
    const id = String(c.id);
    for (const label of [c.name, c.displayName, ...(c.importAliases || [])]) {
      const key = normAlias(label);
      if (key) map[key] = id;
    }
  }
  RUNTIME_EXCEL_ALIASES = map;
}

export function rbMatchClinicId(name) {
  if (!name) return null;
  const key = normAlias(name);
  const id = (RUNTIME_EXCEL_ALIASES && RUNTIME_EXCEL_ALIASES[key]) || CLINIC_EXCEL_MAP[key] || null;
  return id ? rbCanonicalClinicId(id) : null;
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
