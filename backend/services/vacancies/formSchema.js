'use strict';

/**
 * Анкета как данные: реестр типов полей и проверка схемы, собранной в
 * конструкторе (ver. 8.20).
 *
 * В первом поколении анкета была одна и лежала в коде, поэтому проверять её
 * было нечего — она по определению правильная. Теперь её собирает человек, и
 * между ним и базой должно стоять место, которое скажет «у двух полей
 * одинаковый ключ» до того, как по этой анкете начнут откликаться.
 *
 * Проверка стоит на сервере, а не в редакторе. Редактор тоже подсвечивает
 * ошибки, но это удобство: схема приходит обычным PUT, и починить её обратно
 * после кривого сохранения будет уже нечем.
 *
 * Реестр типов здесь один на всё: по нему редактор рисует список «чем бывает
 * поле», проверка схемы решает, какие настройки полю осмысленны, а публичный
 * контур потом проверяет присланные ответы. Добавление типа — одна строка в
 * FIELD_TYPES плюс отрисовка на фронте; расходиться трём спискам негде.
 */

// ── Типы полей ─────────────────────────────────────────────────────────────
//
// lengthMax — «max» у такого поля означает длину строки, а не величину.
// numeric   — «min»/«max» означают границы значения.
// accept    — поле принимает файлы, и у него есть ограничение по виду.
// external  — значение берётся из внешнего справочника, а не вводится руками.
//
// Типа «филиал» здесь нет намеренно, хотя в первом поколении он был: место
// работы теперь известно из вакансии, по QR-коду которой человек пришёл.
const FIELD_TYPES = {
  text:        { label: 'Текст',                 lengthMax: true },
  textarea:    { label: 'Текст в несколько строк', lengthMax: true },
  number:      { label: 'Число',                 numeric: true },
  date:        { label: 'Дата' },
  phone:       { label: 'Телефон',               lengthMax: true },
  checkbox:    { label: 'Галочка' },
  weekdays:    { label: 'Дни недели' },
  timerange:   { label: 'Интервал времени' },
  professions: { label: 'Специальности из МИС',  external: true },
  file:        { label: 'Файл',                  accept: true },
  files:       { label: 'Несколько файлов',      accept: true }
};

// ── Роли полей ─────────────────────────────────────────────────────────────
//
// Чем поле является для движка. Без ролей заявка по произвольной анкете
// безымянна: движок не знает, какой из тридцати ключей — это ФИО.
//
// Роль ставится только простому полю. В повторяемом блоке значений много, и
// «дата выхода» в третьей строке образования — бессмыслица.
const FIELD_ROLES = {
  fullName: {
    label: 'ФИО',
    hint: 'Подпись заявки в списках, письмах и уведомлениях',
    types: ['text'],
    required: true
  },
  phone: {
    label: 'Телефон',
    hint: 'Чтобы можно было позвонить, не открывая анкету',
    types: ['phone', 'text']
  },
  birthDate: {
    label: 'Дата рождения',
    types: ['date']
  },
  startDate: {
    label: 'Дата выхода на работу',
    hint: 'Точка отсчёта сроков процесса',
    types: ['date']
  },
  professions: {
    label: 'Специальности',
    hint: 'Без них не работают шаги с МИС: по специальности подтягивается прайс',
    types: ['professions']
  }
};

// Ключи лежат строками в заявках и в снимках анкет, поэтому их вид ограничен
// сразу: латиница, цифры и подчёркивание, начиная с буквы. Кириллический ключ
// пережил бы базу, но не первую выгрузку и не первый разбор JSON руками.
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;

