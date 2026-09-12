'use strict';

/**
 * Процесс как данные: виды шагов и проверка процесса, собранного в
 * конструкторе (ver. 8.20).
 *
 * В первом поколении шаги лежали в коде, и в комментарии к ним стояло, что
 * делать их редактируемыми незачем — процесс описан в ТЗ и меняется раз в
 * никогда. Это было верно, пока процесс был один. Для медсестры и технички он
 * другой: нет услуг, нет карточки на сайте, нет расписания — и заводить под
 * каждую должность копию process.js как раз и означало бы «хардкодить».
 *
 * Граница со старым решением сохранена там, где она была настоящей: в данных
 * живёт «когда» (шаги, порядок, сроки, исполнители), в коде — «чем» (умения,
 * которые ходят в «Реновацию», и экран выбора услуг). Умение нельзя создать в
 * конструкторе, его можно только выбрать из списка.
 *
 * Ветвлений в движке нет намеренно: зависимость — это список предшественников,
 * шаг ждёт всех сразу. «Если филиал такой-то, то» превратило бы конструктор в
 * язык программирования, а разные ветки для разных филиалов выражаются разными
 * шаблонами.
 */

// ── Виды шагов ─────────────────────────────────────────────────────────────
//
// unique        — такой шаг в шаблоне может быть только один.
// assignee      — у шага есть исполнитель из сотрудников; без него шаг некому
//                 закрыть.
// ability       — за шагом стоит код, ходящий в «Реновацию» или рисующий
//                 кандидату экран. Такие виды не создаются, а выбираются.
// requiresKind  — чего не хватает шагу для работы: mis_account отдаёт doctor_id,
//                 без которого остальным шагам с МИС нечего спрашивать.
// requiresRole  — какое поле анкеты шагу нужно.
// forcedScope   — шаг не бывает другим: выбор услуг закрывает сам кандидат.
const STEP_KINDS = {
  decision: {
    label: 'Решение по анкете',
    hint: 'Согласовать, вернуть на доработку или отклонить. Ровно один на шаблон, с него начинается весь процесс.',
    unique: true,
    assignee: true
  },
  manual: {
    label: 'Отметка исполнителя',
    hint: 'Человек делает работу и отмечает, что сделал. Таких шагов может быть сколько угодно.',
    assignee: true
  },
  mis_account: {
    label: 'Создать пользователя в «Реновации»',
    hint: 'Проверяется чтением из МИС. Отдаёт doctor_id, без которого не работают остальные шаги с МИС.',
    unique: true,
    assignee: true,
    ability: true
  },
  mis_schedule: {
    label: 'Расписание в «Реновации»',
    hint: 'Проверяется чтением из МИС: появились ли слоты.',
    unique: true,
    assignee: true,
    ability: true,
    requiresKind: ['mis_account']
  },
  mis_services: {
    label: 'Внести услуги в «Реновацию»',
    hint: 'Сверка советующая: отмеченное кандидатом — заявка «умею», а не решение клиники.',
    unique: true,
    assignee: true,
    ability: true,
    requiresKind: ['mis_account', 'services_pick'],
    requiresRole: ['professions']
  },
  services_pick: {
    label: 'Выбор услуг кандидатом',
    hint: 'Кандидат отмечает по прайсу, что готов оказывать. Исполнителя внутри клиники у шага нет.',
    unique: true,
    ability: true,
    requiresKind: ['mis_account'],
    requiresRole: ['professions'],
    forcedScope: 'candidate'
  }
};

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
 * без поля со специальностями шаг выбора услуг нечем наполнить — прайс
 * подтягивается именно по специальности.
 *
 * @param {*} raw    то, что прислал редактор
 * @param {*} form   анкета того же шаблона (уже проверенная)
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

    // Запирает ли неудачная сверка шаг. Осмысленно только у шагов с умением:
    // у ручного сверять нечего.
    if (kindSpec.ability && stepRaw.blocking === false) step.blocking = false;

    if (archived) step.archived = true;

    steps.push(step);
  }

  const byKey = new Map(steps.map(s => [s.key, s]));
  const active = steps.filter(s => !s.archived);

  // ── Единственность и требования видов ───────────────────────────────────
  for (const [kind, spec] of Object.entries(STEP_KINDS)) {
    if (spec.unique && (kindCount.get(kind) || 0) > 1) {
      errors.push(`Шагов вида «${spec.label}» в шаблоне больше одного`);
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

    for (const needed of spec.requiresKind || []) {
      if (!activeKinds.has(needed)) {
        errors.push(`Шагу «${step.title}» нужен шаг «${STEP_KINDS[needed].label}» — без него ему нечего спрашивать`);
      }
    }

    for (const role of spec.requiresRole || []) {
      const has = (form?.blocks || []).some(b => !b.repeat && (b.fields || []).some(f => f.role === role));
      if (!has) {
        errors.push(`Шагу «${step.title}» нужно поле анкеты с ролью «${role === 'professions' ? 'Специальности' : role}»`);
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
  assignableSteps,
  stepsAfter,
  getStep,
  checklistSteps
};
