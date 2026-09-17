'use strict';

/**
 * Процесс как данные: виды шагов и проверка процесса, собранного в
 * конструкторе (ver. 8.20, переработано в 8.21).
 *
 * В первом поколении шаги лежали в коде, и в комментарии к ним стояло, что
 * делать их редактируемыми незачем — процесс описан в ТЗ и меняется раз в
 * никогда. Это было верно, пока процесс был один. Для медсестры и технички он
 * другой: нет услуг, нет карточки на сайте, нет расписания — и заводить под
 * каждую должность копию process.js как раз и означало бы «хардкодить».
 *
 * Граница между данными и кодом сохранена там, где она настоящая: в данных
 * живёт «когда» (шаги, порядок, сроки, исполнители), в коде — «чем». После
 * отказа от сверок с МИС в коде остался ровно один особый шаг — экран выбора
 * услуг; создать такой шаг в конструкторе нельзя, его можно только выбрать.
 *
 * Ветвлений в движке нет намеренно: зависимость — это список предшественников,
 * шаг ждёт всех сразу. «Если филиал такой-то, то» превратило бы конструктор в
 * язык программирования, а разные ветки для разных должностей и филиалов
 * выражаются разными вакансиями.
 */

// ── Виды шагов ─────────────────────────────────────────────────────────────
//
// unique        — такой шаг в вакансии может быть только один.
// assignee      — у шага есть исполнитель из сотрудников; без него шаг некому
//                 закрыть.
// requiresRole  — какое поле анкеты шагу нужно.
// requiresStage — шагу нужен этап анкеты: показывать нечего, если в анкете нет
//                 ни одного шага «после согласования».
// forcedScope   — шаг не бывает другим: выбор услуг закрывает сам кандидат.
//
// В 8.20 видов было шесть: три из них ходили в «Реновацию» и подтверждали
// отметку исполнителя чтением из МИС. В 8.21 они убраны по решению заказчика —
// выигрыш от «спросить систему вместо галочки» не окупал ни зависимости от
// доступности МИС, ни объяснений сотруднику, почему шаг не закрывается. Все
// такие шаги стали обычной отметкой «готово».
//
// Особый вид остался один — выбор услуг кандидатом: у него нет исполнителя
// внутри клиники и есть свой экран.
const STEP_KINDS = {
  decision: {
    label: 'Решение по анкете',
    hint: 'Согласовать, вернуть на доработку или отклонить. Ровно один на вакансию, с него начинается весь процесс.',
    unique: true,
    assignee: true
  },
  manual: {
    label: 'Отметка исполнителя',
    hint: 'Человек делает работу и отмечает, что сделал. Таких шагов может быть сколько угодно.',
    assignee: true
  },
  services_pick: {
    label: 'Выбор услуг кандидатом',
    hint: 'Кандидат отмечает по прайсу филиала, что готов оказывать. Исполнителя внутри клиники у шага нет.',
    unique: true,
    requiresRole: ['speciality'],
    forcedScope: 'candidate'
  },
  // Второй этап анкеты (ver. 8.37). Паспорт, военный билет и трудовую
  // спрашивают у того, кому уже дали зелёный свет, — до решения по анкете это и
  // невежливо, и бесполезно: их всё равно не пришлют.
  //
  // Устроен так же, как выбор услуг: исполнителя внутри клиники нет, шаг
  // открывается, кандидату уходит письмо со ссылкой, и закрывается он тем, что
  // человек отправил вторую часть анкеты.
  form_extra: {
    label: 'Дозаполнение анкеты кандидатом',
    hint: 'Кандидат заполняет шаги анкеты, помеченные «после согласования». Исполнителя внутри клиники у шага нет.',
    unique: true,
    requiresStage: 'after',
    forcedScope: 'candidate'
  }
};