const MAX_BLOCKS = 40;
const MAX_FIELDS_PER_BLOCK = 40;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function trimmed(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/**
 * Проверка и нормализация схемы анкеты.
 *
 * Возвращает { errors, form }. Нормализация не косметика: редактор присылает
 * поля с пустыми строками там, где человек ничего не ввёл, и без чистки в базе
 * копились бы `hint: ''` и `max: null`, которые потом надо отличать от
 * осмысленных значений.
 *
 * @param {*} raw то, что прислал редактор
 * @returns {{ errors: string[], form: object }}
 */
function validateForm(raw) {
  const errors = [];
  const source = isPlainObject(raw) ? raw : {};

  const blocksRaw = Array.isArray(source.blocks) ? source.blocks : [];
  if (!blocksRaw.length) errors.push('В анкете нет ни одного блока');
  if (blocksRaw.length > MAX_BLOCKS) errors.push(`Блоков больше ${MAX_BLOCKS} — это не анкета, а опросник`);

  const blocks = [];
  const blockKeys = new Set();
  // Плоские имена: простые поля лежат в ответах под своим ключом, а весь
  // повторяемый блок — под ключом блока. Значит и те и другие делят одно
  // пространство имён, и поле `education` рядом с блоком `education` затёрло бы
  // его при первом же сохранении анкеты.
  const flatKeys = new Map();
  const roles = new Map();

  for (const [index, blockRaw] of blocksRaw.entries()) {
    if (!isPlainObject(blockRaw)) { errors.push(`Блок №${index + 1} испорчен`); continue; }

    const key = trimmed(blockRaw.key, 40);
    const title = trimmed(blockRaw.title, 150);
    const where = title || key || `№${index + 1}`;

    if (!KEY_RE.test(key)) {
      errors.push(`Блок «${where}»: ключ «${key}» не подходит — нужны латиница, цифры и подчёркивание, начиная с буквы`);
      continue;
    }
    if (blockKeys.has(key)) { errors.push(`Ключ блока «${key}» встречается дважды`); continue; }
    blockKeys.add(key);

    if (!title) errors.push(`Блок «${key}»: не заполнено название`);

    const repeat = Boolean(blockRaw.repeat);
    if (repeat) {
      if (flatKeys.has(key)) errors.push(`Ключ «${key}» занят полем — повторяемый блок хранится под своим ключом и затрёт его`);
      flatKeys.set(key, `блок «${where}»`);
    }

    const fieldsRaw = Array.isArray(blockRaw.fields) ? blockRaw.fields : [];
    if (!fieldsRaw.length) errors.push(`Блок «${where}»: нет ни одного поля`);
    if (fieldsRaw.length > MAX_FIELDS_PER_BLOCK) {
      errors.push(`Блок «${where}»: полей больше ${MAX_FIELDS_PER_BLOCK}`);
    }

    const fields = [];
    // Внутри повторяемого блока ключи локальные: `year` в образовании и `year`
    // в конференциях — разные поля, они лежат в разных строках.
    const localKeys = new Set();

    for (const [fieldIndex, fieldRaw] of fieldsRaw.entries()) {
      if (!isPlainObject(fieldRaw)) { errors.push(`Блок «${where}»: поле №${fieldIndex + 1} испорчено`); continue; }

      const fieldKey = trimmed(fieldRaw.key, 40);
      const label = trimmed(fieldRaw.label, 200);
      const fieldWhere = label || fieldKey || `№${fieldIndex + 1}`;

      if (!KEY_RE.test(fieldKey)) {
        errors.push(`Блок «${where}», поле «${fieldWhere}»: ключ «${fieldKey}» не подходит`);
        continue;
      }
      if (!label) errors.push(`Блок «${where}», поле «${fieldKey}»: не заполнена подпись`);

      const type = trimmed(fieldRaw.type, 30);
      const spec = FIELD_TYPES[type];
      if (!spec) {
        errors.push(`Блок «${where}», поле «${fieldWhere}»: неизвестный тип «${type}»`);
        continue;
      }

      if (repeat) {
        if (localKeys.has(fieldKey)) {
          errors.push(`Блок «${where}»: ключ поля «${fieldKey}» встречается дважды`);
          continue;
        }
        localKeys.add(fieldKey);
      } else {
        const taken = flatKeys.get(fieldKey);
        if (taken) {
          errors.push(`Ключ «${fieldKey}» уже занят: ${taken}`);
          continue;
        }
        flatKeys.set(fieldKey, `поле «${fieldWhere}» в блоке «${where}»`);
      }

      const field = { key: fieldKey, label, type };

      const hint = trimmed(fieldRaw.hint, 300);
      if (hint) field.hint = hint;

      if (fieldRaw.required) field.required = true;

      if (spec.numeric || spec.lengthMax) {
        const min = Number(fieldRaw.min);
        const max = Number(fieldRaw.max);
        if (spec.numeric && Number.isFinite(min)) field.min = min;
        if (Number.isFinite(max) && max > 0) field.max = max;
        if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
          errors.push(`Блок «${where}», поле «${fieldWhere}»: минимум больше максимума`);
        }
      }

      if (spec.accept) {
        const accept = trimmed(fieldRaw.accept, 20);
        if (accept === 'image' || accept === 'doc') field.accept = accept;
      }

      // Роль — единственная настройка, которую нельзя проверить в пределах
      // поля: её осмысленность зависит от всего шаблона.
      const role = trimmed(fieldRaw.role, 30);
      if (role) {
        const roleSpec = FIELD_ROLES[role];
        if (!roleSpec) {
          errors.push(`Блок «${where}», поле «${fieldWhere}»: неизвестная роль «${role}»`);
        } else if (repeat) {
          errors.push(`Блок «${where}», поле «${fieldWhere}»: роль нельзя ставить полю в повторяемом блоке — значений у него много`);
        } else if (!roleSpec.types.includes(type)) {
          errors.push(`Роль «${roleSpec.label}» не подходит полю типа «${spec.label}»`);
        } else if (roles.has(role)) {
          errors.push(`Роль «${roleSpec.label}» уже стоит у поля «${roles.get(role)}»`);
        } else {
          roles.set(role, fieldWhere);
          field.role = role;
        }
      }

      fields.push(field);
    }

    const block = { key, title, fields };
    const blockHint = trimmed(blockRaw.hint, 300);
    if (blockHint) block.hint = blockHint;
    if (repeat) block.repeat = true;
    blocks.push(block);
  }

  for (const [role, spec] of Object.entries(FIELD_ROLES)) {
    if (spec.required && !roles.has(role)) {
      errors.push(`В анкете нет поля с ролью «${spec.label}» — без него заявка будет безымянной`);
    }
  }

  // ── Шаги мастера ────────────────────────────────────────────────────────
  //
  // Одним полотном анкета на полтора десятка блоков прокручивается на телефоне
  // минуту, и до конца доходят не все. Каждый блок обязан лежать ровно в одном
  // шаге: блок, не попавший ни в один, человеку просто не показался бы, и
  // обязательное поле в нём сделало бы анкету неотправляемой без единого следа
  // на экране.
  const stepsRaw = Array.isArray(source.steps) ? source.steps : [];
  const steps = [];
  const stepKeys = new Set();
  const placed = new Map();

  for (const [index, stepRaw] of stepsRaw.entries()) {
    if (!isPlainObject(stepRaw)) { errors.push(`Шаг анкеты №${index + 1} испорчен`); continue; }
    const key = trimmed(stepRaw.key, 40);
    const title = trimmed(stepRaw.title, 150);
    if (!KEY_RE.test(key)) { errors.push(`Шаг анкеты «${title || index + 1}»: ключ «${key}» не подходит`); continue; }
    if (stepKeys.has(key)) { errors.push(`Ключ шага анкеты «${key}» встречается дважды`); continue; }
    stepKeys.add(key);
    if (!title) errors.push(`Шаг анкеты «${key}»: не заполнено название`);

    const list = Array.isArray(stepRaw.blocks) ? stepRaw.blocks : [];
    const own = [];
    for (const blockKey of list) {
      if (!blockKeys.has(blockKey)) continue;
      if (placed.has(blockKey)) {
        errors.push(`Блок «${blockKey}» стоит и в шаге «${placed.get(blockKey)}», и в «${title}»`);
        continue;
      }
      placed.set(blockKey, title || key);
      own.push(blockKey);
    }
    if (!own.length) errors.push(`Шаг анкеты «${title || key}»: в нём нет ни одного блока`);

    steps.push({ key, title, blocks: own });
  }

  if (!steps.length) errors.push('У анкеты нет ни одного шага');

  for (const block of blocks) {
    if (!placed.has(block.key)) {
      errors.push(`Блок «${block.title || block.key}» не попал ни в один шаг анкеты — человек его не увидит`);
    }
  }

  const form = { blocks, steps };
  const consentVersion = trimmed(source.consentVersion, 40);
  if (consentVersion) form.consentVersion = consentVersion;

  return { errors, form };
}

