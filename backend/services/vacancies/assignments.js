'use strict';

/**
 * Кто выполняет шаг для конкретной заявки (ver. 8.20, переработано в 8.21).
 *
 * Ролей в модуле нет: исполнитель — конкретный пользователь. Настройка живёт в
 * vac_assignments и отвечает на один вопрос: «вакансия + шаг + филиал → кто».
 *
 * Вакансия в ключе, а не шаблон: ключи шагов уникальны внутри вакансии, и
 * `hr_check` у врача и у технички — разные шаги с разными людьми.
 */

const { Op } = require('sequelize');
const { VacAssignment, User } = require('../../models');
const processSchema = require('./processSchema');

/**
 * Исполнители шага для филиала.
 *
 * Сначала ищем назначение на этот филиал и только если его нет — сетевое.
 * Порядок именно такой: сетевое назначение работает запасным вариантом для всех
 * филиалов сразу, иначе шаг с настроенным филиальным исполнителем всё равно
 * уходил бы двоим.
 *
 * Выбывшие сотрудники отсеиваются: задача на уволенного — это молча зависший
 * процесс. Она достанется тому, кто остался, а если не осталось никого,
 * вызывающий получит пустой список и подсветит заявку.
 *
 * @returns {Promise<string[]>} id пользователей
 */
async function resolveAssignees(vacancyId, stepKey, medCenterId) {
  const rows = await VacAssignment.findAll({
    where: {
      vacancyId,
      stepKey,
      [Op.or]: [{ medCenterId: medCenterId || null }, { medCenterId: null }]
    },
    include: [{ model: User, as: 'user', attributes: ['id', 'isActive'] }]
  });

  const branch = rows.filter(r => r.medCenterId && r.user?.isActive);
  const network = rows.filter(r => !r.medCenterId && r.user?.isActive);
  const chosen = branch.length ? branch : network;

  return [...new Set(chosen.map(r => r.userId))];
}

/**
 * Кому сообщать о просрочке. Тоже поимённо, а не «руководителю по иерархии»:
 * иерархии подчинения в портале нет, и выдумывать её ради одного уведомления
 * незачем.
 */
async function resolveEscalation(vacancyId, medCenterId) {
  return resolveAssignees(vacancyId, processSchema.ESCALATION_KEY, medCenterId);
}

/**
 * Назначения, которые не сработают: человек выбыл. Показывается на экране
 * исполнителей — узнать об уволившемся кадровике лучше до того, как на нём
 * зависнет заявка.
 */
async function brokenAssignees(vacancyId) {
  const rows = await VacAssignment.findAll({
    where: { vacancyId },
    include: [{ model: User, as: 'user', attributes: ['id', 'displayName', 'username', 'isActive'] }]
  });
  return rows
    .filter(r => !r.user || !r.user.isActive)
    .map(r => ({
      stepKey: r.stepKey,
      medCenterId: r.medCenterId,
      user: r.user ? { displayName: r.user.displayName, username: r.user.username } : null,
      reason: r.user ? 'сотрудник больше не работает' : 'пользователь удалён'
    }));
}

/** Все шаги всех вакансий, на которые человек назначен, — основа его доступа. */
async function stepsOfUser(userId) {
  return VacAssignment.findAll({
    where: { userId },
    attributes: ['vacancyId', 'stepKey', 'medCenterId'],
    raw: true
  });
}

module.exports = {
  resolveAssignees,
  resolveEscalation,
  brokenAssignees,
  stepsOfUser
};
