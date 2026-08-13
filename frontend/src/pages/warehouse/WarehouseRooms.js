import React, { useMemo, useState } from 'react';
import {
  Search, X, ChevronRight, ChevronDown, Maximize2, Minimize2, Settings2,
} from 'lucide-react';
import RoomSettings from '../../components/warehouse/RoomSettings';

/**
 * Список кабинетов — точка входа в дашборд кабинета.
 *
 * До этого дашборд открывался единственным способом: карта → медцентр → этаж →
 * клик по кабинету на плане → кнопка в боковой панели. Четыре шага, и кабинет,
 * которому не нарисовали геометрию, на плане просто отсутствовал — попасть в его
 * дашборд было нельзя вовсе. Вкладка «Кабинеты» решает обе беды: сюда попадают
 * все кабинеты из дерева, независимо от того, есть у них план или нет.
 *
 * Форма — дерево «медцентр → корпус → этаж → кабинет», то же самое, чем показаны
 * иерархические отчёты. Плитки здесь пробовали и отказались: номер кабинета в базе
 * не число, а свободная строка вплоть до «Кабинет Ординаторская (Терапия) 3 этаж»,
 * и вместе с отделением и ФИО ответственного это в карточку не помещалось ни при
 * какой ширине. В строке таблицы текст переносится и ничего не режется, а сама
 * иерархия отвечает на вопрос «где этот кабинет» без отдельной подписи с путём.
 *
 * Данные берутся из уже загруженного дерева локаций, поэтому экран открывается
 * мгновенно и не ходит на сервер: счётчики в дереве считаются тем же запросом,
 * что и сами кабинеты.
 */

