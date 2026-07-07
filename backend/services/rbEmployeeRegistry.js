/**
 * Реестр сотрудников RB — локальное зеркало сотрудников МИС.
 *
 * Зачем: живой список врачей эфемерен (тянется из МИС на каждый заход), а наши данные
 * (настройки исполнителя, история зарплат) привязаны к misUserId и должны переживать увольнение.
 *
 * Что делает:
 *   1) syncAndAnnotate(merged) — на каждый полноростерный запрос /mis/doctors:
 *        • upsert снимка «видели сейчас» (обновляет lastSeenAt, оживляет из архива);
 *        • при первом засеве помечает всех seededBaseline=true (существующие ≠ новые);
 *        • помечает живых флагом _isNew (появился после baseline и ещё без настроек);
 *        • дописывает архивных, которых нет в живом ответе, чтобы Сводка/Отчёт не теряли данные.
 *   2) archiveStale() — периодический прогон: кто не виден > ARCHIVE_AFTER_DAYS суток → archived.
 *      Решение по устареванию lastSeenAt, а не по «нет в этом ответе», поэтому разовый
 *      пустой/битый ответ МИС никого не архивирует.
 */
const { Op } = require('sequelize');
const { RbEmployee, ExecutorSettings } = require('../models');

const ARCHIVE_AFTER_DAYS = 14;

// Достаём из сырого объекта МИС ровно те поля, что нужны фронтовому normalizeDoctors,
// и храним их «как есть», чтобы архивные потом прошли ту же нормализацию, что и живые.
function extractSnapshot(u) {
  let professions = [];
  if (Array.isArray(u.professions) && u.professions.length) professions = u.professions;
  else if (u.profession_titles) professions = String(u.profession_titles).split(',').map(s => s.trim()).filter(Boolean);
  else if (u.profession) professions = [u.profession];

  let roles = [];
  if (u.role_titles) roles = String(u.role_titles).split(',').map(s => s.trim()).filter(Boolean);
  else if (Array.isArray(u.role_names) && u.role_names.length) roles = u.role_names;
  else if (u.role) roles = [u.role];

  let clinics = u.clinics || u.clinic || u.clinic_ids || [];
  if (!Array.isArray(clinics)) clinics = String(clinics).split(',').map(x => x.trim()).filter(Boolean);

  const name = u.name || [u.last_name, u.first_name, u.middle_name].filter(Boolean).join(' ');
  return { name, professions, roles, clinics };
}

// Архивного отдаём в той же «сырой» форме, что и живого из МИС, чтобы фронтовый
// normalizeDoctors обработал его идентично (те же имена полей: professions/role_names/clinics).
function toRawDoctor(row) {
  return {
    id: row.misUserId,
    name: row.name,
    professions: row.professions || [],
    role_names: row.roles || [],
    clinics: row.clinics || [],
    _archived: true,
  };
}

/**
 * Синхронизирует реестр по живому полному ростеру и возвращает итоговый список для фронта:
 * живые (аннотированы _isNew) + архивные (снимок, _archived), которых нет в живом ответе.
 * При любой ошибке реестра возвращает исходный merged — /mis/doctors не должен падать из-за реестра.
 */
async function syncAndAnnotate(merged) {
  // Пустой/битый ответ МИС не трогаем — не сеем baseline, не старим lastSeenAt.
  if (!Array.isArray(merged) || merged.length === 0) return merged || [];

  try {
    const now = new Date();

    // Первый ли это засев (реестр пуст) — тогда все текущие считаются существующими, не новыми.
    const existingCount = await RbEmployee.count();
    const isBaseline = existingCount === 0;

    const rows = merged.map(u => {
      const snap = extractSnapshot(u);
      return {
        misUserId: String(u.id),
        name: snap.name,
        professions: snap.professions,
        roles: snap.roles,
        clinics: snap.clinics,
        status: 'active',
        archivedAt: null,
        seededBaseline: isBaseline, // важно только для НОВЫХ строк; updateOnDuplicate это поле не трогает
        firstSeenAt: now,           // только для новых (в updateOnDuplicate не входит)
        lastSeenAt: now,
      };
    });

    await RbEmployee.bulkCreate(rows, {
      updateOnDuplicate: ['name', 'professions', 'roles', 'clinics', 'status', 'archivedAt', 'lastSeenAt', 'updatedAt'],
    });

    // Полное состояние реестра + кто уже с настройками — для _isNew и списка архивных.
    const [regRows, execRows] = await Promise.all([
      RbEmployee.findAll(),
      ExecutorSettings.findAll({ attributes: ['misUserId'] }),
    ]);
    const hasSettings = new Set(execRows.map(r => String(r.misUserId)));

    // Новый = active + не baseline + ещё без строки настроек исполнителя.
    const newIds = new Set(
      regRows
        .filter(r => r.status === 'active' && !r.seededBaseline && !hasSettings.has(String(r.misUserId)))
        .map(r => String(r.misUserId))
    );

    const seenSet = new Set(merged.map(u => String(u.id)));
    const annotated = merged.map(u => ({ ...u, _isNew: newIds.has(String(u.id)) }));

    // Архивные, которых нет в живом ответе — дописываем снимком (для статистики).
    const archivedExtra = regRows
      .filter(r => r.status === 'archived' && !seenSet.has(String(r.misUserId)))
      .map(toRawDoctor);

    return annotated.concat(archivedExtra);
  } catch (err) {
    console.error('[rbEmployeeRegistry] syncAndAnnotate error:', err.message);
    return merged;
  }
}

/**
 * Переводит в архив тех, кого не видели дольше ARCHIVE_AFTER_DAYS.
 * Обратимо: как только сотрудник снова придёт из МИС, syncAndAnnotate вернёт его в active.
 */
async function archiveStale() {
  const cutoff = new Date(Date.now() - ARCHIVE_AFTER_DAYS * 86400000);
  const [count] = await RbEmployee.update(
    { status: 'archived', archivedAt: new Date() },
    { where: { status: 'active', lastSeenAt: { [Op.lt]: cutoff } } }
  );
  if (count) console.log(`[rbEmployeeRegistry] Заархивировано сотрудников: ${count} (не видели > ${ARCHIVE_AFTER_DAYS} дн.)`);
  return count;
}

module.exports = { syncAndAnnotate, archiveStale, ARCHIVE_AFTER_DAYS };
