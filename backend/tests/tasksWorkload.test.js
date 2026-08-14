const test = require('node:test');
const assert = require('node:assert/strict');

const wl = require('../services/tasks/workload');
const parts = require('../services/tasks/parts');

/**
 * Загрузка в часах и производные статусы задач.
 *
 * Проверяются утверждения, на которых держится модуль, а не арифметика:
 * переработка наступает у каждого в своей точке; личное «только я» не занимает
 * часов в чужом взгляде; общая задача тратит время каждого участника; задача
 * не может выглядеть благополучной, пока одна её часть застряла.
 */

const OWNER = 'u-owner';
const OTHER = 'u-other';
const viewer = id => ({ id, isAdmin: false });

const block = (hours, over = {}) => ({
  createdBy: OWNER,
  visibility: 'team',
  startTime: '2026-08-13T08:00:00.000Z',
  endTime: new Date(Date.parse('2026-08-13T08:00:00.000Z') + hours * 3600000).toISOString(),
  ...over,
});

test('часы считаются по длительности события', () => {
  assert.equal(wl.hoursOf(block(2.5)), 2.5);
});

test('завершённое событие освобождает время сразу', () => {
  const events = [block(2), block(1, { status: 'completed' })];
  assert.equal(wl.busyHours(events, viewer(OWNER)), 2);
});

test('переработка наступает у каждого в своей точке', () => {
  // 6 ч занятости — переработка при норме 5,6 и запас при норме 6,8.
  const events = [block(6)];
  assert.equal(wl.dayLoad({ events, norm: 5.6, viewer: viewer(OWNER) }).color, wl.COLORS.OVER);
  assert.equal(wl.dayLoad({ events, norm: 6.8, viewer: viewer(OWNER) }).color, wl.COLORS.TIGHT);
  assert.equal(wl.dayLoad({ events: [block(3)], norm: 6.8, viewer: viewer(OWNER) }).color, wl.COLORS.FREE);
});

test('ровно норма — это ещё не переработка', () => {
  const load = wl.dayLoad({ events: [block(6.4)], norm: 6.4, viewer: viewer(OWNER) });
  assert.equal(load.color, wl.COLORS.TIGHT);
  assert.equal(load.free, 0);
});

test('«только я» занимает время владельца и не занимает его у постороннего', () => {
  // Обратная сторона уровня: слот выглядит свободным, и на него будут ставить
  // задачи. Владельца об этом предупреждают при выборе уровня.
  const events = [block(2, { visibility: 'team' }), block(1, { visibility: 'private' })];
  assert.equal(wl.busyHours(events, viewer(OWNER)), 3);
  assert.equal(wl.busyHours(events, viewer(OTHER)), 2);
});

test('«занято» занимает часы у всех — скрыто содержание, а не факт', () => {
  const events = [block(1.5, { visibility: 'busy' })];
  assert.equal(wl.busyHours(events, viewer(OTHER)), 1.5);
});

test('отпуск — это не ноль часов, а «задачи не ставятся»', () => {
  const load = wl.dayLoad({ events: [], norm: 6, onVacation: true });
  assert.equal(load.hours, null);
  assert.equal(load.color, wl.COLORS.VACATION);
  assert.equal(wl.fits({ events: [], norm: 6, estimateHours: 1, onVacation: true }), false);
});

test('человек без нормы не заведён в модуле — задачи ему не помещаются', () => {
  assert.equal(wl.fits({ events: [], norm: null, estimateHours: 1 }), false);
});

test('уже посчитанные часы не пересчитываются из пустого списка событий', () => {
  // Дни, пришедшие из выборки loadQuery, событий с собой не несут — только
  // числа. Пока fits() пересчитывал часы из events, любой такой день выглядел
  // пустым, и в него «помещалось» что угодно: ошибка тихая и ровно в той
  // проверке, ради которой модуль сделан.
  const day = { date: '2026-08-13', hours: 6, norm: 6.4, events: [] };
  assert.equal(wl.fits({ ...day, estimateHours: 1 }), false);
  assert.equal(wl.fits({ ...day, estimateHours: 0.4 }), true);
  assert.equal(wl.dayLoad(day).hours, 6);
});

test('ближайшее окно ищется по дням, и «нет окна» — валидный ответ', () => {
  const days = [
    { date: '2026-08-13', events: [block(6)], norm: 6.4 },
    { date: '2026-08-14', events: [block(2)], norm: 6.4 },
  ];
  assert.equal(wl.nextFit(days, 3, viewer(OWNER)), '2026-08-14');
  assert.equal(wl.nextFit(days, 8, viewer(OWNER)), null);
});

