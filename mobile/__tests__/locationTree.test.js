/**
 * Спуск по локациям: медцентр → кабинеты, этажи переключателем.
 *
 * Проверяются правила, на которых держится вся навигация по кабинетам и которых
 * не видно в отрисовке: пустые ветки не показываются, уровень с единственным
 * вариантом пропускается, а у каждого этажа есть короткая подпись для
 * переключателя. Ошибись в любом — человек либо упрётся в этаж, за которым
 * ничего нет, либо получит экран с одной строкой, либо кнопку без номера.
 *
 * Разбор старого ответа сервера (медцентр → корпус → этаж) проверяется тоже:
 * мобильные сборки обновляются вручную, и сборка вполне может оказаться новее
 * сервера — тогда дерево приходит с корпусами.
 */
const {
  ROOT_KEY, buildNodes, leavesOf, resolveNode,
} = require('../src/screens/Warehouse/locationTree');

const room = (id, number, counters = {}) => ({
  id, number, name: null,
  counters: {assets: 0, positions: 0, ...counters},
});

const floor = (id, number, rooms, name = null) => ({id, number, name, rooms});

const tree = ({floors = [], rooms = [], services = [], buildings = [], extra = []} = {}) => ({
  medCenters: [
    {
      id: 'mc1',
      name: 'Владимирская, 93',
      address: 'ул. Владимирская, 93',
      city: 'Тюмень',
      logoUrl: '/uploads/mc/alfa.png',
      floors,
      buildings,
      rooms,
      services,
    },
    ...extra,
  ],
});

