/**
 * Тестовые данные складского модуля — вместо интеграции с 1С.
 *
 * Пока обмена нет, заполнять модуль нечем: номенклатура, карточки ОС и остатки в
 * рабочей системе приходят из бухгалтерии. Этот скрипт создаёт правдоподобный
 * срез, на котором можно щёлкать все экраны: два медцентра с корпусами и
 * планами этажей, оборудование с QR, партии с разными сроками годности, история
 * движений за четыре месяца, наряды ТО в трёх состояниях, ремонты, закрытая
 * инвентаризация и запрос котировок с тремя ответами.
 *
 * Данные помечены: у всех созданных записей в примечании стоит SEED_MARK. По нему
 * скрипт умеет вычищать за собой (--clean), и по нему же видно, что запись не
 * настоящая — иначе через месяц никто не отличит демонстрационный УЗИ-аппарат от
 * реального.
 *
 * Запуск:
 *   npm run seed:warehouse          — создать (существующее не трогает)
 *   npm run seed:warehouse -- --clean  — удалить только созданное этим скриптом
 *   npm run seed:warehouse -- --reset  — вычистить и создать заново
 *
 * Планы этажей генерируются геометрией, а не рисуются руками: кабинеты
 * раскладываются двумя рядами вдоль коридора в метрах. Без готовой геометрии
 * тепловую карту и редактор планов не на чем показать.
 */

require('dotenv').config();
const { Op } = require('sequelize');
const models = require('../models');
const {
  sequelize, MedCenter, User,
  WhBuilding, WhFloor, WhDepartment, WhRoom, WhStorage, WhFloorShape,
  WhCategory, WhNomenclature, WhContractor, WhAsset, WhBatch, WhStock,
  WhMovement, WhDocument, WhMaintenanceOrder, WhRepair,
  WhInventorySession, WhInventoryItem, WhReorderRule, WhConsumptionNorm,
  WhRfq, WhRfqItem, WhRfqQuote, WhUtilizationDaily,
} = models;

const SEED_MARK = '[demo-seed]';
const { generateToken } = require('../services/warehouse/qr');

// ── Помощники ────────────────────────────────────────────────────────────────
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const daysAgo = n => new Date(Date.now() - n * 86400000);
const daysAhead = n => new Date(Date.now() + n * 86400000);
const dateOnly = d => d.toISOString().slice(0, 10);

/**
 * Раскладка кабинетов на плане: два ряда по обе стороны коридора.
 * Возвращает полигон в метрах — ту же систему координат, в которой работает
 * редактор планов.
 */
function roomPolygon({ index, total, floorWidth, floorHeight }) {
  const perRow = Math.ceil(total / 2);
  const row = index < perRow ? 0 : 1;
  const posInRow = index % perRow;

  const margin = 1.5;
  const corridorHeight = 3;
  const roomDepth = (floorHeight - corridorHeight - margin * 2) / 2;
  const roomWidth = (floorWidth - margin * 2) / perRow;

  const x0 = margin + posInRow * roomWidth;
  const y0 = row === 0
    ? margin
    : margin + roomDepth + corridorHeight;

  const inset = 0.15; // зазор между кабинетами, чтобы стены не сливались
  const x1 = x0 + roomWidth - inset;
  const y1 = y0 + roomDepth;

  return {
    points: [[r2(x0), r2(y0)], [r2(x1), r2(y0)], [r2(x1), r2(y1)], [r2(x0), r2(y1)]],
    label: { x: r2((x0 + x1) / 2), y: r2((y0 + y1) / 2) },
  };
}

const r2 = n => Math.round(n * 100) / 100;

// ── Справочные данные ────────────────────────────────────────────────────────
const EQUIPMENT = [
  { name: 'Аппарат УЗИ',                 model: 'Mindray DC-70 Exp',   maker: 'Mindray',      cost: 4850000, life: 84, spec: 'ЛУЧДИАГ', okof: '320.26.60.12', group: 5, interval: 6 },
  { name: 'Электрокоагулятор',           model: 'ЭХВЧ-300',            maker: 'ЭлеПС',        cost: 720000,  life: 60, spec: 'ХИРУРГ',  okof: '320.26.60.13', group: 4, interval: 12 },
  { name: 'Стол операционный',           model: 'ОУ-1',                maker: 'Медстальконструкция', cost: 980000, life: 96, spec: 'ХИРУРГ', okof: '330.32.50', group: 6, interval: 12 },
  { name: 'Лампа операционная',          model: 'L735',                maker: 'Emaled',       cost: 340000,  life: 72, spec: 'ХИРУРГ',  okof: '330.32.50', group: 5, interval: 12 },
  { name: 'Аспиратор хирургический',     model: 'АХ-1',                maker: 'Юнимед',       cost: 180000,  life: 60, spec: 'ХИРУРГ',  okof: '330.32.50', group: 4, interval: 12 },
  { name: 'Стоматологическая установка', model: 'Sirona C2',           maker: 'Dentsply Sirona', cost: 2100000, life: 84, spec: 'СТОМАТ', okof: '330.32.50', group: 5, interval: 6 },
  { name: 'Рентген-аппарат',             model: 'RTC-5',               maker: 'НИПК Электрон', cost: 6400000, life: 120, spec: 'ЛУЧДИАГ', okof: '320.26.60.11', group: 7, interval: 6 },
  { name: 'Анализатор гематологический', model: 'ABX Micros ES 60',    maker: 'Horiba',       cost: 890000,  life: 60, spec: 'ЛАБОР',   okof: '330.26.51', group: 4, interval: 6 },
  { name: 'Центрифуга лабораторная',     model: 'ОПн-8',               maker: 'ТДС',          cost: 145000,  life: 60, spec: 'ЛАБОР',   okof: '330.26.51', group: 4, interval: 12 },
  { name: 'Аппарат ИВЛ',                 model: 'Avea',                maker: 'Vyaire',       cost: 3200000, life: 84, spec: 'РЕАНИМ',  okof: '320.26.60.13', group: 5, interval: 3 },
  { name: 'Монитор пациента',            model: 'BeneVision N12',      maker: 'Mindray',      cost: 420000,  life: 72, spec: 'РЕАНИМ',  okof: '320.26.60.13', group: 5, interval: 12 },
  { name: 'Дефибриллятор',               model: 'ДКИ-Н-11',            maker: 'Аксион',       cost: 310000,  life: 60, spec: 'РЕАНИМ',  okof: '320.26.60.13', group: 4, interval: 6 },
  { name: 'Кресло гинекологическое',     model: 'КГ-3М',               maker: 'Мед-ТеКо',     cost: 165000,  life: 84, spec: 'ГИНЕК',   okof: '330.32.50', group: 5, interval: 24 },
  { name: 'Кольпоскоп',                  model: 'КН-04-Б',             maker: 'Зенит',        cost: 280000,  life: 72, spec: 'ГИНЕК',   okof: '320.26.60.12', group: 5, interval: 12 },
  { name: 'Аппарат для физиотерапии',    model: 'Магнитер АМТ-02',     maker: 'Еламед',       cost: 95000,   life: 60, spec: 'ФИЗИО',   okof: '330.26.60', group: 4, interval: 12 },
  { name: 'Спирометр',                   model: 'СМП-21/01',           maker: 'Монитор',      cost: 130000,  life: 60, spec: 'ТЕРАП',   okof: '320.26.60.13', group: 4, interval: 12 },
  { name: 'Электрокардиограф',           model: 'ЭК12Т-01-Р-Д',        maker: 'Монитор',      cost: 220000,  life: 60, spec: 'КАРДИО',  okof: '320.26.60.13', group: 4, interval: 12 },
  { name: 'Автоклав',                    model: 'ГК-100-3',            maker: 'ТЗМОИ',        cost: 480000,  life: 96, spec: 'АХО',     okof: '330.32.50', group: 6, interval: 6 },
  { name: 'Холодильник медицинский',     model: 'ХФ-250-1',            maker: 'ПОЗиС',        cost: 78000,   life: 84, spec: 'ЛАБОР',   okof: '330.28.25', group: 5, interval: 24 },
  { name: 'Рабочая станция',             model: 'Dell OptiPlex 7010',  maker: 'Dell',         cost: 92000,   life: 36, spec: 'IT',      okof: '320.26.20.11', group: 2, interval: 24 },
  // Общеклиническое: встречается почти в любом кабинете, поэтому spec = null.
  // Без этого пула кабинеты одной специальности получают один и тот же прибор
  // десятками, и отчёт по надёжности показывает «155 спирометров в парке».
  { name: 'Тонометр механический',        model: 'CS Medica CS-105',    maker: 'CS Medica',    cost: 3500,    life: 60, spec: null, okof: '320.26.60.13', group: 4, interval: 12 },
  { name: 'Весы медицинские',             model: 'ВЭМ-150',             maker: 'Масса-К',      cost: 28000,   life: 84, spec: null, okof: '330.26.51', group: 5, interval: 24 },
  { name: 'Кушетка медицинская',          model: 'КМ-01',               maker: 'Мед-ТеКо',     cost: 19000,   life: 96, spec: null, okof: '330.32.50', group: 6, interval: null },
  { name: 'Облучатель-рециркулятор',      model: 'ОРУБп-3-3-Кронт',     maker: 'Кронт',        cost: 24000,   life: 60, spec: null, okof: '330.26.60', group: 4, interval: 12 },
  { name: 'Шкаф медицинский',             model: 'ШМ-2',                maker: 'Мед-ТеКо',     cost: 32000,   life: 96, spec: null, okof: '330.32.50', group: 6, interval: null },
  { name: 'Негатоскоп',                   model: 'НСП-01',              maker: 'Армед',        cost: 14000,   life: 84, spec: null, okof: '330.26.60', group: 5, interval: 24 },
  { name: 'Пульсоксиметр',                model: 'MD300C',              maker: 'Beurer',       cost: 6800,    life: 48, spec: null, okof: '320.26.60.13', group: 3, interval: 12 },
];

