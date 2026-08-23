/**
 * Отмена размещения по кабинету — временный инструмент отладки.
 *
 * ── Зачем это есть ───────────────────────────────────────────────────────────
 *
 * Модуль дорабатывается прямо на боевой базе, и проверка мобильных экранов
 * неизбежно оставляет след: чтобы посмотреть, как печатается этикетка, надо
 * разложить что-нибудь по кабинету, а разложенное тут же превращается в
 * карточки, остатки и движения. Через неделю такой отладки учёт наполняется
 * имуществом, которого нет, и отличить его от настоящего уже нельзя.
 *
 * ── Почему удаление, а не сторнирующая операция ──────────────────────────────
 *
 * По правилам модуля любое изменение места — это документ, и след в журнале
 * обязателен: на нём держится аудит. Здесь всё наоборот, и намеренно. Отменяется
 * не хозяйственная операция, а ошибка ввода, которой не было в жизни. Оставить
 * от неё пару движений «приняли — списали» значит закрепить в истории то, чего
 * не происходило, и отчёт о движении активов будет показывать возню с приборами,
 * которых никогда не существовало. Поэтому откат стирает след целиком, а строка
 * ведомости возвращается в очередь размещения — ровно в то состояние, в котором
 * была до ошибки.
 *
 * Отсюда же и ограничения: инструмент только для администратора и только для
 * того, что создано разбором ведомости и с тех пор не трогалось. Всё, к чему
 * успели приложить руку, откат не берёт и называет вслух.
 *
 * ── Когда это надо убрать ────────────────────────────────────────────────────
 *
 * Когда модуль перестанут отлаживать на бою. Инструмент, стирающий движения,
 * не должен пережить отладку, ради которой заведён.
 */
const { Op } = require('sequelize');

const {
  sequelize, WhOsvPlacement, WhAsset, WhMovement, WhDocument,
  WhNomenclature, WhStock, WhStorage,
} = require('../../models');

/** Движения, поставленные разбором ведомости. Всё прочее — чужая работа. */
const OSV_REASON = 'osv_import';

/**
 * @param {string} roomId  кабинет, размещение по которому отменяется
 * @param {string} account счёт снимка (МЦ.04)
 */
