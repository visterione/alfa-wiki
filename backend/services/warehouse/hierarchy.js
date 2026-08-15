/**
 * Иерархические отчёты: сборка дерева с итогами на каждом уровне.
 *
 * ТЗ требует от оборотно-сальдовой ведомости именно дерева:
 *
 *   Главный корпус
 *     3 этаж
 *       Хирургическое отделение
 *         Каб. 312 — Операционная №2
 *           Шкаф А, полка 2
 *             Перчатки нитриловые L
 *
 * Плоская таблица с колонками «корпус / этаж / отделение» отвечает на другой
 * вопрос. Иерархия нужна не для красоты: в ней читаются подытоги по каждому
 * уровню — сколько лежит в кабинете целиком, сколько в отделении, сколько в
 * корпусе. По плоской таблице это приходится складывать глазами.
 *
 * Дерево строится на сервере, а не на клиенте, потому что тот же результат идёт
 * в XLSX и PDF. Считай его фронтенд — выгрузка и экран разошлись бы при первой
 * же правке, и «в файле другие цифры» стало бы вопросом времени.
 *
 * Результат — плоский список строк с полем __level. Такой формат одинаково
 * ложится и в отрисовку с отступами, и в группировку строк Excel (outlineLevel),
 * и не требует рекурсии на принимающей стороне.
 */

/**
 * @param {Array}  rows     плоские строки из SQL
 * @param {Array}  levels   [{ key, label(row), id(row) }] — уровни сверху вниз
 * @param {Array}  measures числовые поля, которые суммируются по уровням
 * @param {Function} leaf   (row) => объект строки-листа
 */
function buildTree(rows, levels, measures, leaf) {
  const root = { children: new Map(), totals: zero(measures) };

  for (const row of rows) {
    let node = root;
    const path = [];

    for (const level of levels) {
      const id = String(level.id(row) ?? '—');
      path.push(id);
      if (!node.children.has(id)) {
        node.children.set(id, {
          key: path.join('/'),
          label: level.label(row),
          levelKey: level.key,
          children: new Map(),
          leaves: [],
          totals: zero(measures),
        });
      }
      node = node.children.get(id);
      add(node.totals, row, measures);
    }
    add(root.totals, row, measures);
    node.leaves.push(row);
  }

  // Разворачиваем в плоский список: группа, её подгруппы, затем листья. Порядок
  // соответствует чтению сверху вниз, как в макете ТЗ.
  const out = [];

  const walk = (node, depth) => {
    for (const child of node.children.values()) {
      out.push({
        __level: depth,
        __isGroup: true,
        __key: child.key,
        __levelKey: child.levelKey,
        label: child.label,
        ...child.totals,
      });
      walk(child, depth + 1);
      for (const row of child.leaves) {
        out.push({ __level: depth + 1, __isGroup: false, __parentKey: child.key, ...leaf(row) });
      }
    }
  };
  walk(root, 0);

  return { rows: out, totals: root.totals };
}

function zero(measures) {
  return Object.fromEntries(measures.map(m => [m, 0]));
}

function add(target, row, measures) {
  for (const m of measures) target[m] += Number(row[m]) || 0;
}

/**
 * Уровни оборотно-сальдовой ведомости. Медцентр включается только когда их
 * несколько: при отборе по одному филиалу лишний уровень с единственной веткой
 * съедает ширину и ничего не сообщает.
 */
function turnoverLevels(rows) {
  const manyMedCenters = new Set(rows.map(r => r.medCenterName)).size > 1;
  const levels = [];

  if (manyMedCenters) {
    levels.push({ key: 'medCenter', id: r => r.medCenterName, label: r => r.medCenterName });
  }
  if (rows.some(r => r.buildingName)) {
    levels.push({ key: 'building', id: r => r.buildingName || 'Без корпуса',
      label: r => r.buildingName || 'Без корпуса' });
  }
  if (rows.some(r => r.floorNumber !== null && r.floorNumber !== undefined)) {
    levels.push({ key: 'floor', id: r => `${r.buildingName || 'none'}#${r.floorNumber ?? 'none'}`,
      label: r => r.floorNumber === null || r.floorNumber === undefined
        ? 'Без этажа' : `${r.floorNumber} этаж` });
  }
  levels.push(
    { key: 'department', id: r => r.departmentId || `nodept:${r.roomId}`,
      label: r => r.departmentName || 'Без отделения' },
    { key: 'room',       id: r => r.roomId,
      label: r => `Каб. ${r.roomNumber}${r.roomName && r.roomName !== r.roomNumber ? ` — ${r.roomName}` : ''}` },
    { key: 'storage',    id: r => r.storageId, label: r => r.storageName },
  );
  return levels;
}

/** Уровни отчёта о расходе: отделение → кабинет → номенклатура. */
function consumptionLevels(rows) {
  const manyMedCenters = new Set(rows.map(r => r.medCenterName)).size > 1;
  const levels = [];
  if (manyMedCenters) {
    levels.push({ key: 'medCenter', id: r => r.medCenterName, label: r => r.medCenterName });
  }
  levels.push(
    { key: 'department', id: r => r.departmentName || 'Без отделения',
      label: r => r.departmentName || 'Без отделения' },
    { key: 'room', id: r => r.roomId,
      label: r => `Каб. ${r.roomNumber}${r.roomName && r.roomName !== r.roomNumber ? ` — ${r.roomName}` : ''}` },
  );
  return levels;
}

module.exports = { buildTree, turnoverLevels, consumptionLevels };
