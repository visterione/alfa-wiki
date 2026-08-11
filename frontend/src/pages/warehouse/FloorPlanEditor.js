import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Save, Square, MousePointer2, Grid3x3, Trash2, Plus, Undo2,
  Link2, AlertTriangle, Info, ChevronRight,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';
import FloorPlanSvg, { polygonArea, GRID_STEP } from '../../components/warehouse/FloorPlanSvg';

/**
 * Редактор поэтажного плана.
 *
 * Зачем он вообще нужен: поэтажных планов филиалов в системе нет, а тепловая карта
 * без геометрии не существует. Обводить кабинеты по скану БТИ — единственный
 * реалистичный путь: заставить кого-то рисовать SVG в стороннем редакторе и
 * вручную сводить координаты с номерами кабинетов не получится.
 *
 * Решения, которые стоит знать заранее:
 *
 *   • правки копятся локально и уходят одним PUT: план — цельный документ, и
 *     сохранять каждое перетаскивание вершины значило бы держать сервер в режиме
 *     непрерывной записи и получать битые промежуточные состояния;
 *   • отмена — один шаг назад по снапшотам. Полноценный undo-стек здесь избыточен:
 *     основная ошибка при обводке — «потянул не туда», и она исправляется сразу;
 *   • геометрия и свойства кабинета правятся раздельно. Редактор плана пишет
 *     только поле plan, а номер, отделение и МОЛ — форма справа. Иначе неверный
 *     клик в редакторе мог бы обнулить материально ответственное лицо.
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

export default function FloorPlanEditor({ tree, departments, onReloadTree }) {
  const [selection, setSelection] = useState({ mcId: null, buildingId: null, floorId: null });
  const [plan, setPlan] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [tool, setTool] = useState('select');
  const [showGrid, setShowGrid] = useState(true);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [misRooms, setMisRooms] = useState(null);

  const medCenters = tree?.medCenters || [];
  const mc = medCenters.find(m => m.id === selection.mcId);
  const building = mc?.buildings?.find(b => b.id === selection.buildingId);

  // Первый медцентр с корпусами — сразу, иначе редактор открывается пустым и
  // выглядит неработающим.
  useEffect(() => {
    if (selection.floorId || !medCenters.length) return;
    const firstMc = medCenters.find(m => m.buildings?.length);
    const firstBuilding = firstMc?.buildings?.[0];
    const firstFloor = firstBuilding?.floors?.[0];
    if (firstFloor) {
      setSelection({ mcId: firstMc.id, buildingId: firstBuilding.id, floorId: firstFloor.id });
    }
  }, [medCenters, selection.floorId]);

  const loadPlan = useCallback(async (floorId) => {
    if (!floorId) return;
    try {
      const { data } = await warehouseApi.floorPlan(floorId);
      setPlan(data);
      setDirty(false);
      setSnapshot(null);
      setSelectedRoomId(null);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить план');
    }
  }, []);

  useEffect(() => { loadPlan(selection.floorId); }, [selection.floorId, loadPlan]);

  const selectedRoom = useMemo(
    () => plan?.rooms?.find(r => r.id === selectedRoomId) || null,
    [plan, selectedRoomId]
  );

  const pushSnapshot = () => {
    if (!plan) return;
    setSnapshot(JSON.parse(JSON.stringify({ rooms: plan.rooms, floor: plan.floor })));
  };

  const mutateRoom = (roomId, updater) => {
    setPlan(prev => ({
      ...prev,
      rooms: prev.rooms.map(r => (r.id === roomId ? updater(r) : r)),
    }));
    setDirty(true);
  };

  const handleVertexDrag = (roomId, index, point) => {
    mutateRoom(roomId, room => {
      const points = (room.plan?.points || []).slice();
      points[index] = point;
      return { ...room, plan: { ...room.plan, points, label: centroid(points) } };
    });
  };

  const handleRoomMove = (roomId, dx, dy) => {
    mutateRoom(roomId, room => {
      const points = (room.plan?.points || []).map(([x, y]) => [round2(x + dx), round2(y + dy)]);
      return { ...room, plan: { ...room.plan, points, label: centroid(points) } };
    });
  };

  /**
   * Нарисованный прямоугольник. Если кабинет выбран и у него ещё нет геометрии —
   * назначаем ему; иначе создаём новый кабинет на сервере, потому что без записи
   * в БД у него нет id, а без id его нельзя ни сохранить, ни привязать к активам.
   */
  const handleDraw = async ({ x, y, w, h }) => {
    const points = [
      [round2(x), round2(y)],
      [round2(x + w), round2(y)],
      [round2(x + w), round2(y + h)],
      [round2(x), round2(y + h)],
    ];
    pushSnapshot();

    const target = selectedRoom && !hasGeometry(selectedRoom) ? selectedRoom : null;
    if (target) {
      mutateRoom(target.id, room => ({ ...room, plan: { points, label: centroid(points) } }));
      setTool('select');
      return;
    }

    const number = window.prompt('Номер нового кабинета:');
    if (!number?.trim()) return;
    try {
      const { data } = await warehouseApi.createRoom({
        floorId: selection.floorId,
        number: number.trim(),
        plan: { points, label: centroid(points) },
      });
      setPlan(prev => ({
        ...prev,
        rooms: [...prev.rooms, {
          id: data.id, number: data.number, name: data.name, kind: data.kind,
          departmentId: data.departmentId, department: null, responsible: null,
          capacityHours: Number(data.capacityHours), misRoomAliases: data.misRoomAliases || [],
          plan: data.plan,
        }],
      }));
      setSelectedRoomId(data.id);
      setTool('select');
      onReloadTree?.();
      toast.success(`Кабинет ${data.number} создан`);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось создать кабинет');
    }
  };

  const save = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      await warehouseApi.saveFloorPlan(selection.floorId, {
        planWidthM: plan.floor.planWidthM,
        planHeightM: plan.floor.planHeightM,
        rooms: plan.rooms
          .filter(hasGeometry)
          .map(r => ({ id: r.id, plan: r.plan })),
        shapes: plan.shapes,
      });
      setDirty(false);
      setSnapshot(null);
      toast.success('План сохранён');
      onReloadTree?.();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось сохранить план');
    } finally {
      setSaving(false);
    }
  };

  const undo = () => {
    if (!snapshot) return;
    setPlan(prev => ({ ...prev, rooms: snapshot.rooms, floor: snapshot.floor }));
    setSnapshot(null);
  };

  const clearGeometry = () => {
    if (!selectedRoom) return;
    pushSnapshot();
    mutateRoom(selectedRoom.id, room => ({ ...room, plan: {} }));
  };

  const saveRoomProps = async (patch) => {
    if (!selectedRoom) return;
    try {
      const { data } = await warehouseApi.updateRoom(selectedRoom.id, patch);
      setPlan(prev => ({
        ...prev,
        rooms: prev.rooms.map(r => (r.id === data.id
          ? { ...r, ...patch, misRoomAliases: data.misRoomAliases || r.misRoomAliases }
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

  const roomsWithoutPlan = (plan?.rooms || []).filter(r => !hasGeometry(r));
  const roomsWithoutMis = (plan?.rooms || []).filter(r => !(r.misRoomAliases || []).length);

  return (
    <div className="wh-editor">
      <div className="wh-editor__bar">
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
          <select value={selection.buildingId || ''} onChange={e => {
            const b = mc?.buildings?.find(x => x.id === e.target.value);
            setSelection(s => ({ ...s, buildingId: e.target.value, floorId: b?.floors?.[0]?.id || null }));
          }}>
            <option value="">—</option>
            {(mc?.buildings || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="wh-field">
          <label>Этаж</label>
          <select value={selection.floorId || ''}
                  onChange={e => setSelection(s => ({ ...s, floorId: e.target.value }))}>
            <option value="">—</option>
            {(building?.floors || []).map(f => (
              <option key={f.id} value={f.id}>{f.name || `${f.number} этаж`}</option>
            ))}
          </select>
        </div>

        <div className="wh-editor__tools">
          <button className={`wh-tool ${tool === 'select' ? 'is-active' : ''}`}
                  onClick={() => setTool('select')} title="Выбор и перемещение">
            <MousePointer2 size={16} />
          </button>
          <button className={`wh-tool ${tool === 'draw' ? 'is-active' : ''}`}
                  onClick={() => setTool('draw')} title="Нарисовать кабинет">
            <Square size={16} />
          </button>
          <button className={`wh-tool ${showGrid ? 'is-active' : ''}`}
                  onClick={() => setShowGrid(g => !g)} title={`Сетка ${GRID_STEP} м`}>
            <Grid3x3 size={16} />
          </button>
          <button className="wh-tool" onClick={undo} disabled={!snapshot} title="Отменить последнее действие">
            <Undo2 size={16} />
          </button>
        </div>

        <button className="wh-btn wh-btn--primary" onClick={save} disabled={!dirty || saving}>
          <Save size={15} /> {saving ? 'Сохраняю…' : dirty ? 'Сохранить план' : 'Сохранено'}
        </button>
      </div>

      {tool === 'draw' && (
        <div className="wh-note wh-note--subtle">
          <Info size={15} />
          <div>
            Протяните прямоугольник по плану. Если слева выбран кабинет без геометрии —
            рамка достанется ему, иначе будет создан новый кабинет. Привязка к сетке {GRID_STEP} м.
          </div>
        </div>
      )}

      <div className="wh-editor__body">
        <div className="wh-editor__canvas">
          {plan ? (
            <>
              <div className="wh-editor__dims">
                <label>Габариты этажа, м</label>
                <input type="number" step="0.5" min="5" value={plan.floor.planWidthM}
                       onChange={e => { setPlan(p => ({ ...p, floor: { ...p.floor, planWidthM: Number(e.target.value) } })); setDirty(true); }} />
                <span>×</span>
                <input type="number" step="0.5" min="5" value={plan.floor.planHeightM}
                       onChange={e => { setPlan(p => ({ ...p, floor: { ...p.floor, planHeightM: Number(e.target.value) } })); setDirty(true); }} />
              </div>
              <FloorPlanSvg
                floor={plan.floor}
                rooms={plan.rooms.filter(hasGeometry)}
                shapes={plan.shapes}
                mode="edit"
                drawing={tool === 'draw'}
                showGrid={showGrid}
                selectedRoomId={selectedRoomId}
                colorOf={room => room.department?.color
                  ? { fill: hexToSoft(room.department.color), stroke: room.department.color }
                  : { fill: '#eef1f5', stroke: '#aab4c2' }}
                // У кабинетов без номера в МИС («Рентген», «КТ») номер и название
                // совпадают, и подпись дублировалась в две строки.
                labelOf={room => (room.name && room.name !== room.number ? room.name : '')}
                onRoomClick={setSelectedRoomId}
                onVertexDrag={(...args) => { if (!snapshot) pushSnapshot(); handleVertexDrag(...args); }}
                onRoomMove={(...args) => { if (!snapshot) pushSnapshot(); handleRoomMove(...args); }}
                onCanvasDraw={handleDraw}
                height={620}
              />
            </>
          ) : (
            <div className="wh-empty">Выберите этаж</div>
          )}
        </div>

        <aside className="wh-editor__side">
          {/* Кабинеты без геометрии — главная причина «пустого» плана, поэтому
              список висит сверху, а не спрятан в подсказке. */}
          {roomsWithoutPlan.length > 0 && (
            <div className="wh-editor__block">
              <h4><AlertTriangle size={14} /> Не обведены на плане: {roomsWithoutPlan.length}</h4>
              <div className="wh-chiplist">
                {roomsWithoutPlan.map(r => (
                  <button key={r.id}
                          className={`wh-chip ${selectedRoomId === r.id ? 'is-active' : ''}`}
                          onClick={() => { setSelectedRoomId(r.id); setTool('draw'); }}>
                    {r.number}
                  </button>
                ))}
              </div>
              <p className="wh-hint">
                Выберите кабинет и протяните рамку — он появится на плане и в тепловой карте.
              </p>
            </div>
          )}

          <div className="wh-editor__block">
            <h4>Кабинеты этажа ({plan?.rooms?.length || 0})</h4>
            <ul className="wh-roomlist">
              {(plan?.rooms || []).map(r => (
                <li key={r.id}
                    className={`wh-roomlist__item ${selectedRoomId === r.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedRoomId(r.id)}>
                  <span className="wh-roomlist__num">{r.number}</span>
                  <span className="wh-roomlist__name">{r.name && r.name !== r.number ? r.name : ''}</span>
                  {r.department && (
                    <span className="wh-roomlist__dept" style={{ background: r.department.color || '#94a3b8' }} />
                  )}
                  {hasGeometry(r) && (
                    <span className="wh-roomlist__area">{polygonArea(r.plan.points).toFixed(1)} м²</span>
                  )}
                  <ChevronRight size={13} />
                </li>
              ))}
            </ul>
          </div>

          {selectedRoom && (
            <div className="wh-editor__block">
              <h4>Каб. {selectedRoom.number}</h4>
              <RoomForm room={selectedRoom}
                        departments={departments}
                        onSave={saveRoomProps}
                        onClearGeometry={clearGeometry}
                        hasGeometry={hasGeometry(selectedRoom)} />
            </div>
          )}

          <div className="wh-editor__block">
            <h4><Link2 size={14} /> Сопоставление с МИС</h4>
            <p className="wh-hint">
              Загрузка кабинета считается по расписанию из МИС, а кабинет там записан
              свободной строкой. Без сопоставления тепловая карта по кабинету пуста.
              {roomsWithoutMis.length > 0 && ` Не сопоставлено: ${roomsWithoutMis.length}.`}
            </p>
            <button className="wh-btn wh-btn--ghost wh-btn--wide" onClick={loadMisSuggestions}>
              Показать названия из МИС
            </button>
            {misRooms && (
              <div className="wh-mislist">
                {misRooms.slice(0, 40).map(m => (
                  <button key={m.room}
                          className={`wh-mislist__item ${m.matched ? 'is-matched' : ''}`}
                          disabled={!selectedRoom}
                          title={selectedRoom
                            ? `Добавить «${m.room}» кабинету ${selectedRoom.number}`
                            : 'Сначала выберите кабинет'}
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
        </aside>
      </div>
    </div>
  );
}

function RoomForm({ room, departments, onSave, onClearGeometry, hasGeometry: geo }) {
  const [form, setForm] = useState({
    number: room.number, name: room.name || '', kind: room.kind,
    departmentId: room.departmentId || '', capacityHours: room.capacityHours,
  });

  useEffect(() => {
    setForm({
      number: room.number, name: room.name || '', kind: room.kind,
      departmentId: room.departmentId || '', capacityHours: room.capacityHours,
    });
  }, [room.id, room.number, room.name, room.kind, room.departmentId, room.capacityHours]);

  return (
    <div className="wh-form">
      <label>Номер
        <input value={form.number} onChange={e => setForm(f => ({ ...f, number: e.target.value }))} />
      </label>
      <label>Название
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      </label>
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
      <label>Суточная ёмкость, ч
        <input type="number" step="0.5" min="0" max="24" value={form.capacityHours}
               onChange={e => setForm(f => ({ ...f, capacityHours: Number(e.target.value) }))} />
      </label>
      <p className="wh-hint">
        Ёмкость — знаменатель загрузки. Если кабинет показывает больше 100 %, значит
        он работает дольше заявленного, и это поле занижено.
      </p>

      {(room.misRoomAliases || []).length > 0 && (
        <div className="wh-aliases">
          <span>Названия в МИС:</span>
          {room.misRoomAliases.map(a => (
            <button key={a} className="wh-chip wh-chip--removable"
                    title="Убрать сопоставление"
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
