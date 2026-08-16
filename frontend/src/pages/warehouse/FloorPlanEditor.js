import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Save, Square, MousePointer2, Grid3x3, Trash2, Plus, Undo2, PenLine,
  Link2, AlertTriangle, Info, Building2, Layers, DoorOpen, Boxes,
  Type, Pencil, X, Check, ChevronRight, Ruler,
} from 'lucide-react';
import { users as usersApi, warehouseApi } from '../../services/api';
import FloorPlanSvg, {
  polygonArea, polygonBounds, pointInPolygon, GRID_STEP, SHAPE_KINDS,
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
  // Шаг привязки. Раньше был жёстко 0,25 м, и стена на 3,1 м не выставлялась
  // в принципе — такого значения нет в сетке.
  const [step, setStep] = useState(GRID_STEP);
  const [shapeShape, setShapeShape] = useState('rect');
  // Выбранный объект: кабинет, фигура или контур схемы. Контур попал сюда не для
  // симметрии — раньше он правился отдельным режимом-тумблером, о существовании
  // которого нельзя было догадаться, и включить его получалось не из каждого
  // состояния панели. Как обычный выбираемый объект он ведёт себя предсказуемо:
  // выбран — видны вершины, выбран другой — не видны.
  const [selected, setSelected] = useState({ kind: null, id: null });
  const [saving, setSaving] = useState(false);
  const [misRooms, setMisRooms] = useState(null);
  const [modal, setModal] = useState(null);
  const [sideTab, setSideTab] = useState('objects');

  const editOutline = selected.kind === 'outline';
  const selectOutline = () => { setTool({ mode: 'select' }); setSelected({ kind: 'outline', id: null }); };

  const medCenters = tree?.medCenters || [];
  const mc = medCenters.find(m => m.id === selection.mcId);
  const building = mc?.buildings?.find(b => b.id === selection.buildingId);
  const currentDepartments = (departments || []).filter(d => d.medCenterId === selection.mcId);

  // Базовый контекст — сам медцентр. Корпус и этаж не подставляются автоматически:
  // это необязательное усложнение структуры, а не обязательный путь до помещения.
  useEffect(() => {
    if (selection.mcId || !medCenters.length) return;
    setSelection({
      mcId: medCenters[0]?.id || null,
      buildingId: null,
      floorId: null,
    });
  }, [medCenters, selection.mcId]);

  const loadPlan = useCallback(async ({ mcId, buildingId, floorId }) => {
    if (!mcId || (buildingId && !floorId)) { setPlan(null); return; }
    try {
      const { data } = floorId
        ? await warehouseApi.floorPlan(floorId)
        : await warehouseApi.medCenterPlan(mcId);
      setPlan(materializeOutline(data));
      setDirty(false);
      setSnapshot(null);
      setSelected({ kind: null, id: null });
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить план');
    }
  }, []);

  useEffect(() => { loadPlan(selection); }, [selection.mcId, selection.buildingId, selection.floorId, loadPlan]);

  const selectedRoom = useMemo(
    () => (selected.kind === 'room' ? plan?.rooms?.find(r => r.id === selected.id) : null) || null,
    [plan, selected]
  );
  const selectedShape = useMemo(
    () => (selected.kind === 'shape' ? plan?.shapes?.find(s => s.id === selected.id) : null) || null,
    [plan, selected]
  );

  const outlinePoints = plan?.floor?.outline?.points || [];

  /** Прямоугольный ли контур: только тогда его размер имеет смысл задавать числом. */
  const outlineIsRect = useMemo(() => {
    if (outlinePoints.length !== 4) return false;
    const { width, depth } = polygonBounds(outlinePoints);
    const box = width * depth;
    return box > 0 && Math.abs(polygonArea(outlinePoints) - box) / box < 0.02;
  }, [outlinePoints]);

  /**
   * Кабинеты, оказавшиеся снаружи контура. Проверка нужна, потому что контур
   * теперь свободно перекраивается: подрезал крыло — и половина кабинетов
   * формально вне здания. Запрещать такую правку неверно (сначала обводят стены,
   * потом двигают комнаты), поэтому это предупреждение, а не блокировка.
   */
  const roomsOutside = useMemo(() => {
    if (outlinePoints.length < 3) return [];
    return (plan?.rooms || []).filter(r => hasGeometry(r)
      && !r.plan.points.every(p => pointInPolygon(p, outlinePoints)));
  }, [plan, outlinePoints]);

  /**
   * Точный размер прямоугольного контура числом. Угол слева сверху остаётся на
   * месте — так же, как у кабинета: иначе схема уезжала бы от уже расставленных
   * помещений.
   */
  const resizeOutline = (widthM, depthM) => {
    if (!(widthM > 0) || !(depthM > 0)) return;
    pushSnapshot();
    setPlan(prev => {
      const pts = prev.floor.outline?.points || [];
      const x0 = Math.min(...pts.map(p => p[0]));
      const y0 = Math.min(...pts.map(p => p[1]));
      return {
        ...prev,
        floor: {
          ...prev.floor,
          outline: {
            points: [
              [round2(x0), round2(y0)],
              [round2(x0 + widthM), round2(y0)],
              [round2(x0 + widthM), round2(y0 + depthM)],
              [round2(x0), round2(y0 + depthM)],
            ],
          },
        },
      };
    });
    setDirty(true);
  };

  /** Свести контур обратно к прямоугольнику по его же габариту — выход из тупика. */
  const rectifyOutline = () => {
    const { width, depth } = polygonBounds(outlinePoints);
    if (!(width > 0) || !(depth > 0)) return;
    resizeOutline(round2(width), round2(depth));
    toast.success('Контур снова прямоугольный');
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

  /**
   * Добавление и удаление вершины у уже нарисованного объекта.
   *
   * Один обработчик на кабинеты, технические помещения и контур этажа: правка
   * формы у них одна и та же, а три почти одинаковые функции разошлись бы при
   * первой же доработке. Точка вставляется по индексу стороны, поэтому порядок
   * обхода не ломается и многоугольник не выворачивается.
   */
  const editVertex = ({ kind, id, index, point }, remove) => {
    pushSnapshot();
    const change = (points) => {
      const next = points.slice();
      if (remove) {
        if (next.length <= 3) return null;
        next.splice(index, 1);
      } else next.splice(index, 0, point);
      return next;
    };

    if (kind === 'room') {
      mutateRoom(id, room => {
        const points = change(room.plan?.points || []);
        return points ? { ...room, plan: { ...room.plan, points, label: centroid(points) } } : room;
      });
    } else if (kind === 'shape') {
      mutateShape(id, shape => {
        const points = change(shape.geometry?.points || []);
        return points ? { ...shape, geometry: { ...shape.geometry, points, label: centroid(points) } } : shape;
      });
    } else {
      setPlan(prev => {
        const points = change(prev.floor.outline?.points || []);
        return points ? { ...prev, floor: { ...prev.floor, outline: { points } } } : prev;
      });
      setDirty(true);
    }
    if (remove) toast.success('Вершина удалена');
  };

  /**
   * Точный размер прямоугольного помещения числом. Перетаскиванием ровно 3,1 м
   * не выставить даже при мелком шаге: попасть мышью в сантиметр нельзя. Угол
   * слева сверху остаётся на месте — иначе помещение уезжало бы от соседей.
   */
  const resizeRoom = (roomId, widthM, depthM) => {
    if (!(widthM > 0) || !(depthM > 0)) return;
    pushSnapshot();
    mutateRoom(roomId, room => {
      const pts = room.plan?.points || [];
      const x0 = Math.min(...pts.map(p => p[0]));
      const y0 = Math.min(...pts.map(p => p[1]));
      const points = [
        [round2(x0), round2(y0)],
        [round2(x0 + widthM), round2(y0)],
        [round2(x0 + widthM), round2(y0 + depthM)],
        [round2(x0), round2(y0 + depthM)],
      ];
      return { ...room, plan: { ...room.plan, points, label: centroid(points) } };
    });
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
      replaceOutline(points);
      return;
    }
    await createRoomWithGeometry(points);
  };

  /**
   * Новый контур заменяет старый — второй схемы не появляется.
   *
   * Так было и раньше, но выглядело иначе: нарисованная фигура оказывалась внутри
   * прямоугольника холста, который тоже рисовался на плане, и читалось это как
   * «мою схему вписали в чей-то чужой этаж». Прямоугольник холста убран, контур
   * сразу выделяется — видно, что это тот же самый объект, просто другой формы.
   */
  const replaceOutline = (points) => {
    setPlan(prev => ({ ...prev, floor: { ...prev.floor, outline: { points } } }));
    setDirty(true);
    setTool({ mode: 'select' });
    setSelected({ kind: 'outline', id: null });
  };

  /** Многоугольник по точкам: контур схемы или фигура сложной формы. */
  const handlePolygonDone = async (rawPoints) => {
    const points = rawPoints.map(([x, y]) => [round2(x), round2(y)]);
    pushSnapshot();

    if (tool.mode === 'outline') {
      replaceOutline(points);
      toast.success('Контур схемы задан');
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
      title: 'Новое помещение',
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
      // Холст подгоняется под содержимое здесь, а не руками в поле ввода. Раньше
      // это была отдельная забота человека: контур не пускали за границы холста,
      // а холст не давали сузить под контур — из этой пары ограничений и росло
      // ощущение, что схему во что-то впихивают. Теперь размеры листа — просто
      // следствие того, что нарисовано.
      const sheet = normalizeSheet(plan);
      const payload = {
        planWidthM: sheet.planWidthM,
        planHeightM: sheet.planHeightM,
        outline: sheet.outline,
        // Кабинеты уходят все, включая те, у которых геометрию только что убрали:
        // у них plan уже пустой, и сервер должен об этом узнать. Пока сюда шли
        // только кабинеты с геометрией, убранный с плана просто не попадал в
        // запрос — сервер оставлял старые точки, и после сохранения кабинет
        // возвращался на место.
        rooms: sheet.rooms.map(r => ({ id: r.id, plan: r.plan || {} })),
        // Фигуры уходят целиком: их немного, а diff на клиенте потребовал бы
        // отслеживать удаления — лишняя сложность на ровном месте.
        shapes: sheet.shapes.map((s, i) => ({
          kind: s.kind, geometry: s.geometry, label: s.label,
          style: s.style || {}, z: s.z ?? i, isTechnical: s.isTechnical !== false,
        })),
      };
      if (selection.floorId) await warehouseApi.saveFloorPlan(selection.floorId, payload);
      else await warehouseApi.saveMedCenterPlan(selection.mcId, payload);
      setDirty(false);
      setSnapshot(null);
      toast.success('План сохранён');
      await loadPlan(selection);
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
    // Контур удалить нельзя: этаж без границ не нарисовать, а «пустой контур» —
    // это возврат к безымянному прямоугольнику, из которого всё и началось.
    if (editOutline) return;
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

  const removeRoom = async () => {
    if (!selectedRoom) return;
    const label = selectedRoom.name && selectedRoom.name !== selectedRoom.number
      ? `${selectedRoom.number} — ${selectedRoom.name}`
      : selectedRoom.number;
    if (!window.confirm(
      `Удалить кабинет «${label}» из складского учёта?\n\n`
      + 'Он исчезнет с плана и из списка кабинетов. Если к нему привязаны активы, сервер не даст его удалить.'
    )) return;

    try {
      await warehouseApi.deleteRoom(selectedRoom.id);
      setPlan(prev => ({
        ...prev,
        rooms: prev.rooms.filter(r => r.id !== selectedRoom.id),
      }));
      // Снимок может содержать уже удалённый кабинет. Иначе обычная отмена
      // геометрии визуально вернула бы запись, которой на сервере больше нет.
      setSnapshot(prev => prev ? {
        ...prev,
        rooms: prev.rooms.filter(r => r.id !== selectedRoom.id),
      } : prev);
      setSelected({ kind: null, id: null });
      toast.success(`Кабинет ${selectedRoom.number} удалён`);
      await onReloadTree?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось удалить кабинет');
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
        // Проверки «холст не меньше содержимого» здесь больше нет: форма правит
        // только номер и название, а лист координат подгоняется под нарисованное
        // при сохранении плана.
        await warehouseApi.updateFloor(modal.id, form);
        toast.success('Этаж обновлён');
        setModal(null);
        await onReloadTree?.();
        return;
      } else if (modal.type === 'department') {
        await warehouseApi.createDepartment({ medCenterId: selection.mcId, ...form });
        toast.success('Отделение добавлено');
      } else if (modal.type === 'room') {
        const { data } = await warehouseApi.createRoom({
          medCenterId: selection.mcId,
          floorId: selection.floorId || null,
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
                    disabled={!selection.mcId}
                    onClick={() => setModal({ type: 'department', title: 'Новое отделение', form: { name: '', specialtyCode: '', kind: 'specialty', color: '#4a90d9' } })}>
              <Plus size={13} /> Отделение
            </button>
          </div>
        </div>
        <div className="wh-panel__body wh-editor__loc-row">
          <div className="wh-field">
            <label>Медцентр</label>
            <select value={selection.mcId || ''} onChange={e => {
              setSelection({ mcId: e.target.value, buildingId: null, floorId: null });
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
                        setModal({ type: 'floor', title: 'Новый этаж', form: { number: next, name: '' } });
                      }}>
                <Plus size={15} />
              </button>
              {selection.floorId && plan && (
                <>
                  <button className="wh-icon-btn" title="Свойства этажа"
                          onClick={() => setModal({ type: 'floor-edit', id: plan.floor.id, title: 'Этаж', form: { number: plan.floor.number, name: plan.floor.name || '' } })}>
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
              Открыта общая схема медцентра. Корпус и этаж добавляйте только если
              помещения нужно разнести по нескольким схемам.
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
                      onClick={() => setTool({ mode: 'select' })}
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
                      onClick={() => setShowGrid(g => !g)} title="Показать сетку">
                <Grid3x3 size={16} />
              </button>
              {/* Шаг привязки виден и переключается на месте: это не настройка
                  «один раз и забыть», а инструмент — контур этажа ведут крупным
                  шагом, нишу под колонну ловят сантиметром. */}
              <select className="wh-tool-select" value={step} title="Шаг привязки"
                      onChange={e => setStep(Number(e.target.value))}>
                {[0.05, 0.1, 0.25, 0.5, 1].map(s => (
                  <option key={s} value={s}>{String(s).replace('.', ',')} м</option>
                ))}
                <option value={0}>без привязки</option>
              </select>
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

            {/* Форма схемы. Кнопка правки стоит первой и не тумблер: она просто
                выбирает контур, как клик по кабинету выбирает кабинет. Прежний
                тумблер «Вершины/Готово» соседние кнопки обвода включали за
                компанию, поэтому нажатие на него чаще выключало правку, чем
                включало — вершины не появлялись ни при каком порядке действий. */}
            <div className="wh-toolgroup">
              <span className="wh-toolgroup__label">Форма схемы</span>
              <button className={`wh-tool wh-tool--labeled ${editOutline ? 'is-active' : ''}`}
                      onClick={selectOutline}
                      title="Править форму этажа: тянуть вершины, добавлять новые">
                <Boxes size={16} />
                <span>Стены</span>
              </button>
              <button className={`wh-tool ${tool.mode === 'outline' && tool.shape === 'polygon' ? 'is-active' : ''}`}
                      onClick={() => setTool({ mode: 'outline', shape: 'polygon' })}
                      title="Обвести форму заново по точкам — для Г-образных схем">
                <PenLine size={16} />
              </button>
              <button className={`wh-tool ${tool.mode === 'outline' && tool.shape === 'rect' ? 'is-active' : ''}`}
                      onClick={() => setTool({ mode: 'outline', shape: 'rect' })}
                      title="Обвести форму заново прямоугольником">
                <Square size={16} />
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
              <span className="wh-toolgroup__label">
                Технические помещения и оформление
                {/* Коридор почти никогда не прямоугольный. Раньше фигуры
                    рисовались только рамкой, и Г-образный коридор нарисовать
                    было нечем — приходилось класть рядом два прямоугольника. */}
                <span className="wh-toolgroup__mode">
                  {[['rect', 'рамкой', Square], ['polygon', 'по точкам', PenLine]].map(([mode, label, Icon]) => (
                    <button key={mode}
                            className={`wh-tool wh-tool--tiny ${shapeShape === mode ? 'is-active' : ''}`}
                            title={`Рисовать ${label}`}
                            onClick={() => {
                              setShapeShape(mode);
                              if (tool.mode === 'shape') setTool(t => ({ ...t, shape: mode }));
                            }}>
                      <Icon size={13} />
                    </button>
                  ))}
                </span>
              </span>
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
                                onClick={() => setTool({
                                  mode: 'shape', kind,
                                  // Подпись всегда ставится рамкой: многоугольная
                                  // надпись — это не фигура, а недоразумение.
                                  shape: kind === 'text' ? 'rect' : shapeShape,
                                })}>
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
      {plan && tool.mode === 'select' && editOutline && (
        <div className="wh-alert wh-alert--info">
          <Info size={15} />
          <div>
            Выбран контур схемы: тяните белые вершины по углам; <b>+</b> посреди
            стены добавляет новую вершину и сразу берёт её в перетаскивание — так
            из прямоугольника получается «Г». Двойной клик по вершине удаляет её.
            Границ у схемы нет: тяните стену куда нужно, лист координат подстроится
            при сохранении.
          </div>
        </div>
      )}

      {/* ── Полотно и боковая панель ──────────────────────────────────────── */}
      <div className="wh-editor__body">
        <div className="wh-editor__canvas">
          {plan ? (
            <>
              {/* Размер схемы, а не «холста». Это один и тот же прямоугольник,
                  пока форма прямоугольная, — но теперь числа правят сам контур, а
                  не отдельную область вокруг него, в которую контур обязан
                  вписаться. */}
              <div className="wh-editor__dims">
                <label>Схема, м</label>
                {outlineIsRect ? (
                  <>
                    <input type="number" step="0.5" min="1"
                           value={round2(polygonBounds(outlinePoints).width)}
                           onChange={e => resizeOutline(
                             Number(e.target.value), round2(polygonBounds(outlinePoints).depth)
                           )} />
                    <span>×</span>
                    <input type="number" step="0.5" min="1"
                           value={round2(polygonBounds(outlinePoints).depth)}
                           onChange={e => resizeOutline(
                             round2(polygonBounds(outlinePoints).width), Number(e.target.value)
                           )} />
                    <span className="wh-hint">
                      Пока схема прямоугольная, её размер задаётся числом. Нужна
                      другая форма — нажмите <b>Стены</b> и тяните вершины.
                    </span>
                  </>
                ) : (
                  <>
                    <b>
                      {fmt1(polygonBounds(outlinePoints).width)} ×{' '}
                      {fmt1(polygonBounds(outlinePoints).depth)}
                    </b>
                    <button className="wh-btn wh-btn--sm wh-btn--secondary" onClick={rectifyOutline}
                            title="Свести контур обратно к прямоугольнику по его габариту">
                      Сделать прямоугольной
                    </button>
                    <span className="wh-hint">
                      Схема непрямоугольная ({outlinePoints.length} вершин), поэтому
                      показан габарит — описанный прямоугольник. Форма правится
                      вершинами.
                    </span>
                  </>
                )}
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
                  'За пределами схемы. Помещения можно размещать только внутри контура.',
                  { id: 'wh-out-of-bounds' }
                )}
                editOutline={editOutline}
                showGrid={showGrid}
                dimensions={dimensions}
                gridStep={step}
                onVertexAdd={info => editVertex(info, false)}
                onVertexRemove={info => editVertex(info, true)}
                selectedRoomId={selected.kind === 'room' ? selected.id : null}
                selectedShapeId={selected.kind === 'shape' ? selected.id : null}
                colorOf={room => room.department?.color
                  ? { fill: hexToSoft(room.department.color), stroke: room.department.color }
                  : { fill: '#eef1f5', stroke: '#aab4c2' }}
                labelOf={room => (room.name && room.name !== room.number ? room.name : '')}
                onRoomClick={id => setSelected({ kind: 'room', id })}
                onShapeClick={id => setSelected({ kind: 'shape', id })}
                onOutlineClick={selectOutline}
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
                <span>Площадь схемы: <b>{outlineArea.toFixed(1)} м²</b></span>
                <span>Кабинеты: <b>{usableArea.toFixed(1)} м²</b></span>
                <span>Технические: <b>{technicalArea.toFixed(1)} м²</b></span>
                <span className="wh-muted">вершин контура: {outlinePoints.length}</span>
                {roomsOutside.length > 0 && (
                  <button className="wh-warn wh-editor__stats-warn"
                          onClick={() => setSelected({ kind: 'room', id: roomsOutside[0].id })}
                          title="Показать первый такой кабинет">
                    <AlertTriangle size={13} /> вне контура: {roomsOutside.length}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="wh-empty">
              {selection.buildingId
                ? 'Выберите или добавьте этаж либо очистите корпус для общей схемы медцентра'
                : 'Выберите медцентр'}
            </div>
          )}
        </div>

        {plan && <aside className="wh-editor__side">
          <div className="wh-tabs wh-tabs--sub">
            <button className={sideTab === 'objects' ? 'is-active' : ''} onClick={() => setSideTab('objects')}>
              {plan?.floor?.scope === 'medCenter' ? 'Объекты схемы' : 'Объекты этажа'}
            </button>
            <button className={sideTab === 'mis' ? 'is-active' : ''} onClick={() => setSideTab('mis')}>
              Сопоставление с МИС
              {roomsWithoutMis.length > 0 && <span className="wh-count">{roomsWithoutMis.length}</span>}
            </button>
          </div>

          {sideTab === 'objects' && (
            <>
              {/* Контур — первая строка списка объектов, а не спрятанный режим.
                  Пока его там не было, единственным способом узнать о его
                  существовании была кнопка на панели с иконкой без подписи. */}
              <div className={`wh-panel wh-panel--outline ${editOutline ? 'is-active' : ''}`}>
                <div className="wh-panel__head" onClick={selectOutline} style={{ cursor: 'pointer' }}>
                  <div className="wh-panel__title"><Boxes size={15} /> Контур схемы</div>
                  <div className="wh-panel__actions">
                    <span className="wh-objlist__meta">
                      {fmt1(polygonBounds(outlinePoints).width)} × {fmt1(polygonBounds(outlinePoints).depth)} м
                    </span>
                  </div>
                </div>
                {editOutline && (
                  <div className="wh-panel__body">
                    <div className="wh-metrics">
                      <div className="wh-metrics__row">
                        <span>Площадь</span><b>{outlineArea.toFixed(1)} м²</b>
                      </div>
                      <div className="wh-metrics__row">
                        <span>Вершин</span><b>{outlinePoints.length}</b>
                      </div>
                    </div>
                    <p className="wh-hint">
                      Тяните белые вершины на плане. <b>+</b> посреди стены добавляет
                      новую вершину — из прямоугольника так получается «Г», «П» или
                      срезанный угол. Двойной клик по вершине убирает её; меньше трёх
                      не останется.
                    </p>
                    {!outlineIsRect && (
                      <button className="wh-btn wh-btn--secondary wh-btn--wide" onClick={rectifyOutline}>
                        Вернуть прямоугольник
                      </button>
                    )}
                    {roomsOutside.length > 0 && (
                      <div className="wh-alert wh-alert--warning">
                        Вне контура оказалось кабинетов: {roomsOutside.length}
                        {' '}({roomsOutside.slice(0, 5).map(r => r.number).join(', ')}
                        {roomsOutside.length > 5 ? '…' : ''}). Сохранить это можно, но
                        на тепловой карте они будут стоять за стеной здания.
                      </div>
                    )}
                  </div>
                )}
              </div>

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
                              onDelete={removeRoom}
                              onResize={(w, d) => resizeRoom(selectedRoom.id, w, d)}
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
        </aside>}
      </div>

      {modal && (
        <LocationModal modal={modal} departments={currentDepartments}
                       onClose={() => setModal(null)} onSubmit={submitModal} />
      )}
    </div>
  );
}

// ── Подсказки по инструментам ────────────────────────────────────────────────
function toolHint(tool, selectedRoom) {
  if (tool.mode === 'outline') {
    const common = 'Новая форма заменит текущую, второй схемы не появится. '
      + 'Кабинеты останутся на своих местах.';
    return tool.shape === 'polygon'
      ? 'Кликайте по углам схемы. Двойной клик или клик по первой точке замыкает контур, '
        + `Backspace убирает последнюю точку, Escape отменяет. Так обводят Г-образные крылья и срезанные углы. ${common}`
      : `Протяните прямоугольник — он станет формой схемы. ${common}`;
  }
  if (tool.mode === 'shape') {
    const info = SHAPE_KINDS[tool.kind];
    const inside = info?.technical !== false
      ? ' Размещается только внутри контура этажа.'
      : ' Оформление можно ставить и по границе этажа.';
    const how = tool.shape === 'polygon'
      ? `Кликайте по углам, двойной клик замыкает — так рисуется Г-образный коридор. Появится «${info?.label}».`
      : `Протяните рамку — появится «${info?.label}».`;
    return `${how} Это помещение не участвует в учёте: `
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
function RoomForm({ room, departments, onSave, onClearGeometry, onDelete, onResize, hasGeometry: geo }) {
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
      {geo && <Metrics points={room.plan.points} onResize={onResize} />}

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
        <button className="wh-btn wh-btn--danger-ghost" onClick={onDelete}
                title="Удалить ошибочно созданный кабинет из складского учёта">
          <X size={14} /> Удалить кабинет
        </button>
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
function Metrics({ points, onResize }) {
  const { width, depth } = polygonBounds(points);
  const area = polygonArea(points);
  const box = width * depth;
  // Отклонение больше пары процентов — это уже не погрешность обвода, а форма.
  const isRect = points.length === 4 && box > 0 && Math.abs(area - box) / box < 0.02;

  return (
    <div className="wh-metrics">
      {isRect && onResize ? (
        // Прямоугольник задаётся числами: попасть мышью ровно в 3,1 м нельзя ни
        // при каком шаге привязки, а размер помещения обычно известен точно.
        <div className="wh-metrics__row">
          <span>Размер</span>
          <span className="wh-metrics__size">
            <input type="number" step="0.1" min="0.5" value={width}
                   onChange={e => onResize(Number(e.target.value), depth)} />
            <em>×</em>
            <input type="number" step="0.1" min="0.5" value={depth}
                   onChange={e => onResize(width, Number(e.target.value))} />
            <span>м</span>
          </span>
        </div>
      ) : (
        <div className="wh-metrics__row">
          <span>Габарит</span>
          <b>{fmt1(width)} × {fmt1(depth)} м</b>
        </div>
      )}
      <div className="wh-metrics__row">
        <span>Площадь</span>
        <b>{fmt1(area)} м²</b>
      </div>
      {!isRect && (
        <div className="wh-hint">
          Помещение непрямоугольное, поэтому размер числом не задаётся: габарит —
          это описанный прямоугольник, площадь меньше него. Длины стен подписаны на
          плане, форма правится вершинами.
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
    // Габариты листа из формы этажа убраны: они считаются по нарисованной схеме
    // при сохранении плана. Пока их спрашивали здесь, человек задавал размер
    // здания до того, как увидел здание, — и потом упирался в него как в стену.
    floor: [
      ['number', 'Номер этажа', 'number', true],
      ['name', 'Название', 'text'],
    ],
    'floor-edit': [
      ['number', 'Номер этажа', 'number', true],
      ['name', 'Название', 'text'],
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
                Форма и размер этажа задаются на самом плане: новый этаж открывается
                прямоугольником, дальше его правят вершинами — до «Г», «П» или любой
                другой формы.
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

/**
 * Контур схемы существует всегда, даже у только что заведённого этажа.
 *
 * Раньше пустой контур означал «этаж прямоугольный», и прямоугольник рисовался
 * подложкой по габаритам холста. Выглядело это как готовая схема, но вершин у
 * неё не было — править было буквально нечего, и первое, что делал человек
 * («потяну угол»), не работало ни при каком выбранном инструменте. Развернув
 * подложку в четыре настоящие вершины сразу при загрузке, мы убираем это
 * состояние вовсе: то, что видно на плане, всегда можно взять и потянуть.
 *
 * Планы, сохранённые до ver. 6.69, приходят с пустым outline и разворачиваются
 * здесь же — отдельной миграции для этого не нужно.
 */
function materializeOutline(data) {
  const pts = data?.floor?.outline?.points;
  if (Array.isArray(pts) && pts.length >= 3) return data;
  const w = Number(data?.floor?.planWidthM) || 40;
  const h = Number(data?.floor?.planHeightM) || 25;
  return {
    ...data,
    floor: { ...data.floor, outline: { points: [[0, 0], [w, 0], [w, h], [0, h]] } },
  };
}

/**
 * Лист координат под нарисованное — перед отправкой на сервер.
 *
 * planWidthM/planHeightM остались в базе (по ним привязывается скан БТИ), но
 * перестали быть областью, в которую всё обязано вмещаться. Здесь они просто
 * пересчитываются по фактическому содержимому.
 *
 * Сдвиг делается только если что-то ушло в отрицательные координаты — так бывает,
 * когда стену тянут влево или вверх за начало отсчёта. Двигаются при этом все
 * объекты сразу, поэтому взаимное расположение не меняется. Без нужды координаты
 * не трогаем: по ним заказывают мебель и сверяются со сканом.
 */
function normalizeSheet(plan) {
  const outline = plan.floor.outline?.points || [];
  const all = [
    ...outline,
    ...(plan.rooms || []).filter(hasGeometry).flatMap(r => r.plan.points),
    ...(plan.shapes || []).flatMap(s => s.geometry?.points || []),
  ];
  if (!all.length) {
    return {
      planWidthM: Number(plan.floor.planWidthM) || 40,
      planHeightM: Number(plan.floor.planHeightM) || 25,
      outline: {},
      rooms: plan.rooms || [],
      shapes: plan.shapes || [],
    };
  }

  const xs = all.map(p => p[0]);
  const ys = all.map(p => p[1]);
  const dx = Math.min(...xs) < 0 ? round2(-Math.min(...xs)) : 0;
  const dy = Math.min(...ys) < 0 ? round2(-Math.min(...ys)) : 0;
  const move = pts => (dx || dy ? pts.map(([x, y]) => [round2(x + dx), round2(y + dy)]) : pts);

  return {
    planWidthM: Math.max(4, round2(Math.max(...xs) + dx)),
    planHeightM: Math.max(4, round2(Math.max(...ys) + dy)),
    outline: outline.length >= 3 ? { points: move(outline) } : {},
    rooms: (plan.rooms || []).map(r => (hasGeometry(r)
      ? { ...r, plan: { ...r.plan, points: move(r.plan.points), label: centroid(move(r.plan.points)) } }
      : r)),
    shapes: (plan.shapes || []).map(s => (s.geometry?.points?.length
      ? {
          ...s,
          geometry: {
            ...s.geometry,
            points: move(s.geometry.points),
            label: centroid(move(s.geometry.points)),
          },
        }
      : s)),
  };
}

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
