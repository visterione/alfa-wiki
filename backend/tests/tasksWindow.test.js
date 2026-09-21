const test = require('node:test');
const assert = require('node:assert/strict');

const planning = require('../services/tasks/planning');
const parts = require('../services/tasks/parts');

/**
 * Многодневная подзадача: окно работы и раскладка часов по его дням (ver. 8.48).
 *
 * Проверяется то, что легко испортить незаметно: «окно в один день», принятая
 * раскладка, которая не покрывает оценку, и молчаливая переработка. Последнее —
 * главное: ровный слой по дням окна выглядит безобидно и перегружает день,
 * которого человек не видел, а именно против этого модуль и затевался.
 */

const day = (date, over = {}) => ({
  date, hours: 0, done: 0, norm: 8, free: 8,
  onVacation: false, onDayOff: false, workStart: '09:00', ...over,
});

test('пустой startDate — это однодневная подзадача, а не окно нулевой длины', () => {
  assert.equal(parts.isWindowed({ dueDate: '2026-09-25' }), false);
  assert.equal(parts.isWindowed({ startDate: null, dueDate: '2026-09-25' }), false);
  // Окно «с 25-го по 25-е» тоже однодневное: иначе интерфейс рисовал бы
  // раскладку там, где выбирать нечего.
  assert.equal(parts.isWindowed({ startDate: '2026-09-25', dueDate: '2026-09-25' }), false);
  assert.equal(parts.isWindowed({ startDate: '2026-09-22', dueDate: '2026-09-25' }), true);

  assert.deepEqual(parts.windowOf({ dueDate: '2026-09-25' }), { from: '2026-09-25', to: '2026-09-25' });
  assert.deepEqual(
    parts.windowOf({ startDate: '2026-09-22', dueDate: '2026-09-25' }),
    { from: '2026-09-22', to: '2026-09-25' }
  );
});

test('период задачи выводится из окон подзадач и считается в календарных днях', () => {
  const span = parts.taskSpan([
    { startDate: '2026-09-22', dueDate: '2026-09-25' },
    { dueDate: '2026-09-29' },
  ]);
  // С 22 по 29 включительно — восемь дней. Выходные не вычитаются: «задача на
  // восемь дней» в разговоре значит именно это.
  assert.deepEqual(span, { from: '2026-09-22', to: '2026-09-29', days: 8 });
  assert.equal(parts.taskSpan([]), null);
});

test('срок задачи нарушается последней подзадачей, а не первой', () => {
  const list = [{ dueDate: '2026-09-23' }, { startDate: '2026-09-24', dueDate: '2026-09-29' }];
  assert.equal(parts.breaksDeadline({ dueDate: '2026-09-25' }, list), true);
  assert.equal(parts.breaksDeadline({ dueDate: '2026-09-30' }, list), false);
  // Задача без своего срока нарушить его не может: обещания не было.
  assert.equal(parts.breaksDeadline({ dueDate: null }, list), false);
});

test('ёмкость окна — сумма остатков, а пустая пятница не лечит перегруженный вторник', () => {
  const days = [
    day('2026-09-22', { hours: 8, free: 0 }),
    day('2026-09-23', { hours: 2, free: 6 }),
    day('2026-09-24'),
  ];
  const fit = planning.assessWindow({ days, estimateHours: 14 });
  assert.equal(fit.capacity, 14);
  assert.equal(fit.fits, true);
  assert.equal(fit.workingDays, 3);

  const tight = planning.assessWindow({ days, estimateHours: 20 });
  assert.equal(tight.fits, false);
  assert.equal(tight.reason, 'overload');
  assert.equal(tight.over, 6);
});

test('окно без рабочих дней — отдельный ответ, а не нулевая ёмкость', () => {
  const off = planning.assessWindow({
    days: [day('2026-09-26', { onDayOff: true, norm: 0, free: 0 })],
    estimateHours: 4,
  });
  assert.equal(off.fits, false);
  assert.equal(off.reason, 'day_off');
  assert.equal(off.workingDays, 0);

  const vacation = planning.assessWindow({
    days: [day('2026-09-26', { onVacation: true, free: 0 })],
    estimateHours: 4,
  });
  assert.equal(vacation.reason, 'vacation');
});

