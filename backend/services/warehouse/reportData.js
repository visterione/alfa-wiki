/**
 * Данные отчётов отдельно от маршрутов.
 *
 * Отчёт нужен теперь не только экрану: регламентная рассылка строит те же строки
 * ночью, без запроса и без req. Оставить расчёт в обработчике значило бы либо
 * ходить письмом в собственный HTTP-эндпоинт с сервисным токеном, либо завести
 * второй запрос «почти такой же» — и через месяц экран и письмо разошлись бы в
 * цифрах, а какой из них прав, выяснялось бы на совещании.
 *
 * Поэтому здесь чистые функции: на вход область видимости и параметры отбора, на
 * выход строки и итоги. Права проверяет тот, кто вызывает: маршрут — по req,
 * рассылка — по правам получателя.
 */

const { sequelize, Organization } = require('../../models');

/** Список UUID в литерал массива Postgres — см. одноимённую функцию в reports.js. */
function toPgUuidArray(ids) {
  if (ids === null || ids === undefined) return null;
  return `{${ids.join(',')}}`;
}

const round2 = n => Math.round(Number(n) * 100) / 100;
const round = (n, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(Number(n) * f) / f;
};

/**
 * Единая шапка выгрузки (раздел 1.0 ТЗ) для случая, когда запроса нет.
 *
 * Обработчик отчёта собирает шапку из req — там есть и пользователь, и разобранный
 * отбор. У рассылки req нет, а шапка в файле нужна та же самая: этот же XLSX
 * прикладывают к акту. Поля называются так же, как их читает exports.toXlsx.
 */
async function headerFor({ code, title, generatedBy, filterText, period = null }) {
  let organization = null;
  try {
    const org = await Organization.findOne({
      where: { isActive: true }, order: [['sortOrder', 'ASC']], attributes: ['name'],
    });
    organization = org?.name || null;
  } catch {
    // Справочник не ответил — шапка не повод не отправить отчёт.
  }

  return {
    code, title, organization, period,
    generatedAt: new Date().toISOString(),
    generatedBy: generatedBy || 'Регламентная рассылка',
    system: 'Alfa-Wiki, складской учёт',
    filters: {},
    filterText: filterText || 'без дополнительного отбора',
    filterList: [],
  };
}

/**
 * RPT-EXPIRING. Просроченные и истекающие позиции.
 *
 * @param {object}        params
 * @param {string[]|null} params.scopedRoomIds  null — вся сеть
 * @param {number}        [params.horizonDays]  горизонт в днях
 */
async function expiring({
  scopedRoomIds = null, horizonDays = 90,
  medCenterId = null, departmentId = null, medicineOnly = false, sterileOnly = false,
} = {}) {
  const [rows] = await sequelize.query(`
    SELECT n.id AS "nomenclatureId", n.code, n.name AS "nomenclatureName", n.unit,
           n."isMedicine", n."isSterile",
           b.id AS "batchId", b."batchNumber", b."expiryDate",
           (b."expiryDate" - CURRENT_DATE) AS "daysLeft",
           s.quantity, s."unitCost", s.quantity * s."unitCost" AS amount,
           st.id AS "storageId", st.name AS "storageName",
           r.id AS "roomId", r.number AS "roomNumber", r.name AS "roomName",
           d.name AS "departmentName", mc.name AS "medCenterName",
           r."responsibleUserId",
           u."displayName" AS "responsibleName",
           sup.name AS "supplierName",
           -- Средний расход в месяц за последние полгода: без него «успеем ли
           -- израсходовать» превращается в гадание.
           (SELECT COALESCE(SUM(m.quantity), 0) / 6.0
              FROM warehouse_movements m
             WHERE m."nomenclatureId" = n.id AND m.type = 'issue'
               AND m."occurredAt" > now() - interval '6 months') AS "avgMonthly"
    FROM warehouse_stock s
    JOIN warehouse_batches b       ON b.id = s."batchId"
    JOIN warehouse_nomenclature n  ON n.id = s."nomenclatureId"
    JOIN warehouse_storages st     ON st.id = s."storageId"
    JOIN warehouse_rooms r         ON r.id = st."roomId"
    LEFT JOIN warehouse_floors f        ON f.id = r."floorId"
    JOIN med_centers mc                 ON mc.id = r."medCenterId"
    LEFT JOIN warehouse_departments d ON d.id = r."departmentId"
    LEFT JOIN users u              ON u.id = r."responsibleUserId"
    LEFT JOIN warehouse_contractors sup ON sup.id = b."supplierId"
    WHERE s.quantity > 0 AND b."expiryDate" IS NOT NULL
      AND b."expiryDate" <= CURRENT_DATE + (:horizon || ' days')::interval
      AND (:medCenterId::uuid  IS NULL OR r."medCenterId" = :medCenterId::uuid)
      AND (:departmentId::uuid IS NULL OR r."departmentId" = :departmentId::uuid)
      AND (:medicineOnly::bool IS NOT TRUE OR n."isMedicine" = TRUE)
      AND (:sterileOnly::bool  IS NOT TRUE OR n."isSterile" = TRUE)
      AND (:scoped IS NULL OR r.id = ANY(:scoped::uuid[]))
    ORDER BY b."expiryDate" ASC
  `, {
    replacements: {
      horizon: Number(horizonDays) || 90,
      medCenterId: medCenterId || null,
      departmentId: departmentId || null,
      medicineOnly: medicineOnly === true || medicineOnly === 'true',
      sterileOnly: sterileOnly === true || sterileOnly === 'true',
      scoped: toPgUuidArray(scopedRoomIds),
    },
  });

  const items = rows.map(r => {
    const days = Number(r.daysLeft);
    const qty = Number(r.quantity);
    const avgMonthly = Number(r.avgMonthly) || 0;
    // Успеем ли израсходовать до срока при текущем темпе.
    const monthsLeft = days / 30;
    const willConsume = avgMonthly > 0 ? avgMonthly * monthsLeft >= qty : null;
    const exhaustionDate = avgMonthly > 0
      ? new Date(Date.now() + (qty / avgMonthly) * 30 * 86400000).toISOString().slice(0, 10)
      : null;

    return {
      ...r,
      quantity: qty,
      unitCost: Number(r.unitCost),
      amount: round2(Number(r.amount)),
      daysLeft: days,
      zone: days < 0 || days <= 7 ? 'red' : days <= 30 ? 'orange' : days <= 90 ? 'yellow' : 'green',
      avgMonthly: round(avgMonthly, 2),
      willConsumeInTime: willConsume,
      exhaustionDate,
      recommendation: days < 0 ? 'СПИСАТЬ немедленно'
        : days <= 7 ? 'Срочно израсходовать или списать'
        : willConsume === false ? 'Не успеем израсходовать — перевести туда, где расход выше'
        : willConsume === true ? 'Успеем израсходовать при текущем темпе'
        : 'Нет истории расхода — оценить вручную',
    };
  });

  return {
    items,
    summary: {
      expired: sumZone(items, 'red', true),
      within30: sumZone(items, 'orange'),
      within90: sumZone(items, 'yellow'),
      // Потери за 12 месяцев по факту списаний с причиной «просрочка».
      writeOffLast12Months: await writeOffLosses(),
    },
  };
}

