const test = require('node:test');
const assert = require('node:assert/strict');

const { turnoverLevels } = require('../services/warehouse/hierarchy');

test('ОСВ не добавляет корпус и этаж кабинетам прямой привязки', () => {
  const levels = turnoverLevels([{
    medCenterName: 'Малый МЦ', buildingName: null, floorNumber: null,
    departmentId: null, roomId: 'room-1', roomNumber: '1', storageId: 'storage-1',
  }]);

  assert.deepEqual(levels.map(level => level.key), ['department', 'room', 'storage']);
});

test('смешанная ОСВ явно отделяет кабинет без искусственных уровней', () => {
  const direct = {
    medCenterName: 'МЦ', buildingName: null, floorNumber: null,
    departmentId: null, roomId: 'room-1', roomNumber: '1', storageId: 'storage-1',
  };
  const levels = turnoverLevels([
    direct,
    { ...direct, buildingName: 'Главный', floorNumber: 2, roomId: 'room-2' },
  ]);

  assert.equal(levels.find(level => level.key === 'building').label(direct), 'Без корпуса');
  assert.equal(levels.find(level => level.key === 'floor').label(direct), 'Без этажа');
});
