'use strict';

/**
 * Схема анкеты врача.
 *
 * Один источник правды на три потребителя: публичная форма рисует по ней поля,
 * бэкенд по ней же проверяет присланное, а срезы для исполнителей (projection.js)
 * ссылаются на те же ключи. Раньше в проекте так сделаны формы публичного API
 * (services/public/formRegistry.js), и там это себя оправдало: описание полей
 * отдаётся разработчику как есть, сверяться с документацией руками не нужно.
 *
 * Порядок блоков — это порядок в форме. Первым идёт филиал: пока он не выбран,
 * неизвестно, какому главврачу отправлять анкету на согласование.
 */

// type: text | textarea | date | number | phone | select | professions |
//       medcenter | file | files | repeat | checkbox
const BLOCKS = [
  {
    key: 'branch',
    title: 'Филиал',
    hint: 'Где вы будете вести приём',
    fields: [
      { key: 'medCenterId', label: 'Филиал', type: 'medcenter', required: true }
    ]
  },
  {
    key: 'main',
    title: 'Основное',
    fields: [
      { key: 'fullName',  label: 'ФИО',                type: 'text',  required: true, max: 255 },
      { key: 'birthDate', label: 'Дата рождения',      type: 'date',  required: true },
      { key: 'phone',     label: 'Контактный телефон', type: 'phone', required: true, max: 50 },
      // Дата выхода — точка отсчёта для всех сроков процесса, в бумажной анкете
      // её не было.
      { key: 'startDate', label: 'Дата выхода на работу', type: 'date', required: true }
    ]
  },
  {
    key: 'specialty',
    title: 'Специальность',
    hint: 'Можно выбрать несколько',
    fields: [
      // Свободным текстом специальность вводить нельзя: по ней на шаге выбора
      // услуг подтягивается прайс, и текстовое значение обрушило бы всю ветку в
      // ручную работу.
      { key: 'professions', label: 'Специальности', type: 'professions', required: true }
    ]
  },
  {
    key: 'experience',
    title: 'Стаж',
    fields: [
      { key: 'experienceTotal',     label: 'Общий стаж работы, лет',            type: 'number', required: true, min: 0, max: 70 },
      { key: 'experienceSpecialty', label: 'Стаж работы по специальности, лет', type: 'number', required: true, min: 0, max: 70 }
    ]
  },
  {
    key: 'reception',
    title: 'Приём',
    fields: [
      { key: 'childrenFrom',       label: 'Принимаю детей с возраста, лет', type: 'number', min: 0, max: 18 },
      { key: 'scheduleDays',       label: 'Дни приёма',                      type: 'text', required: true, max: 255 },
      { key: 'scheduleTime',       label: 'Время приёма',                    type: 'text', required: true, max: 255 },
      { key: 'appointmentMinutes', label: 'Продолжительность приёма, минут', type: 'number', required: true, min: 5, max: 240 }
    ]
  },
  {
    key: 'education',
    title: 'Образование',
    repeat: true,
    fields: [
      { key: 'year',        label: 'Год',                type: 'number', required: true, min: 1950, max: 2100 },
      { key: 'institution', label: 'Учебное заведение',  type: 'text',   required: true, max: 300 },
      { key: 'specialty',   label: 'Специальность',      type: 'text',   required: true, max: 300 },
      { key: 'city',        label: 'Город',              type: 'text',   max: 120 }
    ]
  },
  {
    key: 'qualification',
    title: 'Повышение квалификации',
    repeat: true,
    fields: [
      { key: 'year',        label: 'Год',               type: 'number', required: true, min: 1950, max: 2100 },
      { key: 'institution', label: 'Учебное заведение', type: 'text',   required: true, max: 300 },
      { key: 'specialty',   label: 'Специальность',     type: 'text',   max: 300 },
      { key: 'city',        label: 'Город',             type: 'text',   max: 120 }
    ]
  },
  {
    key: 'certificates',
    title: 'Сертификаты',
    repeat: true,
    fields: [
      { key: 'specialization', label: 'Специализация',        type: 'text',   required: true, max: 300 },
      { key: 'validUntil',     label: 'Действует до (год)',  type: 'number', required: true, min: 1990, max: 2100 }
    ]
  },
  {
    key: 'papers',
    title: 'Научные труды',
    repeat: true,
    fields: [
      { key: 'year',        label: 'Год',                  type: 'number', min: 1950, max: 2100 },
      { key: 'publication', label: 'Наименование издания', type: 'text', max: 300 },
      { key: 'topic',       label: 'Тема публикации',      type: 'text', max: 500 }
    ]
  },
  {
    key: 'conferences',
    title: 'Конференции',
    repeat: true,
    fields: [
      { key: 'year',   label: 'Год',            type: 'number', min: 1950, max: 2100 },
      { key: 'event',  label: 'Мероприятие',    type: 'text', max: 300 },
      { key: 'place',  label: 'Место',          type: 'text', max: 200 },
      { key: 'extra',  label: 'Дополнительно',  type: 'text', max: 500 }
    ]
  },
  {
    key: 'skills',
    title: 'Навыки',
    fields: [
      { key: 'skills', label: 'Профессиональные навыки', type: 'textarea', max: 4000 }
    ]
  },
  {
    key: 'public',
    title: 'Для бейджа и сайта',
    fields: [
      { key: 'badgeName', label: 'ФИО для бейджа', type: 'text', max: 255 },
      { key: 'siteName',  label: 'ФИО для сайта',  type: 'text', max: 255 },
      // Иначе маркетолог пишет текст карточки сам и потом согласовывает его с
      // врачом отдельным кругом переписки.
      { key: 'bio', label: 'Краткое био для сайта', type: 'textarea', max: 1200 }
    ]
  },
  {
    key: 'resources',
    title: 'Ресурсы',
    hint: 'Соцсети, медпорталы, публикации',
    repeat: true,
    fields: [
      { key: 'label', label: 'Что это', type: 'text', max: 120 },
      { key: 'url',   label: 'Ссылка',  type: 'text', max: 1000 }
    ]
  },
  {
    key: 'documents',
    title: 'Документы',
    fields: [
      { key: 'snils', label: 'СНИЛС', type: 'text', max: 20 },
      { key: 'inn',   label: 'ИНН',   type: 'text', max: 20 },
      { key: 'photo',      label: 'Портретное фото',           type: 'file',  accept: 'image' },
      { key: 'diploma',    label: 'Сканы диплома',             type: 'files', accept: 'doc' },
      { key: 'certScans',  label: 'Сканы сертификатов',        type: 'files', accept: 'doc' }
    ]
  },
  {
    key: 'consents',
    title: 'Согласия',
    fields: [
      { key: 'pd',    label: 'Согласен на обработку персональных данных', type: 'checkbox', required: true },
      { key: 'image', label: 'Согласен на использование изображения на сайте', type: 'checkbox', required: true }
    ]
  }
];

