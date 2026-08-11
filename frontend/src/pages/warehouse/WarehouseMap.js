import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Building2, Layers, ChevronRight, RefreshCw, AlertTriangle, Package,
  Wrench, CalendarClock, Boxes, X, ExternalLink, Info,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';
import FloorPlanSvg from '../../components/warehouse/FloorPlanSvg';

/**
 * Карта склада — многоуровневая навигация по сети.
 *
 *   сеть → медцентр (корпуса и этажи) → этаж (план с тепловой картой)
 *
 * Уровни устроены как в игровых картах: не отдельные страницы, а один экран,
 * который «приближается». Отсюда два следствия по реализации: во-первых, состояние
 * уровня живёт в одном объекте и переход — это его замена, без роутинга и
 * перемонтирования; во-вторых, хлебные крошки всегда показывают полный путь, чтобы
 * из любого места было видно, где ты и куда можно вернуться. Разложить это по
 * маршрутам React Router было бы честнее с точки зрения ссылок, но тогда каждый
 * переход перезагружал бы дерево локаций — а оно одно на весь модуль.
 */

const METRIC_HINTS = {
  utilization: 'Часы приёма из МИС, поделённые на суточную ёмкость кабинета. Пересекающиеся приёмы склеиваются: несколько врачей в одном кабинете не дают 200 %.',
  assetValue: 'Первоначальная стоимость оборудования в кабинете. Раскраска по шкале, а не светофором: дорогой кабинет — не «плохой».',
  assetCount: 'Количество единиц оборудования.',
  belowMinimum: 'Позиции, остаток которых ниже минимума.',
  expired: 'Позиции с истёкшим сроком годности.',
  overdueMaint: 'Наряды ТО с просроченной плановой датой.',
  inRepair: 'Оборудование в ремонте.',
  idleAssets: 'Оборудование без учётных операций 14 дней и больше.',
};