const MATERIALS = [
  { code: 'M-104', name: 'Перчатки нитриловые, размер L',      unit: 'уп', pack: 'уп', packSize: 100, price: 400,  sterile: true,  min: 40 },
  { code: 'M-221', name: 'Шприц одноразовый 20 мл',            unit: 'шт', pack: 'уп', packSize: 50,  price: 13.5, sterile: true,  min: 500 },
  { code: 'M-318', name: 'Салфетка стерильная марлевая',        unit: 'уп', pack: 'уп', packSize: 10,  price: 210,  sterile: true,  min: 25 },
  { code: 'M-402', name: 'Шовный материал Викрил 3/0',          unit: 'шт', pack: 'шт', packSize: 1,   price: 700,  sterile: true,  min: 30 },
  { code: 'M-511', name: 'Раствор антисептический, 500 мл',     unit: 'мл', pack: 'фл', packSize: 500, price: 4.5,  sterile: false, min: 2000 },
  { code: 'M-620', name: 'Бинт марлевый нестерильный 5 м',      unit: 'шт', pack: 'уп', packSize: 20,  price: 28,   sterile: false, min: 100 },
  { code: 'M-701', name: 'Раствор Рингера, 400 мл',            unit: 'шт', pack: 'шт', packSize: 1,   price: 180,  sterile: true,  min: 20, medicine: true },
  { code: 'M-802', name: 'Тест-полоски на глюкозу',            unit: 'шт', pack: 'уп', packSize: 50,  price: 120,  sterile: false, min: 100 },
  { code: 'M-815', name: 'Реагент АЛТ для биохимии',           unit: 'фл', pack: 'фл', packSize: 1,   price: 3100, sterile: false, min: 4, temp: [2, 8] },
  { code: 'M-816', name: 'Реагент АСТ для биохимии',           unit: 'фл', pack: 'фл', packSize: 1,   price: 2950, sterile: false, min: 4, temp: [2, 8] },
  { code: 'M-903', name: 'Перчатки стерильные, размер 7,5',    unit: 'уп', pack: 'уп', packSize: 50,  price: 160,  sterile: true,  min: 60 },
  { code: 'M-910', name: 'Катетер внутривенный 20G',           unit: 'шт', pack: 'уп', packSize: 50,  price: 42,   sterile: true,  min: 80 },
  { code: 'M-1001', name: 'Пластырь фиксирующий 2×500 см',     unit: 'шт', pack: 'уп', packSize: 12,  price: 95,   sterile: false, min: 40 },
  { code: 'M-1104', name: 'Маска медицинская трёхслойная',     unit: 'шт', pack: 'уп', packSize: 50,  price: 4.2,  sterile: false, min: 1000 },
  { code: 'M-1205', name: 'Дезинфицирующее средство, 1 л',     unit: 'мл', pack: 'кан', packSize: 1000, price: 1.8, sterile: false, min: 3000 },
];

const SUPPLIERS = [
  { name: 'МедТорг',       rating: 4.7, days: 1, terms: 'отсрочка 14 дней',  failures: 0, accred: 400 },
  { name: 'ФармЛогистик',  rating: 4.1, days: 5, terms: 'предоплата',        failures: 3, accred: 55 },
  { name: 'БиоСнаб',       rating: 4.9, days: 2, terms: 'отсрочка 30 дней',  failures: 0, accred: 700 },
  { name: 'ЛабРеактив',    rating: 4.4, days: 3, terms: 'отсрочка 7 дней',   failures: 1, accred: 250 },
];

const SERVICE_CONTRACTORS = [
  { name: 'МедСервис',     rating: 4.6 },
  { name: 'РадиоКонтроль', rating: 4.8 },
  { name: 'ЦСМ Краснодар', rating: 4.2 },
  { name: 'ТехноМед',      rating: 3.9 },
];