// ── Возврат назад (ver. 8.38) ──────────────────────────────────────────────
//
// До 8.38 вернуть работу мог только шаг решения и только до старта процесса:
// после согласования анкеты кандидат уже ничего не переделывал. Но документы на
// трудоустройство он присылает как раз после согласования, и юристу, который их
// проверяет, нужно то же самое, что главврачу, — «вот это поправьте».
//
// Сделано настройкой шага, а не ещё одним видом: возвращать умеет обычная
// отметка исполнителя, у которой указано, на какой шаг откатывать (`returnTo`).
// Отдельный вид «проверка документов» позволил бы ровно один такой шаг на
// вакансию — а проверяющих бывает двое (юрист по паспорту, бухгалтер по
// трудовой), и у каждого свой круг.
//
// Возвращать можно только на шаг, от которого этот зависит: иначе переоткрытый
// шаг не приведёт работу обратно, и задача проверяющего просто исчезнет.
// Отказать проверяющий не может — решение о найме остаётся за шагом решения
// (решение заказчика от 17.09.2026).

const SCOPES = {
  branch:    { label: 'Свой в каждом филиале' },
  network:   { label: 'Один на всю сеть' },
  candidate: { label: 'Закрывает кандидат' }
};

// Ключ шага лежит строками в задачах и назначениях, поэтому его вид ограничен
// так же, как у полей анкеты. Подчёркивание в начале зарезервировано под
// служебные точки назначений (сейчас это '_escalation'), и шагом такой ключ
// быть не может.
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/;

// Служебная точка: кому писать о просрочке. Не шаг — у неё нет задачи и
// чек-листа, — но исполнитель у неё назначается тем же способом.
const ESCALATION_KEY = '_escalation';

