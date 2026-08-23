/**
 * Дерево локаций для выбора кабинета: медцентр → корпус → этаж → кабинеты.
 *
 * Отдельным модулем от экрана, потому что здесь два правила, от которых зависит
 * весь спуск, и проверять их удобнее прямо, а не через отрисовку списка:
 * отбрасывание пустых веток и склейка уровней, на которых выбирать не из чего.
 */

export const ROOT_KEY = '';
const floorTitle = floor => floor.name || `${floor.number} этаж`;

/**
 * Дерево локаций → узлы для спуска.
 *
 * Узел либо ведёт дальше (children), либо заканчивается кабинетами (rooms), но
 * никогда не то и другое сразу: кабинеты медцентра без корпуса становятся
 * отдельным узлом «Без корпуса» рядом с корпусами, а не подмешиваются к ним
 * списком другого рода.
 *
 * Ветки без единого кабинета отбрасываются. Сервер отдаёт их тем, кому можно
 * править локации, — на телефоне править нечего, и пустой корпус здесь только
 * обещание, за которым ничего нет.
 */
export function buildNodes(tree) {
  const byKey = new Map();
  const keep = (node) => { byKey.set(node.key, node); return node; };
  const countOf = node => (node.rooms
    ? node.rooms.length
    : node.children.reduce((sum, child) => sum + child.count, 0));

  const medCenters = [];
  for (const mc of tree?.medCenters || []) {
    const children = [];

    for (const building of mc.buildings || []) {
      const floors = [];
      for (const floor of building.floors || []) {
        if (!floor.rooms?.length) continue;
        const path = [mc.name, building.name, floorTitle(floor)].filter(Boolean).join(' · ');
        floors.push(keep({
          key: `f:${floor.id}`,
          kind: 'floor',
          title: floorTitle(floor),
          subtitle: building.name,
          path,
          rooms: floor.rooms,
          count: floor.rooms.length,
        }));
      }
      if (!floors.length) continue;
      const node = keep({
        key: `b:${building.id}`,
        kind: 'building',
        title: building.name,
        subtitle: building.address,
        children: floors,
      });
      node.count = countOf(node);
      children.push(node);
    }

    if (mc.rooms?.length) {
      children.push(keep({
        key: `mcr:${mc.id}`,
        kind: 'floor',
        title: 'Без корпуса',
        path: [mc.name, 'Без корпуса'].filter(Boolean).join(' · '),
        rooms: mc.rooms,
        count: mc.rooms.length,
      }));
    }

    if (!children.length) continue;
    const node = keep({
      key: `mc:${mc.id}`,
      kind: 'mc',
      title: mc.name,
      subtitle: mc.city,
      children,
    });
    node.count = countOf(node);
    medCenters.push(node);
  }

  const root = keep({key: ROOT_KEY, kind: 'root', title: 'Кабинеты', children: medCenters});
  root.count = countOf(root);
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