/**
 * Плоский список простых полей шаблона — для тех, кому нужна не структура, а
 * «какие вообще есть поля»: проверка ответов, подписи в карточке заявки.
 */
function flatFields(form) {
  const out = [];
  for (const block of form?.blocks || []) {
    if (block.repeat) continue;
    for (const field of block.fields || []) out.push({ ...field, block: block.key });
  }
  return out;
}

/** Ключ поля с указанной ролью, если такое поле в анкете есть. */
function fieldByRole(form, role) {
  return flatFields(form).find(f => f.role === role) || null;
}

/** Подписи всех полей и повторяемых блоков: ключ → человеческое название. */
function labelMap(form) {
  const map = {};
  for (const block of form?.blocks || []) {
    if (block.repeat) { map[block.key] = block.title; continue; }
    for (const field of block.fields || []) map[field.key] = field.label;
  }
  return map;
}

// ── Ответы кандидата ───────────────────────────────────────────────────────

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Проверка и чистка присланных ответов.
 *
 * Два режима. Черновик (`partial: true`) принимается как есть: анкета длинная,
 * её заполняют с телефона в несколько заходов, и требовать полноты на каждом
 * автосохранении бессмысленно — человек просто не смог бы отложить её на
 * середине. Отправка проверяет обязательные поля.
 *
 * Проверяется по снимку анкеты, а не по нынешнему шаблону: заявка отвечает на
 * ту форму, которую человек открыл.
 *
 * Лишние ключи молча выбрасываются. Они появляются штатно — поле убрали из
 * шаблона, пока черновик лежал недописанным, — и ошибкой это не является:
 * ответ на несуществующий вопрос просто никому не нужен.
 *
 * @returns {{ errors: Array<{field: string, message: string}>, values: object }}
 */
