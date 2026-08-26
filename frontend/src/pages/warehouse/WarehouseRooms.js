import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Search, X, ChevronRight, ChevronDown, Maximize2, Minimize2,
  Settings2, Layers, Building2, Check, Printer, FileText, Network, Boxes,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';
import RoomSettings from '../../components/warehouse/RoomSettings';
import DepartmentsManager from './DepartmentsManager';
import { openPrintWindow, downloadTextFile } from './components/printLabels';

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
 *
 * Отсюда же печатаются дверные этикетки пачкой. Раньше карточка кабинета отдавала
 * ровно одну, и промаркировать этаж значило тридцать раз открыть дашборд и
 * тридцать раз пройти диалог печати. Отметка стоит и на группах дерева: этикетки
 * заказывают этажом или медцентром целиком, а не перечислением кабинетов.
 */

export default function WarehouseRooms({ tree, onOpenRoom, access, onReloadTree }) {
  const [q, setQ] = useState('');
  const [mcId, setMcId] = useState('');
  const [depId, setDepId] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [settingsRoom, setSettingsRoom] = useState(null);
  const [departmentsOpen, setDepartmentsOpen] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [fromMis, setFromMis] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [labelSize, setLabelSize] = useState('80x24');
  const [printing, setPrinting] = useState(false);

  // Настройка кабинета требует того же права, что и выдача материалов: МОЛ и
  // места хранения — это операционные данные, а не структура сети.
  const canSetup = Boolean(access?.capabilities?.canIssue);
  // А заведение самих кабинетов — это уже структура, и право на неё отдельное.
  // Тем же правом правится справочник отделений: отделение — часть структуры
  // сети, а не операционные данные кабинета.
  const canEditStructure = Boolean(access?.capabilities?.canEditLocations);
  // Печать этикеток — своё право: печатают их не те, кто ведёт учёт.
  const canPrint = Boolean(access?.capabilities?.canPrintLabels);

  const departments = tree?.departments || [];
  const depById = useMemo(() => new Map(departments.map(d => [d.id, d])), [departments]);

  const visibleDepartments = useMemo(
    () => departments.filter(d => !mcId || d.medCenterId === mcId),
    [departments, mcId]
  );

  // Погашенное в справочнике отделение исчезает из дерева, а фильтр продолжал бы
  // держать его id: список кабинетов пустел, и выглядело это так, будто вместе с
  // отделением пропали и кабинеты. Сбрасываем фильтр, когда отделения не стало.
  useEffect(() => {
    if (depId && !departments.some(d => d.id === depId)) setDepId('');
  }, [departments, depId]);

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

      // Этажи лежат прямо под медцентром (ver. 7.48): уровень корпуса убран, и
      // дерево стало на ступень мельче. Два одноимённых этажа, оставшиеся после
      // отказа от корпусов, различаются собственным названием — оно и стоит в
      // заголовке ветки.
      for (const f of (mc.floors || []).slice().sort((x, z) => x.number - z.number)) {
        const title = f.name ? `${f.number} этаж — ${f.name}` : `${f.number} этаж`;
        const fNode = group(`f:${f.id}`, 1, title, mc.color);

        for (const r of f.rooms || []) addRoom(fNode, r, 2, [f.name]);

        if (fNode.children.length) { rollup(fNode); mcNode.children.push(fNode); }
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

  // ── Отметки под печать ──────────────────────────────────────────────────────
  // Отмечаются только кабинеты; галочка на группе — это отметка всех кабинетов
  // под ней. Хранить в наборе сами группы было бы нечем: печатается кабинет, а
  // не этаж, и после смены фильтра состав этажа другой.
  const leafIds = (node) => {
    const out = [];
    const walk = (n) => {
      if (n.children) { for (const c of n.children) walk(c); return; }
      out.push(n.room.id);
    };
    walk(node);
    return out;
  };

  // Все кабинеты, попавшие в текущий фильтр: «отметить все найденные» — то, ради
  // чего печать пачкой и нужна. Человек сужает список до этажа и печатает его
  // целиком, а не отмечает тридцать строк по одной.
  const foundIds = useMemo(() => {
    const out = [];
    const walk = (list) => {
      for (const n of list) {
        if (n.children) walk(n.children); else out.push(n.room.id);
      }
    };
    walk(nodes);
    return out;
  }, [nodes]);

  const toggleChecked = (ids) => setChecked(prev => {
    const next = new Set(prev);
    // Группа переключается целиком: отмечена не полностью — доотмечаем, отмечена
    // вся — снимаем. Иначе клик по наполовину отмеченному этажу снимал бы то, что
    // только что отметили вручную.
    const all = ids.every(id => next.has(id));
    for (const id of ids) { if (all) next.delete(id); else next.add(id); }
    return next;
  });

  const printCards = async () => {
    if (!checked.size) return toast.error('Отметьте кабинеты для печати');
    setPrinting(true);
    try {
      const { data } = await warehouseApi.roomDoorCardsBatch({ ids: [...checked], size: labelSize });
      openPrintWindow({ ...data, title: 'Карточки кабинетов' });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось подготовить этикетки');
    } finally {
      setPrinting(false);
    }
  };

  const downloadZpl = async () => {
    if (!checked.size) return toast.error('Отметьте кабинеты для печати');
    setPrinting(true);
    try {
      const { data: zpl } = await warehouseApi.roomDoorCardsBatchZpl({ ids: [...checked] });
      downloadTextFile(zpl, `rooms-44x25-${checked.size}.zpl`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось подготовить ZPL для TDP-225');
    } finally {
      setPrinting(false);
    }
  };

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
        {/* Справочник отделений открывается прямо из фильтра по ним: сюда человек
            приходит ровно в тот момент, когда обнаруживает, что нужного отделения
            в списке нет. Раньше отделение можно было завести только в редакторе
            планов — то есть уйдя с этого экрана и выбрав медцентр и этаж заново. */}
        {canEditStructure && (
          <button className="wh-icon-btn" title="Справочник отделений"
                  onClick={() => setDepartmentsOpen(true)}>
            <Network size={15} />
          </button>
        )}
        {/* Склад заводится отсюда, а не из редактора планов: помещения за ним
            нет, рисовать его негде, и попасть в редактор ради него значило бы
            выбрать медцентр и этаж, которых у склада не бывает (ver. 7.47). */}
        {canEditStructure && (
          <button className="wh-icon-btn" title="Завести склад"
                  onClick={() => setServiceOpen(true)}>
            <Boxes size={15} />
          </button>
        )}

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
          {/* Уровней стало на один меньше (ver. 7.48): медцентр и этаж.
              Кнопка «до корпусов» ушла вместе с самими корпусами. */}
          <button className="wh-icon-btn" title="Свернуть до этажей"
                  onClick={() => collapseTo(1)}>
            <Layers size={15} />
          </button>
          <button className="wh-icon-btn" title="Свернуть до медцентров"
                  onClick={() => collapseTo(0)}>
            <Building2 size={15} />
          </button>
          <button className="wh-icon-btn" title="Свернуть всё"
                  onClick={() => collapseTo(0)}>
            <Minimize2 size={15} />
          </button>
        </div>
      </div>

      {canPrint && (
        <div className={`wh-bulkbar ${checked.size ? 'is-active' : ''}`}>
          {/* Полоса молчит, пока ничего не отмечено: подсказка «отметьте кабинеты»
              занимала бы строку постоянно, а нужна ровно один раз. Кнопки и без
              неё неактивны, пока выбор пуст. */}
          {checked.size > 0 && <span>Отмечено: {checked.size}</span>}
          <select value={labelSize} onChange={e => setLabelSize(e.target.value)}>
            <optgroup label="Brother P-touch E550W">
              <option value="80x24">Альбомная · лента 24 мм · 80 × 24 мм</option>
            </optgroup>
            <optgroup label="TDP-225">
              <option value="44x25">Этикетка 44 × 25 мм</option>
            </optgroup>
          </select>
          <button className="wh-btn wh-btn--ghost" onClick={printCards}
                  disabled={!checked.size || printing}>
            <Printer size={15} /> {printing ? 'Готовлю…' : 'Печать этикеток'}
          </button>
          {labelSize === '44x25' && (
            <button className="wh-btn wh-btn--ghost" onClick={downloadZpl}
                    disabled={!checked.size || printing}>
              <FileText size={15} /> Скачать ZPL
            </button>
          )}
          <button className="wh-btn wh-btn--ghost" disabled={!foundIds.length}
                  onClick={() => setChecked(new Set(foundIds))}>
            Отметить все {foundIds.length}
          </button>
          {checked.size > 0 && (
            <button className="wh-btn wh-btn--link" onClick={() => setChecked(new Set())}>
              Снять отметки
            </button>
          )}
        </div>
      )}

      <div className="wh-table-wrap wh-table-wrap--tall">
        <table className="wh-table wh-table--compact wh-rooms__table">
          <thead>
            <tr>
              {canPrint && <th style={{ width: 30 }} />}
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
                  {canPrint && (
                    <td onClick={e => { e.stopPropagation(); toggleChecked(leafIds(n)); }}>
                      <GroupCheck ids={leafIds(n)} checked={checked} />
                    </td>
                  )}
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
                  {canPrint && (
                    <td onClick={e => { e.stopPropagation(); toggleChecked([n.room.id]); }}>
                      <input type="checkbox" checked={checked.has(n.room.id)} onChange={() => {}} />
                    </td>
                  )}
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
              <tr><td colSpan={6 + (canSetup ? 1 : 0) + (canPrint ? 1 : 0)} className="wh-empty">
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

      {departmentsOpen && (
        <DepartmentsManager tree={tree}
                            onClose={() => setDepartmentsOpen(false)}
                            onChanged={onReloadTree} />
      )}

      {serviceOpen && (
        <NewServicePlace
          tree={tree}
          onClose={() => setServiceOpen(false)}
          onCreated={async () => { setServiceOpen(false); await onReloadTree?.(); }}
        />
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
    for (const f of mc?.floors || []) {
      out.push({ id: f.id, label: f.name ? `${f.number} этаж — ${f.name}` : `${f.number} этаж` });
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

/**
 * Новый склад медцентра (ver. 7.47).
 *
 * Полей два — медцентр и название, — и больше их быть не может: этажа у склада
 * нет, отделения нет, часов приёма нет. Место хранения заводится вместе с ним
 * на сервере: без него в склад нельзя положить ни материал, ни карточку, а
 * заставлять человека помнить про этот второй шаг — способ получить склад,
 * который ничего не принимает.
 */
function NewServicePlace({ tree, onClose, onCreated }) {
  const centers = tree?.medCenters || [];
  const [mcId, setMcId] = useState(centers.length === 1 ? centers[0].id : '');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const clean = name.trim();
    if (!mcId) return toast.error('Выберите медцентр');
    if (!clean) return toast.error('Нужно название');
    setSaving(true);
    try {
      // Номер и название одинаковые: у склада номера нет, а поле обязательное —
      // и подпись везде собирается из названия.
      await warehouseApi.createRoom({
        medCenterId: mcId, number: clean, name: clean, isService: true, kind: 'storage',
      });
      toast.success(`Склад «${clean}» заведён`);
      await onCreated?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось завести склад');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">Новый склад</div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          <div className="wh-form">
            <label>Медцентр
              <select value={mcId} onChange={e => setMcId(e.target.value)}>
                <option value="">Выберите…</option>
                {centers.map(mc => <option key={mc.id} value={mc.id}>{mc.name}</option>)}
              </select>
            </label>
            <label>Название
              <input value={name} maxLength={60} placeholder="Резерв, Списание, Архив…"
                     onChange={e => setName(e.target.value)} />
            </label>
            <div className="wh-muted">
              Склад общий на весь медцентр: этажа и отделения у него нет. Между
              медцентрами склады не общие.
            </div>
          </div>
        </div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button>
          <button className="wh-btn wh-btn--primary" onClick={submit} disabled={saving}>
            <Check size={15} /> {saving ? 'Завожу…' : 'Завести'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Вспомогательное ──────────────────────────────────────────────────────────

/**
 * Отметка группы дерева: отмечена, если отмечены все кабинеты под ней, и
 * промежуточная, если только часть.
 *
 * Промежуточное состояние выставляется через ref, а не атрибутом: indeterminate
 * у чекбокса живёт только в DOM-свойстве, разметкой его не задать — без этого
 * наполовину отмеченный этаж выглядел бы неотмеченным вовсе.
 */
function GroupCheck({ ids, checked }) {
  const marked = ids.filter(id => checked.has(id)).length;
  const all = ids.length > 0 && marked === ids.length;
  return (
    <input type="checkbox" checked={all} onChange={() => {}}
           ref={el => { if (el) el.indeterminate = marked > 0 && !all; }} />
  );
}


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
  // У склада приставки нет никогда: «Каб. Склад» читается как ошибка ввода.
  if (room.isService) return room.name || num;
  if (room.name && room.name !== room.number) return room.name;
  return num.length <= 5 ? `Каб. ${num}` : num;
}
