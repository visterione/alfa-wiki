import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * План этажа: SVG в метрах с панорамированием и зумом.
 *
 * Один компонент на три экрана — просмотр, тепловая карта и редактор. Разводить
 * их по отдельным реализациям было бы приглашением к расхождению: геометрию
 * рисуют одни и те же координаты, и «в редакторе кабинет выглядит иначе, чем на
 * карте» — худший из возможных багов такого модуля.
 *
 * Система координат — метры из warehouse_floors.planWidthM/planHeightM. SVG
 * viewBox задан в метрах напрямую: пиксели считает браузер, а мы нигде не держим
 * коэффициент пересчёта, который иначе пришлось бы синхронизировать между
 * отрисовкой, кликами и перетаскиванием.
 */

// Шаг привязки в метрах. 0,25 м — компромисс: стены попадают на сетку, но
// подогнать кабинет под нестандартную нишу всё ещё можно.
export const GRID_STEP = 0.25;

const ZONE_FILL = {
  green:   { fill: '#d7f0dd', stroke: '#54a86c' },
  yellow:  { fill: '#fdf0c8', stroke: '#d9a92b' },
  red:     { fill: '#fbd8d8', stroke: '#cf5555' },
  orange:  { fill: '#fde3c8', stroke: '#d98b2b' },
  unknown: { fill: '#eef1f5', stroke: '#aab4c2' },
  scale:   { fill: '#dbe7f7', stroke: '#5b87c4' },
};

/**
 * Виды технических помещений и оформления.
 *
 * Коридор, лестница, санузел — это фигуры, а не кабинеты: инвентаря в них нет, и
 * заводить под коридор кабинет с материально ответственным лицом было бы
 * искажением учёта. Поэтому у них своя таблица и свой набор стилей.
 *
 * Порядок в объекте — порядок в палитре редактора, от самых частых к редким.
 */
export const SHAPE_KINDS = {
  corridor:       { label: 'Коридор',        fill: '#eef2f7', stroke: '#cbd5e1', dash: null,        icon: '⬍', technical: true },
  hall:           { label: 'Холл',           fill: '#f1f5f9', stroke: '#cbd5e1', dash: null,        icon: '◫', technical: true },
  reception_area: { label: 'Ресепшн',        fill: '#e8f2fd', stroke: '#93c5fd', dash: null,        icon: '▤', technical: true },
  stairs:         { label: 'Лестница',       fill: '#dde3ec', stroke: '#94a3b8', dash: null,        icon: '≡', technical: true },
  elevator:       { label: 'Лифт',           fill: '#e2e8f0', stroke: '#94a3b8', dash: null,        icon: '⇅', technical: true },
  wc:             { label: 'Санузел',        fill: '#e7f1ee', stroke: '#9ec5b8', dash: null,        icon: '⊘', technical: true },
  server:         { label: 'Серверная',      fill: '#efe9f7', stroke: '#b8a6d9', dash: null,        icon: '▦', technical: true },
  utility:        { label: 'Подсобное',      fill: '#f4f1e8', stroke: '#cfc4a5', dash: null,        icon: '▨', technical: true },
  wardrobe:       { label: 'Гардероб',       fill: '#f7f0ec', stroke: '#d9bfae', dash: null,        icon: '⌷', technical: true },
  wall:           { label: 'Стена',          fill: '#94a3b8', stroke: '#64748b', dash: null,        icon: '▬', technical: false },
  door:           { label: 'Дверь',          fill: '#ffffff', stroke: '#94a3b8', dash: '0.2 0.2',   icon: '⌐', technical: false },
  window:         { label: 'Окно',           fill: '#dbeafe', stroke: '#60a5fa', dash: null,        icon: '▭', technical: false },
  area:           { label: 'Зона',           fill: '#f5f7fa', stroke: '#dbe1e8', dash: '0.3 0.2',   icon: '▢', technical: false },
  text:           { label: 'Подпись',        fill: 'transparent', stroke: 'transparent', dash: null, icon: 'T', technical: false },
};

const SHAPE_STYLE = SHAPE_KINDS;

function pointsToPath(points) {
  if (!Array.isArray(points) || points.length < 2) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
}

function polygonCenter(points) {
  if (!Array.isArray(points) || !points.length) return { x: 0, y: 0 };
  const sx = points.reduce((s, p) => s + p[0], 0);
  const sy = points.reduce((s, p) => s + p[1], 0);
  return { x: sx / points.length, y: sy / points.length };
}