export default function WarehouseRooms({ tree, onOpenRoom, access, onReloadTree }) {
  const [q, setQ] = useState('');
  const [mcId, setMcId] = useState('');
  const [depId, setDepId] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [settingsRoom, setSettingsRoom] = useState(null);

  // Настройка кабинета требует того же права, что и выдача материалов: МОЛ и
  // места хранения — это операционные данные, а не структура сети.
  const canSetup = Boolean(access?.capabilities?.canIssue);

  const departments = tree?.departments || [];
  const depById = useMemo(() => new Map(departments.map(d => [d.id, d])), [departments]);

  const visibleDepartments = useMemo(
    () => departments.filter(d => !mcId || d.medCenterId === mcId),
    [departments, mcId]
  );

  const nodes = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = [];

    for (const mc of tree?.medCenters || []) {
      if (mcId && mc.id !== mcId) continue;
      const mcNode = group(`mc:${mc.id}`, 0, mc.name, mc.color);

      for (const b of mc.buildings || []) {
        const bNode = group(`b:${b.id}`, 1, b.name, mc.color, b.address);

        for (const f of (b.floors || []).slice().sort((x, z) => x.number - z.number)) {
          const fNode = group(`f:${f.id}`, 2, f.name || `${f.number} этаж`, mc.color);

          for (const r of f.rooms || []) {
            if (depId && r.departmentId !== depId) continue;
            const dep = r.departmentId ? depById.get(r.departmentId) : null;
            if (needle) {
              const hay = [r.number, r.name, dep?.name, mc.name, b.name, f.name,
                r.responsible?.displayName].filter(Boolean).join(' ').toLowerCase();
              if (!hay.includes(needle)) continue;
            }
            fNode.children.push({
              key: `r:${r.id}`, level: 3, room: r, department: dep,
              assets: r.counters?.assets || 0,
              positions: r.counters?.positions || 0,
            });
          }

          if (fNode.children.length) { rollup(fNode); bNode.children.push(fNode); }
        }

        if (bNode.children.length) { rollup(bNode); mcNode.children.push(bNode); }
      }

      if (mcNode.children.length) { rollup(mcNode); out.push(mcNode); }
    }
    return out;
  }, [tree, mcId, depId, q, depById]);

  const dirty = Boolean(q || mcId || depId);

  // При поиске дерево всегда раскрыто: свёрнутая ветка спрятала бы найденное, и
  // выглядело бы это как «ничего не нашлось».
  const isCollapsed = key => !q && collapsed.has(key);

  const rows = useMemo(() => {
    const out = [];
    const walk = (list) => {
      for (const n of list) {
        out.push(n);
        // Условие развёрнуто вместо вызова isCollapsed: замыкание в списке
        // зависимостей не отслеживается, и обход тихо застревал бы на старом
        // наборе свёрнутых веток.
        if (n.children && (q || !collapsed.has(n.key))) walk(n.children);
      }
    };
    walk(nodes);
    return out;
  }, [nodes, collapsed, q]);

  const totalRooms = useMemo(
    () => nodes.reduce((s, n) => s + n.rooms, 0),
    [nodes]
  );

  const toggle = (key) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // Свернуть до уровня: в набор попадают все узлы этого уровня и глубже.
  const collapseTo = (level) => {
    const next = new Set();
    const walk = (list) => {
      for (const n of list) {
        if (!n.children) continue;
        if (n.level >= level) next.add(n.key);
        walk(n.children);
      }
    };
    walk(nodes);
    setCollapsed(next);
  };

  return (
    <div className="wh-rooms">
      <div className="wh-rooms__bar">
        <div className="wh-search">
          <Search size={15} />
          <input placeholder="Номер, название кабинета, отделение, МОЛ…"
                 value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <select value={mcId} onChange={e => { setMcId(e.target.value); setDepId(''); }}>
          <option value="">Все медцентры</option>
          {(tree?.medCenters || []).map(mc => (
            <option key={mc.id} value={mc.id}>{mc.name}</option>
          ))}
        </select>
        <select value={depId} onChange={e => setDepId(e.target.value)}>
          <option value="">Все отделения</option>
          {visibleDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {dirty && (
          <button className="wh-btn wh-btn--secondary"
                  onClick={() => { setQ(''); setMcId(''); setDepId(''); }}>
            <X size={14} /> Сбросить
          </button>
        )}
      </div>

      <div className="wh-tree__bar">
        <span className="wh-tree__bar-title">Иерархия</span>
        <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={() => setCollapsed(new Set())}>
          <Maximize2 size={14} /> Раскрыть всё
        </button>
        <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={() => collapseTo(2)}>
          До этажей
        </button>
        <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={() => collapseTo(1)}>
          До корпусов
        </button>
        <button className="wh-btn wh-btn--secondary wh-btn--sm" onClick={() => collapseTo(0)}>
          <Minimize2 size={14} /> Свернуть всё
        </button>
        <span className="wh-tree__bar-count">кабинетов: {totalRooms}</span>
      </div>

      <div className="wh-table-wrap wh-table-wrap--tall">
        <table className="wh-table wh-table--compact wh-rooms__table">
          <thead>
            <tr>
              <th>Локация и кабинет</th>
              <th>Отделение</th>
              <th>МОЛ</th>
              <th className="wh-num">Хранение</th>
              <th className="wh-num">Ед. ОС</th>
              <th className="wh-num">Позиций</th>
              {canSetup && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map(n => (n.children
              ? (
                <tr key={n.key} className={`wh-tree__group wh-rooms__lvl${n.level}`}
                    onClick={() => toggle(n.key)}>
                  <td className="wh-tree__cell" style={{ paddingLeft: 10 + n.level * 20 }}>
                    <button className="wh-tree__toggle" tabIndex={-1}
                            title={isCollapsed(n.key) ? 'Раскрыть' : 'Свернуть'}>
                      {isCollapsed(n.key) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    </button>
                    {n.level === 0 && (
                      <span className="wh-rooms__dot" style={{ background: n.color || '#94a3b8' }} />
                    )}
                    <span className="wh-tree__label">{n.label}</span>
                    {n.sub && <span className="wh-rooms__gsub">{n.sub}</span>}
                  </td>
                  <td />
                  <td />
                  <td />
                  <td className="wh-num">{n.assets}</td>
                  <td className="wh-num">{n.positions}</td>
                  {canSetup && <td />}
                </tr>
              ) : (
                <tr key={n.key} className="wh-tree__leaf wh-table__row"
                    onClick={() => onOpenRoom(n.room.id)}>
                  <td className="wh-tree__cell" style={{ paddingLeft: 10 + n.level * 20 }}>
                    <span className="wh-tree__bullet" />
                    <span>
                      <span className="wh-cell-main">{roomTitle(n.room)}</span>
                      {n.room.name && n.room.name !== n.room.number && (
                        <span className="wh-cell-sub">№ {n.room.number}</span>
                      )}
                      {!n.room.hasPlan && (
                        <span className="wh-cell-sub wh-warn">нет на плане этажа</span>
                      )}
                    </span>
                  </td>
                  <td>{n.department?.name || ''}</td>
                  <td>{n.room.responsible?.displayName || <span className="wh-muted">не назначен</span>}</td>
                  {/* Кабинет без места хранения не примет ни одного материала —
                      это не украшение колонки, а блокирующее условие. */}
                  <td className="wh-num">
                    {n.room.storages?.length
                      ? n.room.storages.length
                      : <span className="wh-warn">нет</span>}
                  </td>
                  <td className="wh-num">{n.assets}</td>
                  <td className="wh-num">{n.positions}</td>
                  {canSetup && (
                    <td className="wh-num">
                      <button className="wh-icon-btn" title="Настроить: МОЛ, отделение, места хранения"
                              onClick={e => { e.stopPropagation(); setSettingsRoom(n.room); }}>
                        <Settings2 size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              )
            ))}
            {!rows.length && (
              <tr><td colSpan={canSetup ? 7 : 6} className="wh-empty">
                {dirty ? 'По условию ничего не найдено' : 'Кабинеты не заведены'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {settingsRoom && (
        <RoomSettings room={settingsRoom} departments={departments}
                      onClose={() => setSettingsRoom(null)}
                      onSaved={onReloadTree} />
      )}
    </div>
  );
}

// ── Вспомогательное ──────────────────────────────────────────────────────────

const group = (key, level, label, color, sub) => ({
  key, level, label, color, sub, children: [], rooms: 0, assets: 0, positions: 0,
});

/** Подытоги на каждом уровне — ради них иерархия и нужна. */
function rollup(node) {
  for (const c of node.children) {
    node.rooms += c.children ? c.rooms : 1;
    node.assets += c.assets;
    node.positions += c.positions;
  }
}

/**
 * Заголовок строки кабинета. «Каб.» приписывается только к коротким номерам:
 * к строке вроде «Ординаторская (Терапия)» приставка читается как заикание.
 */
function roomTitle(room) {
  const num = String(room.number ?? '').trim();
  if (room.name && room.name !== room.number) return room.name;
  return num.length <= 5 ? `Каб. ${num}` : num;
}
