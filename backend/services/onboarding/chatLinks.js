'use strict';

/**
 * Рабочие чаты филиала (ver. 7.64).
 *
 * Ссылки на групповые чаты, которые уходят врачу одним письмом, когда закрыт
 * последний шаг. До ver. 7.64 их кидали руками в личку, и раз за разом
 * кто-нибудь оказывался не в том чате.
 *
 * Разбор ссылки, чтение og-тегов и скачивание аватарок живут в общей службе
 * services/chatPreview.js: она не знает ни одной модели модуля, и второе
 * поколение онбординга пользуется ею же. Здесь осталось только своё — где эти
 * ссылки лежат и кому уходят.
 */

const { Op } = require('sequelize');

const { OnbChatLink } = require('../../models');
const { publicBase } = require('./links');
const preview = require('../chatPreview');

const { AVATAR_URL_PREFIX, portalInviteToken } = preview;

// ── Чтение ─────────────────────────────────────────────────────────────────

/**
 * Чаты, которые уходят врачу этого филиала: филиальные плюс сетевые.
 *
 * Именно объединение, а не «филиальные, иначе сетевые», как у исполнителей
 * шагов (assignments.js). Там сетевое назначение — запасной вариант, здесь же
 * общий чат сети и чат филиала нужны оба, и врач должен быть в обоих.
 *
 * Свой филиал идёт первым: с ним человек будет работать каждый день.
 */
async function forMedCenter(medCenterId) {
  const rows = await OnbChatLink.findAll({
    where: {
      isActive: true,
      [Op.or]: [{ medCenterId: medCenterId || null }, { medCenterId: null }]
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
    // записи у врача нет. Экран настроек предупреждает об этом на месте.
    isPortal: Boolean(portalInviteToken(link.url))
  };
}

module.exports = {
  // Часть поверхности осталась прежней: маршруты модуля зовут эти функции по
  // старым именам, и менять их ради переезда внутренностей незачем.
  AVATAR_DIR: preview.AVATAR_DIR,
  normalizeUrl: preview.normalizeUrl,
  fetchPreview: preview.fetchPreview,
  downloadAvatar: preview.downloadAvatar,
  saveAvatar: preview.saveAvatar,
  storeAvatar: preview.storeAvatar,
  portalInviteToken: preview.portalInviteToken,
  removeAvatar: preview.removeAvatar,
  refresh: preview.refresh,

  forMedCenter,
  toMailItem,
  toJson
};
