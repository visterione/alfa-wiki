'use strict';

/**
 * Форма регистрации пациента с сайта клиники.
 *
 * Поля описываются декларативно — движок проверки в services/public/fieldValidator.js.
 * Чтобы добавить новую форму: создать такой же файл рядом и зарегистрировать его
 * в services/public/formRegistry.js.
 *
 * Ключевая развилка формы — applicantType. Анкету заполняет либо сам пациент, либо
 * родитель/представитель ребёнка. Во втором случае основной блок (ФИО, документ,
 * адрес, контакты) описывает представителя, а пациент — это ребёнок из блока child*.
 * Поэтому почти все условия обязательности завязаны на applicantType.
 */

const APPLICANT_TYPE = {
  self:            'Записывается сам на себя',
  child_parent:    'Родитель / опекун записывает ребёнка',
  child_guardian:  'Иной представитель записывает ребёнка'
};

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

// ── Условия обязательности ────────────────────────────────────────────────

/** Анкету заполняет представитель — значит пациент это ребёнок из блока child* */
const forChild = (v) =>
  v.applicantType === 'child_parent' || v.applicantType === 'child_guardian';

/** Пациент записывается сам — блока child* нет, основной блок это он и есть */
const forSelf = (v) => v.applicantType === 'self';

/** Нотариальная доверенность нужна только не-родителю */
const forGuardian = (v) => v.applicantType === 'child_guardian';

/**
 * Код подразделения есть только у паспорта РФ: у загранпаспорта, свидетельства о
 * рождении и иностранных документов его физически не существует. Требовать его
 * всегда — значит не давать отправить анкету с любым другим документом.
 */
const isPassportRf = (v) => v.documentType === 'passport_rf';
const isChildPassportRf = (v) => v.childDocumentType === 'passport_rf';

const hasBenefits = (v) => v.hasBenefits === true;

