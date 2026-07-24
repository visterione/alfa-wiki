'use strict';

/**
 * Валидация и нормализация полей формы по декларативной схеме.
 *
 * Общий движок для всех форм публичного API: форма описывает поля (см.
 * services/public/forms/*.js), движок проверяет и приводит значения к единому виду.
 *
 * На входе терпимы (принимаем и «12.03.1985», и «1985-03-12», и «мужской», и «male»),
 * в базу кладём строго нормализованное значение.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * @typedef {Object} FieldSpec
 * @property {string}  key       Ключ в JSON запроса
 * @property {string}  label     Человеческое название (для сообщений об ошибках и чата)
 * @property {string}  type      string | enum | date | phone | email | boolean | inn
 * @property {boolean} [required]
 * @property {Function} [requiredIf] (value) => boolean — поле обязательно только при этом
 *   условии. Когда условие не выполнено, поле считается неприменимым и в payload не
 *   попадает, даже если его прислали. Так работает блок, скрытый галочкой на форме.
 * @property {number}  [max]     Максимальная длина для string
 * @property {Object}  [values]  Для enum: { ключ: 'Человеческая подпись' }
 * @property {boolean} [mustBeTrue] Для boolean: значение обязано быть true
 * @property {boolean} [notFuture]  Для date: дата не может быть в будущем
 */

/**
 * @param {Object} body Тело запроса
 * @param {FieldSpec[]} spec
 * @param {Function} [validateAll] (value) => { ключ: 'ошибка' } — проверки, которым
 *   нужны сразу несколько полей (например, окончание периода не раньше начала)
 * @returns {{ ok: boolean, value?: Object, fields?: Object, unknownFields?: string[] }}
 */
function validate(body, spec, validateAll) {
  const value = {};
  const fields = {};
  const missing = [];

  // Проход 1: разбираем всё, что прислали. Условия обязательности проверяем позже —
  // им нужны уже разобранные значения (галочка «пациент и налогоплательщик — одно лицо»).
  for (const field of spec) {
    const raw = body[field.key];
    const isEmpty = raw === undefined || raw === null || String(raw).trim() === '';

    if (isEmpty) {
      missing.push(field);
      continue;
    }

    const result = normalize(raw, field);
    if (result.error) {
      fields[field.key] = result.error;
    } else {
      value[field.key] = result.value;
    }
  }

  // Проход 2: неприменимые поля выбрасываем, недостающие обязательные — в ошибки
  for (const field of spec) {
    if (field.requiredIf && !field.requiredIf(value)) {
      delete value[field.key];
      delete fields[field.key];
      continue;
    }
    if (!missing.includes(field)) continue;
    if (field.required || (field.requiredIf && field.requiredIf(value))) {
      fields[field.key] = `«${field.label}» — обязательное поле`;
    }
  }

  // Проход 3: проверки по нескольким полям — только если сами поля уже корректны
  if (validateAll && Object.keys(fields).length === 0) {
    Object.assign(fields, validateAll(value) || {});
  }

  const knownKeys = new Set(spec.map(f => f.key));
  const unknownFields = Object.keys(body || {}).filter(k => !knownKeys.has(k));

  if (Object.keys(fields).length > 0) {
    return { ok: false, fields, unknownFields };
  }
  return { ok: true, value, unknownFields };
}

/**
 * Приводит одно значение к нормализованному виду.
 * @returns {{ value: any }|{ error: string }}
 */
function normalize(raw, field) {
  switch (field.type) {
    case 'string': {
      const str = String(raw).trim().replace(/\s+/g, ' ');
      if (field.max && str.length > field.max) {
        return { error: `«${field.label}» — не длиннее ${field.max} символов` };
      }
      return { value: str };
    }

    case 'enum': {
      const str = String(raw).trim().toLowerCase();
      // Принимаем и код ('male'), и русскую подпись ('мужской')
      for (const [code, label] of Object.entries(field.values)) {
        if (code.toLowerCase() === str || label.toLowerCase() === str) {
          return { value: code };
        }
      }
      const allowed = Object.keys(field.values).join(', ');
      return { error: `«${field.label}» — допустимые значения: ${allowed}` };
    }

    case 'date': {
      const iso = parseDate(String(raw).trim());
      if (!iso) {
        return { error: `«${field.label}» — дата в формате ГГГГ-ММ-ДД или ДД.ММ.ГГГГ` };
      }
      if (field.notFuture && iso > todayIso()) {
        return { error: `«${field.label}» — дата не может быть в будущем` };
      }
      if (iso < '1900-01-01') {
        return { error: `«${field.label}» — дата раньше 1900 года` };
      }
      return { value: iso };
    }

    case 'phone': {
      const digits = String(raw).replace(/\D/g, '');
      let normalized = null;
      if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
        normalized = '+7' + digits.slice(1);
      } else if (digits.length === 10) {
        normalized = '+7' + digits;
      }
      if (!normalized) {
        return { error: `«${field.label}» — телефон в формате +7XXXXXXXXXX` };
      }
      return { value: normalized };
    }

    case 'email': {
      const str = String(raw).trim().toLowerCase();
      if (!EMAIL_RE.test(str) || str.length > 254) {
        return { error: `«${field.label}» — некорректный email` };
      }
      return { value: str };
    }

    case 'inn': {
      const digits = String(raw).replace(/\D/g, '');
      if (![10, 12].includes(digits.length)) {
        return { error: `«${field.label}» — ИНН состоит из 12 цифр` };
      }
      if (!isValidInn(digits)) {
        return { error: `«${field.label}» — контрольная сумма ИНН не сходится, проверьте цифры` };
      }
      return { value: digits };
    }

    case 'boolean': {
      const str = String(raw).trim().toLowerCase();
      const isTrue = ['true', '1', 'on', 'yes', 'да'].includes(str);
      if (field.mustBeTrue && !isTrue) {
        return { error: `«${field.label}» — требуется согласие` };
      }
      return { value: isTrue };
    }

    default:
      return { error: `«${field.label}» — неизвестный тип поля` };
  }
}

/**
 * Разбирает ГГГГ-ММ-ДД и ДД.ММ.ГГГГ, проверяя существование даты.
 * @returns {string|null} ISO-дата YYYY-MM-DD
 */
function parseDate(str) {
  let y, m, d;

  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const ru = str.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);

  if (iso) {
    [, y, m, d] = iso;
  } else if (ru) {
    [, d, m, y] = ru;
  } else {
    return null;
  }

  y = Number(y); m = Number(m); d = Number(d);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Отсекает 31.02 и подобное: Date молча переносит на следующий месяц
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }

  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Контрольная сумма ИНН по алгоритму ФНС: ловит опечатку в цифре ещё на форме,
 * а не когда человек уже ждёт справку.
 * @param {string} digits Только цифры, 10 или 12 символов
 */
function isValidInn(digits) {
  const d = digits.split('').map(Number);
  const checksum = (weights) =>
    (weights.reduce((sum, w, i) => sum + w * d[i], 0) % 11) % 10;

  if (d.length === 10) {
    return checksum([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  }
  return checksum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10]
      && checksum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
}

module.exports = { validate, parseDate, isValidInn };
