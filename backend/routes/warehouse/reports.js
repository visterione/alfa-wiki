/**
 * Отчёты складского модуля.
 *
 * Агрегаты собираются одним SQL-запросом на отчёт, а не выборкой моделей с
 * последующим сведением в JS: в оборотно-сальдовой ведомости за месяц по сети
 * это разница между одним запросом и десятками тысяч.
 *
 * Общее правило по всем отчётам: если данных для показателя нет, отдаём null и
 * признак «нет данных», а не ноль. Ноль в отчёте читается как факт («расхода не
 * было»), и подменять им отсутствие расчёта — самый быстрый способ потерять
 * доверие к модулю.
 */

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const {
  sequelize, WhAsset, WhRoom, WhDepartment, WhFloor, WhBuilding, WhStorage,
  WhStock, WhBatch, WhNomenclature, WhMaintenanceOrder, WhRepair,
  WhInventorySession, WhInventoryItem, WhContractor, WhDocument, User, MedCenter,
} = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse, requireReport, roomPath } = require('../../services/warehouse/access');
const { reconcileStock } = require('../../services/warehouse/stock');
const utilization = require('../../services/warehouse/utilization');
const exports_ = require('../../services/warehouse/exports');
const reportData = require('../../services/warehouse/reportData');
const hierarchy = require('../../services/warehouse/hierarchy');

const userAttrs = ['id', 'displayName', 'username', 'avatar'];

/**
 * Единая шапка отчёта из раздела 1.0 ТЗ. Собирается на бэкенде, чтобы экран,
 * XLSX и PDF показывали одно и то же — включая имя пользователя и время.
 */
/**
 * Единая шапка отчёта из раздела 1.0 ТЗ.
 *
 * Строка отбора собирается человеческими названиями, а не тем, что пришло в
 * query. Раньше в выгрузку уезжало «medCenterId = 6f3a…-9c21», и через месяц по
 * такому файлу нельзя было сказать, какой срез перед тобой — а именно ради этого
 * строка отбора в ТЗ и стоит. Поэтому идентификаторы разворачиваются в названия,
 * технические параметры (page, limit, mode) отбрасываются, а булевы флаги
 * переводятся в человеческие формулировки.
 *
 * Функция асинхронная: за названиями приходится сходить в справочники. Это один
 * дополнительный запрос на отчёт и он того стоит.
 */
const FILTER_LABELS = {
  medCenterId: 'Медцентр',
  departmentId: 'Отделение',
  roomId: 'Кабинет',
  contractorId: 'Подрядчик',
  categoryId: 'Категория',
  nomenclatureId: 'Номенклатура',
  assetId: 'Оборудование',
  doctorUserId: 'Врач',
  status: 'Статус',
  type: 'Тип',
  horizonDays: 'Горизонт, дней',
  showZero: 'Нулевые остатки',
  medicineOnly: 'Только ЛП',
  sterileOnly: 'Только стерильные',
  fullyDepreciatedOnly: 'Только самортизированные',
  mandatoryOnly: 'Только обязательные по НПА',
  overdueOnly: 'Только просроченные',
  interDepartmentOnly: 'Только межотделенческие',
  compare: 'Сравнение с предыдущим периодом',
};
// Служебные параметры в отбор не попадают: они описывают запрос, а не срез.
const FILTER_SKIP = new Set(['from', 'to', 'page', 'limit', 'mode', 'format', 'code']);

