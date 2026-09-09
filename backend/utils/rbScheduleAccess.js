'use strict';

/**
 * Проверка области клиник для редактирования расписания.
 *
 * В RbUserPermission пустой список clinics означает доступ ко всем клиникам.
 * Отсутствие самой записи прав, напротив, не даёт доступа к расписанию.
 * canonicalClinicId нужен для медцентров с несколькими историческими id в МИС.
 */
function canWriteScheduleClinic({ isAdmin = false, permission = null, clinicId, canonicalClinicId = null }) {
  if (isAdmin) return true;
  if (!permission || permission.tabSchedule !== 'edit') return false;

  const allowed = Array.isArray(permission.clinics)
    ? permission.clinics.map(String).filter(Boolean)
    : [];
  if (allowed.length === 0) return true;

  const requested = new Set(
    [clinicId, canonicalClinicId]
      .filter(value => value !== null && value !== undefined && value !== '')
      .map(String)
  );
  return allowed.some(clinic => requested.has(clinic));
}

module.exports = { canWriteScheduleClinic };
