/**
 * Расчёт загрузки кабинетов — источник данных для тепловой карты.
 *
 * ── Почему методика отличается от ТЗ ─────────────────────────────────────────
 *
 * В ТЗ used_hours складывается из часов приёма из МИС и часов использования по
 * журналу выдачи (issue → return). Второе слагаемое на практике будет нулём:
 * журнал выдачи ведут для расходников, а стационарный УЗИ-аппарат из кабинета
 * никто не «выдаёт» и не «возвращает». Если считать по этой формуле как
 * написано, тепловая карта покажет всё зелёным, и модулю перестанут верить с
 * первой же демонстрации.
 *
 * Поэтому загрузка считается из mis_appointments — записи расписания с кабинетом,
 * временем начала и конца. Это единственный источник в системе, который заполняется
 * сам и без участия персонала. Журнал выдачи учитывается как второе слагаемое
 * там, где он реально ведётся (переносное оборудование), и тогда в source
 * попадает 'mixed' — чтобы по строке было видно, чему верить.
 *
 * Отдельно считается простой (idle): актив, не участвовавший ни в одной операции
 * ≥ 14 дней. Это честная метрика — она не требует ничего, кроме журнала движений,
 * который модуль и так ведёт. Именно её надо показывать, когда спрашивают «что у
 * нас лежит без дела», а не расчётную «экономию на закупках».
 *
 * ── Чего эта метрика НЕ показывает ───────────────────────────────────────────
 *
 * Загрузка кабинета — это не загрузка оборудования в нём. Если в кабинете 312
 * приём идёт 7 часов из 8, это не значит, что УЗИ работал 7 часов: он мог не
 * включаться. Поэтому в тепловой карте цвет означает «сколько занят кабинет», а
 * простой оборудования — отдельный переключатель показателя. Смешивать их в одно
 * число нельзя, и «рекомендации по перераспределению с экономией N рублей» из ТЗ
 * здесь намеренно не реализованы: посчитать их из этих данных нельзя, а
 * придуманная цифра стоит дороже, чем отсутствие блока.
 */

const { Op } = require('sequelize');
const {
  sequelize, WhRoom, WhFloor, WhBuilding, WhUtilizationDaily,
  WhAsset, WhMaintenanceOrder, WhRepair, MedCenter,
} = require('../../models');

// Порог простоя из ТЗ.
const IDLE_DAYS = 14;

// Зоны раскраски. Совпадают с ТЗ: G < 60 %, Y 60–85 %, R > 85 %.
const ZONES = { green: 60, yellow: 85 };

function zoneOf(pct) {
  if (pct === null || pct === undefined) return 'unknown';
  if (pct < ZONES.green) return 'green';
  if (pct <= ZONES.yellow) return 'yellow';
  return 'red';
}

/**
 * Считает загрузку всех кабинетов за одну дату и пишет в warehouse_utilization_daily.
 *
 * Сопоставление кабинета с МИС идёт по misRoomAliases (регистронезависимо) и по
 * clinic_id медцентра. Кабинет без алиасов в расчёт не попадает — и это видно в
 * отчёте о расчёте, а не молча превращается в ноль.
 */
