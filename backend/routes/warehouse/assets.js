/**
 * Основные средства: инвентарные карточки, инвентарные номера, QR, этикетки,
 * документы и фото.
 *
 * Инвентарный номер присваивается один раз при постановке на учёт и не меняется
 * никогда — даже при переводе актива в другое отделение. Он отражает
 * специальность на момент постановки, а не текущее размещение (иначе рушится
 * история): см. Приложение А ТЗ и комментарий в services/warehouse/numbering.js.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { Op } = require('sequelize');
const {
  sequelize, WhAsset, WhAssetFile, WhRoom, WhFloor, WhBuilding, WhDepartment,
  WhStorage, WhCategory, WhContractor, WhMaintenanceOrder, WhRepair, WhMovement,
  MedCenter, User,
} = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse } = require('../../services/warehouse/access');
const { generateInventoryNumber } = require('../../services/warehouse/numbering');
const { splitName } = require('../../services/warehouse/nameParts');
const qr = require('../../services/warehouse/qr');
const ptouch = require('../../services/warehouse/ptouchRaster');

const userAttrs = ['id', 'displayName', 'username', 'avatar'];

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const dir = path.join(process.env.UPLOAD_PATH || './uploads', 'warehouse', 'assets');
      try {
        await fs.mkdir(dir, { recursive: true });
        cb(null, dir);
      } catch (e) { cb(e); }
    },
    filename: (req, file, cb) => {
      const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, 'wh-asset-' + suffix + path.extname(file.originalname));
    },
  }),
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    cb(null, allowed.includes(file.mimetype));
  },
});

const assetInclude = [
  {
    model: WhRoom, as: 'room',
    include: [
      { model: WhDepartment, as: 'department', attributes: ['id', 'name', 'color', 'specialtyCode'] },
      { model: MedCenter, as: 'medCenter', attributes: ['id', 'name', 'displayName', 'address', 'city'] },
      {
        model: WhFloor, as: 'floor',
        include: [{
          model: WhBuilding, as: 'building', attributes: ['id', 'name', 'address', 'medCenterId'],
          include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name', 'displayName', 'address', 'city'] }],
        }],
      },
    ],
  },
  { model: WhStorage, as: 'storage', attributes: ['id', 'name', 'kind'] },
  { model: User, as: 'responsible', attributes: userAttrs },
  { model: WhCategory, as: 'category', attributes: ['id', 'name', 'kind', 'okof', 'depreciationGroup'] },
  { model: WhContractor, as: 'supplier', attributes: ['id', 'name'] },
];

// Лента 20 мм убрана: после неснимаемых полей на ней оставалось около 13 мм
// печати, и туда не помещалось ничего, кроме кода.
const EQUIPMENT_LABEL_SIZES = ['80x24', '44x25'];

/**
 * Статус карточки правится руками — кроме одного значения.
 *
 * «Списано» — не состояние, а событие: оно выводит вещь с баланса. Документ
 * списания делает это целиком (движение в журнале, isArchived, актив уходит из
 * описи и отчётов), а тот же статус, выставленный из формы, менял только
 * подпись на карточке. Получалось два разных списания: одно настоящее, другое —
 * вещь, помеченная списанной, но по-прежнему стоящая в ведомости амортизации,
 * попадающая в опись и доступная к выдаче.
 *
 * То же ограничение действует и в массовой правке: массовая операция не может
 * быть лазейкой в обход правила.
 */
const EDITABLE_STATUSES = new Set(['in_use', 'maintenance', 'repair', 'storage', 'reserved']);

function checkStatus(patch, asset) {
  if (patch.status === undefined) return null;
  if (!EDITABLE_STATUSES.has(patch.status)) {
    return patch.status === 'written_off'
      ? 'Списание оформляется документом, а не сменой статуса в карточке'
      : `Неизвестный статус «${patch.status}»`;
  }
  if (asset && (asset.isArchived || asset.status === 'written_off')) {
    return 'Актив списан — вернуть его в работу правкой карточки нельзя';
  }
  return null;
}

