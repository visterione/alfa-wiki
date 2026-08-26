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

/**
 * Фигура с вырезами: внешний контур плюс любое число дырок.
 *
 * Понадобилось из-за двух совершенно реальных случаев. Первый — внутренний двор:
 * он внутри здания, но это улица, и в площадь этажа его считать нельзя. Второй —
 * кольцевой коридор вокруг такого двора: «бублик» одним контуром не описывается
 * в принципе, а два полукольца рядом — это уже не один коридор, а придуманная
 * специально для редактора конструкция.
 *
 * Хранится в той же геометрии, что и раньше: `{ points, holes }`, где holes —
 * массив колец. Планы без holes работают ровно как прежде, поэтому миграции нет.
 *
 * Рисуется одним путём с fill-rule evenodd: вложенное кольцо само становится
 * дыркой, и не нужно ни маски, ни выреза через clipPath.
 */
export function ringsOf(geometry) {
  const points = Array.isArray(geometry?.points) ? geometry.points : [];
  const holes = Array.isArray(geometry?.holes)
    ? geometry.holes.filter(h => Array.isArray(h) && h.length >= 3)
    : [];
  return { points, holes };
}

function shapeToPath(points, holes) {
  return [points, ...(holes || [])].map(pointsToPath).filter(Boolean).join(' ');
}

/**
 * Заменить точку в нужном кольце. Кольцо −1 — внешний контур, 0 и дальше — вырезы.
 * Одна функция на редактор и на полотно: обе стороны правят одну и ту же
 * геометрию, и разъехавшиеся правила «какой индекс к какому кольцу» дали бы
 * вершину, которая тянется не там, где её взяли.
 */
/**
 * Сдвиг всех колец фигуры. Вырез едет вместе с контуром — иначе при проверке
 * наложения двор кольцевого коридора оставался бы на прежнем месте, и коридор
 * «наезжал» бы сам на свою же дырку. Без округления и подписи: это геометрия для
 * проверок, а не для сохранения.
 */
export function moveRings(geometry, dx, dy) {
  const { points, holes } = ringsOf(geometry);
  const move = pts => pts.map(([x, y]) => [x + dx, y + dy]);
  return { ...geometry, points: move(points), ...(holes.length ? { holes: holes.map(move) } : {}) };
}

export function withRingPoint(geometry, ring, index, point) {
  const { points, holes } = ringsOf(geometry);
  if (ring < 0) {
    const next = points.slice();
    next[index] = point;
    return { ...geometry, points: next };
  }
  const nextHoles = holes.map((h, i) => {
    if (i !== ring) return h;
    const copy = h.slice();
    copy[index] = point;
    return copy;
  });
  return { ...geometry, holes: nextHoles };
}

function polygonCenter(points) {
  if (!Array.isArray(points) || !points.length) return { x: 0, y: 0 };
  const sx = points.reduce((s, p) => s + p[0], 0);
  const sy = points.reduce((s, p) => s + p[1], 0);
  return { x: sx / points.length, y: sy / points.length };
}

/**
 * Наибольший прямоугольник, целиком помещающийся внутри контура.
 *
 * Подпись раньше ставилась в центр масс вершин и обрезалась по габаритной
 * ширине. У невыпуклого помещения врут оба числа: центр масс «Г» лежит во
 * внутреннем углу, у П-образного коридора — снаружи, а габаритная ширина
 * считает и ту полосу, где стены нет. Название выезжало за помещение и наезжало
 * на соседей — чаще всего именно у коридоров, они почти никогда не прямоугольны.
 *
 * Поэтому подпись ставится в середину самого широкого прямоугольника, который
 * влезает внутрь контура, и по его же ширине режется.
 *
 * Прямоугольники ищутся горизонтальными сечениями. Горизонталь пересекает
 * стены в нескольких точках, и промежутки между ними по правилу чётности —
 * ровно те отрезки, что лежат внутри (вырезы считаются теми же пересечениями,
 * поэтому дырка кольцевого коридора учитывается сама). Между соседними
 * высотами вершин стены прямые, так что пересечение отрезков в начале и в конце
 * полосы — точный ответ для всей полосы, а не приближение: у полосы с косой
 * стеной вписанный прямоугольник упирается в её узкий конец. Полосы наращиваются
 * по одной, пересечение только сужается — отсюда перебор квадратичен по числу
 * вершин и стоит доли миллисекунды даже на этаже целиком.
 *
 * Ответ зависит только от геометрии, поэтому кэшируется на её объекте: при
 * панорамировании и зуме перебор не повторяется, а правка вершины создаёт новый
 * объект и сама сбрасывает кэш.
 */
const LABEL_BOXES = new WeakMap();

/**
 * Отрезки горизонтали y, лежащие внутри фигуры.
 *
 * Стороны берутся полуоткрытыми по y: вершина иначе даёт два пересечения вместо
 * одного, и чётность после неё переворачивается наизнанку.
 */
function scanline(rings, y) {
  const xs = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      if ((y1 <= y) === (y2 <= y)) continue;
      xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-9) out.push([xs[i], xs[i + 1]]);
  return out;
}

/** Общая часть двух наборов отрезков. */
function overlap(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const from = Math.max(a[i][0], b[j][0]);
    const to = Math.min(a[i][1], b[j][1]);
    if (to - from > 1e-9) out.push([from, to]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}

/**
 * Высоты, по которым режется контур: все высоты вершин. Косые стены между ними
 * дробятся дополнительно — у треугольной ниши вершин всего три, и без дробления
 * единственная полоса вырождается в её острый угол.
 */
function scanHeights(rings) {
  const values = [];
  rings.forEach(ring => ring.forEach(p => values.push(p[1])));
  values.sort((a, b) => a - b);
  const ys = [];
  for (const v of values) if (!ys.length || v - ys[ys.length - 1] > 1e-6) ys.push(v);
  if (ys.length < 2) return ys;

  const slanted = rings.some(ring => ring.some(([x1, y1], i) => {
    const [x2, y2] = ring[(i + 1) % ring.length];
    return Math.abs(x2 - x1) > 1e-9 && Math.abs(y2 - y1) > 1e-9;
  }));
  if (!slanted) return ys;

  const parts = Math.max(1, Math.min(6, Math.round(30 / (ys.length - 1))));
  if (parts < 2) return ys;
  const dense = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    for (let p = 0; p < parts; p++) dense.push(ys[i] + ((ys[i + 1] - ys[i]) * p) / parts);
  }
  dense.push(ys[ys.length - 1]);
  return dense;
}