async function computeForDate(date) {
  const day = toDateOnly(date);

  const rooms = await WhRoom.findAll({
    where: { isActive: true },
    include: [
      { model: MedCenter, as: 'medCenter' },
      {
        model: WhFloor, as: 'floor',
        include: [{ model: WhBuilding, as: 'building', include: [{ model: MedCenter, as: 'medCenter' }] }],
      },
    ],
  });

  // Приёмы за сутки одним запросом: по кабинету их десятки, а кабинетов сотни —
  // выборка на каждый кабинет отдельно превратилась бы в N+1.
  // Занятые часы — это объединение интервалов приёма, а не сумма их длительностей.
  // В одном кабинете принимают несколько врачей, и слоты пересекаются: по сумме
  // длительностей загрузка выходила 100–390 %, то есть кабинет якобы работал
  // четверо суток в сутки. Ниже классическое «gaps and islands»: соседние и
  // перекрывающиеся интервалы склеиваются в один, и уже они складываются.
  //
  // Статусы МИС: 1/2/3 — предстоящие, 4 — completed, 5 — refused. Загрузку дают
  // состоявшиеся приёмы, поэтому исключается только отказ. Пока здесь
  // отфильтровывались и 4, и 5, в расчёт не попадало 210 тысяч завершённых
  // приёмов из 285 — и загрузка была нулевой почти везде.
  const [appointments] = await sequelize.query(`
    WITH src AS (
      SELECT clinic_id, room, time_start, time_end
      FROM mis_appointments
      WHERE time_start >= :from AND time_start < :to
        AND room IS NOT NULL AND time_end IS NOT NULL
        AND time_end > time_start
        AND (status_id IS NULL OR status_id <> 5)
    ),
    marked AS (
      SELECT *,
             CASE WHEN time_start > MAX(time_end) OVER (
                    PARTITION BY clinic_id, room ORDER BY time_start
                    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                  ) THEN 1 ELSE 0 END AS is_new
      FROM src
    ),
    grouped AS (
      SELECT *, SUM(is_new) OVER (
               PARTITION BY clinic_id, room ORDER BY time_start
             ) AS island
      FROM marked
    ),
    islands AS (
      SELECT clinic_id, room, island,
             MIN(time_start) AS s, MAX(time_end) AS e, COUNT(*) AS appts
      FROM grouped
      GROUP BY clinic_id, room, island
    )
    SELECT clinic_id, room,
           SUM(EXTRACT(EPOCH FROM (e - s)) / 3600.0) AS hours,
           SUM(appts) AS cnt
    FROM islands
    GROUP BY clinic_id, room
  `, {
    replacements: { from: `${day} 00:00:00`, to: `${day} 23:59:59` },
  });

  // Индекс МИС: у одной записи несколько ключей, потому что кабинет там пишут
  // как угодно — «415 Лаборатория», «Рентген», «Линия Кабинет 23». Один
  // нормализованный ключ такое не покрывает, см. roomKeys.
  const misByKey = new Map();
  for (const a of appointments) {
    const value = { hours: Number(a.hours) || 0, count: Number(a.cnt) || 0, raw: a.room };
    for (const key of roomKeys(a.room)) {
      const full = `${a.clinic_id}|${key}`;
      // Один ключ может достаться двум записям МИС («202» и «202 Смотровая»);
      // складываем, а не перезаписываем — иначе часть приёмов потеряется.
      const prev = misByKey.get(full);
      if (prev) {
        prev.hours += value.hours;
        prev.count += value.count;
      } else {
        misByKey.set(full, { ...value });
      }
    }
  }

  // Простой оборудования и часы недоступности по ТО/ремонту.
  const idleBefore = new Date(Date.now() - IDLE_DAYS * 86400000);
  const assets = await WhAsset.findAll({
    where: { isArchived: false },
    attributes: ['id', 'roomId', 'status', 'lastActivityAt', 'dailyCapacityHours'],
  });
  const downtime = await downtimeByRoom(day);

  const results = [];
  const unmatched = [];

  for (const room of rooms) {
    // Медцентр берётся с самого кабинета: он был у него всегда, а путь через
    // корпус остаётся запасным для кабинетов, у которых он почему-то пуст.
    const clinicIds = room.medCenter?.misClinicIds
      || room.floor?.medCenter?.misClinicIds
      || room.floor?.building?.medCenter?.misClinicIds || [];

    // Ключи кабинета: из его номера и из всех заданных алиасов.
    const keys = new Set();
    for (const k of roomKeys(room.number)) keys.add(k);
    for (const alias of room.misRoomAliases || []) {
      for (const k of roomKeys(alias)) keys.add(k);
    }

    let usedHours = 0;
    let appointmentsCount = 0;
    let matched = false;
    // Один ключ МИС нельзя засчитать кабинету дважды: у «415» и «415 Лаборатория»
    // ключ #415 общий, и без этой защиты часы удвоились бы.
    const consumed = new Set();

    for (const cid of clinicIds.length ? clinicIds : [null]) {
      for (const key of keys) {
        const full = `${cid}|${key}`;
        const hit = misByKey.get(full);
        if (!hit || consumed.has(hit.raw)) continue;
        consumed.add(hit.raw);
        usedHours += hit.hours;
        appointmentsCount += hit.count;
        matched = true;
      }
    }

    if (!matched && (room.misRoomAliases || []).length === 0) {
      unmatched.push({ roomId: room.id, number: room.number });
    }

    const roomAssets = assets.filter(a => a.roomId === room.id);
    const idleAssets = roomAssets.filter(a =>
      a.status === 'in_use' && (!a.lastActivityAt || a.lastActivityAt < idleBefore)
    ).length;

    // Простой оборудования НЕ вычитается из доступных часов кабинета. Сначала
    // вычитался — и кабинет с тремя приборами в ремонте получал availableHours
    // около нуля, а загрузку в 291 %. Это была подмена понятий: кабинет не
    // закрывается из-за сломанного прибора, он продолжает работать свою смену.
    // Простой остаётся отдельным показателем — он про оборудование, не про кабинет.
    const roomDowntime = downtime.get(room.id) || 0;
    const availableHours = Number(room.capacityHours);
    // Больше 100 % — не артефакт, а сигнал: кабинет работал дольше заявленной
    // суточной ёмкости, то есть capacityHours в его карточке занижен. Поэтому не
    // срезаем в 100. Но и не даём улететь: больше 200 % за сутки при честной
    // склейке интервалов означает мусор в расписании, а не рекорд.
    const utilizationPct = availableHours > 0
      ? Math.min(200, (usedHours / availableHours) * 100)
      : 0;

    results.push({
      roomId: room.id,
      date: day,
      usedHours: round2(usedHours),
      availableHours: round2(availableHours),
      utilizationPct: round2(utilizationPct),
      appointmentsCount,
      idleAssets,
      downtimeHours: round2(roomDowntime),
      source: 'mis_schedule',
      computedAt: new Date(),
    });
  }

  // upsert: пересчёт за ту же дату должен переписывать, а не плодить строки.
  for (const row of results) {
    await WhUtilizationDaily.upsert(row);
  }

  return { date: day, rooms: results.length, unmatchedRooms: unmatched };
}

