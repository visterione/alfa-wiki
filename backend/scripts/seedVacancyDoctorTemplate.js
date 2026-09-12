/**
 * Шаблон «Врач» для раздела «Вакансии» (ver. 8.20).
 *
 * Переносит нынешнюю захардкоженную анкету врача (services/onboarding/
 * formSchema.js) и её процесс (services/onboarding/process.js) в данные. Смысл
 * не в том, чтобы завести первую вакансию, а в том, чтобы у конструктора сразу
 * был нетривиальный шаблон: четырнадцать блоков, шесть повторяемых, файлы,
 * согласия, десять шагов с зависимостями и все четыре умения МИС. Собирать
 * такое руками на каждой проверке — полдня.
 *
 * Шаблон заводится черновиком: вакансия по недоделанному шаблону обернулась бы
 * заявками по недоделанной анкете, а этот ещё нужно разглядеть в редакторе.
 *
 * Одно отличие от оригинала: блока «Филиал» здесь нет. Место работы теперь
 * известно из вакансии, по QR-коду которой человек пришёл, и спрашивать его
 * второй раз незачем.
 *
 * Запуск из каталога backend:
 *   npm run seed:vacancy-doctor
 *
 * Повторный запуск ничего не перезаписывает: шаблон ищется по названию, и если
 * он уже есть, скрипт молча выходит. Иначе правки, сделанные в конструкторе,
 * откатывались бы к исходнику при каждом запуске — ровно на это в складском
 * модуле уже наступали (migrate:7.13 перезаписывал ручные правки словаря).
 */

require('dotenv').config();

const { sequelize, VacTemplate } = require('../models');

