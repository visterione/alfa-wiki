import React from 'react';
import { BadgeCheck, Building2, Crown, Headphones, HeartPulse, ShieldCheck, Star, Stethoscope } from 'lucide-react';
import { BASE_URL } from '../../services/api';

const ICONS = { BadgeCheck, Building2, Crown, Headphones, HeartPulse, ShieldCheck, Star, Stethoscope };

const imageUrl = (value) => {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${BASE_URL}/${value.replace(/^\/+/, '')}`;
};

export default function UserBadge({ badge, size = 16, className = '' }) {
  if (!badge?.value) return null;
  const title = badge.label || 'Метка сотрудника';

  if (badge.type === 'image') {
    return <img className={className} src={imageUrl(badge.value)} alt={title} title={title} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  if (badge.type === 'emoji') {
    return <span className={className} title={title} aria-label={title} style={{ fontSize: size, lineHeight: 1, flexShrink: 0 }}>{badge.value}</span>;
  }

  const Icon = ICONS[badge.value] || BadgeCheck;
  return <Icon className={className} size={size} color={badge.color || '#2563eb'} title={title} aria-label={title} style={{ flexShrink: 0 }} />;
}

export const CHAT_BADGE_ICONS = Object.keys(ICONS);