/** @type {import('../fieldValidator').FieldSpec[]} */
const fields = [
  { key: 'applicantType', label: 'Кто заполняет анкету', type: 'enum', values: APPLICANT_TYPE, required: true },

  // ── Основной блок: сам пациент либо его представитель ───────────────────
  { key: 'lastName',   label: 'Фамилия',  type: 'string', max: 100, required: true },
  { key: 'firstName',  label: 'Имя',      type: 'string', max: 100, required: true },
  { key: 'middleName', label: 'Отчество', type: 'string', max: 100 },

  { key: 'gender',        label: 'Пол',                 type: 'enum', values: GENDER },
  { key: 'birthDate',     label: 'Дата рождения',       type: 'date', required: true, notFuture: true },
  { key: 'maritalStatus', label: 'Семейное положение',  type: 'enum', values: MARITAL_STATUS },

  // СНИЛС основного блока: при self — пациента, при записи ребёнка — представителя
  { key: 'snils',               label: 'СНИЛС',                type: 'snils', requiredIf: forSelf, requiredWhen: 'applicantType = self' },
  { key: 'representativeSnils', label: 'СНИЛС представителя',  type: 'snils', requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },

  // ── Ребёнок — только когда анкету заполняет представитель ────────────────
  { key: 'childLastName',   label: 'Фамилия ребёнка',  type: 'string', max: 100, requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },
  { key: 'childFirstName',  label: 'Имя ребёнка',      type: 'string', max: 100, requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },
  { key: 'childMiddleName', label: 'Отчество ребёнка', type: 'string', max: 100 },

  { key: 'childBirthDate', label: 'Дата рождения ребёнка', type: 'date', notFuture: true, requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },
  { key: 'childGender',    label: 'Пол ребёнка',           type: 'enum', values: GENDER,  requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },
  { key: 'childSnils',     label: 'СНИЛС ребёнка',         type: 'snils',                 requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },

  { key: 'childDocumentType',   label: 'Документ ребёнка', type: 'enum',   values: DOCUMENT_TYPE, requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },
  // Серия свидетельства о рождении — римские цифры и буквы (IV-АБ), поэтому строка
  { key: 'childDocumentSeries', label: 'Серия документа ребёнка',    type: 'string', max: 20,  requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },
  { key: 'childDocumentNumber', label: 'Номер документа ребёнка',    type: 'string', max: 20,  requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },
  { key: 'childDocumentIssuedBy', label: 'Кем выдан документ ребёнка', type: 'string', max: 255, requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },
  { key: 'childDocumentIssuedAt', label: 'Дата выдачи документа ребёнка', type: 'date', notFuture: true, requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },
  { key: 'childDocumentDepartmentCode', label: 'Код подразделения (документ ребёнка)', type: 'string', max: 10, requiredIf: isChildPassportRf, requiredWhen: 'childDocumentType = passport_rf' },

  // ── Документ основного блока ────────────────────────────────────────────
  { key: 'documentType',           label: 'Документ',          type: 'enum',   values: DOCUMENT_TYPE, required: true },
  { key: 'documentSeries',         label: 'Серия',             type: 'string', max: 20,  required: true },
  { key: 'documentNumber',         label: 'Номер',             type: 'string', max: 20,  required: true },
  { key: 'documentIssuedBy',       label: 'Кем выдан',         type: 'string', max: 255, required: true },
  { key: 'documentIssuedAt',       label: 'Дата выдачи',       type: 'date',   required: true, notFuture: true },
  { key: 'documentDepartmentCode', label: 'Код подразделения', type: 'string', max: 10,  requiredIf: isPassportRf, requiredWhen: 'documentType = passport_rf' },

  // ── Адрес ───────────────────────────────────────────────────────────────
  // В анкете регион и район — одно поле («Краснодарский край, Анапский район»),
  // поэтому region принимаем строкой целиком, а district оставляем на случай,
  // когда сайт всё же разводит их по двум полям.
  { key: 'postalCode', label: 'Индекс',                 type: 'string', max: 10 },
  { key: 'region',     label: 'Регион / район / округ', type: 'string', max: 200, required: true },
  { key: 'district',   label: 'Район/округ',            type: 'string', max: 100 },
  { key: 'city',       label: 'Город',                  type: 'string', max: 100, required: true },
  { key: 'street',     label: 'Улица',                  type: 'string', max: 255, required: true },
  { key: 'house',      label: 'Дом',                    type: 'string', max: 20,  required: true },
  { key: 'building',   label: 'Корпус / строение',      type: 'string', max: 20 },
  { key: 'apartment',  label: 'Квартира',               type: 'string', max: 20 },

  { key: 'phone', label: 'Телефон', type: 'phone', required: true },
  { key: 'email', label: 'Email',   type: 'email', required: true },

  // ── Льготы ──────────────────────────────────────────────────────────────
  { key: 'hasBenefits',        label: 'Есть льготы',       type: 'boolean', required: true },
  { key: 'benefitsDescription', label: 'Описание льгот',   type: 'string',  max: 2000, multiline: true },

  // Свободный комментарий: всё, для чего в схеме нет отдельного поля
  { key: 'note', label: 'Комментарий', type: 'string', max: 4000, multiline: true },

  {
    key: 'personalDataConsent',
    label: 'Согласие на обработку персональных данных',
    type: 'boolean',
    required: true,
    mustBeTrue: true
  }
];

/**
 * Файловые поля формы.
 *
 * Разбирает multer (services/public/fileIntake.js), запрос приходит как
 * multipart/form-data. Зона, чьё условие не выполнено, не требуется и молча
 * отбрасывается — так же, как текстовые поля с requiredIf.
 */
