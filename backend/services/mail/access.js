'use strict';

/**
 * Кто какой ящик видит (ver. 8.58).
 *
 * Правило одно и намеренно жёсткое: доступ к ящику — это строка в
 * mail_account_users, и больше ничего. Полный администратор портала тоже не
 * читает чужую почту просто так: в этих ящиках жалобы и гарантийные письма с
 * фамилиями и диагнозами пациентов, и «он же админ, ему можно» — не тот
 * принцип, по которому такое должно открываться. Выдать доступ себе он может,
 * но это будет видимое действие, а не молчаливая возможность.
 *
 * Право adminAccess.mail отвечает за другое — за заведение ящиков и раздачу
 * доступов. Читать письма оно не позволяет.
 */

const { MailAccount, MailAccountUser, MedCenter } = require('../../models');

/** Ящики, к которым у человека есть доступ, вместе с его правами в каждом. */
async function accessibleAccounts(userId) {
  const rows = await MailAccountUser.findAll({
    where: { userId },
    include: [{
      model: MailAccount,
      as: 'account',
      where: { isActive: true },
      required: true,
      include: [{
        model: MedCenter,
        as: 'medCenter',
        attributes: ['id', 'name', 'displayName', 'color', 'logoUrl', 'logoSquareUrl'],
        required: false,
      }],
    }],
  });

  return rows
    .map((row) => ({
      id: row.account.id,
      email: row.account.email,
      displayName: row.account.displayName,
      medCenter: row.account.medCenter ? {
        id: row.account.medCenter.id,
        name: row.account.medCenter.name,
        displayName: row.account.medCenter.displayName,
        color: row.account.medCenter.color,
        logoUrl: row.account.medCenter.logoSquareUrl || row.account.medCenter.logoUrl || null,
      } : null,
      syncState: row.account.syncState,
      canSend: row.canSend,
      canDelete: row.canDelete,
      isDefault: row.isDefault,
      sortOrder: row.account.sortOrder,
    }))
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.email.localeCompare(b.email, 'ru'));
}

/** Идентификаторы доступных ящиков — для запросов «искать во всех моих». */
async function accessibleAccountIds(userId) {
  const rows = await MailAccountUser.findAll({ where: { userId }, attributes: ['accountId'] });
  return rows.map((r) => r.accountId);
}

/**
 * Права на конкретный ящик. Возвращает null, если доступа нет, — обработчик
 * сам решает, ответить 403 или сделать вид, что ящика не существует.
 */
async function accessTo(userId, accountId) {
  const row = await MailAccountUser.findOne({ where: { userId, accountId } });
  if (!row) return null;
  return { canRead: true, canSend: row.canSend, canDelete: row.canDelete };
}

module.exports = { accessibleAccounts, accessibleAccountIds, accessTo };