const DEPARTMENTS = [
  { name: 'Хирургическое отделение',   spec: 'ХИРУРГ',  color: '#e05252' },
  { name: 'Терапевтическое отделение', spec: 'ТЕРАП',   color: '#4a90d9' },
  { name: 'Стоматология',              spec: 'СТОМАТ',  color: '#59b39a' },
  { name: 'Лучевая диагностика',       spec: 'ЛУЧДИАГ', color: '#8b6fc4' },
  { name: 'Реанимация и ИТ',           spec: 'РЕАНИМ',  color: '#d9534f' },
  { name: 'Лаборатория',               spec: 'ЛАБОР',   color: '#e8a33d' },
  { name: 'Гинекология',               spec: 'ГИНЕК',   color: '#d4739c' },
  { name: 'Физиотерапия',              spec: 'ФИЗИО',   color: '#5bc0be' },
  { name: 'АХО',                       spec: 'АХО',     color: '#7f8c8d', kind: 'division' },
  { name: 'IT-отдел',                  spec: 'IT',      color: '#34495e', kind: 'division' },
];

const ROOM_KINDS = [
  { kind: 'operating', name: 'Операционная',   capacity: 10 },
  { kind: 'dressing',  name: 'Перевязочная',   capacity: 8 },
  { kind: 'procedure', name: 'Процедурный',    capacity: 8 },
  { kind: 'office',    name: 'Смотровой',      capacity: 8 },
  { kind: 'lab',       name: 'Лабораторная',   capacity: 8 },
  { kind: 'storage',   name: 'Склад',          capacity: 4 },
];