function validateAnswers(form, raw, { partial = false } = {}) {
  const errors = [];
  const source = isPlainObject(raw) ? raw : {};
  const values = {};

  const complain = (field, message) => errors.push({ field, message });

  for (const block of form?.blocks || []) {
    if (block.repeat) {
      const rows = Array.isArray(source[block.key]) ? source[block.key] : [];
      const cleaned = [];

      for (const [index, rowRaw] of rows.entries()) {
        if (!isPlainObject(rowRaw)) continue;
        const row = {};
        let filled = false;

        for (const field of block.fields || []) {
          const { value, error } = checkField(field, rowRaw[field.key]);
          if (error) complain(`${block.key}[${index}].${field.key}`, `${block.title}, запись ${index + 1}: ${error}`);
          if (value !== undefined) { row[field.key] = value; filled = true; }
        }

        // Пустая запись — это нажатая и не заполненная кнопка «добавить».
        // Выбрасываем молча: требовать заполнить то, что человек передумал
        // вносить, значит не дать отправить анкету вообще.
        if (!filled) continue;

        if (!partial) {
          for (const field of block.fields || []) {
            if (field.required && row[field.key] === undefined) {
              complain(`${block.key}[${index}].${field.key}`, `${block.title}, запись ${index + 1}: не заполнено «${field.label}»`);
            }
          }
        }
        cleaned.push(row);
      }

      if (cleaned.length) values[block.key] = cleaned;
      continue;
    }

    for (const field of block.fields || []) {
      const { value, error } = checkField(field, source[field.key]);
      if (error) complain(field.key, `${field.label}: ${error}`);
      if (value !== undefined) values[field.key] = value;
      else if (!partial && field.required) {
        complain(field.key, field.type === 'checkbox'
          ? `Нужно согласие: «${field.label}»`
          : `Не заполнено «${field.label}»`);
      }
    }
  }

  return { errors, values };
}

