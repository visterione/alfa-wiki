/**
 * Контекст видимости для маршрутов: то немногое в модуле, что ходит в базу.
 *
 * Вынесено из visibility.js и teams.js намеренно — те два файла остаются
 * чистыми функциями и проверяются без базы. Здесь только выборка команд и
 * приведение их к форме, которую эти функции ждут.
 */

const teams = require('./teams');

let TaskTeam, TaskTeamMember;
try {
  const models = require('../../models');
  TaskTeam = models.TaskTeam;
  TaskTeamMember = models.TaskTeamMember;
} catch (error) {
  console.error('Модели модуля «Задачи» недоступны:', error.message);
}

/**
 * Команды со списком участников в форме, ожидаемой services/tasks/teams.
 *
 * Возвращаются все команды, включая скрытые: решение о том, кому какая видна,
 * принимает teams.canSeeTeam, и принимать его в двух местах — надёжный способ
 * однажды разойтись.
 */
async function loadTeams() {
  if (!TaskTeam || !TaskTeamMember) return [];
  const rows = await TaskTeam.findAll({
    include: [{ model: TaskTeamMember, as: 'members', required: false }],
  });
  return rows.map(team => ({
    id: team.id,
    name: team.name,
    medCenterId: team.medCenterId,
    access: team.access,
    isHidden: team.isHidden,
    members: (team.members || []).map(m => ({ userId: m.userId, role: m.role })),
  }));
}

/**
 * С кем человек состоит в общих командах.
 *
 * Пустое множество — рабочий ответ: человек без команд видит только своё и
 * общедоступное, и это не ошибка, а состояние нового сотрудника.
 */
async function teammateIdsOf(userId) {
  if (!userId) return new Set();
  try {
    return teams.teammateIds(await loadTeams(), userId);
  } catch (error) {
    // Ошибка выборки не должна раскрывать больше, чем открыто по умолчанию:
    // пустое множество сужает видимость, а не расширяет её.
    console.error('Не удалось загрузить команды пользователя:', error.message);
    return new Set();
  }
}

module.exports = { loadTeams, teammateIdsOf };