function sumZone(items, zone, includeNegative = false) {
  const rows = items.filter(i => i.zone === zone || (includeNegative && i.daysLeft < 0));
  return { count: rows.length, amount: round2(rows.reduce((s, i) => s + i.amount, 0)) };
}

async function writeOffLosses() {
  const [rows] = await sequelize.query(`
    SELECT COALESCE(SUM(m.amount), 0) AS amount, COUNT(*)::int AS cnt
    FROM warehouse_movements m
    WHERE m.type = 'writeoff' AND m."occurredAt" > now() - interval '12 months'
      AND (m."reasonCode" = 'expired' OR m."reasonText" ILIKE '%срок%')
  `);
  return { amount: round2(Number(rows[0].amount)), count: rows[0].cnt };
}

/**
 * Позиции ниже минимального остатка. Правило выбора минимума то же, что в
 * дашборде кабинета: точнее заданное побеждает — место хранения, затем кабинет,
 * затем общее правило на позицию.
 */
async function belowMinimum({ scopedRoomIds = null } = {}) {
  const [rows] = await sequelize.query(`
    SELECT n.id AS "nomenclatureId", n.name AS "nomenclatureName", n.code, n.unit,
           s.quantity, s."unitCost",
           st.id AS "storageId", st.name AS "storageName",
           r.id AS "roomId", r.number AS "roomNumber", r.name AS "roomName",
           d.name AS "departmentName", mc.name AS "medCenterName",
           u."displayName" AS "responsibleName",
           rr."minQty", rr."maxQty"
    FROM warehouse_stock s
    JOIN warehouse_nomenclature n ON n.id = s."nomenclatureId"
    JOIN warehouse_storages st    ON st.id = s."storageId"
    JOIN warehouse_rooms r        ON r.id = st."roomId"
    JOIN med_centers mc           ON mc.id = r."medCenterId"
    LEFT JOIN warehouse_departments d ON d.id = r."departmentId"
    LEFT JOIN users u             ON u.id = r."responsibleUserId"
    JOIN LATERAL (
      SELECT x."minQty", x."maxQty"
      FROM warehouse_reorder_rules x
      WHERE x."nomenclatureId" = n.id
        AND (x."storageId" = st.id OR x."roomId" = r.id
             OR (x."storageId" IS NULL AND x."roomId" IS NULL))
      ORDER BY x."storageId" NULLS LAST, x."roomId" NULLS LAST
      LIMIT 1
    ) rr ON TRUE
    WHERE s.quantity < rr."minQty"
      AND (:scoped IS NULL OR r.id = ANY(:scoped::uuid[]))
    ORDER BY (rr."minQty" - s.quantity) DESC
  `, { replacements: { scoped: toPgUuidArray(scopedRoomIds) } });

  const items = rows.map(r => ({
    ...r,
    quantity: Number(r.quantity),
    minQty: Number(r.minQty),
    maxQty: r.maxQty === null ? null : Number(r.maxQty),
    deficit: round(Number(r.minQty) - Number(r.quantity), 3),
    // Сколько дозаказать: до максимума, если он задан, иначе до минимума.
    toOrder: round((r.maxQty === null ? Number(r.minQty) : Number(r.maxQty)) - Number(r.quantity), 3),
  }));

  return {
    items,
    summary: { count: items.length, amount: round2(items.reduce((s, i) => s + i.toOrder * Number(i.unitCost || 0), 0)) },
  };
}

module.exports = { expiring, belowMinimum, headerFor, toPgUuidArray };
