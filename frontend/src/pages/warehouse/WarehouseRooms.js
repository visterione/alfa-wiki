import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Search, X, ChevronRight, ChevronDown, Maximize2, Minimize2,
  Settings2, Layers, Building2, Check,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';
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
  const [fromMis, setFromMis] = useState(null);

  // Настройка кабинета требует того же права, что и выдача материалов: МОЛ и
  // места хранения — это операционные данные, а не структура сети.
  const canSetup = Boolean(access?.capabilities?.canIssue);
  // А заведение самих кабинетов — это уже структура, и право на неё отдельное.

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

      const addRoom = (parent, r, level, locationNames = []) => {
        if (depId && r.departmentId !== depId) return;
        const dep = r.departmentId ? depById.get(r.departmentId) : null;
        if (needle) {
          const hay = [r.number, r.name, dep?.name, mc.name, ...locationNames,
            r.responsible?.displayName].filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(needle)) return;
        }
        parent.children.push({
          key: `r:${r.id}`, level, room: r, department: dep,
          assets: r.counters?.assets || 0,
          positions: r.counters?.positions || 0,
        });
      };

      // Небольшой медцентр может не иметь ни корпусов, ни этажей.
      for (const r of mc.rooms || []) addRoom(mcNode, r, 1);

      for (const b of mc.buildings || []) {
        const bNode = group(`b:${b.id}`, 1, b.name, mc.color, b.address);

        for (const f of (b.floors || []).slice().sort((x, z) => x.number - z.number)) {
          const fNode = group(`f:${f.id}`, 2, f.name || `${f.number} этаж`, mc.color);

          for (const r of f.rooms || []) {
            addRoom(fNode, r, 3, [b.name, f.name]);
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

        {/* Свёртка дерева стоит рядом с фильтрами: это такая же настройка вида
            списка, как медцентр или отделение. Отдельная полоса «Иерархия» под
            фильтрами занимала строку ради четырёх кнопок и разрывала блок
            управления надвое. Подписи сняты — команды короткие, а всплывающая
            подсказка называет каждую полностью. */}
        <div className="wh-rooms__collapse">
          <button className="wh-icon-btn" title="Раскрыть всё"
                  onClick={() => setCollapsed(new Set())}>
            <Maximize2 size={15} />
          </button>
          <button className="wh-icon-btn" title="Свернуть до этажей"
                  onClick={() => collapseTo(2)}>
            <Layers size={15} />
          </button>
          <button className="wh-icon-btn" title="Свернуть до корпусов"
                  onClick={() => collapseTo(1)}>
            <Building2 size={15} />
          </button>
          <button className="wh-icon-btn" title="Свернуть всё"
                  onClick={() => collapseTo(0)}>
            <Minimize2 size={15} />
          </button>
        </div>
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
                    {/* Одна строка, без вложенного столбика. Раньше здесь под
                        названием шли уточнения — номер и отметка об отсутствии на
                        плане, — и у кабинета, которому уточнять нечего, оставалась
                        пустая вторая строка: столбик из одного элемента всё равно
                        занимал высоту двух. Номер и так виден в названии, а отметка
                        о плане стала значком в конце строки. */}
                    <span className="wh-cell-main">{roomTitle(n.room)}</span>
                    {n.room.floorId && !n.room.hasPlan && (
                      <span className="wh-chip wh-chip--warn" title="Кабинет не нарисован на плане этажа">
                        нет на плане
                      </span>
                    )}
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

      {/* Кнопка «Завести из МИС» убрана из полосы фильтров по просьбе, и открыть
          эту модалку сейчас неоткуда. Сам поток (RoomsFromMis ниже) не удалён:
          если вход понадобится вернуть — в полосу или в редактор планов, — хватит
          одной кнопки с setFromMis({}). */}
      {fromMis && (
        <RoomsFromMis
          tree={tree} departments={departments}
          onClose={() => setFromMis(null)}
          onCreated={async () => { setFromMis(null); await onReloadTree?.(); }}
        />
      )}
    </div>
  );
}

/**
 * Завести кабинеты по списку из МИС.
 *
 * ── Что здесь происходит и чего не происходит ────────────────────────────────
 *
 * Из МИС берётся ровно одно: перечень названий кабинетов, в которых реально
 * ведётся приём. Портал НЕ решает, какой строке ведомости соответствует какой
 * кабинет — это разные задачи, и привязку имущества человек делает сам на экране
 * размещения. Здесь просто не набирают сотню названий с клавиатуры.
 *
 * ── Выбор этажа ─────────────────────────────────────────────────────────────
 *
 * В МИС у кабинета нет ни корпуса, ни этажа — только строка названия. Угадать их
 * неоткуда. Для многоэтажной площадки человек может указать этаж, а для
 * небольшого медцентра оставляет поле пустым. Уже заведённые кабинеты
 * пропускаются, поэтому повторный запуск безопасен.
 */
function RoomsFromMis({ tree, departments, onClose, onCreated }) {
  const [mcId, setMcId] = useState(tree?.medCenters?.[0]?.id || '');
  const [floorId, setFloorId] = useState('');
  const [depId, setDepId] = useState('');
  const [rows, setRows] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const floors = useMemo(() => {
    const mc = (tree?.medCenters || []).find(m => m.id === mcId);
    const out = [];
    for (const b of mc?.buildings || []) {
      for (const f of b.floors || []) {
        out.push({ id: f.id, label: `${b.name} · ${f.name || `${f.number} этаж`}` });
      }
    }
    return out;
  }, [tree, mcId]);

  useEffect(() => {
    if (!mcId) { setRows(null); return; }
    setLoading(true);
    warehouseApi.misRoomSuggestions({ medCenterId: mcId })
      .then(({ data }) => {
        setRows(data.rooms || []);
        // Сразу отмечаем те, которых в портале ещё нет: это и есть работа,
        // остальное человек снимает вручную, если что-то заводить не надо.
        setPicked(new Set((data.rooms || []).filter(r => !r.matched).map(r => r.room)));
      })
      .catch(e => {
        toast.error(e.response?.data?.error || 'МИС не отдал список кабинетов');
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [mcId]);

  const toggle = (name) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const submit = async () => {
    if (!mcId) return toast.error('Выберите медцентр');
    if (!picked.size) return toast.error('Не выбрано ни одного кабинета');
    setSaving(true);
    try {
      const { data } = await warehouseApi.createRoomsFromMis({
        medCenterId: mcId, floorId: floorId || null,
        departmentId: depId || null, rooms: [...picked],
      });
      toast.success(
        `Заведено кабинетов: ${data.created}`
        + (data.skipped ? `, пропущено уже существующих: ${data.skipped}` : ''),
      );
      await onCreated();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось завести кабинеты');
    } finally {
      setSaving(false);
    }
  };

  const fresh = (rows || []).filter(r => !r.matched);

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--wide" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">Завести кабинеты из МИС</div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          <div className="wh-form">
            <div className="wh-form__row2">
              <label>Медцентр
                <select value={mcId} onChange={e => {
                  setMcId(e.target.value); setFloorId(''); setDepId('');
                }}>
                  <option value="">Выберите…</option>
                  {(tree?.medCenters || []).map(mc => (
                    <option key={mc.id} value={mc.id}>{mc.name}</option>
                  ))}
                </select>
              </label>
              <label>Корпус и этаж (необязательно)
                <select value={floorId} onChange={e => setFloorId(e.target.value)}>
                  <option value="">— без корпуса и этажа —</option>
                  {floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </label>
            </div>
            <label>Отделение (необязательно)
              <select value={depId} onChange={e => setDepId(e.target.value)}>
                <option value="">— не задавать —</option>
                {departments.filter(d => !mcId || d.medCenterId === mcId)
                  .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          </div>

          {loading && <div className="wh-table__loading"><div className="loading-spinner" /></div>}

          {rows && !loading && (
            <>
              <div className="wh-subhead">
                Новых: {fresh.length} из {rows.length} · отмечено: {picked.size}
              </div>
              <div className="wh-table-wrap wh-table-wrap--tall">
                <table className="wh-table wh-table--compact">
                  <thead>
                    <tr>
                      <th style={{ width: 30 }} />
                      <th>Кабинет в МИС</th>
                      <th className="wh-num">Приёмов</th>
                      <th>Состояние</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.room} className="wh-table__row"
                          onClick={() => !row.matched && toggle(row.room)}>
                        <td>
                          <input type="checkbox" checked={picked.has(row.room)}
                                 disabled={row.matched} onChange={() => {}} />
                        </td>
                        <td>{row.room}</td>
                        <td className="wh-num">{row.appointments}</td>
                        <td className={row.matched ? 'wh-muted' : 'wh-ok'}>
                          {row.matched ? 'уже есть в портале' : 'новый'}
                        </td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr><td colSpan={4} className="wh-empty">
                        МИС не вернул ни одного кабинета. Проверьте, что у медцентра
                        заданы идентификаторы клиник.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button>
          <button className="wh-btn wh-btn--primary" onClick={submit}
                  disabled={saving || !picked.size || !mcId}>
            <Check size={15} /> {saving ? 'Завожу…' : `Завести ${picked.size}`}
          </button>
        </div>
      </div>
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
