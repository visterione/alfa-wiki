'use strict';

/**
 * Состав открытой линии по правилам (ver. 9.09).
 *
 * Правило — это роль, медцентр или их пересечение: «Сотрудник колл-центра»,
 * «все сотрудники Альфы» или «сотрудник колл-центра И Альфа». Условия правила
 * складываются через И, несколько правил одной линии — через ИЛИ. Устроено так
 * же, как групповой доступ к почте (services/mail/access.js), и роль ищется в
 * тех же двух местах: в связи user_roles и в старом users.roleId, — сотрудники
 * обоих поколений в портале ещё есть.
 *
 * ── Почему строки, а не проверка на лету ─────────────────────────────────────
 *
 * Почта проверяет правило при каждом обращении. Здесь так нельзя: на строке
 * состава живут смена и старшинство, и её читают распределение обращений,
 * передача чата, события сокета и KPI. Поэтому правило разворачивается в
 * обычные строки omni_line_operators с пометкой viaRule, и всё остальное в
 * модуле о правилах не знает.
 *
 * Цена — синхронизация. Её зовут везде, где меняется то, от чего зависит
 * правило: сами правила, роли и медцентры сотрудника, его увольнение и
 * возвращение, удаление роли. Других мест, где пишутся user_roles и
 * user_med_centers, в проекте нет (routes/users.js); появится новое — ему тоже
 * нужен syncUsers.
 *
 * ── Исключения (ver. 9.23) ───────────────────────────────────────────────────
 *
 * Правило проходит мимо исключённого из линии: его строку синхронизация уберёт
 * и больше не заведёт. Нужно для широких правил, под которые попадают люди, на
 * линии не работающие, — администраторы со всеми ролями.
 *
 * ── Что правило не трогает ───────────────────────────────────────────────────
 *
 * Ручные строки (viaRule = false). Заведённого руками правило не уберёт, даже
 * если он под него не подходит: ручное добавление — отдельное решение
 * администратора, и отменять его должен он же. Если ручной сотрудник подходит и
 * под правило, при снятии «руками» строка не удаляется, а переходит на правило.
 */

const { sequelize, OmniLineOperator } = require('../models');

// Одно условие для всех запросов: правило совпало с активным сотрудником.
//
// Исключённого из линии (ver. 9.23) правило обходит: иначе снять с линии
// администратора, подходящего под «все роли», было бы нельзя — правило
// возвращало бы его при каждой синхронизации.
const RULE_MATCHES_USER = `
  u."isActive" AND u."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM omni_line_exclusions ex
    WHERE ex."lineId" = rule."lineId" AND ex."userId" = u.id
  )
  AND (
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
`;

const uniq = (list) => [...new Set((Array.isArray(list) ? list : [list]).filter(Boolean).map(String))];
const pairKey = (lineId, userId) => `${lineId}|${userId}`;

/** Пары «линия — сотрудник», которые требуют правила, в пределах отбора. */
async function wantedPairs({ lineIds, userIds }, transaction) {
  const where = [];
  const bind = [];
  if (lineIds) { bind.push(lineIds); where.push(`rule."lineId" = ANY($${bind.length}::uuid[])`); }
  if (userIds) { bind.push(userIds); where.push(`u.id = ANY($${bind.length}::uuid[])`); }

  const [rows] = await sequelize.query(`
    SELECT DISTINCT rule."lineId", u.id AS "userId"
    FROM omni_line_access_rules rule
    JOIN users u ON ${RULE_MATCHES_USER}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
  `, { bind, transaction });
  return rows;
}

/**
 * Раздел открывается отдельным флагом adminAccess.openLine, а смысл правила в
 * том, чтобы новому сотруднику ничего не приходилось настраивать руками. Флаг
 * ставится один раз — в момент, когда правило заводит человека в линию, — и
 * дальше правилами не трогается: если администратор потом снимет его в
 * карточке, правило при следующей синхронизации не станет спорить.
 */
async function openSectionFor(userIds, transaction) {
  if (!userIds.length) return;
  await sequelize.query(`
    UPDATE users
    SET "adminAccess" = COALESCE("adminAccess", '{}'::jsonb) || '{"openLine": true}'::jsonb
    WHERE id = ANY($1::uuid[])
      AND NOT COALESCE("isAdmin", false)
      AND COALESCE("adminAccess"->>'openLine', 'false') <> 'true'
  `, { bind: [userIds], transaction });
}

