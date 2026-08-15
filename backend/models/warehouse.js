/**
 * Модели складского учёта (ver. 6.68).
 *
 * Вынесены из models/index.js отдельным файлом: там уже 109 моделей и 3780 строк,
 * а складской модуль добавляет ещё 26. Внутри index.js они бы утонули, и найти
 * связку «остаток → место хранения → кабинет» стало бы невозможно.
 *
 * Файл экспортирует фабрику: index.js передаёт свой экземпляр sequelize, поэтому
 * второго подключения к базе не появляется. Ассоциации с User, MedCenter и
 * StructuralDivision объявляются в associateWarehouse — модели ядра к моменту
 * вызова уже определены.
 */

module.exports = function defineWarehouseModels(sequelize, DataTypes) {
  const ts = { timestamps: true };

  // ── Справочник специальностей (маска инвентарного номера) ──────────────────
  const WhSpecialty = sequelize.define('WhSpecialty', {
    code:      { type: DataTypes.STRING(20), primaryKey: true },
    name:      { type: DataTypes.STRING(120), allowNull: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    isActive:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, { ...ts, tableName: 'warehouse_specialties' });

  // ── Локации: корпус → этаж → кабинет → место хранения ──────────────────────
  const WhBuilding = sequelize.define('WhBuilding', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    medCenterId: { type: DataTypes.UUID, allowNull: false },
    name:        { type: DataTypes.STRING(150), allowNull: false },
    code:        { type: DataTypes.STRING(30) },
    address:     { type: DataTypes.STRING(500) },
    sortOrder:   { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    isActive:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, { ...ts, tableName: 'warehouse_buildings' });

  const WhFloor = sequelize.define('WhFloor', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    buildingId:    { type: DataTypes.UUID, allowNull: false },
    number:        { type: DataTypes.INTEGER, allowNull: false },
    name:          { type: DataTypes.STRING(120) },
    // Габариты плана в метрах: кабинеты рисуются в тех же единицах, из них же
    // берётся площадь. Пиксели считает клиент под свой viewport.
    planWidthM:    { type: DataTypes.DECIMAL(7, 2), allowNull: false, defaultValue: 40 },
    planHeightM:   { type: DataTypes.DECIMAL(7, 2), allowNull: false, defaultValue: 25 },
    planBgUrl:     { type: DataTypes.STRING(500) },
    planBgOpacity: { type: DataTypes.DECIMAL(3, 2), allowNull: false, defaultValue: 0.35 },
    // Контур этажа произвольной формы: {points:[[x,y],…]} в метрах (ver. 6.69).
    // Пустой объект — этаж прямоугольный по габаритам, как было до 6.69.
    outline:       { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    sortOrder:     { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
  }, { ...ts, tableName: 'warehouse_floors' });

  const WhDepartment = sequelize.define('WhDepartment', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    medCenterId:   { type: DataTypes.UUID, allowNull: false },
    name:          { type: DataTypes.STRING(200), allowNull: false },
    specialtyCode: { type: DataTypes.STRING(20) },
    kind:          { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'specialty' },
    divisionId:    { type: DataTypes.UUID },
    headUserId:    { type: DataTypes.UUID },
    color:         { type: DataTypes.STRING(20) },
    sortOrder:     { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    isActive:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, { ...ts, tableName: 'warehouse_departments' });

  const WhRoom = sequelize.define('WhRoom', {
    id:                { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    floorId:           { type: DataTypes.UUID, allowNull: false },
    departmentId:      { type: DataTypes.UUID },
    number:            { type: DataTypes.STRING(30), allowNull: false },
    name:              { type: DataTypes.STRING(200) },
    kind:              { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'office' },
    responsibleUserId: { type: DataTypes.UUID },
    // Как кабинет назван в mis_appointments.room. Без сопоставления тепловая карта
    // и расход на посещение не собираются — МИС хранит кабинет строкой.
    misRoomAliases:    { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
    capacityHours:     { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 8 },
    workingDays:       { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 5 },
    // Полигон на плане этажа в метрах: {points:[[x,y],…], label:{x,y}}
    plan:              { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    publicToken:       { type: DataTypes.STRING(40) },
    isActive:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, { ...ts, tableName: 'warehouse_rooms' });

  const WhFloorShape = sequelize.define('WhFloorShape', {
    id:       { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    floorId:  { type: DataTypes.UUID, allowNull: false },
    kind:     { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'wall' },
    geometry: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    label:    { type: DataTypes.STRING(200) },
    style:    { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    z:        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    // Техническое помещение (коридор, лестница, санузел) против оформительской
    // фигуры (стена, подпись): первое входит в площадь этажа, второе — нет.
    isTechnical: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, { ...ts, tableName: 'warehouse_floor_shapes' });

  const WhStorage = sequelize.define('WhStorage', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    roomId:    { type: DataTypes.UUID, allowNull: false },
    name:      { type: DataTypes.STRING(150), allowNull: false },
    kind:      { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'cabinet' },
    tempMinC:  { type: DataTypes.DECIMAL(4, 1) },
    tempMaxC:  { type: DataTypes.DECIMAL(4, 1) },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    isActive:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, { ...ts, tableName: 'warehouse_storages' });

  // ── Контрагенты ────────────────────────────────────────────────────────────
  const WhContractor = sequelize.define('WhContractor', {
    id:                 { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name:               { type: DataTypes.STRING(255), allowNull: false },
    kind:               { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'supplier' },
    inn:                { type: DataTypes.STRING(12) },
    phone:              { type: DataTypes.STRING(50) },
    email:              { type: DataTypes.STRING(255) },
    contactPerson:      { type: DataTypes.STRING(255) },
    rating:             { type: DataTypes.DECIMAL(3, 2) },
    deliveryFailures:   { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    accreditationUntil: { type: DataTypes.DATEONLY },
    paymentTerms:       { type: DataTypes.STRING(120) },
    avgDeliveryDays:    { type: DataTypes.DECIMAL(4, 1) },
    comment:            { type: DataTypes.TEXT },
    isActive:           { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, { ...ts, tableName: 'warehouse_contractors' });

  // ── Номенклатура ───────────────────────────────────────────────────────────
  const WhCategory = sequelize.define('WhCategory', {
    id:                  { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name:                { type: DataTypes.STRING(200), allowNull: false },
    parentId:            { type: DataTypes.UUID },
    kind:                { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'material' },
    okof:                { type: DataTypes.STRING(20) },
    depreciationGroup:   { type: DataTypes.SMALLINT },
    defaultUsefulMonths: { type: DataTypes.INTEGER },
    sortOrder:           { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
  }, { ...ts, tableName: 'warehouse_categories' });

  const WhNomenclature = sequelize.define('WhNomenclature', {
    id:                { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    code:              { type: DataTypes.STRING(50), allowNull: false, unique: true },
    name:              { type: DataTypes.STRING(500), allowNull: false },
    categoryId:        { type: DataTypes.UUID },
    unit:              { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'шт' },
    packUnit:          { type: DataTypes.STRING(20) },
    packSize:          { type: DataTypes.DECIMAL(10, 3) },
    isMedicine:        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isSterile:         { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    tracksBatch:       { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    vatPercent:        { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 20 },
    lastPrice:         { type: DataTypes.DECIMAL(12, 2) },
    defaultSupplierId: { type: DataTypes.UUID },
    storageTempMinC:   { type: DataTypes.DECIMAL(4, 1) },
    storageTempMaxC:   { type: DataTypes.DECIMAL(4, 1) },
    // Заполнится, когда появится обмен с 1С. Сопоставление по названию —
    // гарантированное расхождение, см. историю med_centers в ver. 6.67.
    oneCRef:           { type: DataTypes.STRING(60) },
    // Строка ведомости, из которой позиция создана (ver. 6.73). По ней же
    // повторная материализация узнаёт, что делать ничего не нужно.
    osvLineKey:        { type: DataTypes.STRING(40) },
    isActive:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, { ...ts, tableName: 'warehouse_nomenclature' });

  // ── Основные средства ──────────────────────────────────────────────────────
  const WhAsset = sequelize.define('WhAsset', {
    id:                       { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    inventoryNumber:          { type: DataTypes.STRING(60), allowNull: false, unique: true },
    name:                     { type: DataTypes.STRING(300), allowNull: false },
    model:                    { type: DataTypes.STRING(200) },
    serialNumber:             { type: DataTypes.STRING(120) },
    manufacturer:             { type: DataTypes.STRING(200) },
    categoryId:               { type: DataTypes.UUID },
    roomId:                   { type: DataTypes.UUID },
    storageId:                { type: DataTypes.UUID },
    responsibleUserId:        { type: DataTypes.UUID },
    status:                   { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'in_use' },
    purchaseDate:             { type: DataTypes.DATEONLY },
    commissioningDate:        { type: DataTypes.DATEONLY },
    initialCost:              { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    usefulLifeMonths:         { type: DataTypes.INTEGER },
    depreciationGroup:        { type: DataTypes.SMALLINT },
    depreciationMethod:       { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'linear' },
    okof:                     { type: DataTypes.STRING(20) },
    // Владелец поля — бухгалтерия. Портал амортизацию НЕ начисляет: считать её
    // здесь значит однажды разойтись с 1С, а сверка это молча скроет.
    accumulatedDepreciation:  { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    depreciationAsOf:         { type: DataTypes.DATEONLY },
    fundingSource:            { type: DataTypes.STRING(60) },
    warrantyUntil:            { type: DataTypes.DATEONLY },
    supplierId:               { type: DataTypes.UUID },
    maintenanceIntervalMonths:{ type: DataTypes.INTEGER },
    nextMaintenanceDate:      { type: DataTypes.DATEONLY },
    dailyCapacityHours:       { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 8 },
    lastActivityAt:           { type: DataTypes.DATE },
    // Токен публичной карточки по QR. Отдельно от id: он напечатан на этикетке и
    // живёт вечно, светить в нём внутренний идентификатор незачем.
    publicToken:              { type: DataTypes.STRING(40), allowNull: false, unique: true },
    labelPrintedAt:           { type: DataTypes.DATE },
    notes:                    { type: DataTypes.TEXT },
    oneCRef:                  { type: DataTypes.STRING(60) },
    // Строка ведомости-источник (ver. 6.73). Карточек на строку столько, сколько
    // единиц в 1С, поэтому ссылка неуникальна — по ней считается, сколько уже
    // создано, и повторный разбор не плодит дубли.
    osvLineKey:               { type: DataTypes.STRING(40) },
    // Размещение, из которого создана карточка (ver. 6.80). Считать созданное по
    // кабинету нельзя: актив могли переместить документом, и счёт по месту дал бы
    // «не хватает» и создал дубли. Ссылка на размещение от переездов не зависит.
    osvPlacementId:           { type: DataTypes.UUID },
    isArchived:               { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdBy:                { type: DataTypes.UUID },
  }, { ...ts, tableName: 'warehouse_assets' });

  const WhAssetFile = sequelize.define('WhAssetFile', {
    id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    assetId:      { type: DataTypes.UUID, allowNull: false },
    kind:         { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'other' },
    originalName: { type: DataTypes.STRING(300), allowNull: false },
    storedName:   { type: DataTypes.STRING(300), allowNull: false },
    mimeType:     { type: DataTypes.STRING(120) },
    size:         { type: DataTypes.INTEGER },
    // По умолчанию false: рядом с паспортом лежат договоры с ценами, а карточка
    // по QR открыта без авторизации.
    isPublic:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    uploadedBy:   { type: DataTypes.UUID },
  }, { ...ts, tableName: 'warehouse_asset_files' });

  // ── Партии, остатки, нормы ─────────────────────────────────────────────────
  const WhBatch = sequelize.define('WhBatch', {
    id:                { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    nomenclatureId:    { type: DataTypes.UUID, allowNull: false },
    batchNumber:       { type: DataTypes.STRING(80), allowNull: false },
    expiryDate:        { type: DataTypes.DATEONLY },
    productionDate:    { type: DataTypes.DATEONLY },
    supplierId:        { type: DataTypes.UUID },
    unitCost:          { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    receivedAt:        { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    certificateNumber: { type: DataTypes.STRING(120) },
    isBlocked:         { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    blockReason:       { type: DataTypes.STRING(255) },
  }, { ...ts, tableName: 'warehouse_batches' });

  // Остаток отдельной таблицей, а не суммой движений: его читает каждый экран, а
  // движений за год десятки тысяч. Пересчёт из движений остаётся контрольной сверкой.
  const WhStock = sequelize.define('WhStock', {
    id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    nomenclatureId: { type: DataTypes.UUID, allowNull: false },
    batchId:        { type: DataTypes.UUID },
    storageId:      { type: DataTypes.UUID, allowNull: false },
    quantity:       { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
    unitCost:       { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  }, { ...ts, tableName: 'warehouse_stock' });

  const WhReorderRule = sequelize.define('WhReorderRule', {
    id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    nomenclatureId: { type: DataTypes.UUID, allowNull: false },
    roomId:         { type: DataTypes.UUID },
    storageId:      { type: DataTypes.UUID },
    minQty:         { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
    maxQty:         { type: DataTypes.DECIMAL(14, 3) },
    autoRfq:        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { ...ts, tableName: 'warehouse_reorder_rules' });

  const WhConsumptionNorm = sequelize.define('WhConsumptionNorm', {
    id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    nomenclatureId: { type: DataTypes.UUID, allowNull: false },
    departmentId:   { type: DataTypes.UUID },
    roomId:         { type: DataTypes.UUID },
    basis:          { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'per_visit' },
    normValue:      { type: DataTypes.DECIMAL(12, 4), allowNull: false },
    comment:        { type: DataTypes.TEXT },
  }, { ...ts, tableName: 'warehouse_consumption_norms' });

  // ── Документы и движения ───────────────────────────────────────────────────
  const WhDocCounter = sequelize.define('WhDocCounter', {
    prefix:    { type: DataTypes.STRING(10), primaryKey: true },
    year:      { type: DataTypes.INTEGER, primaryKey: true },
    lastValue: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { tableName: 'warehouse_doc_counters', timestamps: false });

  const WhInventoryCounter = sequelize.define('WhInventoryCounter', {
    prefix:        { type: DataTypes.STRING(10), primaryKey: true },
    year:          { type: DataTypes.INTEGER, primaryKey: true },
    specialtyCode: { type: DataTypes.STRING(20), primaryKey: true },
    lastValue:     { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, { tableName: 'warehouse_inventory_counters', timestamps: false });

  const WhDocument = sequelize.define('WhDocument', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    number:        { type: DataTypes.STRING(40), allowNull: false, unique: true },
    type:          { type: DataTypes.STRING(20), allowNull: false },
    date:          { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    status:        { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft' },
    fromRoomId:    { type: DataTypes.UUID },
    toRoomId:      { type: DataTypes.UUID },
    contractorId:  { type: DataTypes.UUID },
    reasonCode:    { type: DataTypes.STRING(30) },
    reasonText:    { type: DataTypes.STRING(500) },
    comment:       { type: DataTypes.TEXT },
    createdBy:     { type: DataTypes.UUID },
    // Простая подпись: подтверждение в системе плюс запись в журнал. Не КЭП —
    // для КЭП нужен криптопровайдер, это отдельная задача.
    signedBy:      { type: DataTypes.UUID },
    signedAt:      { type: DataTypes.DATE },
    signatureNote: { type: DataTypes.STRING(255) },
    device:        { type: DataTypes.STRING(255) },
    // disabled — обмена с 1С нет. Именно disabled по умолчанию, иначе отчёт сверки
    // покажет десятки «не синхронизировано» на пустом месте.
    oneCStatus:    { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'disabled' },
    oneCError:     { type: DataTypes.TEXT },
  }, { ...ts, tableName: 'warehouse_documents' });

  const WhMovement = sequelize.define('WhMovement', {
    id:                { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    documentId:        { type: DataTypes.UUID },
    type:              { type: DataTypes.STRING(20), allowNull: false },
    assetId:           { type: DataTypes.UUID },
    nomenclatureId:    { type: DataTypes.UUID },
    batchId:           { type: DataTypes.UUID },
    quantity:          { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 1 },
    unitCost:          { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    amount:            { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    fromStorageId:     { type: DataTypes.UUID },
    toStorageId:       { type: DataTypes.UUID },
    fromRoomId:        { type: DataTypes.UUID },
    toRoomId:          { type: DataTypes.UUID },
    fromResponsibleId: { type: DataTypes.UUID },
    toResponsibleId:   { type: DataTypes.UUID },
    // Без врача режим «расход по врачам» не строится. Это же и главное требование
    // к дисциплине персонала во всём модуле.
    doctorUserId:      { type: DataTypes.UUID },
    doctorMisId:       { type: DataTypes.INTEGER },
    serviceCode:       { type: DataTypes.STRING(100) },
    reasonCode:        { type: DataTypes.STRING(30) },
    reasonText:        { type: DataTypes.STRING(500) },
    initiatorUserId:   { type: DataTypes.UUID },
    occurredAt:        { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, { ...ts, tableName: 'warehouse_movements' });

  // ── ТО и ремонты ───────────────────────────────────────────────────────────
  const WhMaintenanceOrder = sequelize.define('WhMaintenanceOrder', {
    id:              { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    number:          { type: DataTypes.STRING(40), allowNull: false, unique: true },
    assetId:         { type: DataTypes.UUID, allowNull: false },
    type:            { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'maintenance' },
    plannedDate:     { type: DataTypes.DATEONLY, allowNull: false },
    factDate:        { type: DataTypes.DATEONLY },
    status:          { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'planned' },
    result:          { type: DataTypes.STRING(30) },
    resultNote:      { type: DataTypes.TEXT },
    cost:            { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    contractorId:    { type: DataTypes.UUID },
    isMandatory:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    downtimeHours:   { type: DataTypes.DECIMAL(7, 2), allowNull: false, defaultValue: 0 },
    engineerUserId:  { type: DataTypes.UUID },
    // {"7":"2026-08-04T09:00:00Z","3":"…"} — какие горизонты уже отправлены.
    // JSONB, а не колонки reminded7/reminded3: таких наборов в базе уже два
    // (аккредитации, транспорт), и менять горизонты миграцией — тупик.
    reminders:       { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  }, { ...ts, tableName: 'warehouse_maintenance_orders' });

  const WhRepair = sequelize.define('WhRepair', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    number:        { type: DataTypes.STRING(40), allowNull: false, unique: true },
    assetId:       { type: DataTypes.UUID, allowNull: false },
    startedAt:     { type: DataTypes.DATEONLY, allowNull: false },
    finishedAt:    { type: DataTypes.DATEONLY },
    description:   { type: DataTypes.TEXT },
    contractorId:  { type: DataTypes.UUID },
    cost:          { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    result:        { type: DataTypes.STRING(30) },
    downtimeHours: { type: DataTypes.DECIMAL(7, 2), allowNull: false, defaultValue: 0 },
    createdBy:     { type: DataTypes.UUID },
  }, { ...ts, tableName: 'warehouse_repairs' });

  // ── Инвентаризация ─────────────────────────────────────────────────────────
  const WhInventorySession = sequelize.define('WhInventorySession', {
    id:                { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    number:            { type: DataTypes.STRING(40), allowNull: false, unique: true },
    scope:             { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'room' },
    roomId:            { type: DataTypes.UUID },
    departmentId:      { type: DataTypes.UUID },
    basis:             { type: DataTypes.STRING(255) },
    periodFrom:        { type: DataTypes.DATEONLY },
    periodTo:          { type: DataTypes.DATEONLY },
    status:            { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open' },
    chairmanUserId:    { type: DataTypes.UUID },
    members:           { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    responsibleUserId: { type: DataTypes.UUID },
    startedAt:         { type: DataTypes.DATE },
    finishedAt:        { type: DataTypes.DATE },
    durationMinutes:   { type: DataTypes.INTEGER },
    createdBy:         { type: DataTypes.UUID },
    differencesPostedAt: { type: DataTypes.DATE },
    differencesPostedBy: { type: DataTypes.UUID },
  }, { ...ts, tableName: 'warehouse_inventory_sessions' });

  const WhInventoryItem = sequelize.define('WhInventoryItem', {
    id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    sessionId:      { type: DataTypes.UUID, allowNull: false },
    assetId:        { type: DataTypes.UUID },
    nomenclatureId: { type: DataTypes.UUID },
    batchId:        { type: DataTypes.UUID },
    storageId:      { type: DataTypes.UUID },
    expectedQty:    { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
    actualQty:      { type: DataTypes.DECIMAL(14, 3) },
    // Доля ручного ввода — метрика качества маркировки в отчёте № 9.
    scanMethod:     { type: DataTypes.STRING(10) },
    scannedAt:      { type: DataTypes.DATE },
    scannedBy:      { type: DataTypes.UUID },
    note:           { type: DataTypes.STRING(500) },
  }, { ...ts, tableName: 'warehouse_inventory_items' });

  // ── Котировки ──────────────────────────────────────────────────────────────
  const WhRfq = sequelize.define('WhRfq', {
    id:                   { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    number:               { type: DataTypes.STRING(40), allowNull: false, unique: true },
    status:               { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open' },
    reason:               { type: DataTypes.STRING(500) },
    roomId:               { type: DataTypes.UUID },
    dueAt:                { type: DataTypes.DATE },
    createdBy:            { type: DataTypes.UUID },
    autoCreated:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    decidedContractorId:  { type: DataTypes.UUID },
    decidedAt:            { type: DataTypes.DATE },
    decisionNote:         { type: DataTypes.TEXT },
  }, { ...ts, tableName: 'warehouse_rfq' });

  const WhRfqItem = sequelize.define('WhRfqItem', {
    id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    rfqId:          { type: DataTypes.UUID, allowNull: false },
    nomenclatureId: { type: DataTypes.UUID, allowNull: false },
    quantity:       { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 1 },
  }, { ...ts, tableName: 'warehouse_rfq_items' });

  const WhRfqQuote = sequelize.define('WhRfqQuote', {
    id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    rfqId:        { type: DataTypes.UUID, allowNull: false },
    contractorId: { type: DataTypes.UUID, allowNull: false },
    deliveryDays: { type: DataTypes.INTEGER },
    paymentTerms: { type: DataTypes.STRING(120) },
    // {"<rfq_item_id>": 412.00} — позиций мало, отдельная таблица на два поля
    // себя не оправдывает.
    prices:       { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    respondedAt:  { type: DataTypes.DATE },
    comment:      { type: DataTypes.TEXT },
  }, { ...ts, tableName: 'warehouse_rfq_quotes' });

  // ── Загрузка кабинетов ─────────────────────────────────────────────────────
  // Считается из mis_appointments (часы приёма по room), а не из журнала выдачи:
  // выдачу стационарного оборудования никто не отмечает, и метрика из ТЗ по
  // этому источнику показала бы нули во всех кабинетах.
  const WhUtilizationDaily = sequelize.define('WhUtilizationDaily', {
    id:                { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    roomId:            { type: DataTypes.UUID, allowNull: false },
    date:              { type: DataTypes.DATEONLY, allowNull: false },
    usedHours:         { type: DataTypes.DECIMAL(7, 2), allowNull: false, defaultValue: 0 },
    availableHours:    { type: DataTypes.DECIMAL(7, 2), allowNull: false, defaultValue: 0 },
    utilizationPct:    { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
    appointmentsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    idleAssets:        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    downtimeHours:     { type: DataTypes.DECIMAL(7, 2), allowNull: false, defaultValue: 0 },
    source:            { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'mis_schedule' },
    computedAt:        { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, { tableName: 'warehouse_utilization_daily', timestamps: false });

  // ── Оборотно-сальдовая ведомость 1С (ver. 6.72) ────────────────────────────
  // Единственный автоматический источник данных модуля: обмена с 1С нет, раз в
  // месяц приходит выгрузка XLSX по счёту МЦ.04.
  //
  // Снимок хранится отдельно от рабочих таблиц и никогда в них не вливается
  // напрямую. Причина простая: разноска позиций по кабинетам и ответственным
  // делается руками и занимает недели, а файл приезжает заново каждый месяц.
  // Прямой импорт затирал бы ручную работу при каждой загрузке. Поэтому здесь
  // три сущности: снимок (что сказала 1С), строки снимка и сопоставления —
  // единственное, что живёт МЕЖДУ импортами.
  const WhOsvImport = sequelize.define('WhOsvImport', {
    id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    account:      { type: DataTypes.STRING(20), allowNull: false },
    organization: { type: DataTypes.STRING(200) },
    periodYear:   { type: DataTypes.INTEGER, allowNull: false },
    periodMonth:  { type: DataTypes.SMALLINT, allowNull: false },
    periodLabel:  { type: DataTypes.STRING(60) },
    fileName:     { type: DataTypes.STRING(300), allowNull: false },
    fileSize:     { type: DataTypes.INTEGER },
    // Хеш содержимого: по нему видно, что загрузили ровно тот же файл повторно.
    fileHash:     { type: DataTypes.STRING(64) },
    // draft — разобран и лежит на предпросмотре, applied — принят как снимок
    // месяца. Применённый снимок в периоде ровно один.
    status:       { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft' },
    lineCount:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    groupCount:   { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    leafCount:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    openingSum:   { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    openingQty:   { type: DataTypes.DECIMAL(16, 3), allowNull: false, defaultValue: 0 },
    debitSum:     { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    debitQty:     { type: DataTypes.DECIMAL(16, 3), allowNull: false, defaultValue: 0 },
    creditSum:    { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    creditQty:    { type: DataTypes.DECIMAL(16, 3), allowNull: false, defaultValue: 0 },
    closingSum:   { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    closingQty:   { type: DataTypes.DECIMAL(16, 3), allowNull: false, defaultValue: 0 },
    warnings:     { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    uploadedBy:   { type: DataTypes.UUID },
    appliedAt:    { type: DataTypes.DATE },
    appliedBy:    { type: DataTypes.UUID },
  }, { ...ts, tableName: 'warehouse_osv_imports' });

  const WhOsvLine = sequelize.define('WhOsvLine', {
    id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    importId:   { type: DataTypes.UUID, allowNull: false },
    // Номер строки листа: с ним расхождение можно открыть в самом файле и увидеть
    // глазами. Без него спор с бухгалтерией сводится к «у вас неправильно».
    rowNumber:  { type: DataTypes.INTEGER, allowNull: false },
    sortOrder:  { type: DataTypes.INTEGER, allowNull: false },
    level:      { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
    name:       { type: DataTypes.STRING(500), allowNull: false },
    pathText:   { type: DataTypes.TEXT },
    isGroup:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Порядковый номер повтора в своей группе: одна номенклатура лежит в 1С
    // несколькими строками с разной ценой (партии), и различить их больше нечем.
    dupIndex:   { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
    lineKey:    { type: DataTypes.STRING(40), allowNull: false },
    openingSum: { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    openingQty: { type: DataTypes.DECIMAL(16, 3), allowNull: false, defaultValue: 0 },
    debitSum:   { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    debitQty:   { type: DataTypes.DECIMAL(16, 3), allowNull: false, defaultValue: 0 },
    creditSum:  { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    creditQty:  { type: DataTypes.DECIMAL(16, 3), allowNull: false, defaultValue: 0 },
    closingSum: { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
    closingQty: { type: DataTypes.DECIMAL(16, 3), allowNull: false, defaultValue: 0 },
    // Цена за единицу в файле отсутствует, это результат деления. Балансовая, а не
    // закупочная: в lastPrice номенклатуры её лить нельзя — там цена поставщика,
    // и подстановка балансовой стоимости испортила бы запросы котировок.
    unitCost:   { type: DataTypes.DECIMAL(14, 2) },
  }, { tableName: 'warehouse_osv_lines', timestamps: false });

  // Сопоставление строки 1С с объектами портала. Не привязано к импорту: ради
  // этого весь слой снимков и заводился — сопоставили один раз, дальше каждый
  // следующий месяц подхватывает готовое.
  const WhOsvMapping = sequelize.define('WhOsvMapping', {
    id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    account:        { type: DataTypes.STRING(20), allowNull: false },
    // Сопоставлять можно строку (lineKey) или целую ветку дерева (pathPrefix).
    // Второе — не удобство, а условие выполнимости: групп третьего уровня 54, и
    // половина из них называется по кабинету. Одно действие на группу закрывает
    // больше полутора тысяч строк, тогда как построчно их никто не разберёт.
    lineKey:        { type: DataTypes.STRING(40) },
    pathPrefix:     { type: DataTypes.TEXT },
    // Название на момент сопоставления: если в 1С группу переименуют, ключ
    // порвётся, и по этому полю будет видно, чем строка была раньше.
    name:           { type: DataTypes.STRING(500) },
    // auto — делить строки ветки по цене за единицу: дороже порога отдельная
    // карточка, дешевле остаток. Требовать решения по каждой из 2992 строк
    // означало бы не разобрать ведомость никогда.
    kind:           { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'auto' },
    assetThreshold: { type: DataTypes.DECIMAL(12, 2) },
    unit:           { type: DataTypes.STRING(20) },
    nomenclatureId: { type: DataTypes.UUID },
    categoryId:     { type: DataTypes.UUID },
    roomId:         { type: DataTypes.UUID },
    storageId:      { type: DataTypes.UUID },
    note:           { type: DataTypes.TEXT },
    mappedBy:       { type: DataTypes.UUID },
  }, { ...ts, tableName: 'warehouse_osv_mappings' });

  // ── Размещение позиций ведомости по кабинетам (ver. 6.80) ──────────────────
  //
  // Ветка 1С не отвечает на вопрос «где вещь стоит»: под «Кабинетом Хирурга»
  // лежит имущество пяти-шести физических кабинетов, а строка «Стул СТ 6, 3 шт»
  // раскладывается на три разных места. Поэтому размещение — отдельная запись со
  // своим количеством, а не поле у сопоставления ветки.
  const WhOsvPlacement = sequelize.define('WhOsvPlacement', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    account:   { type: DataTypes.STRING(20), allowNull: false },
    // Ключ строки, а не ссылка на строку снимка: снимки сменяются каждый месяц,
    // размещение переживает их все.
    lineKey:   { type: DataTypes.STRING(40), allowNull: false },
    roomId:    { type: DataTypes.UUID, allowNull: false },
    storageId: { type: DataTypes.UUID },
    quantity:  { type: DataTypes.DECIMAL(14, 3), allowNull: false },
    note:      { type: DataTypes.TEXT },
    placedBy:  { type: DataTypes.UUID },
  }, { ...ts, tableName: 'warehouse_osv_placements' });

  // ── Словарь предметов (ver. 6.79) ──────────────────────────────────────────
  //
  // Отвечает на вопрос «что это за предмет» по названию, тогда как цена отвечает
  // только на «как его учитывать». До 6.79 оба вопроса решал порог стоимости, и
  // на первый он отвечать не мог: ножницы за 522 ₽ и одеяло за 1350 ₽ по цене
  // неразличимы.
  //
  // Размечается не строка, а ведущее слово названия: разных слов 625 на 2992
  // строки, и топ-200 покрывает 81 % ведомости. Словарь переживает следующий
  // месяц, тогда как разметка строк рвётся при переименовании группы в 1С.
  const WhItemRule = sequelize.define('WhItemRule', {
    id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    pattern:        { type: DataTypes.TEXT, allowNull: false },
    // head — ведущее слово; contains — подстрока; regex — выражение.
    matchType:      { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'head' },
    // Отдельного вида «инструмент» нет намеренно: инструмент — это категория
    // (что это), а учитывается он количеством, то есть accounting='material'.
    accounting:     { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'auto' },
    categoryId:     { type: DataTypes.UUID },
    unit:           { type: DataTypes.STRING(20) },
    assetThreshold: { type: DataTypes.DECIMAL(12, 2) },
    note:           { type: DataTypes.TEXT },
    isActive:       { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdBy:      { type: DataTypes.UUID },
  }, { ...ts, tableName: 'warehouse_item_rules' });

  // ── Outbox для 1С: пустой и выключенный ────────────────────────────────────
  // Обмена нет. Таблица заведена сразу по образцу submissions (ver. 6.06), чтобы
  // не переделывать схему задним числом, когда обмен появится.
  const WhOutbox = sequelize.define('WhOutbox', {
    id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    eventType:      { type: DataTypes.STRING(50), allowNull: false },
    objectType:     { type: DataTypes.STRING(30), allowNull: false },
    objectId:       { type: DataTypes.UUID },
    payload:        { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    idempotencyKey: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    status:         { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
    attempts:       { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastError:      { type: DataTypes.TEXT },
    deliveredAt:    { type: DataTypes.DATE },
  }, { ...ts, tableName: 'warehouse_outbox' });

  const models = {
    WhSpecialty, WhBuilding, WhFloor, WhDepartment, WhRoom, WhFloorShape, WhStorage,
    WhContractor, WhCategory, WhNomenclature,
    WhAsset, WhAssetFile,
    WhBatch, WhStock, WhReorderRule, WhConsumptionNorm,
    WhDocCounter, WhInventoryCounter, WhDocument, WhMovement,
    WhMaintenanceOrder, WhRepair,
    WhInventorySession, WhInventoryItem,
    WhRfq, WhRfqItem, WhRfqQuote,
    WhUtilizationDaily, WhOutbox,
    WhOsvImport, WhOsvLine, WhOsvMapping, WhItemRule, WhOsvPlacement,
  };

  /**
   * Ассоциации. Вызывается из index.js после определения User/MedCenter/
   * StructuralDivision — до этого момента core-моделей ещё нет.
   */
  function associateWarehouse({ User, MedCenter, StructuralDivision }) {
    // Локации
    WhBuilding.belongsTo(MedCenter, { foreignKey: 'medCenterId', as: 'medCenter' });
    MedCenter.hasMany(WhBuilding, { foreignKey: 'medCenterId', as: 'whBuildings' });

    WhBuilding.hasMany(WhFloor, { foreignKey: 'buildingId', as: 'floors', onDelete: 'CASCADE' });
    WhFloor.belongsTo(WhBuilding, { foreignKey: 'buildingId', as: 'building' });

    WhFloor.hasMany(WhRoom, { foreignKey: 'floorId', as: 'rooms', onDelete: 'CASCADE' });
    WhRoom.belongsTo(WhFloor, { foreignKey: 'floorId', as: 'floor' });

    WhFloor.hasMany(WhFloorShape, { foreignKey: 'floorId', as: 'shapes', onDelete: 'CASCADE' });
    WhFloorShape.belongsTo(WhFloor, { foreignKey: 'floorId', as: 'floor' });

    WhDepartment.belongsTo(MedCenter, { foreignKey: 'medCenterId', as: 'medCenter' });
    WhDepartment.belongsTo(WhSpecialty, { foreignKey: 'specialtyCode', targetKey: 'code', as: 'specialty' });
    WhDepartment.belongsTo(User, { foreignKey: 'headUserId', as: 'head' });
    if (StructuralDivision) {
      WhDepartment.belongsTo(StructuralDivision, { foreignKey: 'divisionId', as: 'division' });
    }
    WhDepartment.hasMany(WhRoom, { foreignKey: 'departmentId', as: 'rooms' });
    WhRoom.belongsTo(WhDepartment, { foreignKey: 'departmentId', as: 'department' });
    WhRoom.belongsTo(User, { foreignKey: 'responsibleUserId', as: 'responsible' });

    WhRoom.hasMany(WhStorage, { foreignKey: 'roomId', as: 'storages', onDelete: 'CASCADE' });
    WhStorage.belongsTo(WhRoom, { foreignKey: 'roomId', as: 'room' });

    // Номенклатура
    WhCategory.belongsTo(WhCategory, { foreignKey: 'parentId', as: 'parent' });
    WhCategory.hasMany(WhCategory, { foreignKey: 'parentId', as: 'children' });
    WhNomenclature.belongsTo(WhCategory, { foreignKey: 'categoryId', as: 'category' });
    WhNomenclature.belongsTo(WhContractor, { foreignKey: 'defaultSupplierId', as: 'defaultSupplier' });

    // Активы
    WhAsset.belongsTo(WhCategory, { foreignKey: 'categoryId', as: 'category' });
    WhAsset.belongsTo(WhRoom, { foreignKey: 'roomId', as: 'room' });
    WhAsset.belongsTo(WhStorage, { foreignKey: 'storageId', as: 'storage' });
    WhAsset.belongsTo(User, { foreignKey: 'responsibleUserId', as: 'responsible' });
    WhAsset.belongsTo(WhContractor, { foreignKey: 'supplierId', as: 'supplier' });
    WhRoom.hasMany(WhAsset, { foreignKey: 'roomId', as: 'assets' });
    WhAsset.hasMany(WhAssetFile, { foreignKey: 'assetId', as: 'files', onDelete: 'CASCADE' });
    WhAssetFile.belongsTo(WhAsset, { foreignKey: 'assetId', as: 'asset' });
    WhAssetFile.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });

    // Партии и остатки
    WhBatch.belongsTo(WhNomenclature, { foreignKey: 'nomenclatureId', as: 'nomenclature' });
    WhBatch.belongsTo(WhContractor, { foreignKey: 'supplierId', as: 'supplier' });
    WhNomenclature.hasMany(WhBatch, { foreignKey: 'nomenclatureId', as: 'batches' });

    WhStock.belongsTo(WhNomenclature, { foreignKey: 'nomenclatureId', as: 'nomenclature' });
    WhStock.belongsTo(WhBatch, { foreignKey: 'batchId', as: 'batch' });
    WhStock.belongsTo(WhStorage, { foreignKey: 'storageId', as: 'storage' });
    WhStorage.hasMany(WhStock, { foreignKey: 'storageId', as: 'stock' });

    WhReorderRule.belongsTo(WhNomenclature, { foreignKey: 'nomenclatureId', as: 'nomenclature' });
    WhReorderRule.belongsTo(WhRoom, { foreignKey: 'roomId', as: 'room' });
    WhReorderRule.belongsTo(WhStorage, { foreignKey: 'storageId', as: 'storage' });

    WhConsumptionNorm.belongsTo(WhNomenclature, { foreignKey: 'nomenclatureId', as: 'nomenclature' });
    WhConsumptionNorm.belongsTo(WhDepartment, { foreignKey: 'departmentId', as: 'department' });
    WhConsumptionNorm.belongsTo(WhRoom, { foreignKey: 'roomId', as: 'room' });

    // Документы и движения
    WhDocument.belongsTo(User, { foreignKey: 'createdBy', as: 'author' });
    WhDocument.belongsTo(User, { foreignKey: 'signedBy', as: 'signer' });
    WhDocument.belongsTo(WhRoom, { foreignKey: 'fromRoomId', as: 'fromRoom' });
    WhDocument.belongsTo(WhRoom, { foreignKey: 'toRoomId', as: 'toRoom' });
    WhDocument.belongsTo(WhContractor, { foreignKey: 'contractorId', as: 'contractor' });
    WhDocument.hasMany(WhMovement, { foreignKey: 'documentId', as: 'movements', onDelete: 'CASCADE' });

    WhMovement.belongsTo(WhDocument, { foreignKey: 'documentId', as: 'document' });
    WhMovement.belongsTo(WhAsset, { foreignKey: 'assetId', as: 'asset' });
    WhMovement.belongsTo(WhNomenclature, { foreignKey: 'nomenclatureId', as: 'nomenclature' });
    WhMovement.belongsTo(WhBatch, { foreignKey: 'batchId', as: 'batch' });
    WhMovement.belongsTo(WhStorage, { foreignKey: 'fromStorageId', as: 'fromStorage' });
    WhMovement.belongsTo(WhStorage, { foreignKey: 'toStorageId', as: 'toStorage' });
    WhMovement.belongsTo(WhRoom, { foreignKey: 'fromRoomId', as: 'fromRoom' });
    WhMovement.belongsTo(WhRoom, { foreignKey: 'toRoomId', as: 'toRoom' });
    WhMovement.belongsTo(User, { foreignKey: 'fromResponsibleId', as: 'fromResponsible' });
    WhMovement.belongsTo(User, { foreignKey: 'toResponsibleId', as: 'toResponsible' });
    WhMovement.belongsTo(User, { foreignKey: 'doctorUserId', as: 'doctor' });
    WhMovement.belongsTo(User, { foreignKey: 'initiatorUserId', as: 'initiator' });
    WhAsset.hasMany(WhMovement, { foreignKey: 'assetId', as: 'movements' });

    // ТО и ремонты
    WhMaintenanceOrder.belongsTo(WhAsset, { foreignKey: 'assetId', as: 'asset' });
    WhMaintenanceOrder.belongsTo(WhContractor, { foreignKey: 'contractorId', as: 'contractor' });
    WhMaintenanceOrder.belongsTo(User, { foreignKey: 'engineerUserId', as: 'engineer' });
    WhAsset.hasMany(WhMaintenanceOrder, { foreignKey: 'assetId', as: 'maintenanceOrders' });

    WhRepair.belongsTo(WhAsset, { foreignKey: 'assetId', as: 'asset' });
    WhRepair.belongsTo(WhContractor, { foreignKey: 'contractorId', as: 'contractor' });
    WhAsset.hasMany(WhRepair, { foreignKey: 'assetId', as: 'repairs' });

    // Инвентаризация
    WhInventorySession.belongsTo(WhRoom, { foreignKey: 'roomId', as: 'room' });
    WhInventorySession.belongsTo(WhDepartment, { foreignKey: 'departmentId', as: 'department' });
    WhInventorySession.belongsTo(User, { foreignKey: 'chairmanUserId', as: 'chairman' });
    WhInventorySession.belongsTo(User, { foreignKey: 'responsibleUserId', as: 'responsible' });
    WhInventorySession.hasMany(WhInventoryItem, { foreignKey: 'sessionId', as: 'items', onDelete: 'CASCADE' });
    WhInventoryItem.belongsTo(WhInventorySession, { foreignKey: 'sessionId', as: 'session' });
    WhInventoryItem.belongsTo(WhAsset, { foreignKey: 'assetId', as: 'asset' });
    WhInventoryItem.belongsTo(WhNomenclature, { foreignKey: 'nomenclatureId', as: 'nomenclature' });
    WhInventoryItem.belongsTo(WhBatch, { foreignKey: 'batchId', as: 'batch' });
    WhInventoryItem.belongsTo(WhStorage, { foreignKey: 'storageId', as: 'storage' });

    // Котировки
    WhRfq.hasMany(WhRfqItem, { foreignKey: 'rfqId', as: 'items', onDelete: 'CASCADE' });
    WhRfq.hasMany(WhRfqQuote, { foreignKey: 'rfqId', as: 'quotes', onDelete: 'CASCADE' });
    WhRfq.belongsTo(WhRoom, { foreignKey: 'roomId', as: 'room' });
    WhRfq.belongsTo(WhContractor, { foreignKey: 'decidedContractorId', as: 'decidedContractor' });
    WhRfqItem.belongsTo(WhRfq, { foreignKey: 'rfqId', as: 'rfq' });
    WhRfqItem.belongsTo(WhNomenclature, { foreignKey: 'nomenclatureId', as: 'nomenclature' });
    WhRfqQuote.belongsTo(WhRfq, { foreignKey: 'rfqId', as: 'rfq' });
    WhRfqQuote.belongsTo(WhContractor, { foreignKey: 'contractorId', as: 'contractor' });

    // Загрузка
    WhUtilizationDaily.belongsTo(WhRoom, { foreignKey: 'roomId', as: 'room' });
    WhRoom.hasMany(WhUtilizationDaily, { foreignKey: 'roomId', as: 'utilization' });

    // Ведомость 1С
    WhOsvImport.hasMany(WhOsvLine, { foreignKey: 'importId', as: 'lines', onDelete: 'CASCADE' });
    WhOsvLine.belongsTo(WhOsvImport, { foreignKey: 'importId', as: 'import' });
    WhOsvImport.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });
    WhOsvImport.belongsTo(User, { foreignKey: 'appliedBy', as: 'applier' });
    WhOsvMapping.belongsTo(WhNomenclature, { foreignKey: 'nomenclatureId', as: 'nomenclature' });
    WhOsvMapping.belongsTo(WhCategory, { foreignKey: 'categoryId', as: 'category' });
    WhOsvMapping.belongsTo(WhRoom, { foreignKey: 'roomId', as: 'room' });
    WhOsvMapping.belongsTo(User, { foreignKey: 'mappedBy', as: 'author' });

    WhItemRule.belongsTo(WhCategory, { foreignKey: 'categoryId', as: 'category' });
    WhItemRule.belongsTo(User, { foreignKey: 'createdBy', as: 'author' });

    WhOsvPlacement.belongsTo(WhRoom, { foreignKey: 'roomId', as: 'room' });
    WhOsvPlacement.belongsTo(WhStorage, { foreignKey: 'storageId', as: 'storage' });
    WhOsvPlacement.belongsTo(User, { foreignKey: 'placedBy', as: 'author' });
    WhAsset.belongsTo(WhOsvPlacement, { foreignKey: 'osvPlacementId', as: 'osvPlacement' });
  }

  return { models, associateWarehouse };
};
