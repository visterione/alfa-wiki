'use strict';

/**
 * Запрос справки для налогового вычета с сайта клиники.
 *
 * Особенность формы — галочка «Налогоплательщик и пациент одно лицо». Когда она
 * стоит, блок с данными пациента на форме не показывается и сюда не приходит.
 * Когда снята — четыре поля блока становятся обязательными, включая файл документа
 * о родстве. Реализовано через requiredIf: отдельная форма и отдельный адрес для
 * второго варианта не нужны, поля общие.
 */

const MB = 1024 * 1024;

/** Пациент указывается отдельно только когда галочка снята */
const patientRequired = (v) => v.taxpayerIsPatient === false;

/** @type {import('../fieldValidator').FieldSpec[]} */
const fields = [
  // Налогоплательщик — заполняется всегда
  { key: 'fullName',  label: 'ФИО',              type: 'string', max: 200, required: true },
  { key: 'phone',     label: 'Мобильный телефон', type: 'phone',  required: true },
  { key: 'email',     label: 'Электронная почта', type: 'email',  required: true },
  { key: 'inn',       label: 'Номер ИНН',         type: 'inn',    required: true },
  { key: 'birthDate', label: 'Дата рождения',     type: 'date',   required: true, notFuture: true },

  { key: 'periodStart', label: 'Начало периода',    type: 'date', required: true },
  { key: 'periodEnd',   label: 'Окончание периода', type: 'date', required: true },

  {
    key: 'taxpayerIsPatient',
    label: 'Налогоплательщик и пациент одно лицо',
    type: 'boolean',
    required: true
  },

  // Блок пациента — только когда галочка снята
  { key: 'patientFullName',  label: 'ФИО пациента',          type: 'string', max: 200, requiredIf: patientRequired },
  { key: 'patientBirthDate', label: 'Дата рождения пациента', type: 'date',   notFuture: true, requiredIf: patientRequired },
  { key: 'relationship',     label: 'Степень родства',        type: 'string', max: 100, requiredIf: patientRequired }
];

/** Файловые поля формы */
const files = [
  {
    key: 'relationshipDocument',
    label: 'Документ, подтверждающий родство с пациентом',
    maxCount: 3,
    maxSizeMb: 5,
    mimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'],
    requiredIf: patientRequired
  }
];

/**
 * Проверки, которым нужны сразу несколько полей.
 * @param {Object} v Нормализованные значения
 * @returns {Object} { ключ: 'ошибка' }
 */
function validateAll(v) {
  const errors = {};

  if (v.periodStart && v.periodEnd && v.periodEnd < v.periodStart) {
    errors.periodEnd = '«Окончание периода» — не может быть раньше начала периода';
  }

  return errors;
}

/**
 * Собирает текст сообщения для группового чата.
 *
 * @param {Object} p Нормализованный payload
 * @param {Object} submission Запись заявки
 * @returns {string}
 */
function formatMessage(p) {
  const S = '   '; // разделитель полей внутри строки (pre-wrap сохраняет пробелы)
  const lines = [];

  lines.push(`*Справка о налоговом вычете (${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}):*`);

  // Налогоплательщик
  lines.push('*Налогоплательщик:*');
  lines.push(`${p.fullName}${S}${formatDate(p.birthDate)}`);
  lines.push(`${p.phone}${S}${p.email}`);
  lines.push(`ИНН: ${p.inn}`);

  // Пациент — только если это другое лицо; документ о родстве уходит вложением
  if (!p.taxpayerIsPatient) {
    lines.push('');
    lines.push('*Пациент:*');
    lines.push(`${p.patientFullName}${S}${formatDate(p.patientBirthDate)}`);
    lines.push(`Степень родства: ${p.relationship}`);
  }

  return lines.join('\n');
}

// ── Форматирование для человека ───────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

module.exports = {
  formType: 'tax-deduction-certificate',
  title: 'Запрос справки для налогового вычета',
  fields,
  files,
  validateAll,
  formatMessage,
  limits: { maxFileMb: 5, maxFiles: 3 }
};
