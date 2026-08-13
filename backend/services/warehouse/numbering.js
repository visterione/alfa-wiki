/**
 * Нумерация складского модуля: инвентарные номера активов и номера документов.
 *
 * Обе функции обязаны вызываться внутри транзакции. Причина — гонка: два
 * одновременных сохранения по max(number)+1 дадут один и тот же номер, а
 * инвентарный номер уникален и печатается на этикетке. Блокировка берётся
 * через pg_advisory_xact_lock и снимается вместе с транзакцией — забыть
 * освободить её невозможно.
 */

const { sequelize } = require('../../models');

// Префикс организации из ТЗ (Приложение А), 1–8 символов. Настраиваемый: у сети
// он «МЦ», но у отдельного юрлица может быть свой.
const DEFAULT_INVENTORY_PREFIX = process.env.WAREHOUSE_INVENTORY_PREFIX || 'МЦ';

// Префиксы документов. Русские буквы намеренно: номер читают вслух по телефону
// («перемещение сто сорок восемь»), и латиница здесь только мешала бы.
const DOC_PREFIXES = {
  receipt:    'ПРХ',
  return:     'ВЗВ',
  issue:      'ВЫД',
  transfer:   'ПЕР',
  repair_out: 'РЕМ',
  repair_in:  'ВЗР',
  writeoff:   'СПС',
  inventory:  'ИНВ',
  surplus:    'ОПР',
};

const MAINTENANCE_PREFIX = 'ТО';
const REPAIR_PREFIX      = 'РМТ';
const RFQ_PREFIX         = 'RFQ';

/**
 * Инвентарный номер по маске [ПРЕФИКС]-[ГОД]-[КОД_СПЕЦИАЛЬНОСТИ]-[ПОРЯДКОВЫЙ_№].
 * Счётчик независим для каждой тройки, номер не переиспользуется даже после
 * списания — иначе рушится история актива.
 */
async function generateInventoryNumber({ specialtyCode, year, prefix, transaction }) {
  if (!transaction) throw new Error('generateInventoryNumber требует транзакцию');

  const code = (specialtyCode || 'АХО').toUpperCase();
  const y    = year || new Date().getFullYear();
  const pfx  = prefix || DEFAULT_INVENTORY_PREFIX;
  const key  = `wh:inv:${pfx}:${y}:${code}`;

  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
    replacements: { key },
    transaction,
  });

  const [rows] = await sequelize.query(`
    INSERT INTO warehouse_inventory_counters (prefix, year, "specialtyCode", "lastValue")
    VALUES (:pfx, :y, :code, 1)
    ON CONFLICT (prefix, year, "specialtyCode")
    DO UPDATE SET "lastValue" = warehouse_inventory_counters."lastValue" + 1
    RETURNING "lastValue"
  `, { replacements: { pfx, y, code }, transaction });

  const seq = rows[0].lastValue;
  return `${pfx}-${y}-${code}-${String(seq).padStart(5, '0')}`;
}

/**
 * Номер документа: ПЕР-2026-000148. Сквозной внутри года и типа.
 */
async function generateDocumentNumber({ type, year, transaction }) {
  const prefix = DOC_PREFIXES[type];
  if (!prefix) throw new Error(`Неизвестный тип документа: ${type}`);
  return nextNumber({ prefix, year, transaction, width: 6 });
}

async function generateMaintenanceNumber({ year, transaction }) {
  return nextNumber({ prefix: MAINTENANCE_PREFIX, year, transaction, width: 6 });
}

async function generateRepairNumber({ year, transaction }) {
  return nextNumber({ prefix: REPAIR_PREFIX, year, transaction, width: 6 });
}

async function generateRfqNumber({ year, transaction }) {
  return nextNumber({ prefix: RFQ_PREFIX, year, transaction, width: 6 });
}

async function nextNumber({ prefix, year, transaction, width = 6 }) {
  if (!transaction) throw new Error('nextNumber требует транзакцию');
  const y   = year || new Date().getFullYear();
  const key = `wh:doc:${prefix}:${y}`;

  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
    replacements: { key },
    transaction,
  });

  const [rows] = await sequelize.query(`
    INSERT INTO warehouse_doc_counters (prefix, year, "lastValue")
    VALUES (:prefix, :y, 1)
    ON CONFLICT (prefix, year)
    DO UPDATE SET "lastValue" = warehouse_doc_counters."lastValue" + 1
    RETURNING "lastValue"
  `, { replacements: { prefix, y }, transaction });

  return `${prefix}-${y}-${String(rows[0].lastValue).padStart(width, '0')}`;
}

module.exports = {
  DOC_PREFIXES,
  DEFAULT_INVENTORY_PREFIX,
  generateInventoryNumber,
  generateDocumentNumber,
  generateMaintenanceNumber,
  generateRepairNumber,
  generateRfqNumber,
};
