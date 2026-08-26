/**
 * Дерево локаций для выбора кабинета: медцентр → этаж → кабинеты.
 *
 * Отдельным модулем от экрана, потому что здесь два правила, от которых зависит
 * весь спуск, и проверять их удобнее прямо, а не через отрисовку списка:
 * отбрасывание пустых веток и склейка уровней, на которых выбирать не из чего.
 *
 * Корпуса убраны из спуска (ver. 7.48). На живых пользователях уровень корпуса
 * не проходил никто: человек знает, что он на четвёртом этаже, а в каком
 * корпусе — вспоминает не всегда, и лишнее нажатие стояло на каждом выборе
 * кабинета. Сервер отдаёт этажи медцентра плоским списком (mc.floors); разбор
 * mc.buildings оставлен запасным путём на случай, когда сборка новее сервера.
 */

export const ROOT_KEY = '';
const floorTitle = floor => floor.name || `${floor.number} этаж`;

/**
 * Дерево локаций → узлы для спуска.
 *
 * Узел либо ведёт дальше (children), либо заканчивается кабинетами (rooms), но
 * никогда не то и другое сразу: кабинеты медцентра без этажа становятся
 * отдельным узлом рядом с этажами, а не подмешиваются к ним списком другого
 * рода.
 *
 * Ветки без единого кабинета отбрасываются. Сервер отдаёт их тем, кому можно
 * править локации, — на телефоне править нечего, и пустой этаж здесь только
 * обещание, за которым ничего нет.
 */
/**
 * Счётчики ветки: сколько в ней кабинетов, единиц оборудования и позиций
 * материалов.
 *
 * Раньше у узла было одно число — количество кабинетов, — и в строке списка оно
 * читалось как «сколько там имущества», хотя отвечало на другой вопрос.
 * Оборудование и материалы разведены, потому что это разные вещи: первое
 * считается карточками с инвентарными номерами, второе — позициями на остатке,
 * и складывать их в одну цифру бессмысленно.
 */
const countsOf = (node) => {
  if (node.rooms) {
    return node.rooms.reduce((acc, room) => ({
      rooms: acc.rooms + 1,
      assets: acc.assets + (room.counters?.assets || 0),
      materials: acc.materials + (room.counters?.positions || 0),
    }), {rooms: 0, assets: 0, materials: 0});
  }
  return node.children.reduce((acc, child) => ({
    rooms: acc.rooms + child.counts.rooms,
    assets: acc.assets + child.counts.assets,
    materials: acc.materials + child.counts.materials,
  }), {rooms: 0, assets: 0, materials: 0});
};

/**
 * Медцентры для переключателя в шапке склада.
 *
 * Правило то же, по которому buildNodes отбрасывает пустые ветки: медцентр без
 * единого кабинета выбирать бессмысленно — за ним ничего нет, и в списке он
 * только обещание. На сети из девяти юридических лиц складом занята пока часть,
 * и без этого отбора переключатель предлагал бы восемь заведомо пустых строк.
 *
 * Считается по всем трём местам, где у медцентра бывают кабинеты: этажи, «без
 * этажа» и склады. Разбор старого ответа сервера (корпуса) оставлен по той же
 * причине, что и в buildNodes: сборка может оказаться новее сервера.
 */
export function medCentersOf(tree) {
  return (tree?.medCenters || [])
    .map(mc => {
      const floors = mc.floors?.length
        ? mc.floors
        : (mc.buildings || []).flatMap(b => b.floors || []);
      const rooms = floors.reduce((n, f) => n + (f.rooms?.length || 0), 0)
        + (mc.rooms?.length || 0) + (mc.services?.length || 0);
      return {
        id: mc.id,
        title: mc.name,
        // Адрес, а не город: медцентров в одном городе несколько, и различают
        // их по улице — то же правило, что в узле спуска.
        subtitle: mc.address || mc.city || null,
        // Квадратный знак предпочтительнее: в кнопке шапки и в клетке списка
        // место квадратное, и вытянутый логотип в нём ужимается до нечитаемого.
        logoUrl: mc.logoSquareUrl || mc.logoUrl || null,
        rooms,
      };
    })
    .filter(mc => mc.rooms > 0);
}

