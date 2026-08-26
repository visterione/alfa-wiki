const test = require('node:test');
const assert = require('node:assert/strict');

const { turnoverLevels } = require('../services/warehouse/hierarchy');

/**
 * Уровни дерева оборотно-сальдовой ведомости.
 *
 * С ver. 7.48 уровня корпуса нет: этаж принадлежит медцентру напрямую. Проверяем
 * то же, что и раньше, — что лишние уровни не появляются там, где им нечего
 * показать, — и то, что склады не сваливаются в «Без этажа»: у склада этажа не
 * бывает, и «забыли указать» здесь означало бы неверное.
 */

test('ОСВ не добавляет этаж кабинетам прямой привязки', () => {
  const levels = turnoverLevels([{
    medCenterName: 'Малый МЦ', floorId: null, floorNumber: null,
    departmentId: null, roomId: 'room-1', roomNumber: '1', storageId: 'storage-1',
  }]);

  assert.deepEqual(levels.map(level => level.key), ['department', 'room', 'storage']);
});

test('смешанная ОСВ явно отделяет кабинет без этажа', () => {
  const direct = {
    medCenterName: 'МЦ', floorId: null, floorNumber: null,
    departmentId: null, roomId: 'room-1', roomNumber: '1', storageId: 'storage-1',
  };
  const levels = turnoverLevels([
    direct,
    { ...direct, floorId: 'floor-2', floorNumber: 2, roomId: 'room-2' },
  ]);

  const floor = levels.find(level => level.key === 'floor');
  assert.equal(floor.label(direct), 'Без этажа');
  assert.equal(floor.label({ floorId: 'floor-2', floorNumber: 2 }), '2 этаж');
});

test('этажи с одинаковым номером не сливаются в одну ветку', () => {
  // После отказа от корпусов у медцентра временно два четвёртых этажа. Ключ
  // уровня — идентификатор этажа: склеив их по номеру, отчёт сложил бы в один
  // подытог имущество двух разных мест.
  const a = { medCenterName: 'МЦ', floorId: 'f-adm', floorNumber: 4, floorName: 'Административный', roomId: 'r1', storageId: 's1' };
  const b = { medCenterName: 'МЦ', floorId: 'f-main', floorNumber: 4, floorName: 'Главный', roomId: 'r2', storageId: 's2' };
  const floor = turnoverLevels([a, b]).find(level => level.key === 'floor');

  assert.notEqual(floor.id(a), floor.id(b));
  assert.equal(floor.label(a), '4 этаж — Административный');
  assert.equal(floor.label(b), '4 этаж — Главный');
});

test('склады стоят своей веткой, а не в «Без этажа»', () => {
  const room = { medCenterName: 'МЦ', floorId: null, floorNumber: null, roomId: 'r1', storageId: 's1' };
  const service = { ...room, roomId: 'r2', storageId: 's2', roomIsService: true };
  const floor = turnoverLevels([room, service]).find(level => level.key === 'floor');

  assert.equal(floor.label(service), 'Склады');
  assert.notEqual(floor.id(service), floor.id(room));
});
