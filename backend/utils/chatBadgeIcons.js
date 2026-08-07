'use strict';

// Допустимые имена иконок для метки сотрудника в чатах.
// Зеркало frontend/src/components/chat/badgeIcons.js — используется только
// для валидации приходящих значений. При добавлении иконки правим оба файла.
const CHAT_BADGE_ICONS = [
  // Медицина
  'Stethoscope', 'HeartPulse', 'Syringe', 'Pill', 'Microscope', 'FlaskConical',
  'Beaker', 'Dna', 'Brain', 'Bone', 'Eye', 'Ear', 'Thermometer', 'Activity',
  'ScanLine', 'Cross', 'Baby', 'Heart', 'Droplet', 'Siren',
  // Статус и руководство
  'Crown', 'Trophy', 'Star', 'Sparkles', 'Gem', 'BadgeCheck', 'ShieldCheck',
  'Shield', 'Target', 'Rocket', 'Flame', 'Zap',
  // Администрация и финансы
  'Briefcase', 'ClipboardList', 'CalendarDays', 'Calculator', 'Wallet',
  'CreditCard', 'Percent', 'Scale', 'Gavel', 'Landmark', 'Printer', 'BookOpen',
  'GraduationCap', 'Key', 'Settings', 'UserCog', 'Users',
  // Приём и связь
  'Headphones', 'Phone', 'PhoneCall', 'Megaphone', 'Speech', 'Send', 'Smile',
  'LifeBuoy', 'Globe',
  // IT и техника
  'Laptop', 'Monitor', 'Cpu', 'Database', 'Bot', 'Wrench', 'Hammer', 'Camera',
  'PenTool', 'Palette', 'Lightbulb',
  // Прочее
  'Building2', 'ShoppingCart', 'Truck', 'Leaf', 'Scissors'
];

const CHAT_BADGE_ICON_SET = new Set(CHAT_BADGE_ICONS);

const isValidBadgeIcon = (name) => typeof name === 'string' && CHAT_BADGE_ICON_SET.has(name);

const isValidBadgeColor = (color) => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color);

const DEFAULT_BADGE_COLOR = '#94a3b8';

module.exports = { CHAT_BADGE_ICONS, isValidBadgeIcon, isValidBadgeColor, DEFAULT_BADGE_COLOR };
