const test = require('node:test');
const assert = require('node:assert/strict');

const { targetsOf, requestedQuantity } = require('../services/warehouse/osvMaterialize');

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

/**
 * Сужение разбора до кабинета (ver. 7.23).
 *
 * Телефон разбирает кабинет сразу после того, как его разложили, — иначе
 * раскладка на ногах заканчивалась ничем до общего прогона из веба. Сужение
 * обязано отсекать чужие назначения: одна строка ведомости лежит в нескольких
 * кабинетах, и разбор кабинета 305 не должен заводить карточки в 307, куда
 * никто ещё не заходил.
 */
test('прогон по кабинету берёт только его назначения', () => {
  const targets = targetsOf({
    line: line(),
    roomId: null,
    placements: [
      { id: 'p1', roomId: 'room-305', storageId: null, quantity: 1 },
      { id: 'p2', roomId: 'room-307', storageId: null, quantity: 2 },
    ],
  }, new Set(['room-305']));

  assert.equal(targets.length, 1);
  assert.equal(targets[0].roomId, 'room-305');
  assert.equal(targets[0].quantity, 1);
});

test('строка, которой в этом кабинете нет, из прогона выпадает целиком', () => {
  const targets = targetsOf({
    line: line(),
    roomId: null,
    placements: [{ id: 'p1', roomId: 'room-307', storageId: null, quantity: 3 }],
  }, new Set(['room-305']));

  assert.deepEqual(targets, []);
});

test('запасной путь через кабинет ветки тоже сужается', () => {
  // Иначе прогон по одному кабинету протащил бы за собой все строки, которые
  // держатся на кабинете своей ветки, — то есть половину ведомости
  const item = { line: line(), roomId: 'branch-room', storageId: null, placements: [] };

  assert.deepEqual(targetsOf(item, new Set(['room-305'])), []);
  assert.equal(targetsOf(item, new Set(['branch-room'])).length, 1);
});

/**
 * Количество по умолчанию (ver. 7.46).
 *
 * До 7.46 пустое поле означало «весь нераспределённый остаток», и на боевых
 * данных это записало на кабинет пятьдесят единиц одной галочкой. Правило
 * проверяется тестом именно потому, что ошибка в нём не видна в момент
 * совершения: размещение выглядит обычным, а после разбора снимается только
 * перемещением.
 */
test('пустое количество — одна единица, а не весь остаток', () => {
  assert.equal(requestedQuantity(undefined, 50), 1);
  assert.equal(requestedQuantity(null, 50), 1);
  assert.equal(requestedQuantity('', 50), 1);
});

test('явное количество принимается как есть', () => {
  assert.equal(requestedQuantity(6, 50), 6);
  assert.equal(requestedQuantity('6', 50), 6);
  // Ноль не подменяется единицей: пустое поле и введённый ноль — разные вещи,
  // и отказ по нулю человек должен увидеть, а не получить молча одну единицу.
  assert.equal(requestedQuantity(0, 50), 0);
});

test('пустое количество не берёт больше, чем осталось', () => {
  // Дробный остаток бывает у материалов: 0.4 метра портьеры не превращаются в
  // запрос на метр, который сервер тут же и отвергнет.
  assert.equal(requestedQuantity('', 0.4), 0.4);
  assert.equal(requestedQuantity('', 0), 0);
});
