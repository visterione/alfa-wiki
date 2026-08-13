const { ExecutorSettings, RbResetBackup, User, sequelize } = require('../models');

// Пять снимков — сознательный потолок. Payload хранит settings целиком, то есть
// зарплатные данные всех затронутых сотрудников, и бессрочная история быстро
// превратилась бы в склад персональных данных, которые уже никто не откатит.
// Месячного зарплатного цикла на то, чтобы заметить ошибочный сброс, хватает.
const MAX_BACKUPS = 5;

// Снимок должен быть значением, а не ссылкой на тот же объект, который сейчас
// начнёт переписывать сброс. Глубокая копия здесь дешевле любых рассуждений о том,
// какие уровни вложенности resetClinicData() копирует, а какие переиспользует.
const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));

/**
 * Снять состояние строк executor_settings до того, как их перепишут.
 * Возвращает payload вида { [misUserId]: { doctorName, settings, updatedAt } };
 * updatedAt заполняется отдельно — уже после записи, функцией stampWritten().
 */
function snapshotRecords(records) {
  const payload = {};
  for (const record of records) {
    payload[String(record.misUserId)] = {
      doctorName: record.doctorName || '',
      settings:   clone(record.settings),
      updatedAt:  null,
    };
  }
  return payload;
}

/**
 * Проставить в снимок отметку времени строки уже ПОСЛЕ записи. По ней потом видно,
 * правил ли кто-то сотрудника после сброса: если updatedAt в базе разошёлся с
 * сохранённым, поверх сброса легла чужая работа, и откат её перезапишет.
 */
function stampWritten(payload, records) {
  for (const record of records) {
    const entry = payload[String(record.misUserId)];
    if (entry) entry.updatedAt = record.updatedAt ? new Date(record.updatedAt).toISOString() : null;
  }
  return payload;
}

// Лишние снимки отсекаются в той же транзакции, что и создание нового: иначе при
// сбое между вставкой и чисткой таблица растёт молча.
async function pruneBackups(transaction) {
  await sequelize.query(
    `DELETE FROM rb_reset_backups
      WHERE id NOT IN (
        SELECT id FROM rb_reset_backups ORDER BY created_at DESC LIMIT :limit
      )`,
    { replacements: { limit: MAX_BACKUPS }, transaction }
  );
}

async function createBackup({ kind, userId, clinicIds, employeeCount, changeCount, payload }, transaction) {
  const backup = await RbResetBackup.create({
    kind,
    userId:        userId || null,
    clinicIds:     clinicIds || [],
    employeeCount: employeeCount || 0,
    changeCount:   changeCount || 0,
    payload:       payload || {},
  }, { transaction });

  await pruneBackups(transaction);
  return backup;
}

const entryUpdatedAt = (value) => (value ? new Date(value).getTime() : null);

/**
 * Описание снимка для интерфейса. Содержимое payload наружу не отдаётся никогда:
 * там лежит settings целиком, включая блок клиники АУП, скрытой от всех без флага.
 * Клиенту уходят только ФИО, счётчики и признак «правили после сброса».
 */
async function describeBackup(backup) {
  const entries = Object.entries(backup.payload || {});
  const records = await ExecutorSettings.findAll({
    where: { misUserId: entries.map(([misUserId]) => misUserId) },
    attributes: ['misUserId', 'updatedAt'],
  });
  const updatedAtById = new Map(records.map(r => [String(r.misUserId), new Date(r.updatedAt).getTime()]));

  const employees = entries.map(([misUserId, entry]) => {
    const current = updatedAtById.get(misUserId);
    const stamped = entryUpdatedAt(entry.updatedAt);
    return {
      misUserId,
      doctorName: entry.doctorName || misUserId,
      missing:      current == null,
      changedSince: current != null && stamped != null && current !== stamped,
    };
  }).sort((a, b) => a.doctorName.localeCompare(b.doctorName, 'ru'));

  return {
    id:            backup.id,
    kind:          backup.kind,
    clinicIds:     backup.clinicIds || [],
    employeeCount: backup.employeeCount,
    changeCount:   backup.changeCount,
    createdAt:     backup.createdAt,
    restoredAt:    backup.restoredAt,
    employees,
  };
}

/**
 * Вернуть settings из снимка как есть. Откат — это откат: сотрудники из снимка
 * возвращаются в состояние на момент съёмки целиком, включая правки, сделанные
 * после сброса. Тех, кого сброс не касался, в снимке нет, и их никто не трогает.
 */
async function restoreBackup({ backup, userId }) {
  const entries = Object.entries(backup.payload || {});

  return sequelize.transaction(async (transaction) => {
    const records = await ExecutorSettings.findAll({
      where: { misUserId: entries.map(([misUserId]) => misUserId) },
      transaction,
    });
    const byMisUserId = new Map(records.map(record => [String(record.misUserId), record]));

    // Откат сам по себе перезаписывает данные, поэтому перед ним снимается такой же
    // снимок: ошибочный откат должен откатываться так же, как ошибочный сброс.
    const safetyPayload = snapshotRecords(records);

    const missing = [];
    const changedSince = [];
    let restored = 0;

    for (const [misUserId, entry] of entries) {
      const record = byMisUserId.get(misUserId);
      if (!record) {
        missing.push(entry.doctorName || misUserId);
        continue;
      }

      const stamped = entryUpdatedAt(entry.updatedAt);
      if (stamped != null && new Date(record.updatedAt).getTime() !== stamped) {
        changedSince.push(entry.doctorName || misUserId);
      }

      await record.update({ settings: entry.settings || {}, updatedBy: userId }, { transaction });
      restored += 1;
    }

    await createBackup({
      kind:          'restore',
      userId,
      clinicIds:     backup.clinicIds || [],
      employeeCount: records.length,
      changeCount:   0,
      payload:       stampWritten(safetyPayload, records),
    }, transaction);

    await backup.update({ restoredAt: new Date(), restoredBy: userId }, { transaction });

    return { restored, missing, changedSince };
  });
}

/** Список снимков для панели: без payload, с именами тех, кто сбросил и откатил. */
async function listBackups() {
  const backups = await RbResetBackup.findAll({
    attributes: { exclude: ['payload'] },
    include: [
      { model: User, as: 'author',   attributes: ['id', 'displayName', 'username'], required: false },
      { model: User, as: 'restorer', attributes: ['id', 'displayName', 'username'], required: false },
    ],
    order: [['createdAt', 'DESC']],
    limit: MAX_BACKUPS,
  });

  const userLabel = (user) => (user ? (user.displayName || user.username) : null);

  return backups.map(backup => ({
    id:            backup.id,
    kind:          backup.kind,
    clinicIds:     backup.clinicIds || [],
    employeeCount: backup.employeeCount,
    changeCount:   backup.changeCount,
    createdAt:     backup.createdAt,
    createdBy:     userLabel(backup.author),
    restoredAt:    backup.restoredAt,
    restoredBy:    userLabel(backup.restorer),
  }));
}

module.exports = {
  MAX_BACKUPS,
  snapshotRecords,
  stampWritten,
  createBackup,
  describeBackup,
  restoreBackup,
  listBackups,
};
