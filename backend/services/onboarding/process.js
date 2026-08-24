'use strict';

/**
 * Определение процесса онбординга врача.
 *
 * Шаги и их принцип работы зашиты в код, а не в настройки: процесс описан в ТЗ
 * целиком и меняется не чаще, чем раз в никогда. Настраивается только «кто» —
 * строка в onb_assignments (шаг + филиал → пользователь). Попытка сделать шаги
 * редактируемыми превратила бы модуль в конструктор workflow, каким уже стали
 * «Отзывы», и стоила бы вчетверо дороже при той же отдаче.
 *
 * Ролей мы намеренно не заводим. В проекте их и так много, а здесь исполнитель
 * — конкретный человек: складской модуль (services/warehouse/access.js) считает
 * права ровно так же, «по факту назначения», и это себя оправдало.
 */

// ── Стадии заявки ──────────────────────────────────────────────────────────
// Линейный костяк. Ветвление шага «параллельный запуск» стадией не описывается
// и живёт в задачах — см. stageOf() ниже.
const STATUS = {
  DRAFT:       'draft',        // врач заполняет анкету, письма никому не ушли
  SUBMITTED:   'submitted',    // на согласовании у главврача
  REVISION:    'revision',     // возвращена врачу на доработку
  REJECTED:    'rejected',     // отклонена, в архив
  APPROVED:    'approved',     // согласована, ждём учётку в МИС
  MIS_CREATED: 'mis_created',  // учётка есть, идут параллельные ветки
  LAUNCHED:    'launched',     // чек-лист закрыт
  CANCELLED:   'cancelled'     // процесс прерван вручную
};

const STATUS_LABELS = {
  [STATUS.DRAFT]:       'Новая заявка',
  [STATUS.SUBMITTED]:   'На согласовании',
  [STATUS.REVISION]:    'Доработка',
  [STATUS.REJECTED]:    'Отклонён',
  [STATUS.APPROVED]:    'Согласован',
  [STATUS.MIS_CREATED]: 'Заведён в МИС',
  [STATUS.LAUNCHED]:    'Запущен',
  [STATUS.CANCELLED]:   'Отменён'
};

// Заявка в работе — по этому набору считается уникальность e-mail: повторно
// заполнить анкету можно только после отклонения или отмены.
const ACTIVE_STATUSES = [
  STATUS.DRAFT, STATUS.SUBMITTED, STATUS.REVISION,
  STATUS.APPROVED, STATUS.MIS_CREATED, STATUS.LAUNCHED
];

// ── Шаги ───────────────────────────────────────────────────────────────────
//
// scope   — 'branch': исполнитель свой в каждом филиале; 'network': один на сеть.
//           Хранится одинаково (филиал в назначении либо NULL), различие только
//           в том, что предлагает интерфейс настроек.
// mode    — 'single': один исполнитель; 'race': назначено несколько, берёт любой,
//           и после взятия задача исчезает у остальных (шаг 6 из ТЗ).
// after   — шаг, после закрытия которого задача появляется. NULL — стартует от
//           согласования главврача.
// verify  — чем подтверждается выполнение: 'mis' — чтением из Реновации,
//           'manual' — отметкой исполнителя. Записи сотрудников API МИС не умеет
//           (в нём только get*-методы плюс запись по пациентам), поэтому сами
//           действия всё равно делаются руками в МИС, но верить галочке там, где
//           можно спросить систему, незачем.
// slaHours — в рабочих часах, см. services/onboarding/sla.js.
const STEPS = [
  {
    key: 'mis_account',
    title: 'Создать пользователя в «Реновации»',
    hint: 'Только создание учётной записи. От неё зависят и расписание, и услуги.',
    scope: 'network',
    mode: 'single',
    after: null,
    verify: 'mis',
    slaHours: 4,
    checklist: 'Пользователь создан в МИС, doctor_id получен'
  },
  {
    key: 'badge',
    title: 'Бейдж и карточка на кабинет',
    hint: 'ФИО для бейджа, специальность, фото.',
    scope: 'branch',
    mode: 'single',
    after: 'mis_account',
    verify: 'manual',
    slaHours: 16,
    checklist: 'Бейдж и карточка на кабинет готовы и выданы'
  },
  {
    key: 'website',
    title: 'Карточка врача на сайте',
    hint: 'Био, образование, квалификация, труды, навыки, ссылки, фото.',
    scope: 'branch',
    mode: 'single',
    after: 'mis_account',
    verify: 'manual',
    slaHours: 24,
    checklist: 'Карточка врача опубликована на сайте'
  },
  {
    key: 'schedule',
    title: 'Расписание в «Реновации»',
    hint: 'Филиал, кабинет, дни и время приёма, длительность, ограничение по возрасту.',
    scope: 'branch',
    mode: 'single',
    after: 'mis_account',
    verify: 'mis',
    slaHours: 16,
    checklist: 'Расписание создано, слоты доступны для записи'
  },
  {
    key: 'services_mis',
    title: 'Внести услуги врача в «Реновацию»',
    hint: 'Список отмеченных врачом услуг, расхождения по длительности и новые позиции.',
    scope: 'branch',
    mode: 'single',
    after: 'services_pick',
    verify: 'mis',
    slaHours: 8,
    checklist: 'Услуги отмечены врачом и внесены в МИС'
  },
  {
    key: 'callcenter',
    title: 'Принять выгрузку данных врача',
    hint: 'Задача одна на двоих: кто первым взял, за тем и закрепляется.',
    scope: 'network',
    mode: 'race',
    after: 'services_mis',
    verify: 'manual',
    slaHours: 8,
    checklist: 'Данные врача выгружены и приняты старшим сотрудником колл-центра'
  }
];