// ── Основной сценарий ────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const clean = args.includes('--clean');
  const reset = args.includes('--reset');

  await sequelize.authenticate();
  console.log('✓ Подключение к базе установлено');

  if (clean || reset) {
    await cleanSeed();
    if (clean) {
      console.log('✓ Демо-данные удалены');
      await sequelize.close();
      return;
    }
  }

  const existing = await WhBuilding.count();
  if (existing > 0 && !reset) {
    console.log(`⚠ В базе уже ${existing} корпусов. Запустите с --reset, чтобы пересоздать демо-данные.`);
    await sequelize.close();
    return;
  }

  const medCenters = await MedCenter.findAll({
    where: { isActive: true, isVirtual: false },
    order: [['sortOrder', 'ASC']],
    limit: 2,
  });
  if (medCenters.length === 0) throw new Error('Нет ни одного медцентра — сначала должна пройти миграция ver. 6.67');

  const users = await User.findAll({
    where: { isActive: true, isBot: { [Op.or]: [false, null] } },
    limit: 30,
    order: [['createdAt', 'ASC']],
  });
  if (users.length < 3) throw new Error('Слишком мало пользователей для назначения ответственных');
  console.log(`✓ Медцентров: ${medCenters.length}, пользователей для назначения: ${users.length}`);

  // ── Контрагенты ────────────────────────────────────────────────────────────
  const suppliers = await WhContractor.bulkCreate(SUPPLIERS.map(s => ({
    name: s.name, kind: 'supplier', rating: s.rating, avgDeliveryDays: s.days,
    paymentTerms: s.terms, deliveryFailures: s.failures,
    accreditationUntil: dateOnly(daysAhead(s.accred)),
    phone: `+7 (861) ${rnd(200, 299)}-${rnd(10, 99)}-${rnd(10, 99)}`,
    comment: SEED_MARK,
  })), { returning: true });

  const servicers = await WhContractor.bulkCreate(SERVICE_CONTRACTORS.map(s => ({
    name: s.name, kind: 'service', rating: s.rating,
    phone: `+7 (861) ${rnd(300, 399)}-${rnd(10, 99)}-${rnd(10, 99)}`,
    accreditationUntil: dateOnly(daysAhead(rnd(120, 800))),
    comment: SEED_MARK,
  })), { returning: true });
  console.log(`✓ Контрагенты: ${suppliers.length} поставщиков, ${servicers.length} сервисных`);

  // ── Категории ──────────────────────────────────────────────────────────────
  const catFixed = await WhCategory.create({ name: 'Медицинское оборудование', kind: 'fixed', sortOrder: 10 });
  const catIt = await WhCategory.create({ name: 'Вычислительная техника', kind: 'fixed', sortOrder: 20 });
  const catMat = await WhCategory.create({ name: 'Медицинские расходные материалы', kind: 'material', sortOrder: 30 });
  const catReagent = await WhCategory.create({ name: 'Реагенты и диагностика', kind: 'material', parentId: catMat.id, sortOrder: 40 });

  // ── Номенклатура ───────────────────────────────────────────────────────────
  const nomenclature = await WhNomenclature.bulkCreate(MATERIALS.map(m => ({
    code: m.code, name: m.name,
    categoryId: m.temp ? catReagent.id : catMat.id,
    unit: m.unit, packUnit: m.pack, packSize: m.packSize,
    isMedicine: Boolean(m.medicine), isSterile: Boolean(m.sterile),
    tracksBatch: true, vatPercent: m.medicine ? 10 : 20,
    lastPrice: m.price, defaultSupplierId: pick(suppliers).id,
    storageTempMinC: m.temp?.[0] ?? null, storageTempMaxC: m.temp?.[1] ?? null,
  })), { returning: true });
  const nomByCode = new Map(nomenclature.map(n => [n.code, n]));
  console.log(`✓ Номенклатура: ${nomenclature.length} позиций`);

  // ── Локации ────────────────────────────────────────────────────────────────
  const allRooms = [];
  const allStorages = [];
  const allDepartments = [];

  for (const [mcIndex, mc] of medCenters.entries()) {
    // Отделения — на медцентр, а не на корпус: одно отделение занимает кабинеты
    // в разных корпусах, ради этого departmentId и вынесен из иерархии этажей.
    const departments = await WhDepartment.bulkCreate(DEPARTMENTS.map((d, i) => ({
      medCenterId: mc.id, name: d.name, specialtyCode: d.spec,
      kind: d.kind || 'specialty', color: d.color,
      headUserId: users[(i + mcIndex * 3) % users.length].id,
      sortOrder: (i + 1) * 10,
    })), { returning: true });
    allDepartments.push(...departments);
    const deptBySpec = new Map(departments.map(d => [d.specialtyCode, d]));

    // ── Кабинеты берём из МИС, а не выдумываем ────────────────────────────────
    // Выдуманные номера («101», «207») почти не совпадают с тем, что реально
    // стоит в mis_appointments.room, и тепловая карта на демо оказалась бы пустой.
    // А главное — так видно настоящую картину: в МИС кабинет пишут свободной
    // строкой («415 Лаборатория», «Рентген», «2 этаж операционный блок зал 1»),
    // и именно на таких названиях модуль должен уметь сопоставляться.
    const clinicIds = (mc.misClinicIds || []).map(Number).filter(n => !Number.isNaN(n));
    const misRooms = clinicIds.length ? await fetchMisRooms(clinicIds) : [];

    if (!misRooms.length) {
      console.log(`  ⚠ ${mc.name}: в МИС нет кабинетов за 90 дней — пропускаю`);
      continue;
    }

    const building = await WhBuilding.create({
      medCenterId: mc.id,
      name: 'Главный корпус',
      code: 'A',
      address: mc.address || `г. ${mc.city || 'Краснодар'}`,
      sortOrder: 10,
    });

    // Раскладываем кабинеты по этажам: этаж выводится из номера (415 → 4-й) или
    // из явного «N этаж» в названии. Всё остальное — на первый.
    const byFloor = new Map();
    for (const mr of misRooms) {
      const info = classifyMisRoom(mr.room);
      if (!byFloor.has(info.floor)) byFloor.set(info.floor, []);
      byFloor.get(info.floor).push({ ...mr, ...info });
    }

    for (const [floorNumber, floorRooms] of [...byFloor.entries()].sort((a, b) => a[0] - b[0])) {
      const roomsOnFloor = floorRooms.length;
      const perRow = Math.ceil(roomsOnFloor / 2);
      const floorWidth = Math.max(16, 3 + perRow * 4.2);
      const floorHeight = 22;

      const floor = await WhFloor.create({
        buildingId: building.id, number: floorNumber,
        name: floorNumber === 1 ? 'Первый этаж' : `${floorNumber} этаж`,
        planWidthM: r2(floorWidth), planHeightM: floorHeight,
        sortOrder: floorNumber,
      });

      // Оформление плана: коридор и лестница. Без них план читается как набор
      // несвязанных прямоугольников.
      await WhFloorShape.bulkCreate([
        {
          floorId: floor.id, kind: 'corridor',
          geometry: {
            points: [
              [1.5, r2((floorHeight - 3) / 2)],
              [r2(floorWidth - 1.5), r2((floorHeight - 3) / 2)],
              [r2(floorWidth - 1.5), r2((floorHeight - 3) / 2 + 3)],
              [1.5, r2((floorHeight - 3) / 2 + 3)],
            ],
          },
          label: 'Коридор', style: { fill: '#eef2f7', stroke: '#cbd5e1' }, z: 0,
        },
        {
          floorId: floor.id, kind: 'stairs',
          geometry: { points: [[1.5, 1.5], [4, 1.5], [4, 4], [1.5, 4]] },
          label: 'Лестница', style: { fill: '#dde3ec', stroke: '#94a3b8' }, z: 1,
        },
      ]);

      for (const [i, mr] of floorRooms.entries()) {
        const dept = deptBySpec.get(mr.specialtyCode) || pick(departments);
        const responsible = users[(i + floorNumber + mcIndex) % users.length];

        const room = await WhRoom.create({
          medCenterId: mc.id,
          floorId: floor.id,
          departmentId: dept.id,
          number: mr.number,
          name: mr.name,
          kind: mr.kind,
          responsibleUserId: responsible.id,
          // Точная строка из МИС — гарантия сопоставления. В рабочей системе её
          // подставляют по подсказкам из GET /locations/rooms/mis-suggestions.
          misRoomAliases: [mr.room],
          capacityHours: mr.capacity,
          plan: roomPolygon({ index: i, total: roomsOnFloor, floorWidth, floorHeight }),
          publicToken: generateToken(),
        });
        allRooms.push(room);

        const storageDefs = [
          { name: 'Шкаф А', kind: 'cabinet' },
          { name: 'Шкаф Б', kind: 'cabinet' },
          { name: 'Тумба 1', kind: 'drawer' },
        ];
        if (['lab', 'procedure'].includes(mr.kind)) {
          storageDefs.push({ name: 'Холодильник 1', kind: 'fridge', tempMinC: 2, tempMaxC: 8 });
        }
        if (mr.kind === 'storage') storageDefs.push({ name: 'Стеллаж 4', kind: 'rack' });

        const storages = await WhStorage.bulkCreate(
          storageDefs.map((s, si) => ({ ...s, roomId: room.id, sortOrder: (si + 1) * 10 })),
          { returning: true }
        );
        allStorages.push(...storages);
      }
    }
  }
  console.log(`✓ Локации: ${allDepartments.length} отделений, ${allRooms.length} кабинетов (из МИС), ${allStorages.length} мест хранения`);

  // ── Основные средства ──────────────────────────────────────────────────────
  const { generateInventoryNumber } = require('../services/warehouse/numbering');
  const assets = [];

  for (const room of allRooms) {
    const dept = allDepartments.find(d => d.id === room.departmentId);
    const specCode = dept?.specialtyCode || 'АХО';
    const suitable = EQUIPMENT.filter(e => e.spec === specCode);
    const general = EQUIPMENT.filter(e => e.spec === null);
    // Профильные приборы плюс общеклинические, перемешать и взять без повторов:
    // два одинаковых УЗИ в одном кабинете бывают, а пять — уже не бывают.
    const pool = shuffle([...suitable, ...general, ...(suitable.length ? [] : EQUIPMENT)]);
    const count = Math.min(pool.length, rnd(2, 5));

    for (let i = 0; i < count; i++) {
      const eq = pool[i];
      const purchaseYear = rnd(2016, 2026);
      const commissioning = new Date(purchaseYear, rnd(0, 11), rnd(1, 28));
      const monthsInUse = Math.max(0, Math.round((Date.now() - commissioning) / (30.44 * 86400000)));

      // Амортизация «как будто из 1С»: линейно по СПИ, с потолком в первоначальную
      // стоимость. Портал её не начисляет — это подставленные значения, и в
      // карточке они помечены dataSource: 'manual'.
      const perMonth = eq.cost / eq.life;
      const accumulated = Math.min(eq.cost, r2(perMonth * monthsInUse));

      const statusRoll = Math.random();
      const status = statusRoll < 0.08 ? 'repair'
        : statusRoll < 0.14 ? 'maintenance'
        : statusRoll < 0.18 ? 'storage'
        : 'in_use';

      const t = await sequelize.transaction();
      let inventoryNumber;
      try {
        inventoryNumber = await generateInventoryNumber({
          specialtyCode: specCode, year: purchaseYear, transaction: t,
        });
        await t.commit();
      } catch (e) {
        await t.rollback();
        throw e;
      }

      const asset = await WhAsset.create({
        inventoryNumber,
        name: eq.name, model: eq.model, manufacturer: eq.maker,
        serialNumber: `${eq.model.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase()}-${rnd(10000, 99999)}`,
        categoryId: eq.spec === 'IT' ? catIt.id : catFixed.id,
        roomId: room.id,
        storageId: null,
        responsibleUserId: room.responsibleUserId,
        status,
        purchaseDate: dateOnly(commissioning),
        commissioningDate: dateOnly(commissioning),
        initialCost: eq.cost,
        usefulLifeMonths: eq.life,
        depreciationGroup: eq.group,
        depreciationMethod: 'linear',
        okof: eq.okof,
        accumulatedDepreciation: accumulated,
        depreciationAsOf: dateOnly(new Date()),
        fundingSource: pick(['Собственные средства', 'Лизинг', 'Целевые средства']),
        warrantyUntil: dateOnly(new Date(commissioning.getTime() + 730 * 86400000)),
        supplierId: pick(suppliers).id,
        maintenanceIntervalMonths: eq.interval || null,
        nextMaintenanceDate: dateOnly(daysAhead(rnd(-45, 120))),
        dailyCapacityHours: 8,
        lastActivityAt: daysAgo(rnd(0, 60)),
        publicToken: generateToken(),
        notes: SEED_MARK,
      });
      assets.push(asset);
    }
  }
  console.log(`✓ Основные средства: ${assets.length} единиц`);

  // ── Партии и остатки ───────────────────────────────────────────────────────
  const batches = [];
  for (const nom of nomenclature) {
    // По три партии на позицию с разными сроками: одна просроченная, одна
    // истекающая, одна свежая. Иначе отчёт по срокам нечем наполнить.
    const spans = [rnd(-30, -1), rnd(3, 60), rnd(120, 500)];
    for (const [i, span] of spans.entries()) {
      batches.push(await WhBatch.create({
        nomenclatureId: nom.id,
        batchNumber: `${nom.code.replace('M-', '')}${String(rnd(1000, 9999))}-${'ABC'[i]}`,
        expiryDate: dateOnly(daysAhead(span)),
        productionDate: dateOnly(daysAgo(rnd(200, 700))),
        supplierId: nom.defaultSupplierId,
        unitCost: r2(Number(nom.lastPrice) * (0.9 + Math.random() * 0.2)),
        receivedAt: daysAgo(rnd(10, 180)),
        certificateNumber: `РОСС RU.${rnd(1000, 9999)}.${rnd(10, 99)}`,
        // Просроченная партия сразу помечается заблокированной — так же, как это
        // сделает ночная задача в рабочей системе.
        isBlocked: span < 0,
        blockReason: span < 0 ? 'Истёк срок годности' : null,
      }));
    }
  }
  console.log(`✓ Партии: ${batches.length}`);

  // ── Начальные остатки — документами поступления, а не прямой вставкой ──────
  // Прямая запись в warehouse_stock давала остаток без единого движения, и
  // контрольная сверка (services/warehouse/stock.js → reconcileStock) честно
  // сообщала о расхождении по каждой позиции: склад есть, журнала нет. В
  // оборотно-сальдовой ведомости такие остатки тоже не появлялись — сальдо на
  // начало она считает из движений. Поэтому всё поступает документами: и склад, и
  // журнал заполняет один и тот же сервис, что и в рабочей системе.
  const { createDocument } = require('../services/warehouse/stock');
  const materialStorages = allStorages.filter(s => s.kind !== 'rack' || Math.random() < 0.5);
  const openingDate = daysAgo(150);
  let stockRows = 0;

  for (const storage of materialStorages) {
    const positions = rnd(3, 8);
    const chosen = shuffle(nomenclature).slice(0, positions);
    const lines = [];

    for (const nom of chosen) {
      const nomBatches = batches.filter(b => b.nomenclatureId === nom.id);
      const batch = pick(nomBatches);
      const material = MATERIALS.find(m => m.code === nom.code);
      // Часть позиций сознательно ниже минимума — иначе светофор дефицита никогда
      // не загорится и его нечем показать. Запас берём с расчётом на будущий
      // расход: историю движений ниже строим уже из этих остатков.
      const belowMin = Math.random() < 0.22;
      const base = material?.min || 50;
      const qty = belowMin ? rnd(2, Math.max(3, Math.floor(base * 0.6))) : rnd(base * 2, base * 6);

      lines.push({
        nomenclatureId: nom.id, batchId: batch.id, quantity: qty,
        unitCost: Number(batch.unitCost), toStorageId: storage.id,
      });
      stockRows++;
    }

    await createDocument({
      type: 'receipt', lines,
      user: { id: pick(users).id },
      contractorId: pick(suppliers).id,
      toRoomId: storage.roomId,
      reasonCode: 'opening',
      reasonText: 'Начальное поступление',
      comment: SEED_MARK,
      device: 'seed-script',
      occurredAt: openingDate,
    });
  }
  console.log(`✓ Начальные остатки: ${stockRows} позиций документами поступления`);

  // ── Минимумы и нормы ───────────────────────────────────────────────────────
  for (const nom of nomenclature) {
    const material = MATERIALS.find(m => m.code === nom.code);
    await WhReorderRule.create({
      nomenclatureId: nom.id, minQty: material?.min || 20,
      maxQty: (material?.min || 20) * 5, autoRfq: Math.random() < 0.3,
    });
  }
  // Нормы на посещение — только для части позиций: в реальности их задают не на всё.
  for (const nom of shuffle(nomenclature).slice(0, 8)) {
    for (const dept of shuffle(allDepartments).slice(0, 3)) {
      await WhConsumptionNorm.create({
        nomenclatureId: nom.id, departmentId: dept.id,
        basis: 'per_visit', normValue: r2(0.5 + Math.random() * 2),
        comment: SEED_MARK,
      });
    }
  }
  console.log('✓ Минимумы и нормы расхода заданы');

  // ── История движений за 4 месяца ───────────────────────────────────────────
  // Тоже через createDocument: только так остаток, журнал и оборотно-сальдовая
  // ведомость сходятся между собой. Количество к расходу берётся из фактически
  // доступного остатка — выдумывать его нельзя, сервис справедливо откажет
  // («недостаточно годного остатка»), и половина истории просто не создалась бы.
  const doctors = users.slice(0, 12);
  let docCount = 0, moveCount = 0, skipped = 0;

  for (let day = 120; day >= 0; day -= 1) {
    const date = daysAgo(day);
    const isWeekend = [0, 6].includes(date.getDay());
    const docsToday = isWeekend ? (Math.random() < 0.3 ? 1 : 0) : rnd(1, 3);

    for (let d = 0; d < docsToday; d++) {
      const type = pickWeighted([
        ['issue', 60], ['receipt', 18], ['transfer', 12], ['writeoff', 10],
      ]);

      let lines = [];
      let fromRoomId = null;
      let toRoomId = null;

      if (type === 'receipt') {
        const storage = pick(materialStorages);
        toRoomId = storage.roomId;
        lines = shuffle(nomenclature).slice(0, rnd(1, 3)).map(nom => {
          const batch = pick(batches.filter(b => b.nomenclatureId === nom.id && !b.isBlocked));
          return batch ? {
            nomenclatureId: nom.id, batchId: batch.id,
            quantity: rnd(20, 150), unitCost: Number(batch.unitCost),
            toStorageId: storage.id,
          } : null;
        }).filter(Boolean);
      } else {
        // Расход и перемещение: выбираем позиции, которые реально лежат на складе.
        // Просроченные партии годятся только под списание — это же правило
        // применяет и сервис при подборе по FEFO.
        const available = await pickAvailableStock({ count: rnd(1, 3), allowExpired: type === 'writeoff' });
        if (!available.length) { skipped++; continue; }

        const sourceStorage = available[0].storageId;
        fromRoomId = available[0].roomId;
        const target = type === 'transfer'
          ? pick(materialStorages.filter(s => s.id !== sourceStorage)) || null
          : null;
        if (type === 'transfer' && !target) { skipped++; continue; }
        if (target) toRoomId = target.roomId;

        lines = available
          .filter(a => a.storageId === sourceStorage)
          .map(a => ({
            nomenclatureId: a.nomenclatureId,
            batchId: a.batchId,
            quantity: Math.max(1, Math.floor(Number(a.quantity) * (0.05 + Math.random() * 0.25))),
            unitCost: Number(a.unitCost),
            fromStorageId: sourceStorage,
            toStorageId: target?.id,
            // Врач заполняется только при выдаче — на нём держится режим
            // «расход по врачам» отчёта № 3.
            doctorUserId: type === 'issue' ? pick(doctors).id : null,
          }));
      }

      if (!lines.length) { skipped++; continue; }

      try {
        const result = await createDocument({
          type, lines,
          user: { id: pick(users).id },
          contractorId: type === 'receipt' ? pick(suppliers).id : null,
          fromRoomId, toRoomId,
          reasonCode: type === 'writeoff' ? 'expired' : type === 'transfer' ? 'redistribution' : null,
          reasonText: type === 'writeoff' ? 'Истёк срок годности' : null,
          comment: SEED_MARK,
          device: 'seed-script',
          occurredAt: date,
        });
        docCount++;
        moveCount += result.movements.length;
      } catch (e) {
        // Остатка не хватило или партия заблокирована — пропускаем документ.
        // Это нормальная работа правил, а не сбой сида.
        skipped++;
      }
    }
  }
  if (skipped) console.log(`  ℹ пропущено документов из-за нехватки остатка: ${skipped}`);
  console.log(`✓ История: ${docCount} документов, ${moveCount} движений за 120 дней`);

  // Перемещения оборудования — отдельно, чтобы в отчёте № 2 и матрице
  // межотделенческих перемещений было что показать.
  // Тоже через createDocument: он не только пишет движение, но и переносит сам
  // актив (roomId, МОЛ, lastActivityAt). Записав движение напрямую, мы получили бы
  // историю перемещения при неизменившемся размещении — и «Простаивающее
  // оборудование» считало бы простой от даты создания, а не от последней операции.
  let assetMoves = 0;
  for (const asset of shuffle(assets).slice(0, Math.floor(assets.length * 0.35))) {
    const target = pick(allRooms.filter(r => r.id !== asset.roomId));
    if (!target) continue;
    const when = daysAgo(rnd(5, 110));
    try {
      await createDocument({
        type: 'transfer',
        lines: [{
          assetId: asset.id,
          toRoomId: target.id,
          toResponsibleId: target.responsibleUserId,
        }],
        user: { id: pick(users).id },
        fromRoomId: asset.roomId,
        toRoomId: target.id,
        reasonCode: 'redistribution',
        reasonText: 'Перераспределение по заявке',
        comment: SEED_MARK,
        device: 'seed-script',
        occurredAt: when,
      });
      assetMoves++;
    } catch (e) {
      console.log(`  ⚠ перемещение актива ${asset.inventoryNumber} не создано: ${e.message}`);
    }
  }
  console.log(`✓ Перемещений оборудования: ${assetMoves}`);

  // ── Наряды ТО в трёх состояниях ────────────────────────────────────────────
  const {
    generateMaintenanceNumber, generateRepairNumber, generateRfqNumber, generateDocumentNumber,
  } = require('../services/warehouse/numbering');
  let maintCount = 0;
  for (const asset of assets) {
    const orders = rnd(1, 3);
    for (let i = 0; i < orders; i++) {
      const isPast = i > 0 || Math.random() < 0.6;
      const planned = isPast ? daysAgo(rnd(10, 150)) : daysAhead(rnd(1, 90));
      const t = await sequelize.transaction();
      try {
        const number = await generateMaintenanceNumber({ year: planned.getFullYear(), transaction: t });

        // Три состояния: выполнено в срок, выполнено с отклонением, просрочено.
        const roll = Math.random();
        const done = isPast && roll > 0.15;
        const deviation = done ? rnd(-3, 18) : 0;

        await WhMaintenanceOrder.create({
          number, assetId: asset.id,
          type: pickWeighted([['maintenance', 70], ['verification', 15], ['calibration', 8], ['dosimetry', 7]]),
          plannedDate: dateOnly(planned),
          factDate: done ? dateOnly(new Date(planned.getTime() + deviation * 86400000)) : null,
          status: done ? 'done' : isPast ? 'overdue' : 'planned',
          result: done ? pickWeighted([['normal', 80], ['with_remarks', 17], ['failed', 3]]) : null,
          resultNote: done && Math.random() < 0.2 ? 'Замена фильтров' : null,
          cost: done ? rnd(8, 60) * 1000 : 0,
          contractorId: pick(servicers).id,
          isMandatory: ['verification', 'dosimetry'].includes(pick(['verification', 'dosimetry', 'maintenance'])),
          downtimeHours: done ? rnd(1, 8) : 0,
          engineerUserId: pick(users).id,
          reminders: {},
        }, { transaction: t });
        await t.commit();
        maintCount++;
      } catch (e) {
        await t.rollback();
        throw e;
      }
    }
  }
  console.log(`✓ Наряды ТО: ${maintCount}`);

  // ── Ремонты ────────────────────────────────────────────────────────────────
  let repairCount = 0;
  for (const asset of shuffle(assets).slice(0, Math.floor(assets.length * 0.25))) {
    const started = daysAgo(rnd(10, 300));
    const open = asset.status === 'repair';
    const t = await sequelize.transaction();
    try {
      const number = await generateRepairNumber({ year: started.getFullYear(), transaction: t });
      const days = rnd(2, 21);
      await WhRepair.create({
        number, assetId: asset.id,
        startedAt: dateOnly(started),
        finishedAt: open ? null : dateOnly(new Date(started.getTime() + days * 86400000)),
        description: pick([
          'Не включается, подозрение на блок питания',
          'Неисправен компрессор',
          'Течь охлаждающего контура',
          'Ошибка калибровки датчика',
          'Механическое повреждение корпуса',
        ]),
        contractorId: pick(servicers).id,
        cost: rnd(15, 180) * 1000,
        result: open ? null : pickWeighted([['repaired', 85], ['written_off', 15]]),
        downtimeHours: open ? 0 : days * 8,
        createdBy: pick(users).id,
      }, { transaction: t });
      await t.commit();
      repairCount++;
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }
  console.log(`✓ Ремонты: ${repairCount}`);

  // ── Закрытая инвентаризация ────────────────────────────────────────────────
  const invRoom = pick(allRooms);
  const invAssets = assets.filter(a => a.roomId === invRoom.id);
  if (invAssets.length) {
    const t = await sequelize.transaction();
    try {
      const number = await generateDocumentNumber({ type: 'inventory', transaction: t });
      const startedAt = daysAgo(5);
      const finishedAt = new Date(startedAt.getTime() + 3.2 * 3600000);

      const session = await WhInventorySession.create({
        number, scope: 'room', roomId: invRoom.id,
        basis: `приказ № ${rnd(100, 199)} от ${dateOnly(daysAgo(12))}`,
        status: 'closed',
        chairmanUserId: pick(users).id,
        members: shuffle(users).slice(0, 2).map(u => ({
          userId: u.id, name: u.displayName || u.username, signedAt: finishedAt.toISOString(),
        })),
        responsibleUserId: invRoom.responsibleUserId,
        startedAt, finishedAt,
        durationMinutes: Math.round((finishedAt - startedAt) / 60000),
        createdBy: pick(users).id,
      }, { transaction: t });

      for (const [i, a] of invAssets.entries()) {
        // Одна недостача и один излишек — иначе опись выглядит стерильно и на ней
        // нельзя показать сличительную ведомость.
        const shortage = i === 0 && invAssets.length > 2;
        await WhInventoryItem.create({
          sessionId: session.id, assetId: a.id,
          expectedQty: 1, actualQty: shortage ? 0 : 1,
          scanMethod: 'qr', scannedAt: new Date(startedAt.getTime() + i * 120000),
          scannedBy: pick(users).id,
          note: shortage ? 'В ремонте, акт не оформлен' : null,
        }, { transaction: t });
      }
      const foreign = pick(assets.filter(a => a.roomId !== invRoom.id));
      if (foreign) {
        await WhInventoryItem.create({
          sessionId: session.id, assetId: foreign.id,
          expectedQty: 0, actualQty: 1,
          scanMethod: 'qr', scannedAt: finishedAt, scannedBy: pick(users).id,
          note: 'Излишек: числится в другом кабинете',
        }, { transaction: t });
      }
      await t.commit();
      console.log(`✓ Инвентаризация ${number}: ${invAssets.length + 1} позиций, кабинет ${invRoom.number}`);
    } catch (e) {
      await t.rollback();
      throw e;
    }
  }

  // ── Запрос котировок с тремя ответами ──────────────────────────────────────
  const t2 = await sequelize.transaction();
  try {
    const number = await generateRfqNumber({ transaction: t2 });
    const rfqRoom = pick(allRooms);
    const rfq = await WhRfq.create({
      number, status: 'collecting',
      reason: 'Остаток «Салфетка стерильная марлевая» ниже минимума',
      roomId: rfqRoom.id,
      dueAt: daysAhead(2),
      autoCreated: true,
      createdBy: pick(users).id,
    }, { transaction: t2 });

    const rfqNoms = [nomByCode.get('M-318'), nomByCode.get('M-104'), nomByCode.get('M-903')].filter(Boolean);
    const items = await WhRfqItem.bulkCreate(rfqNoms.map(n => ({
      rfqId: rfq.id, nomenclatureId: n.id, quantity: rnd(50, 200),
    })), { returning: true, transaction: t2 });

    // Три поставщика с разбросом цены и срока — чтобы формула оценки давала не
    // самое дешёвое предложение, и обоснование рекомендации было содержательным.
    for (const sup of suppliers.slice(0, 3)) {
      const prices = {};
      for (const item of items) {
        const nom = rfqNoms.find(n => n.id === item.nomenclatureId);
        prices[item.id] = r2(Number(nom.lastPrice) * (0.92 + Math.random() * 0.18));
      }
      await WhRfqQuote.create({
        rfqId: rfq.id, contractorId: sup.id,
        // avgDeliveryDays у контрагента дробный (4,1), а срок в котировке целый:
        // «поставим за 1,5 дня» никто не пишет.
        deliveryDays: Math.round(Number(sup.avgDeliveryDays)),
        paymentTerms: sup.paymentTerms,
        prices, respondedAt: daysAgo(0), comment: SEED_MARK,
      }, { transaction: t2 });
    }
    await t2.commit();
    console.log(`✓ Запрос котировок ${number}: ${items.length} позиций, 3 ответа`);
  } catch (e) {
    await t2.rollback();
    throw e;
  }

  // ── Загрузка кабинетов ─────────────────────────────────────────────────────
  // Считаем из mis_appointments, если данные есть. Если нет — заполняем
  // синтетикой с явной пометкой source: у тепловой карты иначе нечего красить, а
  // молча подсунуть выдуманные числа как расчётные нельзя.
  // Считаем не «последние 46 дней», а последние 46 дней, реально покрытых
  // данными: кэш расписания может отставать от сегодняшней даты, и тогда расчёт
  // по календарю дал бы честные, но бесполезные нули.
  const [misCheck] = await sequelize.query(`
    SELECT COUNT(*)::int AS cnt, MAX(time_start)::date AS "lastDate"
    FROM mis_appointments
    WHERE time_end IS NOT NULL AND (status_id IS NULL OR status_id <> 5)
  `);
  const hasMisData = misCheck[0].cnt > 0;
  const lastMisDate = misCheck[0].lastDate ? new Date(misCheck[0].lastDate) : new Date();
  const lagDays = Math.round((Date.now() - lastMisDate) / 86400000);

  if (hasMisData) {
    console.log(`✓ В mis_appointments ${misCheck[0].cnt} пригодных записей, последняя дата ${dateOnly(lastMisDate)}` +
      (lagDays > 2 ? ` (отставание кэша расписания: ${lagDays} дн. — считаю за период до этой даты)` : ''));
  } else {
    console.log('⚠ mis_appointments пуст: заполняю загрузку синтетикой с source=seed_synthetic');
  }

  const utilization = require('../services/warehouse/utilization');
  let utilDays = 0;
  for (let day = 45; day >= 0; day--) {
    const date = hasMisData
      ? new Date(lastMisDate.getTime() - day * 86400000)
      : daysAgo(day);
    if (hasMisData) {
      await utilization.computeForDate(date);
    } else {
      const isWeekend = [0, 6].includes(date.getDay());
      for (const room of allRooms) {
        const capacity = Number(room.capacityHours);
        const used = isWeekend ? r2(capacity * Math.random() * 0.25) : r2(capacity * (0.25 + Math.random() * 0.75));
        await WhUtilizationDaily.upsert({
          roomId: room.id, date: dateOnly(date),
          usedHours: used, availableHours: capacity,
          utilizationPct: r2((used / capacity) * 100),
          appointmentsCount: isWeekend ? rnd(0, 4) : rnd(4, 22),
          idleAssets: Math.random() < 0.15 ? rnd(1, 2) : 0,
          downtimeHours: 0,
          source: 'seed_synthetic',
          computedAt: new Date(),
        });
      }
    }
    utilDays++;
  }
  console.log(`✓ Загрузка кабинетов посчитана за ${utilDays} дней`);

  console.log('\n═══ Готово ═══');
  console.log(`Медцентров:      ${medCenters.length}`);
  console.log(`Кабинетов:       ${allRooms.length}`);
  console.log(`Оборудования:    ${assets.length}`);
  console.log(`Номенклатуры:    ${nomenclature.length}`);
  console.log(`Движений:        ${moveCount + assetMoves}`);
  console.log(`Нарядов ТО:      ${maintCount}`);
  console.log('\nВыдайте доступ: adminAccess.warehouse = true у нужных пользователей');
  console.log('или добавьте их в роль «Склад» (создана миграцией ver. 6.68).');

  await sequelize.close();
}