test('свободное время за период — сумма остатков, а не разница итогов', () => {
  // Перегруженный понедельник не компенсируется пустой пятницей: у человека
  // сломан понедельник, а не «в среднем нормально».
  const days = [
    { date: '1', events: [block(9)], norm: 6 },   // переработка 3 ч, остаток 0
    { date: '2', events: [block(1)], norm: 6 },   // остаток 5 ч
  ];
  assert.equal(wl.freeOverPeriod(days, viewer(OWNER)), 5);
  assert.equal(wl.overloadedDays(days, viewer(OWNER)), 1);
});

test('загрузка команды считается от суммы личных норм', () => {
  // Подрядчик на 4 ч и поддержка на 7 ч в одной команде: общая цифра «8 ч на
  // человека» показала бы недозагрузку там, где её нет.
  const memberDays = [
    { date: '1', events: [block(4)], norm: 4 },
    { date: '1', events: [block(3.5)], norm: 7 },
  ];
  const result = wl.teamLoad(memberDays, viewer(OWNER));
  assert.equal(result.capacity, 11);
  assert.equal(result.hours, 7.5);
  assert.equal(result.percent, 68);
});

/* ─────────────────────────── части задач ─────────────────────────── */

const part = (over = {}) => ({
  id: 'p1',
  status: parts.STATUS.NEW,
  estimateHours: 2,
  moveCount: 0,
  assignees: [{ userId: OWNER, plannedDate: null }],
  ...over,
});

test('статус задачи выводится из частей, застрявшая часть перебивает работу', () => {
  assert.equal(parts.taskStatus([part({ status: 'done' }), part({ status: 'done' })]), 'done');
  assert.equal(
    parts.taskStatus([part({ status: 'work' }), part({ status: 'stuck' })]),
    'stuck',
    'задача, которую четвёртый день не могут начать, не должна выглядеть благополучной'
  );
});

test('формат задачи выводится из состава исполнителей', () => {
  const solo = [part({ assignees: [{ userId: OWNER }] })];
  const shared = [part({ assignees: [{ userId: OWNER }, { userId: OTHER }] })];
  assert.equal(parts.taskMode(solo), parts.MODE.SINGLE);
  assert.equal(parts.taskMode(shared), parts.MODE.SHARED);
  assert.equal(parts.taskMode([...solo, part({ id: 'p2', assignees: [{ userId: OTHER }] })]), parts.MODE.SPLIT);
  assert.equal(parts.taskMode([...solo, ...shared.map(p => ({ ...p, id: 'p3' }))]), parts.MODE.MIXED);
});

test('общая часть тратит время каждого участника', () => {
  // 2 ч на троих — это 2 ч в календаре у каждого и 6 ч трудозатрат.
  const shared = [part({ estimateHours: 2, assignees: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }] })];
  assert.equal(parts.totalEffortHours(shared), 6);
});

test('во входящих лежит то, чему исполнитель не назначил день', () => {
  const list = [
    part({ id: 'p1', assignees: [{ userId: OWNER, plannedDate: null }] }),
    part({ id: 'p2', assignees: [{ userId: OWNER, plannedDate: '2026-08-14' }] }),
    part({ id: 'p3', assignees: [{ userId: OWNER, plannedDate: null, declinedAt: '2026-08-13' }] }),
  ];
  assert.deepEqual(parts.inboxFor(list, OWNER).map(p => p.id), ['p1']);
});

test('после третьего переноса молчаливый перенос закрыт', () => {
  assert.equal(parts.canMoveSilently(part({ moveCount: 2 })), true);
  assert.equal(parts.canMoveSilently(part({ moveCount: 3 })), false);
  assert.equal(parts.isStuck(part({ moveCount: 4 })), true);
});

test('часть не готова к работе, пока не завершена предыдущая', () => {
  const a = part({ id: 'a', status: 'work' });
  const b = part({ id: 'b' });
  const byId = { a, b };
  const deps = [{ partId: 'b', afterPartId: 'a' }];
  assert.equal(parts.isUnblocked(b, byId, deps), false);
  a.status = 'done';
  assert.equal(parts.isUnblocked(b, byId, deps), true);
});

test('цикл в связях «после» находится до сохранения', () => {
  // Иначе планировщик уйдёт в бесконечное ожидание готовности: две части ждут
  // друг друга, и ни одна не попадёт во входящие.
  const list = [part({ id: 'a' }), part({ id: 'b' })];
  const deps = [{ partId: 'a', afterPartId: 'b' }, { partId: 'b', afterPartId: 'a' }];
  assert.ok(parts.findCycle(list, deps), 'цикл должен быть найден');
  assert.equal(parts.findCycle(list, [{ partId: 'b', afterPartId: 'a' }]), null);
});
