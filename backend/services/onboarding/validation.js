'use strict';

/**
 * Проверка анкеты по схеме.
 *
 * Две строгости на одну форму. Черновик сохраняется как есть: врач заполняет
 * длинную анкету с телефона в несколько заходов, и требовать полноты на каждом
 * автосохранении бессмысленно. Полная проверка включается один раз — при
 * отправке на согласование.
 */

const schema = require('./formSchema');

const MAX_REPEAT_ROWS = 50;

/** Приводит значение к типу поля. Мусор превращается в null, а не в NaN. */
function coerce(field, raw) {
  if (raw == null || raw === '') return null;

  if (field.type === 'number') {
    const num = Number(String(raw).replace(',', '.'));
    return Number.isFinite(num) ? num : null;
  }
  if (field.type === 'checkbox') {
    return raw === true || raw === 'true' || raw === 1 || raw === '1';
  }
  if (field.type === 'date') {
    const value = String(raw).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  // Дни недели — массив номеров 1..7, где 1 это понедельник. Номерами, а не
  // подписями: расписание по ним строит регистратор, и «пн» против «Пн» против
  // «понедельник» из трёх анкет пришлось бы сводить руками.
  if (field.type === 'weekdays') {
    if (!Array.isArray(raw)) return null;
    const days = [...new Set(raw.map(Number).filter(n => n >= 1 && n <= 7))].sort();
    return days.length ? days : null;
  }

  // Интервал приёма: { from, to } в формате ЧЧ:ММ.
  if (field.type === 'timerange') {
    const time = value => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? String(value) : null);
    const from = time(raw?.from);
    const to = time(raw?.to);
    return from && to ? { from, to } : null;
  }

  // Телефон приводим к 11 цифрам с семёркой: врач вписывает его то с восьмёркой,
  // то со скобками, а сравнивать и звонить нужно по одному виду. Маску рисует
  // форма, в анкете лежат цифры.
  if (field.type === 'phone') {
    let digits = String(raw).replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    if (digits.length === 10) digits = `7${digits}`;
    return digits ? digits.slice(0, 11) : null;
  }

  // В text-полях схлопываем двойные пробелы: ФИО отсюда уезжает в сопоставление
  // с МИС, и «Иванов  Иван» против «Иванов Иван» — это ненайденный сотрудник.
  // Многострочные поля не трогаем: там пробелы несут абзацы.
  const text = field.type === 'textarea'
    ? String(raw).trim()
    : String(raw).trim().replace(/\s+/g, ' ');
  return field.max ? text.slice(0, field.max) : text;
}

/**
 * Нормализует присланное к тому виду, в котором анкета хранится.
 * Всё, чего нет в схеме, отбрасывается: форма публичная, и принимать в JSONB
 * произвольные ключи от анонимного отправителя не стоит.
 */
function sanitize(input = {}) {
  const form = {};

  for (const block of schema.BLOCKS) {
    if (block.repeat) {
      const rows = Array.isArray(input[block.key]) ? input[block.key].slice(0, MAX_REPEAT_ROWS) : [];
      form[block.key] = rows.map(row => {
        const clean = {};
        for (const field of block.fields) clean[field.key] = coerce(field, row?.[field.key]);
        return clean;
      }).filter(row => Object.values(row).some(v => v !== null && v !== false));
      continue;
    }

    for (const field of block.fields) {
      // Файлы и справочники хранятся отдельно от form: файлы — своей таблицей,
      // филиал и специальности — колонками заявки.
      if (['file', 'files', 'medcenter', 'professions'].includes(field.type)) continue;
      if (!(field.key in input)) continue;
      form[field.key] = coerce(field, input[field.key]);
    }
  }

  return form;
}

/**
 * Полная проверка перед отправкой на согласование.
 *
 * @returns {{ ok: boolean, errors: Array<{ field: string, message: string }> }}
 */
function validateForSubmit(app, form, files = []) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  if (!app.medCenterId) add('medCenterId', 'Выберите филиал');
  if (!Array.isArray(app.professions) || !app.professions.length) {
    add('professions', 'Выберите хотя бы одну специальность');
  }

  for (const block of schema.BLOCKS) {
    if (block.repeat) {
      // Образование — единственный повторяемый блок, без которого согласование
      // теряет смысл: главврач проверяет допуск.
      if (block.key === 'education' && !(form.education || []).length) {
        add('education', 'Добавьте хотя бы одну запись об образовании');
      }
      continue;
    }

    // Согласия проверяются ниже по app.consents: в форме это галочки, а
    // значение имеет только зафиксированный факт со временем и версией текста.
    if (block.key === 'consents') continue;

    for (const field of block.fields) {
      if (!field.required) continue;
      if (['medcenter', 'professions'].includes(field.type)) continue;

      if (field.type === 'file') {
        if (!files.some(f => f.kind === schema.FILE_FIELDS[field.key])) {
          add(field.key, `${field.label}: файл не приложен`);
        }
        continue;
      }
      if (field.type === 'files') {
        if (!files.some(f => f.kind === schema.FILE_FIELDS[field.key])) {
          add(field.key, `${field.label}: файлы не приложены`);
        }
        continue;
      }

      const value = form[field.key];
      const empty = value == null
        || value === ''
        || value === false
        || (Array.isArray(value) && !value.length);
      if (empty) add(field.key, `${field.label}: обязательное поле`);

      // Телефон из десяти цифр — это опечатка, а не номер: по такому не позвонят.
      if (field.type === 'phone' && value && String(value).length !== 11) {
        add(field.key, 'Телефон указан не полностью');
      }
    }
  }

  // Сканы диплома — отдельным условием: согласовывать допуск по таблице без
  // документов это формальность, ради которой процесс и затевался.
  if (!files.some(f => f.kind === 'diploma')) {
    add('diploma', 'Приложите скан диплома');
  }

  // Согласия проверяем по факту в заявке, а не по галочке в форме: галочка без
  // зафиксированного времени и версии текста юридически ничего не значит.
  if (!app.consents?.pd?.acceptedAt) add('pd', 'Нужно согласие на обработку персональных данных');
  if (!app.consents?.image?.acceptedAt) add('image', 'Нужно согласие на использование изображения');

  return { ok: errors.length === 0, errors };
}

module.exports = { sanitize, validateForSubmit, coerce, MAX_REPEAT_ROWS };
