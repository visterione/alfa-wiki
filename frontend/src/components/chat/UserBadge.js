import React from 'react';
import { BadgeCheck } from 'lucide-react';
import { CHAT_BADGE_ICON_MAP, CHAT_BADGE_ICON_LABELS, DEFAULT_BADGE_COLOR } from './badgeIcons';

// Метка сотрудника рядом с именем. Значение приходит из users.chatBadge —
// это уже вычисленная бэкендом метка (иконка от роли, цвет от клиники,
// плюс ручные переопределения из карточки пользователя).
export default function UserBadge({ badge, size = 16, className = '' }) {
  if (!badge?.value) return null;

  const Icon = CHAT_BADGE_ICON_MAP[badge.value] || BadgeCheck;
  const title = badge.label || CHAT_BADGE_ICON_LABELS[badge.value] || 'Метка сотрудника';

  return (
    <Icon
      className={className}
      size={size}
      color={badge.color || DEFAULT_BADGE_COLOR}
      title={title}
      aria-label={title}
      style={{ flexShrink: 0 }}
    />
  );
}

export { CHAT_BADGE_ICONS, CHAT_BADGE_ICON_LABELS, CHAT_BADGE_ICON_GROUPS, DEFAULT_BADGE_COLOR } from './badgeIcons';