/**
 * Приводит строки viaRule в соответствие с правилами в пределах отбора: по
 * линиям, по сотрудникам или целиком (без аргументов). Возвращает, сколько
 * строк добавлено и убрано.
 */
async function sync({ lineIds, userIds } = {}) {
  const scope = {
    lineIds: lineIds ? uniq(lineIds) : null,
    userIds: userIds ? uniq(userIds) : null
  };
  if ((scope.lineIds && !scope.lineIds.length) || (scope.userIds && !scope.userIds.length)) {
    return { added: 0, removed: 0 };
  }

  return sequelize.transaction(async (transaction) => {
    const wanted = await wantedPairs(scope, transaction);
    const wantedKeys = new Set(wanted.map(p => pairKey(p.lineId, p.userId)));

    const where = {};
    if (scope.lineIds) where.lineId = scope.lineIds;
    if (scope.userIds) where.userId = scope.userIds;
    const existing = await OmniLineOperator.findAll({
      where, attributes: ['id', 'lineId', 'userId', 'viaRule'], transaction
    });
    const existingKeys = new Set(existing.map(o => pairKey(o.lineId, o.userId)));

    const toAdd = wanted.filter(p => !existingKeys.has(pairKey(p.lineId, p.userId)));
    const toRemove = existing.filter(o => o.viaRule && !wantedKeys.has(pairKey(o.lineId, o.userId)));

    if (toAdd.length) {
      // ignoreDuplicates: ручное добавление того же человека могло успеть
      // между чтением и записью — уникальный индекс (lineId, userId) рассудит.
      await OmniLineOperator.bulkCreate(
        toAdd.map(p => ({ lineId: p.lineId, userId: p.userId, viaRule: true })),
        { ignoreDuplicates: true, transaction }
      );
      await openSectionFor(uniq(toAdd.map(p => p.userId)), transaction);
    }
    if (toRemove.length) {
      await OmniLineOperator.destroy({ where: { id: toRemove.map(o => o.id) }, transaction });
    }

    return { added: toAdd.length, removed: toRemove.length };
  });
}

const syncLine = (lineId) => sync({ lineIds: [lineId] });
const syncUsers = (userIds) => sync({ userIds: uniq(userIds) });

/**
 * Синхронизация по следам чужой правки: карточки сотрудника, удаления роли или
 * медцентра. Сохранение из-за неё падать не должно — сама правка важнее, а
 * состав догонится при следующей. Ошибку оставляем в логе.
 *
 * Без userIds пересчитывается всё: удаление роли или медцентра каскадом
 * забирает и правила, и связи сотрудников, и точечно пересчитать уже нечего.
 */
async function syncQuietly(userIds, where) {
  try {
    const result = userIds ? await syncUsers(userIds) : await sync();
    if (result.added || result.removed) {
      console.log(`[open-line] состав по правилам (${where}): +${result.added} −${result.removed}`);
    }
  } catch (err) {
    console.error(`[open-line] состав по правилам не пересчитан (${where}):`, err);
  }
}

/** Подходит ли сотрудник под какое-нибудь правило линии. */
async function matchesLine(lineId, userId) {
  const rows = await wantedPairs({ lineIds: [lineId], userIds: [userId] });
  return rows.length > 0;
}

/**
 * Сколько людей под каждым правилом. Число полезнее абстрактного «роль +
 * медцентр»: пустое пересечение видно сразу, а не через неделю, когда
 * выяснится, что в линию так никто и не попал.
 */
async function matchedCounts() {
  const [rows] = await sequelize.query(`
    SELECT rule.id, COUNT(u.id)::int AS count
    FROM omni_line_access_rules rule
    LEFT JOIN users u ON ${RULE_MATCHES_USER}
    GROUP BY rule.id
  `);
  return new Map(rows.map(r => [r.id, Number(r.count)]));
}

module.exports = { sync, syncLine, syncUsers, syncQuietly, matchesLine, matchedCounts };