function computeLabelBoxes(points, holes) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const rings = [points, ...(holes || [])].filter(r => r.length >= 3);
  const ys = scanHeights(rings);
  if (ys.length < 2) return [];

  // Сечение берётся чуть внутрь полосы: ровно на высоте вершины горизонталь
  // проходит через угол, и ширина там уже не описывает полосу целиком.
  const bands = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const inset = Math.min(1e-3, (ys[i + 1] - ys[i]) / 1000);
    bands.push(overlap(scanline(rings, ys[i] + inset), scanline(rings, ys[i + 1] - inset)));
  }

  const boxes = [];
  for (let from = 0; from < bands.length; from++) {
    let cut = bands[from];
    for (let to = from; to < bands.length && cut.length; to++) {
      if (to > from) cut = overlap(cut, bands[to]);
      const widest = cut.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a), [0, 0]);
      if (widest[1] - widest[0] > 1e-9) {
        boxes.push({
          x: (widest[0] + widest[1]) / 2,
          y: (ys[from] + ys[to + 1]) / 2,
          width: widest[1] - widest[0],
          height: ys[to + 1] - ys[from],
        });
      }
    }
  }

  // Остаются только несравнимые варианты: шире и при этом не ниже другого.
  // Подписи нужен либо самый широкий, либо самый широкий из достаточно высоких,
  // и промежуточные в этом выборе не участвуют.
  const best = [];
  let tallest = 0;
  boxes.sort((a, b) => b.width - a.width || b.height - a.height).forEach(box => {
    if (box.height > tallest + 1e-6) { best.push(box); tallest = box.height; }
  });
  return best;
}

function labelBoxes(geometry, points, holes) {
  if (geometry && LABEL_BOXES.has(geometry)) return LABEL_BOXES.get(geometry);
  const boxes = computeLabelBoxes(points, holes);
  if (geometry) LABEL_BOXES.set(geometry, boxes);
  return boxes;
}

/**
 * Место под подпись: самый широкий вписанный прямоугольник, в который влезает
 * строка нужной высоты. Если такой высоты нет нигде — самый просторный из
 * найденных: подпись всё равно обрежется по ширине, но встанет в помещении, а
 * не поверх соседа. Совсем без геометрии (стена, дверь — две точки) остаётся
 * прежнее поведение: центр масс и габарит.
 */
export function labelSpot(geometry, points, holes, minHeight) {
  const boxes = labelBoxes(geometry, points, holes);
  if (!boxes.length) {
    const center = geometry?.label || polygonCenter(points);
    const bounds = polygonBounds(points);
    return { x: center.x, y: center.y, width: bounds.width, height: bounds.depth };
  }
  return boxes.find(box => box.height >= minHeight)
    || boxes.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
}

/**
 * Обрезает подпись под ширину места, найденного labelSpot. Оценка ширины
 * символа — 0,52 от размера шрифта: точную ширину в SVG без measureText не
 * узнать, а measureText на каждый кабинет при каждом кадре зума слишком дорог.
 * Если не влезает даже три символа, подпись не рисуется вовсе — обрубок «М…»
 * бесполезен, а полное название всегда доступно в подсказке при наведении.
 */
function clip(text, widthM, fontSize) {
  if (!text) return null;
  const str = String(text);
  const maxChars = Math.floor((widthM * 0.88) / (fontSize * 0.52));
  if (maxChars < 3) return null;
  return str.length <= maxChars ? str : `${str.slice(0, maxChars - 1)}…`;
}

const round2 = n => Math.round(n * 100) / 100;

/**
 * Окно просмотра вокруг габарита содержимого. Поле — 5 % от большей стороны, но
 * не меньше 1,2 м: на маленьком этаже подписи размеров иначе налезают на стены.
 */
function frameOf(box) {
  const pad = Math.max(1.2, Math.max(box.w, box.h) * 0.05);
  return { w: box.w + pad * 2, h: box.h + pad * 2, x: box.minX - pad, y: box.minY - pad };
}

/** Метры для подписи: без хвостовых нулей — «19,8», а не «19,80». */
const fmtM = n => String(Math.round(Number(n) * 10) / 10).replace('.', ',');

/** Габарит многоугольника — прямоугольник, в который он вписан. */
export function polygonBounds(points) {
  if (!Array.isArray(points) || !points.length) return { width: 0, depth: 0 };
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys),
  };
}

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

function ringArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

/** Площадь за вычетом вырезов: внутренний двор — не площадь этажа. */
export function polygonArea(points, holes) {
  const outer = ringArea(points);
  if (!Array.isArray(holes) || !holes.length) return outer;
  return Math.max(0, outer - holes.reduce((s, h) => s + ringArea(h), 0));
}

/** Лежит ли точка ровно на границе кольца. Отделяет «на стене» от «внутри». */
export function pointOnRing(point, ring, eps = 1e-9) {
  if (!Array.isArray(ring) || ring.length < 2) return false;
  const [px, py] = point;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cross = (xj - xi) * (py - yi) - (yj - yi) * (px - xi);
    if (Math.abs(cross) < 1e-6
        && px >= Math.min(xi, xj) - eps && px <= Math.max(xi, xj) + eps
        && py >= Math.min(yi, yj) - eps && py <= Math.max(yi, yj) + eps) {
      return true;
    }
  }
  return false;
}

/**
 * Точка внутри фигуры с вырезами. Внутри внешнего контура и не в дырке.
 *
 * Стена двора считается своей: кабинет ставят вплотную к внутреннему двору так же,
 * как к наружной стене, и не пускать его туда было бы неверно.
 */
export function pointInShape(point, points, holes) {
  if (!pointInPolygon(point, points)) return false;
  for (const hole of holes || []) {
    if (pointInPolygon(point, hole) && !pointOnRing(point, hole)) return false;
  }
  return true;
}

/** Ближайшая точка на любой стене фигуры — наружной или стене выреза. */
export function nearestPointOnShape(point, points, holes) {
  let best = nearestPointOnPolygon(point, points);
  let bestDist = (point[0] - best[0]) ** 2 + (point[1] - best[1]) ** 2;
  for (const hole of holes || []) {
    const candidate = nearestPointOnPolygon(point, hole);
    const dist = (point[0] - candidate[0]) ** 2 + (point[1] - candidate[1]) ** 2;
    if (dist < bestDist) { bestDist = dist; best = candidate; }
  }
  return best;
}

/**
 * Точки, в которых отрезок a1→a2 встречается с отрезком b1→b2, — в параметрах t
 * вдоль первого отрезка. Совпадающие по прямой отрезки режутся своими концами:
 * именно так выглядит общая стена двух соседних кабинетов.
 */
function cutParams(a1, a2, b1, b2, eps = 1e-9) {
  const rx = a2[0] - a1[0];
  const ry = a2[1] - a1[1];
  const sx = b2[0] - b1[0];
  const sy = b2[1] - b1[1];
  const denom = rx * sy - ry * sx;
  const qx = b1[0] - a1[0];
  const qy = b1[1] - a1[1];

  if (Math.abs(denom) < eps) {
    if (Math.abs(qx * ry - qy * rx) > 1e-7) return [];   // параллельны, но не на одной прямой
    const len2 = rx * rx + ry * ry;
    if (len2 < eps) return [];
    const t0 = (qx * rx + qy * ry) / len2;
    const t1 = t0 + (sx * rx + sy * ry) / len2;
    return [t0, t1].filter(t => t > eps && t < 1 - eps);
  }

  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return [];
  return [Math.min(1, Math.max(0, t))];
}