export default function WarehouseMap({ access, tree, onReloadTree, onOpenRoom }) {
  // Уровень: { kind: 'network' } | { kind: 'medCenter', mcId } | { kind: 'floor', mcId, buildingId, floorId }
  const [level, setLevel] = useState({ kind: 'network' });
  const [overview, setOverview] = useState([]);
  const [heatmap, setHeatmap] = useState(null);
  const [loading, setLoading] = useState(false);
  const [metric, setMetric] = useState('utilization');
  const [period, setPeriod] = useState(() => {
    const to = new Date();
    const from = new Date(Date.now() - 30 * 86400000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
  const [hoveredRoom, setHoveredRoom] = useState(null);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [roomPanel, setRoomPanel] = useState(null);
  const [recomputing, setRecomputing] = useState(false);

  const medCenters = tree?.medCenters || [];
  const currentMc = useMemo(
    () => medCenters.find(mc => mc.id === level.mcId) || null,
    [medCenters, level.mcId]
  );
  const currentBuilding = useMemo(
    () => currentMc?.buildings?.find(b => b.id === level.buildingId) || null,
    [currentMc, level.buildingId]
  );
  const currentFloor = useMemo(
    () => currentBuilding?.floors?.find(f => f.id === level.floorId) || null,
    [currentBuilding, level.floorId]
  );

  useEffect(() => {
    if (level.kind !== 'network') return;
    warehouseApi.overview()
      .then(({ data }) => setOverview(data))
      .catch(() => toast.error('Не удалось загрузить сводку по сети'));
  }, [level.kind]);

  const loadHeatmap = useCallback(async () => {
    if (level.kind !== 'floor' || !level.floorId) return;
    setLoading(true);
    try {
      const { data } = await warehouseApi.heatmap({
        floorId: level.floorId, from: period.from, to: period.to, metric,
      });
      setHeatmap(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить план этажа');
    } finally {
      setLoading(false);
    }
  }, [level.kind, level.floorId, period.from, period.to, metric]);

  useEffect(() => { loadHeatmap(); }, [loadHeatmap]);

  const openRoomPanel = async (roomId) => {
    setSelectedRoom(roomId);
    try {
      const { data } = await warehouseApi.roomDashboard(roomId);
      setRoomPanel(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Нет доступа к кабинету');
      setSelectedRoom(null);
    }
  };

  const recompute = async () => {
    setRecomputing(true);
    try {
      const { data } = await warehouseApi.recomputeUtilization({ from: period.from, to: period.to });
      if (data.warning) toast(data.warning, { icon: '⚠️', duration: 8000 });
      else toast.success(`Пересчитано дней: ${data.days}, кабинетов: ${data.rooms}`);
      await loadHeatmap();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Пересчёт не удался');
    } finally {
      setRecomputing(false);
    }
  };

  // ── Раскраска по шкале для стоимости и количества ──────────────────────────
  // Светофор здесь не подходит: «дорого» — не проблема. Считаем максимум по этажу
  // и красим насыщенностью одного цвета.
  const scaleMax = useMemo(() => {
    if (!heatmap || !['assetValue', 'assetCount'].includes(metric)) return 0;
    return Math.max(...heatmap.rooms.map(r => Number(r.metricValue) || 0), 1);
  }, [heatmap, metric]);

  const colorOf = useCallback((room) => {
    if (!['assetValue', 'assetCount'].includes(metric)) return null;
    const v = Number(room.metricValue) || 0;
    if (!v) return { fill: '#f2f4f7', stroke: '#c9d3e0' };
    const t = Math.min(1, v / scaleMax);
    // Один тон, разная светлота: шкала должна читаться и в чёрно-белой печати.
    const light = 92 - t * 42;
    return { fill: `hsl(214 62% ${light}%)`, stroke: 'hsl(214 45% 45%)' };
  }, [metric, scaleMax]);

  const labelOf = useCallback((room) => {
    const v = room.metricValue;
    if (v === null || v === undefined) return 'нет данных';
    if (metric === 'utilization') return `${Number(v).toFixed(0)} %`;
    if (metric === 'assetValue') return v ? `${(Number(v) / 1000).toFixed(0)} тыс.` : '—';
    return String(v);
  }, [metric]);

  // ── Уровень 1: сеть ────────────────────────────────────────────────────────
  if (level.kind === 'network') {
    const withData = overview.filter(o => o.buildings > 0);
    const withoutData = overview.filter(o => o.buildings === 0);

    return (
      <div className="wh-map">
        <Breadcrumbs items={[{ label: 'Сеть' }]} />
        <div className="wh-map__grid">
          {withData.map(mc => (
            <button key={mc.id} className="wh-mc-card"
                    onClick={() => setLevel({ kind: 'medCenter', mcId: mc.id })}>
              <div className="wh-mc-card__head">
                {mc.logoUrl
                  ? <img src={mc.logoUrl} alt="" className="wh-mc-card__logo" />
                  : <span className="wh-mc-card__dot" style={{ background: mc.color || '#94a3b8' }} />}
                <div>
                  <div className="wh-mc-card__name">{mc.displayName || mc.name}</div>
                  {mc.city && <div className="wh-mc-card__city">{mc.city}</div>}
                </div>
              </div>
              <div className="wh-mc-card__stats">
                <Stat icon={<Building2 size={14} />} value={mc.buildings} label="корпус" />
                <Stat icon={<Layers size={14} />} value={mc.floors} label="этаж" />
                <Stat icon={<Boxes size={14} />} value={mc.rooms} label="кабинет" />
                <Stat icon={<Package size={14} />} value={mc.assets} label="ед. ОС" />
              </div>
              <div className="wh-mc-card__foot">
                <span>{(Number(mc.assetValue) / 1e6).toFixed(1)} млн ₽</span>
                {mc.overdueMaintenance > 0 && (
                  <span className="wh-badge wh-badge--red">
                    <AlertTriangle size={12} /> ТО просрочено: {mc.overdueMaintenance}
                  </span>
                )}
              </div>
              <ChevronRight size={18} className="wh-mc-card__arrow" />
            </button>
          ))}
        </div>

        {withoutData.length > 0 && (
          <div className="wh-note">
            <Info size={15} />
            <div>
              Модуль ещё не развёрнут: {withoutData.map(m => m.displayName || m.name).join(', ')}.
              {access?.capabilities?.canEditLocations
                ? ' Добавьте корпус и этажи во вкладке «Локации».'
                : ' Обратитесь к администратору модуля.'}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Уровень 2: медцентр, корпуса и этажи ───────────────────────────────────
  if (level.kind === 'medCenter') {
    return (
      <div className="wh-map">
        <Breadcrumbs items={[
          { label: 'Сеть', onClick: () => setLevel({ kind: 'network' }) },
          { label: currentMc?.name || '—' },
        ]} />

        {(currentMc?.buildings || []).map(building => (
          <div key={building.id} className="wh-building">
            <div className="wh-building__head">
              <Building2 size={17} />
              <div>
                <div className="wh-building__name">{building.name}</div>
                {building.address && <div className="wh-building__addr">{building.address}</div>}
              </div>
            </div>
            <div className="wh-building__floors">
              {building.floors.map(floor => {
                const rooms = floor.rooms || [];
                const assets = rooms.reduce((s, r) => s + (r.counters?.assets || 0), 0);
                const withPlan = rooms.filter(r => r.hasPlan).length;
                return (
                  <button key={floor.id} className="wh-floor-card"
                          onClick={() => setLevel({
                            kind: 'floor', mcId: currentMc.id, buildingId: building.id, floorId: floor.id,
                          })}>
                    <div className="wh-floor-card__num">{floor.number}</div>
                    <div className="wh-floor-card__body">
                      <div className="wh-floor-card__name">{floor.name || `${floor.number} этаж`}</div>
                      <div className="wh-floor-card__meta">
                        {rooms.length} каб. · {assets} ед. ОС
                      </div>
                      {/* Кабинеты без геометрии на плане не появятся — говорим об
                          этом здесь, а не оставляем гадать, почему план пустой. */}
                      {withPlan < rooms.length && (
                        <div className="wh-floor-card__warn">
                          без плана: {rooms.length - withPlan}
                        </div>
                      )}
                    </div>
                    <MiniPlan floor={floor} rooms={rooms} />
                  </button>
                );
              })}
              {!building.floors.length && (
                <div className="wh-empty-inline">Этажи не заведены</div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Уровень 3: этаж, план и тепловая карта ─────────────────────────────────
  const metricInfo = (heatmap?.metrics || []).find(m => m.key === metric);
  const coverage = heatmap?.coverage;
  const noUtilData = metric === 'utilization' && coverage && coverage.withData === 0;

  return (
    <div className="wh-map">
      <Breadcrumbs items={[
        { label: 'Сеть', onClick: () => setLevel({ kind: 'network' }) },
        { label: currentMc?.name || '—', onClick: () => setLevel({ kind: 'medCenter', mcId: level.mcId }) },
        { label: currentBuilding?.name || '—' },
        { label: currentFloor ? (currentFloor.name || `${currentFloor.number} этаж`) : '—' },
      ]} />

      <div className="wh-map__toolbar">
        <div className="wh-field">
          <label>Показатель</label>
          <select value={metric} onChange={e => setMetric(e.target.value)}>
            {(heatmap?.metrics || []).map(m => (
              <option key={m.key} value={m.key}>{m.title}</option>
            ))}
          </select>
        </div>
        <div className="wh-field">
          <label>Период</label>
          <div className="wh-field__row">
            <input type="date" value={period.from} onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))} />
            <input type="date" value={period.to} onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))} />
          </div>
        </div>
        {access?.capabilities?.canEditPlans && (
          <button className="wh-btn wh-btn--ghost" onClick={recompute} disabled={recomputing}>
            <RefreshCw size={15} className={recomputing ? 'wh-spin' : ''} /> Пересчитать загрузку
          </button>
        )}
      </div>

      {metricInfo && (
        <div className="wh-note wh-note--subtle">
          <Info size={15} />
          <div>{METRIC_HINTS[metric] || metricInfo.title}</div>
        </div>
      )}

      {noUtilData && (
        <div className="wh-note wh-note--warn">
          <AlertTriangle size={15} />
          <div>
            За выбранный период загрузка не рассчитана ни по одному кабинету. Обычная
            причина — кабинеты не сопоставлены с названиями из МИС, либо кэш расписания
            (<code>mis_appointments</code>) не покрывает этот период. Кабинеты без данных
            показаны серым, а не нулём: ноль означал бы «кабинет простаивал».
          </div>
        </div>
      )}

      <div className="wh-floor-view">
        {/* Вертикальный переключатель этажей — как в многоуровневых картах: этаж
            меняется, кадр и выбранный показатель остаются. */}
        <div className="wh-floor-switch">
          {(currentBuilding?.floors || []).slice().reverse().map(f => (
            <button key={f.id}
                    className={`wh-floor-switch__btn ${f.id === level.floorId ? 'is-active' : ''}`}
                    title={f.name || `${f.number} этаж`}
                    onClick={() => setLevel(prev => ({ ...prev, floorId: f.id }))}>
              {f.number}
            </button>
          ))}
        </div>

        <div className="wh-floor-view__plan">
          {loading && <div className="wh-plan-loading"><div className="loading-spinner" /></div>}
          {heatmap && (
            <FloorPlanSvg
              floor={heatmap.floor}
              rooms={heatmap.rooms}
              shapes={heatmap.shapes}
              mode="heatmap"
              selectedRoomId={selectedRoom}
              hoveredRoomId={hoveredRoom}
              colorOf={colorOf}
              labelOf={labelOf}
              onRoomHover={setHoveredRoom}
              onRoomClick={openRoomPanel}
              height={600}
            />
          )}

          <div className="wh-legend">
            {['assetValue', 'assetCount'].includes(metric) ? (
              <>
                <span className="wh-legend__scale" />
                <span>0 → {metric === 'assetValue' ? `${(scaleMax / 1000).toFixed(0)} тыс. ₽` : scaleMax}</span>
              </>
            ) : metric === 'utilization' ? (
              <>
                <LegendItem color="#d7f0dd" label="< 60 % недозагружен" />
                <LegendItem color="#fdf0c8" label="60–85 % норма" />
                <LegendItem color="#fbd8d8" label="> 85 % перегружен" />
                <LegendItem color="#eef1f5" label="нет данных" />
              </>
            ) : (
              <>
                <LegendItem color="#d7f0dd" label="нет проблем" />
                <LegendItem color="#fdf0c8" label="1–2" />
                <LegendItem color="#fbd8d8" label="3 и больше" />
              </>
            )}
            {coverage && (
              <span className="wh-legend__coverage">
                кабинетов: {coverage.total} · на плане: {coverage.withGeometry}
                {metric === 'utilization' && ` · с расчётом: ${coverage.withData}`}
              </span>
            )}
          </div>
        </div>

        {/* Панель кабинета */}
        {roomPanel && (
          <RoomPanel data={roomPanel}
                     canSeeCosts={access?.capabilities?.canSeeCosts}
                     onClose={() => { setRoomPanel(null); setSelectedRoom(null); }}
                     onOpenFull={() => onOpenRoom?.(roomPanel.room.id)} />
        )}
      </div>
    </div>
  );
}

// ── Вспомогательные компоненты ───────────────────────────────────────────────

function Breadcrumbs({ items }) {
  return (
    <div className="wh-crumbs">
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight size={14} className="wh-crumbs__sep" />}
          {item.onClick
            ? <button className="wh-crumbs__link" onClick={item.onClick}>{item.label}</button>
            : <span className="wh-crumbs__current">{item.label}</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

function Stat({ icon, value, label }) {
  return (
    <div className="wh-stat">
      {icon}
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function LegendItem({ color, label }) {
  return (
    <span className="wh-legend__item">
      <i style={{ background: color }} />{label}
    </span>
  );
}

/**
 * Миниатюра плана на карточке этажа. Без интерактива и без зума: её задача —
 * дать узнать этаж по форме, а не показать данные.
 */
function MiniPlan({ floor, rooms }) {
  const w = Number(floor.planWidthM) || 40;
  const h = Number(floor.planHeightM) || 25;
  const withPlan = rooms.filter(r => Array.isArray(r.plan?.points) && r.plan.points.length >= 3);
  if (!withPlan.length) return <div className="wh-miniplan wh-miniplan--empty">нет плана</div>;

  return (
    <svg className="wh-miniplan" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width={w} height={h} fill="#f7f9fc" stroke="#dbe2ea" strokeWidth="0.15" />
      {withPlan.map(r => (
        <path key={r.id}
              d={r.plan.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z'}
              fill="#cfdcef" stroke="#8ea6c8" strokeWidth="0.12" />
      ))}
    </svg>
  );
}

function RoomPanel({ data, onClose, onOpenFull, canSeeCosts }) {
  const { room, cards, assets, attention } = data;
  return (
    <aside className="wh-room-panel">
      <div className="wh-room-panel__head">
        <div>
          <div className="wh-room-panel__title">Каб. {room.number}</div>
          <div className="wh-room-panel__sub">{room.name && room.name !== room.number ? room.name : ''}</div>
          <div className="wh-room-panel__path">{room.path}</div>
        </div>
        <button className="wh-icon-btn" onClick={onClose}><X size={18} /></button>
      </div>

      <div className="wh-room-panel__cards">
        <MiniCard icon={<Package size={14} />} title="Оборудование"
                  value={cards.assets.total}
                  sub={`${cards.assets.inUse} в работе · ${cards.assets.repair} в ремонте`} />
        <MiniCard icon={<Boxes size={14} />} title="Материалы"
                  value={cards.materials.positions}
                  sub={canSeeCosts
                    ? `${cards.materials.value.toLocaleString('ru-RU')} ₽`
                    : `${cards.materials.belowMin} ниже минимума`}
                  danger={cards.materials.belowMin > 0} />
        <MiniCard icon={<CalendarClock size={14} />} title="Сроки"
                  value={cards.expiry.expired + cards.expiry.within30}
                  sub={`${cards.expiry.expired} просрочено`}
                  danger={cards.expiry.expired > 0} />
        <MiniCard icon={<Wrench size={14} />} title="ТО"
                  value={cards.maintenance.open}
                  sub={cards.maintenance.overdue > 0
                    ? `${cards.maintenance.overdue} просрочено`
                    : cards.maintenance.nextDate
                      ? new Date(cards.maintenance.nextDate).toLocaleDateString('ru-RU')
                      : 'нет нарядов'}
                  danger={cards.maintenance.overdue > 0} />
      </div>

      <div className="wh-room-panel__util">
        Загрузка:{' '}
        {cards.utilization.hasData
          ? <b className={`wh-zone wh-zone--${cards.utilization.zone}`}>{cards.utilization.percent} %</b>
          : <span className="wh-muted">не рассчитана</span>}
      </div>

      {attention.length > 0 && (
        <div className="wh-room-panel__section">
          <h4>Требуют внимания</h4>
          <ul className="wh-attention">
            {attention.slice(0, 8).map((a, i) => (
              <li key={i} className={`wh-attention__item wh-attention__item--${a.level}`}>{a.text}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="wh-room-panel__section">
        <h4>Оборудование</h4>
        <ul className="wh-asset-list">
          {assets.slice(0, 12).map(a => (
            <li key={a.id}>
              <span className={`wh-dot wh-dot--${a.status}`} />
              <span className="wh-asset-list__name">{a.name}</span>
              <span className="wh-asset-list__num">{a.inventoryNumber}</span>
            </li>
          ))}
          {!assets.length && <li className="wh-muted">Оборудование не закреплено</li>}
        </ul>
      </div>

      <button className="wh-btn wh-btn--primary wh-btn--wide" onClick={onOpenFull}>
        <ExternalLink size={15} /> Открыть дашборд кабинета
      </button>
    </aside>
  );
}

function MiniCard({ icon, title, value, sub, danger }) {
  return (
    <div className={`wh-minicard ${danger ? 'is-danger' : ''}`}>
      <div className="wh-minicard__head">{icon}<span>{title}</span></div>
      <div className="wh-minicard__value">{value}</div>
      <div className="wh-minicard__sub">{sub}</div>
    </div>
  );
}