/**
 * Случайные позиции, которые реально лежат на складе. Нужны, чтобы история
 * движений строилась из фактических остатков, а не из выдуманных количеств.
 *
 * Партии с истёкшим сроком отдаются только под списание: сервис движений всё
 * равно не пропустит их в выдачу, и просить его об этом бессмысленно.
 */
async function pickAvailableStock({ count = 1, allowExpired = false }) {
  const [rows] = await sequelize.query(`
    SELECT s."nomenclatureId", s."batchId", s."storageId", s.quantity, s."unitCost",
           st."roomId"
    FROM warehouse_stock s
    JOIN warehouse_storages st ON st.id = s."storageId"
    LEFT JOIN warehouse_batches b ON b.id = s."batchId"
    WHERE s.quantity > 1
      AND (b.id IS NULL OR (b."isBlocked" = FALSE AND (b."expiryDate" IS NULL OR b."expiryDate" >= CURRENT_DATE))
           OR :allowExpired = TRUE)
    ORDER BY random()
    LIMIT :count
  `, { replacements: { count, allowExpired } });
  return rows;
}

/**
 * Кабинеты этой клиники по данным МИС: самые загруженные первыми. Ограничиваем
 * 30 — иначе на демо получится сотня кабинетов, и план этажа станет нечитаемым.
 */
