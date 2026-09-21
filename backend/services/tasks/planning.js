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
 * Ёмкость окна работы: помещается ли оценка в [startDate..dueDate] целиком.
 *
 * Это тот же вопрос, на который для однодневной части отвечает
 * assessAssignment, но заданный про несколько дней. Ёмкость считается суммой
 * остатков по дням, а не «норма × дни минус занятое»: перегруженный вторник не
 * должен компенсироваться пустой пятницей — см. freeOverPeriod в workload, там
 * же и причина.
 *
 * Выходные и отпуск из окна выпадают молча, и это правильно: окно «с понедельника
 * по пятницу» человек задаёт календарными датами, а работать в нём собирается в
 * свои рабочие дни. Окно, в котором рабочих дней не осталось совсем, — отдельный
 * ответ, а не ноль ёмкости: «не помещается» и «работать в эти дни нельзя вообще»
 * требуют от автора разных решений.
 */
function assessWindow({ days, estimateHours }) {
  const list = Array.isArray(days) ? days : [];
  const working = list.filter(day => !day.onVacation && !day.onDayOff && day.norm);
  if (!working.length) {
    const reason = list.some(day => day.onVacation) ? 'vacation'
      : list.some(day => !day.onDayOff && !day.norm) ? 'no_norm' : 'day_off';
    return {
      fits: false, reason, capacity: 0, workingDays: 0,
      need: round(Number(estimateHours) || 0), over: round(Number(estimateHours) || 0),
    };
  }
  const capacity = round(working.reduce((sum, day) => sum + Number(day.free || 0), 0));
  const need = round(Number(estimateHours) || 0);
  const fits = need <= capacity + 1e-9;
  return {
    fits,
    reason: fits ? 'ok' : 'overload',
    capacity,
    workingDays: working.length,
    need,
    over: fits ? 0 : round(need - capacity),
  };
}

/**
 * Проверка раскладки часов по дням окна.
 *
 * Раскладывает человек, а не система. Автоматического «поровну по дням» в модуле
 * нет намеренно: ровный слой молча влезает в уже плотный день и перегружает
 * его — ровно то, против чего модуль затевался. Поэтому здесь не расчёт, а
 * проверка того, что человек составил сам.
 *
 * Сумма обязана совпасть с оценкой до копейки. Соблазн принять «почти столько»
 * велик, но оценка — это то, что автор и исполнитель друг другу обещали, и
 * раскладка, которая её не покрывает, означает недоговорённость, а не округление.
 *
 * Переработка допускается, но не молча: перегруженные дни возвращаются списком,
 * и маршрут обязан либо получить подтверждение, либо отказать. Это то же
 * правило, что и у однодневной постановки, — взять сверх нормы можно, это своё
 * решение исполнителя.
 */
const LAYOUT_STEP = 0.25;

function validateLayout({ entries, estimateHours, days }) {
  const byDate = new Map((days || []).map(day => [day.date, day]));
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) {
    return { ok: false, error: 'Разложите часы по дням окна' };
  }

  const layout = [];
  const seen = new Set();
  const overloads = [];
  for (const row of rows) {
    const date = String(row?.date || '').slice(0, 10);
    const hours = Number(row?.hours || 0);
    const day = byDate.get(date);
    if (!day) {
      return { ok: false, error: `${date} — этот день за пределами окна подзадачи` };
    }
    if (seen.has(date)) {
      return { ok: false, error: `${date} указан дважды` };
    }
    seen.add(date);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    if (Math.abs(hours / LAYOUT_STEP - Math.round(hours / LAYOUT_STEP)) > 1e-9) {
      return { ok: false, error: 'Часы кратны 15 минутам' };
    }
    if (day.onVacation) return { ok: false, error: `${date} — у вас отпуск` };
    if (day.onDayOff || !day.norm) {
      return { ok: false, error: `${date} не входит в ваше рабочее расписание` };
    }
    const after = round(Number(day.hours || 0) + hours);
    if (after > Number(day.norm) + 1e-9) {
      overloads.push({ date, after, norm: round(Number(day.norm)), over: round(after - Number(day.norm)) });
    }
    layout.push({ date, hours: round(hours) });
  }

  if (!layout.length) return { ok: false, error: 'Разложите часы по дням окна' };

  const total = round(layout.reduce((sum, row) => sum + row.hours, 0));
  const need = round(Number(estimateHours) || 0);
  if (Math.abs(total - need) > 0.005) {
    return {
      ok: false,
      error: total < need
        ? `Разложено ${total} ч из ${need} — не хватает ${round(need - total)} ч`
        : `Разложено ${total} ч вместо ${need} — лишние ${round(total - need)} ч`,
      total,
      need,
    };
  }

  layout.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { ok: true, layout, total, overloads };
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
  LAYOUT_STEP,
  nextFloatingSlot,
  afterMove,
  splitEstimate,
  assessAssignment,
  assessWindow,
  validateLayout,
  validateForce,
};