async function rollbackRoomPlacement({ roomId, account }) {
  const report = {
    placements: 0, assets: 0, stockRows: 0, movements: 0,
    documents: 0, nomenclature: 0,
    // То, что откат не взял, и почему. Молчать нельзя: человек уйдёт с экрана,
    // считая кабинет чистым.
    kept: [],
  };

  const placements = await WhOsvPlacement.findAll({ where: { account, roomId } });
  if (!placements.length) return report;

  const placementIds = placements.map(p => p.id);
  const lineKeys = [...new Set(placements.map(p => p.lineKey))];
  const touchedDocuments = new Set();
  // Строки, за которыми осталось живое имущество: их размещение снимать нельзя
  const keptKeys = new Set();

  await sequelize.transaction(async (t) => {
    // ── Оборудование ─────────────────────────────────────────────────────────
    const assets = await WhAsset.findAll({
      where: { osvPlacementId: { [Op.in]: placementIds } },
      transaction: t,
    });

    for (const asset of assets) {
      const movements = await WhMovement.findAll({
        where: { assetId: asset.id },
        transaction: t,
      });
      // Карточку, с которой уже что-то делали — перемещали, чинили, списывали, —
      // откат не трогает: это уже не след отладки, а настоящая работа поверх неё.
      const foreign = movements.filter(m => m.reasonCode !== OSV_REASON);
      if (foreign.length) {
        report.kept.push({
          kind: 'asset',
          name: `${asset.inventoryNumber} · ${asset.name}`,
          reason: 'по карточке уже проводились операции',
        });
        continue;
      }

      for (const movement of movements) {
        if (movement.documentId) touchedDocuments.add(movement.documentId);
      }
      await WhMovement.destroy({ where: { assetId: asset.id }, transaction: t });
      await asset.destroy({ transaction: t });
      report.assets += 1;
      report.movements += movements.length;
    }

    // ── Материалы ────────────────────────────────────────────────────────────
    //
    // Остаток не помнит, из какого размещения он сложился: warehouse_stock
    // хранит пару «номенклатура + место хранения», и два прихода в одну ячейку
    // там неразличимы. Поэтому отматываем по движениям — они помнят и повод, и
    // количество.
    const storages = await WhStorage.findAll({
      where: { roomId }, attributes: ['id'], transaction: t,
    });
    const storageIds = storages.map(s => s.id);
    const nomenclature = lineKeys.length
      ? await WhNomenclature.findAll({
        where: { osvLineKey: { [Op.in]: lineKeys } }, transaction: t,
      })
      : [];

    if (storageIds.length && nomenclature.length) {
      const nomIds = nomenclature.map(n => n.id);
      const receipts = await WhMovement.findAll({
        where: {
          nomenclatureId: { [Op.in]: nomIds },
          toStorageId: { [Op.in]: storageIds },
          reasonCode: OSV_REASON,
        },
        transaction: t,
      });

      for (const movement of receipts) {
        const stock = await WhStock.findOne({
          where: {
            nomenclatureId: movement.nomenclatureId,
            storageId: movement.toStorageId,
            batchId: movement.batchId || null,
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        // Остатка меньше, чем принесло движение, — значит его уже расходовали.
        // Уводить в минус нельзя: это была бы не отмена ошибки, а новая ошибка.
        const have = Number(stock?.quantity) || 0;
        const back = Number(movement.quantity) || 0;
        if (have + 0.0005 < back) {
          const nom = nomenclature.find(n => n.id === movement.nomenclatureId);
          if (nom?.osvLineKey) keptKeys.add(nom.osvLineKey);
          report.kept.push({
            kind: 'material',
            name: nom?.name || 'позиция',
            reason: `на остатке ${have}, приходом заведено ${back} — часть уже израсходована`,
          });
          continue;
        }

        const left = have - back;
        if (left <= 0.0005) {
          await stock.destroy({ transaction: t });
          report.stockRows += 1;
        } else {
          await stock.update({ quantity: left }, { transaction: t });
        }

        if (movement.documentId) touchedDocuments.add(movement.documentId);
        await movement.destroy({ transaction: t });
        report.movements += 1;
      }

      // Номенклатура, заведённая разбором и больше нигде не участвующая, уходит
      // вместе со следом: иначе в справочнике остаётся позиция-призрак, которую
      // потом никто не решится удалить.
      for (const nom of nomenclature) {
        const [stockLeft, movementsLeft] = await Promise.all([
          WhStock.count({ where: { nomenclatureId: nom.id }, transaction: t }),
          WhMovement.count({ where: { nomenclatureId: nom.id }, transaction: t }),
        ]);
        if (stockLeft || movementsLeft) continue;
        await nom.destroy({ transaction: t });
        report.nomenclature += 1;
      }
    }

    // ── Документы без строк ──────────────────────────────────────────────────
    //
    // Приходный документ разбора один на весь прогон и может охватывать
    // несколько кабинетов. Удаляем только тот, у которого после отката не
    // осталось ни одного движения: документ с частью строк — это по-прежнему
    // правдивый документ.
    for (const documentId of touchedDocuments) {
      const left = await WhMovement.count({ where: { documentId }, transaction: t });
      if (left) continue;
      await WhDocument.destroy({ where: { id: documentId }, transaction: t });
      report.documents += 1;
    }

    // ── Сами размещения ──────────────────────────────────────────────────────
    //
    // Снимаем только те, чьё имущество удалось убрать: размещение, за которым
    // осталась живая карточка, снимать нельзя — строка вернулась бы в очередь и
    // была бы разложена второй раз, а в портале оказалось бы вдвое больше, чем в
    // ведомости.
    const stuckPlacements = new Set(
      (await WhAsset.findAll({
        where: { osvPlacementId: { [Op.in]: placementIds } },
        attributes: ['osvPlacementId'],
        transaction: t,
      })).map(a => a.osvPlacementId),
    );

    for (const placement of placements) {
      if (stuckPlacements.has(placement.id)) continue;
      if (keptKeys.has(placement.lineKey)) continue;
      await placement.destroy({ transaction: t });
      report.placements += 1;
    }
  });

  return report;
}

module.exports = { rollbackRoomPlacement };
