'use strict';

/**
 * Форма регистрации пациента с сайта клиники.
 *
 * Поля описываются декларативно — движок проверки в services/public/fieldValidator.js.
 * Чтобы добавить новую форму: создать такой же файл рядом и зарегистрировать его
 * в services/public/formRegistry.js.
 */

const GENDER = {
  male:   'мужской',
  female: 'женский'
};

const MARITAL_STATUS = {
  single:   'Не женат / Не замужем',
  married:  'Женат / Замужем',
  divorced: 'В разводе',
  widowed:  'Вдовец / Вдова'
};

const DOCUMENT_TYPE = {
  passport_rf:         'Паспорт РФ',
  passport_foreign_rf: 'Загранпаспорт РФ',
  birth_certificate:   'Свидетельство о рождении',
  residence_permit:    'Вид на жительство',
  foreign_passport:    'Иностранный паспорт'
};

/** @type {import('../fieldValidator').FieldSpec[]} */
const fields = [
  { key: 'lastName',   label: 'Фамилия',  type: 'string', max: 100, required: true },
  { key: 'firstName',  label: 'Имя',      type: 'string', max: 100, required: true },
  { key: 'middleName', label: 'Отчество', type: 'string', max: 100 },

  { key: 'gender',        label: 'Пол',                 type: 'enum', values: GENDER },
  { key: 'birthDate',     label: 'Дата рождения',       type: 'date', required: true, notFuture: true },
  { key: 'maritalStatus', label: 'Семейное положение',  type: 'enum', values: MARITAL_STATUS },

  { key: 'documentType',           label: 'Документ',          type: 'enum',   values: DOCUMENT_TYPE },
  { key: 'documentSeries',         label: 'Серия',             type: 'string', max: 20,  required: true },
  { key: 'documentNumber',         label: 'Номер',             type: 'string', max: 20,  required: true },
  { key: 'documentIssuedBy',       label: 'Кем выдан',         type: 'string', max: 255, required: true },
  { key: 'documentIssuedAt',       label: 'Дата выдачи',       type: 'date',   required: true, notFuture: true },
  { key: 'documentDepartmentCode', label: 'Код подразделения', type: 'string', max: 10,  required: true },

  { key: 'postalCode', label: 'Индекс',       type: 'string', max: 10 },
  { key: 'region',     label: 'Регион',       type: 'string', max: 100 },
  { key: 'district',   label: 'Район/округ',  type: 'string', max: 100, required: true },
  { key: 'city',       label: 'Город',        type: 'string', max: 100, required: true },
  { key: 'street',     label: 'Улица',        type: 'string', max: 255, required: true },
  { key: 'building',   label: 'Корпус',       type: 'string', max: 20 },
  { key: 'apartment',  label: 'Квартира',     type: 'string', max: 20 },

  { key: 'phone', label: 'Телефон', type: 'phone', required: true },
  { key: 'email', label: 'Email',   type: 'email', required: true },

  {
    key: 'personalDataConsent',
    label: 'Согласие на обработку персональных данных',
    type: 'boolean',
    required: true,
    mustBeTrue: true
  }
];

/**
 * Собирает текст сообщения для группового чата.
 * Пустые необязательные поля в сообщение не попадают.
 *
 * @param {Object} p Нормализованный payload
 * @param {Object} submission Запись заявки (нужен id для короткой ссылки в тексте)
 * @returns {string}
 */
function formatMessage(p) {
  const S = '   '; // разделитель полей внутри строки (pre-wrap сохраняет пробелы)
  const lines = [];

  // ФИО и адрес пациента
  lines.push('*Новый пациент:*');

  const fio = [p.lastName, p.firstName, p.middleName].filter(Boolean).join(' ');
  lines.push(`${fio}${S}${formatDate(p.birthDate)}`);

  const addressHead = [p.postalCode, p.region, p.district].filter(Boolean).join(', ');
  const addressBody = [
    `г. ${p.city}`,
    `ул. ${p.street}`,
    p.building  ? `к. ${p.building}`  : null,
    p.apartment ? `кв. ${p.apartment}` : null
  ].filter(Boolean).join(', ');
  lines.push([addressHead, addressBody].filter(Boolean).join(', '));

  lines.push(`${p.phone}${S}${p.email}`);
  lines.push('');

  // Документ
  lines.push('*Документ:*');
  const docName = p.documentType ? DOCUMENT_TYPE[p.documentType] : 'Документ';
  lines.push(`${docName}${S}${p.documentSeries}${S}${p.documentNumber}`);
  lines.push(`Выдан: ${p.documentIssuedBy} (${p.documentDepartmentCode})`);
  lines.push(`Дата выдачи: ${formatDate(p.documentIssuedAt)}`);

  return lines.join('\n');
}

// ── Форматирование для человека ───────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

module.exports = {
  formType: 'patient-registration',
  title: 'Регистрация пациента',
  fields,
  formatMessage,
  // Экспортируем словари — пригодятся для документации и будущего UI
  dictionaries: { GENDER, MARITAL_STATUS, DOCUMENT_TYPE }
};
