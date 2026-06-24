/**
 * Проверка названий услуг на соответствие номенклатуре 804н.
 *
 * Идея матчинга (см. обсуждение):
 *  - Сравнение АСИММЕТРИЧНОЕ: все смысловые слова эталона должны присутствовать
 *    в названии услуги. Лишние слова в услуге (ФИО врача, приписки) — не ошибка.
 *  - Поверх покрытия — словарь модификаторов (группы антонимов): подмена
 *    первичный/повторный, левый/правый, с/без контрастирования и т.п. — значимая
 *    ошибка независимо от общего покрытия.
 *  - Числа и римские номера в эталоне должны совпадать (триместр/тип/этап).
 *
 * Эталон = актуальная редакция (поле name). При значимом расхождении делаем добор
 * по редакции 2017 (nameAlt), берём лучший вердикт.
 */

// ── Конфиг (редактируемый) ────────────────────────────────────────────────

// Предлоги/союзы — игнорируются полностью (вес 0).
const STOP_WORDS = new Set([
  'в', 'с', 'и', 'при', 'на', 'к', 'по', 'для', 'или', 'у', 'от', 'до', 'не',
  'а', 'о', 'об', 'из', 'за', 'со', 'во', 'the', 'of'
]);

// Boilerplate приёма врача — низкий вес (МИС часто роняет «(осмотр, консультация)»).
const BOILERPLATE = new Set(['прием', 'осмотр', 'консультация']);
const BOILERPLATE_WEIGHT = 0.3;

// Группы модификаторов: если эталон содержит один член группы, а услуга — другой
// (или ни одного) — значимое расхождение. Каждый член — регэксп по нормализованной строке.
// Регэкспы (а не префиксы токенов), чтобы не ловить ложно «левомицетин» в группе лев/прав
// и чтобы переживать сокращения («первич.»).
const MODIFIER_GROUPS = [
  [/\bперви/, /\bповтор/],
  [/\bверхн/, /\bнижн/],
  [/\bлев(ый|ой|ого|ым|ом|ая|ую|осторонн)/, /\bправ(ый|ой|ого|ым|ом|ая|ую|осторонн)/, /\bодносторонн/, /\bдвусторонн/],
  [/\bвзросл/, /\bдетск/, /\bдетей/, /\bноворожден/],
];

// Контрастирование — особый случай (важно «без» vs «с»).
// Обрабатывается отдельно в hasContrastConflict.

// Порог покрытия для статуса minor/significant.
const COVERAGE_OK = 0.999;   // всё покрыто
const COVERAGE_MINOR = 0.8;  // ниже — significant

// ── Нормализация ──────────────────────────────────────────────────────────

// Кириллические гомоглифы в КОДАХ → латиница (А01→A01, тропонин Т и пр.).
const CODE_CYR2LAT = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X' };

function normalizeCode(code) {
  if (!code) return '';
  return String(code).trim().split('').map(ch => CODE_CYR2LAT[ch] || ch).join('').toUpperCase();
}

