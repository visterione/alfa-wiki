'use strict';

// Чистая логика метки сотрудника в чатах — без обращений к базе,
// чтобы правила выбора иконки и цвета можно было проверить тестом.
// Работу с БД и материализацию результата делает services/userChatBadge.js.

const { isValidBadgeIcon, isValidBadgeColor, DEFAULT_BADGE_COLOR } = require('./chatBadgeIcons');

/**
 * Приводит присланный админкой override к безопасному виду.
 * Пустой override (ничего не переопределено) — это null.
 */
function normalizeBadgeOverride(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const result = {};
  if (isValidBadgeIcon(raw.value)) result.value = raw.value;
  if (isValidBadgeColor(raw.color)) result.color = raw.color;

  const label = String(raw.label || '').trim().slice(0, 80);
  if (label) result.label = label;

  return Object.keys(result).length ? result : null;
}

// Иконку даёт роль с наибольшим приоритетом; при равенстве — первая по алфавиту,
// чтобы результат не зависел от порядка выдачи из базы.
function pickRole(roles) {
  return (roles || [])
    .filter(role => isValidBadgeIcon(role.chatBadgeIcon))
    .sort((a, b) =>
      (b.badgePriority || 0) - (a.badgePriority || 0) ||
      String(a.name).localeCompare(String(b.name), 'ru')
    )[0] || null;
}

// Цвет — от клиники с наименьшим sortOrder среди привязанных.
function pickMedCenter(medCenters) {
  return (medCenters || [])
    .filter(mc => isValidBadgeColor(mc.color))
    .sort((a, b) =>
      (a.sortOrder ?? 100) - (b.sortOrder ?? 100) ||
      String(a.name).localeCompare(String(b.name), 'ru')
    )[0] || null;
}

/**
 * Считает метку для пользователя с подгруженными roles и medCenters.
 * Возвращает { type, value, color, label } либо null, если иконки нет.
 */
function resolveBadge(user) {
  const override = normalizeBadgeOverride(user.chatBadgeOverride);
  const role = pickRole(user.roles);

  const value = override?.value || role?.chatBadgeIcon || null;
  if (!value) return null;

  const medCenter = pickMedCenter(user.medCenters);

  // Подпись роли подходит только если иконка пришла от неё же —
  // иначе к вручную выбранной иконке прилипнет чужой tooltip.
  const roleLabel = !override?.value && role?.chatBadgeLabel ? role.chatBadgeLabel : '';

  return {
    type: 'icon',
    value,
    color: override?.color || medCenter?.color || DEFAULT_BADGE_COLOR,
    label: override?.label || roleLabel || ''
  };
}

const sameBadge = (a, b) =>
  (a?.value || null) === (b?.value || null) &&
  (a?.color || null) === (b?.color || null) &&
  (a?.label || '') === (b?.label || '');

module.exports = { normalizeBadgeOverride, pickRole, pickMedCenter, resolveBadge, sameBadge };