/**
 * Часы недоступности кабинета за сутки: пока прибор на ТО или в ремонте, кабинет
 * не может работать в полную силу. Считаем по нарядам и ремонтам, попадающим на дату.
 */
async function downtimeByRoom(day) {
  const map = new Map();

  const orders = await WhMaintenanceOrder.findAll({
    where: {
      status: { [Op.in]: ['in_progress', 'done'] },
      [Op.or]: [{ factDate: day }, { plannedDate: day }],
    },
    include: [{ model: WhAsset, as: 'asset', attributes: ['roomId'] }],
  });
  for (const o of orders) {
    if (!o.asset?.roomId) continue;
    map.set(o.asset.roomId, (map.get(o.asset.roomId) || 0) + Number(o.downtimeHours || 0));
  }

  const repairs = await WhRepair.findAll({
    where: {
      startedAt: { [Op.lte]: day },
      [Op.or]: [{ finishedAt: null }, { finishedAt: { [Op.gte]: day } }],
    },
    include: [{ model: WhAsset, as: 'asset', attributes: ['roomId'] }],
  });
  for (const r of repairs) {
    if (!r.asset?.roomId) continue;
    // Ремонт длится сутками, поэтому на одну дату относим полный рабочий день,
    // а не всю накопленную downtimeHours — иначе availableHours уйдёт в минус.
    map.set(r.asset.roomId, (map.get(r.asset.roomId) || 0) + 8);
  }

  return map;
}

/**
 * Агрегат за период для тепловой карты. Возвращает по кабинету средний процент,
 * зону и вспомогательные показатели для альтернативных раскрасок.
 */
/**
 * Показатели по кабинетам одной схемы.
 *
 * Схема — это либо этаж, либо сам медцентр: у небольшого МЦ помещения лежат прямо
 * в нём, без корпуса и этажа (ver. 6.81), и такая схема ничем не хуже этажной.
 * Условие выборки поэтому одно из двух, а не жёсткое «по floorId» — иначе у
 * общей схемы медцентра тепловая карта была бы пуста в принципе.
 */
