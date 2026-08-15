/**
 * Планирование: постановка части в план, перенос, согласование срока.
 *
 * Здесь происходит единственное, ради чего модуль связан с календарём: часть
 * задачи, поставленная в план, превращается в блок времени и начинает занимать
 * часы. Пока не поставлена — не занимает ничего и лежит во входящих.
 *
 * Функции разделены на чистые (расчёт времени блока, решение о застревании) и
 * те, что пишут в базу. Первые проверяются тестами без БД, вторые — тонкие
 * обёртки над ними.
 */

const { STATUS, STUCK_AFTER_MOVES } = require('./parts');

/**
 * Час, с которого выкладываются плавающие блоки.
 *
 * У рабочего блока нет времени начала — есть день и длительность. Но хранить
 * его в календаре нужно с какими-то часами, и полночь для этого не годится:
 * существующий день-вью нарисовал бы отчёт в три часа ночи. Поэтому блоки
 * складываются подряд от начала рабочего дня — ровно так же, как это делает
 * прототип. Время у них условное, и интерфейс модуля его не показывает.
 */
const WORK_DAY_START = 9;

/** Часы события. Дубль из workload намеренно не делается — берём оттуда. */
const { hoursOf } = require('./workload');

/**
 * Куда встанет новый плавающий блок: после всех уже выложенных за этот день.
 *
 * Жёсткие встречи в расчёт не идут — они стоят в своё время, и обтекать их
 * рабочими блоками бессмысленно: время у блока всё равно условное.
 */
function nextFloatingSlot(existingEvents, date, durationHours, workStart = '09:00') {
  const floating = (existingEvents || []).filter(e => e.isFloating);
  const used = floating.reduce((sum, e) => sum + hoursOf(e), 0);
  const start = new Date(`${date}T00:00:00`);
  const [startHour, startMinute] = /^\d{2}:\d{2}$/.test(workStart)
    ? workStart.split(':').map(Number) : [WORK_DAY_START, 0];
  start.setHours(startHour, startMinute, 0, 0);
  start.setTime(start.getTime() + used * 3600000);
  const end = new Date(start.getTime() + durationHours * 3600000);
  return { startTime: start, endTime: end, dayOrder: floating.length };
}

/**
 * Что делать с частью после переноса.
 *
 * Возвращает новый статус и признак того, что молчаливый перенос закончился.
 * После третьего раза часть уходит в «анализируется», и интерфейс обязан не
 * прятать кнопку, а заменить её выбором из трёх решений: разбить,
 * передоговориться, отменить.
 */
function afterMove(part) {
  const moveCount = Number(part?.moveCount || 0) + 1;
  const stuck = moveCount >= STUCK_AFTER_MOVES;
  return {
    moveCount,
    status: stuck ? STATUS.STUCK : STATUS.PLAN,
    requiresDecision: stuck,
  };
}

/**
 * Разбиение застрявшей части.
 *
 * Не косметика: смысл в том, чтобы кусок стал достаточно мелким и наконец
 * поместился в день. Поэтому счётчик переносов обнуляется — это уже другая
 * работа, и наследовать ей приговор предыдущей неправильно.
 */
function splitEstimate(part, firstHours) {
  const total = Number(part.estimateHours);
  const head = Math.min(Math.max(Number(firstHours) || 0, 0.25), total - 0.25);
  return { head: round(head), tail: round(total - head) };
}

/**
 * Проверка при постановке задачи: помещается ли и какие есть выходы.
 *
 * Возвращает не «да/нет», а разбор: сколько станет, сколько норма, и что можно
 * сделать. Автор обязан выбрать до того, как задача уйдёт человеку — в этом
 * вся идея: решение принимается здесь, а не всплывает потом переносом.
 */
function assessAssignment({ currentHours, norm, estimateHours, onVacation = false, onDayOff = false }) {
  if (onVacation) {
    return { fits: false, reason: 'vacation', after: null, norm, free: 0 };
  }
  if (onDayOff) {
    return { fits: false, reason: 'day_off', after: null, norm: 0, free: 0 };
  }
  if (!norm || norm <= 0) {
    return { fits: false, reason: 'no_norm', after: null, norm: null, free: 0 };
  }
  const after = round(Number(currentHours) + Number(estimateHours));
  const fits = after <= norm + 1e-9;
  return {
    fits,
    reason: fits ? 'ok' : 'overload',
    after,
    norm: round(norm),
    free: round(Math.max(0, norm - after)),
    over: fits ? 0 : round(after - norm),
  };
}

/**
 * Обход проверки загрузки.
 *
 * Обойти можно всегда — запрещать руководителю ставить срочную задачу означало
 * бы, что модулем перестанут пользоваться в тот день, когда случится первый
 * настоящий аврал. Но не молча: объяснение уходит исполнителю и остаётся в
 * истории задачи. Восемь символов — не проверка качества текста, а отсечка
 * от пустой строки и «ок».
 */
const MIN_EXPLANATION = 8;

function validateForce(explanation) {
  const text = String(explanation || '').trim();
  if (text.length < MIN_EXPLANATION) {
    return { ok: false, error: 'Объяснение обязательно: оно уйдёт исполнителю и останется в истории задачи' };
  }
  return { ok: true, text };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

module.exports = {
  WORK_DAY_START,
  MIN_EXPLANATION,
  nextFloatingSlot,
  afterMove,
  splitEstimate,
  assessAssignment,
  validateForce,
};