async function fetchMisRooms(clinicIds) {
  const [rows] = await sequelize.query(`
    SELECT room, COUNT(*)::int AS appointments
    FROM mis_appointments
    WHERE clinic_id IN (:ids) AND room IS NOT NULL AND room <> ''
      AND time_start > now() - interval '90 days'
    GROUP BY room
    ORDER BY appointments DESC
    LIMIT 30
  `, { replacements: { ids: clinicIds } });
  return rows;
}

/**
 * Разбор свободной строки кабинета из МИС: номер, этаж, специальность, тип.
 *
 * Это ровно та работа, которую в рабочем внедрении делают руками через экран
 * сопоставления. Здесь она автоматизирована по ключевым словам, чтобы демо
 * собиралось само — и заодно видно, насколько такие названия неоднородны.
 */
function classifyMisRoom(raw) {
  const s = String(raw).trim();
  const lower = s.toLowerCase();

  // Номер: из начала строки или после слова «кабинет». «2 этаж …» номером не считаем.
  let number = null;
  const afterCab = lower.match(/каб(?:инет)?\.?\s*(\d+)/);
  const leading = lower.match(/^(\d+)\s*(.*)$/);
  if (afterCab) number = afterCab[1];
  else if (leading && !/^этаж/.test(leading[2])) number = leading[1];

  // Этаж: явный «N этаж» приоритетнее, иначе первая цифра трёхзначного номера.
  const floorMatch = lower.match(/(\d)\s*этаж/);
  let floor = 1;
  if (floorMatch) floor = Number(floorMatch[1]);
  else if (number && number.length === 3) floor = Number(number[0]);

  // Специальность по ключевым словам названия.
  const rules = [
    [/рентген|(^|\s)кт(\s|$)|мрт|маммогра|денситом|флюор/, 'ЛУЧДИАГ'],
    [/лаборатор|биохим|анализ/,                  'ЛАБОР'],
    [/операцион|хирург|перевязоч/,               'ХИРУРГ'],
    [/стомат|ортодонт|зубн/,                     'СТОМАТ'],
    [/гинеколог|акушер|кольпоскоп/,              'ГИНЕК'],
    [/реаним|интенсивн|ивл/,                     'РЕАНИМ'],
    [/физио|массаж|лфк/,                         'ФИЗИО'],
    [/эндоскоп|гастроскоп|колоноскоп/,           'ЭНДОСК'],
    [/педиатр|детск/,                            'ПЕДИАТ'],
    [/кардио|экг|эхокг/,                         'КАРДИО'],
    [/офтальм|глазн/,                            'ОФТАЛЬМ'],
    [/лор|отоларинголог/,                        'ЛОР'],
    [/процедурн|прививоч|смотров|терап|ординатор/, 'ТЕРАП'],
  ];
  let specialtyCode = 'ТЕРАП';
  for (const [re, code] of rules) {
    if (re.test(lower)) { specialtyCode = code; break; }
  }

  // Тип помещения и суточная ёмкость: операционная работает дольше кабинета.
  let kind = 'office', capacity = 8;
  if (/операцион/.test(lower))            { kind = 'operating'; capacity = 10; }
  else if (/перевязоч/.test(lower))       { kind = 'dressing';  capacity = 8; }
  else if (/процедурн|прививоч/.test(lower)) { kind = 'procedure'; capacity = 9; }
  else if (/лаборатор/.test(lower))       { kind = 'lab';       capacity = 8; }
  else if (/склад/.test(lower))           { kind = 'storage';   capacity = 4; }
  else if (/рентген|(^|\s)кт(\s|$)|мрт/.test(lower)) { kind = 'procedure'; capacity = 12; }

  return {
    // Если номера в названии нет («Рентген», «КТ»), номером становится само
    // название: кабинет должен быть как-то опознаваем в списках и на этикетке.
    number: number || s.slice(0, 30),
    name: s,
    floor: Math.min(Math.max(floor, 1), 9),
    specialtyCode,
    kind,
    capacity,
  };
}