async function aggregate({ floorId, medCenterId, from, to }) {
  /**
   * Область обязательна: этаж целиком или кабинеты медцентра вне этажей.
   *
   * Без неё запрос уходил с пустым :medCenterId и падал — а вызывает его
   * дашборд кабинета, и падал вместе с ним весь дашборд. На экране это
   * выглядело как «кабинет не открылся» у складов и у кабинетов, которым не
   * назначили этаж. Пустой ответ вместо исключения: «загрузку не по чему
   * считать» — это не сбой, а обычное состояние такого места.
   */
  if (!floorId && !medCenterId) return [];

  const scope = floorId
    ? 'r."floorId" = :floorId'
    : 'r."medCenterId" = :medCenterId AND r."floorId" IS NULL';
  const scopeArgs = floorId ? { floorId } : { medCenterId };

  const [rows] = await sequelize.query(`
    SELECT r.id AS "roomId", r.number, r.name, r.kind, r.plan, r."departmentId",
           d.name AS "departmentName", d.color AS "departmentColor",
           COALESCE(AVG(u."utilizationPct"), NULL) AS "avgPct",
           COALESCE(SUM(u."usedHours"), 0)         AS "usedHours",
           COALESCE(SUM(u."availableHours"), 0)    AS "availableHours",
           COALESCE(SUM(u."appointmentsCount"), 0) AS "appointments",
           COALESCE(MAX(u."idleAssets"), 0)        AS "idleAssets",
           COUNT(u.id)                             AS "daysCounted"
    -- Склады в тепловую карту не входят (ver. 7.47): приёмов в них нет по
    -- определению, и их вечный ноль утянул бы вниз средние по этажу и по сети,
    -- а на самой карте они и рисоваться не могут — плана у них нет.
    FROM warehouse_rooms r
    LEFT JOIN warehouse_departments d ON d.id = r."departmentId"
    LEFT JOIN warehouse_utilization_daily u
           ON u."roomId" = r.id AND u.date BETWEEN :from AND :to
    WHERE ${scope} AND r."isActive" = TRUE AND r."isService" = FALSE
    GROUP BY r.id, r.number, r.name, r.kind, r.plan, r."departmentId", d.name, d.color
    ORDER BY r.number
  `, { replacements: { ...scopeArgs, from: toDateOnly(from), to: toDateOnly(to) } });

  // Показатели, которые не зависят от расчёта загрузки: стоимость активов,
  // дефицит, просрочка, просроченные ТО. Нужны альтернативным раскраскам из ТЗ.
  const [extra] = await sequelize.query(`
    SELECT r.id AS "roomId",
           (SELECT COUNT(*) FROM warehouse_assets a WHERE a."roomId" = r.id AND a."isArchived" = FALSE) AS "assetCount",
           (SELECT COALESCE(SUM(a."initialCost"), 0) FROM warehouse_assets a WHERE a."roomId" = r.id AND a."isArchived" = FALSE) AS "assetValue",
           (SELECT COUNT(*) FROM warehouse_assets a WHERE a."roomId" = r.id AND a.status = 'repair') AS "inRepair",
           (SELECT COUNT(*) FROM warehouse_maintenance_orders m
              JOIN warehouse_assets a2 ON a2.id = m."assetId"
             WHERE a2."roomId" = r.id AND m.status <> 'done' AND m."plannedDate" < CURRENT_DATE) AS "overdueMaintenance",
           (SELECT COUNT(*) FROM warehouse_stock s
              JOIN warehouse_storages st ON st.id = s."storageId"
              JOIN warehouse_batches b ON b.id = s."batchId"
             WHERE st."roomId" = r.id AND s.quantity > 0 AND b."expiryDate" < CURRENT_DATE) AS "expiredPositions",
           (SELECT COUNT(*) FROM warehouse_reorder_rules rr
              JOIN warehouse_stock s2 ON s2."nomenclatureId" = rr."nomenclatureId"
              JOIN warehouse_storages st2 ON st2.id = s2."storageId"
             WHERE st2."roomId" = r.id AND rr."roomId" = r.id AND s2.quantity < rr."minQty") AS "belowMinimum"
    FROM warehouse_rooms r
    WHERE ${scope} AND r."isActive" = TRUE AND r."isService" = FALSE
  `, { replacements: scopeArgs });

  const extraById = new Map(extra.map(e => [e.roomId, e]));

  return rows.map(r => {
    const pct = r.avgPct === null ? null : Number(r.avgPct);
    return {
      ...r,
      avgPct: pct === null ? null : round2(pct),
      zone: zoneOf(pct),
      // daysCounted === 0 означает «расчёт за этот период не проводился».
      // Отдаём это явно, чтобы карта могла показать «нет данных» серым, а не
      // выдать 0 % за «кабинет простаивает».
      hasData: Number(r.daysCounted) > 0,
      metrics: extraById.get(r.roomId) || {},
    };
  });
}