export function buildNodes(tree) {
  const byKey = new Map();
  const keep = (node) => { byKey.set(node.key, node); return node; };

  const medCenters = [];
  for (const mc of tree?.medCenters || []) {
    const children = [];

    // Этажи медцентра — плоским списком. Старый ответ сервера (корпуса) тоже
    // разбирается: сборка может оказаться новее сервера, и пустой список
    // кабинетов на телефоне выглядел бы как поломка склада.
    const floors = mc.floors?.length
      ? mc.floors
      : (mc.buildings || []).flatMap(b => (b.floors || []).map(f => ({...f, buildingName: b.name})));

    for (const floor of floors) {
      if (!floor.rooms?.length) continue;
      const path = [mc.name, floorTitle(floor)].filter(Boolean).join(' · ');
      const node = keep({
        key: `f:${floor.id}`,
        kind: 'floor',
        title: floorTitle(floor),
        // Подпись этажа — его номер: после отказа от корпусов у медцентра
        // временно бывает два четвёртых этажа, и различает их название.
        subtitle: floor.name ? `${floor.number} этаж` : (floor.buildingName || null),
        // Короткая подпись для переключателя этажей: там помещается число, и
        // ничего кроме числа там и не нужно — «3 этаж» в клетке 44×44 не
        // читается, а обрезанное «3 эт…» читается как ошибка.
        short: String(floor.number ?? '?'),
        path,
        rooms: floor.rooms,
      });
      node.counts = countsOf(node);
      children.push(node);
    }

    if (mc.rooms?.length) {
      const loose = keep({
        key: `mcr:${mc.id}`,
        kind: 'floor',
        title: 'Без этажа',
        // Номера у него нет по определению — в переключателе это прочерк.
        short: '—',
        path: [mc.name, 'Без этажа'].filter(Boolean).join(' · '),
        rooms: mc.rooms,
      });
      loose.counts = countsOf(loose);
      children.push(loose);
    }

    // Склады медцентра — своим узлом рядом с корпусами (ver. 7.47). Не внутри
    // корпуса и не среди кабинетов без корпуса: помещения за складом нет, он
    // общий на весь медцентр, и в списке его ищут по названию, а не по номеру.
    if (mc.services?.length) {
      const services = keep({
        key: `svc:${mc.id}`,
        kind: 'floor',
        // Склады — не этаж, и числа у них нет: в переключателе это значок.
        service: true,
        title: 'Склады',
        path: [mc.name, 'Склады'].filter(Boolean).join(' · '),
        rooms: mc.services,
      });
      services.counts = countsOf(services);
      children.push(services);
    }

    if (!children.length) continue;
    const node = keep({
      key: `mc:${mc.id}`,
      kind: 'mc',
      title: mc.name,
      // Адрес, а не город: медцентров в одном городе несколько, и различают их
      // по улице. Город остаётся запасным вариантом, когда адрес не заполнен.
      subtitle: mc.address || mc.city,
      logoUrl: mc.logoUrl || null,
      children,
    });
    node.counts = countsOf(node);
    medCenters.push(node);
  }

  const root = keep({key: ROOT_KEY, kind: 'root', title: 'Кабинеты', children: medCenters});
  root.counts = countsOf(root);
  return byKey;
}

/** Листья поддерева — узлы с кабинетами. Они же группы плоского списка. */
export const leavesOf = node => (node.rooms ? [node] : node.children.flatMap(leavesOf));

/**
 * Узел, который на самом деле нужно показать.
 *
 * Уровень с единственным потомком пропускается: у медцентра один корпус —
 * попадаешь сразу на его этажи, один этаж — сразу в кабинеты. Экран «выберите
 * единственный вариант» это не навигация, а лишнее нажатие.
 */
export function resolveNode(byKey, key) {
  let node = byKey?.get(key) || byKey?.get(ROOT_KEY) || null;
  while (node?.children?.length === 1) node = node.children[0];
  return node;
}
