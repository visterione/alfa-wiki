const test = require('node:test');
const assert = require('node:assert/strict');

const planning = require('../services/tasks/planning');
const { STATUS } = require('../services/tasks/parts');

/**
 * Планирование: правило трёх переносов, разбор загрузки при постановке и
 * обязательное объяснение при обходе проверки.
 *
 * Это те места, где модуль ведёт себя не так, как обычная доска, и где проще
 * всего незаметно вернуться к ней: разрешить молчаливый перенос, принять пустое
 * объяснение, посчитать «помещается» там, где норма не задана.
 */

const part = (over = {}) => ({ id: 'p1', estimateHours: 2, moveCount: 0, ...over });

test('плавающие блоки складываются подряд от начала рабочего дня', () => {
  // Времени у рабочего блока нет — есть день и длительность. Но в календаре он
  // обязан где-то стоять, и полночь для этого не годится.
  const slot = planning.nextFloatingSlot([], '2026-08-13', 2);
  assert.equal(new Date(slot.startTime).getHours(), planning.WORK_DAY_START);
  assert.equal(slot.dayOrder, 0);

  const second = planning.nextFloatingSlot(
    [{ isFloating: true, startTime: slot.startTime, endTime: slot.endTime }],
    '2026-08-13',
    1
  );
  assert.equal(new Date(second.startTime).getHours(), planning.WORK_DAY_START + 2);
  assert.equal(second.dayOrder, 1);
});

test('жёсткие встречи не сдвигают плавающие блоки', () => {
  // Обтекать встречу бессмысленно: время у блока всё равно условное.
  const meeting = { isFloating: false, startTime: '2026-08-13T09:00:00', endTime: '2026-08-13T11:00:00' };
  const slot = planning.nextFloatingSlot([meeting], '2026-08-13', 1);
  assert.equal(new Date(slot.startTime).getHours(), planning.WORK_DAY_START);
});

test('третий перенос закрывает молчаливый перенос', () => {
  assert.equal(planning.afterMove(part({ moveCount: 0 })).status, STATUS.PLAN);
  assert.equal(planning.afterMove(part({ moveCount: 1 })).requiresDecision, false);

  const third = planning.afterMove(part({ moveCount: 2 }));
  assert.equal(third.moveCount, 3);
  assert.equal(third.status, STATUS.STUCK);
  assert.equal(third.requiresDecision, true);
});

test('разбиение оставляет обеим половинам осмысленный размер', () => {
  const { head, tail } = planning.splitEstimate(part({ estimateHours: 2 }), 0.7);
  assert.equal(head, 0.7);
  assert.equal(tail, 1.3);

  // Просьба отдать всё в первую половину не должна оставить вторую нулевой.
  const edge = planning.splitEstimate(part({ estimateHours: 2 }), 5);
  assert.ok(edge.tail >= 0.25, 'вторая часть не может быть пустой');
  assert.equal(round(edge.head + edge.tail), 2);
});

test('разбор загрузки различает переработку, отпуск и отсутствие нормы', () => {
  const fits = planning.assessAssignment({ currentHours: 3, norm: 6.4, estimateHours: 2 });
  assert.equal(fits.fits, true);
  assert.equal(fits.after, 5);
  assert.equal(fits.free, 1.4);

  const over = planning.assessAssignment({ currentHours: 6, norm: 6.4, estimateHours: 2 });
  assert.equal(over.fits, false);
  assert.equal(over.reason, 'overload');
  assert.equal(over.over, 1.6);

  assert.equal(planning.assessAssignment({ currentHours: 0, norm: 6, estimateHours: 1, onVacation: true }).reason, 'vacation');
  // Человек без нормы в модуле не заведён — «помещается» про него сказать нельзя.
  assert.equal(planning.assessAssignment({ currentHours: 0, norm: null, estimateHours: 1 }).reason, 'no_norm');
});

test('ровно норма считается помещающимся', () => {
  const exact = planning.assessAssignment({ currentHours: 4.4, norm: 6.4, estimateHours: 2 });
  assert.equal(exact.fits, true);
  assert.equal(exact.free, 0);
});

test('обход проверки требует непустого объяснения', () => {
  assert.equal(planning.validateForce('').ok, false);
  assert.equal(planning.validateForce('ок').ok, false);
  assert.equal(planning.validateForce('   ').ok, false);

  const ok = planning.validateForce('  Клиент ждёт отчёт к утру  ');
  assert.equal(ok.ok, true);
  assert.equal(ok.text, 'Клиент ждёт отчёт к утру', 'текст обрезается по краям, но сохраняется');
});

const round = v => Math.round(v * 100) / 100;
