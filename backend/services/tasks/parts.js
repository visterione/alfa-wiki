/**
 * Части задачи: производный статус, формат, трудозатраты, правило переносов.
 *
 * Ничего из этого в базе не хранится — всё выводится из частей. Хранить статус
 * задачи рядом со статусами её частей значит завести два источника правды,
 * которые разойдутся на первом же переносе, и потом объяснять, почему задача
 * «готова», а одна часть в работе.
 */

/**
 * Человеческие названия статусов — для уведомлений.
 *
 * Дубль фронтового STATUS_LABEL, и это осознанно: в push уходит готовый текст,
 * собранный на сервере, и слово «review» в нём читалось бы как ошибка.
 */
const STATUS_LABEL = {
  new: 'не обработана',
  plan: 'в плане',
  work: 'в работе',
  review: 'на проверке',
  done: 'готово',
  stuck: 'анализируется',
};

/** Статусы части. */
const STATUS = {
  NEW: 'new',        // исполнитель ещё не разобрал — лежит во входящих
  PLAN: 'plan',      // поставлена в план, день не наступил
  WORK: 'work',
  REVIEW: 'review',
  DONE: 'done',
  STUCK: 'stuck',    // переносится третий раз, требует решения
};

/** Форматы задачи. Выводятся из состава исполнителей, не хранятся. */
const MODE = {
  SINGLE: 'single',  // один исполнитель
  SHARED: 'shared',  // одна на всех: время тратит каждый
  SPLIT: 'split',    // разделена, у каждого свой кусок
  MIXED: 'mixed',    // часть кусков личные, часть общие
};

/**
 * После скольких переносов часть перестаёт двигаться молча.
 *
 * Три — не круглое число ради красоты: два переноса это обычная жизнь, а на
 * третий становится ясно, что задача либо слишком крупная, либо на самом деле
 * не нужна. Дальше система просит решение — разбить, передоговориться или
 * отменить, — и кнопки «перенести ещё раз» не предлагает.
 */
const STUCK_AFTER_MOVES = 3;

const assigneesOf = part => (part?.assignees || []).map(a => a.userId);

/**
 * Статус задачи из статусов частей.
 *
 * Порядок проверок — это приоритет тревоги: застрявшая часть важнее того, что
 * остальные в работе, иначе задача, которую четвёртый день не могут начать,
 * выглядела бы благополучной.
 */
function taskStatus(parts) {
  const list = parts || [];
  if (!list.length) return STATUS.NEW;
  const statuses = list.map(p => p.status);
  if (statuses.every(s => s === STATUS.DONE)) return STATUS.DONE;
  if (statuses.includes(STATUS.STUCK)) return STATUS.STUCK;
  if (statuses.includes(STATUS.WORK)) return STATUS.WORK;
  if (statuses.includes(STATUS.REVIEW)) return STATUS.REVIEW;
  if (statuses.every(s => s === STATUS.NEW)) return STATUS.NEW;
  return STATUS.WORK;
}

/** Формат задачи по составу исполнителей её частей. */
function taskMode(parts) {
  const list = parts || [];
  const multi = list.filter(p => assigneesOf(p).length > 1).length;
  const single = list.filter(p => assigneesOf(p).length === 1).length;
  if (list.length === 1 && multi) return MODE.SHARED;
  if (multi && single) return MODE.MIXED;
  if (list.length > 1) return MODE.SPLIT;
  return MODE.SINGLE;
}

/** Все участники задачи без повторов. */
function taskPeople(parts) {
  const out = new Set();
  for (const part of parts || []) {
    for (const id of assigneesOf(part)) out.add(id);
  }
  return [...out];
}

/**
 * Суммарные трудозатраты.
 *
 * Оценка умножается на число исполнителей: общая часть на 2 ч для троих — это
 * 2 ч в календаре у каждого и 6 ч трудозатрат. Складывать их как 2 ч значит
 * недосчитать ровно ту работу, ради учёта которой модуль и делается.
 */
function totalEffortHours(parts) {
  let sum = 0;
  for (const part of parts || []) {
    const count = assigneesOf(part).length || 1;
    sum += Number(part.estimateHours || 0) * count;
  }
  return Math.round(sum * 100) / 100;
}

/**
 * Части, которые лежат у человека во входящих: он числится исполнителем, но
 * ещё не назначил себе день.
 *
 * Именно отсутствие plannedDate, а не статус, отличает «не обработана» от
 * «работа идёт». Обычная доска показывает такую задачу в «К выполнению» и
 * создаёт впечатление, что дело движется.
 */
function inboxFor(parts, userId) {
  return (parts || []).filter(part =>
    (part.assignees || []).some(a => a.userId === userId && !a.plannedDate && !a.declinedAt)
  );
}

/** Достигла ли часть порога, после которого перенос требует решения. */
function isStuck(part) {
  return Number(part?.moveCount || 0) >= STUCK_AFTER_MOVES;
}

/**
 * Можно ли просто перенести часть ещё раз.
 *
 * Разводится с isStuck намеренно: интерфейс обязан не прятать кнопку молча, а
 * заменять её выбором из трёх решений.
 */
function canMoveSilently(part) {
  return !isStuck(part);
}

/**
 * Готова ли часть к работе: все, после кого она идёт, завершены.
 *
 * Пока не готова — она не предлагается исполнителю в календарь. Связь «после»
 * это не пометка на схеме, а условие появления части во входящих.
 */
function isUnblocked(part, partsById, deps) {
  const before = (deps || [])
    .filter(d => d.partId === part.id)
    .map(d => partsById[d.afterPartId])
    .filter(Boolean);
  return before.every(p => p.status === STATUS.DONE);
}

/**
 * Поиск цикла в связях «после».
 *
 * Цикл здесь не теоретический риск: достаточно в форме задачи назначить двум
 * частям друг друга, и планировщик уйдёт в бесконечное ожидание готовности.
 * Проверять надо при сохранении, а не при отрисовке схемы.
 */
function findCycle(parts, deps) {
  const graph = new Map((parts || []).map(p => [p.id, []]));
  for (const dep of deps || []) {
    if (graph.has(dep.partId)) graph.get(dep.partId).push(dep.afterPartId);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const state = new Map([...graph.keys()].map(id => [id, WHITE]));
  const stack = [];

  function walk(id) {
    state.set(id, GREY);
    stack.push(id);
    for (const next of graph.get(id) || []) {
      if (!state.has(next)) continue;
      if (state.get(next) === GREY) return [...stack.slice(stack.indexOf(next)), next];
      if (state.get(next) === WHITE) {
        const found = walk(next);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, BLACK);
    return null;
  }

  for (const id of graph.keys()) {
    if (state.get(id) === WHITE) {
      const cycle = walk(id);
      if (cycle) return cycle;
    }
  }
  return null;
}

module.exports = {
  STATUS,
  STATUS_LABEL,
  MODE,
  STUCK_AFTER_MOVES,
  assigneesOf,
  taskStatus,
  taskMode,
  taskPeople,
  totalEffortHours,
  inboxFor,
  isStuck,
  canMoveSilently,
  isUnblocked,
  findCycle,
};