function normalizeName(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[()«»".,/\\\-–—:;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Удаляем ФИО врача: «Иванов И.И.», «И.И. Иванов», «Иванов И. И.»
function stripFio(s) {
  return s
    .replace(/[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?/g, ' ')   // Фамилия И.О.
    .replace(/[А-ЯЁ]\.\s*[А-ЯЁ]\.\s*[А-ЯЁ][а-яё]+/g, ' ')    // И.О. Фамилия
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s) {
  return normalizeName(s).split(' ').filter(t => t && !STOP_WORDS.has(t));
}

function tokenWeight(t) {
  return BOILERPLATE.has(t) ? BOILERPLATE_WEIGHT : 1;
}

// Морфологическая близость токена: точное совпадение или общий префикс ≥5 при
// близкой длине (чтобы «дерматолога»≈«дерматолог», но «дерматолог»≠«дерматовенеролог»).
function tokenMatch(a, b) {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  const max = Math.max(a.length, b.length);
  if (min < 5) return false;
  if (max - min > 3) return false; // слишком разная длина — разные слова
  let p = 0;
  while (p < min && a[p] === b[p]) p++;
  return p >= 5 && p >= min - 2;
}

function tokenInList(t, list) {
  for (const x of list) if (tokenMatch(t, x)) return true;
  return false;
}

// ── Проверка модификаторов ────────────────────────────────────────────────

function modifierMember(norm, group) {
  // индекс члена группы, присутствующего в строке (-1 если нет)
  for (let i = 0; i < group.length; i++) {
    if (group[i].test(norm)) return i;
  }
  return -1;
}

function hasModifierConflict(refNorm, svcNorm) {
  for (const group of MODIFIER_GROUPS) {
    const inRef = modifierMember(refNorm, group);
    if (inRef === -1) continue;        // эталон не задаёт этот модификатор — не критично
    const inSvc = modifierMember(svcNorm, group);
    if (inSvc !== inRef) return true;  // у услуги другой член группы или нет его
  }
  return false;
}

function hasContrastConflict(refNorm, svcNorm) {
  const refContrast = /контрастирован/.test(refNorm);
  if (!refContrast) return false;
  const refWithout = /без контрастирован/.test(refNorm);
  const svcContrast = /контрастирован/.test(svcNorm);
  const svcWithout = /без контрастирован/.test(svcNorm);
  if (!svcContrast) return true;            // в услуге вообще нет контраста
  return refWithout !== svcWithout;          // «с» vs «без»
}

// Числа и римские номера эталона должны присутствовать в услуге.
const ROMAN = /\b(i{1,3}|iv|v|vi{0,3}|ix|x)\b/g;
function numbersOf(norm) {
  const arab = (norm.match(/\b\d+\b/g) || []);
  const roman = (norm.match(ROMAN) || []);
  return new Set([...arab, ...roman]);
}
function hasNumberConflict(refNorm, svcNorm) {
  const refNums = numbersOf(refNorm);
  if (!refNums.size) return false;
  const svcNums = numbersOf(svcNorm);
  for (const n of refNums) if (!svcNums.has(n)) return true;
  return false;
}

// ── Вердикт по одной паре (эталон, услуга) ────────────────────────────────

function coverageOf(refTokens, svcTokens) {
  let total = 0, matched = 0;
  for (const t of refTokens) {
    const w = tokenWeight(t);
    total += w;
    if (tokenInList(t, svcTokens)) matched += w;
  }
  return total === 0 ? 1 : matched / total;
}

// Возвращает { status: 'ok'|'minor'|'significant', coverage }
function verdictPair(refName, svcName) {
  const refNorm = normalizeName(refName);
  const svcNorm = normalizeName(stripFio(svcName));
  const refTokens = tokenize(refName);
  const svcTokens = tokenize(stripFio(svcName));

  const conflict = hasModifierConflict(refNorm, svcNorm)
    || hasContrastConflict(refNorm, svcNorm)
    || hasNumberConflict(refNorm, svcNorm);

  const coverage = coverageOf(refTokens, svcTokens);

  let status;
  if (conflict) status = 'significant';
  else if (coverage >= COVERAGE_OK) status = 'ok';
  else if (coverage >= COVERAGE_MINOR) status = 'minor';
  else status = 'significant';

  return { status, coverage };
}

const RANK = { ok: 3, minor: 2, significant: 1 };

/**
 * Классификация услуги относительно справочника.
 * @param {string} subCode  код 804н услуги (partner_service_cache.subCode)
 * @param {string} title    название услуги
 * @param {Map<string,{name,nameAlt,deprecated}>} refMap  справочник по нормализованному коду
 * @returns {{status, refName, refCode, coverage}}
 *   status: 'no_code' | 'not_in_nomenclature' | 'deprecated' | 'ok' | 'minor' | 'significant'
 */
// 804н-код: буква + 2 цифры + минимум два сегмента по 2-3 цифры (A01.01.001…).
const CODE_804N_RE = /[A-Z][0-9]{2}(?:\.[0-9]{2,3}){2,4}/g;

// Извлекает все 804н-коды из поля subCode (там бывает несколько через запятую/пробел).
function extractCodes(subCode) {
  const norm = normalizeCode(subCode);
  return norm ? (norm.match(CODE_804N_RE) || []) : [];
}

// Базовый код справочника для кода-расширения клиники: пробуем обрезать хвост до 4, затем 3 сегментов.
function baseRef(code, refMap) {
  const seg = code.split('.');
  for (let n = Math.min(seg.length - 1, 4); n >= 3; n--) {
    const base = seg.slice(0, n).join('.');
    const ref = refMap.get(base);
    if (ref) return { base, ref };
  }
  return null;
}

// Вердикт по одному коду, который точно есть в справочнике (+ добор по 2017, упразднённость).
function verdictForExact(ref, code, title) {
  let best = verdictPair(ref.name, title || '');
  if (best.status !== 'ok' && ref.nameAlt) {
    const alt = verdictPair(ref.nameAlt, title || '');
    if (RANK[alt.status] > RANK[best.status]) best = alt;
  }
  if (ref.deprecated && best.status !== 'significant') {
    return { status: 'deprecated', refName: ref.name, refCode: code, coverage: best.coverage };
  }
  return { status: best.status, refName: ref.name, refCode: code, coverage: best.coverage };
}

/**
 * Классификация услуги относительно справочника.
 * Статусы:
 *   ok / minor / significant   — название сверено с эталоном по точному коду;
 *   deprecated                 — код упразднён (название при этом ок);
 *   not_in_nomenclature        — одиночный 804н-код, которого нет в справочнике (подозрительно);
 *   extended                   — код-уточнение клиники (базовый код есть, имя не сверяем) — нейтрально;
 *   combined                   — в поле несколько кодов (комбинированная услуга) — нейтрально;
 *   no_code                    — нет кода 804н (внутренний артикул/ID) — нейтрально.
 */
function classify(subCode, title, refMap) {
  const codes = extractCodes(subCode);
  if (codes.length === 0) return { status: 'no_code', refName: null, refCode: null, coverage: null };
  if (codes.length > 1) return { status: 'combined', refName: null, refCode: codes.join(', '), coverage: null };

  const code = codes[0];
  const ref = refMap.get(code);
  if (ref) return verdictForExact(ref, code, title);

  // точного кода нет — может, это уточнение клиники поверх базового кода.
  // Статус оставляем нейтральным (это не ошибка), но считаем покрытие относительно
  // родительского названия — насколько услуга отражает официальный базовый код.
  const base = baseRef(code, refMap);
  if (base) {
    const v = verdictPair(base.ref.name, title || '');
    return { status: 'extended', refName: base.ref.name, refCode: code, coverage: v.coverage };
  }

  return { status: 'not_in_nomenclature', refName: null, refCode: code, coverage: null };
}

// ── Кэш справочника в памяти (грузим один раз, статичные данные) ───────────
let _refMapCache = null;
let _refMapAt = 0;
const REF_TTL_MS = 60 * 60 * 1000; // 1 час

async function getRefMap() {
  if (_refMapCache && Date.now() - _refMapAt < REF_TTL_MS) return _refMapCache;
  const { Nomenclature804n } = require('../models');
  const rows = await Nomenclature804n.findAll({
    attributes: ['code', 'name', 'nameAlt', 'deprecated'],
    raw: true
  });
  const m = new Map();
  for (const r of rows) m.set(r.code, r);
  _refMapCache = m;
  _refMapAt = Date.now();
  return m;
}

function clearRefMapCache() { _refMapCache = null; _refMapAt = 0; }

module.exports = {
  normalizeCode,
  normalizeName,
  classify,
  verdictPair,
  getRefMap,
  clearRefMapCache,
  // экспорт конфигов — на случай тюнинга/тестов
  STOP_WORDS, BOILERPLATE, MODIFIER_GROUPS,
};