/** Есть ли у границы a кусок, лежащий строго внутри b. */
function boundaryEntersInterior(a, b) {
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    const cuts = [0, 1];
    for (let j = 0; j < b.length; j++) {
      cuts.push(...cutParams(p, q, b[j], b[(j + 1) % b.length]));
    }
    cuts.sort((m, n) => m - n);
    for (let s = 1; s < cuts.length; s++) {
      if (cuts[s] - cuts[s - 1] < 1e-9) continue;
      const t = (cuts[s - 1] + cuts[s]) / 2;
      const mid = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      if (pointInPolygon(mid, b) && !pointOnRing(mid, b)) return true;
    }
  }
  return false;
}

const bboxOf = (points) => {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

/**
 * Накладываются ли два многоугольника по площади.
 *
 * Общая стена — норма, а не наложение: кабинеты стоят вплотную друг к другу, и
 * проверка, считающая касание пересечением, запретила бы нормальный этаж целиком.
 * Поэтому всё строгое: касание концами сторон и совпадающие по прямой участки не
 * в счёт, «внутри» — только без границы.
 *
 * Способ — классификация кусков границы: стороны режутся точками встречи с чужими
 * сторонами, и середина каждого куска проверяется на «строго внутри соседа».
 * Проверять одни вершины было бы недостаточно — у квадратов 0…4 и 2…6 все вершины
 * лежат на границе друг друга и ни одна сторона не пересекает чужую по-настоящему,
 * а перекрываются они половиной площади.
 */
export function polygonsOverlap(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return false;

  // Отсев по габаритам. На плане в полсотни кабинетов почти все пары отсекаются
  // здесь, и до полного разбора границ дело не доходит.
  const ba = bboxOf(a);
  const bb = bboxOf(b);
  if (ba.maxX <= bb.minX + 1e-9 || bb.maxX <= ba.minX + 1e-9
      || ba.maxY <= bb.minY + 1e-9 || bb.maxY <= ba.minY + 1e-9) return false;

  if (boundaryEntersInterior(a, b) || boundaryEntersInterior(b, a)) return true;

  // Ни одна граница не заходит внутрь чужой площади — это либо соседи через стену,
  // либо два одинаковых многоугольника. Второе тоже наложение, и ловится только так.
  return a.every(p => pointOnRing(p, b)) && b.every(p => pointOnRing(p, a));
}

/** То же для фигур с вырезами: помещение во внутреннем дворе двору не мешает. */
export function shapesOverlap(a, b) {
  const ra = ringsOf(a);
  const rb = ringsOf(b);
  if (!polygonsOverlap(ra.points, rb.points)) return false;
  if (rb.holes.some(h => ra.points.every(p => pointInPolygon(p, h)))) return false;
  if (ra.holes.some(h => rb.points.every(p => pointInPolygon(p, h)))) return false;
  return true;
}

/**
 * Размеры сторон помещения — как на строительном чертеже.
 *
 * Подписывается КАЖДАЯ сторона, а не «ширина и длина». Для прямоугольного
 * кабинета это одно и то же, но у Г-образного ширины и длины не существует:
 * таких величин там просто нет, а размеры сторон есть всегда и однозначны.
 * Габарит (прямоугольник, в который помещение вписано) показывается отдельно, в
 * боковой панели, и назван габаритом — путать его с размером комнаты нельзя.
 *
 * Размерная линия идёт ВНУТРЬ помещения, а не наружу, как принято в чертеже.
 * Причина в плотности плана: кабинеты стоят стена к стене, и вынесенные наружу
 * размеры каждого накладывались бы на соседние. Внутри места всегда ровно
 * столько, сколько нужно самой комнате.
 *
 * Направление «внутрь» вычисляется проверкой точки, а не ориентацией обхода:
 * порядок вершин у нарисованных мышью помещений произвольный, а у невыпуклых
 * (те самые «Г») нормаль по обходу для части сторон смотрит наружу.
 */
function Dimensions({ points, k, color = '#41506380' }) {
  if (!Array.isArray(points) || points.length < 3) return null;

  // Отступ размерной линии от стены. Ограничен долей меньшей стороны помещения:
  // в узком коридоре 1,4 м постоянный отступ 0,42 м увёл бы линию за
  // противоположную стену, проверка «внутрь» не нашла бы ни одной подходящей
  // нормали, и размер нарисовался бы снаружи, поверх соседнего кабинета.
  const { width: bw, depth: bd } = polygonBounds(points);
  const offset = Math.min(0.42 * k, Math.min(bw, bd) * 0.22);
  const tick = 0.16 * k;        // засечки на концах
  const fontSize = 0.5 * k;
  const items = [];

  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);

    // Стороны короче полутора экранных единиц не подписываем: при отдалении
    // подписи налезли бы друг на друга и превратили план в кашу из цифр. Порог
    // задан в метрах через k, поэтому зависит от масштаба, а не от размера
    // комнаты — на приближении подписывается и ниша в 40 см.
    if (len < 1.5 * k) continue;

    const ux = dx / len;
    const uy = dy / len;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;

    // Нормаль, направленная внутрь: пробуем обе и берём ту, что попала в контур.
    let nx = -uy;
    let ny = ux;
    if (!pointInPolygon([mx + nx * offset, my + ny * offset], points)) {
      nx = -nx; ny = -ny;
    }

    const ax = x1 + nx * offset;
    const ay = y1 + ny * offset;
    const bx = x2 + nx * offset;
    const by = y2 + ny * offset;

    // Текст всегда читается слева направо: подпись, перевёрнутую вверх ногами,
    // на чертеже не оставляют. Угол приводится к (−90°, 90°] — вертикальные
    // стены подписываются снизу вверх, как в чертеже.
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    else if (angle <= -90) angle += 180;

    items.push(
      <g key={i} style={{ pointerEvents: 'none' }}>
        <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={0.03 * k} />
        <line x1={ax - nx * tick} y1={ay - ny * tick} x2={ax + nx * tick} y2={ay + ny * tick}
              stroke={color} strokeWidth={0.03 * k} />
        <line x1={bx - nx * tick} y1={by - ny * tick} x2={bx + nx * tick} y2={by + ny * tick}
              stroke={color} strokeWidth={0.03 * k} />
        <text x={mx + nx * (offset + 0.28 * k)} y={my + ny * (offset + 0.28 * k)}
              transform={`rotate(${angle} ${mx + nx * (offset + 0.28 * k)} ${my + ny * (offset + 0.28 * k)})`}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={fontSize} fill="#415063" fontWeight="500">
          {fmtM(len)}
        </text>
      </g>
    );
  }

  return <g>{items}</g>;
}

