// Реестр иконок для метки сотрудника в чатах.
// Группы нужны только для визуального выбора в админке — на рендер метки
// они не влияют, значение в БД это всегда имя иконки из CHAT_BADGE_ICONS.
//
// Список имён продублирован на бэкенде (backend/utils/chatBadgeIcons.js) —
// там он используется для валидации. При добавлении иконки правим оба файла.
import {
  Activity, Baby, BadgeCheck, Beaker, Bone, BookOpen, Bot, Brain, Briefcase,
  Building2, Calculator, CalendarDays, Camera, ClipboardList, Cpu, CreditCard,
  Cross, Crown, Database, Dna, Droplet, Ear, Eye, Flame, FlaskConical, Gavel,
  Gem, Globe, GraduationCap, Hammer, Headphones, Heart, HeartPulse, Key,
  Landmark, Laptop, Leaf, LifeBuoy, Lightbulb, Megaphone, Microscope, Monitor,
  Palette, PenTool, Percent, Phone, PhoneCall, Pill, Printer, Rocket, Scale,
  ScanLine, Scissors, Send, Settings, Shield, ShieldCheck, ShoppingCart, Siren,
  Smile, Sparkles, Speech, Star, Stethoscope, Syringe, Target, Thermometer,
  Trophy, Truck, UserCog, Users, Wallet, Wrench, Zap
} from 'lucide-react';

export const CHAT_BADGE_ICON_GROUPS = [
  {
    title: 'Медицина',
    icons: [
      ['Stethoscope', 'Врач', Stethoscope],
      ['HeartPulse', 'Кардио', HeartPulse],
      ['Syringe', 'Процедурный', Syringe],
      ['Pill', 'Фармация', Pill],
      ['Microscope', 'Лаборатория', Microscope],
      ['FlaskConical', 'Анализы', FlaskConical],
      ['Beaker', 'Забор материала', Beaker],
      ['Dna', 'Генетика', Dna],
      ['Brain', 'Неврология', Brain],
      ['Bone', 'Травматология', Bone],
      ['Eye', 'Офтальмология', Eye],
      ['Ear', 'ЛОР', Ear],
      ['Thermometer', 'Терапия', Thermometer],
      ['Activity', 'Функц. диагностика', Activity],
      ['ScanLine', 'УЗИ / лучевая', ScanLine],
      ['Cross', 'Медпомощь', Cross],
      ['Baby', 'Педиатрия', Baby],
      ['Heart', 'Забота', Heart],
      ['Droplet', 'Кровь', Droplet],
      ['Siren', 'Неотложная', Siren]
    ]
  },
  {
    title: 'Статус и руководство',
    icons: [
      ['Crown', 'Руководитель', Crown],
      ['Trophy', 'Лучший сотрудник', Trophy],
      ['Star', 'Особая отметка', Star],
      ['Sparkles', 'Наставник', Sparkles],
      ['Gem', 'Эксперт', Gem],
      ['BadgeCheck', 'Подтверждён', BadgeCheck],
      ['ShieldCheck', 'Ответственный', ShieldCheck],
      ['Shield', 'Безопасность', Shield],
      ['Target', 'Цели / KPI', Target],
      ['Rocket', 'Развитие', Rocket],
      ['Flame', 'Мотивация', Flame],
      ['Zap', 'Быстрая реакция', Zap]
    ]
  },
  {
    title: 'Администрация и финансы',
    icons: [
      ['Briefcase', 'Управление', Briefcase],
      ['ClipboardList', 'Регистратура', ClipboardList],
      ['CalendarDays', 'Расписание', CalendarDays],
      ['Calculator', 'Расчёты', Calculator],
      ['Wallet', 'Зарплата', Wallet],
      ['CreditCard', 'Касса', CreditCard],
      ['Percent', 'Акции и скидки', Percent],
      ['Scale', 'Юрист', Scale],
      ['Gavel', 'Комплаенс', Gavel],
      ['Landmark', 'Бухгалтерия', Landmark],
      ['Printer', 'Документооборот', Printer],
      ['BookOpen', 'База знаний', BookOpen],
      ['GraduationCap', 'Обучение', GraduationCap],
      ['Key', 'Доступы', Key],
      ['Settings', 'Настройки', Settings],
      ['UserCog', 'Кадры', UserCog],
      ['Users', 'Команда', Users]
    ]
  },
  {
    title: 'Приём и связь',
    icons: [
      ['Headphones', 'Call-центр', Headphones],
      ['Phone', 'Телефония', Phone],
      ['PhoneCall', 'Обзвон', PhoneCall],
      ['Megaphone', 'Маркетинг', Megaphone],
      ['Speech', 'Отзывы', Speech],
      ['Send', 'Рассылки', Send],
      ['Smile', 'Сервис', Smile],
      ['LifeBuoy', 'Поддержка', LifeBuoy],
      ['Globe', 'Сайт', Globe]
    ]
  },
  {
    title: 'IT и техника',
    icons: [
      ['Laptop', 'IT-отдел', Laptop],
      ['Monitor', 'Системный админ', Monitor],
      ['Cpu', 'Оборудование', Cpu],
      ['Database', 'Данные', Database],
      ['Bot', 'Бот', Bot],
      ['Wrench', 'Техподдержка', Wrench],
      ['Hammer', 'Хозслужба', Hammer],
      ['Camera', 'Фото / контент', Camera],
      ['PenTool', 'Дизайн', PenTool],
      ['Palette', 'Бренд', Palette],
      ['Lightbulb', 'Идеи', Lightbulb]
    ]
  },
  {
    title: 'Прочее',
    icons: [
      ['Building2', 'Клиника', Building2],
      ['ShoppingCart', 'Закупки', ShoppingCart],
      ['Truck', 'Логистика', Truck],
      ['Leaf', 'Экология', Leaf],
      ['Scissors', 'Косметология', Scissors]
    ]
  }
];

// name -> React-компонент
export const CHAT_BADGE_ICON_MAP = CHAT_BADGE_ICON_GROUPS.reduce((acc, group) => {
  group.icons.forEach(([name, , Component]) => { acc[name] = Component; });
  return acc;
}, {});

// name -> человекочитаемая подпись (подставляется в tooltip, если своя не задана)
export const CHAT_BADGE_ICON_LABELS = CHAT_BADGE_ICON_GROUPS.reduce((acc, group) => {
  group.icons.forEach(([name, label]) => { acc[name] = label; });
  return acc;
}, {});

export const CHAT_BADGE_ICONS = Object.keys(CHAT_BADGE_ICON_MAP);

export const DEFAULT_BADGE_COLOR = '#94a3b8';
