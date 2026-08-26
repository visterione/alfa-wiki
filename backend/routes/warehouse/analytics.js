/**
 * Аналитика: тепловая карта загрузки и простаивающее оборудование.
 *
 * Методика и её ограничения расписаны в services/warehouse/utilization.js.
 * Коротко: загрузка считается из расписания МИС, а не из журнала выдачи, и по
 * кабинету, а не по прибору. Блок «рекомендации по перераспределению с экономией
 * N рублей» из ТЗ здесь намеренно отсутствует — посчитать эту цифру из имеющихся
 * данных нельзя, а придуманная стоит дороже, чем её отсутствие. Вместо неё —
 * список простаивающих активов с числом дней простоя.
 */

const express = require('express');
const router = express.Router();
const { WhFloor, WhBuilding, MedCenter, WhRoom, WhFloorShape, WhDepartment } = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse, requireReport } = require('../../services/warehouse/access');
const utilization = require('../../services/warehouse/utilization');

/**
 * Тепловая карта одного этажа: геометрия плана плюс показатели по кабинетам.
 * Отдаётся одним ответом — карта бесполезна без обоих кусков, а два запроса
 * давали бы мигание при переключении этажей.
 */
router.get('/heatmap', authenticate, requireWarehouse(), requireReport('RPT-HEATMAP'), async (req, res) => {
  try {
    const { floorId, medCenterId, from, to, metric = 'utilization' } = req.query;
    if (!floorId && !medCenterId) {
      return res.status(400).json({ error: 'Нужен floorId или medCenterId' });
    }

    // Схема бывает двух видов, и это не два разных отчёта. У небольшого МЦ
    // помещения лежат прямо в медцентре, без корпуса и этажа (ver. 6.81), и
    // геометрия у них хранится в med_centers.warehousePlan, а не в этаже. Дальше
    // по коду разницы нет: и там и там — контур, фигуры и кабинеты с планом.
    let floor = null;
    let medCenter = null;
    if (floorId) {
      floor = await WhFloor.findByPk(floorId, {
        include: [
          { model: MedCenter, as: 'medCenter' },
          // Запасной путь для этажей до ver. 7.48, у которых медцентр ещё пуст.
          { model: WhBuilding, as: 'building', include: [{ model: MedCenter, as: 'medCenter' }] },
        ],
      });
      if (!floor) return res.status(404).json({ error: 'Этаж не найден' });
    } else {
      medCenter = await MedCenter.findByPk(medCenterId);
      if (!medCenter) return res.status(404).json({ error: 'Медцентр не найден' });
    }

    const dateTo = to || new Date().toISOString().slice(0, 10);
    const dateFrom = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const saved = medCenter?.warehousePlan || {};
    const [rooms, shapes] = await Promise.all([
      utilization.aggregate({ floorId, medCenterId, from: dateFrom, to: dateTo }),
      // Фигуры общей схемы живут в том же JSON, что и её контур: отдельной
      // таблицы у них нет, потому что нет и этажа, к которому её привязать.
      floorId
        ? WhFloorShape.findAll({ where: { floorId }, order: [['z', 'ASC']] })
        : Promise.resolve(Array.isArray(saved.shapes) ? saved.shapes : []),
    ]);

    const scoped = await req.warehouse.scopedRoomIds();
    const visible = scoped === null ? null : new Set(scoped);

    const items = rooms
      .filter(r => visible === null || visible.has(r.roomId))
      .map(r => ({
        ...r,
        // Значение выбранного показателя и его зона. Показатель переключается, а
        // геометрия остаётся той же — поэтому раскраска считается здесь, чтобы
        // клиент не дублировал пороги.
        metricValue: metricValue(r, metric),
        metricZone: metricZone(r, metric),
      }));

    res.json({
      floor: floor ? {
        id: floor.id, number: floor.number, name: floor.name,
        planWidthM: Number(floor.planWidthM), planHeightM: Number(floor.planHeightM),
        planBgUrl: floor.planBgUrl, planBgOpacity: Number(floor.planBgOpacity),
        outline: floor.outline || {},
        medCenter: floor.medCenter?.displayName || floor.medCenter?.name
          || floor.building?.medCenter?.displayName || floor.building?.medCenter?.name,
      } : {
        id: `med-center:${medCenter.id}`,
        scope: 'medCenter',
        name: 'Общая схема',
        planWidthM: Number(saved.planWidthM) || 40,
        planHeightM: Number(saved.planHeightM) || 25,
        planBgUrl: saved.planBgUrl || null,
        planBgOpacity: Number(saved.planBgOpacity ?? 0.35),
        outline: saved.outline || {},
        medCenter: medCenter.displayName || medCenter.name,
      },
      period: { from: dateFrom, to: dateTo },
      metric,
      metrics: AVAILABLE_METRICS,
      rooms: items,
      shapes,
      zones: utilization.ZONES,
      // Сколько кабинетов вообще не имеют расчёта: если это большинство, карту
      // читать нельзя, и об этом надо сказать прямо на экране.
      coverage: {
        total: items.length,
        withData: items.filter(r => r.hasData).length,
        withGeometry: items.filter(r => Array.isArray(r.plan?.points) && r.plan.points.length >= 3).length,
      },
    });
  } catch (err) {
    console.error('GET warehouse/analytics/heatmap error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Альтернативные показатели раскраски из ТЗ. Загрузка — первый, но не
// единственный: остальные не требуют сопоставления с МИС и работают сразу.
const AVAILABLE_METRICS = [
  { key: 'utilization',   title: 'Загрузка кабинета',        unit: '%',   needsMis: true },
  { key: 'assetValue',    title: 'Стоимость активов',        unit: '₽',   needsMis: false },
  { key: 'assetCount',    title: 'Количество активов',       unit: 'ед.', needsMis: false },
  { key: 'belowMinimum',  title: 'Дефицит материалов',       unit: 'поз.', needsMis: false },
  { key: 'expired',       title: 'Просроченные позиции',     unit: 'поз.', needsMis: false },
  { key: 'overdueMaint',  title: 'Просроченные ТО',          unit: 'нар.', needsMis: false },
  { key: 'inRepair',      title: 'Оборудование в ремонте',   unit: 'ед.', needsMis: false },
  { key: 'idleAssets',    title: 'Простаивающее оборудование', unit: 'ед.', needsMis: false },
];

function metricValue(r, metric) {
  const m = r.metrics || {};
  switch (metric) {
    case 'utilization':  return r.hasData ? r.avgPct : null;
    case 'assetValue':   return Number(m.assetValue || 0);
    case 'assetCount':   return Number(m.assetCount || 0);
    case 'belowMinimum': return Number(m.belowMinimum || 0);
    case 'expired':      return Number(m.expiredPositions || 0);
    case 'overdueMaint': return Number(m.overdueMaintenance || 0);
    case 'inRepair':     return Number(m.inRepair || 0);
    case 'idleAssets':   return Number(r.idleAssets || 0);
    default:             return null;
  }
}

function metricZone(r, metric) {
  const v = metricValue(r, metric);
  if (v === null) return 'unknown';
  if (metric === 'utilization') return utilization.zoneOf(v);
  if (metric === 'assetValue' || metric === 'assetCount') {
    // Для стоимости и количества «плохо/хорошо» не существует — это не светофор,
    // а насыщенность. Клиент раскрасит по шкале, зону не используем.
    return 'scale';
  }
  // Остальные показатели — про проблемы: чем больше, тем хуже.
  return v === 0 ? 'green' : v <= 2 ? 'yellow' : 'red';
}

/**
 * Пересчёт загрузки. Ручной запуск нужен и для демонстрации, и после правки
 * сопоставления кабинетов с МИС — иначе изменения не видны до следующей ночи.
 */
router.post('/utilization/recompute', authenticate, requireWarehouse('canEditPlans'), async (req, res) => {
  try {
    const { from, to } = req.body;
    const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const end = to ? new Date(to) : new Date();
    if ((end - start) / 86400000 > 400) {
      return res.status(400).json({ error: 'За раз можно пересчитать не больше 400 дней' });
    }

    const results = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      results.push(await utilization.computeForDate(new Date(d)));
    }

    const unmatched = results[0]?.unmatchedRooms || [];
    res.json({
      days: results.length,
      rooms: results[0]?.rooms || 0,
      // Кабинеты без сопоставления с МИС — главная причина пустой тепловой карты.
      // Возвращаем их списком, чтобы это было видно сразу, а не выяснялось потом.
      unmatchedRooms: unmatched,
      warning: unmatched.length
        ? `${unmatched.length} кабинетов без сопоставления с МИС: загрузка по ним не считается. ` +
          'Заполните «Названия в МИС» в карточке кабинета.'
        : null,
    });
  } catch (err) {
    console.error('POST warehouse/analytics/utilization/recompute error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Простаивающее оборудование. Честная замена «рекомендациям по перераспределению»:
 * говорим, что не двигалось и сколько дней, а решение о переносе оставляем людям.
 */
router.get('/idle-assets', authenticate, requireWarehouse(), requireReport('RPT-IDLE'), async (req, res) => {
  try {
    const { medCenterId, days } = req.query;
    const rows = await utilization.idleAssets({
      medCenterId: medCenterId || null,
      days: Number(days) || utilization.IDLE_DAYS,
    });
    res.json({
      thresholdDays: Number(days) || utilization.IDLE_DAYS,
      items: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Сводка по сети для верхнего уровня навигации: сколько корпусов, этажей,
 * кабинетов и активов в каждом медцентре. Нужна экрану выбора медцентра, чтобы
 * карточки не были пустыми плитками.
 */
router.get('/overview', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const { sequelize } = require('../../models');
    const [rows] = await sequelize.query(`
      SELECT mc.id, mc.name, mc."displayName", mc.code, mc.color, mc."logoUrl", mc.city,
             COUNT(DISTINCT f.id)::int   AS floors,
             -- Склады не кабинеты: в плитке медцентра «кабинетов: 42» должно
             -- означать помещения, а не помещения плюс склад и ремонт. Из
             -- соединения они при этом не выкидываются — имущество, лежащее на
             -- складе, принадлежит медцентру и в его суммы входит.
             COUNT(DISTINCT r.id) FILTER (WHERE r."isService" = FALSE)::int AS rooms,
             COUNT(DISTINCT a.id)::int   AS assets,
             COALESCE(SUM(DISTINCT 0), 0) AS zero,
             (SELECT COALESCE(SUM(a2."initialCost"), 0) FROM warehouse_assets a2
                JOIN warehouse_rooms r2 ON r2.id = a2."roomId"
               WHERE r2."medCenterId" = mc.id AND a2."isArchived" = FALSE) AS "assetValue",
             (SELECT COUNT(*)::int FROM warehouse_maintenance_orders m
                JOIN warehouse_assets a3 ON a3.id = m."assetId"
                JOIN warehouse_rooms r3 ON r3.id = a3."roomId"
               WHERE r3."medCenterId" = mc.id AND m.status <> 'done'
                 AND m."plannedDate" < CURRENT_DATE) AS "overdueMaintenance"
      FROM med_centers mc
      -- Этаж принадлежит медцентру напрямую (ver. 7.48): считать их через
      -- корпуса теперь нельзя — у новых этажей корпуса нет вовсе.
      LEFT JOIN warehouse_floors f      ON f."medCenterId" = mc.id
      LEFT JOIN warehouse_rooms r       ON r."medCenterId" = mc.id AND r."isActive" = TRUE
      LEFT JOIN warehouse_assets a      ON a."roomId" = r.id AND a."isArchived" = FALSE
      WHERE mc."isActive" = TRUE AND mc."isVirtual" = FALSE
      GROUP BY mc.id, mc.name, mc."displayName", mc.code, mc.color, mc."logoUrl", mc.city, mc."sortOrder"
      ORDER BY mc."sortOrder", mc.name
    `);
    res.json(rows.map(r => ({ ...r, assetValue: Number(r.assetValue) })));
  } catch (err) {
    console.error('GET warehouse/analytics/overview error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