/**
 * Активы, простаивающие ≥ IDLE_DAYS. Честная замена «рекомендациям по
 * перераспределению» из ТЗ: список того, что не двигалось, без выдуманной
 * экономии в рублях.
 */
async function idleAssets({ medCenterId = null, days = IDLE_DAYS } = {}) {
  const [rows] = await sequelize.query(`
    SELECT a.id, a."inventoryNumber", a.name, a.model, a.status, a."lastActivityAt",
           a."initialCost", r.number AS "roomNumber", r.name AS "roomName",
           d.name AS "departmentName", f.name AS "floorName", mc.name AS "medCenterName",
           EXTRACT(DAY FROM (now() - COALESCE(a."lastActivityAt", a."createdAt")))::int AS "idleDays"
    FROM warehouse_assets a
    LEFT JOIN warehouse_rooms r       ON r.id = a."roomId"
    LEFT JOIN warehouse_departments d ON d.id = r."departmentId"
    LEFT JOIN warehouse_floors f      ON f.id = r."floorId"
    LEFT JOIN med_centers mc          ON mc.id = r."medCenterId"
    WHERE a."isArchived" = FALSE
      AND a.status = 'in_use'
      AND COALESCE(a."lastActivityAt", a."createdAt") < now() - (:days || ' days')::interval
      AND (:medCenterId IS NULL OR r."medCenterId" = :medCenterId::uuid)
    ORDER BY "idleDays" DESC, a."initialCost" DESC
  `, { replacements: { days, medCenterId: medCenterId || null } });
  return rows;
}

/**
 * Ключи для сопоставления названия кабинета с МИС.
 *
 * В mis_appointments.room лежит свободная строка, и на живых данных это выглядит
 * так: «202», «415 Лаборатория», «317 Процедурный кабинет», «Рентген», «КТ»,
 * «Смотровая 1», «Линия Кабинет 23», «2 этаж операционный блок зал 1».
 * Одного нормализованного значения тут не хватает, поэтому на каждое название
 * выдаём набор ключей:
 *
 *   • полная строка без пробелов и пунктуации — ловит «Рентген» и «КТ», у которых
 *     номера нет вообще;
 *   • та же строка без слова «кабинет»;
 *   • «#N» — номер кабинета, если он есть.
 *
 * Номером считается только число в начале строки или после слова «кабинет». Иначе
 * «2 этаж операционный блок зал 1» дал бы ключи #2 и #1 и слился бы с кабинетами
 * 2 и 1. По той же причине отбрасывается число, за которым идёт «этаж».
 */
function roomKeys(s) {
  const raw = String(s || '').toLowerCase().trim();
  if (!raw) return [];

  const keys = new Set();
  const strip = str => str.replace(/[№\s.,()-]+/g, '');

  keys.add(strip(raw));
  keys.add(strip(raw.replace(/каб(инет)?\.?/g, ' ')));

  // Число после слова «кабинет»: «Линия Кабинет 23».
  const afterCab = raw.match(/каб(?:инет)?\.?\s*(\d+)/);
  if (afterCab) keys.add(`#${Number(afterCab[1])}`);

  // Число в начале строки, если это не номер этажа.
  const leading = raw.match(/^(\d+)\s*(.*)$/);
  if (leading && !/^этаж/.test(leading[2])) {
    keys.add(`#${Number(leading[1])}`);
  }

  keys.delete('');
  return [...keys];
}

// Оставлено для обратной совместимости: тесты и подсказки по сопоставлению
// сравнивают названия «в лоб», без набора ключей.
function normalizeRoom(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/каб(инет)?\.?\s*/g, '')
    .replace(/[№\s]+/g, '')
    .trim();
}

function toDateOnly(d) {
  if (!d) return new Date().toISOString().slice(0, 10);
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

module.exports = {
  IDLE_DAYS,
  ZONES,
  zoneOf,
  computeForDate,
  aggregate,
  idleAssets,
  roomKeys,
  normalizeRoom,
};
