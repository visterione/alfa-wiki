'use strict';

/**
 * Кто что видит в разделе (ver. 8.20).
 *
 * Право здесь не одно, а два, и это не усложнение ради усложнения. Заказчик
 * просил ограничить раздел админом — и это верно про **настройку**: шаблоны,
 * вакансии и QR собирает один человек, конструктор остальным не нужен.
 *
 * Но исполнители шагов — кадровик, маркетолог, главврач — админами не будут
 * никогда, а задачи по заявкам приходят именно им. Закрыть от них заявки
 * означало бы, что задачу поставить некому: уведомление придёт, а открыть его
 * будет негде.
 *
 * Поэтому:
 *   настройка (шаблоны, вакансии, ссылки)  — только isAdmin;
 *   заявки и задачи                        — админ плюс тот, кто назначен
 *                                            исполнителем хоть на один шаг.
 *
 * Отдельного флага в adminAccess не заводим: право «быть исполнителем» уже
 * выражено назначением, и второе место настройки того же самого неизбежно
 * разошлось бы с первым. Ровно так считает права складской модуль
 * (services/warehouse/access.js), и там это себя оправдало.
 */

const { Op } = require('sequelize');

const assignments = require('./assignments');

/** Собирать шаблоны, заводить вакансии, печатать QR. */
function canConfigure(user) {
  return Boolean(user?.isAdmin);
}

/**
 * Что человеку доступно в разделе. Считается один раз на запрос: назначения
 * нужны и для проверки права, и для фильтра списка заявок.
 *
 * @returns {Promise<{allowed: boolean, isAdmin: boolean, scopes: Array}>}
 */
async function resolve(user) {
  const isAdmin = canConfigure(user);
  const scopes = await assignments.stepsOfUser(user.id);
  return { allowed: isAdmin || scopes.length > 0, isAdmin, scopes };
}

/**
 * Видна ли человеку заявка.
 *
 * Админу — любая. Исполнителю — та, где он назначен хоть на один шаг её
 * шаблона: либо на её филиал, либо сетевым назначением. Показывать кадровику
 * заявки филиалов, где он не участвует, незачем, а видеть заявку целиком там,
 * где он участвует, он должен — разграничения по полям во втором поколении нет
 * по решению заказчика.
 */
function canSeeApplication(acl, application) {
  if (acl.isAdmin) return true;
  return acl.scopes.some(s =>
    s.templateId === application.templateId
    && (!s.medCenterId || s.medCenterId === application.medCenterId));
}

/**
 * Условие для выборки списка заявок — то же правило, но на языке базы: строить
 * список целиком и фильтровать в приложении нельзя, заявок со временем станет
 * много.
 */
function applicationScope(acl) {
  if (acl.isAdmin) return {};

  const byTemplate = new Map();
  for (const scope of acl.scopes) {
    const set = byTemplate.get(scope.templateId) || new Set();
    // Сетевое назначение (филиал пустой) открывает все филиалы этого шаблона.
    set.add(scope.medCenterId || '*');
    byTemplate.set(scope.templateId, set);
  }

  const conditions = [];
  for (const [templateId, centers] of byTemplate) {
    if (centers.has('*')) conditions.push({ templateId });
    else conditions.push({ templateId, medCenterId: [...centers] });
  }

  // Ни одного назначения — ни одной заявки. Пустой список условий в Sequelize
  // означал бы «всё», а это ровно противоположное тому, что нужно.
  return conditions.length ? { [Op.or]: conditions } : { id: null };
}

module.exports = { canConfigure, resolve, canSeeApplication, applicationScope };
