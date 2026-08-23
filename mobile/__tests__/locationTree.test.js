/**
 * Спуск по локациям: медцентр → корпус → этаж → кабинеты.
 *
 * Проверяются два правила, на которых держится вся навигация по кабинетам и
 * которые не видно в отрисовке: пустые ветки не показываются, а уровень с
 * единственным вариантом пропускается. Ошибись в любом из них — человек либо
 * упрётся в корпус, за которым ничего нет, либо получит экран с одной строкой.
 */
const {
  ROOT_KEY, buildNodes, leavesOf, resolveNode,
} = require('../src/screens/Warehouse/locationTree');

const room = (id, number, counters = {}) => ({
  id, number, name: null,
  counters: {assets: 0, positions: 0, ...counters},
});

const floor = (id, number, rooms) => ({id, number, name: null, rooms});

const tree = ({buildings = [], rooms = [], extra = []} = {}) => ({
  medCenters: [
    {
      id: 'mc1',
      name: 'Владимирская, 93',
      address: 'ул. Владимирская, 93',
      city: 'Тюмень',
      logoUrl: '/uploads/mc/alfa.png',
      buildings,
      rooms,
    },
    ...extra,
  ],
});

describe('buildNodes', () => {
  it('собирает медцентр → корпус → этаж и считает кабинеты по всей ветке', () => {
    const nodes = buildNodes(tree({
      buildings: [{
        id: 'b1', name: 'Корпус А', address: 'ул. Ленина, 1',
        floors: [
          floor('f1', 1, [room('r1', '101'), room('r2', '102')]),
          floor('f2', 2, [room('r3', '201')]),
        ],
      }],
    }));

    expect(nodes.get('mc:mc1').counts.rooms).toBe(3);
    expect(nodes.get('b:b1').counts.rooms).toBe(3);
    expect(nodes.get('f:f1').counts.rooms).toBe(2);
    expect(nodes.get(ROOT_KEY).counts.rooms).toBe(3);
  });

  // Оборудование и материалы считаются порознь: первое — карточками с
  // инвентарными номерами, второе — позициями на остатке, и одна общая цифра
  // отвечала бы не на тот вопрос
  it('имущество суммируется по ветке двумя числами', () => {
    const nodes = buildNodes(tree({
      buildings: [{
        id: 'b1',
        name: 'Корпус А',
        floors: [
          floor('f1', 1, [
            room('r1', '101', {assets: 3, positions: 5}),
            room('r2', '102', {assets: 1, positions: 0}),
          ]),
          floor('f2', 2, [room('r3', '201', {assets: 0, positions: 7})]),
        ],
      }],
    }));

    expect(nodes.get('f:f1').counts).toEqual({rooms: 2, assets: 4, materials: 5});
    expect(nodes.get('b:b1').counts).toEqual({rooms: 3, assets: 4, materials: 12});
    expect(nodes.get(ROOT_KEY).counts).toEqual({rooms: 3, assets: 4, materials: 12});
  });

  it('корпус без единого кабинета в дерево не попадает', () => {
    const nodes = buildNodes(tree({
      buildings: [
        {id: 'b1', name: 'Корпус А', floors: [floor('f1', 1, [room('r1', '101')])]},
        {id: 'empty', name: 'Пристрой', floors: [floor('f9', 9, [])]},
      ],
    }));

    expect(nodes.has('b:empty')).toBe(false);
    expect(nodes.get('mc:mc1').children.map(n => n.key)).toEqual(['b:b1']);
  });

  it('логотип и адрес доезжают до строки медцентра', () => {
    const nodes = buildNodes(tree({
      buildings: [{id: 'b1', name: 'Корпус А', floors: [floor('f1', 1, [room('r1', '101')])]}],
    }));

    const mc = nodes.get('mc:mc1');
    expect(mc.logoUrl).toBe('/uploads/mc/alfa.png');
    // Адрес важнее города: в одном городе медцентров несколько
    expect(mc.subtitle).toBe('ул. Владимирская, 93');
  });

  it('медцентр без кабинетов вовсе не показывается', () => {
    const nodes = buildNodes(tree({
      buildings: [{id: 'b1', name: 'Корпус А', floors: [floor('f1', 1, [room('r1', '101')])]}],
      extra: [{id: 'mc2', name: 'Пустой', buildings: [], rooms: []}],
    }));

    expect(nodes.get(ROOT_KEY).children.map(n => n.key)).toEqual(['mc:mc1']);
  });

  it('кабинеты без корпуса становятся отдельным узлом рядом с корпусами', () => {
    const nodes = buildNodes(tree({
      buildings: [{id: 'b1', name: 'Корпус А', floors: [floor('f1', 1, [room('r1', '101')])]}],
      rooms: [room('r9', '000')],
    }));

    const loose = nodes.get('mcr:mc1');
    expect(loose.title).toBe('Без корпуса');
    expect(loose.rooms).toHaveLength(1);
    // Узел либо ведёт дальше, либо заканчивается кабинетами — но не одновременно
    expect(loose.children).toBeUndefined();
    expect(nodes.get('mc:mc1').rooms).toBeUndefined();
  });

  it('подпись этажа собирается из номера, когда имени у него нет', () => {
    const nodes = buildNodes(tree({
      buildings: [{id: 'b1', name: 'Корпус А', floors: [floor('f1', 2, [room('r1', '201')])]}],
    }));

    expect(nodes.get('f:f1').title).toBe('2 этаж');
    expect(nodes.get('f:f1').path).toBe('Владимирская, 93 · Корпус А · 2 этаж');
  });
});

describe('resolveNode', () => {
  const single = () => buildNodes(tree({
    buildings: [{id: 'b1', name: 'Корпус А', floors: [floor('f1', 1, [room('r1', '101')])]}],
  }));

  it('единственный медцентр с единственным корпусом и этажом ведёт сразу в кабинеты', () => {
    const node = resolveNode(single(), ROOT_KEY);
    expect(node.key).toBe('f:f1');
    expect(node.rooms).toHaveLength(1);
  });

  it('там, где выбор есть, спуск останавливается', () => {
    const nodes = buildNodes(tree({
      buildings: [
        {id: 'b1', name: 'Корпус А', floors: [floor('f1', 1, [room('r1', '101')])]},
        {id: 'b2', name: 'Корпус Б', floors: [floor('f2', 1, [room('r2', '102')])]},
      ],
    }));
    // Медцентр один — его пропускаем, но корпуса два, и выбирать придётся
    expect(resolveNode(nodes, ROOT_KEY).key).toBe('mc:mc1');
  });

  it('неизвестный ключ откатывает к корню, а не роняет экран', () => {
    expect(resolveNode(single(), 'f:нет-такого').key).toBe('f:f1');
    expect(resolveNode(null, ROOT_KEY)).toBeNull();
  });
});

describe('leavesOf', () => {
  it('разворачивает поддерево в этажи с кабинетами', () => {
    const nodes = buildNodes(tree({
      buildings: [{
        id: 'b1', name: 'Корпус А',
        floors: [floor('f1', 1, [room('r1', '101')]), floor('f2', 2, [room('r2', '201')])],
      }],
      rooms: [room('r9', '000')],
    }));

    expect(leavesOf(nodes.get('mc:mc1')).map(n => n.key))
      .toEqual(['f:f1', 'f:f2', 'mcr:mc1']);
    expect(leavesOf(nodes.get('f:f1')).map(n => n.key)).toEqual(['f:f1']);
  });
});
