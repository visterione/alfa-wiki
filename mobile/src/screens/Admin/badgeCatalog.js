/**
 * Каталог меток сотрудника в чатах — зеркало
 * frontend/src/components/chat/badgeIcons.js.
 *
 * Здесь только имена и подписи: сами компоненты иконок уже собраны в
 * components/UserBadge.js (BADGE_ICONS), и второй такой же список импортов
 * означал бы, что иконку, добавленную в одном файле, метка нарисует, а
 * выбиралка — нет.
 *
 * Группы нужны только для выбора: в БД лежит имя иконки, и к какой группе оно
 * относится, никого не касается.
 */

export const BADGE_GROUPS = [
  {
    title: 'Медицина',
    icons: [
      ['Stethoscope', 'Врач'],
      ['HeartPulse', 'Кардио'],
      ['Syringe', 'Процедурный'],
      ['Pill', 'Фармация'],
      ['Microscope', 'Лаборатория'],
      ['FlaskConical', 'Анализы'],
      ['Beaker', 'Забор материала'],
      ['Dna', 'Генетика'],
      ['Brain', 'Неврология'],
      ['Bone', 'Травматология'],
      ['Eye', 'Офтальмология'],
      ['Ear', 'ЛОР'],
      ['Thermometer', 'Терапия'],
      ['Activity', 'Функц. диагностика'],
      ['ScanLine', 'УЗИ / лучевая'],
      ['Cross', 'Медпомощь'],
      ['Baby', 'Педиатрия'],
      ['Heart', 'Забота'],
      ['Droplet', 'Кровь'],
      ['Siren', 'Неотложная'],
    ],
  },
  {
    title: 'Статус и руководство',
    icons: [
      ['Crown', 'Руководитель'],
      ['Trophy', 'Лучший сотрудник'],
      ['Star', 'Особая отметка'],
      ['Sparkles', 'Наставник'],
      ['Gem', 'Эксперт'],
      ['BadgeCheck', 'Подтверждён'],
      ['ShieldCheck', 'Ответственный'],
      ['Shield', 'Безопасность'],
      ['Target', 'Цели / KPI'],
      ['Rocket', 'Развитие'],
      ['Flame', 'Мотивация'],
      ['Zap', 'Быстрая реакция'],
    ],
  },
  {
    title: 'Администрация и финансы',
    icons: [
      ['Briefcase', 'Управление'],
      ['ClipboardList', 'Регистратура'],
      ['CalendarDays', 'Расписание'],
      ['Calculator', 'Расчёты'],
      ['Wallet', 'Зарплата'],
      ['CreditCard', 'Касса'],
      ['Percent', 'Акции и скидки'],
      ['Scale', 'Юрист'],
      ['Gavel', 'Комплаенс'],
      ['Landmark', 'Бухгалтерия'],
      ['Printer', 'Документооборот'],
      ['BookOpen', 'База знаний'],
      ['GraduationCap', 'Обучение'],
      ['Key', 'Доступы'],
      ['Settings', 'Настройки'],
      ['UserCog', 'Кадры'],
      ['Users', 'Команда'],
    ],
  },
  {
    title: 'Приём и связь',
    icons: [
      ['Headphones', 'Call-центр'],
      ['Phone', 'Телефония'],
      ['PhoneCall', 'Обзвон'],
      ['Megaphone', 'Маркетинг'],
      ['Speech', 'Отзывы'],
      ['Send', 'Рассылки'],
      ['Smile', 'Сервис'],
      ['LifeBuoy', 'Поддержка'],
      ['Globe', 'Сайт'],
    ],
  },
  {
    title: 'IT и техника',
    icons: [
      ['Laptop', 'IT-отдел'],
      ['Monitor', 'Системный админ'],
      ['Cpu', 'Оборудование'],
      ['Database', 'Данные'],
      ['Bot', 'Бот'],
      ['Wrench', 'Техподдержка'],
      ['Hammer', 'Хозслужба'],
      ['Camera', 'Фото / контент'],
      ['PenTool', 'Дизайн'],
      ['Palette', 'Бренд'],
      ['Lightbulb', 'Идеи'],
    ],
  },
  {
    title: 'Прочее',
    icons: [
      ['Building2', 'Клиника'],
      ['ShoppingCart', 'Закупки'],
      ['Truck', 'Логистика'],
      ['Leaf', 'Экология'],
      ['Scissors', 'Косметология'],
    ],
  },
];

export const BADGE_LABELS = BADGE_GROUPS.reduce((acc, group) => {
  group.icons.forEach(([name, label]) => { acc[name] = label; });
  return acc;
}, {});

export const DEFAULT_BADGE_COLOR = '#94a3b8';

/**
 * Иконку метки даёт самая приоритетная роль, цвет — самая приоритетная клиника.
 * Повторяет backend/utils/resolveChatBadge.js: считать метку заранее нужно,
 * чтобы админ видел её ещё в момент переключения ролей, до сохранения.
 */
export const autoBadgeRole = roles => roles
  .filter(role => role.chatBadgeIcon)
  .sort((a, b) => (b.badgePriority || 0) - (a.badgePriority || 0)
    || String(a.name).localeCompare(String(b.name), 'ru'))[0] || null;

export const autoBadgeMedCenter = medCenters => medCenters
  .filter(mc => mc.color)
  .sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100)
    || String(a.name).localeCompare(String(b.name), 'ru'))[0] || null;