/**
 * Деньги в карточке. Отрицательная стоимость уезжает в стоимость кабинета и в
 * суммовые отчёты со знаком минус, а износ больше первоначальной стоимости даёт
 * отрицательную остаточную и износ за сто процентов.
 */
function checkMoney(patch, asset = null) {
  const initial = patch.initialCost !== undefined
    ? Number(patch.initialCost)
    : Number(asset?.initialCost ?? 0);
  const accumulated = patch.accumulatedDepreciation !== undefined
    ? Number(patch.accumulatedDepreciation)
    : Number(asset?.accumulatedDepreciation ?? 0);

  if (!Number.isFinite(initial) || initial < 0) return 'Первоначальная стоимость не может быть отрицательной';
  if (!Number.isFinite(accumulated) || accumulated < 0) return 'Накопленная амортизация не может быть отрицательной';
  if (accumulated - initial > 0.005) {
    return `Накопленная амортизация ${accumulated} больше первоначальной стоимости ${initial}`;
  }
  return null;
}

// ── Список активов ───────────────────────────────────────────────────────────
router.get('/', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const {
      q, roomId, departmentId, medCenterId, status, categoryId,
      responsibleUserId, maintenanceDue, archived, page = 1, limit = 50,
    } = req.query;

    const where = { isArchived: archived === 'true' };
    if (status) where.status = { [Op.in]: String(status).split(',') };
    if (categoryId) where.categoryId = categoryId;
    if (roomId) where.roomId = roomId;
    if (responsibleUserId) where.responsibleUserId = responsibleUserId;
    if (q) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { inventoryNumber: { [Op.iLike]: `%${q}%` } },
        { serialNumber: { [Op.iLike]: `%${q}%` } },
        { model: { [Op.iLike]: `%${q}%` } },
      ];
    }
    // «ТО на подходе» — 30 дней вперёд плюс всё уже просроченное.
    if (maintenanceDue === 'true') {
      const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      where.nextMaintenanceDate = { [Op.lte]: horizon };
    }

    // Ограничение по зоне ответственности. Пустой список кабинетов даёт пустой
    // результат — это правильно: человек без своих кабинетов не должен видеть сеть.
    const scoped = await req.warehouse.scopedRoomIds();
    if (scoped !== null) {
      where.roomId = roomId && scoped.includes(roomId) ? roomId : { [Op.in]: scoped };
    }

    const roomFilter = {};
    if (departmentId) roomFilter.departmentId = departmentId;

    const rows = await WhAsset.findAndCountAll({
      where,
      include: assetInclude.map(inc => {
        if (inc.as === 'room' && (departmentId || medCenterId)) {
          return {
            ...inc,
            required: true,
            where: departmentId ? { departmentId } : undefined,
            include: inc.include.map(sub => {
              if (sub.as === 'floor' && medCenterId) {
                return {
                  ...sub, required: true,
                  include: [{ model: WhBuilding, as: 'building', required: true, where: { medCenterId } }],
                };
              }
              return sub;
            }),
          };
        }
        return inc;
      }),
      order: [['inventoryNumber', 'ASC']],
      limit: Math.min(Number(limit) || 50, 500),
      offset: ((Number(page) || 1) - 1) * (Number(limit) || 50),
      distinct: true,
    });

    res.json({ total: rows.count, items: rows.rows });
  } catch (err) {
    console.error('GET warehouse/assets error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Карточка актива ──────────────────────────────────────────────────────────
router.get('/:id', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const asset = await WhAsset.findByPk(req.params.id, { include: assetInclude });
    if (!asset) return res.status(404).json({ error: 'Актив не найден' });

    const [files, maintenance, repairs, movements] = await Promise.all([
      WhAssetFile.findAll({
        where: { assetId: asset.id },
        include: [{ model: User, as: 'uploader', attributes: userAttrs }],
        order: [['createdAt', 'DESC']],
      }),
      WhMaintenanceOrder.findAll({
        where: { assetId: asset.id },
        include: [{ model: WhContractor, as: 'contractor', attributes: ['id', 'name'] }],
        order: [['plannedDate', 'DESC']],
      }),
      WhRepair.findAll({
        where: { assetId: asset.id },
        include: [{ model: WhContractor, as: 'contractor', attributes: ['id', 'name'] }],
        order: [['startedAt', 'DESC']],
      }),
      // Лента жизни актива — режим 2 отчёта № 2.
      WhMovement.findAll({
        where: { assetId: asset.id },
        include: [
          { model: WhRoom, as: 'fromRoom', attributes: ['id', 'number', 'name'] },
          { model: WhRoom, as: 'toRoom', attributes: ['id', 'number', 'name'] },
          { model: User, as: 'fromResponsible', attributes: userAttrs },
          { model: User, as: 'toResponsible', attributes: userAttrs },
          { model: User, as: 'initiator', attributes: userAttrs },
        ],
        order: [['occurredAt', 'DESC']],
        limit: 200,
      }),
    ]);

    // Остаточная стоимость и износ считаются из того, что пришло из бухгалтерии,
    // а не начисляются здесь: владелец амортизации — 1С.
    const initial = Number(asset.initialCost) || 0;
    const accumulated = Number(asset.accumulatedDepreciation) || 0;
    const residual = Math.max(0, initial - accumulated);

    res.json({
      asset,
      publicUrl: qr.assetPublicUrl(asset.publicToken),
      depreciation: {
        initialCost: initial,
        accumulated,
        residual,
        wearPercent: initial > 0 ? Math.round((accumulated / initial) * 1000) / 10 : 0,
        // Признак из отчёта № 5: самортизировано, но в эксплуатации — кандидат на замену.
        fullyDepreciatedInUse: initial > 0 && accumulated >= initial && asset.status === 'in_use',
        source: 'manual',
      },
      files, maintenance, repairs, movements,
    });
  } catch (err) {
    console.error('GET warehouse/assets/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Создание актива ──────────────────────────────────────────────────────────
router.post('/', authenticate, requireWarehouse('canManageAssets'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const b = req.body;
    if (!b.name?.trim()) {
      await t.rollback();
      return res.status(400).json({ error: 'Нужно наименование' });
    }
    if (!b.roomId || !b.storageId) {
      await t.rollback();
      return res.status(400).json({ error: 'Оборудование нужно привязать к кабинету и месту хранения' });
    }
    const storage = await WhStorage.findByPk(b.storageId, { transaction: t });
    if (!storage || storage.roomId !== b.roomId) {
      await t.rollback();
      return res.status(400).json({ error: 'Место хранения не относится к выбранному кабинету' });
    }

    // Заводить карточку сразу списанной бессмысленно: постановка на учёт — это
    // приход, а списание — выбытие, и одним действием они не бывают.
    const badState = checkStatus({ status: b.status || 'in_use' }, null) || checkMoney(b);
    if (badState) {
      await t.rollback();
      return res.status(400).json({ error: badState });
    }

    // Код специальности для маски берём из отделения кабинета: держать его
    // отдельным полем значило бы дать им разойтись.
    let specialtyCode = b.specialtyCode;
    if (!specialtyCode && b.roomId) {
      const room = await WhRoom.findByPk(b.roomId, {
        include: [{ model: WhDepartment, as: 'department' }], transaction: t,
      });
      specialtyCode = room?.department?.specialtyCode || 'АХО';
    }

    const inventoryNumber = b.inventoryNumber?.trim() || await generateInventoryNumber({
      specialtyCode: specialtyCode || 'АХО',
      year: b.purchaseDate ? new Date(b.purchaseDate).getFullYear() : new Date().getFullYear(),
      transaction: t,
    });

    const asset = await WhAsset.create({
      inventoryNumber,
      name: b.name.trim(),
      model: b.model?.trim() || null,
      serialNumber: b.serialNumber?.trim() || null,
      manufacturer: b.manufacturer?.trim() || null,
      categoryId: b.categoryId || null,
      roomId: b.roomId || null,
      storageId: b.storageId || null,
      responsibleUserId: b.responsibleUserId || null,
      status: b.status || 'in_use',
      purchaseDate: b.purchaseDate || null,
      commissioningDate: b.commissioningDate || null,
      initialCost: b.initialCost || 0,
      usefulLifeMonths: b.usefulLifeMonths || null,
      depreciationGroup: b.depreciationGroup || null,
      depreciationMethod: b.depreciationMethod || 'linear',
      okof: b.okof || null,
      accumulatedDepreciation: b.accumulatedDepreciation || 0,
      depreciationAsOf: b.depreciationAsOf || null,
      fundingSource: b.fundingSource || null,
      warrantyUntil: b.warrantyUntil || null,
      supplierId: b.supplierId || null,
      maintenanceIntervalMonths: b.maintenanceIntervalMonths || null,
      nextMaintenanceDate: b.nextMaintenanceDate || null,
      dailyCapacityHours: b.dailyCapacityHours ?? 8,
      notes: b.notes || null,
      publicToken: qr.generateToken(),
      lastActivityAt: new Date(),
      createdBy: req.user.id,
    }, { transaction: t });

    // Постановка на учёт — тоже движение: без неё лента жизни актива начинается
    // с пустоты, и в отчёте № 2 приём не виден.
    await WhMovement.create({
      type: 'receipt',
      assetId: asset.id,
      quantity: 1,
      unitCost: asset.initialCost,
      amount: asset.initialCost,
      toRoomId: asset.roomId,
      toStorageId: asset.storageId,
      toResponsibleId: asset.responsibleUserId,
      reasonCode: 'initial',
      reasonText: 'Постановка на учёт',
      initiatorUserId: req.user.id,
      occurredAt: new Date(),
    }, { transaction: t });

    await t.commit();
    const full = await WhAsset.findByPk(asset.id, { include: assetInclude });
    res.status(201).json(full);
  } catch (err) {
    await t.rollback();
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Такой инвентарный номер уже занят' });
    }
    console.error('POST warehouse/assets error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Правка актива ────────────────────────────────────────────────────────────
// Размещение и МОЛ через этот метод НЕ меняются: перемещение оформляется
// документом (POST /warehouse/operations/documents), иначе актив переехал бы без
// следа в журнале, и отчёт № 2 перестал бы быть аудиторским.
router.put('/:id', authenticate, requireWarehouse('canManageAssets'), async (req, res) => {
  try {
    const asset = await WhAsset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Актив не найден' });

    const editable = [
      'name', 'model', 'serialNumber', 'manufacturer', 'categoryId', 'status',
      'purchaseDate', 'commissioningDate', 'initialCost', 'usefulLifeMonths',
      'depreciationGroup', 'depreciationMethod', 'okof', 'accumulatedDepreciation',
      'depreciationAsOf', 'fundingSource', 'warrantyUntil', 'supplierId',
      'maintenanceIntervalMonths', 'nextMaintenanceDate', 'dailyCapacityHours', 'notes',
    ];
    const patch = {};
    for (const key of editable) {
      if (req.body[key] !== undefined) patch[key] = req.body[key] === '' ? null : req.body[key];
    }

    const bad = checkStatus(patch, asset) || checkMoney(patch, asset);
    if (bad) return res.status(400).json({ error: bad });

    await asset.update(patch);

    const full = await WhAsset.findByPk(asset.id, { include: assetInclude });
    res.json(full);
  } catch (err) {
    console.error('PUT warehouse/assets/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Массовая правка карточек ─────────────────────────────────────────────────
/**
 * Одно и то же поле сразу у пачки активов.
 *
 * ── Зачем ────────────────────────────────────────────────────────────────────
 *
 * После разбора ведомости в портале три тысячи карточек, у которых пустые
 * категория, интервал ТО и срок службы. Проставлять их по одной — это три тысячи
 * открытий формы, и такой работы никто не делает: поля так и остаются пустыми, а
 * вместе с ними бесполезны отчёты, которые на них опираются.
 *
 * ── Чего здесь намеренно нет ─────────────────────────────────────────────────
 *
 * Кабинета, места хранения и МОЛ. Это размещение, и меняется оно документом
 * перемещения — иначе актив сменил бы место без следа в журнале, и отчёт
 * «Движение активов» перестал бы быть аудиторским. Ровно то же ограничение
 * действует в форме правки одной карточки, и разойтись им нельзя: массовая
 * операция не может быть лазейкой в обход правила.
 *
 * Наименования тут тоже нет: одинаковое имя у пачки активов — это не правка, а
 * потеря данных.
 */
router.post('/bulk', authenticate, requireWarehouse('canManageAssets'), async (req, res) => {
  try {
    const { ids = [], patch = {} } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'Не выбраны активы' });
    }
    if (ids.length > 1000) {
      return res.status(400).json({ error: 'За раз не больше 1000 карточек' });
    }

    const allowed = [
      'categoryId', 'status', 'maintenanceIntervalMonths', 'nextMaintenanceDate',
      'usefulLifeMonths', 'depreciationGroup', 'okof', 'supplierId',
      'fundingSource', 'dailyCapacityHours', 'warrantyUntil',
    ];
    const update = {};
    for (const key of allowed) {
      if (patch[key] !== undefined) update[key] = patch[key] === '' ? null : patch[key];
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'Нечего менять' });
    }

    // Архивные отфильтрованы условием ниже, поэтому проверка статуса здесь
    // смотрит только на само значение — актив в неё не передаётся.
    const bad = checkStatus(update, null);
    if (bad) return res.status(400).json({ error: bad });

    // Архивные не трогаем: они выведены из оборота, и массовая правка по фильтру
    // легко зацепила бы их незаметно.
    const [updated] = await WhAsset.update(update, {
      where: { id: { [Op.in]: ids }, isArchived: false },
    });

    res.json({ updated, fields: Object.keys(update) });
  } catch (err) {
    console.error('POST warehouse/assets/bulk error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Поиск по инвентарному номеру или токену: то, что дёргает сканер ──────────
// Отдельный эндпоинт, потому что сканер должен работать одинаково и при чтении QR
// (токен), и при ручном вводе номера с этикетки — камера в браузере требует HTTPS
// и доступна не всегда, ручной ввод обязан быть равноправным путём.
router.get('/lookup/:code', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Пустой код' });

    // Из QR может прийти целый URL — вытаскиваем последний сегмент.
    const token = code.includes('/') ? code.split('/').filter(Boolean).pop() : code;

    const asset = await WhAsset.findOne({
      where: { [Op.or]: [{ publicToken: token }, { inventoryNumber: code }] },
      include: assetInclude,
    });
    if (asset) return res.json({ kind: 'asset', asset });

    // Код с двери кабинета ведёт не на публичную страницу с токеном, а внутрь
    // портала: /warehouse?room=<id>. Последний сегмент такого адреса — это
    // «warehouse?room=…», и по нему не находилось ничего, поэтому идентификатор
    // достаём из параметра. Токен продолжаем принимать: у карточек, напечатанных
    // раньше, в коде именно он.
    const roomId = (code.match(/[?&]room=([0-9a-fA-F-]{36})/) || [])[1] || null;
    const room = await WhRoom.findOne({
      where: roomId ? { [Op.or]: [{ id: roomId }, { publicToken: token }] } : { publicToken: token },
      include: [{ model: WhDepartment, as: 'department' }],
    });
    if (room) return res.json({ kind: 'room', room });

    res.status(404).json({ error: 'Ничего не найдено по этому коду' });
  } catch (err) {
    console.error('GET warehouse/assets/lookup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── QR и этикетки ────────────────────────────────────────────────────────────
router.get('/:id/qr.svg', authenticate, requireWarehouse(), async (req, res) => {
  const asset = await WhAsset.findByPk(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Актив не найден' });
  const svg = await qr.qrSvg(qr.assetPublicUrl(asset.publicToken), { width: Number(req.query.size) || 256 });
  res.type('image/svg+xml').send(svg);
});

router.get('/:id/label.svg', authenticate, requireWarehouse(), async (req, res) => {
  try {
    const asset = await WhAsset.findByPk(req.params.id, { include: assetInclude });
    if (!asset) return res.status(404).json({ error: 'Актив не найден' });
    const svg = await qr.assetLabelSvg(asset, {
      size: EQUIPMENT_LABEL_SIZES.includes(req.query.size) ? req.query.size : '80x24',
    });
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    console.error('GET label.svg error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Печать защищена правом «Этикетки и QR», а не правом вести учёт. Раньше эти
// три ручки просили canManageAssets, при том что кабинетные этикетки рядом
// просили canPrintLabels, а список активов рисовал кнопку печати по любому из
// двух прав. У кладовщика с одним лишь правом на этикетки кнопка была, а печать
// падала 403 — и на телефоне это первое, обо что спотыкались.
router.get('/:id/label.zpl', authenticate, requireWarehouse('canPrintLabels'), async (req, res) => {
  const asset = await WhAsset.findByPk(req.params.id, { include: assetInclude });
  if (!asset) return res.status(404).json({ error: 'Актив не найден' });
  const zpl = qr.assetLabelZpl(asset, {
    copies: Number(req.query.copies) || 1,
  });
  res.type('text/plain; charset=utf-8').send(zpl);
});

/**
 * Пакет этикеток: SVG-страницы для печати из браузера. Отдаём массив SVG, а
 * раскладку по листу A4 делает клиент — так проще подогнать под конкретный
 * принтер и не гонять PDF ради предпросмотра.
 */
router.post('/labels/batch', authenticate, requireWarehouse('canPrintLabels'), async (req, res) => {
  try {
    const { ids = [], size = '80x24', rotate } = req.body;
    const labelSize = EQUIPMENT_LABEL_SIZES.includes(size) ? size : '80x24';
    // Поворот нужен только скачиваемому файлу под ленточный принтер; из
    // произвольного числа берём один из четырёх прямых углов.
    const turn = [90, 180, 270].includes(Number(rotate)) ? Number(rotate) : 0;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Не выбраны активы' });
    if (ids.length > 200) return res.status(400).json({ error: 'За раз не больше 200 этикеток' });

    const assets = await WhAsset.findAll({ where: { id: { [Op.in]: ids } }, include: assetInclude });
    const labels = [];
    for (const a of assets) {
      const svg = await qr.assetLabelSvg(a, { size: labelSize });
      const png = await qr.labelPng(svg, labelSize, { rotate: turn });
      labels.push({
        id: a.id,
        inventoryNumber: a.inventoryNumber,
        png: `data:image/png;base64,${png.toString('base64')}`,
      });
    }

    // Отмечаем факт печати: по нему видно, какие активы промаркированы, а какие
    // ещё живут без этикетки.
    await WhAsset.update({ labelPrintedAt: new Date() }, { where: { id: { [Op.in]: assets.map(a => a.id) } } });

    res.json({ size: labelSize, rotate: turn, labels, sizeMm: qr.LABEL_SIZES[labelSize] });
  } catch (err) {
    console.error('POST warehouse/assets/labels/batch error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Пакет отдельных ZPL-заданий для TDP-225, каждое строго 44x25 мм. */
router.post('/labels/batch.zpl', authenticate, requireWarehouse('canPrintLabels'), async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Не выбраны активы' });
    if (ids.length > 200) return res.status(400).json({ error: 'За раз не больше 200 этикеток' });

    const assets = await WhAsset.findAll({ where: { id: { [Op.in]: ids } }, include: assetInclude });
    const zpl = assets.map(asset => qr.assetLabelZpl(asset, {
    })).join('\n');

    await WhAsset.update(
      { labelPrintedAt: new Date() },
      { where: { id: { [Op.in]: assets.map(asset => asset.id) } } },
    );
    res.type('text/plain; charset=utf-8').send(zpl);
  } catch (err) {
    console.error('POST warehouse/assets/labels/batch.zpl error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Готовое задание печати для Brother P-touch — то, что телефон выкладывает в
 * сокет принтера как есть.
 *
 * Считается на сервере, а не в мобилке, по двум причинам. Растеризация лежит
 * здесь же, где вёрстка этикетки, и расходиться им незачем. И, что важнее,
 * телефон на бегу может оказаться в сети самого принтера — без интернета и без
 * портала: задание должно быть готово и лежать в кармане до того, как человек
 * переключит вайфай. Поэтому ручка отдаёт всю пачку одним куском base64.
 *
 * labelPrintedAt здесь не трогаем: подготовка задания ещё не печать, а сокет
 * может и не открыться. Отметку ставит мобилка после успешной отправки.
 */
router.post('/labels/batch.prn', authenticate, requireWarehouse('canPrintLabels'), async (req, res) => {
  try {
    const { ids = [], rotate, mirror, autoCut } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Не выбраны активы' });
    if (ids.length > 200) return res.status(400).json({ error: 'За раз не больше 200 этикеток' });

    const assets = await WhAsset.findAll({ where: { id: { [Op.in]: ids } }, include: assetInclude });
    const byId = new Map(assets.map(a => [a.id, a]));
    // Порядок задаём порядком запроса: человек отмечал активы сверху вниз и ждёт
    // ленту в том же порядке, а findAll возвращает строки как ему удобно.
    const ordered = ids.map(id => byId.get(id)).filter(Boolean);
    if (!ordered.length) return res.status(404).json({ error: 'Ни одного из выбранных активов не нашлось' });

    const pngs = [];
    for (const asset of ordered) {
      pngs.push(await qr.labelPng(await qr.assetLabelSvg(asset, { size: '80x24' }), '80x24'));
    }
    const job = await ptouch.buildJobFromPngs(pngs, {
      rotate: Number(rotate) === 270 ? 270 : 90,
      // Зеркало по умолчанию включено — так печатает наш PT-E550W (см. ptouchRaster.js)
      mirror: mirror !== false,
      autoCut: autoCut !== false,
    });

    res.json({
      labels: ordered.map(a => ({ id: a.id, inventoryNumber: a.inventoryNumber, name: a.name })),
      bytes: job.length,
      prn: job.toString('base64'),
    });
  } catch (err) {
    console.error('POST warehouse/assets/labels/batch.prn error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Отметка «этикетки напечатаны» — ставится после того, как принтер их принял. */
router.post('/labels/printed', authenticate, requireWarehouse('canPrintLabels'), async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Не переданы активы' });
    await WhAsset.update(
      { labelPrintedAt: new Date() },
      { where: { id: { [Op.in]: ids.slice(0, 200) } } },
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('POST warehouse/assets/labels/printed error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Разбор названий: модель и производитель ──────────────────────────────────
/**
 * Вытащить модель и производителя из наименования у карточек, где эти поля
 * пустые.
 *
 * ── Почему обязательно с предпросмотром ──────────────────────────────────────
 *
 * Разбор эвристический: правил, которые верно разберут любое название из 1С, не
 * существует. На августовской выгрузке модель находится примерно у трети
 * позиций, и часть находок спорна — «Кабель USB2.0 НАМА Н-34694» даёт моделью
 * USB2.0. Поэтому запуск без dryRun человек делает, уже увидев список «было →
 * стало», а не вслепую по трём тысячам карточек.
 *
 * ── Почему наименование не меняется ──────────────────────────────────────────
 *
 * По названию сходится сверка с бухгалтерией: оно должно остаться ровно тем, что
 * в ведомости. Заполняются только пустые поля модели и производителя — то, что
 * человек уже ввёл руками, не перезаписывается никогда.
 */
router.post('/parse-names', authenticate, requireWarehouse('canManageAssets'), async (req, res) => {
  try {
    const { dryRun = true, ids = null, limit = 500 } = req.body || {};

    const where = {
      isArchived: false,
      [Op.or]: [{ model: null }, { manufacturer: null }],
    };
    if (Array.isArray(ids) && ids.length) where.id = { [Op.in]: ids };

    const assets = await WhAsset.findAll({
      where,
      attributes: ['id', 'inventoryNumber', 'name', 'model', 'manufacturer'],
      limit: Math.min(Number(limit) || 500, 2000),
      order: [['createdAt', 'ASC']],
    });

    const changes = [];
    for (const asset of assets) {
      const parts = splitName(asset.name);
      const patch = {};
      if (!asset.model && parts.model) patch.model = parts.model.slice(0, 200);
      if (!asset.manufacturer && parts.manufacturer) {
        patch.manufacturer = parts.manufacturer.slice(0, 200);
      }
      if (!Object.keys(patch).length) continue;
      changes.push({
        id: asset.id,
        inventoryNumber: asset.inventoryNumber,
        name: asset.name,
        ...patch,
      });
    }

    if (!dryRun) {
      // По одному апдейту на карточку: полей два, значения у всех разные, и
      // собирать из этого один CASE-запрос ради трёх тысяч строк, которые
      // разбирают один раз в жизни, — оптимизация без адресата.
      await sequelize.transaction(async (t) => {
        for (const change of changes) {
          await WhAsset.update(
            {
              ...(change.model ? { model: change.model } : {}),
              ...(change.manufacturer ? { manufacturer: change.manufacturer } : {}),
            },
            { where: { id: change.id }, transaction: t },
          );
        }
      });
    }

    res.json({
      dryRun,
      scanned: assets.length,
      changed: changes.length,
      // Обрезаем список для показа: разбирают тысячи, а глазами проверяют первые
      // десятки — и по ним видно, годится разбор или нет.
      samples: changes.slice(0, 60),
    });
  } catch (err) {
    console.error('POST warehouse/assets/parse-names error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Файлы ────────────────────────────────────────────────────────────────────
router.post('/:id/files', authenticate, requireWarehouse('canManageAssets'), upload.array('files', 10), async (req, res) => {
  try {
    const asset = await WhAsset.findByPk(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Актив не найден' });
    if (!req.files?.length) return res.status(400).json({ error: 'Файлы не переданы' });

    const rows = await WhAssetFile.bulkCreate(req.files.map(f => ({
      assetId: asset.id,
      kind: req.body.kind || 'other',
      // multer отдаёт имя в latin1 — без перекодировки русские названия ломаются.
      originalName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
      storedName: f.filename,
      mimeType: f.mimetype,
      size: f.size,
      isPublic: req.body.isPublic === 'true',
      uploadedBy: req.user.id,
    })));
    res.status(201).json(rows);
  } catch (err) {
    console.error('POST warehouse/assets/:id/files error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/files/:fileId', authenticate, requireWarehouse('canManageAssets'), async (req, res) => {
  const file = await WhAssetFile.findByPk(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'Файл не найден' });
  const { kind, isPublic } = req.body;
  await file.update({
    ...(kind !== undefined ? { kind } : {}),
    ...(isPublic !== undefined ? { isPublic: Boolean(isPublic) } : {}),
  });
  res.json(file);
});

router.delete('/files/:fileId', authenticate, requireWarehouse('canManageAssets'), async (req, res) => {
  try {
    const file = await WhAssetFile.findByPk(req.params.fileId);
    if (!file) return res.status(404).json({ error: 'Файл не найден' });
    const full = path.join(process.env.UPLOAD_PATH || './uploads', 'warehouse', 'assets', file.storedName);
    await fs.unlink(full).catch(() => {}); // файла может уже не быть — запись всё равно убираем
    await file.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE warehouse/assets/files error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
