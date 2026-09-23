'use strict';

/**
 * Кто какой ящик видит (ver. 8.59).
 *
 * Доступ складывается из двух источников:
 *   - персональная строка в mail_account_users;
 *   - групповое правило по медцентру, роли или их пересечению.
 *
 * Правило с двумя условиями означает именно «медцентр И роль». Несколько
 * совпавших источников объединяются: чтение даёт сам факт совпадения, а
 * canSend/canDelete работают через логическое OR. Поэтому узкая персональная
 * настройка не может случайно отнять право, уже выданное группе.
 *
 * Полный администратор портала по-прежнему не получает чужую почту молча.
 * adminAccess.mail разрешает управлять ящиками и правилами, но не читать их.
 */

const { sequelize, MailAccount, MedCenter } = require('../../models');

/**
 * Собирает эффективные права пользователя. Учитываются и новая many-to-many
 * связь ролей, и старое users.roleId: в портале ещё есть сотрудники обоих
 * поколений, терять доступ при миграции профиля нельзя.
 */
async function resolvedGrants(userId, accountId = null) {
  const bind = [userId];
  const accountFilter = accountId ? 'AND grants."accountId" = $2' : '';
  if (accountId) bind.push(accountId);

  const [rows] = await sequelize.query(`
    WITH grants AS (
      SELECT mau."accountId", mau."canSend", mau."canDelete", mau."isDefault"
      FROM mail_account_users mau
      WHERE mau."userId" = $1

      UNION ALL

      SELECT rule."accountId", rule."canSend", rule."canDelete", FALSE AS "isDefault"
      FROM mail_account_access_rules rule
      JOIN users u ON u.id = $1 AND u."isActive" AND u."deletedAt" IS NULL
      WHERE
        (
          rule."medCenterId" IS NULL
          OR EXISTS (
            SELECT 1 FROM user_med_centers umc
            WHERE umc."userId" = u.id AND umc."medCenterId" = rule."medCenterId"
          )
        )
        AND (
          rule."roleId" IS NULL
          OR u."roleId" = rule."roleId"
          OR EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur."userId" = u.id AND ur."roleId" = rule."roleId"
          )
        )
    )
    SELECT grants."accountId",
           BOOL_OR(grants."canSend") AS "canSend",
           BOOL_OR(grants."canDelete") AS "canDelete",
           BOOL_OR(grants."isDefault") AS "isDefault"
    FROM grants
    WHERE TRUE ${accountFilter}
    GROUP BY grants."accountId"
  `, { bind });

  return rows;
}

/** Ящики, к которым у человека есть доступ, вместе с итоговыми правами. */
async function accessibleAccounts(userId) {
  const grants = await resolvedGrants(userId);
  if (!grants.length) return [];

  const rightsByAccount = new Map(grants.map((row) => [row.accountId, row]));
  const accounts = await MailAccount.findAll({
    where: { id: grants.map((row) => row.accountId), isActive: true },
    include: [{
      model: MedCenter,
      as: 'medCenter',
      attributes: ['id', 'name', 'displayName', 'color', 'logoUrl', 'logoSquareUrl'],
      required: false,
    }],
  });

  return accounts
    .map((account) => {
      const rights = rightsByAccount.get(account.id);
      return {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        medCenter: account.medCenter ? {
          id: account.medCenter.id,
          name: account.medCenter.name,
          displayName: account.medCenter.displayName,
          color: account.medCenter.color,
          logoUrl: account.medCenter.logoSquareUrl || account.medCenter.logoUrl || null,
        } : null,
        syncState: account.syncState,
        canSend: Boolean(rights.canSend),
        canDelete: Boolean(rights.canDelete),
        isDefault: Boolean(rights.isDefault),
        sortOrder: account.sortOrder,
      };
    })
    .sort((a, b) => (a.sortOrder - b.sortOrder) || a.email.localeCompare(b.email, 'ru'));
}

/** Идентификаторы доступных ящиков — для запросов «искать во всех моих». */
async function accessibleAccountIds(userId) {
  const grants = await resolvedGrants(userId);
  return grants.map((row) => row.accountId);
}

/** Итоговые права на конкретный ящик либо null, если ни одно правило не подошло. */
async function accessTo(userId, accountId) {
  const [rights] = await resolvedGrants(userId, accountId);
  if (!rights) return null;
  return {
    canRead: true,
    canSend: Boolean(rights.canSend),
    canDelete: Boolean(rights.canDelete),
  };
}

module.exports = { accessibleAccounts, accessibleAccountIds, accessTo, resolvedGrants };
