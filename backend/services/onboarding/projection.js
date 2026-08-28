'use strict';

/**
 * Срез анкеты под конкретный шаг.
 *
 * В анкете лежат дата рождения, СНИЛС, ИНН и сканы диплома. Показывать это
 * целиком каждому исполнителю незачем: маркетологу для бейджа нужны три поля,
 * а не паспортные данные. Таблица «кто что получает» есть в ТЗ, здесь она
 * переведена в код.
 *
 * Фильтрация делается на сервере, а не скрытием в интерфейсе: иначе достаточно
 * открыть ответ запроса, чтобы прочитать всё.
 */

const assignments = require('./assignments');
const schema = require('./formSchema');

// Порядок полей в карточке — тот же, что в анкете. Object.keys отдаёт их в
// порядке вставки, то есть в том, в каком врач заполнял, и карточка выглядит
// перемешанной: ИНН выше ФИО.
const FIELD_ORDER = (() => {
  const order = new Map();
  let index = 0;
  for (const block of schema.BLOCKS) {
    if (block.repeat) { order.set(block.key, index++); continue; }
    for (const field of block.fields) order.set(field.key, index++);
  }
  return order;
})();

function orderFields(form) {
  const entries = Object.entries(form)
    .sort((a, b) => (FIELD_ORDER.get(a[0]) ?? 999) - (FIELD_ORDER.get(b[0]) ?? 999));
  return Object.fromEntries(entries);
}

// Ключи простых полей и повторяемых блоков вперемешку — и то и другое
// отбирается по имени.
const VIEWS = {
  // Главврач видит анкету целиком: он согласовывает допуск, и решать это по
  // усечённому набору нельзя.
  [assignments.CHIEF_STEP]: '*',

  // Отдел кадров сверяет человека и его документы: анкетные данные, образование,
  // квалификацию и сертификаты. Публичная часть (био, тексты и ссылки для сайта)
  // к кадровому оформлению отношения не имеет и сюда не входит.
  hr_check: [
    'fullName', 'birthDate', 'phone', 'startDate', 'professions',
    'experienceTotal', 'experienceSpecialty',
    'education', 'qualification', 'certificates',
    'snils', 'inn'
  ],

  // Админу МИС нужны данные для учётной записи. Публичная часть (био, ссылки,
  // тексты для сайта) к созданию пользователя отношения не имеет.
  mis_account: [
    'fullName', 'birthDate', 'phone', 'startDate', 'professions',
    'experienceTotal', 'experienceSpecialty',
    'childrenFrom', 'scheduleDays', 'scheduleTime', 'appointmentMinutes',
    'snils', 'inn'
  ],

  // Старший регистратор строит расписание.
  schedule: [
    'fullName', 'phone', 'professions', 'startDate',
    'childrenFrom', 'scheduleDays', 'scheduleTime', 'appointmentMinutes'
  ],

  // Заполнение карточки врача — единственный шаг после главврача, которому
  // анкета отдаётся целиком. Так попросил заказчик: карточку собирают из всех
  // разделов сразу, и выданный по частям набор полей означал бы, что часть
  // данных придётся переспрашивать в переписке — то есть выносить их из
  // портала туда, где прав уже никто не проверяет.
  doctor_card: '*',

  // Маркетолог №1 — бейдж и карточка на кабинет.
  badge: ['badgeName', 'fullName', 'professions', 'photo'],

  // Реклама нового врача: публичная часть анкеты — то, что можно показать
  // пациенту. Личные данные и документы к рекламе отношения не имеют.
  website: [
    'siteName', 'fullName', 'professions', 'bio', 'skills', 'photo',
    'experienceTotal', 'experienceSpecialty', 'childrenFrom',
    'education', 'qualification', 'papers', 'conferences', 'resources'
  ],

  // Бухгалтер вносит услуги: ему нужен сам список услуг (он приходит отдельно)
  // плюс минимум опознавательных данных.
  services_mis: ['fullName', 'professions', 'appointmentMinutes', 'inn'],

  // Колл-центру уходит выгрузка из МИС, а не анкета. Из анкеты — только имя,
  // чтобы человек понимал, о ком речь.
  callcenter: ['fullName', 'professions'],

  [assignments.ESCALATION_STEP]: ['fullName', 'professions']
};

// Сканы документов — отдельная категория: их видит главврач, который
// согласовывает допуск, и отдел кадров, который эти документы и проверяет —
// без сканов его шаг превратился бы в галочку вслепую. Фото врача в этот
// список не входит, оно нужно обоим маркетологам.
const DOC_KINDS_FOR_CHIEF = ['diploma', 'certificate'];
const VIEWS_WITH_DOCUMENTS = ['hr_check'];

/**
 * @param {Object} app        Заявка (модель)
 * @param {string} viewKey    Ключ шага или '*' для полного доступа
 * @param {Array}  files      Файлы заявки
 * @returns {Object} Срез, пригодный для отдачи клиенту
 */
function project(app, viewKey, files = []) {
  const allowed = VIEWS[viewKey];
  const full = allowed === '*' || viewKey === '*';

  const form = app.form || {};
  const base = {
    id: app.id,
    status: app.status,
    medCenterId: app.medCenterId,
    professions: app.professions || [],
    fullName: app.fullName,
    startDate: app.startDate,
    misUserId: app.misUserId,
    createdAt: app.createdAt,
    submittedAt: app.submittedAt
  };

  if (full) {
    return {
      ...base,
      email: app.email,
      phone: app.phone,
      form: orderFields(form),
      consents: app.consents || {},
      files: files.map(fileInfo),
      decisionNote: app.decisionNote,
      revisionFields: app.revisionFields || []
    };
  }

  const keys = new Set(allowed || []);
  const slice = {};
  for (const key of Object.keys(form)) {
    if (keys.has(key)) slice[key] = form[key];
  }

  // Телефон и e-mail — контакты врача, их отдаём только тем, кому они нужны по
  // таблице ТЗ.
  if (!keys.has('phone')) delete base.phone;
  if (!keys.has('fullName')) delete base.fullName;
  if (!keys.has('professions')) base.professions = [];

  // Фото отдаётся тем, у кого оно есть в списке полей; сканы — тем, кому шаг
  // разрешает документы. Раньше здесь хватало условия про фото: кроме главврача
  // (он идёт веткой выше, целиком) документы не видел никто.
  const withDocuments = VIEWS_WITH_DOCUMENTS.includes(viewKey);

  return {
    ...base,
    ...(keys.has('phone') ? { phone: app.phone } : {}),
    form: orderFields(slice),
    files: files
      .filter(f => (keys.has('photo') && f.kind === 'photo')
        || (withDocuments && DOC_KINDS_FOR_CHIEF.includes(f.kind)))
      .map(fileInfo)
  };
}

function fileInfo(file) {
  return {
    id: file.id,
    kind: file.kind,
    filename: file.filename,
    originalName: file.originalName,
    size: file.size,
    // Тип нужен, чтобы решить, рисовать превью картинкой или страницей PDF:
    // по расширению в имени это гадание, оно приходит от клиента.
    mimeType: file.mimeType || null,
    url: `/uploads/onboarding/${file.filename}`
  };
}

/** Может ли этот шаг видеть сканы документов. */
function canSeeDocuments(viewKey) {
  if (viewKey === '*' || VIEWS[viewKey] === '*') return true;
  return VIEWS_WITH_DOCUMENTS.includes(viewKey);
}

module.exports = {
  project, fileInfo, canSeeDocuments, VIEWS, DOC_KINDS_FOR_CHIEF, VIEWS_WITH_DOCUMENTS
};