const files = [
  { key: 'powerOfAttorneyFile',      label: 'Нотариальная доверенность',  requiredIf: forGuardian, requiredWhen: 'applicantType = child_guardian' },

  { key: 'snilsFile',                label: 'Карточка СНИЛС',             requiredIf: forSelf, requiredWhen: 'applicantType = self' },
  { key: 'passportFile',             label: 'Разворот паспорта',          requiredIf: forSelf, requiredWhen: 'applicantType = self' },

  { key: 'childSnilsFile',           label: 'Карточка СНИЛС ребёнка',     requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },
  { key: 'childDocumentFile',        label: 'Документ ребёнка',           requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian', maxCount: 2 },

  { key: 'representativeSnilsFile',  label: 'Карточка СНИЛС представителя',  requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },
  { key: 'representativeDocumentFile', label: 'Паспорт представителя',       requiredIf: forChild, requiredWhen: 'applicantType = child_parent | child_guardian' },

  { key: 'benefitsFiles',            label: 'Документы о льготах',        requiredIf: hasBenefits, requiredWhen: 'hasBenefits = true', maxCount: 3 }
].map(spec => ({
  maxCount:  1,
  maxSizeMb: 10,
  mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  ...spec
}));

/**
 * Собирает текст сообщения для группового чата.
 * Пустые необязательные поля в сообщение не попадают.
 *
 * @param {Object} p Нормализованный payload
 * @returns {string}
 */
function formatMessage(p) {
  const S = '   '; // разделитель полей внутри строки (pre-wrap сохраняет пробелы)
  const lines = [];
  const isChild = p.applicantType !== 'self';

  lines.push('*Анкета нового пациента*');

  // При записи ребёнка пациент — он, поэтому его блок идёт первым
  if (isChild) {
    lines.push('*Пациент (ребёнок):*');
    lines.push(`${fio(p.childLastName, p.childFirstName, p.childMiddleName)}${S}${formatDate(p.childBirthDate)}${S}${GENDER[p.childGender] || ''}`.trimEnd());
    if (p.childSnils) lines.push(`СНИЛС: ${formatSnils(p.childSnils)}`);
    lines.push(`${DOCUMENT_TYPE[p.childDocumentType] || 'Документ'}${S}${p.childDocumentSeries}${S}${p.childDocumentNumber}`);
    lines.push(`Выдан: ${p.childDocumentIssuedBy}${p.childDocumentDepartmentCode ? ` (${p.childDocumentDepartmentCode})` : ''}`);
    lines.push(`Дата выдачи: ${formatDate(p.childDocumentIssuedAt)}`);
    lines.push('');
  }

  lines.push(isChild ? `*${APPLICANT_TYPE[p.applicantType]}:*` : '*Данные:*');
  lines.push(`${fio(p.lastName, p.firstName, p.middleName)}${S}${formatDate(p.birthDate)}`);

  const snils = isChild ? p.representativeSnils : p.snils;
  if (snils) lines.push(`СНИЛС: ${formatSnils(snils)}`);

  lines.push(formatAddress(p));
  lines.push(`${p.phone}${S}${p.email}`);
  lines.push('');

  // Документ основного блока
  lines.push(isChild ? '*Документ представителя:*' : '*Документ:*');
  lines.push(`${DOCUMENT_TYPE[p.documentType] || 'Документ'}${S}${p.documentSeries}${S}${p.documentNumber}`);
  lines.push(`Выдан: ${p.documentIssuedBy}${p.documentDepartmentCode ? ` (${p.documentDepartmentCode})` : ''}`);
  lines.push(`Дата выдачи: ${formatDate(p.documentIssuedAt)}`);

  if (p.hasBenefits) {
    lines.push('');
    lines.push('*Льготы:*');
    lines.push(p.benefitsDescription || 'указаны, описание не заполнено');
  }

  if (p.note) {
    lines.push('');
    lines.push('*Комментарий:*');
    lines.push(p.note);
  }

  return lines.join('\n');
}

/**
 * Кнопка под сообщением: завести пациента в МИС, не перенабирая анкету руками.
 *
 * Метод МИС принимает только ФИО, дату рождения, пол и контакты — паспорт и
 * адрес из анкеты передать нечем, их дозаполняют в карточке по тексту заявки.
 *
 * @param {Object} p Нормализованный payload
 * @param {Object} submission Запись заявки
 * @returns {Array} кнопки для message.actions
 */
function buildActions(p, submission) {
  return [{
    id:    'mis-create-patient',
    kind:  'api',
    // При записи ребёнка в МИС заводится он, а не заполнявший анкету взрослый
    label: p.applicantType !== 'self' ? 'Создать пациента (ребёнка)' : 'Создать пациента',
    submissionId: submission.id
  }];
}

// ── Форматирование для человека ───────────────────────────────────────────

function fio(last, first, middle) {
  return [last, first, middle].filter(Boolean).join(' ');
}

function formatAddress(p) {
  const head = [p.postalCode, p.region, p.district].filter(Boolean).join(', ');
  const body = [
    `г. ${p.city}`,
    `ул. ${p.street}`,
    `д. ${p.house}`,
    p.building  ? `к. ${p.building}`   : null,
    p.apartment ? `кв. ${p.apartment}` : null
  ].filter(Boolean).join(', ');
  return [head, body].filter(Boolean).join(', ');
}

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** 11 цифр → 123-456-789 00: так СНИЛС печатают на карточке, так его и сверяют */
function formatSnils(digits) {
  if (!digits || digits.length !== 11) return digits || '';
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)} ${digits.slice(9)}`;
}

module.exports = {
  formType: 'patient-registration',
  title: 'Регистрация пациента',
  fields,
  files,
  formatMessage,
  buildActions,
  limits: { maxFileMb: 10, maxFiles: 10 },
  // Экспортируем словари — пригодятся для документации и будущего UI
  dictionaries: { APPLICANT_TYPE, GENDER, MARITAL_STATUS, DOCUMENT_TYPE }
};
