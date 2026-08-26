/**
 * Разбор дерева локаций — общий для трёх экранов (размещение, этикетки,
 * открытие описи). Проверяется здесь, а не в каждом из них, ровно поэтому:
 * разъехавшийся порядок или подпись выглядели бы как три разных списка
 * кабинетов, и заметили бы это уже на обходе этажа.
 */
const {
  flattenRooms, roomMatches, qtyText, roomText, roomHeadText, roomSubText,
} = require('../src/screens/Warehouse/warehouseMeta');

const tree = {
  medCenters: [
    {
      id: 'mc1',
      name: 'Владимирская, 93',
      rooms: [{id: 'r-loose', number: '000', name: 'Архив'}],
      // Этажи лежат прямо под медцентром: корпуса убраны в ver. 7.48
      floors: [
        {
          id: 'f2',
          number: 2,
          name: null,
          rooms: [{id: 'r-205', number: '205', name: 'Хирургия', storages: [{id: 's1'}]}],
        },
      ],
      services: [{id: 'r-wh', number: 'Склад', name: 'Склад', isService: true}],
    },
  ],
};

describe('flattenRooms', () => {
  it('порядок: этажи, потом кабинеты без этажа, потом склады', () => {
    const rooms = flattenRooms(tree);
    expect(rooms.map(r => r.id)).toEqual(['r-205', 'r-loose', 'r-wh']);
  });

  it('подпись этажа собирается из номера, когда имени у этажа нет', () => {
    const [floorRoom] = flattenRooms(tree);
    expect(floorRoom.groupTitle).toBe('2 этаж');
    expect(floorRoom.where).toBe('2 этаж');
    expect(floorRoom.medCenterName).toBe('Владимирская, 93');
  });

  it('склад подписывается названием, а не «Каб. Склад»', () => {
    const warehouse = flattenRooms(tree).find(r => r.id === 'r-wh');
    expect(warehouse.label).toBe('Склад');
    expect(warehouse.groupTitle).toBe('Склады');
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

/**
 * Подписи места. Две функции, потому что вопросов два: строка списка с
 * подписью снизу и строка, где место называют один раз.
 */
describe('подписи места', () => {
  const room = {number: '415', name: 'Архив'};
  const plain = {number: '12', name: null};
  const fromMis = {number: 'Рентген', name: 'Рентген'};
  const store = {number: 'Склад', name: 'Склад', isService: true};

  it('одной строкой — номер и название через тире', () => {
    expect(roomText(room)).toBe('Каб. 415 — Архив');
    expect(roomText(plain)).toBe('Каб. 12');
    // Название, равное номеру, не дублируется: так заводит кабинеты импорт из МИС
    expect(roomText(fromMis)).toBe('Каб. Рентген');
    expect(roomText(store)).toBe('Склад');
  });

  it('в списке — номер в заголовке, название подписью снизу', () => {
    // Через тире оно шло бы вторым разом подряд: «Каб. 415 — Архив» / «Архив»
    expect(roomHeadText(room)).toBe('Каб. 415');
    expect(roomSubText(room)).toBe('Архив');
  });

  it('подписи снизу нет, когда её нечем заполнить', () => {
    expect(roomSubText(plain)).toBe('');
    expect(roomSubText(fromMis)).toBe('');
    // У склада название и есть заголовок — снизу его повторять нечем
    expect(roomHeadText(store)).toBe('Склад');
    expect(roomSubText(store)).toBe('');
  });
});