/**
 * Ручки правки формы: перетаскивание вершин, добавление новых и удаление лишних.
 *
 * Помещение рисуется один раз — прямоугольником или по точкам, — а дальше форму
 * приходится менять: коридор оказывается Г-образным, у кабинета вырезан угол под
 * колонну. Раньше вершины можно было только двигать, поэтому прямоугольник
 * оставался прямоугольником навсегда, и единственным выходом было стереть
 * помещение и обвести заново, потеряв привязку к кабинету.
 *
 * Точка добавляется на середине стороны — там, где её и ждут. Полупрозрачные
 * плюсы висят на каждой стороне выбранного объекта: без них правило «кликни в
 * стену» пришлось бы объяснять текстом, а угадать его нельзя.
 *
 * Удаление — двойной клик по вершине. Не по одиночному: одиночный начинает
 * перетаскивание, и случайно снесённый угол при обводке этажа стоит дорого.
 * Меньше трёх вершин не остаётся — это уже не многоугольник.
 */
function VertexHandles({ geometry, kind, id, k, color, onDrag, onAdd, onRemove }) {
  const { points, holes } = ringsOf(geometry);
  if (points.length < 3) return null;

  // Вырезы правятся теми же ручками, что и наружные стены: для человека стена
  // внутреннего двора ничем не отличается от стены фасада, и заводить под неё
  // отдельный режим значило бы объяснять разницу, которой нет.
  return (
    <g>
      <RingHandles points={points} ring={-1} kind={kind} id={id} k={k} color={color}
                   onDrag={onDrag} onAdd={onAdd} onRemove={onRemove} />
      {holes.map((hole, i) => (
        <RingHandles key={`hole-${i}`} points={hole} ring={i} kind={kind} id={id} k={k} color={color}
                     onDrag={onDrag} onAdd={onAdd} onRemove={onRemove} />
      ))}
    </g>
  );
}

