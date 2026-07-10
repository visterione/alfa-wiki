// ═══════════════════════════════════════════════════════════════════════════
// АУП — секретная клиника «Административно-управленческий персонал».
// Зарплаты этой клиники скрыты от ВСЕХ, включая администраторов, кроме
// пользователей с флагом User.canAccessTopSalary. Флаг НЕ выдаётся автоматически
// по isAdmin — это осознанное решение (см. миграцию ver. 5.82).
//
// Enforcement — только на сервере. Данные АУП живут внутри executor-settings
// (settings.clinicSettings.aup) и в зарплатных отчётах (reportData.clinicReports
// с clinicId === 'aup'). Этот модуль — единственная точка правды для фильтрации.
// ═══════════════════════════════════════════════════════════════════════════

const AUP_CLINIC_ID = 'aup';

// Может ли пользователь видеть данные АУП.
function canSeeAup(user) {
  return !!(user && user.canAccessTopSalary);
}

// Есть ли у executor-settings клиника АУП.
function settingsHasAup(settings) {
  return !!(settings && settings.clinicSettings && settings.clinicSettings[AUP_CLINIC_ID]);
}

// Вырезает клинику АУП из executor-settings (возвращает поверхностный клон;
// исходный объект не мутируется).
function stripAupSettings(settings) {
  if (!settingsHasAup(settings)) return settings;
  const clone = { ...settings, clinicSettings: { ...settings.clinicSettings } };
  delete clone.clinicSettings[AUP_CLINIC_ID];
  if (Array.isArray(clone.disabledClinics)) {
    clone.disabledClinics = clone.disabledClinics.filter(id => String(id) !== AUP_CLINIC_ID);
  }
  return clone;
}

// При сохранении неавторизованным пользователем — подмешиваем обратно
// ранее сохранённый блок АУП из БД, чтобы его нельзя было затереть/удалить
// (в payload такого пользователя клиники АУП физически нет, т.к. GET её вырезал).
function mergeAupBack(newSettings, oldSettings) {
  const oldAup = oldSettings && oldSettings.clinicSettings && oldSettings.clinicSettings[AUP_CLINIC_ID];
  if (!oldAup) return newSettings;
  const ns = (newSettings && typeof newSettings === 'object') ? newSettings : {};
  return {
    ...ns,
    clinicSettings: { ...(ns.clinicSettings || {}), [AUP_CLINIC_ID]: oldAup },
  };
}

// Вырезает отчёты по клинике АУП из reportData зарплатного отчёта.
// Возвращает { reportData, empty } — empty=true, если после вырезки не осталось
// ни одного clinicReport (значит запись была целиком по АУП → её надо скрыть).
function stripAupReportData(reportData) {
  const reps = reportData && Array.isArray(reportData.clinicReports) ? reportData.clinicReports : null;
  if (!reps) return { reportData, empty: false };
  const filtered = reps.filter(cr => String(cr && cr.clinicId) !== AUP_CLINIC_ID);
  if (filtered.length === reps.length) return { reportData, empty: false };
  return { reportData: { ...reportData, clinicReports: filtered }, empty: filtered.length === 0 };
}

// При пересохранении зарплатной записи неавторизованным пользователем —
// возвращаем в reportData ранее сохранённые clinicReports по АУП (в его payload их нет).
function mergeAupReportData(newReportData, oldReportData) {
  const oldReps = oldReportData && Array.isArray(oldReportData.clinicReports) ? oldReportData.clinicReports : [];
  const aupReps = oldReps.filter(cr => String(cr && cr.clinicId) === AUP_CLINIC_ID);
  if (!aupReps.length) return newReportData;
  const nr = (newReportData && typeof newReportData === 'object') ? newReportData : {};
  const baseReps = Array.isArray(nr.clinicReports)
    ? nr.clinicReports.filter(cr => String(cr && cr.clinicId) !== AUP_CLINIC_ID)
    : [];
  return { ...nr, clinicReports: [...baseReps, ...aupReps] };
}

// Содержит ли зарплатная запись (Sequelize-инстанс или plain) блок АУП.
function recordHasAup(record) {
  const reps = record && record.reportData && record.reportData.clinicReports;
  return Array.isArray(reps) && reps.some(cr => String(cr && cr.clinicId) === AUP_CLINIC_ID);
}

module.exports = {
  AUP_CLINIC_ID,
  canSeeAup,
  settingsHasAup,
  stripAupSettings,
  mergeAupBack,
  stripAupReportData,
  mergeAupReportData,
  recordHasAup,
};
