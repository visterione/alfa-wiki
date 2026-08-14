/**
 * Команды как граница видимости.
 *
 * Досок в модуле нет: доска — это представление поверх всех задач, а кто чью
 * загрузку видит, решает команда. Здесь чистые функции над уже выбранными
 * командами; запросы к базе — в маршрутах.
 *
 * Три уровня доступа:
 *
 *   all     — загрузку команды видит вся компания;
 *   members — участники и явно перечисленные смотрящие;
 *   invite  — только смотрящие, перечисленные поимённо.
 *
 * И отдельно скрытость. Скрытая команда не показывается как «нет доступа» —
 * для постороннего её не существует: ни в списках, ни в поиске, ни в фильтрах,
 * ни в счётчике «ещё N команд». Разница не косметическая: строка «нет доступа»
 * сама сообщает, что команда есть, а по названию «Найм и офферы» дальше всё
 * понятно без всякого доступа.
 *
 * Ожидаемая форма команды: { id, name, medCenterId, access, isHidden,
 * members: [{ userId, role }] }, где role — member | viewer | lead.
 */

const ACCESS = { ALL: 'all', MEMBERS: 'members', INVITE: 'invite' };
const ROLES = { MEMBER: 'member', VIEWER: 'viewer', LEAD: 'lead' };

/** Участники команды — те, чья загрузка в неё попадает. Смотрящие не в счёт. */
function memberIds(team) {
  return (team?.members || [])
    .filter(m => m.role === ROLES.MEMBER || m.role === ROLES.LEAD)
    .map(m => m.userId);
}

/** Смотрящие — видят загрузку, но сами в команду не входят. */
function viewerIds(team) {
  return (team?.members || [])
    .filter(m => m.role === ROLES.VIEWER)
    .map(m => m.userId);
}

function isMember(team, userId) {
  return memberIds(team).includes(userId);
}

function isLead(team, userId) {
  return (team?.members || []).some(m => m.userId === userId && m.role === ROLES.LEAD);
}

/**
 * Знает ли человек о существовании команды.
 *
 * Отдельно от «видит загрузку»: команду можно видеть в списке, но не иметь
 * права проваливаться в неё. Скрытая команда не проходит даже этот шаг.
 */
function canSeeTeam(team, userId, isAdmin = false) {
  if (!team) return false;
  if (isMember(team, userId) || viewerIds(team).includes(userId)) return true;
  // Скрытая команда не выдаётся даже администратору списком: он получает её,
  // когда открывает управление командами, отдельным запросом и осознанно.
  if (team.isHidden) return false;
  if (isAdmin) return true;
  return team.access === ACCESS.ALL;
}

/** Видит ли человек загрузку участников команды. */
function canSeeTeamLoad(team, userId, isAdmin = false) {
  if (!canSeeTeam(team, userId, isAdmin)) return false;
  if (isMember(team, userId) || viewerIds(team).includes(userId)) return true;
  if (team.access === ACCESS.ALL) return true;
  return isAdmin && !team.isHidden;
}

/** Команды, о существовании которых человек знает. */
function visibleTeams(teams, userId, isAdmin = false) {
  return (teams || []).filter(team => canSeeTeam(team, userId, isAdmin));
}

/**
 * Сколько команд существует, но закрыто от человека.
 *
 * Скрытые в это число не входят: сообщение «ещё 3 команды закрыты для вас» при
 * скрытой команде выдало бы ровно то, что она прячет.
 */
function closedTeamCount(teams, userId, isAdmin = false) {
  return (teams || []).filter(
    team => !team.isHidden && !canSeeTeam(team, userId, isAdmin)
  ).length;
}

/**
 * Люди, чью загрузку человек имеет право видеть.
 *
 * Себя видно всегда: без этого руководитель без команды не увидел бы
 * собственный день.
 */
function peopleInScope(teams, userId, isAdmin = false, filters = {}) {
  const scope = new Set([userId]);
  for (const team of teams || []) {
    if (filters.medCenterId && team.medCenterId !== filters.medCenterId) continue;
    if (filters.teamId && team.id !== filters.teamId) continue;
    if (!canSeeTeamLoad(team, userId, isAdmin)) continue;
    for (const id of memberIds(team)) scope.add(id);
  }
  return [...scope];
}

/**
 * С кем человек состоит в общих командах — множество для уровня видимости
 * «team». Считается по участию, а не по праву смотреть: смотрящий видит часы
 * команды, но не названия её дел.
 */
function teammateIds(teams, userId) {
  const out = new Set();
  for (const team of teams || []) {
    if (!isMember(team, userId)) continue;
    for (const id of memberIds(team)) {
      if (id !== userId) out.add(id);
    }
  }
  return out;
}

/** Может ли человек менять норму другому: только руководитель общей команды. */
function canEditNorm(teams, editorId, targetId, isAdmin = false) {
  if (isAdmin) return true;
  return (teams || []).some(
    team => isLead(team, editorId) && isMember(team, targetId)
  );
}

module.exports = {
  ACCESS,
  ROLES,
  memberIds,
  viewerIds,
  isMember,
  isLead,
  canSeeTeam,
  canSeeTeamLoad,
  visibleTeams,
  closedTeamCount,
  peopleInScope,
  teammateIds,
  canEditNorm,
};
