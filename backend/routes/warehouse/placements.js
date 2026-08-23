/**
 * Размещение позиций ведомости по кабинетам.
 *
 * ── Почему экран работает от кабинета, а не от строки ────────────────────────
 *
 * Раскладывать три тысячи строк, выбирая кабинет из сотни в выпадающем списке, —
 * это три тысячи выборов кабинета. Человек же работает иначе: он стоит в 305-м и
 * знает, что в нём. Поэтому кабинет выбирается ОДИН раз, а в него набрасываются
 * позиции — сто выборов кабинета вместо трёх тысяч, и в том порядке, в каком
 * обходят здание.
 *
 * Отсюда состав маршрутов: «что ещё нигде не лежит» (очередь), «что уже лежит в
 * этом кабинете» (проверить себя) и постановка пачкой.
 *
 * ── Почему размещение нельзя снять после разбора ─────────────────────────────
 *
 * Как только по размещению прошёл разбор, оно перестаёт быть намерением и
 * становится фактом: у карточек есть инвентарные номера, они напечатаны на
 * этикетках и попали в движения, а у материалов остаток лежит на полке. Удалить
 * размещение значило бы оставить это без источника, а следующий разбор создал бы
 * всё заново — вторые номера на те же вещи и второй остаток на тот же товар.
 * Переезд после разбора оформляется документом перемещения, как и любой другой
 * переезд.
 *
 * Признак «разбор прошёл» у оборудования и материалов считается по-разному —
 * см. materializedBy ниже.
 */

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

const {
  sequelize, WhOsvPlacement, WhOsvImport, WhOsvLine, WhAsset, WhRoom, WhStorage,
  WhFloor, WhBuilding, WhDepartment, WhNomenclature, WhStock, User,
} = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse, requireReport } = require('../../services/warehouse/access');
const { planMaterialization, materializeOsv } = require('../../services/warehouse/osvMaterialize');
const { rollbackRoomPlacement } = require('../../services/warehouse/osvRollback');

const roomInclude = [
  { model: WhStorage, as: 'storages', attributes: ['id', 'name'], required: false },
  { model: WhDepartment, as: 'department', attributes: ['id', 'name', 'specialtyCode'], required: false },
  {
    model: WhFloor,
    as: 'floor',
    attributes: ['id', 'number'],
    include: [{ model: WhBuilding, as: 'building', attributes: ['id', 'name'] }],
  },
];

/** Применённый снимок: с ним работает весь экран. */
async function currentSnapshot(importId) {
  if (importId) return WhOsvImport.findByPk(importId);
  return WhOsvImport.findOne({
    where: { status: 'applied' },
    order: [['periodYear', 'DESC'], ['periodMonth', 'DESC']],
  });
}

/**
 * Что уже создано разбором по этому размещению.
 *
 * У оборудования ответ прямой: карточка ссылается на размещение полем
 * osvPlacementId. У материала ссылки нет и быть не может — остаток складывается
 * в общую строку warehouse_stock по паре «номенклатура + место хранения», и одно
 * размещение от другого там не отличить.
 *
 * Из-за этого материальное размещение считалось неразобранным ВСЕГДА: счётчик
 * карточек у него ноль, и снять или переписать его давали свободно. Снятое
 * размещение уносило с собой только намерение — остаток оставался лежать. Строка
 * возвращалась в очередь как неразложенная, её клали в другой кабинет, разбор
 * доводил остаток там до полного количества и чужих мест не трогал: в портале
 * оказывалось вдвое больше, чем в ведомости.
 *
 * Поэтому у материала признак разбора выводится по факту: есть ли номенклатура,
 * созданная по этой строке ведомости, и лежит ли по ней остаток в том месте
 * хранения, куда разбор его положил бы. Место вычисляется тем же правилом, что и
 * в самой материализации (storageFor в services/warehouse/osvMaterialize.js):
 * явное место размещения, иначе первое активное место кабинета.
 */
async function materializedBy(placement) {
  const assets = await WhAsset.count({ where: { osvPlacementId: placement.id } });
  if (assets > 0) return { kind: 'asset', assets, quantity: assets };

  const nomenclature = await WhNomenclature.findOne({
    where: { osvLineKey: placement.lineKey }, attributes: ['id', 'name'],
  });
  if (!nomenclature) return { kind: null, assets: 0, quantity: 0 };

  let storageId = placement.storageId;
  if (!storageId) {
    const first = await WhStorage.findOne({
      where: { roomId: placement.roomId, isActive: true },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']],
      attributes: ['id'],
    });
    storageId = first?.id || null;
  }
  if (!storageId) return { kind: null, assets: 0, quantity: 0 };

  const stock = await WhStock.findOne({
    where: { nomenclatureId: nomenclature.id, storageId, batchId: null },
    attributes: ['quantity'],
  });
  const quantity = Number(stock?.quantity || 0);
  return quantity > 0
    ? { kind: 'material', assets: 0, quantity, name: nomenclature.name }
    : { kind: null, assets: 0, quantity: 0 };
}