describe('buildNodes', () => {
  it('собирает медцентр → этаж и считает кабинеты по всей ветке', () => {
    const nodes = buildNodes(tree({
      floors: [
        floor('f1', 1, [room('r1', '101'), room('r2', '102')]),
        floor('f2', 2, [room('r3', '201')]),
      ],
    }));

    expect(nodes.get('mc:mc1').counts.rooms).toBe(3);
    expect(nodes.get('f:f1').counts.rooms).toBe(2);
    expect(nodes.get(ROOT_KEY).counts.rooms).toBe(3);
    // Корпусов в дереве больше нет: этаж лежит прямо под медцентром
    expect(nodes.get('mc:mc1').children.map(n => n.key)).toEqual(['f:f1', 'f:f2']);
  });

  // Оборудование и материалы считаются порознь: первое — карточками с
  // инвентарными номерами, второе — позициями на остатке, и одна общая цифра
  // отвечала бы не на тот вопрос
  it('имущество суммируется по ветке двумя числами', () => {
    const nodes = buildNodes(tree({
      floors: [
        floor('f1', 1, [
          room('r1', '101', {assets: 3, positions: 5}),
          room('r2', '102', {assets: 1, positions: 0}),
        ]),
        floor('f2', 2, [room('r3', '201', {assets: 0, positions: 7})]),
      ],
    }));

    expect(nodes.get('f:f1').counts).toEqual({rooms: 2, assets: 4, materials: 5});
    expect(nodes.get('mc:mc1').counts).toEqual({rooms: 3, assets: 4, materials: 12});
    expect(nodes.get(ROOT_KEY).counts).toEqual({rooms: 3, assets: 4, materials: 12});
  });

  it('этаж без единого кабинета в дерево не попадает', () => {
    const nodes = buildNodes(tree({
      floors: [floor('f1', 1, [room('r1', '101')]), floor('empty', 9, [])],
    }));

    expect(nodes.has('f:empty')).toBe(false);
    expect(nodes.get('mc:mc1').children.map(n => n.key)).toEqual(['f:f1']);
  });

  it('логотип и адрес доезжают до строки медцентра', () => {
    const nodes = buildNodes(tree({floors: [floor('f1', 1, [room('r1', '101')])]}));

    const mc = nodes.get('mc:mc1');
    expect(mc.logoUrl).toBe('/uploads/mc/alfa.png');
    // Адрес важнее города: в одном городе медцентров несколько
    expect(mc.subtitle).toBe('ул. Владимирская, 93');
  });

  it('медцентр без кабинетов вовсе не показывается', () => {
    const nodes = buildNodes(tree({
      floors: [floor('f1', 1, [room('r1', '101')])],
      extra: [{id: 'mc2', name: 'Пустой', floors: [], rooms: []}],
    }));

    expect(nodes.get(ROOT_KEY).children.map(n => n.key)).toEqual(['mc:mc1']);
  });

  it('кабинеты без этажа становятся отдельным узлом рядом с этажами', () => {
    const nodes = buildNodes(tree({
      floors: [floor('f1', 1, [room('r1', '101')])],
      rooms: [room('r9', '000')],
    }));

    const loose = nodes.get('mcr:mc1');
    expect(loose.title).toBe('Без этажа');
    // Номера у такого узла нет — в переключателе это прочерк
    expect(loose.short).toBe('—');
    expect(loose.rooms).toHaveLength(1);
    // Узел либо ведёт дальше, либо заканчивается кабинетами — но не одновременно
    expect(loose.children).toBeUndefined();
    expect(nodes.get('mc:mc1').rooms).toBeUndefined();
  });

  it('склады медцентра стоят своим узлом и помечены значком', () => {
    const nodes = buildNodes(tree({
      floors: [floor('f1', 1, [room('r1', '101')])],
      services: [room('s1', 'Склад'), room('s2', 'Ремонт')],
    }));

    const services = nodes.get('svc:mc1');
    expect(services.title).toBe('Склады');
    // В переключателе у них не число, а значок: этажом склад не является
    expect(services.service).toBe(true);
    expect(services.rooms).toHaveLength(2);
  });

  it('у этажа есть короткая подпись для переключателя', () => {
    const nodes = buildNodes(tree({
      floors: [
        floor('f1', 2, [room('r1', '201')]),
        floor('f2', 4, [room('r2', '401')], 'Административный'),
      ],
    }));

    // Без имени подпись собирается из номера, короткая — только число
    expect(nodes.get('f:f1').title).toBe('2 этаж');
    expect(nodes.get('f:f1').short).toBe('2');
    expect(nodes.get('f:f1').path).toBe('Владимирская, 93 · 2 этаж');

    // С именем в переключателе всё равно число: имя показывается заголовком
    // списка — иначе два четвёртых этажа было бы не различить
    expect(nodes.get('f:f2').title).toBe('Административный');
    expect(nodes.get('f:f2').short).toBe('4');
  });

  it('старый ответ сервера с корпусами тоже разбирается', () => {
    // Сборка новее сервера: этажей у медцентра ещё нет, они лежат в корпусах.
    const nodes = buildNodes(tree({
      buildings: [{
        id: 'b1', name: 'Корпус А',
        floors: [floor('f1', 1, [room('r1', '101')]), floor('f2', 2, [room('r2', '201')])],
      }],
    }));

    expect(nodes.get('mc:mc1').children.map(n => n.key)).toEqual(['f:f1', 'f:f2']);
    expect(nodes.get('f:f1').short).toBe('1');
  });
});

describe('resolveNode', () => {
  const single = () => buildNodes(tree({floors: [floor('f1', 1, [room('r1', '101')])]}));

  it('единственный медцентр с единственным этажом ведёт сразу в кабинеты', () => {
    const node = resolveNode(single(), ROOT_KEY);
    expect(node.key).toBe('f:f1');
    expect(node.rooms).toHaveLength(1);
  });

  it('там, где выбор есть, спуск останавливается', () => {
    const nodes = buildNodes(tree({
      floors: [floor('f1', 1, [room('r1', '101')]), floor('f2', 2, [room('r2', '201')])],
    }));
    // Медцентр один — его пропускаем, но этажа два, и выбирать придётся
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
      floors: [floor('f1', 1, [room('r1', '101')]), floor('f2', 2, [room('r2', '201')])],
      rooms: [room('r9', '000')],
      services: [room('s1', 'Склад')],
    }));

    expect(leavesOf(nodes.get('mc:mc1')).map(n => n.key))
      .toEqual(['f:f1', 'f:f2', 'mcr:mc1', 'svc:mc1']);
    expect(leavesOf(nodes.get('f:f1')).map(n => n.key)).toEqual(['f:f1']);
  });
});