/**
 * Обрезает подпись под ширину кабинета. Оценка ширины символа — 0,52 от размера
 * шрифта: точную ширину в SVG без measureText не узнать, а measureText на каждый
 * кабинет при каждом кадре зума слишком дорог. Если не влезает даже три символа,
 * подпись не рисуется вовсе — обрубок «М…» бесполезен, а полное название всегда
 * доступно в подсказке при наведении.
 */
function clip(text, widthM, fontSize) {
  if (!text) return null;
  const str = String(text);
  const maxChars = Math.floor((widthM * 0.88) / (fontSize * 0.52));
  if (maxChars < 3) return null;
  return str.length <= maxChars ? str : `${str.slice(0, maxChars - 1)}…`;
}

const round2 = n => Math.round(n * 100) / 100;

/** Метры для подписи: без хвостовых нулей — «19,8», а не «19,80». */
const fmtM = n => String(Math.round(Number(n) * 10) / 10).replace('.', ',');

/**
 * Лежит ли точка внутри многоугольника. Алгоритм трассировки луча: считаем, сколько
 * раз горизонтальный луч из точки пересекает стороны. Чётное — снаружи, нечётное —
 * внутри. Работает и для невыпуклых контуров, а именно такие у Г-образных этажей.
 *
 * Точка ровно на стороне считается внутри: вершину кабинета часто ставят вплотную
 * к стене, и не пускать её туда было бы неверно.
 */
