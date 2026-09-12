'use strict';

/**
 * Рабочие чаты, в которые зовут после запуска (ver. 8.20).
 *
 * Разбор ссылки, чтение og-тегов и скачивание аватарок живут в общей службе
 * services/chatPreview.js — она не знает ни одной модели модуля. Здесь осталось
 * своё: где эти ссылки лежат и кому уходят.
 *
 * Отличие от первого поколения — привязка. Там чат принадлежал филиалу, здесь
 * паре «шаблон + филиал»: медсестру на Ленина зовут не туда, куда врача там же,
 * и не туда, куда медсестру в соседнем медцентре. Пустой филиал означает «этот
 * шаблон во всех филиалах» — так заводится общий чат сети для должности.
 */

const { Op } = require('sequelize');

const { VacChatLink } = require('../../models');
const { publicBase } = require('./links');
const preview = require('../chatPreview');

const { AVATAR_URL_PREFIX } = preview;

/**
 * Чаты, которые уходят человеку по этой заявке: заведённые для его филиала плюс
 * общие на сеть.
 *
 * Именно объединение, а не «филиальные, иначе сетевые», как у исполнителей
 * шагов (assignments.js). Там сетевое назначение — запасной вариант, здесь же
 * общий чат сети и чат филиала нужны оба, и человек должен быть в обоих.
 *
 * Свой филиал идёт первым: с ним он будет работать каждый день.
 */
async function forApplication(app) {
  const rows = await VacChatLink.findAll({
    where: {
      templateId: app.templateId,
      isActive: true,
      [Op.or]: [{ medCenterId: app.medCenterId || null }, { medCenterId: null }]
    },
    order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']]
  });

  const own = rows.filter(row => row.medCenterId);
  const network = rows.filter(row => !row.medCenterId);
  return [...own, ...network].map(toMailItem);
}

function toMailItem(link) {
  return {
    title: link.title,
    subtitle: link.subtitle || '',
    url: link.url,
    // Абсолютный адрес: относительный «/uploads/…» в письме указывает на домен
    // почтового клиента и не откроется никогда.
    avatarUrl: link.avatarPath ? `${publicBase()}${AVATAR_URL_PREFIX}/${link.avatarPath}` : null
  };
}

/** Для экрана настроек: там же нужен путь к картинке и состояние превью. */
function toJson(link) {
  return {
    id: link.id,
    templateId: link.templateId,
    medCenterId: link.medCenterId,
    url: link.url,
    title: link.title,
    subtitle: link.subtitle,
    avatarUrl: link.avatarPath ? `${AVATAR_URL_PREFIX}/${link.avatarPath}` : null,
    sortOrder: link.sortOrder,
    isActive: link.isActive,
    fetchedAt: link.fetchedAt,
    fetchError: link.fetchError,
    // Портальный чат открывается только после входа в «Альфа-Вики», а учётной
    // записи у кандидата нет. Экран настроек предупреждает об этом на месте.
    isPortal: Boolean(preview.portalInviteToken(link.url))
  };
}

module.exports = {
  normalizeUrl: preview.normalizeUrl,
  fetchPreview: preview.fetchPreview,
  storeAvatar: preview.storeAvatar,
  saveAvatar: preview.saveAvatar,
  removeAvatar: preview.removeAvatar,
  refresh: preview.refresh,

  forApplication,
  toMailItem,
  toJson
};
