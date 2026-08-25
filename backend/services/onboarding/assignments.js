'use strict';

/**
 * Кто выполняет шаг для конкретной заявки.
 *
 * Ролей в модуле нет: исполнитель — конкретный пользователь. Настройка живёт в
 * onb_assignments и отвечает на один вопрос — «шаг + филиал → кто». У сетевых
 * шагов (админ МИС, маркетологи, колл-центр) филиал не указан; у шагов
 * главврача, регистратора и бухгалтера — указан, потому что в каждом МЦ они
 * свои и от филиала зависит вся маршрутизация заявки.
 */

const { Op } = require('sequelize');
const { OnbAssignment, User } = require('../../models');
const process_ = require('./process');

/**
 * Исполнители шага для филиала.
 *
 * Ищем сначала назначение на этот филиал, и только если его нет — сетевое.
 * Порядок именно такой: сетевое назначение здесь работает запасным вариантом,
 * иначе шаг с настроенным филиальным исполнителем всё равно уходил бы двоим.
 *
 * Выбывшие сотрудники (isActive = false) отсеиваются: задача на уволенного —
 * это молча зависший процесс. Она достанется тому, кто остался, а если не
 * осталось никого, вызывающий получит пустой список и покажет заявку админу.
 *
 * @param {string} stepKey
 * @param {string|null} medCenterId
 * @returns {Promise<string[]>} id пользователей
 */
async function resolveAssignees(stepKey, medCenterId) {
  const rows = await OnbAssignment.findAll({
    where: {
      stepKey,
      [Op.or]: [
        { medCenterId: medCenterId || null },
        { medCenterId: null }
      ]
    },
    include: [{ model: User, as: 'user', attributes: ['id', 'isActive'] }]
  });

  const branch = rows.filter(r => r.medCenterId && r.user?.isActive);
  const network = rows.filter(r => !r.medCenterId && r.user?.isActive);
  const chosen = branch.length ? branch : network;

  return [...new Set(chosen.map(r => r.userId))];
}

/**
 * Кто согласовывает заявку. Отдельной функцией, потому что главврач — не шаг из
 * STEPS: у него нет задачи в общем списке, решение принимается в самой карточке.
 */
const CHIEF_STEP = 'chief_approval';

async function resolveChiefs(medCenterId) {
  return resolveAssignees(CHIEF_STEP, medCenterId);
}

/**
 * Кому эскалировать просрочку. Тоже поимённо, а не «руководителю по иерархии»:
 * иерархии подчинения в портале нет, а выдумывать её ради одного уведомления
 * незачем.
 */
const ESCALATION_STEP = 'escalation';

async function resolveEscalation(medCenterId) {
  return resolveAssignees(ESCALATION_STEP, medCenterId);
}

/**
 * Все настраиваемые точки процесса — для экрана настроек. Шаги из process.js
 * плюс две служебные: согласование и эскалация.
 */
function configurableSteps() {
  return [
    {
      key: CHIEF_STEP,
      title: 'Согласование анкеты',
      hint: 'Главврач филиала. Единственная точка, где процесс может встать целиком.',
      scope: 'branch',
      multiplePolicy: 'first_action'
    },
    ...process_.STEPS.map(s => ({
      key: s.key,
      title: s.title,
      hint: s.hint,
      scope: s.scope,
      multiplePolicy: 'claim'
    })),
    {
      key: ESCALATION_STEP,
      title: 'Эскалация просрочек',
      hint: 'Кому уходит уведомление, когда исполнитель не уложился в срок.',
      scope: 'branch',
      multiplePolicy: 'notify_all'
    }
  ];
}

/**
 * Назначения, которые не сработают.
 *
 * Две причины, и обе выглядят одинаково — задача молча зависает:
 *   • человек уволен или отключён (isActive = false);
 *   • у человека забрали доступ к разделу — задача ему уходит, но открыть её он
 *     не может, и она протухает по сроку.
 *
 * Показываем их админу вместе: переназначать вручную можно только то, что видно.
 */
async function brokenAssignees() {
  const rows = await OnbAssignment.findAll({
    include: [{
      model: User,
      as: 'user',
      attributes: ['id', 'displayName', 'username', 'isActive', 'isAdmin', 'adminAccess']
    }]
  });

  return rows
    .map(row => {
      const user = row.user;
      if (!user) return null;
      if (!user.isActive) return { row, reason: 'выбыл' };
      if (!user.isAdmin && user.adminAccess?.onboarding !== true) {
        return { row, reason: 'нет доступа к разделу' };
      }
      return null;
    })
    .filter(Boolean)
    .map(({ row, reason }) => ({
      stepKey: row.stepKey,
      medCenterId: row.medCenterId,
      reason,
      user: {
        id: row.user.id,
        displayName: row.user.displayName,
        username: row.user.username
      }
    }));
}

module.exports = {
  CHIEF_STEP,
  ESCALATION_STEP,
  resolveAssignees,
  resolveChiefs,
  resolveEscalation,
  configurableSteps,
  brokenAssignees
};
