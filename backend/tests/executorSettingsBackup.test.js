const test = require('node:test');
const assert = require('node:assert/strict');

const models = require('../models');
const { resetSettings, buildResetPreview } = require('../services/executorSettingsReset');
const {
  snapshotRecords, stampWritten, createBackup, describeBackup, restoreBackup,
} = require('../services/executorSettingsBackup');

/**
 * Сквозной тест точки возврата без внешней PostgreSQL: подменён только слой
 * персистентности Sequelize, а снимок, сброс и откат выполняет настоящий
 * production-код. Проверяется главное обещание функции — после отката данные
 * совпадают с состоянием до сброса побайтово, а не «примерно».
 */
function backupHarness(initial) {
  const originals = [];
  const replace = (object, key, value) => {
    originals.push([object, key, object[key]]);
    object[key] = value;
  };

  // Время идёт дискретно: updatedAt строки — единственный признак, по которому
  // откат отличает нетронутого сотрудника от поправленного после сброса.
  let clock = Date.parse('2026-08-12T09:00:00.000Z');
  const tick = () => new Date((clock += 1000));

  const rows = initial.map(row => ({
    misUserId:  row.misUserId,
    doctorName: row.doctorName,
    settings:   row.settings,
    updatedAt:  tick(),
    updatedBy:  null,
    async update(values) {
      Object.assign(this, values);
      this.updatedAt = tick();
      return this;
    },
  }));

  const backups = [];

  replace(models.ExecutorSettings, 'findAll', async (options = {}) => {
    const filter = options.where && options.where.misUserId;
    if (!filter) return rows;
    const wanted = new Set((Array.isArray(filter) ? filter : [filter]).map(String));
    return rows.filter(row => wanted.has(String(row.misUserId)));
  });

  replace(models.RbResetBackup, 'create', async (values) => {
    const backup = {
      ...values,
      id: `backup-${backups.length + 1}`,
      createdAt: tick(),
      async update(patch) { Object.assign(this, patch); return this; },
    };
    backups.push(backup);
    return backup;
  });

  replace(models.sequelize, 'transaction', async (runner) => runner({ fake: true }));
  replace(models.sequelize, 'query', async () => []);

  return {
    rows,
    backups,
    row: (misUserId) => rows.find(r => String(r.misUserId) === String(misUserId)),
    cleanup: () => originals.forEach(([object, key, value]) => { object[key] = value; }),
  };
}

const employee = (misUserId, doctorName, clinicSettings) => ({
  misUserId,
  doctorName,
  settings: { clinicSettings },
});

function sampleData() {
  return [
    employee('101', 'Иванов И.И.', {
      2: {
        payType: 'percent',
        deductions: [
          { name: 'Халат', amount: 1200 },
          { name: 'Обучение', amount: 3000, locked: true },
        ],
        advance: 5000,
        mainPayment: 40000,
        lockedMainPayment: true,
      },
      4: { deductions: [{ name: 'Инвентарь', amount: 800 }] },
    }),
    employee('202', 'Петрова А.А.', {
      2: { deductions: [{ name: 'Форма', amount: 500, locked: true }] },
    }),
  ];
}

/** Повторяет то, что делает маршрут reset-all, но без express и без базы. */
async function performReset(harness, clinicIds, userId = 'user-1') {
  const all = await models.ExecutorSettings.findAll();
  const preview = buildResetPreview(all, clinicIds);
  const affectedIds = new Set(preview.employees.map(e => e.misUserId));
  const affected = all.filter(record => affectedIds.has(String(record.misUserId)));

  const payload = snapshotRecords(affected);
  for (const record of affected) {
    await record.update({ settings: resetSettings(record.settings, new Set(clinicIds)) });
  }

  const backup = await createBackup({
    kind: 'reset',
    userId,
    clinicIds,
    employeeCount: preview.employeeCount,
    changeCount:   preview.changeCount,
    payload:       stampWritten(payload, affected),
  }, { fake: true });

  return { preview, backup };
}

