const test = require('node:test');
const assert = require('node:assert/strict');

const { targetsOf } = require('../services/warehouse/osvMaterialize');

/**
 * Размещение позиций ведомости по кабинетам (ver. 6.80).
 *
 * Проверяется главное утверждение этой части: одна строка ведомости
 * раскладывается на несколько кабинетов с дроблением количества, и разбор
 * трогает ровно то, что разложено, — ни единицей больше.
 *
 * Почему это важно проверить тестом, а не глазами: карточка получает инвентарный
 * номер с кодом специальности отделения того кабинета, в котором создана, и
 * номер не меняется никогда. Ошибка «создали больше, чем разложено» означает
 * карточки с неверными номерами, которые нельзя исправить по определению номера
 * — только списать.
 */

const line = (over = {}) => ({
  lineKey: 'abc123', name: 'Стул СТ 6 серый', closingQty: 3, unitCost: 5755, ...over,
});

test('строка раскладывается на несколько кабинетов', () => {
  const targets = targetsOf({
    line: line(),
    roomId: 'branch-room',
    placements: [
      { id: 'p1', roomId: 'room-305', storageId: null, quantity: 1 },
      { id: 'p2', roomId: 'room-307', storageId: 'shelf-2', quantity: 2 },
    ],
  });

  assert.equal(targets.length, 2);
  assert.deepEqual(targets.map(t => t.roomId), ['room-305', 'room-307']);
  assert.deepEqual(targets.map(t => t.quantity), [1, 2]);
  // Кабинет ветки при наличии размещений не участвует вовсе: ветка отвечает на
  // вопрос «чьё это», а не «где стоит».
  assert.ok(!targets.some(t => t.roomId === 'branch-room'));
});

test('разбор трогает только разложенное', () => {
  // Из трёх стульев разложен один. Два оставшихся не должны превратиться в
  // карточки: пока неизвестен кабинет, неизвестен и код специальности в номере.
  const targets = targetsOf({
    line: line(),
    roomId: null,
    placements: [{ id: 'p1', roomId: 'room-305', storageId: null, quantity: 1 }],
  });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].quantity, 1);
});

test('без размещений работает запасной путь через кабинет ветки', () => {
  // Совместимость с ver. 6.73: карточки, созданные до появления размещений, не
  // должны осиротеть, а ветка, честно равная одному кабинету, встречается.
  const targets = targetsOf({
    line: line(),
    roomId: 'branch-room',
    storageId: 'branch-shelf',
    placements: [],
  });

  assert.deepEqual(targets, [{
    placementId: null,
    roomId: 'branch-room',
    storageId: 'branch-shelf',
    quantity: 3,
  }]);
});

test('без размещений и без кабинета ветки строка никуда не едет', () => {
  assert.deepEqual(targetsOf({ line: line(), roomId: null, placements: [] }), []);
  // Отсутствие поля placements вовсе (старый вызов) тоже не должно ломать расчёт.
  assert.deepEqual(targetsOf({ line: line(), roomId: null }), []);
});

test('у размещения свой идентификатор, у запасного пути его нет', () => {
  // На этом различии держится идемпотентность: созданные карточки считаются по
  // размещению, а старые — по строке ведомости. Смешать их значит при повторном
  // разборе выдать тем же вещам вторые инвентарные номера.
  const placed = targetsOf({
    line: line(),
    placements: [{ id: 'p1', roomId: 'room-305', storageId: null, quantity: 3 }],
  });
  const fallback = targetsOf({ line: line(), roomId: 'branch-room', placements: [] });

  assert.equal(placed[0].placementId, 'p1');
  assert.equal(fallback[0].placementId, null);
});

test('дробное количество размещается как есть', () => {
  // Метры портьеры и миллилитры спирта раскладываются по кабинетам так же, как
  // штуки, — округление здесь было бы потерей остатка.
  const targets = targetsOf({
    line: line({ closingQty: 12.5, name: 'Портьера' }),
    placements: [
      { id: 'p1', roomId: 'room-1', storageId: null, quantity: 2.02 },
      { id: 'p2', roomId: 'room-2', storageId: null, quantity: 10.48 },
    ],
  });

  assert.equal(targets[0].quantity, 2.02);
  assert.equal(targets[1].quantity, 10.48);
});