test('раскладка обязана сойтись с оценкой до копейки', () => {
  const days = [day('2026-09-22'), day('2026-09-23')];
  const short = planning.validateLayout({
    entries: [{ date: '2026-09-22', hours: 6 }],
    estimateHours: 10,
    days,
  });
  assert.equal(short.ok, false);
  assert.match(short.error, /не хватает 4 ч/);

  const extra = planning.validateLayout({
    entries: [{ date: '2026-09-22', hours: 6 }, { date: '2026-09-23', hours: 6 }],
    estimateHours: 10,
    days,
  });
  assert.equal(extra.ok, false);
  assert.match(extra.error, /лишние 2 ч/);

  const exact = planning.validateLayout({
    entries: [{ date: '2026-09-23', hours: 4 }, { date: '2026-09-22', hours: 6 }],
    estimateHours: 10,
    days,
  });
  assert.equal(exact.ok, true);
  // Раскладка возвращается отсортированной: по ней выкладываются блоки, и
  // первый её день становится plannedDate.
  assert.deepEqual(exact.layout.map(row => row.date), ['2026-09-22', '2026-09-23']);
});

test('день за пределами окна и выходной внутри окна в раскладку не берутся', () => {
  const days = [day('2026-09-22'), day('2026-09-26', { onDayOff: true, norm: 0, free: 0 })];
  const outside = planning.validateLayout({
    entries: [{ date: '2026-10-01', hours: 2 }],
    estimateHours: 2,
    days,
  });
  assert.equal(outside.ok, false);
  assert.match(outside.error, /за пределами окна/);

  const off = planning.validateLayout({
    entries: [{ date: '2026-09-26', hours: 2 }],
    estimateHours: 2,
    days,
  });
  assert.equal(off.ok, false);
  assert.match(off.error, /рабочее расписание/);
});

test('переработка не запрещена, но и не проходит молча', () => {
  // Взять сверх нормы — своё решение исполнителя. Поэтому раскладка признаётся
  // корректной, а перегруженные дни возвращаются списком: маршрут обязан либо
  // получить подтверждение, либо отказать.
  const days = [day('2026-09-22', { hours: 6, free: 2 })];
  const check = planning.validateLayout({
    entries: [{ date: '2026-09-22', hours: 4 }],
    estimateHours: 4,
    days,
  });
  assert.equal(check.ok, true);
  assert.deepEqual(check.overloads, [{ date: '2026-09-22', after: 10, norm: 8, over: 2 }]);
});

test('часы раскладки кратны 15 минутам', () => {
  const check = planning.validateLayout({
    entries: [{ date: '2026-09-22', hours: 1.1 }],
    estimateHours: 1.1,
    days: [day('2026-09-22')],
  });
  assert.equal(check.ok, false);
  assert.match(check.error, /15 минут/);
});

test('длина срока различает перенос и смену длительности', () => {
  /**
   * На этом различии держится правило трёх переносов, и оно единственное, по
   * которому маршруты /move и /stretch расходятся. /stretch обнуляет счётчик —
   * значит «растягиванием» на ту же длину можно было бы двигать работу сколько
   * угодно, ни разу не дойдя до разговора о том, почему она не делается. Поэтому
   * длина считается из дат, а не приходит от клиента признаком.
   */
  const length = part => {
    const { from, to } = parts.windowOf(part);
    return Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);
  };

  const week = { startDate: '2026-09-22', dueDate: '2026-09-26' };
  // Сдвиг на неделю вперёд — та же длина, это перенос.
  assert.equal(length({ startDate: '2026-09-29', dueDate: '2026-10-03' }), length(week));
  // На день длиннее — это уже другая длительность.
  assert.notEqual(length({ startDate: '2026-09-22', dueDate: '2026-09-27' }), length(week));

  // Однодневная: любой другой день — перенос, а не смена длительности.
  const day = { dueDate: '2026-09-25' };
  assert.equal(length(day), 0);
  assert.equal(length({ dueDate: '2026-09-28' }), length(day));
});

test('пустая раскладка — это отказ, а не раскладка из нуля дней', () => {
  const days = [day('2026-09-22')];
  assert.equal(planning.validateLayout({ entries: [], estimateHours: 4, days }).ok, false);
  assert.equal(
    planning.validateLayout({ entries: [{ date: '2026-09-22', hours: 0 }], estimateHours: 4, days }).ok,
    false
  );
});