// Выбор услуг врачом — не задача сотрудника, поэтому в STEPS его нет: он не
// назначается, у него нет исполнителя внутри клиники и он не попадает в
// настройки. Но остальные шаги на него ссылаются через after, а чек-лист ждёт
// его закрытия, поэтому ключ должен быть один и объявлен явно.
const DOCTOR_STEP = 'services_pick';
const DOCTOR_STEP_SLA_HOURS = 48;

const byKey = new Map(STEPS.map(s => [s.key, s]));

function getStep(key) {
  return byKey.get(key) || null;
}

/** Шаги, которые запускаются сразу после закрытия указанного (или после согласования). */
function stepsAfter(key) {
  return STEPS.filter(s => s.after === key);
}

/**
 * Что показывать в колонке доски. Стадия — производная от задач, а не отдельное
 * поле: на параллельном шаге одновременно живут четыре ветки, и одним хранимым
 * статусом это не описать. Источник правды при этом остаётся один — состояние
 * заявки и её задач, а не две записи, которые могут разойтись.
 *
 * @param {Object} app       Заявка
 * @param {Array}  tasks     Её задачи
 * @returns {{key: string, label: string}}
 */
function stageOf(app, tasks = []) {
  if (app.status !== STATUS.MIS_CREATED) {
    return { key: app.status, label: STATUS_LABELS[app.status] || app.status };
  }

  const done = new Set(tasks.filter(t => t.completedAt).map(t => t.stepKey));

  if (!done.has(DOCTOR_STEP)) return { key: 'launch', label: 'Запуск / выбор услуг' };
  if (!done.has('services_mis')) return { key: 'accounting', label: 'Услуги у бухгалтера' };
  if (!done.has('callcenter')) return { key: 'callcenter', label: 'Выгрузка в колл-центр' };
  return { key: 'finishing', label: 'Заканчиваются ветки' };
}

/**
 * Чек-лист готовности из шага 7 ТЗ. Пункты — это те же шаги: держать их отдельным
 * списком значило бы описать процесс дважды и однажды разойтись.
 */
function checklistOf(tasks = []) {
  const done = new Set(tasks.filter(t => t.completedAt).map(t => t.stepKey));
  const items = STEPS
    .filter(s => s.checklist)
    .map(s => ({ key: s.key, title: s.checklist, done: done.has(s.key) }));

  // Выбор услуг врачом в STEPS не входит, но в чек-листе он нужен — иначе
  // «услуги внесены» окажется единственным следом от целой ветки.
  items.splice(1, 0, {
    key: DOCTOR_STEP,
    title: 'Врач отметил услуги, которые будет оказывать',
    done: done.has(DOCTOR_STEP)
  });

  return items;
}

/** Все ли пункты чек-листа закрыты — условие перевода в «Запущен». */
function isReadyToLaunch(tasks = []) {
  return checklistOf(tasks).every(item => item.done);
}

module.exports = {
  STATUS,
  STATUS_LABELS,
  ACTIVE_STATUSES,
  STEPS,
  DOCTOR_STEP,
  DOCTOR_STEP_SLA_HOURS,
  getStep,
  stepsAfter,
  stageOf,
  checklistOf,
  isReadyToLaunch
};