/**
 * Одно значение. Возвращает `{ value }` с приведённым значением либо
 * `{ error }`. Пустое значение — это `{}`: незаполненное поле не ошибка сама по
 * себе, обязательность проверяется выше и только при отправке.
 */
function checkField(field, raw) {
  const spec = FIELD_TYPES[field.type];
  if (!spec) return {};

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'phone': {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) return {};
      const max = field.max || (field.type === 'textarea' ? 4000 : 500);
      if (value.length > max) return { error: `не длиннее ${max} символов` };
      return { value };
    }

    case 'number': {
      if (raw === '' || raw === null || raw === undefined) return {};
      const value = Number(raw);
      if (!Number.isFinite(value)) return { error: 'нужно число' };
      if (field.min !== undefined && value < field.min) return { error: `не меньше ${field.min}` };
      if (field.max !== undefined && value > field.max) return { error: `не больше ${field.max}` };
      return { value };
    }

    case 'date': {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) return {};
      if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) return { error: 'нужна дата' };
      return { value };
    }

    case 'checkbox':
      // Снятая галочка и неотвеченный вопрос — одно и то же: в обоих случаях
      // согласия нет. Храним только проставленные.
      return raw === true ? { value: true } : {};

    case 'weekdays': {
      if (!Array.isArray(raw)) return {};
      const value = [...new Set(raw.map(Number))].filter(d => WEEKDAYS.includes(d)).sort();
      return value.length ? { value } : {};
    }

    case 'timerange': {
      if (!isPlainObject(raw)) return {};
      const from = typeof raw.from === 'string' ? raw.from.trim() : '';
      const to = typeof raw.to === 'string' ? raw.to.trim() : '';
      if (!from && !to) return {};
      if (!TIME_RE.test(from) || !TIME_RE.test(to)) return { error: 'нужно время вида 09:00' };
      if (from >= to) return { error: 'начало должно быть раньше конца' };
      return { value: { from, to } };
    }

    case 'professions': {
      if (!Array.isArray(raw)) return {};
      const value = raw
        .filter(isPlainObject)
        .map(p => ({ id: String(p.id || '').slice(0, 50), name: String(p.name || '').slice(0, 200) }))
        .filter(p => p.id && p.name)
        .slice(0, 20);
      return value.length ? { value } : {};
    }

    // У файловых полей в ответах лежат не сами файлы, а их идентификаторы из
    // vac_files: файл приезжает отдельным запросом, ещё до отправки анкеты.
    case 'file': {
      const value = typeof raw === 'string' ? raw.trim() : '';
      return value ? { value } : {};
    }

    case 'files': {
      if (!Array.isArray(raw)) return {};
      const value = raw.filter(id => typeof id === 'string' && id).slice(0, 20);
      return value.length ? { value } : {};
    }

    default:
      return {};
  }
}

/**
 * Значения полей с ролями — то, что движок кладёт в колонки заявки.
 * Отсутствующая роль даёт undefined: анкета без телефона законна.
 */
function rolesFrom(form, values) {
  const out = {};
  for (const field of flatFields(form)) {
    if (!field.role) continue;
    const value = values[field.key];
    if (value !== undefined) out[field.role] = value;
  }
  return out;
}

/** Ключи всех файловых полей анкеты — для приёма и уборки файлов. */
function fileFields(form) {
  return flatFields(form).filter(f => f.type === 'file' || f.type === 'files');
}

module.exports = {
  FIELD_TYPES,
  FIELD_ROLES,
  KEY_RE,
  validateForm,
  validateAnswers,
  rolesFrom,
  fileFields,
  flatFields,
  fieldByRole,
  labelMap
};
