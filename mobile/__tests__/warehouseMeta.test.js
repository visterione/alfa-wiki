/**
 * Разбор дерева локаций — общий для трёх экранов (размещение, этикетки,
 * открытие описи). Проверяется здесь, а не в каждом из них, ровно поэтому:
 * разъехавшийся порядок или подпись выглядели бы как три разных списка
 * кабинетов, и заметили бы это уже на обходе этажа.
 */
const {flattenRooms, roomMatches, qtyText} = require('../src/screens/Warehouse/warehouseMeta');

const tree = {
  medCenters: [
    {
      id: 'mc1',
      name: 'Владимирская, 93',
      rooms: [{id: 'r-loose', number: '000', name: 'Склад'}],
      buildings: [
        {
          id: 'b1',
          name: 'Корпус А',
          floors: [
            {
              id: 'f2',
              number: 2,
              name: null,
              rooms: [{id: 'r-205', number: '205', name: 'Хирургия', storages: [{id: 's1'}]}],
            },
          ],
        },
      ],
    },
  ],
};

describe('flattenRooms', () => {
  it('кабинеты этажей идут раньше кабинетов без этажа', () => {
    const rooms = flattenRooms(tree);
    expect(rooms.map(r => r.id)).toEqual(['r-205', 'r-loose']);
  });

  it('подпись этажа собирается из корпуса и номера, когда имени у этажа нет', () => {
    const [floorRoom] = flattenRooms(tree);
    expect(floorRoom.groupTitle).toBe('Корпус А · 2 этаж');
    expect(floorRoom.where).toBe('Корпус А · 2 этаж');
    expect(floorRoom.medCenterName).toBe('Владимирская, 93');
  });

  it('место хранения помечается флагом — от него зависит размещение материалов', () => {
    const [withStorage, without] = flattenRooms(tree);
    expect(withStorage.hasStorage).toBe(true);
    expect(without.hasStorage).toBe(false);
  });

  it('пустое дерево не роняет разбор', () => {
    expect(flattenRooms(null)).toEqual([]);
    expect(flattenRooms({})).toEqual([]);
  });
});

describe('roomMatches', () => {
  const [room] = flattenRooms(tree);

  it('ищет и по номеру, и по названию', () => {
    expect(roomMatches(room, '205')).toBe(true);
    expect(roomMatches(room, 'хирург')).toBe(true);
    expect(roomMatches(room, 'терапия')).toBe(false);
  });

  it('пустой запрос пропускает всё', () => {
    expect(roomMatches(room, '')).toBe(true);
  });

  // Кабинет приходит и из flattenRooms, и прямо из дерева локаций, где имени
  // может не быть вовсе — раньше на таком поиск падал
  it('кабинет без названия ищется по номеру', () => {
    expect(roomMatches({number: '112', name: null}, '112')).toBe(true);
    expect(roomMatches({number: '112', name: null}, 'хирург')).toBe(false);
  });
});

describe('qtyText', () => {
  it('у штук хвоста нулей нет, у дробных дробь остаётся', () => {
    expect(qtyText(14)).toBe('14');
    expect(qtyText(2.5)).toBe('2,5');
  });
});