export function pointInPolygon(point, polygon, eps = 1e-9) {
  const [px, py] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    // Точка на самой стороне — сразу внутри.
    const cross = (xj - xi) * (py - yi) - (yj - yi) * (px - xi);
    if (Math.abs(cross) < 1e-6
        && px >= Math.min(xi, xj) - eps && px <= Math.max(xi, xj) + eps
        && py >= Math.min(yi, yj) - eps && py <= Math.max(yi, yj) + eps) {
      return true;
    }

    if ((yi > py) !== (yj > py)
        && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Ближайшая точка на границе многоугольника — проекция на ближайшую сторону. */
export function nearestPointOnPolygon(point, polygon) {
  const [px, py] = point;
  let best = polygon[0];
  let bestDist = Infinity;

  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[(i + 1) % polygon.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    // Параметр проекции, зажатый в отрезок: за его пределами ближайшая точка —
    // это конец стороны, а не продолжение прямой.
    const t = lenSq === 0 ? 0
      : Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    const dist = (px - cx) ** 2 + (py - cy) ** 2;
    if (dist < bestDist) { bestDist = dist; best = [cx, cy]; }
  }
  return best;
}

export function polygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

export default function FloorPlanSvg({
  floor,
  rooms = [],
  shapes = [],
  mode = 'view',                 // view | heatmap | edit
  selectedRoomId = null,
  selectedShapeId = null,
  hoveredRoomId = null,
  colorOf = null,                // (room) => {fill, stroke} — переопределяет зону
  labelOf = null,                // (room) => string — вторая строка подписи
  onRoomClick = null,
  onRoomHover = null,
  onShapeClick = null,
  onVertexDrag = null,           // (roomId, vertexIndex, [x, y])
  onRoomMove = null,             // (roomId, dx, dy)
  onShapeVertexDrag = null,      // (shapeId, vertexIndex, [x, y])
  onShapeMove = null,            // (shapeId, dx, dy)
  onOutlineVertexDrag = null,    // (vertexIndex, [x, y])
  onCanvasDraw = null,           // (rect) — завершение рисования прямоугольником
  onPolygonDone = null,          // (points) — завершение рисования по точкам
  drawing = false,               // false | 'rect' | 'polygon'
  // Ограничивать рисование контуром этажа. Для кабинетов и технических помещений
  // это правило обязательно: кабинет за стеной здания не существует. Для контура
  // самого этажа и оформления — выключается.
  constrainDrawing = false,
  onOutOfBounds = null,          // попытка нарисовать за пределами этажа
  editOutline = false,           // показывать ручки контура этажа
  showGrid = false,
  height = 560,
}) {
  const svgRef = useRef(null);
  const [view, setView] = useState(() => ({ x: 0, y: 0, scale: 1 }));
  const [drag, setDrag] = useState(null);
  const [drawRect, setDrawRect] = useState(null);
  // Рисование многоугольником: набранные точки плюс позиция курсора для «резинки».
  const [polyPoints, setPolyPoints] = useState([]);
  const [cursor, setCursor] = useState(null);

  const width = Number(floor?.planWidthM) || 40;
  const depth = Number(floor?.planHeightM) || 25;

  // Поле вокруг холста — 5 % от большей стороны, но не меньше 1,2 м, иначе на
  // маленьком этаже подписи размеров налезали бы на сам лист.
  const pad = Math.max(1.2, Math.max(width, depth) * 0.05);
  const viewW = width + pad * 2;
  const viewH = depth + pad * 2;
  const homeView = useMemo(() => ({ x: -pad, y: -pad, scale: 1 }), [pad]);

  // Контур этажа. Пустой — этаж прямоугольный по габаритам: так ведут себя все
  // планы, созданные до ver. 6.69, и так проще заводить новый этаж.
  const outlinePoints = Array.isArray(floor?.outline?.points) && floor.outline.points.length >= 3
    ? floor.outline.points
    : null;

  // Сброс камеры при смене этажа: иначе на новом плане остаётся кадр от старого,
  // и пользователь смотрит в пустоту рядом с домом.
  useEffect(() => {
    setView(homeView);
  }, [floor?.id, homeView]);

  // Смена инструмента бросает недорисованную ломаную: незамкнутые точки от
  // прошлого инструмента, всплывающие поверх нового, — источник недоумения.
  useEffect(() => {
    setPolyPoints([]);
    setCursor(null);
  }, [drawing]);

  // Escape отменяет рисование по точкам. Единственный способ выйти без него —
  // замкнуть фигуру, которая не нужна, а потом её удалить.
  useEffect(() => {
    if (drawing !== 'polygon') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { setPolyPoints([]); setCursor(null); }
      // Backspace убирает последнюю точку: промахнуться на восьмой вершине
      // и начинать заново — обидно.
      if (e.key === 'Backspace') { e.preventDefault(); setPolyPoints(prev => prev.slice(0, -1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawing]);

  /**
   * Экранные координаты события → метры плана.
   *
   * Считается через собственную матрицу SVG (getScreenCTM), а не пропорцией от
   * getBoundingClientRect. Так было раньше, и это давало настоящий баг: при
   * preserveAspectRatio="xMidYMid meet" viewBox вписывается в элемент с полями по
   * бокам или сверху, а пропорция от габаритов элемента об этих полях не знает.
   * Смещение и масштаб получались неверными, и вершину при перетаскивании
   * отбрасывало далеко от курсора — дотянуть её до нужного места было нельзя.
   *
   * Перемещение фигуры целиком тот же дефект почти скрывало: там координата
   * относительная, и ошибка смещения гасилась в разнице. У вершины координата
   * абсолютная, поэтому рывок был виден сразу.
   *
   * Матрица учитывает viewBox, поля от preserveAspectRatio и любые CSS-трансформы
   * над элементом — пересчитывать это руками незачем.
   */
  const toPlan = useCallback((evt) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const snap = v => Math.round(v / GRID_STEP) * GRID_STEP;

  /**
   * Границы этажа: контур, если он задан, иначе прямоугольник холста.
   * Всё, что относится к учёту — кабинеты и технические помещения, — должно
   * лежать внутри: кабинет за стеной здания не существует, а на тепловой карте
   * такой полигон выглядел бы как отдельно стоящий сарай.
   */
  const floorPolygon = useMemo(() => (
    outlinePoints || [[0, 0], [width, 0], [width, depth], [0, depth]]
  ), [outlinePoints, width, depth]);

  /**
   * Точка, загнанная внутрь этажа и привязанная к сетке.
   *
   * Если курсор за стеной, вершина не замирает и не прыгает, а садится на
   * ближайшую точку стены — тянешь дальше, она скользит по контуру. Запрещать
   * движение совсем было бы хуже: непонятно, почему вершина «залипла».
   */
  const snapInside = (pos) => {
    const p = [snap(pos.x), snap(pos.y)];
    if (pointInPolygon(p, floorPolygon)) return p;
    const near = nearestPointOnPolygon(p, floorPolygon);
    // Привязку к сетке после проекции не делаем: она снова вытолкнула бы точку
    // за стену, и вершина задрожала бы между двумя положениями.
    return [round2(near[0]), round2(near[1])];
  };

  /** Уместится ли фигура целиком внутри этажа после смещения. */
  const fitsInside = (points, dx, dy) =>
    points.every(([x, y]) => pointInPolygon([x + dx, y + dy], floorPolygon));

  const handleWheel = useCallback((evt) => {
    evt.preventDefault();
    const factor = evt.deltaY > 0 ? 1 / 1.15 : 1.15;
    // Точку под курсором берём той же матрицей, что и всё остальное: до
    // изменения масштаба она в плановых координатах, и после зума должна
    // остаться на том же месте экрана.
    const anchor = toPlan(evt);
    setView(prev => {
      const nextScale = Math.min(8, Math.max(0.5, prev.scale * factor));
      // Доля курсора внутри текущего окна просмотра. Считается от viewBox, а не
      // от габаритов элемента, — по той же причине, что и в toPlan.
      const fx = (anchor.x - prev.x) / (viewW / prev.scale);
      const fy = (anchor.y - prev.y) / (viewH / prev.scale);
      return {
        scale: nextScale,
        x: anchor.x - fx * (viewW / nextScale),
        y: anchor.y - fy * (viewH / nextScale),
      };
    });
  }, [viewW, viewH, toPlan]);

  // Колесо вешаем вручную: React делает wheel-слушатель пассивным, и
  // preventDefault в нём не работает — страница скроллилась бы вместе с зумом.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const onMouseDown = (evt) => {
    if (evt.button !== 0) return;
    const pos = toPlan(evt);

    if (drawing === 'rect' && mode === 'edit') {
      setDrawRect({ x0: snap(pos.x), y0: snap(pos.y), x1: snap(pos.x), y1: snap(pos.y) });
      return;
    }
    if (drawing === 'polygon' && mode === 'edit') {
      // Клик добавляет вершину; замыкание — по двойному клику или по клику рядом
      // с первой точкой. Так рисуют Г-образные крылья и срезанные углы, которые
      // прямоугольником не описать.
      const p = [snap(pos.x), snap(pos.y)];
      if (polyPoints.length >= 3) {
        const [fx, fy] = polyPoints[0];
        if (Math.hypot(p[0] - fx, p[1] - fy) < 0.6) {
          if (constrainDrawing && !polyPoints.every(pt => pointInPolygon(pt, floorPolygon))) {
            onOutOfBounds?.();
            return;
          }
          onPolygonDone?.(polyPoints);
          setPolyPoints([]);
          return;
        }
      }
      // Точку за пределами этажа не принимаем вовсе: иначе о нарушении узнаёшь
      // только при замыкании, когда обведено уже полдесятка вершин.
      if (constrainDrawing && !pointInPolygon(p, floorPolygon)) {
        onOutOfBounds?.();
        return;
      }
      setPolyPoints(prev => [...prev, p]);
      return;
    }
    // Панорамирование — с зажатым пробелом/средней кнопкой было бы привычнее, но
    // на плане нет текста для выделения, поэтому просто тянем фон.
    if (evt.target === svgRef.current || evt.target.dataset?.role === 'bg') {
      setDrag({ kind: 'pan', startX: evt.clientX, startY: evt.clientY, origin: { ...view } });
    }
  };

  const onDoubleClick = () => {
    if (drawing === 'polygon' && polyPoints.length >= 3) {
      if (constrainDrawing && !polyPoints.every(pt => pointInPolygon(pt, floorPolygon))) {
        onOutOfBounds?.();
        return;
      }
      onPolygonDone?.(polyPoints);
      setPolyPoints([]);
    }
  };

  const onMouseMove = (evt) => {
    if (drawing === 'polygon') {
      const pos = toPlan(evt);
      setCursor([snap(pos.x), snap(pos.y)]);
    }
    if (drawRect) {
      const pos = toPlan(evt);
      setDrawRect(prev => ({ ...prev, x1: snap(pos.x), y1: snap(pos.y) }));
      return;
    }
    if (!drag) return;

    if (drag.kind === 'pan') {
      // Панорамирование считается по экранному смещению и масштабу из матрицы, а
      // НЕ по разнице плановых координат. Причина: при панорамировании меняется
      // сам viewBox, то есть система координат под курсором. Взяв плановую точку
      // начала и сравнивая её с плановой точкой сейчас, мы получили бы
      // положительную обратную связь — карта убегала бы от курсора.
      //
      // ctm.a и ctm.d — это пиксели на метр. Во время панорамирования они
      // постоянны (ширина viewBox не меняется, меняется только его начало), и
      // при этом уже учитывают поля от preserveAspectRatio.
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!ctm || !ctm.a || !ctm.d) return;
      const dx = (evt.clientX - drag.startX) / ctm.a;
      const dy = (evt.clientY - drag.startY) / ctm.d;
      setView({ ...drag.origin, x: drag.origin.x - dx, y: drag.origin.y - dy });
      return;
    }
    if (drag.kind === 'vertex' && onVertexDrag) {
      const p = snapInside(toPlan(evt));
      onVertexDrag(drag.roomId, drag.index, p);
      return;
    }
    if (drag.kind === 'shapeVertex' && onShapeVertexDrag) {
      const shape = shapes.find(s => (s.id || '') === drag.shapeId);
      // Оформление (стены, проёмы, подписи) не ограничиваем: стена стоит ровно на
      // границе этажа, и загонять её внутрь было бы неверно.
      const p = shape && shape.isTechnical === false
        ? [snap(toPlan(evt).x), snap(toPlan(evt).y)]
        : snapInside(toPlan(evt));
      onShapeVertexDrag(drag.shapeId, drag.index, p);
      return;
    }
    if (drag.kind === 'outlineVertex' && onOutlineVertexDrag) {
      // Контур ограничен холстом: за его пределами он просто не отрисуется.
      const pos = toPlan(evt);
      onOutlineVertexDrag(drag.index, [
        snap(Math.min(Math.max(pos.x, 0), width)),
        snap(Math.min(Math.max(pos.y, 0), depth)),
      ]);
      return;
    }
    if ((drag.kind === 'room' || drag.kind === 'shape')) {
      // Точка отсчёта ставится в обработчике нажатия. Если её нет, значит режим
      // перетаскивания начался не через него — падать из-за этого обработчик
      // движения мыши не должен: он вызывается на каждое движение, и одна ошибка
      // здесь заваливает экран красным оверлеем.
      if (!drag.startPlan) return;
      const pos = toPlan(evt);
      const dx = snap(pos.x - drag.startPlan.x);
      const dy = snap(pos.y - drag.startPlan.y);
      if (dx === 0 && dy === 0) return;

      const target = drag.kind === 'room'
        ? rooms.find(r => (r.roomId || r.id) === drag.roomId)
        : shapes.find(s => (s.id || '') === drag.shapeId);
      const pts = drag.kind === 'room' ? target?.plan?.points : target?.geometry?.points;
      const constrained = drag.kind === 'room' || (target && target.isTechnical !== false);

      // Пробуем полное смещение, потом только по X, потом только по Y. Так фигура
      // скользит вдоль стены, а не замирает целиком, когда упёрлась одним углом.
      const variants = [[dx, dy], [dx, 0], [0, dy]];
      for (const [vx, vy] of variants) {
        if (vx === 0 && vy === 0) continue;
        if (constrained && pts && !fitsInside(pts, vx, vy)) continue;
        if (drag.kind === 'room') onRoomMove?.(drag.roomId, vx, vy);
        else onShapeMove?.(drag.shapeId, vx, vy);
        setDrag({ ...drag, startPlan: { x: drag.startPlan.x + vx, y: drag.startPlan.y + vy } });
        return;
      }
      // Ни один вариант не поместился — курсор ушёл за стену. Точку отсчёта не
      // двигаем: когда курсор вернётся, накопленное смещение отработает верно.
    }
  };

  /**
   * Укладывается ли рисуемая рамка в этаж. Проверяются все четыре угла: для
   * невыпуклого контура одного центра недостаточно — рамка, перекинутая через
   * выемку Г-образного этажа, центром попадает внутрь, а углом выходит наружу.
   */
  const rectPoints = (r) => {
    const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1);
    const w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
    return { x, y, w, h, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
  };

  const drawValid = useMemo(() => {
    if (!constrainDrawing) return true;
    if (drawRect) {
      const { w, h, points } = rectPoints(drawRect);
      if (w < 0.5 || h < 0.5) return true;   // ещё не рамка, а движение мышью
      return points.every(p => pointInPolygon(p, floorPolygon));
    }
    if (drawing === 'polygon' && polyPoints.length) {
      const all = cursor ? [...polyPoints, cursor] : polyPoints;
      return all.every(p => pointInPolygon(p, floorPolygon));
    }
    return true;
  }, [drawRect, polyPoints, cursor, drawing, floorPolygon, constrainDrawing]);

  const onMouseUp = () => {
    if (drawRect && onCanvasDraw) {
      const { x, y, w, h, points } = rectPoints(drawRect);
      // Меньше половины метра по стороне — это промах мышью, а не кабинет.
      if (w >= 0.5 && h >= 0.5) {
        const inside = !constrainDrawing || points.every(p => pointInPolygon(p, floorPolygon));
        if (inside) onCanvasDraw({ x, y, w, h });
        else onOutOfBounds?.();
      }
    }
    setDrawRect(null);
    setDrag(null);
  };

  const viewBox = useMemo(
    () => `${view.x} ${view.y} ${viewW / view.scale} ${viewH / view.scale}`,
    [view, viewW, viewH]
  );

  // Толщина линий и размер шрифта — в метрах, поэтому при зуме их надо делить на
  // масштаб, иначе на приближении обводка превращается в кляксу.
  const k = 1 / view.scale;

  const gridLines = useMemo(() => {
    if (!showGrid) return null;
    const step = view.scale > 3 ? 0.5 : view.scale > 1.5 ? 1 : 2;
    const lines = [];
    for (let x = 0; x <= width + 0.001; x += step) lines.push(['v', Math.round(x * 100) / 100]);
    for (let y = 0; y <= depth + 0.001; y += step) lines.push(['h', Math.round(y * 100) / 100]);
    return lines;
  }, [showGrid, width, depth, view.scale]);

  return (
    <div className="wh-plan" style={{ height }}>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDoubleClick={onDoubleClick}
        className={`wh-plan__svg ${drawing ? 'wh-plan__svg--draw' : ''} ${drag?.kind === 'pan' ? 'wh-plan__svg--panning' : ''}`}
      >
        {/* Поле вокруг холста — тоже подложка: панорамировать можно и оттуда. */}
        <rect data-role="bg" x={-pad} y={-pad} width={viewW} height={viewH} fill="transparent" />

        {/* Граница холста с подписанными габаритами. Без неё изменение размера
            холста выглядело так, будто ничего не произошло: и viewBox, и подложка
            менялись вместе, лист всегда упирался в края экрана. */}
        <rect x="0" y="0" width={width} height={depth} fill="none"
              stroke="#b9c4d2" strokeWidth={0.05 * k}
              strokeDasharray={`${0.5 * k} ${0.35 * k}`} />
        <g fontSize={0.6 * k} fill="#8794a5" style={{ pointerEvents: 'none' }}>
          <text x={width / 2} y={-pad * 0.35} textAnchor="middle">{fmtM(width)} м</text>
          <text x={-pad * 0.35} y={depth / 2} textAnchor="middle"
                transform={`rotate(-90 ${-pad * 0.35} ${depth / 2})`}>{fmtM(depth)} м</text>
        </g>

        {/* Контур этажа. Произвольный многоугольник, если он задан, иначе
            прямоугольник по габаритам — так выглядят все планы до ver. 6.69. */}
        {outlinePoints ? (
          <path data-role="bg" d={pointsToPath(outlinePoints)}
                fill="var(--wh-plan-bg, #fbfcfe)" stroke="#c9d3e0" strokeWidth={0.12 * k}
                strokeLinejoin="round" />
        ) : (
          <rect data-role="bg" x="0" y="0" width={width} height={depth}
                fill="var(--wh-plan-bg, #fbfcfe)" stroke="#c9d3e0" strokeWidth={0.08 * k} />
        )}

        {gridLines && (
          <g opacity="0.5">
            {gridLines.map(([dir, v], i) => dir === 'v'
              ? <line key={`v${i}`} x1={v} y1={0} x2={v} y2={depth} stroke="#dfe6ef" strokeWidth={0.02 * k} />
              : <line key={`h${i}`} x1={0} y1={v} x2={width} y2={v} stroke="#dfe6ef" strokeWidth={0.02 * k} />
            )}
          </g>
        )}

        {/* Подложка: скан поэтажного плана, по которому обводят кабинеты */}
        {floor?.planBgUrl && (
          <image href={floor.planBgUrl} x="0" y="0" width={width} height={depth}
                 opacity={floor.planBgOpacity ?? 0.35} preserveAspectRatio="none" />
        )}

        {/* Технические помещения и оформление: коридоры, лестницы, стены, подписи */}
        <g>
          {shapes.map((shape, idx) => {
            const st = SHAPE_STYLE[shape.kind] || SHAPE_STYLE.area;
            const pts = shape.geometry?.points;
            if (!Array.isArray(pts) || pts.length < 2) return null;
            const center = shape.geometry?.label || polygonCenter(pts);
            const id = shape.id || `tmp-${idx}`;
            const isSel = selectedShapeId === id;
            const editable = mode === 'edit';

            const xs = pts.map(p => p[0]);
            const shapeWidthM = Math.max(...xs) - Math.min(...xs);
            const labelSize = (shape.kind === 'text' ? 0.72 : 0.58) * k;
            const labelText = clip(shape.label, Math.max(shapeWidthM, 2.5), labelSize);

            return (
              <g key={id}
                 onClick={editable ? (e) => { e.stopPropagation(); onShapeClick?.(id); } : undefined}
                 onMouseDown={editable && !drawing ? (e) => {
                   e.stopPropagation();
                   onShapeClick?.(id);
                   setDrag({ kind: 'shape', shapeId: id, startPlan: toPlan(e) });
                 } : undefined}>
                <title>{[st.label, shape.label].filter(Boolean).join(' · ')}</title>
                <path d={pointsToPath(pts)}
                      fill={shape.style?.fill || st.fill}
                      stroke={isSel ? '#1e3a5f' : (shape.style?.stroke || st.stroke)}
                      strokeWidth={(isSel ? 0.14 : 0.06) * k}
                      strokeDasharray={st.dash || undefined}
                      style={{ cursor: editable ? 'move' : 'default' }} />
                {labelText && (
                  <text x={center.x} y={center.y} textAnchor="middle" dominantBaseline="middle"
                        fontSize={labelSize}
                        fontWeight={shape.kind === 'text' ? 600 : 400}
                        fill={shape.kind === 'text' ? '#475569' : '#8794a5'}
                        style={{ pointerEvents: 'none' }}>
                    {labelText}
                  </text>
                )}
                {editable && isSel && pts.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={0.2 * k}
                          fill="#fff" stroke="#1e3a5f" strokeWidth={0.05 * k}
                          style={{ cursor: 'nwse-resize' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setDrag({ kind: 'shapeVertex', shapeId: id, index: i });
                          }} />
                ))}
              </g>
            );
          })}
        </g>

        {/* Кабинеты */}
        <g>
          {rooms.map(room => {
            const pts = room.plan?.points;
            if (!Array.isArray(pts) || pts.length < 3) return null;

            const custom = colorOf ? colorOf(room) : null;
            const zone = ZONE_FILL[room.metricZone || room.zone || 'unknown'] || ZONE_FILL.unknown;
            const fill = custom?.fill || zone.fill;
            const stroke = custom?.stroke || zone.stroke;
            const isSelected = selectedRoomId === room.roomId || selectedRoomId === room.id;
            const isHovered = hoveredRoomId === room.roomId || hoveredRoomId === room.id;
            const center = room.plan?.label || polygonCenter(pts);
            const id = room.roomId || room.id;

            // Подписи режем по ширине самого кабинета. Без этого «МРТ высокого
            // разрешения» и «Смотровая (Хирургия)» выезжают за полигон и наезжают
            // на соседей — на плане это выглядело как каша из букв.
            const xs = pts.map(p => p[0]);
            const roomWidthM = Math.max(...xs) - Math.min(...xs);
            const numberSize = 0.75 * k;
            const subSize = 0.62 * k;
            const numberText = clip(room.number, roomWidthM, numberSize);
            const subText = clip(labelOf ? labelOf(room) : null, roomWidthM, subSize);

            return (
              <g key={id}
                 className="wh-plan__room"
                 onMouseEnter={() => onRoomHover?.(id)}
                 onMouseLeave={() => onRoomHover?.(null)}
                 onClick={() => onRoomClick?.(id)}
                 onMouseDown={(e) => {
                   if (mode !== 'edit' || drawing) return;
                   e.stopPropagation();
                   setDrag({ kind: 'room', roomId: id, startPlan: toPlan(e) });
                 }}>
                <path d={pointsToPath(pts)}
                      fill={fill}
                      stroke={isSelected ? '#1e3a5f' : stroke}
                      strokeWidth={(isSelected ? 0.16 : isHovered ? 0.12 : 0.07) * k}
                      style={{ cursor: mode === 'edit' ? 'move' : 'pointer', transition: 'fill .15s' }} />

                <title>{[room.number, room.name, labelOf ? labelOf(room) : null].filter(Boolean).join(' · ')}</title>

                <text x={center.x} y={center.y - 0.35 * k} textAnchor="middle" dominantBaseline="middle"
                      fontSize={numberSize} fontWeight="600" fill="#25303f"
                      style={{ pointerEvents: 'none' }}>
                  {numberText}
                </text>
                {subText && (
                  <text x={center.x} y={center.y + 0.7 * k} textAnchor="middle" dominantBaseline="middle"
                        fontSize={subSize} fill="#5a6779" style={{ pointerEvents: 'none' }}>
                    {subText}
                  </text>
                )}

                {/* Ручки вершин — только в редакторе и только у выбранного кабинета */}
                {mode === 'edit' && isSelected && pts.map((p, idx) => (
                  <circle key={idx} cx={p[0]} cy={p[1]} r={0.22 * k}
                          fill="#fff" stroke="#1e3a5f" strokeWidth={0.06 * k}
                          style={{ cursor: 'nwse-resize' }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setDrag({ kind: 'vertex', roomId: id, index: idx });
                          }} />
                ))}
              </g>
            );
          })}
        </g>

        {/* Ручки контура этажа — только когда его правят, чтобы они не мешали
            обводить кабинеты. */}
        {mode === 'edit' && editOutline && outlinePoints && (
          <g>
            <path d={pointsToPath(outlinePoints)} fill="none" stroke="#1e3a5f"
                  strokeWidth={0.16 * k} strokeDasharray={`${0.4 * k} ${0.25 * k}`} />
            {outlinePoints.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={0.26 * k}
                      fill="#1e3a5f" stroke="#fff" strokeWidth={0.07 * k}
                      style={{ cursor: 'move' }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setDrag({ kind: 'outlineVertex', index: i });
                      }} />
            ))}
          </g>
        )}

        {/* Рамка нового прямоугольника */}
        {drawRect && (
          <rect x={Math.min(drawRect.x0, drawRect.x1)} y={Math.min(drawRect.y0, drawRect.y1)}
                width={Math.abs(drawRect.x1 - drawRect.x0)} height={Math.abs(drawRect.y1 - drawRect.y0)}
                fill={drawValid ? 'rgba(30,58,95,.12)' : 'rgba(207,85,85,.18)'}
                stroke={drawValid ? '#1e3a5f' : '#cf5555'} strokeWidth={0.08 * k}
                strokeDasharray={`${0.3 * k} ${0.2 * k}`} />
        )}

        {/* Рисование по точкам: набранная ломаная плюс «резинка» до курсора */}
        {drawing === 'polygon' && polyPoints.length > 0 && (
          <g>
            <polyline
              points={[...polyPoints, cursor].filter(Boolean).map(p => `${p[0]},${p[1]}`).join(' ')}
              fill={drawValid ? 'rgba(30,58,95,.08)' : 'rgba(207,85,85,.14)'}
              stroke={drawValid ? '#1e3a5f' : '#cf5555'} strokeWidth={0.1 * k}
              strokeDasharray={`${0.3 * k} ${0.2 * k}`} />
            {polyPoints.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={(i === 0 ? 0.3 : 0.18) * k}
                      fill={i === 0 ? '#1e3a5f' : '#fff'} stroke="#1e3a5f" strokeWidth={0.06 * k} />
            ))}
            {/* Подсказка у курсора: как замкнуть. Без неё непонятно, что делать
                после третьей точки. */}
            {cursor && polyPoints.length >= 3 && (
              <text x={cursor[0] + 0.4 * k} y={cursor[1] - 0.4 * k}
                    fontSize={0.55 * k} fill={drawValid ? '#1e3a5f' : '#cf5555'}
                    style={{ pointerEvents: 'none' }}>
                {drawValid ? 'двойной клик — замкнуть' : 'за пределами этажа'}
              </text>
            )}
          </g>
        )}

        {/* Масштабная линейка: без неё «метры» на плане — пустое слово */}
        <g transform={`translate(${view.x + 0.6 / view.scale}, ${view.y + depth / view.scale - 0.8 / view.scale})`}>
          <line x1="0" y1="0" x2={5} y2="0" stroke="#5a6779" strokeWidth={0.06 * k} />
          <line x1="0" y1={-0.2 * k} x2="0" y2={0.2 * k} stroke="#5a6779" strokeWidth={0.06 * k} />
          <line x1={5} y1={-0.2 * k} x2={5} y2={0.2 * k} stroke="#5a6779" strokeWidth={0.06 * k} />
          <text x={2.5} y={-0.4 * k} textAnchor="middle" fontSize={0.55 * k} fill="#5a6779">5 м</text>
        </g>
      </svg>

      <div className="wh-plan__zoom">
        <button type="button" onClick={() => setView(v => ({ ...v, scale: Math.min(8, v.scale * 1.3) }))}>+</button>
        <button type="button" onClick={() => setView(v => ({ ...v, scale: Math.max(0.5, v.scale / 1.3) }))}>−</button>
        <button type="button" title="Показать весь этаж"
                onClick={() => setView(homeView)}>⤢</button>
      </div>
    </div>
  );
}
