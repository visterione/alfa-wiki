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
function formatMessage(p, submission) {
  const lines = [];

  lines.push('🆕 Новая заявка с сайта');
  lines.push(`Регистрация пациента · ${formatDateTime(submission.createdAt)}`);
  lines.push('');

  // ФИО и личные данные
  const fio = [p.lastName, p.firstName, p.middleName].filter(Boolean).join(' ');
  lines.push(`👤 ${fio}`);

  const personal = [];
  if (p.gender) personal.push(`Пол: ${GENDER[p.gender]}`);
  personal.push(`Дата рождения: ${formatDate(p.birthDate)}`);
  lines.push(personal.join(' · '));

  if (p.maritalStatus) lines.push(`Семейное положение: ${MARITAL_STATUS[p.maritalStatus]}`);
  lines.push('');

  // Документ
  const docName = p.documentType ? DOCUMENT_TYPE[p.documentType] : 'Документ';
  lines.push(`📄 ${docName} ${p.documentSeries} ${p.documentNumber}`);
  lines.push(`Выдан: ${p.documentIssuedBy}`);
  lines.push(`Дата выдачи: ${formatDate(p.documentIssuedAt)} · Код: ${p.documentDepartmentCode}`);
  lines.push('');

  // Адрес
  const addressHead = [p.postalCode, p.region, p.district].filter(Boolean).join(', ');
  const addressBody = [
    `г. ${p.city}`,
    `ул. ${p.street}`,
    p.building  ? `к. ${p.building}`  : null,
    p.apartment ? `кв. ${p.apartment}` : null
  ].filter(Boolean).join(', ');
  lines.push(`🏠 ${[addressHead, addressBody].filter(Boolean).join(', ')}`);
  lines.push('');

  // Контакты
  lines.push(`📞 ${formatPhone(p.phone)}`);
  lines.push(`✉️ ${p.email}`);
  lines.push('');
  lines.push(`ID заявки: ${String(submission.id).slice(0, 8)}`);

  return lines.join('\n');
}

// ── Форматирование для человека ───────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function formatDateTime(date) {
  return new Date(date).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatPhone(phone) {
  // +79991234567 → +7 999 123-45-67
  const m = String(phone).match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}

module.exports = {
  formType: 'patient-registration',
  title: 'Регистрация пациента',
  fields,
  formatMessage,
  // Экспортируем словари — пригодятся для документации и будущего UI
  dictionaries: { GENDER, MARITAL_STATUS, DOCUMENT_TYPE }
};