test('откат возвращает данные ровно в состояние до сброса', async () => {
  const harness = backupHarness(sampleData());
  try {
    const before = JSON.parse(JSON.stringify(harness.row('101').settings));

    const { backup } = await performReset(harness, ['2']);

    // Сброс сработал: незафиксированное удержание и аванс ушли, залоченное осталось.
    const afterReset = harness.row('101').settings.clinicSettings[2];
    assert.deepEqual(afterReset.deductions, [{ name: 'Обучение', amount: 3000, locked: true }]);
    assert.equal(afterReset.advance, 0);
    assert.equal(afterReset.mainPayment, 40000, 'зафиксированная выплата сбросу не подлежит');

    await restoreBackup({ backup, userId: 'user-2' });

    assert.deepEqual(harness.row('101').settings, before);
  } finally {
    harness.cleanup();
  }
});

test('снимок не трогает сотрудников, которых сброс не касался', async () => {
  const harness = backupHarness(sampleData());
  try {
    const untouched = JSON.parse(JSON.stringify(harness.row('202').settings));

    const { backup } = await performReset(harness, ['2']);
    assert.deepEqual(Object.keys(backup.payload), ['101'], 'в снимке только затронутый сотрудник');

    await restoreBackup({ backup, userId: 'user-2' });
    assert.deepEqual(harness.row('202').settings, untouched);
  } finally {
    harness.cleanup();
  }
});

test('откат восстанавливает и те клиники, которые в сбросе не участвовали', async () => {
  const harness = backupHarness(sampleData());
  try {
    const { backup } = await performReset(harness, ['2']);

    // Правка после сброса в клинике 4 — сброс её не выбирал, но снимок хранит
    // settings целиком, и откат по договорённости возвращает состояние на момент
    // копии, а не выборочно «только сброшенное».
    const record = harness.row('101');
    await record.update({
      settings: {
        ...record.settings,
        clinicSettings: { ...record.settings.clinicSettings, 4: { deductions: [] } },
      },
    });

    const result = await restoreBackup({ backup, userId: 'user-2' });

    assert.deepEqual(harness.row('101').settings.clinicSettings[4], {
      deductions: [{ name: 'Инвентарь', amount: 800 }],
    });
    assert.deepEqual(result.changedSince, ['Иванов И.И.'], 'правка после сброса помечена');
  } finally {
    harness.cleanup();
  }
});

test('откат сам создаёт точку возврата и помечает исходную копию', async () => {
  const harness = backupHarness(sampleData());
  try {
    const { backup } = await performReset(harness, ['2']);
    const afterReset = JSON.parse(JSON.stringify(harness.row('101').settings));

    await restoreBackup({ backup, userId: 'user-2' });
    assert.ok(backup.restoredAt, 'исходная копия помечена восстановленной');
    assert.equal(backup.restoredBy, 'user-2');

    const safety = harness.backups[harness.backups.length - 1];
    assert.equal(safety.kind, 'restore');

    // Ошибочный откат откатывается так же, как ошибочный сброс.
    await restoreBackup({ backup: safety, userId: 'user-3' });
    assert.deepEqual(harness.row('101').settings, afterReset);
  } finally {
    harness.cleanup();
  }
});

test('удалённый сотрудник не срывает откат остальных', async () => {
  const harness = backupHarness(sampleData());
  try {
    const { backup } = await performReset(harness, ['2', '4']);

    // Строку удалили из базы между сбросом и откатом.
    harness.rows.splice(harness.rows.findIndex(r => r.misUserId === '101'), 1);

    const result = await restoreBackup({ backup, userId: 'user-2' });
    assert.deepEqual(result.missing, ['Иванов И.И.']);
    assert.equal(result.restored, 0);
  } finally {
    harness.cleanup();
  }
});

test('описание снимка не отдаёт наружу сами настройки', async () => {
  const harness = backupHarness(sampleData());
  try {
    const { backup } = await performReset(harness, ['2']);
    const described = await describeBackup(backup);

    assert.deepEqual(described.employees.map(e => e.doctorName), ['Иванов И.И.']);
    assert.equal(described.employees[0].changedSince, false);
    assert.equal(JSON.stringify(described).includes('Обучение'), false, 'settings в ответ не попадают');
  } finally {
    harness.cleanup();
  }
});