// Версия текста согласий. Меняется вместе с текстом: в заявке фиксируется та,
// на которую человек согласился, иначе через год будет непонятно, под чем
// именно стоит его галочка.
const CONSENT_VERSION = '2026-08-24';

const REPEAT_BLOCKS = BLOCKS.filter(b => b.repeat).map(b => b.key);
const FILE_FIELDS = { photo: 'photo', diploma: 'diploma', certScans: 'certificate' };

function blockByKey(key) {
  return BLOCKS.find(b => b.key === key) || null;
}

/** Плоский список простых (не повторяемых) полей — для проверки и срезов. */
function flatFields() {
  const out = [];
  for (const block of BLOCKS) {
    if (block.repeat) continue;
    for (const field of block.fields) out.push({ ...field, block: block.key });
  }
  return out;
}

/**
 * Человеческие названия полей: ключ → подпись. Карточка заявки показывает срез
 * анкеты, и без этого в ней стояли бы «fullName» и «experienceSpecialty».
 * Строится из той же схемы, по которой рисуется форма, — второй список подписей
 * разошёлся бы с первым на ближайшей правке.
 */
function labelMap() {
  const map = {};
  for (const block of BLOCKS) {
    if (block.repeat) {
      map[block.key] = block.title;
      continue;
    }
    for (const field of block.fields) map[field.key] = field.label;
  }
  map.professions = 'Специальности';
  return map;
}

module.exports = {
  BLOCKS,
  labelMap,
  REPEAT_BLOCKS,
  FILE_FIELDS,
  CONSENT_VERSION,
  blockByKey,
  flatFields
};