const MAX_STEPS = 40;
const MAX_SLA_HOURS = 2000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function trimmed(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/**
 * Проверка и нормализация процесса.
 *
 * Анкета нужна вторым аргументом, потому что часть требований шага живёт в ней:
 * без поля со специальностью шаг выбора услуг нечем наполнить — раздел прайса
 * подтягивается именно по ней.
 *
 * @param {*} raw    то, что прислал редактор
 * @param {*} form   анкета той же вакансии (уже проверенная)
 * @returns {{ errors: string[], process: object }}
 */
function validateProcess(raw, form) {
  const errors = [];
  const source = isPlainObject(raw) ? raw : {};
  const stepsRaw = Array.isArray(source.steps) ? source.steps : [];

  if (stepsRaw.length > MAX_STEPS) errors.push(`Шагов больше ${MAX_STEPS}`);

  const steps = [];
  const keys = new Set();
  const kindCount = new Map();

  for (const [index, stepRaw] of stepsRaw.entries()) {
    if (!isPlainObject(stepRaw)) { errors.push(`Шаг №${index + 1} испорчен`); continue; }

    const key = trimmed(stepRaw.key, 60);
    const title = trimmed(stepRaw.title, 200);
    const where = title || key || `№${index + 1}`;

    if (!KEY_RE.test(key)) {
      errors.push(`Шаг «${where}»: ключ «${key}» не подходит — нужны латиница, цифры и подчёркивание, начиная с буквы`);
      continue;
    }
    if (keys.has(key)) { errors.push(`Ключ шага «${key}» встречается дважды`); continue; }
    keys.add(key);

    if (!title) errors.push(`Шаг «${key}»: не заполнено название`);

    const kind = trimmed(stepRaw.kind, 30) || 'manual';
    const kindSpec = STEP_KINDS[kind];
    if (!kindSpec) { errors.push(`Шаг «${where}»: неизвестный вид «${kind}»`); continue; }

    kindCount.set(kind, (kindCount.get(kind) || 0) + 1);

    const archived = Boolean(stepRaw.archived);

    const step = { key, title, kind };

    const hint = trimmed(stepRaw.hint, 500);
    if (hint) step.hint = hint;

    // Область у шага с умением не спрашивается, а задаётся: выбор услуг
    // закрывает кандидат, и «свой исполнитель в филиале» у него бессмыслен.
    let scope = trimmed(stepRaw.scope, 20);
    if (kindSpec.forcedScope) {
      scope = kindSpec.forcedScope;
    } else if (!SCOPES[scope] || scope === 'candidate') {
      if (scope === 'candidate') {
        errors.push(`Шаг «${where}»: кандидат закрывает только выбор услуг`);
      }
      scope = 'branch';
    }
    step.scope = scope;

    const after = Array.isArray(stepRaw.after) ? stepRaw.after.filter(k => typeof k === 'string') : [];
    step.after = [...new Set(after)];

    const slaHours = Number(stepRaw.slaHours);
    if (Number.isFinite(slaHours) && slaHours > 0) {
      step.slaHours = Math.min(Math.round(slaHours), MAX_SLA_HOURS);
    } else if (!archived) {
      errors.push(`Шаг «${where}»: не задан срок в рабочих часах`);
    }

    const checklist = trimmed(stepRaw.checklist, 300);
    if (checklist) step.checklist = checklist;
    else if (!archived) errors.push(`Шаг «${where}»: не заполнена строка чек-листа — по ней видно, что именно закрыто`);

    // Куда шаг умеет вернуть работу. Проверяется ниже, когда известны все шаги:
    // здесь ещё не с чем сверять.
    const returnTo = trimmed(stepRaw.returnTo, 60);
    if (returnTo) {
      if (kind !== 'manual') {
        errors.push(`Шаг «${where}»: возвращать работу назад умеет только отметка исполнителя`);
      } else {
        step.returnTo = returnTo;
      }
    }

    if (archived) step.archived = true;

    steps.push(step);
  }

  const byKey = new Map(steps.map(s => [s.key, s]));
  const active = steps.filter(s => !s.archived);

  // ── Единственность и требования видов ───────────────────────────────────
  for (const [kind, spec] of Object.entries(STEP_KINDS)) {
    if (spec.unique && (kindCount.get(kind) || 0) > 1) {
      errors.push(`Шагов вида «${spec.label}» в вакансии больше одного`);
    }
  }

  const activeKinds = new Set(active.map(s => s.kind));

  if (steps.length) {
    if (!activeKinds.has('decision')) {
      errors.push('В процессе нет шага решения — заявку будет некому согласовать');
    }
    const decision = active.find(s => s.kind === 'decision');
    if (decision && decision.after.length) {
      errors.push(`Шаг решения «${decision.title}» не может ничего ждать: с него начинается процесс`);
    }
  }

  for (const step of active) {
    const spec = STEP_KINDS[step.kind];

    for (const role of spec.requiresRole || []) {
      const has = (form?.blocks || []).some(b => !b.repeat && (b.fields || []).some(f => f.role === role));
      if (!has) {
        errors.push(`Шагу «${step.title}» нужно поле анкеты с ролью «Специальность» — по ней подтягивается раздел прайса`);
      }
    }

    // Шаг дозаполнения без второго этапа в анкете открылся бы и показал
    // кандидату пустую страницу — а закрыть его было бы нечем: закрывает он сам
    // отправкой, отправлять нечего.
    if (spec.requiresStage) {
      const has = (form?.steps || []).some(s => (s.stage || 'initial') === spec.requiresStage);
      if (!has) {
        errors.push(
          `Шагу «${step.title}» нечего показывать: в анкете нет ни одного шага, помеченного «после согласования»`
        );
      }
    }

    // ── Зависимости ──────────────────────────────────────────────────────
    if (step.kind !== 'decision' && !step.after.length) {
      errors.push(`Шаг «${step.title}» ничего не ждёт — он не появится ни у кого. Как минимум он идёт после решения по анкете`);
    }

    for (const parent of step.after) {
      const target = byKey.get(parent);
      if (!target) {
        errors.push(`Шаг «${step.title}» ждёт шага «${parent}», которого в процессе нет`);
      } else if (target.archived) {
        // Заархивированный шаг не закроется никогда, и всё, что его ждёт,
        // молча зависнет.
        errors.push(`Шаг «${step.title}» ждёт шага «${target.title}», а тот в архиве — дождаться его нельзя`);
      } else if (parent === step.key) {
        errors.push(`Шаг «${step.title}» ждёт сам себя`);
      }
    }

    // ── Куда возвращать ──────────────────────────────────────────────────
    if (step.returnTo) {
      const back = byKey.get(step.returnTo);
      if (!back || back.archived) {
        errors.push(`Шаг «${step.title}»: возвращать некуда — шага «${step.returnTo}» в процессе нет или он в архиве`);
      } else if (!ancestorsOf(steps, step.key).has(step.returnTo)) {
        // Возврат на шаг, от которого этот не зависит, оставил бы проверяющего
        // ни с чем: переоткрытый шаг закроется, а его задача обратно не придёт.
        errors.push(`Шаг «${step.title}» не зависит от «${back.title}» — вернуть работу туда нельзя, она не придёт обратно`);
      }
    }
  }

  // ── Кольца ──────────────────────────────────────────────────────────────
  //
  // Без этой проверки кольцо не проявится никак: процесс просто не тронется с
  // места, и причину искать будет негде — ни ошибки, ни задачи, ни события.
  const cycle = findCycle(active);
  if (cycle) {
    errors.push(`Шаги ждут друг друга по кругу: ${cycle.map(k => byKey.get(k)?.title || k).join(' → ')}`);
  }

  return { errors, process: { steps } };
}

/**
 * Поиск кольца обходом в глубину. Возвращает сам круг, а не просто «есть» —
 * список из пяти шагов человек разберёт, а «в процессе кольцо» заставит
 * перечитывать все зависимости руками.
 */
function findCycle(steps) {
  const byKey = new Map(steps.map(s => [s.key, s]));
  const state = new Map();
  const stack = [];

  function walk(key) {
    const step = byKey.get(key);
    if (!step) return null;
    if (state.get(key) === 'done') return null;
    if (state.get(key) === 'open') return stack.slice(stack.indexOf(key)).concat(key);

    state.set(key, 'open');
    stack.push(key);
    for (const parent of step.after) {
      const found = walk(parent);
      if (found) return found;
    }
    stack.pop();
    state.set(key, 'done');
    return null;
  }

  for (const step of steps) {
    const found = walk(step.key);
    if (found) return found;
  }
  return null;
}

/**
 * Все шаги, от которых шаг зависит, — прямо и через цепочку.
 *
 * Нужна и проверке («возвращать можно только назад»), и редактору, который по
 * ней предлагает, куда шаг умеет вернуть работу.
 */
function ancestorsOf(steps, key) {
  const byKey = new Map((steps || []).map(s => [s.key, s]));
  const out = new Set();
  const walk = (at) => {
    for (const parent of byKey.get(at)?.after || []) {
      if (out.has(parent) || !byKey.has(parent)) continue;
      out.add(parent);
      walk(parent);
    }
  };
  walk(key);
  return out;
}

/**
 * Все шаги, которые зависят от указанного, — прямо и через цепочку.
 *
 * По ним откатывается работа при возврате: переоткрыть шаг и оставить закрытыми
 * те, что из него выросли, значит получить заявку, у которой проверка пройдена
 * по документам, которых больше нет.
 */
function descendantsOf(steps, key) {
  const out = new Set();
  const active = (steps || []).filter(s => !s.archived);
  let grown = true;
  while (grown) {
    grown = false;
    for (const step of active) {
      if (out.has(step.key)) continue;
      if ((step.after || []).some(k => k === key || out.has(k))) { out.add(step.key); grown = true; }
    }
  }
  return out;
}

/** Шаги, которым нужен исполнитель из сотрудников, — для экрана назначений. */
function assignableSteps(process) {
  return (process?.steps || [])
    .filter(s => !s.archived && STEP_KINDS[s.kind]?.assignee)
    .map(s => ({
      key: s.key,
      title: s.title,
      hint: s.hint || STEP_KINDS[s.kind]?.hint || null,
      scope: s.scope,
      kind: s.kind
    }));
}

/** Шаги, которые запускаются после закрытия указанного. */
function stepsAfter(process, key) {
  return (process?.steps || []).filter(s => !s.archived && s.after?.includes(key));
}

function getStep(process, key) {
  return (process?.steps || []).find(s => s.key === key) || null;
}

/** Чек-лист запуска: что должно быть закрыто, чтобы заявка считалась готовой. */
function checklistSteps(process) {
  return (process?.steps || []).filter(s => !s.archived && s.checklist);
}

module.exports = {
  STEP_KINDS,
  SCOPES,
  KEY_RE,
  ESCALATION_KEY,
  validateProcess,
  findCycle,
  ancestorsOf,
  descendantsOf,
  assignableSteps,
  stepsAfter,
  getStep,
  checklistSteps
};