/** Текст отказа: он же объясняет, чем теперь оформляется изменение. */
function materializedError(done, action) {
  return done.kind === 'asset'
    ? `По этому размещению уже создано карточек: ${done.assets}. ${action}`
    : `По этому размещению уже поставлено на учёт ${done.quantity} — остаток лежит на полке. ${action}`;
}

// ── Очередь: что ещё не разложено ────────────────────────────────────────────
/**
 * Позиции с остатком нераспределённого. Это и есть рабочий список: пока он не
 * пуст, часть имущества сети существует в ведомости, но не существует в портале.
 *
 * Отдаётся страницами и с поиском, потому что список изначально длиной в три
 * тысячи строк, а человек ищет в нём то, что видит перед собой в кабинете.
 */
router.get('/queue', authenticate, requireWarehouse(), requireReport('RPT-OSV'), async (req, res) => {
  try {
    const snapshot = await currentSnapshot(req.query.importId);
    if (!snapshot) return res.json({ import: null, items: [], total: 0, totals: null });

    const { plan, totals } = await planMaterialization(snapshot.id, snapshot.account);

    const q = String(req.query.q || '').trim().toLowerCase();
    const branch = String(req.query.branch || '').trim();
    const kind = String(req.query.kind || '').trim();
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const offset = Number(req.query.offset) || 0;

    // ── Что считать «неразложенным» ────────────────────────────────────────────
    //
    // Строка, у которой кабинет задан ветке, формально размещена: разбор знает,
    // куда её везти. Но именно этот способ и признан неверным — под одной веткой
    // лежит имущество нескольких кабинетов. Поэтому режимов два:
    //
    //   unplaced (по умолчанию) — только то, что вообще никуда не приписано;
    //   all — плюс строки, которые держатся на кабинете ветки и которые надо
    //         разложить по-настоящему.
    //
    // Без второго режима экран показывал бы пустую очередь на ведомости, где
    // ветки размечены со времён ver. 6.73, — то есть ровно тогда, когда работа
    // как раз и нужна.
    const mode = req.query.mode === 'all' ? 'all' : 'unplaced';
    const placeable = item => (Number(item.line.closingQty) || 0) - item.placedQty;

    let items = plan.filter((item) => {
      if (item.kind !== 'asset' && item.kind !== 'material') return false;
      return mode === 'all' ? placeable(item) > 0.0005 : item.unplacedQty > 0.0005;
    });

    if (q) {
      items = items.filter(i => i.line.name.toLowerCase().includes(q)
        || String(i.line.pathText || '').toLowerCase().includes(q));
    }
    if (branch) items = items.filter(i => (i.line.pathText || '') === branch);
    if (kind) items = items.filter(i => i.kind === kind);

    // Дорогое — выше: если разложить успеют не всё, пусть это будет не хирургия
    // за 300 000 ₽. Сумма считается по нераспределённому остатку, а не по строке.
    items.sort((a, b) => (
      (Number(b.line.unitCost) || 0) * placeable(b) - (Number(a.line.unitCost) || 0) * placeable(a)
    ));

    const page = items.slice(offset, offset + limit).map(item => ({
      lineKey: item.line.lineKey,
      name: item.line.name,
      pathText: item.line.pathText,
      kind: item.kind,
      unit: item.unit,
      unitCost: item.line.unitCost === null ? null : Number(item.line.unitCost),
      totalQty: Number(item.line.closingQty),
      placedQty: item.placedQty,
      unplacedQty: placeable(item),
      // Кабинет, на котором строка держится сейчас через ветку. Показывается,
      // чтобы человек видел, что именно он замещает, размещая её по-настоящему.
      branchRoomId: item.placements.length ? null : item.roomId,
      placements: item.placements.map(p => ({
        id: p.id, roomId: p.roomId, storageId: p.storageId, quantity: Number(p.quantity),
      })),
    }));

    // Ветки нужны фильтром: разложить «Оргтехнику Владимирская,93» целиком в один
    // кабинет — законный и частый случай, и искать её строки поиском по названию
    // было бы издевательством.
    const branches = [...new Set(items.map(i => i.line.pathText || '')).values()]
      .filter(Boolean).sort().slice(0, 200);

    res.json({
      import: {
        id: snapshot.id, account: snapshot.account,
        periodYear: snapshot.periodYear, periodMonth: snapshot.periodMonth,
      },
      items: page,
      total: items.length,
      branches,
      totals,
    });
  } catch (err) {
    console.error('GET warehouse/placements/queue error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Что уже лежит в кабинете ─────────────────────────────────────────────────
router.get('/room/:roomId', authenticate, requireWarehouse(), requireReport('RPT-OSV'), async (req, res) => {
  try {
    const snapshot = await currentSnapshot(req.query.importId);
    if (!snapshot) return res.json({ room: null, items: [] });

    const room = await WhRoom.findByPk(req.params.roomId, { include: roomInclude });
    if (!room) return res.status(404).json({ error: 'Кабинет не найден' });

    const rows = await WhOsvPlacement.findAll({
      where: { account: snapshot.account, roomId: room.id },
      include: [
        { model: WhStorage, as: 'storage', attributes: ['id', 'name'] },
        { model: User, as: 'author', attributes: ['id', 'displayName', 'username'] },
      ],
      order: [['createdAt', 'DESC']],
    });

    // Названия берём из снимка: в размещении их нет намеренно — оно ссылается на
    // ключ строки, а название живёт в ведомости и может смениться в следующем
    // месяце вместе с ней.
    const lines = await WhOsvLine.findAll({
      where: { importId: snapshot.id, lineKey: { [Op.in]: rows.map(r => r.lineKey) } },
      attributes: ['lineKey', 'name', 'pathText', 'unitCost', 'closingQty'],
    });
    const lineByKey = new Map(lines.map(l => [l.lineKey, l.get({ plain: true })]));

    // Сколько карточек уже создано по каждому размещению: пока их нет, размещение
    // можно снять, а после — только перемещением.
    const created = await WhAsset.findAll({
      where: { osvPlacementId: { [Op.in]: rows.map(r => r.id) } },
      attributes: ['osvPlacementId'],
    });
    const createdCount = new Map();
    for (const a of created) {
      createdCount.set(a.osvPlacementId, (createdCount.get(a.osvPlacementId) || 0) + 1);
    }

    res.json({
      room: {
        id: room.id, number: room.number, name: room.name,
        department: room.department, storages: room.storages || [],
        floor: room.floor,
      },
      items: rows.map((row) => {
        const line = lineByKey.get(row.lineKey);
        return {
          id: row.id,
          lineKey: row.lineKey,
          quantity: Number(row.quantity),
          storage: row.storage,
          note: row.note,
          author: row.author,
          createdAt: row.createdAt,
          materialized: createdCount.get(row.id) || 0,
          name: line?.name || '— строка не найдена в текущем снимке —',
          pathText: line?.pathText || null,
          unitCost: line?.unitCost === undefined || line?.unitCost === null
            ? null : Number(line.unitCost),
        };
      }),
    });
  } catch (err) {
    console.error('GET warehouse/placements/room error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Положить в кабинет ───────────────────────────────────────────────────────
/**
 * Пачкой, а не по одной позиции: человек отмечает в очереди то, что видит перед
 * собой, и отправляет одним действием. Класть по одной — это ровно та работа,
 * ради избавления от которой всё и затевалось.
 *
 * Повторная постановка той же строки в тот же кабинет складывается с прежней:
 * «положил ещё два» — это не второе размещение, а увеличение существующего.
 */
router.post('/', authenticate, requireWarehouse('canImportOsv'), async (req, res) => {
  try {
    const { roomId, storageId, items, note } = req.body;
    if (!roomId) return res.status(400).json({ error: 'Не выбран кабинет' });
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'Нечего размещать' });
    }

    const snapshot = await currentSnapshot(req.body.importId);
    if (!snapshot) return res.status(400).json({ error: 'Нет принятого снимка' });

    const room = await WhRoom.findByPk(roomId);
    if (!room) return res.status(404).json({ error: 'Кабинет не найден' });

    if (storageId) {
      const storage = await WhStorage.findOne({ where: { id: storageId, roomId } });
      if (!storage) {
        return res.status(400).json({ error: 'Это место хранения не в выбранном кабинете' });
      }
    }

    // Больше, чем есть в ведомости, разложить нельзя: это не придирка, а защита
    // от опечатки в количестве — иначе портал завёл бы имущество, которого нет на
    // балансе, и расхождение всплыло бы только на сверке.
    const keys = items.map(i => i.lineKey).filter(Boolean);
    const [lines, placed] = await Promise.all([
      WhOsvLine.findAll({
        where: { importId: snapshot.id, lineKey: { [Op.in]: keys }, isGroup: false },
        attributes: ['lineKey', 'name', 'closingQty'],
      }),
      WhOsvPlacement.findAll({
        where: { account: snapshot.account, lineKey: { [Op.in]: keys } },
      }),
    ]);
    const lineByKey = new Map(lines.map(l => [l.lineKey, l]));
    const placedByKey = new Map();
    for (const p of placed) {
      placedByKey.set(p.lineKey, (placedByKey.get(p.lineKey) || 0) + Number(p.quantity));
    }
    const hereByKey = new Map(
      placed.filter(p => p.roomId === roomId).map(p => [p.lineKey, p]),
    );

    const saved = [];
    const rejected = [];

    await sequelize.transaction(async (t) => {
      for (const item of items) {
        const line = lineByKey.get(item.lineKey);
        if (!line) {
          rejected.push({ lineKey: item.lineKey, reason: 'Строки нет в текущем снимке' });
          continue;
        }

        const total = Number(line.closingQty) || 0;
        const already = placedByKey.get(item.lineKey) || 0;
        const free = total - already;
        // Пустое количество означает «всё, что осталось»: в девяти случаях из
        // десяти позиция целиком лежит там, где на неё смотрят.
        const want = item.quantity === undefined || item.quantity === null || item.quantity === ''
          ? free : Number(item.quantity);

        if (!(want > 0)) {
          rejected.push({ lineKey: item.lineKey, name: line.name, reason: 'Количество должно быть больше нуля' });
          continue;
        }
        if (want - free > 0.0005) {
          rejected.push({
            lineKey: item.lineKey,
            name: line.name,
            reason: `В ведомости осталось нераспределённого ${free}, запрошено ${want}`,
          });
          continue;
        }

        const existing = hereByKey.get(item.lineKey);
        if (existing) {
          await existing.update({
            quantity: Number(existing.quantity) + want,
            storageId: storageId || existing.storageId,
            note: note || existing.note,
            placedBy: req.user.id,
          }, { transaction: t });
          saved.push({ lineKey: item.lineKey, quantity: Number(existing.quantity) });
        } else {
          const created = await WhOsvPlacement.create({
            account: snapshot.account,
            lineKey: item.lineKey,
            roomId,
            storageId: storageId || null,
            quantity: want,
            note: note || null,
            placedBy: req.user.id,
          }, { transaction: t });
          hereByKey.set(item.lineKey, created);
          saved.push({ lineKey: item.lineKey, quantity: want });
        }
        placedByKey.set(item.lineKey, already + want);
      }
    });

    /**
     * Разбор разложенного — сразу и только по этому кабинету.
     *
     * Без него размещение не размещало ничего: оно фиксировало за кабинетом
     * намерение, а карточки и остатки появлялись лишь после общего прогона из
     * веба. Человек обходил этаж с телефоном, а баланс кабинета оставался
     * нулевым, пока кто-то не сядет за компьютер, — то есть мобильная раскладка
     * была работой, которую всё равно приходилось завершать за столом.
     *
     * Прав на это не нужно добавлять: и размещение, и разбор просят один и тот
     * же canImportOsv. Прогон идемпотентен и сужен до одного кабинета, поэтому
     * чужой ведомости он не касается и повтор ничего не задваивает.
     *
     * Флагом, а не всегда: экран разбора в вебе — это проверка решений словаря
     * по всей ведомости целиком, и тому, кто раскладывает за столом, полезно
     * сперва посмотреть на неё, а не получить карточки по факту раскладки.
     * Телефон флаг шлёт всегда: смотреть там не на что и некогда.
     *
     * Ошибка разбора не отменяет размещение: оно уже сохранено и верно само по
     * себе. Поэтому не 500, а поле problems в ответе.
     */
    let materialized = null;
    if (req.body?.materialize && saved.length) {
      try {
        materialized = await materializeOsv({
          importId: snapshot.id,
          account: snapshot.account,
          user: req.user,
          roomIds: [room.id],
        });
      } catch (err) {
        console.error('POST warehouse/placements materialize error:', err);
        materialized = { failed: err.message };
      }
    }

    res.status(201).json({
      saved: saved.length,
      rejected,
      room: { id: room.id, number: room.number },
      materialized: materialized && !materialized.failed ? {
        assetsCreated: materialized.assetsCreated,
        stockReceipts: materialized.stockReceipts,
        alreadyDone: materialized.alreadyDone,
        problems: materialized.problems,
      } : materialized,
    });
  } catch (err) {
    console.error('POST warehouse/placements error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Отмена размещения по кабинету — временный инструмент отладки (ver. 7.24).
 *
 * Только администратору и намеренно без права из каталога складских: это не
 * штатная операция учёта, которую кому-то выдают, а лопата для разгребания
 * следов, оставленных проверкой мобильных экранов на боевой базе. Подробности и
 * условие, при котором это надо убрать, — в services/warehouse/osvRollback.js.
 */
router.post('/room/:roomId/rollback', authenticate, requireWarehouse(), async (req, res) => {
  try {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Только для администратора' });

    const snapshot = await currentSnapshot(req.body?.importId);
    if (!snapshot) return res.status(400).json({ error: 'Нет принятого снимка' });

    const room = await WhRoom.findByPk(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Кабинет не найден' });

    const report = await rollbackRoomPlacement({ roomId: room.id, account: snapshot.account });
    res.json({ ...report, room: { id: room.id, number: room.number } });
  } catch (err) {
    console.error('POST warehouse/placements/rollback error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Поправить количество ─────────────────────────────────────────────────────
router.patch('/:id', authenticate, requireWarehouse('canImportOsv'), async (req, res) => {
  try {
    const row = await WhOsvPlacement.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Размещение не найдено' });

    const done = await materializedBy(row);
    if (done.kind) {
      return res.status(409).json({
        error: materializedError(done, 'Количество меняется списанием или перемещением, а не правкой разбора.'),
      });
    }

    const { quantity, storageId, note } = req.body;
    if (quantity !== undefined) {
      const want = Number(quantity);
      if (!Number.isFinite(want) || want <= 0) {
        return res.status(400).json({ error: 'Количество должно быть больше нуля' });
      }

      // Снимок берём тот, к чьему счёту привязано размещение, а не «текущий
      // применённый»: у размещения по другому счёту строка нашлась бы не та.
      const snapshot = await WhOsvImport.findOne({
        where: { status: 'applied', account: row.account },
        order: [['periodYear', 'DESC'], ['periodMonth', 'DESC']],
      });
      const line = snapshot && await WhOsvLine.findOne({
        where: { importId: snapshot.id, lineKey: row.lineKey, isGroup: false },
        attributes: ['closingQty'],
      });
      // Не нашлась строка — значит сверить количество не с чем, и принимать
      // любое число нельзя: раньше вся проверка в этом случае просто
      // пропускалась, и правкой можно было разложить сколько угодно.
      if (!line) {
        return res.status(409).json({
          error: 'Строки нет в принятом снимке этого счёта — количество не с чем сверить',
        });
      }
      const others = await WhOsvPlacement.sum('quantity', {
        where: { account: row.account, lineKey: row.lineKey, id: { [Op.ne]: row.id } },
      }) || 0;
      const free = (Number(line.closingQty) || 0) - Number(others);
      if (want - free > 0.0005) {
        return res.status(400).json({ error: `В ведомости осталось нераспределённого ${free}` });
      }
    }

    await row.update({
      ...(quantity === undefined ? {} : { quantity: Number(quantity) }),
      ...(storageId === undefined ? {} : { storageId: storageId || null }),
      ...(note === undefined ? {} : { note: note || null }),
      placedBy: req.user.id,
    });
    res.json(row);
  } catch (err) {
    console.error('PATCH warehouse/placements error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Снять размещение ─────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireWarehouse('canImportOsv'), async (req, res) => {
  try {
    const row = await WhOsvPlacement.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Размещение не найдено' });

    const done = await materializedBy(row);
    if (done.kind) {
      return res.status(409).json({
        error: materializedError(done, done.kind === 'asset'
          ? 'Снять его нельзя — иначе следующий разбор выдал бы тем же вещам вторые '
            + 'инвентарные номера. Переезд оформляется документом перемещения.'
          : 'Снять его нельзя — остаток остался бы на полке, а строка вернулась бы в '
            + 'очередь, и следующий разбор положил бы то же количество ещё раз. '
            + 'Переезд оформляется документом перемещения.'),
      });
    }

    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE warehouse/placements error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