// ── Анкета ─────────────────────────────────────────────────────────────────
//
// role — чем поле является для движка. В первом поколении анкета была одна, и
// движок знал, что ФИО лежит в form.fullName. Теперь ключи придумывает тот, кто
// собирает анкету, поэтому связь объявляется явно.
const BLOCKS = [
  {
    key: 'main',
    title: 'Основное',
    fields: [
      { key: 'fullName',  label: 'ФИО',                   type: 'text',  role: 'fullName',  required: true, max: 255 },
      { key: 'birthDate', label: 'Дата рождения',         type: 'date',  role: 'birthDate', required: true },
      { key: 'phone',     label: 'Контактный телефон',    type: 'phone', role: 'phone',     required: true, max: 50 },
      { key: 'startDate', label: 'Дата выхода на работу', type: 'date',  role: 'startDate', required: true }
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
      { key: 'professions', label: 'Специальности', type: 'professions', role: 'professions', required: true }
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
      { key: 'childrenFrom', label: 'Принимаю детей с возраста, лет', type: 'number', min: 0, max: 18 },
      // Дни и время — виджеты, а не свободный текст. Расписание по этим полям
      // строит старший регистратор, и «пн-пт кроме второй среды» из текстового
      // поля превращалось в переписку с врачом вместо работы.
      { key: 'scheduleDays',       label: 'Дни приёма',                      type: 'weekdays',  required: true },
      { key: 'scheduleTime',       label: 'Время приёма',                    type: 'timerange', required: true },
      { key: 'appointmentMinutes', label: 'Продолжительность приёма, минут', type: 'number', required: true, min: 5, max: 240 }
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
    key: 'education',
    title: 'Образование',
    repeat: true,
    fields: [
      { key: 'year',        label: 'Год',               type: 'number', required: true, min: 1950, max: 2100 },
      { key: 'institution', label: 'Учебное заведение', type: 'text',   required: true, max: 300 },
      { key: 'specialty',   label: 'Специальность',     type: 'text',   required: true, max: 300 },
      { key: 'city',        label: 'Город',             type: 'text',   max: 120 }
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
      { key: 'specialization', label: 'Специализация',       type: 'text',   required: true, max: 300 },
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
      { key: 'year',  label: 'Год',           type: 'number', min: 1950, max: 2100 },
      { key: 'event', label: 'Мероприятие',   type: 'text', max: 300 },
      { key: 'place', label: 'Место',         type: 'text', max: 200 },
      { key: 'extra', label: 'Дополнительно', type: 'text', max: 500 }
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
      { key: 'snils',     label: 'СНИЛС',              type: 'text',  max: 20 },
      { key: 'inn',       label: 'ИНН',                type: 'text',  max: 20 },
      { key: 'photo',     label: 'Портретное фото',    type: 'file',  accept: 'image' },
      { key: 'diploma',   label: 'Сканы диплома',      type: 'files', accept: 'doc' },
      { key: 'certScans', label: 'Сканы сертификатов', type: 'files', accept: 'doc' }
    ]
  },
  {
    key: 'consents',
    title: 'Согласия',
    fields: [
      { key: 'pd',    label: 'Согласен на обработку персональных данных',          type: 'checkbox', required: true },
      { key: 'image', label: 'Согласен на использование изображения на сайте',     type: 'checkbox', required: true }
    ]
  }
];

// Шаги мастера. Одним полотном анкета получалась на полтора десятка блоков и на
// телефоне прокручивалась минуту — до конца доходили не все. Группировка
// смысловая, а не «по пять блоков»: за один заход заполняют то, что помнят без
// документов, а сканы и согласия оставляют напоследок.
const FORM_STEPS = [
  { key: 'about',   title: 'О себе',      blocks: ['main', 'specialty', 'experience'] },
  { key: 'work',    title: 'Приём',       blocks: ['reception', 'skills'] },
  { key: 'edu',     title: 'Образование', blocks: ['education', 'qualification', 'certificates'] },
  { key: 'science', title: 'Наука',       blocks: ['papers', 'conferences'] },
  { key: 'site',    title: 'Для сайта',   blocks: ['public', 'resources'] },
  { key: 'docs',    title: 'Документы',   blocks: ['documents', 'consents'] }
];

// ── Процесс ────────────────────────────────────────────────────────────────
//
// after — список: шаг ждёт закрытия всех перечисленных. В первом поколении это
// была одна строка, и «дождаться и кадров, и учётки» выразить было нечем.
const STEPS = [
  {
    key: 'decision',
    title: 'Согласование анкеты',
    hint: 'Главврач филиала. Единственная точка, где процесс может встать целиком.',
    kind: 'decision',
    scope: 'branch',
    after: [],
    slaHours: 24,
    checklist: 'Анкета согласована'
  },
  {
    key: 'hr_check',
    title: 'Проверка отделом кадров',
    hint: 'Оригиналы диплома, сертификатов и документов, оформление трудовых отношений.',
    kind: 'manual',
    scope: 'network',
    // Идёт рядом с созданием учётки, а не перед ним. Пробовали воротами: пока
    // кадры не отметились, учётка не заводилась — но отказа на этом шаге нет,
    // есть отметка, и ворота только держали всю цепочку лишние сутки, ничего не
    // решая. Обязательным шаг остаётся через чек-лист: без кадров заявка не
    // станет запущенной.
    after: ['decision'],
    slaHours: 16,
    checklist: 'Документы проверены отделом кадров'
  },
  {
    key: 'mis_account',
    title: 'Создать пользователя в «Реновации»',
    hint: 'Только создание учётной записи. От неё зависят расписание и внесение выбранных услуг в МИС.',
    kind: 'mis_account',
    scope: 'network',
    after: ['decision'],
    slaHours: 4,
    checklist: 'Пользователь создан в МИС, doctor_id получен'
  },
  {
    key: 'badge',
    title: 'Бейдж и карточка на кабинет',
    hint: 'ФИО для бейджа, специальность, фото.',
    kind: 'manual',
    scope: 'branch',
    after: ['mis_account'],
    slaHours: 16,
    checklist: 'Бейдж и карточка на кабинет готовы и выданы'
  },
  {
    key: 'doctor_card',
    title: 'Карточка врача',
    hint: 'Анкета целиком: личные данные, документы, образование и публичная часть.',
    kind: 'manual',
    scope: 'branch',
    after: ['mis_account'],
    slaHours: 24,
    checklist: 'Карточка врача заполнена'
  },
  {
    // Ключ остался от первого поколения, хотя шаг называется иначе. Здесь это
    // уже не вынужденно — шаблон новый, — но менять было незачем: люди,
    // которые будут настраивать исполнителей, узнают шаг по названию, а ключ
    // видят только в редакторе.
    key: 'website',
    title: 'Реклама',
    hint: 'Био, образование, квалификация, труды, навыки, ссылки, фото.',
    kind: 'manual',
    scope: 'branch',
    after: ['mis_account'],
    slaHours: 24,
    checklist: 'Реклама нового врача запущена'
  },
  {
    key: 'schedule',
    title: 'Расписание в «Реновации»',
    hint: 'Филиал, кабинет, дни и время приёма, длительность, ограничение по возрасту.',
    kind: 'mis_schedule',
    scope: 'branch',
    after: ['mis_account'],
    slaHours: 16,
    checklist: 'Расписание создано, слоты доступны для записи'
  },
  {
    key: 'services_pick',
    title: 'Выбор услуг врачом',
    hint: 'Врач отмечает по прайсу, что готов оказывать, и правит длительность приёма.',
    kind: 'services_pick',
    // Исполнителя внутри клиники у шага нет: его закрывает сам кандидат по
    // своей ссылке. Назначать на него некого, и в настройках исполнителей он не
    // показывается.
    scope: 'candidate',
    after: ['mis_account'],
    slaHours: 48,
    checklist: 'Врач отметил услуги, которые будет оказывать'
  },
  {
    key: 'services_mis',
    title: 'Внести услуги врача в «Реновацию»',
    hint: 'Список отмеченных врачом услуг, расхождения по длительности и новые позиции.',
    kind: 'mis_services',
    scope: 'branch',
    after: ['services_pick'],
    // Сверка здесь советующая, а не запирающая. Отмеченное врачом — это заявка
    // «умею и готов», а не решение клиники: часть позиций сознательно не берут
    // из-за рентабельности или отсутствия спроса. При жёсткой проверке такой
    // шаг не закрылся бы никогда — в МИС этих услуг не будет по замыслу.
    blocking: false,
    slaHours: 8,
    checklist: 'Услуги отмечены врачом и внесены в МИС'
  },
  {
    key: 'callcenter',
    title: 'Принять выгрузку данных врача',
    hint: 'Принимает подготовленные данные врача для работы колл-центра.',
    kind: 'manual',
    scope: 'network',
    after: ['services_mis'],
    slaHours: 8,
    checklist: 'Данные врача выгружены и приняты старшим сотрудником колл-центра'
  }
];

const TEMPLATE_TITLE = 'Врач';

async function main() {
  await sequelize.authenticate();

  const existing = await VacTemplate.findOne({ where: { title: TEMPLATE_TITLE } });
  if (existing) {
    console.log(`Шаблон «${TEMPLATE_TITLE}» уже есть (${existing.id}) — ничего не меняю.`);
    console.log('Если нужен чистый исходник, удалите шаблон в разделе и запустите скрипт заново.');
    await sequelize.close();
    return;
  }

  const template = await VacTemplate.create({
    title: TEMPLATE_TITLE,
    description: 'Перенесён из захардкоженной анкеты первого поколения (ver. 7.30). '
      + 'Блока «Филиал» нет: место работы известно из вакансии.',
    form: {
      blocks: BLOCKS,
      steps: FORM_STEPS,
      // Версия текста согласий. Меняется вместе с текстом: в заявке фиксируется
      // та, на которую человек согласился, иначе через год будет непонятно, под
      // чем именно стоит его галочка.
      consentVersion: '2026-08-24'
    },
    process: { steps: STEPS },
    emails: {},
    isPublished: false
  });

  const abilities = STEPS.filter(s => !['manual', 'decision'].includes(s.kind)).length;
  console.log(`✓ Шаблон «${TEMPLATE_TITLE}» создан: ${template.id}`);
  console.log(`  анкета — ${BLOCKS.length} блоков (${BLOCKS.filter(b => b.repeat).length} повторяемых) в ${FORM_STEPS.length} шагах мастера`);
  console.log(`  процесс — ${STEPS.length} шагов, из них с умениями МИС: ${abilities}`);
  console.log('  черновик: чтобы по нему можно было создать вакансию, опубликуйте его в разделе');

  await sequelize.close();
}

main().catch(err => {
  console.error('✗ Ошибка сида:', err);
  process.exit(1);
});