/**
 * Удаление демо-данных. Идёт от листьев к корню: FK каскадные не везде, и
 * порядок здесь — не стилистика, а требование.
 */
async function cleanSeed() {
  const tables = [
    'warehouse_rfq_quotes', 'warehouse_rfq_items', 'warehouse_rfq',
    'warehouse_inventory_items', 'warehouse_inventory_sessions',
    'warehouse_repairs', 'warehouse_maintenance_orders',
    'warehouse_movements', 'warehouse_documents',
    'warehouse_consumption_norms', 'warehouse_reorder_rules',
    'warehouse_stock', 'warehouse_batches',
    'warehouse_asset_files', 'warehouse_assets',
    'warehouse_nomenclature', 'warehouse_categories', 'warehouse_contractors',
    'warehouse_utilization_daily',
    'warehouse_storages', 'warehouse_rooms', 'warehouse_floor_shapes',
    'warehouse_floors', 'warehouse_buildings', 'warehouse_departments',
    'warehouse_doc_counters', 'warehouse_inventory_counters',
    'warehouse_outbox',
  ];
  for (const table of tables) {
    await sequelize.query(`DELETE FROM ${table}`);
  }
  console.log(`✓ Очищено таблиц: ${tables.length}`);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWeighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [value, weight] of pairs) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return pairs[0][0];
}

main().catch(err => {
  console.error('✗ Ошибка сида:', err);
  process.exit(1);
});
