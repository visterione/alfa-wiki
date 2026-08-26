const test = require('node:test');
const assert = require('node:assert/strict');

const { SERVICE_KINDS, roomLabel } = require('../services/warehouse/servicePlaces');

/**
 * Склады медцентра (ver. 7.47).
 *
 * Проверяется подпись места. Кажется мелочью, но ошибка в ней видна на каждом
 * экране сразу: склад — это строка warehouse_rooms, и везде, где подпись
 * собирают из номера кабинета, само собой получается «Каб. Склад». Правило
 * поэтому живёт в одном месте, и тест сторожит именно его.
 */

test('кабинет подписывается номером, склад — названием', () => {
  assert.equal(
    roomLabel({ number: '305', name: 'Хирургия', isService: false }),
    'Каб. 305 — Хирургия',
  );
  assert.equal(roomLabel({ number: 'Склад', name: 'Склад', isService: true }), 'Склад');
  assert.equal(roomLabel({ number: 'Ремонт', name: 'Ремонт', isService: true }), 'Ремонт');
});

test('у кабинета без названия остаётся один номер', () => {
  assert.equal(roomLabel({ number: '12', name: null, isService: false }), 'Каб. 12');
  // Название, равное номеру, не дублируется: так заводит кабинеты импорт из МИС.
  assert.equal(roomLabel({ number: '12', name: '12', isService: false }), 'Каб. 12');
});

test('склад без названия подписывается номером', () => {
  assert.equal(roomLabel({ number: 'Резерв', name: null, isService: true }), 'Резерв');
});

test('быстрые действия ведут ровно к двум видам складов', () => {
  // Всё, что заведут руками сверх этих двух, — тоже склад, но без своей кнопки:
  // serviceKind у него пуст, и искать его быстрым действием нечем.
  assert.deepEqual(Object.keys(SERVICE_KINDS).sort(), ['repair', 'warehouse']);
  assert.equal(SERVICE_KINDS.repair.name, 'Ремонт');
  assert.equal(SERVICE_KINDS.warehouse.name, 'Склад');
});
