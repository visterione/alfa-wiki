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

const SHAPE_STYLE = {
  corridor: { fill: '#eef2f7', stroke: '#cbd5e1', dash: null },
  wall:     { fill: '#94a3b8', stroke: '#64748b', dash: null },
  door:     { fill: '#ffffff', stroke: '#94a3b8', dash: '0.2 0.2' },
  stairs:   { fill: '#dde3ec', stroke: '#94a3b8', dash: null },
  elevator: { fill: '#e2e8f0', stroke: '#94a3b8', dash: null },
  area:     { fill: '#f5f7fa', stroke: '#dbe1e8', dash: '0.3 0.2' },
  text:     { fill: 'transparent', stroke: 'transparent', dash: null },
};

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
  hoveredRoomId = null,
  colorOf = null,                // (room) => {fill, stroke} — переопределяет зону
  labelOf = null,                // (room) => string — вторая строка подписи
  onRoomClick = null,
  onRoomHover = null,
  onVertexDrag = null,           // (roomId, vertexIndex, [x, y])
  onRoomMove = null,             // (roomId, dx, dy)
  onCanvasDraw = null,           // (rect) — завершение рисования нового кабинета
  drawing = false,
  showGrid = false,
  height = 560,
}) {
  const svgRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [drag, setDrag] = useState(null);
  const [drawRect, setDrawRect] = useState(null);

  const width = Number(floor?.planWidthM) || 40;
  const depth = Number(floor?.planHeightM) || 25;

  // Сброс камеры при смене этажа: иначе на новом плане остаётся кадр от старого,
  // и пользователь смотрит в пустоту рядом с домом.
  useEffect(() => {
    setView({ x: 0, y: 0, scale: 1 });
  }, [floor?.id]);

  /** Экранные координаты события → метры плана. */
  const toPlan = useCallback((evt) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const px = (evt.clientX - rect.left) / rect.width;
    const py = (evt.clientY - rect.top) / rect.height;
    const vbW = width / view.scale;
    const vbH = depth / view.scale;
    return { x: view.x + px * vbW, y: view.y + py * vbH };
  }, [width, depth, view]);

  const snap = v => Math.round(v / GRID_STEP) * GRID_STEP;

  const handleWheel = useCallback((evt) => {
    evt.preventDefault();
    const factor = evt.deltaY > 0 ? 1 / 1.15 : 1.15;
    setView(prev => {
      const nextScale = Math.min(8, Math.max(0.5, prev.scale * factor));
      // Зум к курсору, а не к центру: иначе при приближении нужный кабинет
      // уезжает за край и его приходится искать панорамированием.
      const svg = svgRef.current;
      if (!svg) return { ...prev, scale: nextScale };
      const rect = svg.getBoundingClientRect();
      const px = (evt.clientX - rect.left) / rect.width;
      const py = (evt.clientY - rect.top) / rect.height;
      const cursorX = prev.x + px * (width / prev.scale);
      const cursorY = prev.y + py * (depth / prev.scale);
      return {
        scale: nextScale,
        x: cursorX - px * (width / nextScale),
        y: cursorY - py * (depth / nextScale),
      };
    });
  }, [width, depth]);

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

    if (drawing && mode === 'edit') {
      setDrawRect({ x0: snap(pos.x), y0: snap(pos.y), x1: snap(pos.x), y1: snap(pos.y) });
      return;
    }
    // Панорамирование — с зажатым пробелом/средней кнопкой было бы привычнее, но
    // на плане нет текста для выделения, поэтому просто тянем фон.
    if (evt.target === svgRef.current || evt.target.dataset?.role === 'bg') {
      setDrag({ kind: 'pan', startX: evt.clientX, startY: evt.clientY, origin: { ...view } });
    }
  };

  const onMouseMove = (evt) => {
    if (drawRect) {
      const pos = toPlan(evt);
      setDrawRect(prev => ({ ...prev, x1: snap(pos.x), y1: snap(pos.y) }));
      return;
    }
    if (!drag) return;

    if (drag.kind === 'pan') {
      const svg = svgRef.current;
      const rect = svg.getBoundingClientRect();
      const dx = ((evt.clientX - drag.startX) / rect.width) * (width / view.scale);
      const dy = ((evt.clientY - drag.startY) / rect.height) * (depth / view.scale);
      setView({ ...drag.origin, x: drag.origin.x - dx, y: drag.origin.y - dy });
      return;
    }
    if (drag.kind === 'vertex' && onVertexDrag) {
      const pos = toPlan(evt);
      onVertexDrag(drag.roomId, drag.index, [snap(pos.x), snap(pos.y)]);
      return;
    }
    if (drag.kind === 'room' && onRoomMove) {
      const pos = toPlan(evt);
      const dx = snap(pos.x - drag.startPlan.x);
      const dy = snap(pos.y - drag.startPlan.y);
      if (dx !== 0 || dy !== 0) {
        onRoomMove(drag.roomId, dx, dy);
        setDrag({ ...drag, startPlan: { x: drag.startPlan.x + dx, y: drag.startPlan.y + dy } });
      }
    }
  };

  const onMouseUp = () => {
    if (drawRect && onCanvasDraw) {
      const x = Math.min(drawRect.x0, drawRect.x1);
      const y = Math.min(drawRect.y0, drawRect.y1);
      const w = Math.abs(drawRect.x1 - drawRect.x0);
      const h = Math.abs(drawRect.y1 - drawRect.y0);
      // Меньше половины метра по стороне — это промах мышью, а не кабинет.
      if (w >= 0.5 && h >= 0.5) onCanvasDraw({ x, y, w, h });
    }
    setDrawRect(null);
    setDrag(null);
  };

  const viewBox = useMemo(
    () => `${view.x} ${view.y} ${width / view.scale} ${depth / view.scale}`,
    [view, width, depth]
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
        className={`wh-plan__svg ${drawing ? 'wh-plan__svg--draw' : ''} ${drag?.kind === 'pan' ? 'wh-plan__svg--panning' : ''}`}
      >
        {/* Контур этажа */}
        <rect data-role="bg" x="0" y="0" width={width} height={depth}
              fill="var(--wh-plan-bg, #fbfcfe)" stroke="#c9d3e0" strokeWidth={0.08 * k} />

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

        {/* Оформление: коридоры, лестницы, подписи */}
        <g>
          {shapes.map(shape => {
            const st = SHAPE_STYLE[shape.kind] || SHAPE_STYLE.area;
            const pts = shape.geometry?.points;
            const center = polygonCenter(pts || []);
            return (
              <g key={shape.id || `${shape.kind}-${center.x}-${center.y}`}>
                {pts && (
                  <path d={pointsToPath(pts)}
                        fill={shape.style?.fill || st.fill}
                        stroke={shape.style?.stroke || st.stroke}
                        strokeWidth={0.06 * k}
                        strokeDasharray={st.dash || undefined} />
                )}
                {shape.label && (
                  <text x={center.x} y={center.y} textAnchor="middle" dominantBaseline="middle"
                        fontSize={0.6 * k} fill="#8794a5" style={{ pointerEvents: 'none' }}>
                    {shape.label}
                  </text>
                )}
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

        {/* Рамка нового кабинета */}
        {drawRect && (
          <rect x={Math.min(drawRect.x0, drawRect.x1)} y={Math.min(drawRect.y0, drawRect.y1)}
                width={Math.abs(drawRect.x1 - drawRect.x0)} height={Math.abs(drawRect.y1 - drawRect.y0)}
                fill="rgba(30,58,95,.12)" stroke="#1e3a5f" strokeWidth={0.08 * k}
                strokeDasharray={`${0.3 * k} ${0.2 * k}`} />
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
                onClick={() => setView({ x: 0, y: 0, scale: 1 })}>⤢</button>
      </div>
    </div>
  );
}