function RingHandles({ points, ring, kind, id, k, color, onDrag, onAdd, onRemove }) {
  if (!Array.isArray(points) || points.length < 3) return null;

  // У выреза три вершины — законный минимум, и убрать одну из них значит убрать
  // весь вырез: двор из двух стен не бывает. Внешний контур так не исчезает.
  const removable = ring >= 0 || points.length > 3;
  const mids = [];
  if (onAdd) {
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      // На короткой стороне плюс перекрыл бы обе её вершины и мешал бы тянуть их.
      if (Math.hypot(x2 - x1, y2 - y1) < 1.1 * k) continue;
      mids.push({ index: i + 1, x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
    }
  }

  return (
    <g>
      {mids.map(m => (
        <g key={`add-${m.index}`} style={{ cursor: 'copy' }}
           onMouseDown={(e) => {
             e.stopPropagation();
             onAdd({ kind, id, ring, index: m.index, point: [round2(m.x), round2(m.y)] });
             // Новая вершина сразу берётся в перетаскивание. Иначе после плюса её
             // надо было отпустить, найти среди остальных ручек и поймать заново —
             // а поскольку вершина появляется ровно посреди стороны, то есть на
             // самой линии, выглядело это так, будто ничего не произошло.
             onDrag(ring, m.index);
           }}>
          <circle cx={m.x} cy={m.y} r={0.45 * k} fill="transparent" />
          <circle cx={m.x} cy={m.y} r={0.2 * k} fill="#fff" stroke={color} strokeWidth={0.05 * k} opacity="0.85" />
          <path d={`M ${m.x - 0.09 * k} ${m.y} H ${m.x + 0.09 * k} M ${m.x} ${m.y - 0.09 * k} V ${m.y + 0.09 * k}`}
                stroke={color} strokeWidth={0.045 * k} strokeLinecap="round" style={{ pointerEvents: 'none' }} />
          <title>Добавить вершину</title>
        </g>
      ))}
      {points.map((p, i) => (
        // Ручка нарисована мелкой, а ловится крупной: точка радиусом 0,22 м — это
        // около пяти пикселей на неприближённом плане, попасть в неё мышью почти
        // нельзя. Прозрачный круг вдвое больше решает это, не превращая вершины в
        // кляксы поверх чертежа.
        <g key={i} style={{ cursor: 'nwse-resize' }}
           onMouseDown={(e) => { e.stopPropagation(); onDrag(ring, i); }}
           onDoubleClick={(e) => {
             e.stopPropagation();
             if (onRemove && removable) onRemove({ kind, id, ring, index: i });
           }}>
          <circle cx={p[0]} cy={p[1]} r={0.5 * k} fill="transparent" />
          <circle cx={p[0]} cy={p[1]} r={0.22 * k}
                  fill="#fff" stroke={color} strokeWidth={0.06 * k} style={{ pointerEvents: 'none' }} />
          <title>
            {!removable ? 'Тянуть'
              : ring >= 0 && points.length <= 3 ? 'Тянуть; двойной клик — убрать вырез целиком'
              : 'Тянуть; двойной клик — удалить вершину'}
          </title>
        </g>
      ))}
    </g>
  );
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
  // Кабинеты не накладываются друг на друга. Правило включается редактором и
  // касается только кабинетов: коридоры и холлы на живых планах намеренно лежат
  // общим прямоугольником под всем этажом.
  preventOverlap = false,
  avoidOccupied = false,         // рисуемая фигура тоже не должна наезжать на занятое
  onOverlap = null,              // (label) — движение отменено из-за наложения
  editOutline = false,           // показывать ручки контура этажа
  showGrid = false,
  // Размеры сторон: 'none' | 'selected' | 'all'. По умолчанию только у
  // выбранного помещения — размеры всех сразу читаемы лишь на небольшом этаже,
  // а на плане в полсотни кабинетов превращаются в шум.
  dimensions = 'none',
  // Шаг привязки в метрах; 0 — свободное перемещение. Раньше он был константой
  // 0,25 м, и выставить стену на 3,1 м было невозможно в принципе: значение
  // просто не попадало в сетку.
  gridStep = GRID_STEP,
  onVertexAdd = null,             // ({ kind:'room'|'shape'|'outline', id, index, point })
  onVertexRemove = null,          // ({ kind, id, index })
  onOutlineClick = null,          // клик по стене контура — выбрать контур
  height = 560,
}) {
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [drawRect, setDrawRect] = useState(null);
  // Рисование многоугольником: набранные точки плюс позиция курсора для «резинки».
  const [polyPoints, setPolyPoints] = useState([]);
  const [cursor, setCursor] = useState(null);

  const width = Number(floor?.planWidthM) || 40;
  const depth = Number(floor?.planHeightM) || 25;

  // Контур этажа. Пустой — этаж прямоугольный по габаритам: так ведут себя все
  // планы, созданные до ver. 6.69, и так же выглядит просмотр из тепловой карты.
  // В редакторе контур существует всегда: пустого не бывает, его материализует
  // FloorPlanEditor при загрузке.
  const outlinePoints = Array.isArray(floor?.outline?.points) && floor.outline.points.length >= 3
    ? floor.outline.points
    : null;

  // Габарит содержимого — по контуру, а не по «холсту». Холст (planWidthM ×
  // planHeightM) остался только системой координат и точкой привязки для скана
  // БТИ; как область, в которую всё обязано влезать, он больше не работает.
  const contentBox = useMemo(() => {
    const pts = outlinePoints || [[0, 0], [width, 0], [width, depth], [0, depth]];
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      minX,
      minY,
      w: Math.max(1, Math.max(...xs) - minX),
      h: Math.max(1, Math.max(...ys) - minY),
    };
  }, [outlinePoints, width, depth]);

  /**
   * Кадр — размер окна просмотра в метрах, и он намеренно НЕ пересчитывается на
   * каждое движение вершины.
   *
   * Раньше кадр считался от габаритов холста. Стоило потянуть стену наружу, как
   * холст подрастал, вслед за ним менялся viewBox, и весь план уезжал из-под
   * курсора вместе с вершиной, которую в этот момент тянут. Тот же пересчёт
   * сбрасывал камеру через эффект «сменился этаж» — правка контура на приближении
   * каждый раз выкидывала на общий вид.
   *
   * Кадр берётся один раз при открытии этажа и по кнопке «показать весь этаж».
   */
  const [frame, setFrame] = useState(() => frameOf(contentBox));
  const [view, setView] = useState(() => ({ x: frame.x, y: frame.y, scale: 1 }));

  const viewW = frame.w;
  const viewH = frame.h;

  const fitAll = useCallback(() => {
    const next = frameOf(contentBox);
    setFrame(next);
    setView({ x: next.x, y: next.y, scale: 1 });
  }, [contentBox]);

  // Кнопке «весь этаж» нужен свежий контур, а сбросу камеры — ровно одно
  // срабатывание на смену этажа. Ссылка на актуальную функцию разводит эти два
  // требования: положи fitAll в зависимости эффекта — и он сработает на каждое
  // движение вершины контура.
  const fitRef = useRef(fitAll);
  fitRef.current = fitAll;
  useEffect(() => { fitRef.current(); }, [floor?.id]);

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

  // Шаг 0 — привязки нет вовсе. Округление до сантиметра остаётся: миллиметры
  // на плане этажа не значат ничего, а в JSON превращаются в 3.100000000000001.
  const snap = v => (gridStep > 0
    ? +(Math.round(v / gridStep) * gridStep).toFixed(3)
    : Math.round(v * 100) / 100);

  /**
   * Границы этажа: контур, если он задан, иначе прямоугольник холста.
   * Всё, что относится к учёту — кабинеты и технические помещения, — должно
   * лежать внутри: кабинет за стеной здания не существует, а на тепловой карте
   * такой полигон выглядел бы как отдельно стоящий сарай.
   */
  const floorShape = useMemo(() => (
    outlinePoints
      ? { points: outlinePoints, holes: ringsOf(floor?.outline).holes }
      : { points: [[0, 0], [width, 0], [width, depth], [0, depth]], holes: [] }
  ), [outlinePoints, floor, width, depth]);

  /**
   * Точка, загнанная внутрь этажа и привязанная к сетке.
   *
   * Если курсор за стеной, вершина не замирает и не прыгает, а садится на
   * ближайшую точку стены — тянешь дальше, она скользит по контуру. Запрещать
   * движение совсем было бы хуже: непонятно, почему вершина «залипла».
   */
  const snapInside = (pos) => {
    const p = [snap(pos.x), snap(pos.y)];
    if (pointInShape(p, floorShape.points, floorShape.holes)) return p;
    const near = nearestPointOnShape(p, floorShape.points, floorShape.holes);
    // Привязку к сетке после проекции не делаем: она снова вытолкнула бы точку
    // за стену, и вершина задрожала бы между двумя положениями.
    return [round2(near[0]), round2(near[1])];
  };

  /** Уместится ли фигура целиком внутри этажа после смещения. */
  const fitsInside = (points, dx, dy) =>
    points.every(([x, y]) => pointInShape([x + dx, y + dy], floorShape.points, floorShape.holes));

  /**
   * Правило «только внутри этажа» действует, пока помещение внутри и есть.
   *
   * Контур теперь свободно перекраивается, и кабинет запросто оказывается снаружи:
   * подрезали крыло — три комнаты за стеной. Продолжать держать их правилом
   * «внутрь» значило бы запереть их намертво: любое смещение из положения снаружи
   * тоже снаружи, ни один вариант не проходит проверку, и кабинет перестаёт
   * двигаться вовсе — без единого объяснения на экране. Поэтому вышедшее наружу
   * тянется свободно, а вернувшись внутрь, снова подчиняется контуру.
   */
  const isInside = points => Array.isArray(points) && points.every(p => pointInShape(p, floorShape.points, floorShape.holes));

  /**
   * Всё, что занимает место на этаже: кабинеты и технические помещения.
   *
   * Оформление сюда не входит, и это не упущение. Стена стоит ровно на границе
   * помещения, дверь — в проёме, «зона» рисуется поверх нескольких кабинетов
   * специально, а у подписи площади нет вовсе: любое из них пересекается с
   * соседями по своей природе, и запрет на это сделал бы их бесполезными.
   */
  const occupants = useMemo(() => ([
    ...rooms
      .filter(r => Array.isArray(r.plan?.points) && r.plan.points.length >= 3)
      .map(r => ({ kind: 'room', id: r.roomId || r.id, geometry: r.plan, label: `кабинет ${r.number}` })),
    ...shapes
      .filter(s => s.isTechnical !== false
        && Array.isArray(s.geometry?.points) && s.geometry.points.length >= 3)
      .map(s => ({
        kind: 'shape',
        id: s.id || '',
        geometry: s.geometry,
        label: (s.label || SHAPE_KINDS[s.kind]?.label || 'помещение').toLowerCase(),
      })),
  ]), [rooms, shapes]);

  /**
   * Первый занятый объект, на который наложилась бы геометрия. Сам объект из
   * проверки исключается — иначе он всегда пересекался бы сам с собой.
   */
  const hitsOccupied = (selfKind, selfId, geometry) => occupants.find(o => (
    !(o.kind === selfKind && o.id === selfId) && shapesOverlap(geometry, o.geometry)
  )) || null;

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
          if (constrainDrawing && !polyPoints.every(pt => pointInShape(pt, floorShape.points, floorShape.holes))) {
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
      if (constrainDrawing && !pointInShape(p, floorShape.points, floorShape.holes)) {
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
      if (constrainDrawing && !polyPoints.every(pt => pointInShape(pt, floorShape.points, floorShape.holes))) {
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
      const room = rooms.find(r => (r.roomId || r.id) === drag.roomId);
      const pos = toPlan(evt);
      const p = isInside(room?.plan?.points) ? snapInside(pos) : [snap(pos.x), snap(pos.y)];

      // Вершина, которая завела бы кабинет на соседнее помещение, просто не
      // принимается: она остаётся на месте, а как только курсор вернётся в
      // допустимое положение, потянется дальше. Скользить вдоль чужой стены, как
      // при упоре в контур этажа, здесь нечем — направления «вдоль» у произвольной
      // границы соседа нет.
      const hit = preventOverlap && room && !hitsOccupied('room', drag.roomId, room.plan)
        && hitsOccupied('room', drag.roomId, withRingPoint(room.plan, drag.ring, drag.index, p));
      if (hit) { onOverlap?.(hit.label); return; }

      onVertexDrag(drag.roomId, { ring: drag.ring, index: drag.index }, p);
      return;
    }
    if (drag.kind === 'shapeVertex' && onShapeVertexDrag) {
      const shape = shapes.find(s => (s.id || '') === drag.shapeId);
      const pos = toPlan(evt);
      // Оформление (стены, проёмы, подписи) не ограничиваем: стена стоит ровно на
      // границе этажа, и загонять её внутрь было бы неверно.
      const decor = shape?.isTechnical === false;
      const free = decor || !isInside(shape?.geometry?.points);
      const p = free ? [snap(pos.x), snap(pos.y)] : snapInside(pos);

      // Коридор — такое же помещение, как кабинет: наехать им на комнату нельзя.
      const hit = preventOverlap && shape && !decor
        && !hitsOccupied('shape', drag.shapeId, shape.geometry)
        && hitsOccupied('shape', drag.shapeId, withRingPoint(shape.geometry, drag.ring, drag.index, p));
      if (hit) { onOverlap?.(hit.label); return; }

      onShapeVertexDrag(drag.shapeId, { ring: drag.ring, index: drag.index }, p);
      return;
    }
    if (drag.kind === 'outlineVertex' && onOutlineVertexDrag) {
      // Контур не ограничен ничем, и это исправление, а не упущение. Раньше он
      // зажимался в прямоугольник холста, поэтому вытянуть крыло Г-образного
      // здания за исходные 40 × 25 м было нельзя: вершина упиралась в невидимую
      // границу и выглядело это так, будто нарисованная схема «вписывается» в
      // какой-то другой, главный этаж. Границы у здания задаёт сам контур, а
      // холст под него подгоняется при сохранении.
      const pos = toPlan(evt);
      onOutlineVertexDrag({ ring: drag.ring, index: drag.index }, [snap(pos.x), snap(pos.y)]);
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
      const geometry = drag.kind === 'room' ? target?.plan : target?.geometry;
      const pts = geometry?.points;
      const constrained = (drag.kind === 'room' || (target && target.isTechnical !== false))
        && isInside(pts);

      // Правило наложения касается всего, что занимает место: и кабинетов, и
      // технических помещений. Оформление (стены, зоны, подписи) им не связано.
      //
      // Помещение, которое уже с кем-то пересекается, правилу не подчиняется —
      // иначе растащить такую пару было бы нечем: любое смещение из наложенного
      // положения тоже наложенное, ни один вариант не проходит, объект замирает
      // намертво. Разъехались — правило снова в силе. Это же и путь для планов,
      // нарисованных до появления правила: их можно разобрать руками.
      const selfId = drag.kind === 'room' ? drag.roomId : drag.shapeId;
      const occupies = drag.kind === 'room' || (target && target.isTechnical !== false);
      const noOverlap = preventOverlap && occupies && pts
        && !hitsOccupied(drag.kind, selfId, geometry);

      // Пробуем полное смещение, потом только по X, потом только по Y. Так фигура
      // скользит вдоль стены, а не замирает целиком, когда упёрлась одним углом.
      const variants = [[dx, dy], [dx, 0], [0, dy]];
      let blockedBy = null;
      for (const [vx, vy] of variants) {
        if (vx === 0 && vy === 0) continue;
        if (constrained && pts && !fitsInside(pts, vx, vy)) continue;
        if (noOverlap) {
          const moved = moveRings(geometry, vx, vy);
          const hit = hitsOccupied(drag.kind, selfId, moved);
          if (hit) { blockedBy = hit.label; continue; }
        }
        if (drag.kind === 'room') onRoomMove?.(drag.roomId, vx, vy);
        else onShapeMove?.(drag.shapeId, vx, vy);
        setDrag({ ...drag, startPlan: { x: drag.startPlan.x + vx, y: drag.startPlan.y + vy } });
        return;
      }
      // Ни один вариант не поместился — курсор ушёл за стену или упёрся в соседа.
      // Точку отсчёта не двигаем: когда курсор вернётся, накопленное смещение
      // отработает верно.
      if (blockedBy) onOverlap?.(blockedBy);
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

  // Красная рамка при рисовании — единственная обратная связь до того, как
  // помещение создано. Раньше она загоралась только на выходе за контур этажа;
  // теперь и на наезде на занятое место, потому что промах виден сразу, а не
  // после диалога с номером и отделением.
  const drawValid = useMemo(() => {
    const legal = (points) => {
      if (constrainDrawing && !points.every(p => pointInShape(p, floorShape.points, floorShape.holes))) {
        return false;
      }
      return !(avoidOccupied && points.length >= 3 && hitsOccupied(null, null, { points }));
    };
    if (drawRect) {
      const { w, h, points } = rectPoints(drawRect);
      if (w < 0.5 || h < 0.5) return true;   // ещё не рамка, а движение мышью
      return legal(points);
    }
    if (drawing === 'polygon' && polyPoints.length) {
      return legal(cursor ? [...polyPoints, cursor] : polyPoints);
    }
    return true;
    // hitsOccupied и rectPoints пересоздаются каждый рендер, но зависят только
    // от occupants и floorShape — они в списке.
  }, [drawRect, polyPoints, cursor, drawing, floorShape, constrainDrawing, avoidOccupied, occupants]); // eslint-disable-line

  const onMouseUp = () => {
    if (drawRect && onCanvasDraw) {
      const { x, y, w, h, points } = rectPoints(drawRect);
      // Меньше половины метра по стороне — это промах мышью, а не кабинет.
      if (w >= 0.5 && h >= 0.5) {
        const inside = !constrainDrawing || points.every(p => pointInShape(p, floorShape.points, floorShape.holes));
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

  // Видимая область в метрах. Нужна и сетке, и подложке для панорамирования:
  // после отвязки кадра от холста «весь лист» и «то, что на экране» — разные
  // прямоугольники.
  const port = useMemo(() => ({
    x0: view.x, y0: view.y,
    x1: view.x + viewW / view.scale,
    y1: view.y + viewH / view.scale,
  }), [view, viewW, viewH]);

  const gridLines = useMemo(() => {
    if (!showGrid) return null;
    const step = view.scale > 3 ? 0.5 : view.scale > 1.5 ? 1 : 2;
    const lines = [];
    // Сетка идёт по видимому окну, а не от нуля до края холста. Обрываясь на
    // границе холста, она рисовала на плане лишнюю прямую, которую принимали за
    // стену — при том что за этой «стеной» вполне законно лежит крыло здания.
    for (let x = Math.ceil(port.x0 / step) * step; x <= port.x1; x += step) {
      lines.push(['v', Math.round(x * 100) / 100]);
    }
    for (let y = Math.ceil(port.y0 / step) * step; y <= port.y1; y += step) {
      lines.push(['h', Math.round(y * 100) / 100]);
    }
    return lines;
  }, [showGrid, port, view.scale]);

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
        {/* Подложка на всё видимое поле: панорамировать можно из любой точки.
            Прямоугольника холста на плане больше нет — он изображал вторую,
            главную границу этажа, которой на самом деле не существует. */}
        <rect data-role="bg" x={port.x0} y={port.y0}
              width={port.x1 - port.x0} height={port.y1 - port.y0} fill="transparent" />

        {/* Контур этажа. Произвольный многоугольник, если он задан, иначе
            прямоугольник по габаритам — так выглядят все планы до ver. 6.69. */}
        {outlinePoints ? (
          // evenodd вырезает внутренние дворы прямо в заливке этажа: под дыркой
          // видно поле вокруг плана, а не подкрашенный пол. Отдельная маска для
          // этого не нужна.
          <path data-role="bg" d={shapeToPath(outlinePoints, floorShape.holes)} fillRule="evenodd"
                fill="var(--wh-plan-bg, #fbfcfe)" stroke="#c9d3e0" strokeWidth={0.12 * k}
                strokeLinejoin="round" />
        ) : (
          <rect data-role="bg" x="0" y="0" width={width} height={depth}
                fill="var(--wh-plan-bg, #fbfcfe)" stroke="#c9d3e0" strokeWidth={0.08 * k} />
        )}

        {/* Стена контура как объект выбора. Полоса шириной 0,6 м прозрачна и
            лежит ПОД кабинетами: иначе она перехватывала бы клики у всех комнат,
            стоящих вплотную к стене, то есть почти у всех. Без такой полосы
            контур можно было выбрать только кнопкой на панели, а догадаться, что
            он вообще выбирается, было нельзя. */}
        {mode === 'edit' && outlinePoints && onOutlineClick && !drawing && (
          <path d={shapeToPath(outlinePoints, floorShape.holes)} fill="none" stroke="rgba(0,0,0,0)"
                strokeWidth={0.6 * k} strokeLinejoin="round"
                style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                onMouseDown={(e) => { e.stopPropagation(); onOutlineClick(); }}>
            <title>Контур схемы — выбрать и править вершинами</title>
          </path>
        )}

        {/* Сетка и скан БТИ кликов не ловят. Иначе попадание в волосяную линию
            сетки или в подложку отменяло бы и панорамирование, и выбор контура:
            обработчик фона смотрит на цель события, а целью оказывалась линия. */}
        {gridLines && (
          <g opacity="0.5" style={{ pointerEvents: 'none' }}>
            {gridLines.map(([dir, v], i) => dir === 'v'
              ? <line key={`v${i}`} x1={v} y1={port.y0} x2={v} y2={port.y1} stroke="#dfe6ef" strokeWidth={0.02 * k} />
              : <line key={`h${i}`} x1={port.x0} y1={v} x2={port.x1} y2={v} stroke="#dfe6ef" strokeWidth={0.02 * k} />
            )}
          </g>
        )}

        {/* Подложка: скан поэтажного плана, по которому обводят кабинеты */}
        {floor?.planBgUrl && (
          <image href={floor.planBgUrl} x="0" y="0" width={width} height={depth}
                 opacity={floor.planBgOpacity ?? 0.35} preserveAspectRatio="none"
                 style={{ pointerEvents: 'none' }} />
        )}

        {/* Технические помещения и оформление: коридоры, лестницы, стены, подписи */}
        <g>
          {shapes.map((shape, idx) => {
            const st = SHAPE_STYLE[shape.kind] || SHAPE_STYLE.area;
            const { points: pts, holes: shapeHoles } = ringsOf(shape.geometry);
            if (pts.length < 2) return null;
            const id = shape.id || `tmp-${idx}`;
            const isSel = selectedShapeId === id;
            const editable = mode === 'edit';

            const labelSize = (shape.kind === 'text' ? 0.72 : 0.58) * k;
            // Надпись на плане — не помещение: стен, за которые можно выехать, у
            // неё нет, и вписывать её в собственную рамку незачем.
            const spot = shape.kind === 'text'
              ? {
                ...(shape.geometry?.label || polygonCenter(pts)),
                width: Math.max(polygonBounds(pts).width, 2.5),
                height: polygonBounds(pts).depth,
              }
              : labelSpot(shape.geometry, pts, shapeHoles, labelSize * 1.25);
            // Вертикальный коридор в полтора метра шириной поперёк подписать
            // нечем, а вдоль — свободно; так подписывают коридоры и на бумажных
            // планах. Поэтому у узкого и длинного помещения берётся то
            // направление, в котором от названия остаётся больше: «Коридор»
            // вдоль лучше, чем «Кор…» поперёк. Условие на ширину — чтобы
            // повёрнутая строка не вылезла из коридора уже своей высотой.
            const across = clip(shape.label, spot.width, labelSize);
            const along = spot.height > spot.width * 1.6 && spot.width >= labelSize * 1.25
              ? clip(shape.label, spot.height, labelSize)
              : null;
            const rotated = shape.kind !== 'text' && (along?.length || 0) > (across?.length || 0);
            const labelText = rotated ? along : across;

            return (
              <g key={id}
                 onClick={editable ? (e) => { e.stopPropagation(); onShapeClick?.(id); } : undefined}
                 onMouseDown={editable && !drawing ? (e) => {
                   e.stopPropagation();
                   onShapeClick?.(id);
                   setDrag({ kind: 'shape', shapeId: id, startPlan: toPlan(e) });
                 } : undefined}>
                <title>{[st.label, shape.label].filter(Boolean).join(' · ')}</title>
                {/* Кольцевой коридор — это внешний контур с вырезом посередине.
                    evenodd делает вырез настоящей дыркой: двор внутри «бублика»
                    остаётся не закрашен, и кликнуть по нему коридор нельзя. */}
                <path d={shapeToPath(pts, shapeHoles)} fillRule="evenodd"
                      fill={shape.style?.fill || st.fill}
                      stroke={isSel ? '#1e3a5f' : (shape.style?.stroke || st.stroke)}
                      strokeWidth={(isSel ? 0.14 : 0.06) * k}
                      strokeDasharray={st.dash || undefined}
                      style={{ cursor: editable ? 'move' : 'default' }} />
                {labelText && (
                  <text x={spot.x} y={spot.y} textAnchor="middle" dominantBaseline="middle"
                        transform={rotated ? `rotate(-90 ${spot.x} ${spot.y})` : undefined}
                        fontSize={labelSize}
                        fontWeight={shape.kind === 'text' ? 600 : 400}
                        fill={shape.kind === 'text' ? '#475569' : '#8794a5'}
                        style={{ pointerEvents: 'none' }}>
                    {labelText}
                  </text>
                )}
                {/* Подписи-надписи и линии размеров не имеют: у первых нет площади,
                    у вторых сторона одна, и её длина уже есть на самой линии. */}
                {pts.length >= 3 && shape.kind !== 'text'
                  && (dimensions === 'all' || (dimensions === 'selected' && isSel)) && (
                  <>
                    <Dimensions points={pts} k={k} />
                    {shapeHoles.map((hole, hi) => <Dimensions key={hi} points={hole} k={k} />)}
                  </>
                )}
                {editable && isSel && !drawing && (
                  <VertexHandles geometry={shape.geometry} kind="shape" id={id} k={k} color="#1e3a5f"
                                 onDrag={(ring, i) => setDrag({ kind: 'shapeVertex', shapeId: id, ring, index: i })}
                                 onAdd={pts.length >= 3 ? onVertexAdd : null} onRemove={onVertexRemove} />
                )}
              </g>
            );
          })}
        </g>

        {/* Кабинеты */}
        <g>
          {rooms.map(room => {
            const { points: pts, holes: roomHoles } = ringsOf(room.plan);
            if (pts.length < 3) return null;

            const custom = colorOf ? colorOf(room) : null;
            const zone = ZONE_FILL[room.metricZone || room.zone || 'unknown'] || ZONE_FILL.unknown;
            const fill = custom?.fill || zone.fill;
            const stroke = custom?.stroke || zone.stroke;
            const isSelected = selectedRoomId === room.roomId || selectedRoomId === room.id;
            const isHovered = hoveredRoomId === room.roomId || hoveredRoomId === room.id;
            const id = room.roomId || room.id;

            // Подписи вписываем в место, которое реально есть внутри кабинета.
            // Без этого «МРТ высокого разрешения» и «Смотровая (Хирургия)»
            // выезжают за полигон и наезжают на соседей — на плане это выглядело
            // как каша из букв.
            const numberSize = 0.75 * k;
            const subSize = 0.62 * k;
            const sub = labelOf ? labelOf(room) : null;
            // Строки разнесены на 1,05 k, к этому добавляются их полувысоты —
            // отсюда 1,7 k под две строки и 0,9 k под одну.
            const roomy = labelSpot(room.plan, pts, roomHoles, sub ? 1.7 * k : 0.9 * k);
            // Если места хватило только на строку — остаётся номер: имя кабинета
            // есть в подсказке, а номер на плане не заменить ничем. Место под
            // одну строку ищется заново: в узком кабинете оно шире того, куда
            // пытались уместить две.
            const twoLines = Boolean(sub) && roomy.height >= 1.7 * k;
            const spot = twoLines || !sub ? roomy : labelSpot(room.plan, pts, roomHoles, 0.9 * k);
            const numberText = clip(room.number, spot.width, numberSize);
            const subText = twoLines ? clip(sub, spot.width, subSize) : null;

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
                <path d={shapeToPath(pts, roomHoles)} fillRule="evenodd"
                      fill={fill}
                      stroke={isSelected ? '#1e3a5f' : stroke}
                      strokeWidth={(isSelected ? 0.16 : isHovered ? 0.12 : 0.07) * k}
                      style={{ cursor: mode === 'edit' ? 'move' : 'pointer', transition: 'fill .15s' }} />

                <title>{[room.number, room.name, labelOf ? labelOf(room) : null].filter(Boolean).join(' · ')}</title>

                <text x={spot.x} y={spot.y - (twoLines ? 0.52 * k : 0)} textAnchor="middle" dominantBaseline="middle"
                      fontSize={numberSize} fontWeight="600" fill="#25303f"
                      style={{ pointerEvents: 'none' }}>
                  {numberText}
                </text>
                {subText && (
                  <text x={spot.x} y={spot.y + 0.53 * k} textAnchor="middle" dominantBaseline="middle"
                        fontSize={subSize} fill="#5a6779" style={{ pointerEvents: 'none' }}>
                    {subText}
                  </text>
                )}

                {(dimensions === 'all' || (dimensions === 'selected' && isSelected)) && (
                  <>
                    <Dimensions points={pts} k={k} />
                    {roomHoles.map((hole, hi) => <Dimensions key={hi} points={hole} k={k} />)}
                  </>
                )}

                {/* Ручки вершин — только в редакторе и только у выбранного кабинета.
                    Во время рисования они прячутся: плюс на стене перехватил бы
                    клик, которым ставят точку нового помещения. */}
                {mode === 'edit' && isSelected && !drawing && (
                  <VertexHandles geometry={room.plan} kind="room" id={id} k={k} color="#1e3a5f"
                                 onDrag={(ring, idx) => setDrag({ kind: 'vertex', roomId: id, ring, index: idx })}
                                 onAdd={onVertexAdd} onRemove={onVertexRemove} />
                )}
              </g>
            );
          })}
        </g>

        {/* Ручки контура схемы — только когда его правят, чтобы они не мешали
            обводить кабинеты. */}
        {mode === 'edit' && editOutline && outlinePoints && !drawing && (
          <g>
            <path d={shapeToPath(outlinePoints, floorShape.holes)} fill="none" stroke="#1e3a5f"
                  strokeWidth={0.16 * k} strokeDasharray={`${0.4 * k} ${0.25 * k}`} />
            <VertexHandles geometry={floor?.outline} kind="outline" id={null} k={k} color="#1e3a5f"
                           onDrag={(ring, i) => setDrag({ kind: 'outlineVertex', ring, index: i })}
                           onAdd={onVertexAdd} onRemove={onVertexRemove} />
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
                {drawValid ? 'двойной клик — замкнуть' : 'за пределами схемы'}
              </text>
            )}
          </g>
        )}

        {/* Масштабная линейка: без неё «метры» на плане — пустое слово. Привязана
            к нижнему краю окна просмотра, а не к нижней стене этажа: после
            панорамирования линейка уезжала вместе с планом и пропадала с экрана. */}
        <g transform={`translate(${port.x0 + 0.6 * k}, ${port.y1 - 0.8 * k})`}>
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
                onClick={fitAll}>⤢</button>
      </div>
    </div>
  );
}
