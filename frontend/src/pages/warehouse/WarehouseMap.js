import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Layers, ChevronRight, RefreshCw, AlertTriangle, Package,
  Wrench, CalendarClock, Boxes, X, ExternalLink,
  Home, PencilRuler,
} from 'lucide-react';
import { warehouseApi } from '../../services/api';
import FloorPlanSvg from '../../components/warehouse/FloorPlanSvg';
import FloorPlanEditor from './FloorPlanEditor';

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

export default function WarehouseMap({ access, tree, onReloadTree, onOpenRoom }) {
  // Уровень: { kind: 'network' } | { kind: 'medCenter', mcId }
  //        | { kind: 'floor', mcId, floorId }
  //        | { kind: 'scheme', mcId } — общая схема медцентра без корпусов и этажей
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
  // Редактор планов — не соседняя вкладка, а тот же экран в режиме правки:
  // { mcId?, floorId? } | null. Отдельная вкладка «Планы помещений»
  // заставляла второй раз выбирать селектами тот медцентр и этаж, на который
  // человек уже смотрит на карте, и по возвращении карта ничего не знала о
  // правках. Пустой объект — вход без предвыбора, как было у вкладки.
  const [editing, setEditing] = useState(null);

  const medCenters = tree?.medCenters || [];
  const canSeeCosts = access?.capabilities?.canSeeCosts;
  const canEditPlans = access?.capabilities?.canEditPlans;
  const currentMc = useMemo(
    () => medCenters.find(mc => mc.id === level.mcId) || null,
    [medCenters, level.mcId]
  );
  // Сводка по сети даёт цифры для карточек, дерево — структуру площадки: по нему
  // решается, открывать медцентр списком корпусов или сразу общей схемой.
  const treeById = useMemo(() => new Map(medCenters.map(mc => [mc.id, mc])), [medCenters]);
  // Этажи лежат прямо у медцентра (ver. 7.48): уровень корпуса убран.
  const mcFloors = useMemo(() => currentMc?.floors || [], [currentMc]);
  const currentFloor = useMemo(
    () => mcFloors.find(f => f.id === level.floorId) || null,
    [mcFloors, level.floorId]
  );

  useEffect(() => {
    if (level.kind !== 'network') return;
    warehouseApi.overview()
      .then(({ data }) => setOverview(data))
      .catch(() => toast.error('Не удалось загрузить сводку по сети'));
  }, [level.kind]);

  const loadHeatmap = useCallback(async () => {
    // Общая схема медцентра запрашивается тем же отчётом, только по medCenterId:
    // это такая же схема с контуром, фигурами и кабинетами, просто у неё нет
    // этажа. Отдельный запрос завёл бы вторую тепловую карту со своими порогами.
    const params = level.kind === 'floor' && level.floorId ? { floorId: level.floorId }
      : level.kind === 'scheme' && level.mcId ? { medCenterId: level.mcId }
      : null;
    if (!params) return;

    setLoading(true);
    try {
      const { data } = await warehouseApi.heatmap({ ...params, from: period.from, to: period.to, metric });
      setHeatmap(data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось загрузить план');
    } finally {
      setLoading(false);
    }
  }, [level.kind, level.floorId, level.mcId, period.from, period.to, metric]);

  useEffect(() => { loadHeatmap(); }, [loadHeatmap]);

  /**
   * Открыть медцентр.
   *
   * Промежуточный экран со списком корпусов нужен, только когда есть из чего
   * выбирать. У небольшого МЦ помещения лежат прямо в медцентре, корпусов нет
   * вовсе — и весь уровень вырождался в список кнопок с номерами кабинетов
   * вместо нарисованного плана. Схема в таком случае открывается сразу.
   */
  const openMedCenter = (mcId) => {
    const mc = treeById.get(mcId);
    const hasFloors = (mc?.floors || []).length > 0;
    const hasScheme = (mc?.rooms || []).length > 0;
    setLevel(!hasFloors && hasScheme ? { kind: 'scheme', mcId } : { kind: 'medCenter', mcId });
  };

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

  // ── Режим правки планов ────────────────────────────────────────────────────
  // Стоит до разбора уровней, но после всех хуков: редактор подменяет содержимое
  // карты целиком, а уровень под ним сохраняется — выход возвращает туда, откуда
  // вошли. Геометрия за время правки могла измениться, поэтому тепловая карта
  // перечитывается на выходе.
  if (editing) {
    return (
      <FloorPlanEditor tree={tree}
                       departments={tree?.departments}
                       initialSelection={editing}
                       onReloadTree={onReloadTree}
                       onExit={() => { setEditing(null); loadHeatmap(); }} />
    );
  }

  // ── Уровень 1: сеть ────────────────────────────────────────────────────────
  if (level.kind === 'network') {
    // Сводка больше не считает корпуса (ver. 7.48): показываем медцентры, где
    // заведён хоть один этаж или кабинет.
    const withData = overview.filter(o => o.floors > 0 || o.rooms > 0);
    return (
      <div className="wh-map">
        <div className="wh-map__head">
          <h2>Медцентры</h2>
          {/* Вход в редактор без предвыбора — то же, чем была вкладка «Планы
              помещений». Нужен именно здесь: пока у площадки нет ни корпуса, ни
              этажа, войти в правку «с плана» ещё неоткуда. */}
          {canEditPlans && (
            <button className="wh-btn wh-btn--secondary" onClick={() => setEditing({})}>
              <PencilRuler size={15} /> Планы помещений
            </button>
          )}
        </div>
        <div className="wh-map__grid">
          {withData.map(mc => (
            <MedCenterCard key={mc.id}
                           mc={mc}
                           canSeeCosts={canSeeCosts}
                           onOpen={() => openMedCenter(mc.id)} />
          ))}
          {!withData.length && (
            <div className="wh-empty">Ни в одном медцентре не заведены кабинеты</div>
          )}
        </div>
      </div>
    );
  }

  // ── Уровень 2: медцентр и его этажи ────────────────────────────────────────
  if (level.kind === 'medCenter') {
    const floors = currentMc?.floors || [];
    const directRooms = currentMc?.rooms || [];
    const totals = floors.reduce((acc, f) => {
      acc.floors += 1;
      for (const r of f.rooms || []) {
        acc.rooms += 1;
        acc.assets += r.counters?.assets || 0;
      }
      return acc;
    }, {
      floors: 0,
      rooms: directRooms.length,
      assets: directRooms.reduce((sum, r) => sum + (r.counters?.assets || 0), 0),
    });

    return (
      <div className="wh-map">
        <Breadcrumbs items={[
          { icon: <Home size={14} />, title: 'Все медцентры', onClick: () => setLevel({ kind: 'network' }) },
          { label: currentMc?.name || '—' },
        ]} />

        <header className="wh-site__head">
          <span className="wh-site__mark" style={{ '--mc-accent': currentMc?.color || '#3b82f6' }}>
            {currentMc?.logoUrl
              ? <img src={currentMc.logoUrl} alt="" />
              : <b>{initials(currentMc?.name)}</b>}
          </span>
          <div className="wh-site__id">
            <h2>{currentMc?.name || '—'}</h2>
            {currentMc?.city && <div className="wh-site__city">{currentMc.city}</div>}
          </div>
          <dl className="wh-spec wh-spec--wide">
            <SpecItem label="Этажи" value={totals.floors} />
            <SpecItem label="Кабинеты" value={totals.rooms} />
            <SpecItem label="Ед. ОС" value={totals.assets} />
          </dl>
          {canEditPlans && (
            <button className="wh-btn wh-btn--secondary"
                    onClick={() => setEditing({ mcId: level.mcId })}>
              <PencilRuler size={15} /> Планы
            </button>
          )}
        </header>

        {floors.length > 0 && (
          <FloorsSection floors={floors}
                         onOpenFloor={floorId => setLevel({
                           kind: 'floor', mcId: currentMc.id, floorId,
                         })} />
        )}

        {directRooms.length > 0 && (
          <SchemeSection medCenter={currentMc} rooms={directRooms}
                         onOpen={() => setLevel({ kind: 'scheme', mcId: level.mcId })} />
        )}

        {!floors.length && !directRooms.length && (
          <div className="wh-empty">В этом медцентре не заведено ни одного кабинета</div>
        )}
      </div>
    );
  }

  // ── Уровень 3: план и тепловая карта ───────────────────────────────────────
  // Этаж и общая схема медцентра рисуются одним и тем же экраном: различаются они
  // только тем, есть ли между чем переключаться слева.
  const isScheme = level.kind === 'scheme';
  const coverage = heatmap?.coverage;
  const noUtilData = metric === 'utilization' && coverage && coverage.withData === 0;

  return (
    <div className="wh-map">
      <Breadcrumbs items={[
        { icon: <Home size={14} />, title: 'Все медцентры', onClick: () => setLevel({ kind: 'network' }) },
        { label: currentMc?.name || '—', onClick: () => openMedCenter(level.mcId) },
        ...(isScheme
          ? [{ label: 'Общая схема' }]
          : [
              { label: currentFloor
                ? `${currentFloor.number} этаж${currentFloor.name ? ` — ${currentFloor.name}` : ''}`
                : '—' },
            ]),
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
        {canEditPlans && (
          <div className="wh-map__toolbar-actions">
            {/* Правка открывается ровно на том плане, который сейчас на экране:
                медцентр и этаж уже выбраны, повторять выбор не нужно. */}
            <button className="wh-btn wh-btn--secondary"
                    onClick={() => setEditing({
                      mcId: level.mcId,
                      floorId: isScheme ? null : level.floorId,
                    })}>
              <PencilRuler size={15} /> Редактировать план
            </button>
            <button className="wh-btn wh-btn--ghost" onClick={recompute} disabled={recomputing}>
              <RefreshCw size={15} className={recomputing ? 'wh-spin' : ''} /> Пересчитать загрузку
            </button>
          </div>
        )}
      </div>

      {noUtilData && (
        <div className="wh-note wh-note--warn">
          <AlertTriangle size={15} />
          <div>
            За период загрузка не рассчитана ни по одному кабинету: кабинеты не
            сопоставлены с МИС либо нет расписания за этот период.
          </div>
        </div>
      )}

      <div className="wh-floor-view">
        {/* Вертикальный переключатель этажей — как в многоуровневых картах: этаж
            меняется, кадр и выбранный показатель остаются. У общей схемы этажей
            нет, и пустая колонка кнопок только отнимала бы место. */}
        <div className="wh-floor-switch">
          {(isScheme ? [] : mcFloors).slice().reverse().map(f => (
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
            ? <button className="wh-crumbs__link" onClick={item.onClick} title={item.title}>
                {item.icon || item.label}
              </button>
            : <span className="wh-crumbs__current">{item.label}</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Карточка медцентра на верхнем уровне.
 *
 * Карточка здесь — кнопка перехода, а не отчёт, поэтому на ней ровно то, что нужно
 * для выбора: какая это площадка, насколько она большая и есть ли на ней беда.
 *
 * До этого середину занимал силуэт площадки — башни из блоков, где высота была
 * числом этажей, а ширина блока числом кабинетов на этаже. Двойное кодирование в
 * фигуре размером с ноготь не читалось: ширину принимали за загрузку этажа.
 * Настоящая структура — с именами корпусов, номерами этажей и миниатюрами планов —
 * рисуется уровнем ниже, и дублировать её намёком не за чем.
 *
 * Крупных чисел ровно два. Третьим стояла стоимость, и в колонке шириной 90 px
 * обрезались и она сама («34,7 м…»), и подпись («ОБОРУДОВ…»). Стоимость ушла в
 * подвал строкой: право на неё есть не у всех, и первым делом на карточку смотрят
 * не за ней. Просроченное ТО поднято в шапку значком — это единственное, на что
 * с этого экрана реагируют, и внизу карточки оно попадалось на глаза последним.
 */
function MedCenterCard({ mc, canSeeCosts, onOpen }) {
  const overdue = Number(mc.overdueMaintenance) || 0;
  // Этажей может не быть вовсе (помещения лежат прямо в медцентре) — тогда в
  // строке остаётся только то, что есть, а не «0 этажей». Корпуса из сводки
  // ушли вместе с самим уровнем (ver. 7.48).
  const structure = [
    mc.floors > 0 && `${mc.floors} ${plural(mc.floors, 'этаж', 'этажа', 'этажей')}`,
    mc.rooms > 0 && `${mc.rooms} ${plural(mc.rooms, 'кабинет', 'кабинета', 'кабинетов')}`,
  ].filter(Boolean).join(' · ');

  return (
    <button className="wh-mc" onClick={onOpen}
            style={{ '--mc-accent': mc.color || '#3b82f6' }}>
      <div className="wh-mc__top">
        <span className="wh-mc__mark">
          {mc.logoUrl ? <img src={mc.logoUrl} alt="" /> : <b>{initials(mc.displayName || mc.name)}</b>}
        </span>
        <span className="wh-mc__id">
          <span className="wh-mc__name">{mc.displayName || mc.name}</span>
          {/* Города просто нет, если он не заполнен. Прежняя подпись «город не
              указан» сообщала об отсутствии данных, которых на этом экране никто
              не ищет, и занимала строку у каждой площадки без города. */}
          {mc.city && <span className="wh-mc__city">{mc.city}</span>}
        </span>
        {overdue > 0 && (
          <span className="wh-mc__badge" title={`Просрочено нарядов ТО: ${overdue}`}>
            <AlertTriangle size={11} /> {overdue}
          </span>
        )}
        <ChevronRight size={17} className="wh-mc__go" />
      </div>

      <dl className="wh-mc__metrics">
        <Metric label="Оборудование" value={(mc.assets || 0).toLocaleString('ru-RU')} />
        <Metric label="Кабинеты" value={(mc.rooms || 0).toLocaleString('ru-RU')} />
      </dl>

      {/* Подвал появляется, только когда в нём есть что сказать. */}
      {(structure || canSeeCosts) && (
        <div className="wh-mc__foot">
          <span className="wh-mc__structure">{structure || 'структура не заведена'}</span>
          {canSeeCosts && <span className="wh-mc__money">{shortMoney(mc.assetValue)}</span>}
        </div>
      )}
    </button>
  );
}

function Metric({ label, value }) {
  return (
    <div className="wh-mc__metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * Корпус как разрез здания: этажи стопкой сверху вниз, верхний этаж — сверху.
 * До этого этажи лежали сеткой карточек по возрастанию номера, то есть первый
 * этаж оказывался слева сверху, а верхний — справа снизу; это ровно наоборот
 * тому, как здание устроено, и найти нужный этаж глазами было неожиданно трудно.
 */
/**
 * Стопка этажей медцентра.
 *
 * До ver. 7.48 это был раздел корпуса, и таких разделов на экране было столько
 * же, сколько корпусов. Корпуса убраны — стопка осталась одна, и вопрос «какой
 * этаж открыть» решается без предварительного «в каком корпусе».
 */
function FloorsSection({ floors: list, onOpenFloor }) {
  const floors = list.slice().sort((a, z) => z.number - a.number);
  const totals = floors.reduce((acc, f) => {
    for (const r of f.rooms || []) {
      acc.rooms += 1;
      acc.assets += r.counters?.assets || 0;
    }
    return acc;
  }, { rooms: 0, assets: 0 });

  return (
    <section className="wh-bld">
      <div className="wh-bld__head">
        <Layers size={16} />
        <div className="wh-bld__id">
          <div className="wh-bld__name">Этажи</div>
        </div>
        <div className="wh-bld__sum">
          <span><Layers size={12} /> {floors.length}</span>
          <span><Boxes size={12} /> {totals.rooms}</span>
          <span><Package size={12} /> {totals.assets}</span>
        </div>
      </div>

      <div className="wh-bld__stack">
        {floors.map(floor => {
          const rooms = floor.rooms || [];
          const assets = rooms.reduce((s, r) => s + (r.counters?.assets || 0), 0);
          const noPlan = rooms.filter(r => !r.hasPlan).length;
          return (
            <button key={floor.id} className="wh-fl" onClick={() => onOpenFloor(floor.id)}>
              <span className="wh-fl__level">{floor.number}</span>
              <span className="wh-fl__main">
                <span className="wh-fl__name">{floor.name || `${floor.number} этаж`}</span>
                <span className="wh-fl__meta">
                  {rooms.length} каб. · {assets} ед. ОС
                  {/* Кабинеты без геометрии на плане не появятся — говорим об
                      этом здесь, а не оставляем гадать, почему план полупустой. */}
                  {noPlan > 0 && <em className="wh-fl__warn">без плана: {noPlan}</em>}
                </span>
              </span>
              <MiniPlan floor={floor} rooms={rooms} />
              <ChevronRight size={15} className="wh-fl__go" />
            </button>
          );
        })}
        {!floors.length && <div className="wh-empty-inline">Этажи не заведены</div>}
      </div>

      {/* Земля под стопкой этажей: без неё стопка висит в воздухе и не читается
          как здание. */}
      <div className="wh-bld__ground" />
    </section>
  );
}

/**
 * Общая схема медцентра — когда корпуса всё-таки есть, но часть помещений лежит
 * прямо в медцентре. Выглядит как этаж в стопке, потому что по сути это он и
 * есть: та же схема с контуром и кабинетами, просто без здания над ней.
 *
 * Раньше на этом месте был список кнопок с номерами кабинетов — нарисованный
 * план на карте было не увидеть вообще.
 */
function SchemeSection({ medCenter, rooms, onOpen }) {
  const assets = rooms.reduce((s, r) => s + (r.counters?.assets || 0), 0);
  const noPlan = rooms.filter(r => !r.hasPlan).length;
  const floor = {
    outline: medCenter?.warehousePlan?.outline || {},
    planWidthM: medCenter?.warehousePlan?.planWidthM,
    planHeightM: medCenter?.warehousePlan?.planHeightM,
  };

  return (
    <section className="wh-bld">
      <div className="wh-bld__head">
        <Boxes size={16} />
        <div className="wh-bld__id">
          <div className="wh-bld__name">Общая схема</div>
          <div className="wh-bld__addr">Помещения без корпуса и этажа</div>
        </div>
        <div className="wh-bld__sum">
          <span><Boxes size={12} /> {rooms.length}</span>
          <span><Package size={12} /> {assets}</span>
        </div>
      </div>

      <div className="wh-bld__stack">
        <button className="wh-fl" onClick={onOpen}>
          <span className="wh-fl__level">—</span>
          <span className="wh-fl__main">
            <span className="wh-fl__name">Схема медцентра</span>
            <span className="wh-fl__meta">
              {rooms.length} каб. · {assets} ед. ОС
              {noPlan > 0 && <em className="wh-fl__warn">без плана: {noPlan}</em>}
            </span>
          </span>
          <MiniPlan floor={floor} rooms={rooms} />
          <ChevronRight size={15} className="wh-fl__go" />
        </button>
      </div>
      <div className="wh-bld__ground" />
    </section>
  );
}

function SpecItem({ label, value }) {
  return (
    <div className="wh-spec__item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const initials = (name) => (name || '?')
  .replace(/[«»"]/g, '')
  .split(/[\s-]+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(w => w[0].toUpperCase())
  .join('');

/** Русское склонение по числу: 1 корпус, 2 корпуса, 5 корпусов. */
const plural = (n, one, few, many) => {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
};

/**
 * Стоимость парка в одну строку. Единица подбирается по величине: у мелких
 * площадок «0,0 млн ₽» читалось как отсутствие оборудования, хотя оно там есть.
 */
const shortMoney = (value) => {
  const n = Number(value) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} млн ₽`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString('ru-RU')} тыс. ₽`;
  return `${n.toLocaleString('ru-RU')} ₽`;
};

function LegendItem({ color, label }) {
  return (
    <span className="wh-legend__item">
      <i style={{ background: color }} />{label}
    </span>
  );
}

/**
 * Миниатюра плана в строке этажа. Без интерактива и без зума: её задача — дать
 * узнать этаж по форме, а не показать данные.
 *
 * Кадрируется по фактическому контуру и кабинетам, а не по габаритам листа.
 * Габариты задают с запасом (лист 40 × 25 м под корпус 18 × 9), и при кадрировании
 * по листу все миниатюры выглядели одинаковыми марками в углу пустого поля.
 */
function MiniPlan({ floor, rooms }) {
  const withPlan = rooms.filter(r => Array.isArray(r.plan?.points) && r.plan.points.length >= 3);
  const outline = Array.isArray(floor.outline?.points) && floor.outline.points.length >= 3
    ? floor.outline.points : null;
  if (!withPlan.length && !outline) {
    return <span className="wh-miniplan wh-miniplan--empty">нет плана</span>;
  }

  const all = [...(outline || []), ...withPlan.flatMap(r => r.plan.points)];
  const xs = all.map(p => p[0]);
  const ys = all.map(p => p[1]);
  const pad = 0.6;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(1, Math.max(...xs) - Math.min(...xs) + pad * 2);
  const h = Math.max(1, Math.max(...ys) - Math.min(...ys) + pad * 2);
  const path = pts => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';

  return (
    <svg className="wh-miniplan" viewBox={`${minX} ${minY} ${w} ${h}`}
         preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {/* Внутренние дворы вырезаются и в миниатюре: без evenodd этаж-«бублик»
          выглядел бы сплошным пятном и не отличался бы от обычного. */}
      {outline && (
        <path d={[outline, ...(floor.outline?.holes || [])].map(path).join(' ')} fillRule="evenodd"
              fill="#f4f7fb" stroke="#c8d4e2" strokeWidth={w / 220} />
      )}
      {withPlan.map(r => (
        <path key={r.id} d={path(r.plan.points)}
              fill="#cddcef" stroke="#8ea6c8" strokeWidth={w / 300} />
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

      {/* Кнопка стоит сразу под шапкой, а не в подвале панели: панель прокручивается,
          и в подвале главное действие экрана оказывалось ниже сгиба — до него надо
          было домотать, чтобы узнать, что оно вообще есть. */}
      <div className="wh-room-panel__cta">
        <button className="wh-btn wh-btn--primary wh-btn--wide" onClick={onOpenFull}>
          <ExternalLink size={15} /> Открыть дашборд кабинета
        </button>
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
