import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Save, Square, MousePointer2, Grid3x3, Trash2, Plus, Undo2, PenLine,
  Link2, AlertTriangle, Info, Building2, Layers, DoorOpen, Boxes,
  Type, Pencil, X, Check, ChevronRight, Ruler,
} from 'lucide-react';
import { users as usersApi, warehouseApi } from '../../services/api';
import FloorPlanSvg, {
  polygonArea, polygonBounds, GRID_STEP, SHAPE_KINDS,
} from '../../components/warehouse/FloorPlanSvg';

/**
 * Редактор поэтажного плана и справочник локаций.
 *
 * Зачем он нужен: поэтажных планов филиалов в системе нет, а тепловая карта без
 * геометрии не существует. Обводить кабинеты по скану БТИ — единственный
 * реалистичный путь.
 *
 * Что здесь важно знать заранее:
 *
 *   • Три сущности на плане, и они разные по природе. **Контур этажа** — стены
 *     здания, произвольный многоугольник (Г-образные крылья и срезанные углы
 *     прямоугольником не описать). **Кабинеты** — единицы учёта, у них есть МОЛ,
 *     активы и остатки. **Технические помещения** (коридор, лестница, санузел) —
 *     фигуры: они занимают место на плане, но инвентаря в них нет, и заводить под
 *     коридор кабинет с материально ответственным лицом было бы искажением учёта.
 *
 *   • Правки геометрии копятся локально и уходят одним PUT: план — цельный
 *     документ, и сохранять каждое перетаскивание вершины значило бы держать
 *     сервер в режиме непрерывной записи и получать битые промежуточные состояния.
 *
 *   • Свойства кабинета (номер, отделение, МОЛ) правятся отдельным запросом, а не
 *     вместе с геометрией: иначе неверный клик в редакторе мог бы обнулить
 *     материально ответственное лицо.
 */

const ROOM_KINDS = [
  { value: 'office', label: 'Кабинет' },
  { value: 'operating', label: 'Операционная' },
  { value: 'dressing', label: 'Перевязочная' },
  { value: 'procedure', label: 'Процедурный' },
  { value: 'lab', label: 'Лабораторная' },
  { value: 'storage', label: 'Склад' },
  { value: 'reception', label: 'Ресепшн' },
  { value: 'tech', label: 'Техническое' },
];

// Виды фигур, разложенные по смыслу: сначала помещения, потом оформление.
const SHAPE_GROUPS = [
  {
    title: 'Технические помещения',
    hint: 'Занимают место на плане, но не участвуют в учёте',
    kinds: ['corridor', 'hall', 'reception_area', 'stairs', 'elevator', 'wc', 'server', 'utility', 'wardrobe'],
  },
  {
    title: 'Оформление',
    hint: 'Только вид плана: стены, проёмы, подписи',
    kinds: ['wall', 'door', 'window', 'area', 'text'],
  },
];

const EMPTY_SELECTION = { mcId: null, buildingId: null, floorId: null };