async function reportHeader({ req, code, title, from, to, filters = {} }) {
  // Organization подтягивается здесь, а не в общем импорте сверху: юрлицо нужно
  // только шапке, и тащить его в модуль ради одной строки незачем.
  const { Organization } = require('../../models');

  const named = [];
  for (const [key, raw] of Object.entries(filters || {})) {
    if (FILTER_SKIP.has(key)) continue;
    if (raw === undefined || raw === null || raw === '' || raw === 'false') continue;
    const label = FILTER_LABELS[key] || key;
    let value = String(raw);
    try {
      if (key === 'medCenterId') value = (await MedCenter.findByPk(raw))?.name || value;
      else if (key === 'departmentId') value = (await WhDepartment.findByPk(raw))?.name || value;
      else if (key === 'roomId') {
        const room = await WhRoom.findByPk(raw);
        value = room ? `${room.number}${room.name && room.name !== room.number ? ` — ${room.name}` : ''}` : value;
      } else if (raw === 'true') value = 'да';
    } catch {
      // Справочник не ответил — оставляем как есть: шапка не повод ронять отчёт.
    }
    named.push({ label, value });
  }

  // Юрлицо: если отбор сужен до одного медцентра — его собственное, иначе первое
  // активное. Отчёт подписывается организацией, а не порталом.
  let organization = null;
  try {
    if (filters?.medCenterId) {
      const mc = await MedCenter.findByPk(filters.medCenterId, {
        include: [{ model: Organization, as: 'organization', attributes: ['name'] }],
      });
      organization = mc?.organization?.name || null;
    }
    if (!organization) {
      const org = await Organization.findOne({
        where: { isActive: true }, order: [['sortOrder', 'ASC']], attributes: ['name'],
      });
      organization = org?.name || null;
    }
  } catch {
    organization = null;
  }

  return {
    code,
    title,
    organization,
    period: from && to ? { from, to } : null,
    generatedAt: new Date().toISOString(),
    generatedBy: req.user.displayName || req.user.username,
    system: 'Alfa-Wiki, складской учёт',
    filters,
    // Готовая строка «Отбор: …» из макета ТЗ. Собирается на сервере, чтобы экран,
    // XLSX и PDF писали одно и то же — расхождение здесь читается как разные срезы.
    filterText: named.length
      ? named.map(f => `${f.label} = ${f.value}`).join('; ')
      : 'без дополнительного отбора',
    filterList: named,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RPT-TURNOVER — Оборотно-сальдовая ведомость по складам и локациям
// ─────────────────────────────────────────────────────────────────────────────
router.get('/turnover', authenticate, requireWarehouse(), requireReport('RPT-TURNOVER'), async (req, res) => {
  try {
    const { from, to, medCenterId, departmentId, roomId, showZero } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'Нужен период: from и to' });

    const scoped = await req.warehouse.scopedRoomIds();

    const [rows] = await sequelize.query(`
      WITH bounds AS (
        SELECT :from::timestamptz AS d_from, (:to::date + 1)::timestamptz AS d_to
      ),
      -- Движения с reasonCode 'batch_attach' исключены из всех трёх выборок: это
      -- пара «расход из без-партии + приход в партию» в одном месте хранения,
      -- которой оформляется проставленный задним числом срок годности. Количество
      -- она не меняла, и показывать её оборотом значит выдумать движение.
      -- Сальдо на начало: все движения до начала периода.
      opening AS (
        SELECT m."nomenclatureId", COALESCE(m."toStorageId", m."fromStorageId") AS storage,
               SUM(CASE WHEN m."toStorageId" IS NOT NULL THEN m.quantity ELSE -m.quantity END) AS qty,
               SUM(CASE WHEN m."toStorageId" IS NOT NULL THEN m.amount ELSE -m.amount END) AS amount
        FROM warehouse_movements m, bounds b
        WHERE m."occurredAt" < b.d_from AND m."nomenclatureId" IS NOT NULL
          AND m."reasonCode" IS DISTINCT FROM 'batch_attach'
        GROUP BY 1, 2
      ),
      incoming AS (
        SELECT m."nomenclatureId", m."toStorageId" AS storage,
               SUM(m.quantity) AS qty, SUM(m.amount) AS amount
        FROM warehouse_movements m, bounds b
        WHERE m."occurredAt" >= b.d_from AND m."occurredAt" < b.d_to
          AND m."toStorageId" IS NOT NULL AND m."nomenclatureId" IS NOT NULL
          AND m."reasonCode" IS DISTINCT FROM 'batch_attach'
        GROUP BY 1, 2
      ),
      outgoing AS (
        SELECT m."nomenclatureId", m."fromStorageId" AS storage,
               SUM(m.quantity) AS qty, SUM(m.amount) AS amount
        FROM warehouse_movements m, bounds b
        WHERE m."occurredAt" >= b.d_from AND m."occurredAt" < b.d_to
          AND m."fromStorageId" IS NOT NULL AND m."nomenclatureId" IS NOT NULL
          AND m."reasonCode" IS DISTINCT FROM 'batch_attach'
        GROUP BY 1, 2
      ),
      keys AS (
        SELECT "nomenclatureId", storage FROM opening
        UNION SELECT "nomenclatureId", storage FROM incoming
        UNION SELECT "nomenclatureId", storage FROM outgoing
        UNION SELECT "nomenclatureId", "storageId" FROM warehouse_stock WHERE quantity > 0
      )
      SELECT
        mc.name AS "medCenterName", bld.name AS "buildingName", f.number AS "floorNumber",
        d.id AS "departmentId", d.name AS "departmentName", d.color AS "departmentColor",
        r.id AS "roomId", r.number AS "roomNumber", r.name AS "roomName",
        st.id AS "storageId", st.name AS "storageName",
        n.id AS "nomenclatureId", n.code, n.name AS "nomenclatureName", n.unit,
        COALESCE(o.qty, 0)      AS "openQty",
        COALESCE(o.amount, 0)   AS "openAmount",
        COALESCE(i.qty, 0)      AS "inQty",
        COALESCE(i.amount, 0)   AS "inAmount",
        COALESCE(ou.qty, 0)     AS "outQty",
        COALESCE(ou.amount, 0)  AS "outAmount",
        COALESCE(o.qty, 0) + COALESCE(i.qty, 0) - COALESCE(ou.qty, 0)          AS "closeQty",
        COALESCE(o.amount, 0) + COALESCE(i.amount, 0) - COALESCE(ou.amount, 0) AS "closeAmount",
        (SELECT rr."minQty" FROM warehouse_reorder_rules rr
          WHERE rr."nomenclatureId" = n.id
            AND (rr."storageId" = st.id OR rr."roomId" = r.id OR (rr."roomId" IS NULL AND rr."storageId" IS NULL))
          ORDER BY rr."storageId" NULLS LAST, rr."roomId" NULLS LAST LIMIT 1) AS "minQty"
      FROM keys k
      JOIN warehouse_nomenclature n ON n.id = k."nomenclatureId"
      JOIN warehouse_storages st    ON st.id = k.storage
      JOIN warehouse_rooms r        ON r.id = st."roomId"
      LEFT JOIN warehouse_floors f       ON f.id = r."floorId"
      LEFT JOIN warehouse_buildings bld  ON bld.id = f."buildingId"
      JOIN med_centers mc                ON mc.id = r."medCenterId"
      LEFT JOIN warehouse_departments d ON d.id = r."departmentId"
      LEFT JOIN opening o  ON o."nomenclatureId" = k."nomenclatureId" AND o.storage = k.storage
      LEFT JOIN incoming i ON i."nomenclatureId" = k."nomenclatureId" AND i.storage = k.storage
      LEFT JOIN outgoing ou ON ou."nomenclatureId" = k."nomenclatureId" AND ou.storage = k.storage
      WHERE (:medCenterId::uuid  IS NULL OR r."medCenterId" = :medCenterId::uuid)
        AND (:departmentId::uuid IS NULL OR r."departmentId" = :departmentId::uuid)
        AND (:roomId::uuid       IS NULL OR r.id = :roomId::uuid)
        AND (:scoped IS NULL OR r.id = ANY(:scoped::uuid[]))
      ORDER BY mc.name, bld.name, f.number, d.name NULLS LAST, r.number, st.name, n.name
    `, {
      replacements: {
        from, to,
        medCenterId: medCenterId || null,
        departmentId: departmentId || null,
        roomId: roomId || null,
        scoped: toPgUuidArray(scoped),
      },
    });

    const items = (showZero === 'true' ? rows : rows.filter(r =>
      Number(r.openQty) !== 0 || Number(r.inQty) !== 0 || Number(r.outQty) !== 0 || Number(r.closeQty) !== 0
    )).map(r => {
      const closeQty = Number(r.closeQty);
      const min = r.minQty === null ? null : Number(r.minQty);
      return {
        ...r,
        openQty: Number(r.openQty), openAmount: Number(r.openAmount),
        inQty: Number(r.inQty), inAmount: Number(r.inAmount),
        outQty: Number(r.outQty), outAmount: Number(r.outAmount),
        closeQty, closeAmount: Number(r.closeAmount),
        minQty: min,
        status: min === null ? 'unknown' : closeQty < min ? 'below' : closeQty < min * 1.2 ? 'near' : 'ok',
      };
    });

    // ТЗ требует именно иерархию: корпус → этаж → отделение → кабинет → место
    // хранения → номенклатура, с подытогами на каждом уровне. Собираем на сервере,
    // чтобы экран, XLSX и PDF показывали одно и то же дерево.
    const MEASURES = ['openQty', 'openAmount', 'inQty', 'inAmount',
                      'outQty', 'outAmount', 'closeQty', 'closeAmount'];
    const tree = hierarchy.buildTree(
      items,
      hierarchy.turnoverLevels(items),
      MEASURES,
      row => ({
        label: row.nomenclatureName,
        code: row.code,
        unit: row.unit,
        nomenclatureId: row.nomenclatureId,
        roomId: row.roomId,
        storageId: row.storageId,
        minQty: row.minQty,
        status: row.status,
        ...Object.fromEntries(MEASURES.map(m => [m, row[m]])),
      })
    );

    // Доля позиции в сумме итога локации — гр. 12 ТЗ. Считается после сборки
    // дерева: база — конечное сальдо места хранения, к которому позиция
    // относится, а его знает только собранный узел, но не строка из SQL.
    const treeRows = tree.rows.map(r => roundRow(r, MEASURES));
    const groupClose = new Map(
      treeRows.filter(r => r.__isGroup).map(r => [r.__key, r.closeAmount])
    );
    for (const row of treeRows) {
      if (row.__isGroup) continue;
      const base = groupClose.get(row.__parentKey);
      row.sharePct = base ? round2((row.closeAmount / base) * 100) : null;
    }

    res.json({
      header: await reportHeader({ req, code: 'RPT-TURNOVER', title: 'Оборотно-сальдовая ведомость по локациям', from, to, filters: req.query }),
      // Иерархия: плоский список строк с __level и __isGroup. Такой формат
      // одинаково ложится и в отрисовку с отступами, и в группировку строк Excel.
      hierarchical: true,
      items: treeRows,
      // Плоские строки оставлены для тех, кому нужен «сырой» срез без дерева.
      flatItems: items,
      totals: roundRow(tree.totals, MEASURES),
      // Контрольная сверка из ТЗ, но с честным источником: не «расхождение с 1С»,
      // которой нет, а расхождение остатка с журналом движений внутри портала.
      controls: { stockVsMovements: await reconcileStock() },
    });
  } catch (err) {
    console.error('GET warehouse/reports/turnover error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RPT-CONSUMPTION — Расход материалов по кабинетам, отделениям и врачам
// ─────────────────────────────────────────────────────────────────────────────
router.get('/consumption', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const { from, to, mode = 'locations', medCenterId, departmentId, compare } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'Нужен период: from и to' });

    // Режим «по врачам» — отдельная строка матрицы: ТЗ само предупреждает, что
    // это не оценка качества работы, и открывать его всем, кто видит расход по
    // кабинетам, неправильно.
    const code = mode === 'doctors' ? 'RPT-CONSUMPTION-2' : 'RPT-CONSUMPTION';
    const permsSvc = require('../../services/warehouse/permissions');
    if (!permsSvc.canReadReport(req.warehouse.perms, code)) {
      const title = permsSvc.REPORTS[code]?.label || code;
      return res.status(403).json({ error: `Отчёт «${title}» вам не открыт`, code });
    }

    const scoped = await req.warehouse.scopedRoomIds();
    const span = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
    const prevFrom = new Date(new Date(from).getTime() - span * 86400000).toISOString().slice(0, 10);
    const prevTo = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);

    if (mode === 'doctors') {
      // Режим 2. Рейтинг строится ТОЛЬКО внутри одной специальности: сравнивать
      // хирурга с терапевтом бессмысленно, и медиана по всей сети была бы мусором.
      const [rows] = await sequelize.query(`
        SELECT u.id AS "doctorId", u."displayName" AS "doctorName",
               d.name AS "departmentName", d."specialtyCode",
               COUNT(DISTINCT m."documentId")::int AS operations,
               SUM(m.amount) AS amount
        FROM warehouse_movements m
        JOIN users u ON u.id = m."doctorUserId"
        LEFT JOIN warehouse_rooms r ON r.id = m."fromRoomId"
        LEFT JOIN warehouse_departments d ON d.id = r."departmentId"
        WHERE m.type = 'issue' AND m."occurredAt" >= :from AND m."occurredAt" < (:to::date + 1)
          AND (:departmentId::uuid IS NULL OR r."departmentId" = :departmentId::uuid)
          AND (:scoped IS NULL OR m."fromRoomId" = ANY(:scoped::uuid[]))
        GROUP BY u.id, u."displayName", d.name, d."specialtyCode"
        ORDER BY amount DESC
      `, { replacements: { from, to, departmentId: departmentId || null, scoped: scoped === null ? null : scoped } });

      // Медиана внутри специальности.
      const bySpecialty = new Map();
      for (const r of rows) {
        const key = r.specialtyCode || 'unknown';
        if (!bySpecialty.has(key)) bySpecialty.set(key, []);
        const perOp = r.operations > 0 ? Number(r.amount) / r.operations : 0;
        bySpecialty.get(key).push(perOp);
      }
      const medians = new Map();
      for (const [key, values] of bySpecialty) {
        const sorted = values.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        medians.set(key, sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
      }

      return res.json({
        header: await reportHeader({ req, code: 'RPT-CONSUMPTION', title: 'Расход материалов по врачам', from, to, filters: req.query }),
        mode: 'doctors',
        items: rows.map(r => {
          const perOp = r.operations > 0 ? Number(r.amount) / r.operations : 0;
          const median = medians.get(r.specialtyCode || 'unknown') || 0;
          return {
            ...r,
            amount: Number(r.amount),
            perOperation: round2(perOp),
            medianBySpecialty: round2(median),
            deviationPct: median > 0 ? round2(((perOp - median) / median) * 100) : null,
            // Значимость выборки: по трём операциям отклонение ни о чём не говорит,
            // и показывать его как вывод нельзя.
            sampleReliable: r.operations >= 20,
          };
        }),
        disclaimer:
          'Отклонение от медианы не является оценкой качества работы и не может служить ' +
          'основанием для управленческих решений без разбора сложности случаев. ' +
          'Строки с числом операций менее 20 статистически незначимы.',
      });
    }

    if (mode === 'abc') {
      return res.json(await abcXyz({ req, from, to, medCenterId, departmentId, scoped }));
    }

    // Режим 1 — расход по локациям, с сопоставлением норме и посещениями из МИС.
    const [rows] = await sequelize.query(`
      WITH cons AS (
        SELECT r.id AS "roomId", n.id AS "nomenclatureId",
               SUM(m.quantity) AS qty, SUM(m.amount) AS amount
        FROM warehouse_movements m
        JOIN warehouse_nomenclature n ON n.id = m."nomenclatureId"
        JOIN warehouse_rooms r ON r.id = m."fromRoomId"
        WHERE m.type IN ('issue', 'writeoff')
          AND m."occurredAt" >= :from AND m."occurredAt" < (:to::date + 1)
        GROUP BY 1, 2
      ),
      prev AS (
        SELECT r.id AS "roomId", n.id AS "nomenclatureId",
               SUM(m.quantity) AS qty, SUM(m.amount) AS amount
        FROM warehouse_movements m
        JOIN warehouse_nomenclature n ON n.id = m."nomenclatureId"
        JOIN warehouse_rooms r ON r.id = m."fromRoomId"
        WHERE m.type IN ('issue', 'writeoff')
          AND m."occurredAt" >= :prevFrom AND m."occurredAt" < (:prevTo::date + 1)
        GROUP BY 1, 2
      ),
      visits AS (
        SELECT u."roomId", SUM(u."appointmentsCount")::int AS cnt
        FROM warehouse_utilization_daily u
        WHERE u.date BETWEEN :from AND :to
        GROUP BY 1
      )
      SELECT mc.name AS "medCenterName", d.name AS "departmentName", d.color AS "departmentColor",
             r.id AS "roomId", r.number AS "roomNumber", r.name AS "roomName",
             n.id AS "nomenclatureId", n.code, n.name AS "nomenclatureName", n.unit,
             c.qty, c.amount,
             COALESCE(p.qty, 0) AS "prevQty", COALESCE(p.amount, 0) AS "prevAmount",
             v.cnt AS visits,
             (SELECT cn."normValue" FROM warehouse_consumption_norms cn
               WHERE cn."nomenclatureId" = n.id AND cn.basis = 'per_visit'
                 AND (cn."roomId" = r.id OR cn."departmentId" = r."departmentId" OR (cn."roomId" IS NULL AND cn."departmentId" IS NULL))
               ORDER BY cn."roomId" NULLS LAST, cn."departmentId" NULLS LAST LIMIT 1) AS "normPerVisit"
      FROM cons c
      JOIN warehouse_nomenclature n ON n.id = c."nomenclatureId"
      JOIN warehouse_rooms r        ON r.id = c."roomId"
      LEFT JOIN warehouse_floors f       ON f.id = r."floorId"
      LEFT JOIN warehouse_buildings bld  ON bld.id = f."buildingId"
      JOIN med_centers mc                ON mc.id = r."medCenterId"
      LEFT JOIN warehouse_departments d ON d.id = r."departmentId"
      LEFT JOIN prev p   ON p."roomId" = c."roomId" AND p."nomenclatureId" = c."nomenclatureId"
      LEFT JOIN visits v ON v."roomId" = c."roomId"
      WHERE (:medCenterId::uuid  IS NULL OR r."medCenterId" = :medCenterId::uuid)
        AND (:departmentId::uuid IS NULL OR r."departmentId" = :departmentId::uuid)
        AND (:scoped IS NULL OR r.id = ANY(:scoped::uuid[]))
      ORDER BY mc.name, d.name NULLS LAST, r.number, c.amount DESC
    `, {
      replacements: {
        from, to, prevFrom, prevTo,
        medCenterId: medCenterId || null,
        departmentId: departmentId || null,
        scoped: toPgUuidArray(scoped),
      },
    });

    const items = rows.map(r => {
      const qty = Number(r.qty), amount = Number(r.amount);
      const prevQty = Number(r.prevQty), prevAmount = Number(r.prevAmount);
      const visits = r.visits === null ? null : Number(r.visits);
      const perVisit = visits && visits > 0 ? qty / visits : null;
      const norm = r.normPerVisit === null ? null : Number(r.normPerVisit);
      return {
        ...r,
        qty, amount, prevQty, prevAmount,
        deltaQtyPct: prevQty > 0 ? round2(((qty - prevQty) / prevQty) * 100) : null,
        deltaAmountPct: prevAmount > 0 ? round2(((amount - prevAmount) / prevAmount) * 100) : null,
        visits,
        perVisit: perVisit === null ? null : round(perVisit, 3),
        normPerVisit: norm,
        // Отклонение считается только когда есть и норма, и посещения. Иначе null —
        // а не ноль, который выглядел бы как «строго по норме».
        normDeviationPct: (norm && perVisit) ? round2(((perVisit - norm) / norm) * 100) : null,
        // Почему показателя нет — важнее самого пропуска: без этого поля
        // пустая колонка выглядит как ошибка отчёта.
        missingReason: visits === null ? 'Загрузка кабинета не рассчитана: нет сопоставления с МИС'
          : !norm ? 'Норма расхода не задана' : null,
      };
    });

    const CONS_MEASURES = ['qty', 'amount', 'prevQty', 'prevAmount'];
    const consTree = hierarchy.buildTree(
      items,
      hierarchy.consumptionLevels(items),
      CONS_MEASURES,
      row => ({
        label: row.nomenclatureName,
        code: row.code, unit: row.unit,
        visits: row.visits, perVisit: row.perVisit,
        normPerVisit: row.normPerVisit, normDeviationPct: row.normDeviationPct,
        deltaQty: row.qty - row.prevQty,
        deltaQtyPct: row.deltaQtyPct,
        deltaAmountPct: row.deltaAmountPct, missingReason: row.missingReason,
        ...Object.fromEntries(CONS_MEASURES.map(m => [m, row[m]])),
      })
    );

    // Доля в расходе отделения — гр. 13 ТЗ. Отделение лежит на уровень выше
    // кабинета, поэтому база берётся у «деда»: ключ узла — путь, и достаточно
    // отбросить последний сегмент.
    const consRows = consTree.rows.map(r => roundRow(r, CONS_MEASURES));
    const groupAmount = new Map(
      consRows.filter(r => r.__isGroup).map(r => [r.__key, r.amount])
    );
    for (const row of consRows) {
      if (row.__isGroup) continue;
      const deptKey = String(row.__parentKey).split('/').slice(0, -1).join('/');
      const base = groupAmount.get(deptKey);
      row.deptSharePct = base ? round2((row.amount / base) * 100) : null;
    }

    res.json({
      header: await reportHeader({ req, code: 'RPT-CONSUMPTION', title: 'Расход материалов по локациям', from, to, filters: req.query }),
      mode: 'locations',
      comparePeriod: { from: prevFrom, to: prevTo },
      hierarchical: true,
      items: consRows,
      flatItems: items,
      totals: roundRow(consTree.totals, CONS_MEASURES),
    });
  } catch (err) {
    console.error('GET warehouse/reports/consumption error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Режим 3 отчёта № 3 — ABC/XYZ-анализ.
 *
 * ABC режет номенклатуру по вкладу в сумму расхода (80 / 15 / 5 % накопленным
 * итогом), XYZ — по стабильности потребления через коэффициент вариации помесячных
 * расходов. Пересечение даёт стратегию управления запасом: то, что дорого и
 * ровно расходуется, можно заказывать автоматически, а то, что дорого и
 * непредсказуемо, — только под заявку.
 *
 * Два решения, которые важно знать при чтении цифр:
 *
 *   • Месяцы без расхода входят в ряд нулями. Считать вариацию только по месяцам
 *     с движением — значит объявить стабильной позицию, которую взяли дважды за
 *     год: между этими двумя точками разброса нет, а спрос на неё нерегулярен
 *     ровно в том смысле, ради которого XYZ и придуман.
 *
 *   • Меньше трёх месяцев в периоде — XYZ не считается вовсе, а не считается
 *     плохо. По двум точкам коэффициент вариации формально получается, но
 *     означает шум, и раскладывать по нему стратегию закупок нельзя.
 */
const ABC_STRATEGY = {
  AX: 'Автозаказ, жёсткий min/max',
  AY: 'Страховой запас +30 %',
  AZ: 'Заказ под заявку, без запаса',
  BX: 'Плановый заказ по графику',
  BY: 'Умеренный страховой запас',
  BZ: 'Заказ под заявку',
  CX: 'Редкий контроль, большая партия',
  CY: 'Редкий контроль',
  CZ: 'Минимальный запас или под заказ',
};

async function abcXyz({ req, from, to, medCenterId, departmentId, scoped }) {
  const [rows] = await sequelize.query(`
    SELECT n.id AS "nomenclatureId", n.code, n.name AS "nomenclatureName", n.unit,
           to_char(date_trunc('month', m."occurredAt"), 'YYYY-MM') AS month,
           SUM(m.quantity) AS qty, SUM(m.amount) AS amount
    FROM warehouse_movements m
    JOIN warehouse_nomenclature n ON n.id = m."nomenclatureId"
    LEFT JOIN warehouse_rooms r   ON r.id = m."fromRoomId"
    LEFT JOIN warehouse_floors f  ON f.id = r."floorId"
    LEFT JOIN warehouse_buildings bld ON bld.id = f."buildingId"
    WHERE m.type IN ('issue', 'writeoff')
      AND m."occurredAt" >= :from AND m."occurredAt" < (:to::date + 1)
      AND (:medCenterId::uuid  IS NULL OR r."medCenterId" = :medCenterId::uuid)
      AND (:departmentId::uuid IS NULL OR r."departmentId" = :departmentId::uuid)
      AND (:scoped IS NULL OR r.id = ANY(:scoped::uuid[]))
    GROUP BY 1, 2, 3, 4, 5
  `, {
    replacements: {
      from, to,
      medCenterId: medCenterId || null,
      departmentId: departmentId || null,
      scoped: toPgUuidArray(scoped),
    },
  });

  // Полный ряд месяцев периода: пропуски заполняются нулями.
  const months = [];
  const cursor = new Date(`${String(from).slice(0, 7)}-01T00:00:00Z`);
  const last = `${String(to).slice(0, 7)}`;
  while (cursor.toISOString().slice(0, 7) <= last && months.length < 120) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const byNomenclature = new Map();
  for (const r of rows) {
    if (!byNomenclature.has(r.nomenclatureId)) {
      byNomenclature.set(r.nomenclatureId, {
        nomenclatureId: r.nomenclatureId, code: r.code,
        nomenclatureName: r.nomenclatureName, unit: r.unit,
        amount: 0, qty: 0, series: new Map(),
      });
    }
    const item = byNomenclature.get(r.nomenclatureId);
    item.amount += Number(r.amount) || 0;
    item.qty += Number(r.qty) || 0;
    item.series.set(r.month, (item.series.get(r.month) || 0) + (Number(r.qty) || 0));
  }

  const items = [...byNomenclature.values()].sort((a, b) => b.amount - a.amount);
  const total = items.reduce((s, i) => s + i.amount, 0);
  const enoughMonths = months.length >= 3;

  let cumulative = 0;
  for (const item of items) {
    cumulative += item.amount;
    const cumShare = total > 0 ? (cumulative / total) * 100 : 0;
    item.abc = cumShare <= 80 ? 'A' : cumShare <= 95 ? 'B' : 'C';
    item.sharePct = total > 0 ? round2((item.amount / total) * 100) : 0;
    item.cumulativeSharePct = round2(cumShare);

    const series = months.map(m => item.series.get(m) || 0);
    const mean = series.reduce((s, v) => s + v, 0) / series.length;
    const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : null;
    item.cv = cv === null ? null : round2(cv * 100);
    item.monthsWithConsumption = series.filter(v => v > 0).length;
    item.xyz = !enoughMonths || cv === null ? null : cv <= 0.10 ? 'X' : cv <= 0.25 ? 'Y' : 'Z';
    item.cell = item.xyz ? `${item.abc}${item.xyz}` : null;
    item.strategy = item.cell ? ABC_STRATEGY[item.cell] : null;
    item.amount = round2(item.amount);
    item.qty = round(item.qty, 3);
    delete item.series;
  }

  // Матрица 3 × 3: количество позиций и доля суммы в каждой клетке.
  const matrix = ['A', 'B', 'C'].map(abcClass => ({
    abc: abcClass,
    cells: ['X', 'Y', 'Z'].map(xyzClass => {
      const cellItems = items.filter(i => i.abc === abcClass && i.xyz === xyzClass);
      return {
        key: `${abcClass}${xyzClass}`,
        count: cellItems.length,
        amount: round2(cellItems.reduce((s, i) => s + i.amount, 0)),
        sharePct: total > 0
          ? round2((cellItems.reduce((s, i) => s + i.amount, 0) / total) * 100)
          : 0,
        strategy: ABC_STRATEGY[`${abcClass}${xyzClass}`],
      };
    }),
  }));

  return {
    header: await reportHeader({ req, code: 'RPT-CONSUMPTION', title: 'ABC/XYZ-анализ номенклатуры', from, to, filters: req.query }),
    mode: 'abc',
    monthsInPeriod: months.length,
    matrix,
    items,
    totals: { amount: round2(total), positions: items.length },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RPT-EXPIRING — Просроченные и истекающие позиции
// ─────────────────────────────────────────────────────────────────────────────
router.get('/expiring', authenticate, requireWarehouse(), requireReport('RPT-EXPIRING'), async (req, res) => {
  try {
    const { horizonDays = 90, medCenterId, departmentId, medicineOnly, sterileOnly } = req.query;

    // Сам расчёт живёт в services/warehouse/reportData.js: этот же отчёт строит
    // регламентная рассылка, и второй запрос «почти такой же» довольно быстро
    // разошёлся бы с экраном в цифрах.
    const data = await reportData.expiring({
      scopedRoomIds: await req.warehouse.scopedRoomIds(),
      horizonDays, medCenterId, departmentId, medicineOnly, sterileOnly,
    });

    res.json({
      header: await reportHeader({ req, code: 'RPT-EXPIRING', title: 'Просроченные и истекающие позиции', filters: req.query }),
      ...data,
    });
  } catch (err) {
    console.error('GET warehouse/reports/expiring error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RPT-DEPRECIATION — Ведомость амортизации
// ─────────────────────────────────────────────────────────────────────────────
// Амортизация НЕ начисляется порталом: значения приходят из бухгалтерии. Отчёт
// делает то, чего 1С не умеет — раскладывает их по кабинетам и отделениям.
router.get('/depreciation', authenticate, requireWarehouse(), requireReport('RPT-DEPRECIATION'), async (req, res) => {
  try {
    const { medCenterId, departmentId, fullyDepreciatedOnly, from, to } = req.query;
    const scoped = await req.warehouse.scopedRoomIds();
    // Период нужен колонке «Начислено за период». Без него берём текущий месяц:
    // отчёт остаётся осмысленным, а не падает на отсутствующем параметре.
    const periodTo = to || new Date().toISOString().slice(0, 10);
    const periodFrom = from
      || `${periodTo.slice(0, 7)}-01`;

    const [rows] = await sequelize.query(`
      SELECT a.id, a."inventoryNumber", a.name, a.model, a.okof, a."depreciationGroup",
             a."commissioningDate", a."usefulLifeMonths", a."depreciationMethod",
             a."initialCost", a."accumulatedDepreciation", a."depreciationAsOf",
             a."initialCost" - a."accumulatedDepreciation" AS residual,
             a.status, a."fundingSource",
             r.number AS "roomNumber", r.name AS "roomName",
             d.name AS "departmentName", bld.name AS "buildingName", mc.name AS "medCenterName",
             u."displayName" AS "responsibleName",
             c.name AS "categoryName"
      FROM warehouse_assets a
      LEFT JOIN warehouse_rooms r      ON r.id = a."roomId"
      LEFT JOIN warehouse_departments d ON d.id = r."departmentId"
      LEFT JOIN warehouse_floors f     ON f.id = r."floorId"
      LEFT JOIN warehouse_buildings bld ON bld.id = f."buildingId"
      LEFT JOIN med_centers mc         ON mc.id = r."medCenterId"
      LEFT JOIN users u                ON u.id = a."responsibleUserId"
      LEFT JOIN warehouse_categories c  ON c.id = a."categoryId"
      WHERE a."isArchived" = FALSE
        AND (:medCenterId::uuid  IS NULL OR r."medCenterId" = :medCenterId::uuid)
        AND (:departmentId::uuid IS NULL OR r."departmentId" = :departmentId::uuid)
        AND (:scoped IS NULL OR r.id = ANY(:scoped::uuid[]) OR r.id IS NULL)
      ORDER BY mc.name, d.name NULLS LAST, r.number NULLS LAST, a."inventoryNumber"
    `, {
      replacements: {
        medCenterId: medCenterId || null,
        departmentId: departmentId || null,
        scoped: toPgUuidArray(scoped),
      },
    });

    let items = rows.map(r => {
      const initial = Number(r.initialCost);
      const accumulated = Number(r.accumulatedDepreciation);
      // Начислено за период портал считает сам по графику (см. periodAccrual), а
      // накопленную сумму берёт из карточки — её ведёт бухгалтерия. Поэтому
      // «на конец» — это внесённое значение, а «на начало» выводится вычитанием:
      // так конец сходится с карточкой актива, а не спорит с ней.
      const accrued = Math.min(periodAccrual(r, periodFrom, periodTo), accumulated);
      return {
        ...r,
        initialCost: initial,
        accumulatedDepreciation: accumulated,
        accumulatedStart: round2(Math.max(0, accumulated - accrued)),
        accruedInPeriod: round2(accrued),
        accumulatedEnd: round2(accumulated),
        residual: Math.max(0, initial - accumulated),
        wearPercent: initial > 0 ? round2(Math.min(100, (accumulated / initial) * 100)) : null,
        fullyDepreciatedInUse: initial > 0 && accumulated >= initial && r.status === 'in_use',
        // Гр. 17 ТЗ. Признак — не статус: он говорит не в каком состоянии актив,
        // а что с ним пора делать.
        flag: initial > 0 && accumulated >= initial && r.status === 'in_use'
          ? 'Самортизировано, в эксплуатации — кандидат на замену'
          : null,
        // Прогноз замены: когда износ дойдёт до 100 % линейным темпом.
        forecastFullWearDate: forecastWear(r),
        // Явно говорим, что накопленная сумма внесена руками, а начисление за
        // период — расчёт портала: без этого читатель решит, что всё пришло из
        // бухгалтерии.
        dataSource: 'manual',
        accrualSource: 'calculated',
      };
    });

    if (fullyDepreciatedOnly === 'true') items = items.filter(i => i.fullyDepreciatedInUse);

    res.json({
      header: await reportHeader({ req, code: 'RPT-DEPRECIATION', title: 'Ведомость амортизации основных средств', from: periodFrom, to: periodTo, filters: req.query }),
      period: { from: periodFrom, to: periodTo },
      items,
      totals: {
        initialCost: round2(items.reduce((s, i) => s + i.initialCost, 0)),
        accruedInPeriod: round2(items.reduce((s, i) => s + i.accruedInPeriod, 0)),
        accumulated: round2(items.reduce((s, i) => s + i.accumulatedDepreciation, 0)),
        residual: round2(items.reduce((s, i) => s + i.residual, 0)),
        count: items.length,
        fullyDepreciatedInUse: {
          count: items.filter(i => i.fullyDepreciatedInUse).length,
          initialCost: round2(items.filter(i => i.fullyDepreciatedInUse).reduce((s, i) => s + i.initialCost, 0)),
        },
      },
    });
  } catch (err) {
    console.error('GET warehouse/reports/depreciation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Начислено за период по графику амортизации.
 *
 * Считается как разность накопленной суммы на конец и на начало периода по
 * формуле выбранного способа, а не «сумма за месяц × число месяцев»: у способа
 * уменьшаемого остатка помесячные суммы разные, и умножение дало бы завышение
 * тем большее, чем длиннее период.
 *
 *   линейный:              A(k) = C × min(1, k / СПИ)
 *   уменьшаемого остатка:  A(k) = C × (1 − (1 − 2/СПИ)^k)
 *
 * где k — число полных месяцев с ввода в эксплуатацию. До ввода в эксплуатацию
 * начисления нет, после исчерпания СПИ — тоже.
 */
function periodAccrual(r, from, to) {
  const initial = Number(r.initialCost);
  const months = Number(r.usefulLifeMonths);
  if (!initial || !months || !r.commissioningDate) return 0;

  const start = new Date(r.commissioningDate);
  const monthsSince = (date) => {
    const d = new Date(date);
    const diff = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
    return Math.max(0, diff);
  };

  // Коэффициент уменьшаемого остатка зажат единицей: при СПИ короче двух месяцев
  // 2/СПИ больше единицы, основание степени уходит в минус, и накопленная сумма
  // начинала прыгать между нулём и двумя стоимостями через месяц. Единица здесь
  // означает «списывается за первый же месяц» — что для такого СПИ и верно.
  const rate = Math.min(1, 2 / months);
  const accumulatedAt = (k) => (r.depreciationMethod === 'reducing'
    ? initial * (1 - Math.pow(1 - rate, Math.min(k, months)))
    : initial * Math.min(1, k / months));

  const accrued = accumulatedAt(monthsSince(to)) - accumulatedAt(monthsSince(from));
  return Math.max(0, accrued);
}

function forecastWear(r) {
  const initial = Number(r.initialCost);
  const acc = Number(r.accumulatedDepreciation);
  const months = Number(r.usefulLifeMonths);
  if (!initial || !months || acc >= initial) return null;
  const perMonth = initial / months;
  const monthsLeft = Math.ceil((initial - acc) / perMonth);
  const d = new Date();
  d.setMonth(d.getMonth() + monthsLeft);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// RPT-MAINTENANCE, режим 3 — отказы и надёжность по моделям
// ─────────────────────────────────────────────────────────────────────────────
router.get('/reliability', authenticate, requireWarehouse(), requireReport('RPT-MAINTENANCE-3'), async (req, res) => {
  try {
    // Группировка по модели идёт через CTE, а не коррелированным подзапросом:
    // подзапрос ссылался бы на a.model, которого после GROUP BY уже не существует
    // («subquery uses ungrouped column»). Плюс так каждая таблица читается один раз.
    const [rows] = await sequelize.query(`
      WITH park AS (
        SELECT a.id, COALESCE(NULLIF(a.model, ''), a.name) AS model
        FROM warehouse_assets a
        WHERE a."isArchived" = FALSE
      ),
      units AS (
        SELECT model, COUNT(*)::int AS "unitsInPark" FROM park GROUP BY model
      ),
      rep AS (
        SELECT p.model,
               COUNT(rp.id)::int AS repairs,
               COALESCE(SUM(rp."downtimeHours"), 0) AS "downtimeHours",
               COALESCE(SUM(rp.cost), 0) AS "repairCost"
        FROM park p
        JOIN warehouse_repairs rp
          ON rp."assetId" = p.id AND rp."startedAt" > CURRENT_DATE - interval '12 months'
        GROUP BY p.model
      ),
      maint AS (
        SELECT p.model, COALESCE(SUM(m.cost), 0) AS "maintenanceCost"
        FROM park p
        JOIN warehouse_maintenance_orders m
          ON m."assetId" = p.id AND m."factDate" > CURRENT_DATE - interval '12 months'
        GROUP BY p.model
      )
      SELECT u.model, u."unitsInPark",
             COALESCE(r.repairs, 0)             AS repairs,
             COALESCE(r."downtimeHours", 0)     AS "downtimeHours",
             COALESCE(r."repairCost", 0)        AS "repairCost",
             COALESCE(mt."maintenanceCost", 0)  AS "maintenanceCost"
      FROM units u
      LEFT JOIN rep r   ON r.model = u.model
      LEFT JOIN maint mt ON mt.model = u.model
      ORDER BY COALESCE(r.repairs, 0) DESC, COALESCE(r."repairCost", 0) DESC
    `);

    const items = rows.map(r => {
      const units = r.unitsInPark;
      const repairs = r.repairs;
      const repairCost = Number(r.repairCost);
      const maintCost = Number(r.maintenanceCost);
      return {
        ...r,
        downtimeHours: Number(r.downtimeHours),
        repairCost, maintenanceCost: maintCost,
        // MTBF в днях: наработка на отказ по парку за год.
        mtbfDays: repairs > 0 ? Math.round((365 * units) / repairs) : null,
        ownershipCostPerUnitYear: units > 0 ? round2((repairCost + maintCost) / units) : 0,
        // Без отказов MTBF не определён — показывать «365» было бы враньём.
        reliabilityZone: repairs === 0 ? 'green'
          : (365 * units) / repairs > 365 ? 'green'
          : (365 * units) / repairs > 200 ? 'yellow' : 'red',
      };
    });

    res.json({
      header: await reportHeader({ req, code: 'RPT-MAINTENANCE-3', title: 'Отказы и надёжность по моделям', filters: req.query }),
      items,
    });
  } catch (err) {
    console.error('GET warehouse/reports/reliability error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RPT-MOVEMENT, режим 3 — матрица межотделенческих перемещений
// ─────────────────────────────────────────────────────────────────────────────
router.get('/transfer-matrix', authenticate, requireWarehouse(), requireReport('RPT-MOVEMENT'), async (req, res) => {
  try {
    const { from, to } = req.query;
    const [rows] = await sequelize.query(`
      SELECT df.id AS "fromId", df.name AS "fromName",
             dt.id AS "toId", dt.name AS "toName",
             COUNT(*)::int AS transfers
      FROM warehouse_movements m
      JOIN warehouse_rooms rf ON rf.id = m."fromRoomId"
      JOIN warehouse_rooms rt ON rt.id = m."toRoomId"
      JOIN warehouse_departments df ON df.id = rf."departmentId"
      JOIN warehouse_departments dt ON dt.id = rt."departmentId"
      WHERE m.type = 'transfer' AND df.id <> dt.id
        AND (:from::date IS NULL OR m."occurredAt" >= :from::date)
        AND (:to::date IS NULL OR m."occurredAt" < (:to::date + 1))
      GROUP BY 1,2,3,4
      ORDER BY transfers DESC
    `, { replacements: { from: from || null, to: to || null } });

    const departments = [...new Map(
      rows.flatMap(r => [[r.fromId, r.fromName], [r.toId, r.toName]])
    ).entries()].map(([id, name]) => ({ id, name }));

    res.json({
      header: await reportHeader({ req, code: 'RPT-MOVEMENT-3', title: 'Матрица межотделенческих перемещений', from, to }),
      departments,
      cells: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RPT-ROOM-DASH — Дашборд кабинета
// ─────────────────────────────────────────────────────────────────────────────
router.get('/room/:roomId/dashboard', authenticate, requireWarehouse(), requireReport('RPT-ROOM-DASH'), async (req, res) => {
  try {
    const room = await WhRoom.findByPk(req.params.roomId, {
      include: [
        { model: WhDepartment, as: 'department' },
        { model: User, as: 'responsible', attributes: userAttrs },
        { model: MedCenter, as: 'medCenter' },
        { model: WhFloor, as: 'floor', include: [{ model: WhBuilding, as: 'building', include: [{ model: MedCenter, as: 'medCenter' }] }] },
      ],
    });
    if (!room) return res.status(404).json({ error: 'Кабинет не найден' });

    const scoped = await req.warehouse.scopedRoomIds();
    if (scoped !== null && !scoped.includes(room.id)) {
      return res.status(403).json({ error: 'Кабинет не в вашей зоне ответственности' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const [assets, stockRows, maintenance, utilRow] = await Promise.all([
      WhAsset.findAll({
        where: { roomId: room.id, isArchived: false },
        include: [{ model: User, as: 'responsible', attributes: userAttrs }],
        order: [['name', 'ASC']],
      }),
      sequelize.query(`
        SELECT s.id AS "stockId", s.quantity, s."unitCost", n.name, n.unit, n.id AS "nomenclatureId",
               b."batchNumber", b."expiryDate", (b."expiryDate" - CURRENT_DATE) AS "daysLeft",
               st.name AS "storageName",
               (SELECT rr."minQty" FROM warehouse_reorder_rules rr
                 WHERE rr."nomenclatureId" = n.id AND (rr."roomId" = :roomId OR rr."storageId" = st.id
                       OR (rr."roomId" IS NULL AND rr."storageId" IS NULL))
                 ORDER BY rr."storageId" NULLS LAST, rr."roomId" NULLS LAST LIMIT 1) AS "minQty"
        FROM warehouse_stock s
        JOIN warehouse_nomenclature n ON n.id = s."nomenclatureId"
        JOIN warehouse_storages st ON st.id = s."storageId"
        LEFT JOIN warehouse_batches b ON b.id = s."batchId"
        WHERE st."roomId" = :roomId AND s.quantity > 0
        ORDER BY n.name
      `, { replacements: { roomId: room.id }, type: sequelize.QueryTypes.SELECT }),
      WhMaintenanceOrder.findAll({
        where: { status: { [Op.ne]: 'done' } },
        include: [{ model: WhAsset, as: 'asset', required: true, where: { roomId: room.id }, attributes: ['id', 'inventoryNumber', 'name'] }],
        order: [['plannedDate', 'ASC']],
      }),
      utilization.aggregate({
        floorId: room.floorId,
        from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
        to: today,
      }),
    ]);

    const stock = stockRows.map(s => ({
      ...s,
      quantity: Number(s.quantity),
      amount: round2(Number(s.quantity) * Number(s.unitCost)),
      minQty: s.minQty === null ? null : Number(s.minQty),
      stockStatus: s.minQty === null ? 'unknown'
        : Number(s.quantity) < Number(s.minQty) ? 'below'
        : Number(s.quantity) < Number(s.minQty) * 1.2 ? 'near' : 'ok',
      expired: s.expiryDate ? s.expiryDate < today : false,
      expiringSoon: s.expiryDate ? s.expiryDate >= today && s.expiryDate <= in30 : false,
    }));

    const util = (utilRow || []).find(u => u.roomId === room.id);

    // Блок «Требуют внимания» — собран здесь, а не на клиенте: это единственное
    // место, где сходятся просрочка, минимумы, ремонты и ТО.
    const attention = [];
    for (const s of stock.filter(x => x.expired)) {
      attention.push({ level: 'red', kind: 'expired', text: `${s.name}, серия ${s.batchNumber} — просрочено ${fmt(s.expiryDate)}, ${s.quantity} ${s.unit} → СПИСАТЬ` });
    }
    for (const s of stock.filter(x => x.stockStatus === 'below')) {
      attention.push({ level: 'red', kind: 'below_min', text: `${s.name} — остаток ${s.quantity} ${s.unit} при минимуме ${s.minQty}` });
    }
    for (const a of assets.filter(x => x.status === 'repair')) {
      attention.push({ level: 'red', kind: 'repair', text: `${a.name} — в ремонте` });
    }
    for (const o of maintenance.filter(m => m.plannedDate <= in30)) {
      const days = Math.round((new Date(o.plannedDate) - new Date(today)) / 86400000);
      attention.push({
        level: days < 0 ? 'red' : 'yellow',
        kind: 'maintenance',
        text: days < 0
          ? `${o.asset.name} — ТО просрочено на ${Math.abs(days)} дн. (наряд ${o.number})`
          : `${o.asset.name} — ТО через ${days} дн. (${fmt(o.plannedDate)}, наряд ${o.number})`,
      });
    }
    for (const s of stock.filter(x => x.expiringSoon)) {
      attention.push({ level: 'orange', kind: 'expiring', text: `${s.name}, серия ${s.batchNumber} — истекает ${fmt(s.expiryDate)}` });
    }

    res.json({
      header: await reportHeader({ req, code: 'RPT-ROOM-DASH', title: `Кабинет ${room.number}`, filters: {} }),
      room: {
        id: room.id, number: room.number, name: room.name, kind: room.kind,
        department: room.department, responsible: room.responsible,
        floor: room.floor?.number, building: room.floor?.building?.name,
        medCenter: room.medCenter?.displayName || room.medCenter?.name
          || room.floor?.building?.medCenter?.displayName || room.floor?.building?.medCenter?.name,
        path: await roomPath(room.id),
      },
      cards: {
        assets: {
          total: assets.length,
          inUse: assets.filter(a => a.status === 'in_use').length,
          maintenance: assets.filter(a => a.status === 'maintenance').length,
          repair: assets.filter(a => a.status === 'repair').length,
        },
        materials: {
          positions: stock.length,
          value: round2(stock.reduce((s, i) => s + i.amount, 0)),
          belowMin: stock.filter(s => s.stockStatus === 'below').length,
          nearMin: stock.filter(s => s.stockStatus === 'near').length,
        },
        expiry: {
          expired: stock.filter(s => s.expired).length,
          within30: stock.filter(s => s.expiringSoon).length,
        },
        maintenance: {
          open: maintenance.length,
          nextDate: maintenance[0]?.plannedDate || null,
          overdue: maintenance.filter(m => m.plannedDate < today).length,
        },
        // Загрузка отдаётся с признаком наличия данных: «нет расчёта» и «0 %» —
        // разные вещи, и на дашборде их путать нельзя.
        utilization: util ? {
          percent: util.avgPct, zone: util.zone, hasData: util.hasData,
        } : { percent: null, zone: 'unknown', hasData: false },
      },
      assets,
      stock,
      maintenance,
      attention: attention.sort((a, b) => zoneWeight(a.level) - zoneWeight(b.level)),
    });
  } catch (err) {
    console.error('GET warehouse/reports/room dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

function zoneWeight(l) {
  return { red: 0, orange: 1, yellow: 2, green: 3 }[l] ?? 9;
}

function fmt(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('ru-RU');
}

// ─────────────────────────────────────────────────────────────────────────────
// RPT-INVENTORY — Инвентаризационная опись (ИНВ-1)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/inventory/:id', authenticate, requireWarehouse(), requireReport('RPT-INVENTORY'), async (req, res) => {
  try {
    const session = await WhInventorySession.findByPk(req.params.id, {
      include: [
        { model: WhRoom, as: 'room', include: [{ model: WhDepartment, as: 'department' }] },
        { model: WhDepartment, as: 'department' },
        { model: User, as: 'chairman', attributes: userAttrs },
        { model: User, as: 'responsible', attributes: userAttrs },
        {
          model: WhInventoryItem, as: 'items',
          include: [
            { model: WhAsset, as: 'asset', attributes: ['id', 'inventoryNumber', 'name', 'model', 'status', 'roomId'] },
            { model: WhNomenclature, as: 'nomenclature', attributes: ['id', 'code', 'name', 'unit'] },
            { model: WhBatch, as: 'batch', attributes: ['id', 'batchNumber'] },
            { model: WhStorage, as: 'storage', attributes: ['id', 'name'] },
          ],
        },
      ],
    });
    if (!session) return res.status(404).json({ error: 'Опись не найдена' });

    const items = (session.items || []).map((i, idx) => {
      const expected = Number(i.expectedQty);
      const actual = i.actualQty === null ? null : Number(i.actualQty);
      return {
        rowNumber: idx + 1,
        id: i.id,
        inventoryNumber: i.asset?.inventoryNumber || i.nomenclature?.code,
        name: i.asset ? [i.asset.name, i.asset.model].filter(Boolean).join(' ') : i.nomenclature?.name,
        unit: i.nomenclature?.unit || 'шт',
        storage: i.storage?.name,
        batchNumber: i.batch?.batchNumber,
        expectedQty: expected,
        actualQty: actual,
        difference: actual === null ? null : actual - expected,
        scanMethod: i.scanMethod,
        scannedAt: i.scannedAt,
        note: i.note,
      };
    });

    const counted = items.filter(i => i.actualQty !== null);
    res.json({
      header: await reportHeader({
        req, code: 'RPT-INVENTORY',
        title: 'Инвентаризационная опись основных средств (форма ИНВ-1, адаптированная)',
      }),
      session: {
        number: session.number, basis: session.basis, status: session.status,
        location: session.room ? await roomPath(session.room.id) : session.department?.name,
        responsible: session.responsible, chairman: session.chairman, members: session.members,
        startedAt: session.startedAt, finishedAt: session.finishedAt,
        durationMinutes: session.durationMinutes,
      },
      items,
      totals: {
        expected: items.reduce((s, i) => s + i.expectedQty, 0),
        actual: counted.reduce((s, i) => s + (i.actualQty || 0), 0),
        shortage: items.filter(i => i.difference !== null && i.difference < 0).length,
        surplus: items.filter(i => i.difference !== null && i.difference > 0).length,
        scannedByQr: counted.filter(i => i.scanMethod === 'qr').length,
        scannedManually: counted.filter(i => i.scanMethod === 'manual').length,
        qrSharePct: counted.length ? round2((counted.filter(i => i.scanMethod === 'qr').length / counted.length) * 100) : null,
      },
    });
  } catch (err) {
    console.error('GET warehouse/reports/inventory error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Выгрузки
// ─────────────────────────────────────────────────────────────────────────────
router.post('/export', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const { format = 'xlsx', code, header, items, totals, columns } = req.body;
    if (!code || !Array.isArray(items)) return res.status(400).json({ error: 'Нужны code и items' });

    // Выгрузка — тот же доступ, что и просмотр: иначе отчёт, закрытый на экране,
    // забирался бы файлом.
    const permsSvc = require('../../services/warehouse/permissions');
    if (permsSvc.REPORTS[code] && !permsSvc.canReadReport(req.warehouse.perms, code)) {
      return res.status(403).json({ error: `Отчёт «${permsSvc.REPORTS[code].label}» вам недоступен` });
    }

    if (format === 'xlsx') {
      const buffer = await exports_.toXlsx({ code, header, items, totals, columns });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${code}-${Date.now()}.xlsx`)}`);
      return res.send(buffer);
    }
    if (format === 'pdf') {
      const buffer = await exports_.toPdf({ code, header, items, totals, columns });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${code}-${Date.now()}.pdf`)}`);
      return res.send(buffer);
    }
    res.status(400).json({ error: 'Формат не поддерживается. XML для 1С не выгружается: обмен выключен' });
  } catch (err) {
    console.error('POST warehouse/reports/export error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Список UUID в текстовый литерал массива Postgres: '{uuid,uuid}'.
 *
 * Sequelize подставляет JS-массив как список значений через запятую, и выражение
 * ANY(:scoped::uuid[]) на нём падает («op ANY requires array on right side»), а на
 * массиве из одного элемента — тихо превращается в скаляр. Литерал снимает оба
 * случая. null означает «ограничений нет» и проверяется как :scoped IS NULL.
 */
function toPgUuidArray(ids) {
  if (ids === null || ids === undefined) return null;
  return `{${ids.join(',')}}`;
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

/**
 * Округляет суммируемые поля строки. Суммы копятся с плавающей точкой, и без
 * этого в подытогах вылезают хвосты вида 1264929.9999999998.
 */
function roundRow(row, measures) {
  const out = { ...row };
  for (const m of measures) {
    if (out[m] !== undefined && out[m] !== null) {
      out[m] = /Qty$/.test(m) ? Math.round(Number(out[m]) * 1000) / 1000 : round2(out[m]);
    }
  }
  return out;
}
function round(n, digits = 2) {
  if (typeof n === 'object' && n !== null) {
    const out = {};
    for (const [k, v] of Object.entries(n)) out[k] = round2(v);
    return out;
  }
  const f = 10 ** digits;
  return Math.round(Number(n) * f) / f;
}

module.exports = router;
