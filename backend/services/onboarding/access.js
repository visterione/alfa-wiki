'use strict';

/**
 * Права в модуле онбординга.
 *
 * Два уровня, как в складском учёте:
 *
 *   1) **Доступ к разделу** — гранулярный флаг adminAccess.onboarding. Без него
 *      человек не видит раздел вообще.
 *
 *   2) **Что именно видно внутри** — считается по назначениям (onb_assignments),
 *      а не по роли. Ролей под этот процесс мы намеренно не заводили: их в
 *      проекте и так много, а исполнитель здесь всегда конкретный человек.
 *
 * Видимость заявки — это не «право», а факт: сегодня человек назначен главврачом
 * филиала, завтра нет, и список заявок должен меняться вместе с этим. Поэтому
 * условие считается запросом, а не хранится копией.
 */

const { Op } = require('sequelize');
const { OnbAssignment, OnbTask, OnbApplication } = require('../../models');
const assignments = require('./assignments');
const projection = require('./projection');

function hasModuleAccess(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  return Boolean(user.adminAccess?.onboarding);
}

/**
 * Полномочия человека: на каких шагах он назначен и в каких филиалах.
 * Один запрос — дальше всё считается по нему.
 */
async function resolve(user) {
  if (!hasModuleAccess(user)) {
    return { allowed: false, isAdmin: false, steps: [], medCenterIds: [], networkSteps: [] };
  }

  const rows = await OnbAssignment.findAll({
    where: { userId: user.id },
    attributes: ['stepKey', 'medCenterId'],
    raw: true
  });

  return {
    allowed: true,
    // Администратор портала видит все заявки по всем филиалам и без назначений:
    // иначе после выката раздел оказался бы заперт сам от себя — назначения
    // некому было бы расставить.
    isAdmin: Boolean(user.isAdmin),
    // Пары «шаг + филиал», а не два плоских списка. Плоские списки врут при
    // смешанных назначениях: человек, назначенный бейджем в «Альфе» и главврачом
    // в «Кидс», по ним получал бы права главврача и в «Альфе» тоже.
    grants: rows.map(r => ({ stepKey: r.stepKey, medCenterId: r.medCenterId || null })),
    steps: [...new Set(rows.map(r => r.stepKey))],
    medCenterIds: [...new Set(rows.map(r => r.medCenterId).filter(Boolean))],
    networkSteps: [...new Set(rows.filter(r => !r.medCenterId).map(r => r.stepKey))]
  };
}

/** Шаги, на которых человек назначен именно по этой заявке. */
function stepsForApplication(acl, app) {
  return (acl.grants || [])
    .filter(g => g.medCenterId === null || g.medCenterId === app.medCenterId)
    .map(g => g.stepKey);
}

/**
 * Условие видимости заявок для списка.
 *
 * Человек видит заявку, если он назначен на любой её шаг: сетевым назначением —
 * все заявки, филиальным — заявки своего филиала. Это условие уезжает в SQL, а
 * не фильтрует уже полученный список: иначе достаточно поправить адрес запроса,
 * чтобы увидеть чужие.
 */
function scopeWhere(acl) {
  if (acl.isAdmin) return {};
  if (acl.networkSteps.length) return {};
  if (acl.medCenterIds.length) return { medCenterId: { [Op.in]: acl.medCenterIds } };
  // Назначений нет — заявок не видно, даже при доступе к разделу.
  return { id: null };
}

/**
 * Какой срез анкеты показать этому человеку по этой заявке.
 *
 * Берём самый широкий из доступных ему: если он и главврач филиала, и
 * маркетолог, анкету он увидит целиком, а не усечённо.
 */
function viewKeyFor(acl, app) {
  if (acl.isAdmin) return '*';

  const mine = stepsForApplication(acl, app);

  if (mine.includes(assignments.CHIEF_STEP)) return '*';
  // Порядок важен: первый совпавший и определяет срез, поэтому идём от самого
  // широкого набора полей к самому узкому.
  const order = ['mis_account', 'website', 'schedule', 'services_mis', 'badge', 'callcenter'];
  for (const step of order) {
    if (mine.includes(step)) return step;
  }
  return null;
}

/** Может ли человек принимать решение по анкете (согласовать, вернуть, отклонить). */
function canDecide(acl, app) {
  if (acl.isAdmin) return true;
  return stepsForApplication(acl, app).includes(assignments.CHIEF_STEP);
}

/** Отменять процесс и менять филиал может тот, кто согласовывал, либо админ. */
function canManage(acl, app) {
  return canDecide(acl, app);
}

/** Настройки раздела — только администратор портала. */
function canConfigure(user) {
  return Boolean(user?.isAdmin);
}

/**
 * Право посмотреть файл заявки. Сканы диплома и сертификатов видит только тот,
 * кто согласовывает допуск: остальным они для работы не нужны. Фото — всем, у
 * кого есть доступ к заявке: оно нужно обоим маркетологам.
 */
async function canViewFile(userId, file) {
  const { User } = require('../../models');
  const user = await User.findByPk(userId, { attributes: ['id', 'isAdmin', 'adminAccess', 'isActive'] });
  if (!user || !user.isActive) return false;

  const acl = await resolve(user);
  if (!acl.allowed) return false;
  if (acl.isAdmin) return true;

  const app = await OnbApplication.findByPk(file.applicationId, { attributes: ['id', 'medCenterId'] });
  if (!app) return false;

  const viewKey = viewKeyFor(acl, app);
  if (!viewKey) return false;

  if (projection.DOC_KINDS_FOR_CHIEF.includes(file.kind)) {
    return projection.canSeeDocuments(viewKey);
  }
  return true;
}

/** Задачи человека — вход в раздел для исполнителя. */
async function myTasks(user) {
  const rows = await OnbTask.findAll({
    where: { completedAt: null },
    include: [{ model: OnbApplication, as: 'application' }]
  });

  return rows.filter(task => {
    const ids = task.assigneeIds || [];
    if (!ids.includes(user.id)) return false;
    // Шаг-гонка: после того как задачу взяли, у остальных она пропадает.
    if (task.claimedBy && task.claimedBy !== user.id) return false;
    return true;
  });
}

module.exports = {
  hasModuleAccess,
  resolve,
  stepsForApplication,
  scopeWhere,
  viewKeyFor,
  canDecide,
  canManage,
  canConfigure,
  canViewFile,
  myTasks
};