export default function FloorPlanEditor({ tree, departments, onReloadTree }) {
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [plan, setPlan] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [tool, setTool] = useState({ mode: 'select' });
  const [showGrid, setShowGrid] = useState(true);
  const [dimensions, setDimensions] = useState('selected');
  const [selected, setSelected] = useState({ kind: null, id: null });
  const [saving, setSaving] = useState(false);
  const [misRooms, setMisRooms] = useState(null);
  const [editOutline, setEditOutline] = useState(false);
  const [modal, setModal] = useState(null);
  const [sideTab, setSideTab] = useState('objects');

  const medCenters = tree?.medCenters || [];
  const mc = medCenters.find(m => m.id === selection.mcId);
  const building = mc?.buildings?.find(b => b.id === selection.buildingId);

  // Первый медцентр с корпусами — сразу, иначе редактор открывается пустым и
  // выглядит неработающим.
  useEffect(() => {
    if (selection.floorId || !medCenters.length) return;
    const firstMc = medCenters.find(m => m.buildings?.length) || medCenters[0];
    const firstBuilding = firstMc?.buildings?.[0];
    setSelection({
      mcId: firstMc?.id || null,
      buildingId: firstBuilding?.id || null,
      floorId: firstBuilding?.floors?.[0]?.id || null,
    });
  }, [medCenters, selection.floorId]);

  const loadPlan = useCallback(async (floorId) => {
    if (!floorId) { setPlan(null); return; }
    try {
      const { data } = await warehouseApi.floorPlan(floorId);
      setPlan(data);
      setDirty(false);
      setSnapshot(null);
      setSelected({ kind: null, id: null });
      setEditOutline(false);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить план');
    }
  }, []);

  useEffect(() => { loadPlan(selection.floorId); }, [selection.floorId, loadPlan]);

  const selectedRoom = useMemo(
    () => (selected.kind === 'room' ? plan?.rooms?.find(r => r.id === selected.id) : null) || null,
    [plan, selected]
  );
  const selectedShape = useMemo(
    () => (selected.kind === 'shape' ? plan?.shapes?.find(s => s.id === selected.id) : null) || null,
    [plan, selected]
  );

  /**
   * Габариты уже нарисованного: кабинеты, технические помещения и контур. Нужны,
   * чтобы не дать сделать холст меньше содержимого.
   */
  const contentExtent = () => {
    const all = [];
    for (const r of plan?.rooms || []) if (hasGeometry(r)) all.push(...r.plan.points);
    for (const sh of plan?.shapes || []) all.push(...(sh.geometry?.points || []));
    if (plan?.floor?.outline?.points?.length >= 3) all.push(...plan.floor.outline.points);
    if (!all.length) return { w: 4, h: 4 };
    return {
      w: Math.max(...all.map(p => p[0])),
      h: Math.max(...all.map(p => p[1])),
    };
  };

  const setCanvas = (key, raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    const need = contentExtent();
    const min = key === 'planWidthM' ? need.w : need.h;
    if (value < min) {
      toast.error(
        `Меньше нельзя: содержимое доходит до ${min.toFixed(1)} м. Сначала переместите кабинеты.`,
        { id: 'wh-canvas-min' }
      );
      return;
    }
    pushSnapshot();
    setPlan(prev => ({ ...prev, floor: { ...prev.floor, [key]: value } }));
    setDirty(true);
  };

  const pushSnapshot = () => {
    if (!plan || snapshot) return;
    setSnapshot(JSON.parse(JSON.stringify({ rooms: plan.rooms, shapes: plan.shapes, floor: plan.floor })));
  };

  // ── Геометрия ──────────────────────────────────────────────────────────────
  const mutateRoom = (roomId, updater) => {
    setPlan(prev => ({ ...prev, rooms: prev.rooms.map(r => (r.id === roomId ? updater(r) : r)) }));
    setDirty(true);
  };
  const mutateShape = (shapeId, updater) => {
    setPlan(prev => ({ ...prev, shapes: prev.shapes.map(s => (s.id === shapeId ? updater(s) : s)) }));
    setDirty(true);
  };

  const handleVertexDrag = (roomId, index, point) => {
    pushSnapshot();
    mutateRoom(roomId, room => {
      const points = (room.plan?.points || []).slice();
      points[index] = point;
      return { ...room, plan: { ...room.plan, points, label: centroid(points) } };
    });
  };

  const handleRoomMove = (roomId, dx, dy) => {
    pushSnapshot();
    mutateRoom(roomId, room => {
      const points = (room.plan?.points || []).map(([x, y]) => [round2(x + dx), round2(y + dy)]);
      return { ...room, plan: { ...room.plan, points, label: centroid(points) } };
    });
  };

  const handleShapeVertexDrag = (shapeId, index, point) => {
    pushSnapshot();
    mutateShape(shapeId, shape => {
      const points = (shape.geometry?.points || []).slice();
      points[index] = point;
      return { ...shape, geometry: { ...shape.geometry, points, label: centroid(points) } };
    });
  };

  const handleShapeMove = (shapeId, dx, dy) => {
    pushSnapshot();
    mutateShape(shapeId, shape => {
      const points = (shape.geometry?.points || []).map(([x, y]) => [round2(x + dx), round2(y + dy)]);
      return { ...shape, geometry: { ...shape.geometry, points, label: centroid(points) } };
    });
  };

  const handleOutlineVertexDrag = (index, point) => {
    pushSnapshot();
    setPlan(prev => {
      const points = (prev.floor.outline?.points || []).slice();
      points[index] = point;
      return { ...prev, floor: { ...prev.floor, outline: { points } } };
    });
    setDirty(true);
  };

  /** Прямоугольник: кабинет или фигура — зависит от активного инструмента. */
  const handleDraw = async ({ x, y, w, h }) => {
    const points = [
      [round2(x), round2(y)],
      [round2(x + w), round2(y)],
      [round2(x + w), round2(y + h)],
      [round2(x), round2(y + h)],
    ];
    pushSnapshot();

    if (tool.mode === 'shape') {
      addShape(tool.kind, points);
      return;
    }
    if (tool.mode === 'outline') {
      setPlan(prev => ({ ...prev, floor: { ...prev.floor, outline: { points } } }));
      setDirty(true);
      setTool({ mode: 'select' });
      setEditOutline(true);
      return;
    }
    await createRoomWithGeometry(points);
  };

  /** Многоугольник по точкам: контур этажа или фигура сложной формы. */
  const handlePolygonDone = async (rawPoints) => {
    const points = rawPoints.map(([x, y]) => [round2(x), round2(y)]);
    pushSnapshot();

    if (tool.mode === 'outline') {
      setPlan(prev => ({ ...prev, floor: { ...prev.floor, outline: { points } } }));
      setDirty(true);
      setTool({ mode: 'select' });
      setEditOutline(true);
      toast.success('Контур этажа задан');
      return;
    }
    if (tool.mode === 'shape') {
      addShape(tool.kind, points);
      return;
    }
    await createRoomWithGeometry(points);
  };

  const addShape = (kind, points) => {
    const info = SHAPE_KINDS[kind] || {};
    // Фигуры живут только в локальном состоянии до сохранения плана: у них нет
    // собственного API, PUT плана заменяет их целиком.
    const tmpId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setPlan(prev => ({
      ...prev,
      shapes: [...(prev.shapes || []), {
        id: tmpId,
        kind,
        geometry: { points, label: centroid(points) },
        label: info.label || '',
        style: {},
        z: (prev.shapes?.length || 0) + 1,
        isTechnical: info.technical !== false,
      }],
    }));
    setDirty(true);
    setSelected({ kind: 'shape', id: tmpId });
    setSideTab('objects');
    setTool({ mode: 'select' });
  };

  const createRoomWithGeometry = async (points) => {
    // Если выбран кабинет без геометрии — обводим его, иначе создаём новый.
    if (selectedRoom && !hasGeometry(selectedRoom)) {
      mutateRoom(selectedRoom.id, room => ({ ...room, plan: { points, label: centroid(points) } }));
      setTool({ mode: 'select' });
      return;
    }
    setModal({
      type: 'room',
      title: 'Новый кабинет',
      pendingGeometry: { points, label: centroid(points) },
      form: { number: '', name: '', kind: 'office', departmentId: '', capacityHours: 8 },
    });
    setTool({ mode: 'select' });
  };

  // ── Сохранение ─────────────────────────────────────────────────────────────
  const save = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      await warehouseApi.saveFloorPlan(selection.floorId, {
        planWidthM: plan.floor.planWidthM,
        planHeightM: plan.floor.planHeightM,
        outline: plan.floor.outline || {},
        rooms: plan.rooms.filter(hasGeometry).map(r => ({ id: r.id, plan: r.plan })),
        // Фигуры уходят целиком: их немного, а diff на клиенте потребовал бы
        // отслеживать удаления — лишняя сложность на ровном месте.
        shapes: (plan.shapes || []).map((s, i) => ({
          kind: s.kind, geometry: s.geometry, label: s.label,
          style: s.style || {}, z: s.z ?? i, isTechnical: s.isTechnical !== false,
        })),
      });
      setDirty(false);
      setSnapshot(null);
      toast.success('План сохранён');
      await loadPlan(selection.floorId);
      onReloadTree?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить план');
    } finally {
      setSaving(false);
    }
  };

  const undo = () => {
    if (!snapshot) return;
    setPlan(prev => ({ ...prev, ...snapshot }));
    setSnapshot(null);
  };

  const deleteSelected = () => {
    if (selectedShape) {
      pushSnapshot();
      setPlan(prev => ({ ...prev, shapes: prev.shapes.filter(s => s.id !== selectedShape.id) }));
      setSelected({ kind: null, id: null });
      setDirty(true);
      return;
    }
    if (selectedRoom) {
      pushSnapshot();
      mutateRoom(selectedRoom.id, room => ({ ...room, plan: {} }));
    }
  };

  const saveRoomProps = async (patch) => {
    if (!selectedRoom) return;
    try {
      const { data } = await warehouseApi.updateRoom(selectedRoom.id, patch);
      setPlan(prev => ({
        ...prev,
        rooms: prev.rooms.map(r => (r.id === data.id
          ? {
              ...r, ...patch,
              misRoomAliases: data.misRoomAliases || r.misRoomAliases,
              department: patch.departmentId !== undefined
                ? (departments || []).find(d => d.id === patch.departmentId) || null
                : r.department,
            }
          : r)),
      }));
      toast.success('Кабинет обновлён');
      onReloadTree?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить');
    }
  };

  const loadMisSuggestions = async () => {
    if (!selection.mcId) return;
    try {
      const { data } = await warehouseApi.misSuggestions({ medCenterId: selection.mcId });
      setMisRooms(data.rooms || []);
      if (data.note) toast(data.note, { icon: 'ℹ️' });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось получить список из МИС');
    }
  };

  // ── Создание локаций ───────────────────────────────────────────────────────
  const submitModal = async (form) => {
    try {
      if (modal.type === 'building') {
        await warehouseApi.createBuilding({ medCenterId: selection.mcId, ...form });
        toast.success('Корпус добавлен');
      } else if (modal.type === 'building-edit') {
        await warehouseApi.updateBuilding(modal.id, form);
        toast.success('Корпус обновлён');
      } else if (modal.type === 'floor') {
        const { data } = await warehouseApi.createFloor({ buildingId: selection.buildingId, ...form });
        toast.success('Этаж добавлен');
        await onReloadTree?.();
        setSelection(s => ({ ...s, floorId: data.id }));
        setModal(null);
        return;
      } else if (modal.type === 'floor-edit') {
        // Уменьшать холст ниже уже нарисованного нельзя: кабинеты и контур
        // оказались бы снаружи, а правило «только внутри этажа» стало бы
        // невыполнимым. Границу считаем по фактическому содержимому.
        const need = contentExtent();
        if (form.planWidthM < need.w || form.planHeightM < need.h) {
          toast.error(
            `Холст меньше нарисованного: содержимое занимает ${need.w.toFixed(1)} × ${need.h.toFixed(1)} м. `
            + 'Сначала переместите кабинеты и контур.'
          );
          return;
        }
        await warehouseApi.updateFloor(modal.id, form);
        toast.success('Этаж обновлён');
        setModal(null);
        await onReloadTree?.();
        // Перечитываем именно план: в нём живут габариты холста, и без этого
        // на экране остались бы старые.
        await loadPlan(selection.floorId);
        return;
      } else if (modal.type === 'department') {
        await warehouseApi.createDepartment({ medCenterId: selection.mcId, ...form });
        toast.success('Отделение добавлено');
      } else if (modal.type === 'room') {
        const { data } = await warehouseApi.createRoom({
          floorId: selection.floorId,
          ...form,
          plan: modal.pendingGeometry,
        });
        setPlan(prev => ({
          ...prev,
          rooms: [...prev.rooms, {
            id: data.id, number: data.number, name: data.name, kind: data.kind,
            departmentId: data.departmentId,
            department: (departments || []).find(d => d.id === data.departmentId) || null,
            responsible: null, capacityHours: Number(data.capacityHours),
            misRoomAliases: data.misRoomAliases || [], plan: data.plan,
          }],
        }));
        setSelected({ kind: 'room', id: data.id });
        toast.success(`Кабинет ${data.number} создан`);
        setModal(null);
        onReloadTree?.();
        return;
      }
      setModal(null);
      await onReloadTree?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить');
    }
  };

  const removeFloor = async (floorId) => {
    if (!window.confirm('Удалить этаж? Он должен быть без активных кабинетов.')) return;
    try {
      await warehouseApi.deleteFloor(floorId);
      toast.success('Этаж удалён');
      setSelection(s => ({ ...s, floorId: null }));
      await onReloadTree?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось удалить этаж');
    }
  };

  const removeBuilding = async (buildingId) => {
    if (!window.confirm('Отключить корпус? Он скроется из списков, история сохранится.')) return;
    try {
      await warehouseApi.deleteBuilding(buildingId);
      toast.success('Корпус отключён');
      setSelection(s => ({ ...s, buildingId: null, floorId: null }));
      await onReloadTree?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось отключить корпус');
    }
  };

  const roomsWithoutPlan = (plan?.rooms || []).filter(r => !hasGeometry(r));
  const roomsWithoutMis = (plan?.rooms || []).filter(r => !(r.misRoomAliases || []).length);
  const technicalShapes = (plan?.shapes || []).filter(s => s.isTechnical !== false);
  const decorShapes = (plan?.shapes || []).filter(s => s.isTechnical === false);

  const usableArea = (plan?.rooms || []).filter(hasGeometry)
    .reduce((s, r) => s + polygonArea(r.plan.points), 0);
  const technicalArea = technicalShapes
    .reduce((s, x) => s + polygonArea(x.geometry?.points || []), 0);
  const outlineArea = plan?.floor?.outline?.points?.length >= 3
    ? polygonArea(plan.floor.outline.points)
    : (Number(plan?.floor?.planWidthM) || 0) * (Number(plan?.floor?.planHeightM) || 0);

  return (
    <div className="wh-editor">
      {/* ── Панель выбора локации ──────────────────────────────────────────── */}
      <div className="wh-panel wh-editor__locations">
        <div className="wh-panel__head">
          <div className="wh-panel__title"><Building2 size={16} /> Локация</div>
          <div className="wh-panel__actions">
            <button className="wh-btn wh-btn--sm wh-btn--secondary"
                    onClick={() => setModal({ type: 'department', title: 'Новое отделение', form: { name: '', specialtyCode: '', kind: 'specialty', color: '#4a90d9' } })}>
              <Plus size={13} /> Отделение
            </button>
          </div>
        </div>
        <div className="wh-panel__body wh-editor__loc-row">
          <div className="wh-field">
            <label>Медцентр</label>
            <select value={selection.mcId || ''} onChange={e => {
              const nextMc = medCenters.find(m => m.id === e.target.value);
              const b = nextMc?.buildings?.[0];
              setSelection({ mcId: e.target.value, buildingId: b?.id || null, floorId: b?.floors?.[0]?.id || null });
            }}>
              <option value="">—</option>
              {medCenters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          <div className="wh-field">
            <label>Корпус</label>
            <div className="wh-field__row">
              <select value={selection.buildingId || ''} onChange={e => {
                const b = mc?.buildings?.find(x => x.id === e.target.value);
                setSelection(s => ({ ...s, buildingId: e.target.value, floorId: b?.floors?.[0]?.id || null }));
              }}>
                <option value="">—</option>
                {(mc?.buildings || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button className="wh-icon-btn" title="Добавить корпус" disabled={!selection.mcId}
                      onClick={() => setModal({ type: 'building', title: 'Новый корпус', form: { name: '', code: '', address: '' } })}>
                <Plus size={15} />
              </button>
              {building && (
                <>
                  <button className="wh-icon-btn" title="Переименовать корпус"
                          onClick={() => setModal({ type: 'building-edit', id: building.id, title: 'Корпус', form: { name: building.name, code: building.code || '', address: building.address || '' } })}>
                    <Pencil size={14} />
                  </button>
                  <button className="wh-icon-btn wh-icon-btn--danger" title="Отключить корпус"
                          onClick={() => removeBuilding(building.id)}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="wh-field">
            <label>Этаж</label>
            <div className="wh-field__row">
              <select value={selection.floorId || ''}
                      onChange={e => setSelection(s => ({ ...s, floorId: e.target.value }))}>
                <option value="">—</option>
                {(building?.floors || []).map(f => (
                  <option key={f.id} value={f.id}>{f.name || `${f.number} этаж`}</option>
                ))}
              </select>
              <button className="wh-icon-btn" title="Добавить этаж" disabled={!selection.buildingId}
                      onClick={() => {
                        const next = Math.max(0, ...(building?.floors || []).map(f => f.number)) + 1;
                        setModal({ type: 'floor', title: 'Новый этаж', form: { number: next, name: '', planWidthM: 40, planHeightM: 25 } });
                      }}>
                <Plus size={15} />
              </button>
              {plan && (
                <>
                  <button className="wh-icon-btn" title="Свойства этажа"
                          onClick={() => setModal({ type: 'floor-edit', id: plan.floor.id, title: 'Этаж', form: { number: plan.floor.number, name: plan.floor.name || '', planWidthM: plan.floor.planWidthM, planHeightM: plan.floor.planHeightM } })}>
                    <Pencil size={14} />
                  </button>
                  <button className="wh-icon-btn wh-icon-btn--danger" title="Удалить этаж"
                          onClick={() => removeFloor(plan.floor.id)}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          </div>

          {!selection.buildingId && selection.mcId && (
            <div className="wh-alert wh-alert--info wh-editor__loc-alert">
              В этом медцентре ещё нет корпусов. Добавьте корпус, затем этаж — после
              этого можно обводить план.
            </div>
          )}
        </div>
      </div>

      {/* ── Инструменты ───────────────────────────────────────────────────── */}
      {plan && (
        <div className="wh-panel wh-editor__toolbar">
          <div className="wh-panel__body wh-editor__tools">
            <div className="wh-toolgroup">
              <span className="wh-toolgroup__label">Правка</span>
              <button className={`wh-tool ${tool.mode === 'select' ? 'is-active' : ''}`}
                      onClick={() => { setTool({ mode: 'select' }); setEditOutline(false); }}
                      title="Выбор и перемещение">
                <MousePointer2 size={16} />
              </button>
              <button className="wh-tool" onClick={undo} disabled={!snapshot} title="Отменить">
                <Undo2 size={16} />
              </button>
              <button className="wh-tool" onClick={deleteSelected}
                      disabled={!selectedShape && !selectedRoom}
                      title={selectedShape ? 'Удалить фигуру' : 'Убрать кабинет с плана'}>
                <Trash2 size={16} />
              </button>
              <button className={`wh-tool ${showGrid ? 'is-active' : ''}`}
                      onClick={() => setShowGrid(g => !g)} title={`Сетка ${GRID_STEP} м`}>
                <Grid3x3 size={16} />
              </button>
              {/* Три состояния, а не галочка: размеры всех помещений сразу нужны
                  при обмере этажа, размеры одного — при правке, и ни то ни другое
                  не годится постоянно. */}
              <button className={`wh-tool ${dimensions !== 'none' ? 'is-active' : ''}`}
                      onClick={() => setDimensions(d => (
                        d === 'selected' ? 'all' : d === 'all' ? 'none' : 'selected'
                      ))}
                      title={{
                        none: 'Размеры выключены — включить у выбранного',
                        selected: 'Размеры выбранного — показать у всех',
                        all: 'Размеры всех помещений — выключить',
                      }[dimensions]}>
                <Ruler size={16} />
                {dimensions === 'all' && <span className="wh-tool__badge">все</span>}
              </button>
            </div>

            <div className="wh-toolgroup">
              <span className="wh-toolgroup__label">Контур этажа</span>
              <button className={`wh-tool ${tool.mode === 'outline' && tool.shape === 'polygon' ? 'is-active' : ''}`}
                      onClick={() => { setTool({ mode: 'outline', shape: 'polygon' }); setEditOutline(true); }}
                      title="Обвести контур по точкам — для Г-образных этажей">
                <PenLine size={16} />
              </button>
              <button className={`wh-tool ${tool.mode === 'outline' && tool.shape === 'rect' ? 'is-active' : ''}`}
                      onClick={() => { setTool({ mode: 'outline', shape: 'rect' }); setEditOutline(true); }}
                      title="Прямоугольный контур">
                <Square size={16} />
              </button>
              <button className={`wh-tool ${editOutline ? 'is-active' : ''}`}
                      onClick={() => setEditOutline(v => !v)}
                      title="Показать ручки контура">
                <Boxes size={16} />
              </button>
            </div>

            <div className="wh-toolgroup">
              <span className="wh-toolgroup__label">Кабинет</span>
              <button className={`wh-tool ${tool.mode === 'room' && tool.shape === 'rect' ? 'is-active' : ''}`}
                      onClick={() => setTool({ mode: 'room', shape: 'rect' })}
                      title="Кабинет прямоугольником">
                <Square size={16} />
              </button>
              <button className={`wh-tool ${tool.mode === 'room' && tool.shape === 'polygon' ? 'is-active' : ''}`}
                      onClick={() => setTool({ mode: 'room', shape: 'polygon' })}
                      title="Кабинет сложной формы по точкам">
                <PenLine size={16} />
              </button>
            </div>

            <div className="wh-toolgroup wh-toolgroup--wide">
              <span className="wh-toolgroup__label">Технические помещения и оформление</span>
              <div className="wh-shape-palette">
                {SHAPE_GROUPS.map(group => (
                  <div key={group.title} className="wh-shape-palette__group" title={group.hint}>
                    {group.kinds.map(kind => {
                      const info = SHAPE_KINDS[kind];
                      const active = tool.mode === 'shape' && tool.kind === kind;
                      return (
                        <button key={kind}
                                className={`wh-shape-btn ${active ? 'is-active' : ''}`}
                                title={`${info.label} — протяните рамку по плану`}
                                onClick={() => setTool({ mode: 'shape', kind, shape: kind === 'text' ? 'rect' : 'rect' })}>
                          <span className="wh-shape-btn__swatch"
                                style={{ background: info.fill === 'transparent' ? '#fff' : info.fill, borderColor: info.stroke === 'transparent' ? '#cbd5e1' : info.stroke }}>
                            {kind === 'text' ? <Type size={11} /> : null}
                          </span>
                          {info.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <button className="wh-btn wh-btn--primary wh-editor__save"
                    onClick={save} disabled={!dirty || saving}>
              <Save size={15} /> {saving ? 'Сохраняю…' : dirty ? 'Сохранить план' : 'Сохранено'}
            </button>
          </div>
        </div>
      )}

      {/* Подсказка по активному инструменту: без неё непонятно, что делать дальше */}
      {plan && tool.mode !== 'select' && (
        <div className="wh-alert wh-alert--info">
          <Info size={15} />
          <div>{toolHint(tool, selectedRoom)}</div>
        </div>
      )}

      {/* ── Полотно и боковая панель ──────────────────────────────────────── */}
      <div className="wh-editor__body">
        <div className="wh-editor__canvas">
          {plan ? (
            <>
              <div className="wh-editor__dims">
                <label>Холст, м</label>
                <input type="number" step="0.5" min="4" value={plan.floor.planWidthM}
                       onChange={e => setCanvas('planWidthM', e.target.value)} />
                <span>×</span>
                <input type="number" step="0.5" min="4" value={plan.floor.planHeightM}
                       onChange={e => setCanvas('planHeightM', e.target.value)} />
                <span className="wh-hint">
                  Лист координат: кабинеты рисуются внутри него. Меняется сразу,
                  сохраняется кнопкой «Сохранить план».
                </span>
              </div>
              <FloorPlanSvg
                floor={plan.floor}
                rooms={plan.rooms.filter(hasGeometry)}
                shapes={plan.shapes || []}
                mode="edit"
                drawing={tool.mode === 'select' ? false : (tool.shape === 'polygon' ? 'polygon' : 'rect')}
                // Кабинет и техническое помещение обязаны лежать внутри этажа:
                // кабинет за стеной здания не существует. Контур самого этажа и
                // оформление (стены, подписи) под это правило не попадают.
                constrainDrawing={
                  tool.mode === 'room'
                  || (tool.mode === 'shape' && SHAPE_KINDS[tool.kind]?.technical !== false)
                }
                onOutOfBounds={() => toast.error(
                  'За пределами этажа. Кабинеты и технические помещения можно размещать только внутри контура.',
                  { id: 'wh-out-of-bounds' }
                )}
                editOutline={editOutline}
                showGrid={showGrid}
                dimensions={dimensions}
                selectedRoomId={selected.kind === 'room' ? selected.id : null}
                selectedShapeId={selected.kind === 'shape' ? selected.id : null}
                colorOf={room => room.department?.color
                  ? { fill: hexToSoft(room.department.color), stroke: room.department.color }
                  : { fill: '#eef1f5', stroke: '#aab4c2' }}
                labelOf={room => (room.name && room.name !== room.number ? room.name : '')}
                onRoomClick={id => setSelected({ kind: 'room', id })}
                onShapeClick={id => setSelected({ kind: 'shape', id })}
                onVertexDrag={handleVertexDrag}
                onRoomMove={handleRoomMove}
                onShapeVertexDrag={handleShapeVertexDrag}
                onShapeMove={handleShapeMove}
                onOutlineVertexDrag={handleOutlineVertexDrag}
                onCanvasDraw={handleDraw}
                onPolygonDone={handlePolygonDone}
                height={620}
              />

              <div className="wh-editor__stats">
                <span>Габарит холста: <b>{plan.floor.planWidthM} × {plan.floor.planHeightM} м</b></span>
                <span>Площадь этажа: <b>{outlineArea.toFixed(1)} м²</b></span>
                <span>Кабинеты: <b>{usableArea.toFixed(1)} м²</b></span>
                <span>Технические: <b>{technicalArea.toFixed(1)} м²</b></span>
                {plan.floor.outline?.points?.length >= 3
                  ? <span className="wh-ok">контур задан ({plan.floor.outline.points.length} вершин)</span>
                  : <span className="wh-muted">контур прямоугольный</span>}
              </div>
            </>
          ) : (
            <div className="wh-empty">
              {selection.buildingId
                ? 'Выберите или добавьте этаж'
                : 'Выберите медцентр и корпус'}
            </div>
          )}
        </div>

        <aside className="wh-editor__side">
          <div className="wh-tabs wh-tabs--sub">
            <button className={sideTab === 'objects' ? 'is-active' : ''} onClick={() => setSideTab('objects')}>
              Объекты этажа
            </button>
            <button className={sideTab === 'mis' ? 'is-active' : ''} onClick={() => setSideTab('mis')}>
              Сопоставление с МИС
              {roomsWithoutMis.length > 0 && <span className="wh-count">{roomsWithoutMis.length}</span>}
            </button>
          </div>

          {sideTab === 'objects' && (
            <>
              {roomsWithoutPlan.length > 0 && (
                <div className="wh-panel wh-panel--warn">
                  <div className="wh-panel__head">
                    <div className="wh-panel__title"><AlertTriangle size={15} /> Не обведены: {roomsWithoutPlan.length}</div>
                  </div>
                  <div className="wh-panel__body">
                    <div className="wh-chiplist">
                      {roomsWithoutPlan.map(r => (
                        <button key={r.id}
                                className={`wh-chip ${selected.id === r.id ? 'is-active' : ''}`}
                                onClick={() => { setSelected({ kind: 'room', id: r.id }); setTool({ mode: 'room', shape: 'rect' }); }}>
                          {r.number}
                        </button>
                      ))}
                    </div>
                    <p className="wh-hint">
                      Выберите кабинет и протяните рамку — он появится на плане и в тепловой карте.
                    </p>
                  </div>
                </div>
              )}

              <div className="wh-panel">
                <div className="wh-panel__head">
                  <div className="wh-panel__title"><DoorOpen size={15} /> Кабинеты ({plan?.rooms?.length || 0})</div>
                </div>
                <ul className="wh-objlist">
                  {(plan?.rooms || []).map(r => (
                    <li key={r.id}
                        className={`wh-objlist__item ${selected.kind === 'room' && selected.id === r.id ? 'is-active' : ''}`}
                        onClick={() => setSelected({ kind: 'room', id: r.id })}>
                      <span className="wh-objlist__dot" style={{ background: r.department?.color || '#cbd5e1' }} />
                      <span className="wh-objlist__num">{r.number}</span>
                      <span className="wh-objlist__name">{r.name && r.name !== r.number ? r.name : ''}</span>
                      {hasGeometry(r)
                        ? <span className="wh-objlist__meta">{polygonArea(r.plan.points).toFixed(1)} м²</span>
                        : <span className="wh-objlist__meta wh-warn">нет плана</span>}
                      <ChevronRight size={13} />
                    </li>
                  ))}
                  {!(plan?.rooms || []).length && <li className="wh-empty">Кабинетов нет</li>}
                </ul>
              </div>

              <div className="wh-panel">
                <div className="wh-panel__head">
                  <div className="wh-panel__title"><Layers size={15} /> Технические помещения ({technicalShapes.length})</div>
                </div>
                <ul className="wh-objlist">
                  {technicalShapes.map(s => (
                    <li key={s.id}
                        className={`wh-objlist__item ${selected.kind === 'shape' && selected.id === s.id ? 'is-active' : ''}`}
                        onClick={() => setSelected({ kind: 'shape', id: s.id })}>
                      <span className="wh-objlist__dot"
                            style={{ background: SHAPE_KINDS[s.kind]?.fill, borderColor: SHAPE_KINDS[s.kind]?.stroke }} />
                      <span className="wh-objlist__name">{s.label || SHAPE_KINDS[s.kind]?.label || s.kind}</span>
                      <span className="wh-objlist__meta">{polygonArea(s.geometry?.points || []).toFixed(1)} м²</span>
                      <ChevronRight size={13} />
                    </li>
                  ))}
                  {!technicalShapes.length && (
                    <li className="wh-empty">
                      Коридоров и лестниц нет. Выберите вид в палитре сверху и протяните рамку по плану.
                    </li>
                  )}
                </ul>
                {decorShapes.length > 0 && (
                  <ul className="wh-objlist wh-objlist--muted">
                    {decorShapes.map(s => (
                      <li key={s.id}
                          className={`wh-objlist__item ${selected.kind === 'shape' && selected.id === s.id ? 'is-active' : ''}`}
                          onClick={() => setSelected({ kind: 'shape', id: s.id })}>
                        <span className="wh-objlist__name">{s.label || SHAPE_KINDS[s.kind]?.label}</span>
                        <span className="wh-objlist__meta">оформление</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selectedShape && (
                <div className="wh-panel">
                  <div className="wh-panel__head">
                    <div className="wh-panel__title">{SHAPE_KINDS[selectedShape.kind]?.label || 'Фигура'}</div>
                  </div>
                  <div className="wh-panel__body">
                    <ShapeForm shape={selectedShape}
                               onChange={patch => { pushSnapshot(); mutateShape(selectedShape.id, s => ({ ...s, ...patch })); }}
                               onDelete={deleteSelected} />
                  </div>
                </div>
              )}

              {selectedRoom && (
                <div className="wh-panel">
                  <div className="wh-panel__head">
                    <div className="wh-panel__title">Каб. {selectedRoom.number}</div>
                  </div>
                  <div className="wh-panel__body">
                    <RoomForm room={selectedRoom}
                              departments={departments}
                              onSave={saveRoomProps}
                              onClearGeometry={deleteSelected}
                              hasGeometry={hasGeometry(selectedRoom)} />
                  </div>
                </div>
              )}
            </>
          )}

          {sideTab === 'mis' && (
            <div className="wh-panel">
              <div className="wh-panel__head">
                <div className="wh-panel__title"><Link2 size={15} /> Названия кабинетов в МИС</div>
              </div>
              <div className="wh-panel__body">
                <p className="wh-hint">
                  Загрузка кабинета считается по расписанию из МИС, а кабинет там записан
                  свободной строкой — «415 Лаборатория», «Рентген», «Линия Кабинет 23».
                  Без сопоставления тепловая карта по кабинету пуста.
                  {roomsWithoutMis.length > 0 && ` Не сопоставлено: ${roomsWithoutMis.length}.`}
                </p>
                <button className="wh-btn wh-btn--secondary wh-btn--wide" onClick={loadMisSuggestions}>
                  Показать названия из МИС
                </button>

                {selectedRoom
                  ? <div className="wh-alert wh-alert--info">
                      Выбран кабинет <b>{selectedRoom.number}</b> — клик по названию привяжет его.
                    </div>
                  : <div className="wh-alert wh-alert--warning">Сначала выберите кабинет в списке.</div>}

                {misRooms && (
                  <div className="wh-mislist">
                    {misRooms.slice(0, 60).map(m => (
                      <button key={m.room}
                              className={`wh-mislist__item ${m.matched ? 'is-matched' : ''}`}
                              disabled={!selectedRoom}
                              onClick={() => saveRoomProps({
                                misRoomAliases: [...new Set([...(selectedRoom.misRoomAliases || []), m.room])],
                              })}>
                        <span>{m.room}</span>
                        <small>{m.appointments} приёмов{m.matched ? ' · сопоставлен' : ''}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {modal && (
        <LocationModal modal={modal} departments={departments}
                       onClose={() => setModal(null)} onSubmit={submitModal} />
      )}
    </div>
  );
}

// ── Подсказки по инструментам ────────────────────────────────────────────────
function toolHint(tool, selectedRoom) {
  if (tool.mode === 'outline') {
    return tool.shape === 'polygon'
      ? 'Кликайте по углам этажа. Двойной клик или клик по первой точке замыкает контур, Backspace убирает последнюю точку, Escape отменяет. Так обводят Г-образные крылья и срезанные углы.'
      : 'Протяните прямоугольник — он станет контуром этажа.';
  }
  if (tool.mode === 'shape') {
    const info = SHAPE_KINDS[tool.kind];
    const inside = info?.technical !== false
      ? ' Размещается только внутри контура этажа.'
      : ' Оформление можно ставить и по границе этажа.';
    return `Протяните рамку — появится «${info?.label}». Это помещение не участвует в учёте: `
      + `активы и остатки к нему не привязываются.${inside}`;
  }
  if (tool.mode === 'room') {
    if (selectedRoom && !hasGeometry(selectedRoom)) {
      return `Рамка достанется выбранному кабинету ${selectedRoom.number}.`;
    }
    return tool.shape === 'polygon'
      ? 'Кликайте по углам кабинета, двойной клик замыкает. Точки за пределами этажа не принимаются. '
        + 'После замыкания спросим номер и отделение.'
      : 'Протяните рамку внутри контура этажа — спросим номер и отделение нового кабинета. '
        + 'Красная рамка означает, что кабинет вышел за пределы этажа.';
  }
  return '';
}

// ── Форма фигуры ─────────────────────────────────────────────────────────────
function ShapeForm({ shape, onChange, onDelete }) {
  const [label, setLabel] = useState(shape.label || '');
  useEffect(() => { setLabel(shape.label || ''); }, [shape.id, shape.label]);

  return (
    <div className="wh-form">
      <label>Вид
        <select value={shape.kind} onChange={e => {
          const info = SHAPE_KINDS[e.target.value];
          onChange({ kind: e.target.value, isTechnical: info?.technical !== false });
        }}>
          {SHAPE_GROUPS.map(g => (
            <optgroup key={g.title} label={g.title}>
              {g.kinds.map(k => <option key={k} value={k}>{SHAPE_KINDS[k].label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label>Подпись на плане
        <input value={label}
               placeholder={SHAPE_KINDS[shape.kind]?.label || ''}
               onChange={e => setLabel(e.target.value)}
               onBlur={() => onChange({ label })} />
      </label>
      <p className="wh-hint">
        Площадь: {polygonArea(shape.geometry?.points || []).toFixed(1)} м², вершин:{' '}
        {shape.geometry?.points?.length || 0}. Перетаскивайте фигуру целиком или её
        вершины прямо на плане.
      </p>
      <button className="wh-btn wh-btn--danger-ghost" onClick={onDelete}>
        <Trash2 size={14} /> Удалить фигуру
      </button>
    </div>
  );
}

// ── Форма кабинета ───────────────────────────────────────────────────────────
function RoomForm({ room, departments, onSave, onClearGeometry, hasGeometry: geo }) {
  const [form, setForm] = useState(() => pickRoomForm(room));
  useEffect(() => { setForm(pickRoomForm(room)); }, [room.id, room.number, room.name, room.kind, room.departmentId, room.capacityHours]);

  return (
    <div className="wh-form">
      <div className="wh-form__row2">
        <label>Номер
          <input value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} />
        </label>
        <label>Ёмкость, ч
          <input type="number" step="0.5" min="0" max="24" value={form.capacityHours}
                 onChange={e => setForm(f => ({ ...f, capacityHours: Number(e.target.value) }))} />
        </label>
      </div>
      <label>Название
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      </label>
      <div className="wh-form__row2">
        <label>Тип
          <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
            {ROOM_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label>Отделение
          <select value={form.departmentId} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))}>
            <option value="">—</option>
            {(departments || []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>
      {geo && <Metrics points={room.plan.points} />}

      <p className="wh-hint">
        Ёмкость — знаменатель загрузки. Если кабинет показывает больше 100 %, значит
        он работает дольше заявленного, и это поле занижено.
      </p>

      {(room.misRoomAliases || []).length > 0 && (
        <div className="wh-aliases">
          <span>В МИС:</span>
          {room.misRoomAliases.map(a => (
            <button key={a} className="wh-chip wh-chip--removable" title="Убрать сопоставление"
                    onClick={() => onSave({ misRoomAliases: room.misRoomAliases.filter(x => x !== a) })}>
              {a} ×
            </button>
          ))}
        </div>
      )}

      <div className="wh-form__actions">
        <button className="wh-btn wh-btn--primary" onClick={() => onSave(form)}>
          <Save size={14} /> Сохранить
        </button>
        {geo && (
          <button className="wh-btn wh-btn--danger-ghost" onClick={onClearGeometry}
                  title="Убрать кабинет с плана, не удаляя его">
            <Trash2 size={14} /> Убрать с плана
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Обмер помещения в боковой панели.
 *
 * Габарит и площадь — разные величины, и у Г-образной комнаты они расходятся:
 * прямоугольник 6 × 4 даёт 24 м² габарита при, скажем, 19 м² настоящей площади.
 * Поэтому подписаны они словами, а не «6 × 4 = 24»: последнее было бы неправдой,
 * а на плане по этим цифрам заказывают мебель.
 */
function Metrics({ points }) {
  const { width, depth } = polygonBounds(points);
  const area = polygonArea(points);
  const box = width * depth;
  // Отклонение больше пары процентов — это уже не погрешность обвода, а форма.
  const isRect = points.length === 4 && box > 0 && Math.abs(area - box) / box < 0.02;

  return (
    <div className="wh-metrics">
      <div className="wh-metrics__row">
        <span>{isRect ? 'Размер' : 'Габарит'}</span>
        <b>{fmt1(width)} × {fmt1(depth)} м</b>
      </div>
      <div className="wh-metrics__row">
        <span>Площадь</span>
        <b>{fmt1(area)} м²</b>
      </div>
      {!isRect && (
        <div className="wh-hint">
          Помещение непрямоугольное: габарит — это описанный прямоугольник, площадь
          меньше него. Длины стен подписаны на самом плане.
        </div>
      )}
    </div>
  );
}

const fmt1 = n => String(Math.round(Number(n) * 10) / 10).replace('.', ',');

function pickRoomForm(room) {
  return {
    number: room.number, name: room.name || '', kind: room.kind,
    departmentId: room.departmentId || '', capacityHours: room.capacityHours,
  };
}

// ── Модальные формы локаций ──────────────────────────────────────────────────
function LocationModal({ modal, departments, onClose, onSubmit }) {
  const [form, setForm] = useState(modal.form);
  const [specialties, setSpecialties] = useState([]);
  const [users, setUsers] = useState([]);

  // Код специальности — внешний ключ на справочник, а не свободный текст. Раньше
  // здесь было поле ввода с подсказкой «ХИРУРГ, ТЕРАП, ЛАБОР…», и любая опечатка
  // возвращалась нарушением внешнего ключа: отделение не создавалось, а почему —
  // из сообщения не следовало.
  useEffect(() => {
    if (modal.type !== 'department') return;
    warehouseApi.specialties().then(({ data }) => setSpecialties(data)).catch(() => {});
    usersApi.listBasic().then(({ data }) => setUsers(data)).catch(() => {});
  }, [modal.type]);

  const fields = {
    building: [
      ['name', 'Название корпуса', 'text', true],
      ['code', 'Код (A, B…)', 'text'],
      ['address', 'Адрес', 'text'],
    ],
    'building-edit': [
      ['name', 'Название корпуса', 'text', true],
      ['code', 'Код', 'text'],
      ['address', 'Адрес', 'text'],
    ],
    floor: [
      ['number', 'Номер этажа', 'number', true],
      ['name', 'Название', 'text'],
      ['planWidthM', 'Ширина холста, м', 'number'],
      ['planHeightM', 'Глубина холста, м', 'number'],
    ],
    'floor-edit': [
      ['number', 'Номер этажа', 'number', true],
      ['name', 'Название', 'text'],
      ['planWidthM', 'Ширина холста, м', 'number'],
      ['planHeightM', 'Глубина холста, м', 'number'],
    ],
    department: [
      ['name', 'Название отделения', 'text', true],
      ['color', 'Цвет на плане', 'color'],
    ],
    room: [
      ['number', 'Номер кабинета', 'text', true],
      ['name', 'Название', 'text'],
    ],
  }[modal.type] || [];

  const valid = fields.filter(f => f[3]).every(f => String(form[f[0]] ?? '').trim() !== '');

  return (
    <div className="wh-modal" onClick={onClose}>
      <div className="wh-modal__box wh-modal__box--narrow" onClick={e => e.stopPropagation()}>
        <div className="wh-modal__head">
          <div className="wh-modal__title">{modal.title}</div>
          <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="wh-modal__body">
          <div className="wh-form">
            {fields.map(([key, label, type]) => (
              <label key={key}>{label}
                <input type={type} value={form[key] ?? ''}
                       onChange={e => setForm(f => ({
                         ...f,
                         [key]: type === 'number' ? Number(e.target.value) : e.target.value,
                       }))} />
              </label>
            ))}

            {modal.type === 'department' && (
              <>
                <label>Специальность (код для инвентарных номеров)
                  <select value={form.specialtyCode || ''}
                          onChange={e => setForm(f => ({ ...f, specialtyCode: e.target.value }))}>
                    <option value="">— без специальности —</option>
                    {specialties.map(s => (
                      <option key={s.code} value={s.code}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </label>
                <label>Заведующий отделением
                  <select value={form.headUserId || ''}
                          onChange={e => setForm(f => ({ ...f, headUserId: e.target.value }))}>
                    <option value="">— не назначен —</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.displayName || u.username}</option>
                    ))}
                  </select>
                </label>
                <p className="wh-hint">
                  Заведующий не просто подпись: из этого поля выводится роль «зав. отделением»
                  со всеми её правами. Отдельно её выдавать не нужно, и снимать тоже —
                  она уходит вместе со сменой заведующего.
                </p>
              </>
            )}

            {modal.type === 'room' && (
              <>
                <div className="wh-form__row2">
                  <label>Тип
                    <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
                      {ROOM_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                  </label>
                  <label>Ёмкость, ч
                    <input type="number" step="0.5" value={form.capacityHours}
                           onChange={e => setForm(f => ({ ...f, capacityHours: Number(e.target.value) }))} />
                  </label>
                </div>
                <label>Отделение
                  <select value={form.departmentId} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))}>
                    <option value="">—</option>
                    {(departments || []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </label>
                <p className="wh-hint">
                  Код специальности отделения попадёт в инвентарные номера активов
                  этого кабинета и изменению потом не подлежит.
                </p>
              </>
            )}

            {(modal.type === 'floor' || modal.type === 'floor-edit') && (
              <p className="wh-hint">
                Холст — система координат плана в метрах. Контур этажа рисуется внутри
                него и может быть любой формы; габариты просто должны его вмещать.
              </p>
            )}
          </div>
        </div>
        <div className="wh-modal__foot">
          <button className="wh-btn wh-btn--secondary" onClick={onClose}>Отмена</button>
          <button className="wh-btn wh-btn--primary" disabled={!valid} onClick={() => onSubmit(form)}>
            <Check size={15} /> Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Утилиты ──────────────────────────────────────────────────────────────────
const round2 = n => Math.round(n * 100) / 100;
const hasGeometry = r => Array.isArray(r?.plan?.points) && r.plan.points.length >= 3;

function centroid(points) {
  const sx = points.reduce((s, p) => s + p[0], 0);
  const sy = points.reduce((s, p) => s + p[1], 0);
  return { x: round2(sx / points.length), y: round2(sy / points.length) };
}

/** Цвет отделения в мягкую заливку: на плане нужен фон, а не насыщенная метка. */
function hexToSoft(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return '#eef1f5';
  const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16));
  return `rgba(${r}, ${g}, ${b}, 0.18)`;
}
