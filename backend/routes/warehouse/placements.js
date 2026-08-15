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
 * Как только по размещению созданы карточки, оно перестаёт быть намерением и
 * становится фактом: у карточек есть инвентарные номера, они напечатаны на
 * этикетках и попали в движения. Удалить размещение значило бы оставить карточки
 * без источника, а следующий разбор создал бы их заново — вторые номера на те же
 * вещи. Переезд после разбора оформляется документом перемещения, как и любой
 * другой переезд.
 */

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

const {
  sequelize, WhOsvPlacement, WhOsvImport, WhOsvLine, WhAsset, WhRoom, WhStorage,
  WhFloor, WhBuilding, WhDepartment, User,
} = require('../../models');
const { authenticate } = require('../../middleware/auth');
const { requireWarehouse, requireReport } = require('../../services/warehouse/access');
const { planMaterialization } = require('../../services/warehouse/osvMaterialize');

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

    res.status(201).json({ saved: saved.length, rejected, room: { id: room.id, number: room.number } });
  } catch (err) {
    console.error('POST warehouse/placements error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Поправить количество ─────────────────────────────────────────────────────
router.patch('/:id', authenticate, requireWarehouse('canImportOsv'), async (req, res) => {
  try {
    const row = await WhOsvPlacement.findByPk(req.params.id);
    if (!row) return res.status(404).json({ error: 'Размещение не найдено' });

    const materialized = await WhAsset.count({ where: { osvPlacementId: row.id } });
    if (materialized > 0) {
      return res.status(409).json({
        error: `По этому размещению уже создано карточек: ${materialized}. `
          + 'Количество меняется списанием или перемещением, а не правкой разбора.',
      });
    }

    const { quantity, storageId, note } = req.body;
    if (quantity !== undefined) {
      const want = Number(quantity);
      if (!(want > 0)) return res.status(400).json({ error: 'Количество должно быть больше нуля' });

      const snapshot = await currentSnapshot();
      const line = snapshot && await WhOsvLine.findOne({
        where: { importId: snapshot.id, lineKey: row.lineKey, isGroup: false },
        attributes: ['closingQty'],
      });
      if (line) {
        const others = await WhOsvPlacement.sum('quantity', {
          where: { account: row.account, lineKey: row.lineKey, id: { [Op.ne]: row.id } },
        }) || 0;
        const free = (Number(line.closingQty) || 0) - Number(others);
        if (want - free > 0.0005) {
          return res.status(400).json({ error: `В ведомости осталось нераспределённого ${free}` });
        }
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

    const materialized = await WhAsset.count({ where: { osvPlacementId: row.id } });
    if (materialized > 0) {
      return res.status(409).json({
        error: `По этому размещению уже создано карточек: ${materialized}. `
          + 'Снять его нельзя — иначе следующий разбор выдал бы тем же вещам вторые '
          + 'инвентарные номера. Переезд оформляется документом перемещения.',
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
