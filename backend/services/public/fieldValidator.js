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
 * @property {string}  type      string | enum | date | phone | email | boolean
 * @property {boolean} [required]
 * @property {number}  [max]     Максимальная длина для string
 * @property {Object}  [values]  Для enum: { ключ: 'Человеческая подпись' }
 * @property {boolean} [mustBeTrue] Для boolean: значение обязано быть true
 * @property {boolean} [notFuture]  Для date: дата не может быть в будущем
 */

/**
 * @param {Object} body Тело запроса
 * @param {FieldSpec[]} spec
 * @returns {{ ok: boolean, value?: Object, fields?: Object, unknownFields?: string[] }}
 */
function validate(body, spec) {
  const value = {};
  const fields = {};

  for (const field of spec) {
    const raw = body[field.key];
    const isEmpty = raw === undefined || raw === null || String(raw).trim() === '';

    if (isEmpty) {
      if (field.required) fields[field.key] = `«${field.label}» — обязательное поле`;
      continue;
    }

    const result = normalize(raw, field);
    if (result.error) {
      fields[field.key] = result.error;
    } else {
      value[field.key] = result.value;
    }
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

module.exports = { validate, parseDate };
