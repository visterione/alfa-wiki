const test = require('node:test');
const assert = require('node:assert/strict');

const teams = require('../services/tasks/teams');

/**
 * Кто видит названия чужих задач.
 *
 * Это правило легко ослабить обратно одной строкой, поэтому проверяется именно
 * то, ради чего его вводили: сокомандники не видят работу друг друга, а
 * руководитель видит только своих участников — не других руководителей и не
 * смотрящих.
 */

const team = (members, over = {}) => ({
  id: 't1', name: 'Маркетинг', medCenterId: 'mc1', access: 'members', isHidden: true,
  members, ...over,
});

test('участники команды не видят задачи друг друга', () => {
  const marketing = team([
    {userId: 'lida', role: 'member'},
    {userId: 'vitaly', role: 'member'},
  ]);

  assert.deepEqual(teams.taskScope([marketing], 'lida'), ['lida']);
  assert.deepEqual(teams.taskScope([marketing], 'vitaly'), ['vitaly']);
});

test('руководитель видит задачи своих участников', () => {
  const marketing = team([
    {userId: 'lead', role: 'lead'},
    {userId: 'lida', role: 'member'},
    {userId: 'vitaly', role: 'member'},
  ]);

  const scope = teams.taskScope([marketing], 'lead');
  assert.deepEqual([...scope].sort(), ['lead', 'lida', 'vitaly']);
});

test('руководитель не видит задачи другого руководителя той же команды', () => {
  // Ровно тот случай, с которого правило и переписывали: два руководителя
  // «Маркетинга» — не начальник и подчинённый, а равные.
  const marketing = team([
    {userId: 'stetsenko', role: 'lead'},
    {userId: 'kharitonov', role: 'lead'},
    {userId: 'lida', role: 'member'},
  ]);

  const scope = teams.taskScope([marketing], 'stetsenko');
  assert.ok(!scope.includes('kharitonov'), 'задачи второго руководителя закрыты');
  assert.ok(scope.includes('lida'), 'задачи участника видны');
});

test('смотрящий не видит названий вовсе — он заведён смотреть на часы', () => {
  const marketing = team([
    {userId: 'watcher', role: 'viewer'},
    {userId: 'lida', role: 'member'},
  ]);

  assert.deepEqual(teams.taskScope([marketing], 'watcher'), ['watcher']);
});

test('руководство одной командой не открывает другую', () => {
  const marketing = team([
    {userId: 'lead', role: 'lead'},
    {userId: 'lida', role: 'member'},
  ]);
  const support = team([
    {userId: 'petrov', role: 'member'},
  ], {id: 't2', name: 'Поддержка'});

  const scope = teams.taskScope([marketing, support], 'lead');
  assert.ok(!scope.includes('petrov'));
});

test('область видимости загрузки осталась прежней — часы видит вся команда', () => {
  // Загрузка и названия разведены намеренно: если бы peopleInScope сузился
  // вместе с taskScope, руководитель перестал бы видеть, кто перегружен.
  const marketing = team([
    {userId: 'lida', role: 'member'},
    {userId: 'vitaly', role: 'member'},
  ]);

  const scope = teams.peopleInScope([marketing], 'lida');
  assert.ok(scope.includes('vitaly'), 'часы сокомандника по-прежнему видны');
});
