const { RbActivityLog } = require('../models');

const TAB_LABELS = {
  executors:    'Сотрудники',
  worktime:     'Учёт рабочего времени',
  'hour-norms': 'Норма часов',
  schedule:     'Расписание',
  performed:    'Услуги',
  referrals:    'Направления',
  report:       'Отчёт',
  archive:      'Архив',
  summary:      'Сводка',
};

const ACTION_LABELS = {
  create: 'Создано',
  update: 'Изменено',
  delete: 'Удалено',
  reset:  'Сброс',
  import: 'Импорт',
  save:   'Сохранено',
  grant:  'Предоставлен доступ',
  revoke: 'Отозван доступ',
};

/**
 * Write one log record to rb_activity_log.
 */
async function logRbActivity({
  userId,
  tab,
  action,
  entityType = null,
  entityId   = null,
  doctorName = null,
  misUserId  = null,
  clinicId   = null,
  summary,
  diff       = null,
}) {
  try {
    await RbActivityLog.create({
      userId:     userId    || null,
      tab,
      action,
      entityType: entityType || null,
      entityId:   entityId   != null ? String(entityId).substring(0, 255) : null,
      doctorName: doctorName != null ? String(doctorName).substring(0, 255) : null,
      misUserId:  misUserId  != null ? String(misUserId).substring(0, 100) : null,
      clinicId:   clinicId   != null ? String(clinicId).substring(0, 100)  : null,
      summary:    String(summary),
      diff:       diff || null,
    });
  } catch (err) {
    console.error('[rbLogger] error:', err.message);
  }
}

// ── Diff helpers ──────────────────────────────────────────────────────────────

const SCALAR_LABELS = {
  payType:           'Тип выплаты',
  fixedSalary:       'Оклад',
  hourlyRate:        'Ставка/час',
  hoursWorked:       'Отработано часов',
  executorPercent:   'Процент исполнителя',
  assistancePercent: 'Процент ассистента',
  advance:           'Аванс',
  mainPayment:       'Основная выплата',
  paymentMethod:     'Способ выплаты аванса',
  mainPaymentMethod: 'Способ основной выплаты',
  plusPercent:       'Плюс процент',
  harmfulness:       'Вредность',
  includeReferralBonuses:    'Включать направит. бонусы',
  includeReferralDeductions: 'Включать направит. удержания',
  includeCorpInvoices:       'Включать корп. счета',
  lockedAdvance:     'Фиксация аванса',
  lockedMainPayment: 'Фиксация осн. выплаты',
  lockedFixedSalary: 'Фиксация оклада',
  lockedHourlyRate:  'Фиксация ставки/час',
  lockedHoursWorked: 'Фиксация часов',
};

const ARRAY_LABELS = {
  deductions:      'Удержания',
  materials:       'Расходники',
  serviceMaterials:'Материалы по услугам',
  extras:          'Доп. выплаты',
  normServices:    'Нормативные услуги',
  roleRates:       'Ставки по ролям',
  cabinets:        'Кабинеты',
  extraPayments:   'Дополнительные выплаты',
};

/**
 * Extract a stable key from an array item.
 * Objects with `name` or `roleTitle` are matched by that field.
 * Strings are their own keys.
 */
function itemKey(item) {
  if (item == null) return null;
  if (typeof item === 'string') return item;
  return item.name || item.roleTitle || item.role || item.title || JSON.stringify(item);
}

/**
 * Compute added / removed / modified for two arrays.
 * Items are matched by `itemKey`.
 */
function diffArray(oldArr, newArr) {
  const oa = oldArr || [];
  const na = newArr || [];

  const oldMap = new Map();
  const newMap = new Map();

  for (const item of oa) {
    const k = itemKey(item);
    if (k != null) oldMap.set(k, item);
  }
  for (const item of na) {
    const k = itemKey(item);
    if (k != null) newMap.set(k, item);
  }

  const added    = [];
  const removed  = [];
  const modified = [];

  for (const [key, oldItem] of oldMap) {
    const newItem = newMap.get(key);
    if (newItem === undefined) {
      removed.push(oldItem);
    } else if (JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
      modified.push({ key, before: oldItem, after: newItem });
    }
  }
  for (const [key, newItem] of newMap) {
    if (!oldMap.has(key)) {
      added.push(newItem);
    }
  }

  return { added, removed, modified };
}

/**
 * Compute a compact diff between two executor settings objects.
 * @param {object} oldSettings
 * @param {object} newSettings
 * @param {object} [clinicNames]  Optional map { clinicId -> clinicName }
 * @param {object} [roleNames]    Optional map { roleId -> roleName } for roleRates
 * Returns an array of change descriptors per clinic/field.
 */
function diffExecSettings(oldSettings, newSettings, clinicNames = {}, roleNames = {}) {
  const changes = [];

  const oldCs = oldSettings?.clinicSettings || {};
  const newCs = newSettings?.clinicSettings || {};
  const allClinicIds = new Set([...Object.keys(oldCs), ...Object.keys(newCs)]);

  for (const clinicId of allClinicIds) {
    const oldC = oldCs[clinicId] || {};
    const newC = newCs[clinicId] || {};
    const clinicName = clinicNames[clinicId] || clinicNames[String(clinicId)] || null;

    // Scalar fields
    for (const [field, label] of Object.entries(SCALAR_LABELS)) {
      const ov = oldC[field];
      const nv = newC[field];
      if (JSON.stringify(ov) !== JSON.stringify(nv)) {
        changes.push({ clinicId, clinicName, field, label, before: ov ?? null, after: nv ?? null });
      }
    }

    // Array fields — item-level diff
    for (const [field, label] of Object.entries(ARRAY_LABELS)) {
      const oa = oldC[field] || [];
      const na = newC[field] || [];
      if (JSON.stringify(oa) === JSON.stringify(na)) continue;

      const { added, removed, modified } = diffArray(oa, na);
      if (added.length > 0 || removed.length > 0 || modified.length > 0) {
        // For roleRates: replace UUID roleTitle with human-readable name if available
        let a = added, r = removed, m = modified;
        if (field === 'roleRates' && Object.keys(roleNames).length > 0) {
          const enrich = item => {
            if (!item || typeof item !== 'object') return item;
            const n = roleNames[item.roleTitle] || roleNames[String(item.roleTitle)];
            return n ? { ...item, roleTitle: n } : item;
          };
          a = added.map(enrich);
          r = removed.map(enrich);
          m = modified.map(mod => ({
            ...mod,
            key:    roleNames[mod.key] || roleNames[String(mod.key)] || mod.key,
            before: enrich(mod.before),
            after:  enrich(mod.after),
          }));
        }
        changes.push({ clinicId, clinicName, field, label, type: 'array', added: a, removed: r, modified: m });
      }
    }
  }

  // Top-level assistants
  const oa = oldSettings?.assistants || [];
  const na = newSettings?.assistants || [];
  if (JSON.stringify(oa) !== JSON.stringify(na)) {
    const { added, removed, modified } = diffArray(oa, na);
    if (added.length > 0 || removed.length > 0 || modified.length > 0) {
      changes.push({ field: 'assistants', label: 'Ассистенты', type: 'array', added, removed, modified });
    }
  }

  return changes;
}

module.exports = { logRbActivity, diffExecSettings, TAB_LABELS, ACTION_LABELS };
