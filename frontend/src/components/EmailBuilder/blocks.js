/**
 * Описание блоков конструктора писем (ver. 8.43).
 *
 * Блок описан данными, а не кодом: что он такое, с чем рождается и какие у него
 * свойства. Из одного этого описания строится и палитра слева, и панель свойств
 * справа, поэтому новый блок — это запись здесь плюс отрисовка в BlockView и
 * рендер в backend/services/emailRenderer.js. Три места вместо десяти.
 *
 * Имена свойств совпадают с теми, что читает рендерер на сервере. Это не
 * случайность и не совпадение: документ письма — общий язык между конструктором
 * и рендерером, и расходиться им негде.
 */

import {
  Type, Image as ImageIcon, MousePointerClick, Minus,
  MoveVertical, Columns2, Code2, Flag, BadgePercent,
  ListChecks, Share2, MapPin, PanelTop, WrapText, Sparkle, MailX
} from 'lucide-react';

/** Отступы по умолчанию. Боковые 24px совпадают с полями карточки письма. */
const PAD = { top: 12, right: 24, bottom: 12, left: 24 };

/**
 * Свой идентификатор у каждого блока.
 *
 * Нужен не документу, а React: по нему строятся ключи списка и адреса
 * перетаскивания. Пока ключом был индекс, вставка блока в середину письма
 * заставляла React переиспользовать поддерево соседа под другой блок — и
 * TipTap, который в этот момент сносил свой DOM сам, оставлял React узел,
 * которого уже нет. Наружу это выходило ошибкой «The object can not be found
 * here» при добавлении блока из палитры.
 *
 * randomUUID есть во всех браузерах, где работает портал, но на http с
 * чужого адреса (не localhost) его нет — отсюда запасной вариант.
 */
export const newId = () => (
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
);

/**
 * Проставляет недостающие идентификаторы по всему документу.
 *
 * Письма и шаблоны, сохранённые до этой правки, лежат в базе без них, и заново
 * их никто не пересобирает. Поэтому документ нормализуется при открытии, а не
 * при создании.
 */
export const withIds = (design) => {
  if (!design || typeof design !== 'object') return design;

  const walk = (list) => (Array.isArray(list) ? list : []).map((block) => {
    if (!block || typeof block !== 'object') return block;
    const next = block.id ? block : { ...block, id: newId() };
    if (next.type !== 'columns') return next;
    return {
      ...next,
      columns: (next.columns || []).map(col => ({ ...col, blocks: walk(col.blocks) })),
    };
  });

  const result = { ...design };
  if (Array.isArray(design.sections)) {
    result.sections = design.sections.map(section => ({
      ...section,
      id: section?.id || newId(),
      columns: (section?.columns || []).map(col => ({
        ...col,
        id: col?.id || newId(),
        blocks: walk(col?.blocks),
      })),
    }));
  }
  if (Array.isArray(design.blocks)) result.blocks = walk(design.blocks);
  return result;
};

export const BLOCK_TYPES = {
  text: {
    label: 'Текст',
    icon: Type,
    hint: 'Заголовок, абзац, список',
    create: () => ({ type: 'text', html: '<p>Расскажите, что нового.</p>', align: 'left', padding: { ...PAD } }),
    fields: [
      { key: 'font', label: 'Шрифт', type: 'font', placeholder: 'как в письме' },
      { key: 'fontSize', label: 'Размер', type: 'number', min: 10, max: 48, suffix: 'px', placeholder: 'как в письме' },
      { key: 'lineHeight', label: 'Межстрочный', type: 'number', min: 1, max: 3, step: 0.05, placeholder: 'как в письме' },
      { key: 'indent', label: 'Красная строка', type: 'number', min: 0, max: 60, suffix: 'px' },
      { key: 'color', label: 'Цвет текста', type: 'color', clearable: true },
      {
        key: 'textGradient',
        label: 'Градиент букв',
        type: 'gradient',
        hint: 'Работает в Apple Mail, на iPhone и в Gmail. Там, где не работает, останется обычный цвет текста — поэтому его стоит задать',
      },
      { key: 'align', label: 'Выравнивание', type: 'align' },
      { key: 'background', label: 'Фон блока', type: 'color', clearable: true },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
  },

  image: {
    label: 'Картинка',
    icon: ImageIcon,
    hint: 'Фото, баннер, логотип',
    create: () => ({ type: 'image', src: '', alt: '', width: 100, align: 'center', padding: { ...PAD } }),
    fields: [
      { key: 'src', label: 'Файл', type: 'image' },
      {
        key: 'alt',
        label: 'Подпись (alt)',
        type: 'text',
        placeholder: 'Что на картинке',
        // Не придирка к доступности: Gmail и Outlook по умолчанию не грузят
        // картинки, и без alt человек видит на её месте пустоту.
        hint: 'Показывается вместо картинки, пока она не загрузилась',
      },
      { key: 'href', label: 'Ссылка с картинки', type: 'link', placeholder: 'https://…' },
      { key: 'width', label: 'Ширина', type: 'slider', min: 10, max: 100, suffix: '%' },
      { key: 'shape', label: 'Форма', type: 'select', options: [['rect', 'Прямоугольник'], ['circle', 'Круг']] },
      { key: 'radius', label: 'Скругление', type: 'number', min: 0, max: 40, suffix: 'px', hint: 'Outlook покажет прямые углы' },
      { key: 'borderWidth', label: 'Рамка', type: 'number', min: 0, max: 12, suffix: 'px' },
      { key: 'borderColor', label: 'Цвет рамки', type: 'color', clearable: true },
      { key: 'align', label: 'Выравнивание', type: 'align', options: ['left', 'center', 'right'] },
      { key: 'background', label: 'Фон блока', type: 'color', clearable: true },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
  },

  button: {
    label: 'Кнопка',
    icon: MousePointerClick,
    hint: 'Записаться, узнать цену',
    create: () => ({ type: 'button', text: 'Записаться', href: '', align: 'center', padding: { top: 8, right: 24, bottom: 20, left: 24 } }),
    fields: [
      { key: 'text', label: 'Надпись', type: 'text', placeholder: 'Записаться' },
      { key: 'href', label: 'Ссылка', type: 'link', placeholder: 'https://…' },
      { key: 'bg', label: 'Цвет кнопки', type: 'color', clearable: true },
      { key: 'color', label: 'Цвет надписи', type: 'color', clearable: true },
      { key: 'radius', label: 'Скругление', type: 'number', min: 0, max: 30, suffix: 'px' },
      { key: 'font', label: 'Шрифт', type: 'font' },
      { key: 'fontSize', label: 'Размер текста', type: 'number', min: 12, max: 24, suffix: 'px' },
      { key: 'paddingX', label: 'Поля по бокам', type: 'number', min: 8, max: 60, suffix: 'px' },
      { key: 'paddingY', label: 'Поля сверху и снизу', type: 'number', min: 6, max: 30, suffix: 'px' },
      { key: 'align', label: 'Выравнивание', type: 'align', options: ['left', 'center', 'right'] },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
  },

  divider: {
    label: 'Разделитель',
    icon: Minus,
    hint: 'Линия между частями',
    create: () => ({ type: 'divider', color: '#E5E5EA', thickness: 1, width: 100, padding: { top: 8, right: 24, bottom: 8, left: 24 } }),
    fields: [
      { key: 'color', label: 'Цвет', type: 'color' },
      { key: 'thickness', label: 'Толщина', type: 'number', min: 1, max: 8, suffix: 'px' },
      { key: 'width', label: 'Длина', type: 'slider', min: 10, max: 100, suffix: '%' },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
  },

  spacer: {
    label: 'Отступ',
    icon: MoveVertical,
    hint: 'Пустое место',
    create: () => ({ type: 'spacer', height: 24 }),
    fields: [
      { key: 'height', label: 'Высота', type: 'slider', min: 4, max: 120, suffix: 'px' },
      { key: 'background', label: 'Фон', type: 'color', clearable: true },
    ],
  },

  header: {
    label: 'Шапка',
    icon: Flag,
    hint: 'Логотип и подпись',
    create: () => ({ type: 'header', src: '', logoWidth: 160, tagline: '', align: 'center', padding: { top: 28, right: 24, bottom: 20, left: 24 } }),
    fields: [
      { key: 'src', label: 'Логотип', type: 'image' },
      { key: 'logoWidth', label: 'Ширина логотипа', type: 'slider', min: 60, max: 400, suffix: 'px' },
      { key: 'tagline', label: 'Подпись под логотипом', type: 'text', placeholder: 'Сеть медцентров в Курске' },
      { key: 'color', label: 'Цвет текста', type: 'color', clearable: true, hint: 'Понадобится, когда блок стоит на тёмной полосе' },
      { key: 'align', label: 'Выравнивание', type: 'align', options: ['left', 'center', 'right'] },
      { key: 'background', label: 'Фон шапки', type: 'color', clearable: true },
      { key: 'font', label: 'Шрифт', type: 'font', placeholder: 'как в письме' },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
    note: 'Логотип лучше брать на непрозрачной подложке: тёмная тема Gmail подкладывает под картинку свой фон, и прозрачный логотип становится чёрным по чёрному.',
  },

  promo: {
    label: 'Карточка акции',
    icon: BadgePercent,
    hint: 'Картинка, цена, кнопка',
    create: () => ({
      type: 'promo',
      src: '',
      title: 'Скидка 20% на УЗИ',
      text: 'До конца месяца, по предварительной записи.',
      oldPrice: '',
      price: '',
      buttonText: 'Записаться',
      buttonHref: '',
      bg: '#F7F7FA',
      radius: 14,
      padding: { top: 8, right: 24, bottom: 8, left: 24 },
    }),
    fields: [
      { key: 'src', label: 'Картинка', type: 'image' },
      { key: 'alt', label: 'Подпись картинки (alt)', type: 'text', placeholder: 'Что на картинке' },
      { key: 'badge', label: 'Плашка', type: 'text', placeholder: '−20%', hint: 'Встанет над заголовком' },
      { key: 'badgeBg', label: 'Цвет плашки', type: 'color', clearable: true },
      { key: 'title', label: 'Заголовок', type: 'text' },
      { key: 'text', label: 'Описание', type: 'text' },
      { key: 'oldPrice', label: 'Старая цена', type: 'text', placeholder: '2 400 ₽', hint: 'Будет зачёркнута' },
      { key: 'price', label: 'Цена', type: 'text', placeholder: '1 900 ₽' },
      { key: 'color', label: 'Цвет текста', type: 'color', clearable: true, hint: 'Понадобится, когда блок стоит на тёмной полосе' },
      { key: 'mutedColor', label: 'Цвет пояснений', type: 'color', clearable: true },
      { key: 'priceColor', label: 'Цвет цены', type: 'color', clearable: true },
      { key: 'buttonText', label: 'Надпись на кнопке', type: 'text' },
      { key: 'buttonHref', label: 'Ссылка кнопки', type: 'link', placeholder: 'https://…' },
      { key: 'bg', label: 'Фон карточки', type: 'color' },
      { key: 'radius', label: 'Скругление', type: 'number', min: 0, max: 30, suffix: 'px' },
      { key: 'font', label: 'Шрифт', type: 'font', placeholder: 'как в письме' },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
  },

  services: {
    label: 'Список услуг',
    icon: ListChecks,
    hint: 'Название и цена в строку',
    create: () => ({
      type: 'services',
      items: [
        { name: 'Приём терапевта', note: 'первичный', price: '1 200 ₽' },
        { name: 'Общий анализ крови', note: '', price: '450 ₽' },
      ],
      padding: { top: 8, right: 24, bottom: 8, left: 24 },
    }),
    fields: [
      {
        key: 'items',
        label: 'Услуги',
        type: 'list',
        addLabel: 'Добавить услугу',
        newItem: () => ({ name: '', note: '', price: '' }),
        titleKey: 'name',
        itemFields: [
          { key: 'name', label: 'Название', type: 'text' },
          { key: 'note', label: 'Уточнение', type: 'text', placeholder: 'первичный, без контраста' },
          { key: 'price', label: 'Цена', type: 'text', placeholder: '1 200 ₽' },
        ],
      },
      { key: 'color', label: 'Цвет текста', type: 'color', clearable: true, hint: 'Понадобится, когда блок стоит на тёмной полосе' },
      { key: 'mutedColor', label: 'Цвет пояснений', type: 'color', clearable: true },
      { key: 'lineColor', label: 'Цвет линий', type: 'color', clearable: true },
      { key: 'font', label: 'Шрифт', type: 'font', placeholder: 'как в письме' },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
    note: 'Цена держится в своей колонке даже на телефоне: уехав под название, она перестаёт читаться как цена этой строки.',
  },

  social: {
    label: 'Соцсети',
    icon: Share2,
    hint: 'Кнопки на мессенджеры',
    create: () => ({
      type: 'social',
      align: 'center',
      items: [
        { network: 'telegram', href: '' },
        { network: 'whatsapp', href: '' },
      ],
      padding: { top: 12, right: 24, bottom: 12, left: 24 },
    }),
    fields: [
      {
        key: 'items',
        label: 'Ссылки',
        type: 'list',
        addLabel: 'Добавить ссылку',
        newItem: () => ({ network: 'telegram', href: '' }),
        titleKey: 'network',
        itemFields: [
          {
            key: 'network',
            label: 'Куда ведёт',
            type: 'select',
            options: [['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['vk', 'ВКонтакте'], ['site', 'Сайт'], ['phone', 'Позвонить']],
          },
          { key: 'href', label: 'Ссылка', type: 'link', placeholder: 'https://t.me/…' },
          { key: 'label', label: 'Своя надпись', type: 'text', placeholder: 'как у сети' },
        ],
      },
      { key: 'align', label: 'Выравнивание', type: 'align', options: ['left', 'center', 'right'] },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
    note: 'Плашки с надписями вместо иконок: картинки в письме по умолчанию не грузятся у половины клиентов, и вместо кружков человек увидит пустые рамки.',
  },

  contacts: {
    label: 'Контакты',
    icon: MapPin,
    hint: 'Адрес, телефон, часы',
    create: () => ({
      type: 'contacts',
      title: '',
      address: '',
      hours: '',
      phone: '',
      site: '',
      align: 'center',
      padding: { top: 16, right: 24, bottom: 16, left: 24 },
    }),
    fields: [
      { key: 'title', label: 'Заголовок', type: 'text', placeholder: 'Как нас найти' },
      { key: 'address', label: 'Адрес', type: 'text', placeholder: 'г. Курск, ул. Ленина, 1' },
      { key: 'hours', label: 'Часы работы', type: 'text', placeholder: 'Пн–Сб, 8:00–20:00' },
      { key: 'phone', label: 'Телефон', type: 'text', placeholder: '+7 (4712) 77-77-77', hint: 'С телефона по нему можно позвонить нажатием' },
      { key: 'site', label: 'Сайт', type: 'link', placeholder: 'alfa-clinic.ru' },
      { key: 'color', label: 'Цвет текста', type: 'color', clearable: true, hint: 'Понадобится, когда блок стоит на тёмной полосе' },
      { key: 'linkColor', label: 'Цвет телефона и ссылки', type: 'color', clearable: true },
      { key: 'align', label: 'Выравнивание', type: 'align', options: ['left', 'center', 'right'] },
      { key: 'background', label: 'Фон блока', type: 'color', clearable: true },
      { key: 'font', label: 'Шрифт', type: 'font', placeholder: 'как в письме' },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
  },

  hero: {
    label: 'Баннер',
    icon: PanelTop,
    hint: 'Текст поверх фото',
    create: () => ({
      type: 'hero',
      src: '',
      height: 260,
      overlay: 35,
      bg: '#1C1C1E',
      color: '#FFFFFF',
      title: 'Открыли новый медцентр',
      text: '',
      titleSize: 28,
      buttonText: '',
      buttonHref: '',
      align: 'center',
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    }),
    fields: [
      { key: 'src', label: 'Фотография', type: 'image' },
      { key: 'height', label: 'Высота', type: 'slider', min: 140, max: 480, suffix: 'px', hint: 'Outlook не умеет тянуться по содержимому — если текст не влезет, он вылезет за картинку' },
      { key: 'overlay', label: 'Затемнение фото', type: 'slider', min: 0, max: 80, suffix: '%' },
      {
        key: 'overlayStyle',
        label: 'Как затемнять',
        type: 'select',
        options: [['flat', 'Ровно по всей фотографии'], ['bottom', 'Растворяется кверху'], ['top', 'Растворяется книзу']],
        hint: 'Растворяющееся затемнение оставляет верх фотографии открытым, а текст внизу при этом читается',
      },
      { key: 'bg', label: 'Цвет под фото', type: 'color', hint: 'Его увидят те, у кого картинки не загрузились' },
      { key: 'title', label: 'Заголовок', type: 'text' },
      { key: 'font', label: 'Шрифт', type: 'font' },
      { key: 'titleSize', label: 'Размер заголовка', type: 'number', min: 16, max: 48, suffix: 'px' },
      { key: 'text', label: 'Подзаголовок', type: 'text' },
      { key: 'color', label: 'Цвет текста', type: 'color' },
      { key: 'textGradient', label: 'Градиент заголовка', type: 'gradient', hint: 'Там, где градиент букв не поддержан, останется цвет текста выше' },
      { key: 'buttonText', label: 'Надпись на кнопке', type: 'text' },
      { key: 'buttonHref', label: 'Ссылка кнопки', type: 'link', placeholder: 'https://…' },
      { key: 'align', label: 'Выравнивание', type: 'align', options: ['left', 'center', 'right'] },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
    note: 'Затемнения не будет в Outlook — полупрозрачный слой туда не ложится. Поэтому цвет под фото стоит брать тёмный.',
  },

  textimage: {
    label: 'Текст с картинкой',
    icon: WrapText,
    hint: 'Картинка сбоку, текст обтекает',
    create: () => ({
      type: 'textimage',
      src: '',
      alt: '',
      side: 'left',
      imageWidth: 200,
      gap: 16,
      html: '<p>Текст, который обтекает картинку сбоку.</p>',
      padding: { ...PAD },
    }),
    fields: [
      { key: 'src', label: 'Картинка', type: 'image' },
      { key: 'alt', label: 'Подпись (alt)', type: 'text', placeholder: 'Что на картинке' },
      { key: 'side', label: 'Сторона', type: 'select', options: [['left', 'Слева'], ['right', 'Справа']] },
      { key: 'imageWidth', label: 'Ширина картинки', type: 'slider', min: 80, max: 320, suffix: 'px' },
      { key: 'gap', label: 'Отступ от текста', type: 'number', min: 0, max: 40, suffix: 'px' },
      { key: 'radius', label: 'Скругление картинки', type: 'number', min: 0, max: 40, suffix: 'px' },
      { key: 'font', label: 'Шрифт', type: 'font', placeholder: 'как в письме' },
      { key: 'fontSize', label: 'Размер текста', type: 'number', min: 10, max: 32, suffix: 'px', placeholder: 'как в письме' },
      { key: 'indent', label: 'Красная строка', type: 'number', min: 0, max: 60, suffix: 'px' },
      { key: 'align', label: 'Выравнивание', type: 'align' },
      { key: 'color', label: 'Цвет текста', type: 'color', clearable: true },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
    note: 'На телефоне обтекание снимается и картинка встаёт во всю ширину: текст вокруг картинки в 200px на узком экране превращается в лесенку из двух слов.',
  },

  iconlist: {
    label: 'Пункты с иконками',
    icon: Sparkle,
    hint: 'Эмодзи или картинка + текст',
    create: () => ({
      type: 'iconlist',
      iconSize: 28,
      gap: 14,
      items: [
        { emoji: '🩺', title: 'Приём без очереди', text: 'По предварительной записи' },
        { emoji: '🧪', title: 'Анализы за сутки', text: 'Результат придёт на почту' },
      ],
      padding: { ...PAD },
    }),
    fields: [
      {
        key: 'items',
        label: 'Пункты',
        type: 'list',
        addLabel: 'Добавить пункт',
        newItem: () => ({ emoji: '✅', title: '', text: '' }),
        titleKey: 'title',
        itemFields: [
          { key: 'emoji', label: 'Эмодзи', type: 'emoji', hint: 'Видно всегда, даже когда картинки не загружены' },
          { key: 'image', label: 'Или картинка', type: 'image' },
          { key: 'title', label: 'Заголовок', type: 'text' },
          { key: 'text', label: 'Пояснение', type: 'text' },
        ],
      },
      { key: 'color', label: 'Цвет текста', type: 'color', clearable: true, hint: 'Понадобится, когда блок стоит на тёмной полосе' },
      { key: 'mutedColor', label: 'Цвет пояснений', type: 'color', clearable: true },
      { key: 'iconSize', label: 'Размер иконки', type: 'slider', min: 16, max: 64, suffix: 'px' },
      { key: 'gap', label: 'Между пунктами', type: 'number', min: 0, max: 40, suffix: 'px' },
      { key: 'font', label: 'Шрифт', type: 'font', placeholder: 'как в письме' },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
    note: 'Эмодзи надёжнее картинки: он виден всегда, потому что это текст. Картинку почтовый клиент может и не загрузить.',
  },

  unsubscribe: {
    label: 'Отписка',
    icon: MailX,
    hint: 'Подвал со ссылкой отписки',
    create: () => ({
      type: 'unsubscribe',
      html: '<p>Вы получили это письмо, потому что оставили адрес в медцентре «Альфа».</p>',
      linkText: 'Отписаться от рассылки',
      fontSize: 12,
      align: 'center',
      gap: 6,
      padding: { top: 16, right: 24, bottom: 28, left: 24 },
    }),
    fields: [
      { key: 'linkText', label: 'Надпись на ссылке', type: 'text', placeholder: 'Отписаться от рассылки' },
      { key: 'font', label: 'Шрифт', type: 'font', placeholder: 'как в письме' },
      { key: 'fontSize', label: 'Размер', type: 'number', min: 9, max: 18, suffix: 'px' },
      { key: 'color', label: 'Цвет текста', type: 'color', clearable: true },
      { key: 'linkColor', label: 'Цвет ссылки', type: 'color', clearable: true },
      { key: 'align', label: 'Выравнивание', type: 'align' },
      { key: 'gap', label: 'Отступ до ссылки', type: 'number', min: 0, max: 30, suffix: 'px' },
      { key: 'background', label: 'Фон блока', type: 'color', clearable: true },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
    note: 'Текст правится прямо на холсте. Ссылка ведёт на адрес отписки, у каждого получателя свой. Без этого блока рассылка на внешние адреса уходит в спам целиком.',
  },

  columns: {
    label: 'Колонки',
    icon: Columns2,
    hint: 'Два-три блока в ряд',
    create: () => ({
      type: 'columns',
      gap: 16,
      valign: 'top',
      padding: { top: 8, right: 24, bottom: 8, left: 24 },
      columns: [
        { width: 50, blocks: [{ type: 'text', html: '<p>Слева</p>', align: 'left', padding: { top: 0, right: 0, bottom: 0, left: 0 } }] },
        { width: 50, blocks: [{ type: 'text', html: '<p>Справа</p>', align: 'left', padding: { top: 0, right: 0, bottom: 0, left: 0 } }] },
      ],
    }),
    fields: [
      { key: 'columnCount', label: 'Сколько колонок', type: 'columnCount' },
      { key: 'columnWidths', label: 'Доли', type: 'columnWidths' },
      { key: 'gap', label: 'Промежуток', type: 'number', min: 0, max: 48, suffix: 'px' },
      {
        key: 'valign',
        label: 'Выравнивание по высоте',
        type: 'select',
        options: [['top', 'По верху'], ['middle', 'По центру'], ['bottom', 'По низу']],
      },
      { key: 'background', label: 'Фон блока', type: 'color', clearable: true },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
    // На телефоне колонки встают друг под друга — об этом лучше сказать вслух,
    // потому что на холсте этого не видно.
    note: 'На телефоне колонки встанут друг под друга. Outlook на Windows оставит их в ряд.',
  },

  html: {
    label: 'Свой код',
    icon: Code2,
    hint: 'Готовый кусок HTML',
    create: () => ({ type: 'html', code: '<!-- вставьте готовый HTML -->', padding: { top: 0, right: 0, bottom: 0, left: 0 } }),
    fields: [
      { key: 'code', label: 'HTML', type: 'code' },
      { key: 'padding', label: 'Отступы', type: 'padding' },
    ],
    note: 'Содержимое уходит в письмо как есть, без проверки. Пользуйтесь, когда нужного блока не хватает.',
  },
};

/**
 * ── Секции ───────────────────────────────────────────────────────────────────
 *
 * Письмо — это список секций: письмо → секция → колонка → блок. Та же модель,
 * что в рендерере (см. подробное объяснение там). Секция даёт то, чего не мог
 * плоский список блоков: полосу во всю ширину окна почты, внутри которой
 * содержимое остаётся в своих 600 пикселях.
 */

/** Готовые структуры для палитры. Доли нормализуются рендерером к 100. */
export const SECTION_PRESETS = [
  { id: '1', label: '1 колонка', widths: [100] },
  { id: '1-1', label: '2 колонки', widths: [50, 50] },
  { id: '1-2', label: '1 : 2', widths: [33, 67] },
  { id: '2-1', label: '2 : 1', widths: [67, 33] },
  { id: '1-1-1', label: '3 колонки', widths: [33, 33, 34] },
  { id: '1-1-1-1', label: '4 колонки', widths: [25, 25, 25, 25] },
];

export const createSection = (widths = [100]) => withIds({
  sections: [{
    type: 'section',
    gap: widths.length > 1 ? 16 : 0,
    valign: 'top',
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    columns: widths.map(width => ({ width, blocks: [] })),
  }],
}).sections[0];

/** Свойства секции. Содержимого у неё нет — только оформление и раскладка. */
export const SECTION_FIELDS = [
  { key: 'background', label: 'Фон полосы', type: 'color', clearable: true, hint: 'Во всю ширину окна почты — так делаются тёмные шапки и подвалы' },
  { key: 'gradient', label: 'Градиент полосы', type: 'gradient' },
  { key: 'innerBackground', label: 'Фон содержимого', type: 'color', clearable: true, hint: 'Только в пределах ширины письма' },
  { key: 'innerGradient', label: 'Градиент содержимого', type: 'gradient' },
  { key: 'columnCount', label: 'Сколько колонок', type: 'columnCount' },
  { key: 'columnWidths', label: 'Доли колонок', type: 'columnWidths' },
  { key: 'gap', label: 'Промежуток между колонками', type: 'number', min: 0, max: 48, suffix: 'px' },
  {
    key: 'valign',
    label: 'Выравнивание по высоте',
    type: 'select',
    options: [['top', 'По верху'], ['middle', 'По центру'], ['bottom', 'По низу']],
  },
  { key: 'card', label: 'Карточка вокруг содержимого', type: 'card' },
  { key: 'padding', label: 'Отступы секции', type: 'padding' },
];

/** Свойства отдельной колонки внутри секции. */
export const COLUMN_FIELDS = [
  { key: 'background', label: 'Фон колонки', type: 'color', clearable: true },
  { key: 'gradient', label: 'Градиент колонки', type: 'gradient' },
  {
    key: 'valign',
    label: 'Выравнивание по высоте',
    type: 'select',
    options: [['top', 'По верху'], ['middle', 'По центру'], ['bottom', 'По низу']],
  },
  { key: 'padding', label: 'Отступы колонки', type: 'padding' },
];

/**
 * Документ любой версии → документ второй версии.
 *
 * Повторяет toV2 из backend/services/emailRenderer.js слово в слово: письма,
 * собранные до появления секций, должны открываться и выглядеть как раньше и
 * на холсте, и в почте.
 */
export const toV2 = (design) => {
  const doc = design && typeof design === 'object' ? design : {};
  if (Array.isArray(doc.sections)) return doc;

  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
  const sections = blocks.map((block) => {
    if (block?.type === 'columns') {
      return {
        id: block.id,
        gap: block.gap,
        valign: block.valign,
        padding: block.padding,
        background: block.background,
        gradient: block.gradient,
        columns: (block.columns || []).map(col => ({ ...col, blocks: col.blocks || [] })),
      };
    }
    return {
      id: block?.id,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      columns: [{ width: 100, blocks: [block] }],
    };
  });

  const { blocks: _dropped, ...rest } = doc;
  return { ...rest, version: 2, sections };
};

/** Порядок в палитре — от того, что нужно всегда, к тому, что почти никогда. */
/**
 * Палитра блоков.
 *
 * Блока «Колонки» здесь больше нет: колонки теперь даёт структура секции, и
 * два способа сделать одно и то же путали бы. Сам тип остался в BLOCK_TYPES —
 * письма первой версии, где такой блок есть, должны открываться.
 */
export const PALETTE = [
  'header', 'hero', 'text', 'textimage', 'image', 'promo',
  'iconlist', 'services', 'button', 'social', 'contacts',
  'divider', 'spacer', 'unsubscribe', 'html',
];

/**
 * Оформление, доступное любому блоку.
 *
 * Приписывается к полям каждого блока, а не перечисляется в каждом описании:
 * градиент и карточка работают одинаково везде, и дублировать их в пятнадцати
 * местах значит однажды забыть в шестнадцатом.
 */
/**
 * Раскладка панели свойств по смысловым группам.
 *
 * Ключ поля → группа. Отдельной таблицей, а не пометкой в каждом описании, по
 * той же причине, по которой оформление не дублируется в блоках: полей под
 * сотню, и однажды в очередном блоке про пометку забудут, а поле молча уедет
 * не в ту секцию.
 *
 * Порядок групп неизменен: человек, открывший панель второй раз, должен найти
 * «Отступы» там же, где нашёл их в первый.
 */
export const GROUPS = [
  { key: 'content', label: 'Содержимое' },
  { key: 'text', label: 'Текст' },
  { key: 'style', label: 'Оформление' },
  { key: 'spacing', label: 'Отступы' },
];

const GROUP_BY_FIELD = {
  font: 'text', fontSize: 'text', lineHeight: 'text', color: 'text',
  textGradient: 'text', align: 'text', titleSize: 'text',
  mutedColor: 'text', linkColor: 'text', indent: 'text',
  footerColor: 'style', footerBg: 'style', footerSize: 'style',

  background: 'style', gradient: 'style', card: 'style', bg: 'style',
  innerBackground: 'style', innerGradient: 'style',
  radius: 'style', borderWidth: 'style', borderColor: 'style', shape: 'style',
  badgeBg: 'style', badgeColor: 'style', priceColor: 'style', buttonBg: 'style',
  lineColor: 'style', thickness: 'style', width: 'style', height: 'style',
  overlay: 'style', overlayStyle: 'style', imageWidth: 'style', logoWidth: 'style',
  iconSize: 'style', gap: 'style', valign: 'style', side: 'style',
  columnCount: 'style', columnWidths: 'style', paddingX: 'style', paddingY: 'style',

  padding: 'spacing',
};

export const groupOfField = (field) => field.group || GROUP_BY_FIELD[field.key] || 'content';

/**
 * Какие свойства блока считаются оформлением.
 *
 * Ровно те, что не лежат в группе «Содержимое»: шрифт, цвета, фон, рамки,
 * отступы. Отдельного списка нет намеренно — он разошёлся бы с раскладкой
 * панели при первом же новом поле, и «перенести оформление» начало бы
 * переносить заодно текст кнопки.
 */
export const styleKeysOf = (type) => {
  const def = BLOCK_TYPES[type];
  if (!def) return [];
  return def.fields.concat(DECOR_FIELDS)
    .filter(f => groupOfField(f) !== 'content')
    .map(f => f.key);
};

export const DECOR_FIELDS = [
  {
    key: 'gradient',
    label: 'Градиент фона',
    type: 'gradient',
    hint: 'Сколько угодно точек, прозрачность, линейный / радиальный / конический. Outlook покажет сплошной цвет — он не умеет градиенты. На кнопке и разделителе градиент доезжает и туда',
  },
  {
    key: 'card',
    label: 'Карточка вокруг блока',
    type: 'card',
    hint: 'Рамка, скругление и тень вокруг содержимого. Фон самого блока при этом остаётся полосой во всю ширину письма',
  },
];

/**
 * Настройки письма целиком. Показываются, когда не выбран ни один блок, —
 * так панель справа никогда не пустует, а общие свойства не прячутся в меню.
 */
export const SETTINGS_FIELDS = [
  {
    key: 'preheader',
    label: 'Текст превью',
    type: 'text',
    placeholder: 'Скидка 20% на анализы до конца месяца',
    hint: 'Почтовый клиент покажет его рядом с темой. Не заполните — туда уедет первая строка письма',
  },
  { key: 'senderName', label: 'Название отправителя', type: 'text', placeholder: 'Сеть медцентров «Альфа»', hint: 'Показывается в подвале письма' },
  { key: 'bodyBg', label: 'Фон вокруг письма', type: 'color' },
  { key: 'cardBg', label: 'Фон письма', type: 'color' },
  { key: 'textColor', label: 'Цвет текста', type: 'color' },
  { key: 'linkColor', label: 'Цвет ссылок и кнопок', type: 'color' },
  { key: 'font', label: 'Шрифт письма', type: 'font' },
  { key: 'fontSize', label: 'Размер текста', type: 'number', min: 12, max: 24, suffix: 'px' },
  { key: 'radius', label: 'Скругление письма', type: 'number', min: 0, max: 32, suffix: 'px' },
  {
    key: 'utm',
    label: 'Метки перехода',
    type: 'utm',
    hint: 'Навешиваются на все ссылки письма. Без них переходы из рассылки в отчётах сайта сливаются с прямыми заходами',
  },
  {
    key: 'imageMode',
    label: 'Картинки в письме',
    type: 'select',
    options: [['link', 'Ссылками на портал'], ['attach', 'Вложены в письмо']],
    hint: 'Вложения видны даже при выключенной загрузке картинок, но каждая копия письма несёт их с собой — для тысяч адресов это гигабайты',
  },
];

export const DEFAULT_SETTINGS = {
  width: 600,
  bodyBg: '#F2F2F7',
  cardBg: '#FFFFFF',
  textColor: '#1C1C1E',
  mutedColor: '#8E8E93',
  linkColor: '#007AFF',
  fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontSize: 16,
  lineHeight: 1.5,
  radius: 16,
  preheader: '',
  senderName: 'Сеть медцентров «Альфа»',
  imageMode: 'link',
};

/**
 * Пустое письмо, с которого начинают.
 *
 * Не совсем пустое намеренно: чистый холст — худшее, что можно показать
 * человеку, открывшему конструктор впервые. Одна секция с заголовком, абзацем
 * и кнопкой объясняет устройство письма, и её не жалко разобрать.
 */
export const createDesign = () => withIds({
  version: 2,
  settings: { ...DEFAULT_SETTINGS },
  sections: [
    {
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      columns: [{
        width: 100,
        blocks: [
          { type: 'text', html: '<h2>Заголовок письма</h2>', align: 'left', padding: { top: 28, right: 24, bottom: 4, left: 24 } },
          { type: 'text', html: '<p>Здесь текст письма.</p>', align: 'left', padding: { ...PAD } },
          { type: 'button', text: 'Записаться', href: '', align: 'left', padding: { top: 8, right: 24, bottom: 28, left: 24 } },
        ],
      }],
    },
    {
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      columns: [{
        width: 100,
        blocks: [
          { type: 'unsubscribe', html: '<p>Вы получили это письмо, потому что оставили адрес в медцентре «Альфа».</p>', linkText: 'Отписаться от рассылки', fontSize: 12, align: 'center', gap: 6, padding: { top: 16, right: 24, bottom: 28, left: 24 } },
        ],
      }],
    },
  ],
});

const pad = (t, b) => ({ top: t, right: 24, bottom: b, left: 24 });

/** Секция-обёртка: полоса без собственного фона, одна колонка. */
const plain = (blocks, extra = {}) => ({
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  ...extra,
  columns: [{ width: 100, blocks }],
});

/**
 * Стартовые макеты.
 *
 * Не шаблоны и не замена им: шаблон человек сохраняет сам и хранит в базе, а
 * это — заготовки в коде, с которых начинают. Чистый холст ничего не
 * подсказывает, и первое письмо в конструкторе почти всегда выходит «текст и
 * кнопка», потому что больше ничего не нашли.
 *
 * Макеты намеренно показывают то, ради чего появились секции: тёмная шапка во
 * всю ширину, белое тело, серый подвал. Из плоского списка блоков такого не
 * собрать, и увидеть это проще, чем прочитать.
 */
export const PRESETS = [
  {
    id: 'blank',
    name: 'С нуля',
    hint: 'Заголовок, текст и кнопка',
    build: () => createDesign(),
  },
  {
    id: 'promo',
    name: 'Акция',
    hint: 'Тёмная шапка, карточка со скидкой, подвал',
    build: () => withIds({
      version: 2,
      settings: { ...DEFAULT_SETTINGS, preheader: 'Скидка до конца месяца' },
      sections: [
        {
          background: '#0B3D91',
          innerBackground: '',
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          columns: [{ width: 100, blocks: [
            { type: 'header', src: '', logoWidth: 150, tagline: 'Сеть медцентров «Альфа»', color: '#FFFFFF', align: 'center', padding: pad(28, 24) },
          ] }],
        },
        plain([
          { type: 'text', html: '<h2>Скидка 20% на УЗИ</h2><p>До конца месяца УЗИ во всех медцентрах сети дешевле на 20%.</p>', align: 'left', padding: pad(28, 8) },
          { type: 'promo', src: '', title: 'УЗИ брюшной полости', text: 'Без очереди, по предварительной записи.', badge: '−20%', oldPrice: '2 400 ₽', price: '1 900 ₽', buttonText: 'Записаться', buttonHref: '', bg: '#F7F7FA', radius: 14, padding: pad(8, 24) },
        ]),
        {
          background: '#F2F2F7',
          innerBackground: '#F2F2F7',
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          gap: 16,
          columns: [
            { width: 50, blocks: [{ type: 'contacts', title: 'Как записаться', phone: '+7 (4712) 77-77-77', hours: 'Пн–Сб, 8:00–20:00', align: 'left', padding: pad(24, 24) }] },
            { width: 50, blocks: [{ type: 'social', align: 'right', items: [{ network: 'telegram', href: '' }, { network: 'whatsapp', href: '' }], padding: pad(24, 24) }] },
          ],
        },
        plain([{ type: 'unsubscribe', html: '<p>Вы получили это письмо, потому что оставили адрес в медцентре «Альфа».</p>', linkText: 'Отписаться от рассылки', fontSize: 12, align: 'center', gap: 6, padding: pad(16, 28) }]),
      ],
    }),
  },
  {
    id: 'price',
    name: 'Цены',
    hint: 'Шапка, список услуг, кнопка',
    build: () => withIds({
      version: 2,
      settings: { ...DEFAULT_SETTINGS, preheader: 'Новые цены на приёмы и анализы' },
      sections: [
        plain([{ type: 'header', src: '', logoWidth: 160, align: 'center', padding: pad(28, 12) }]),
        plain([
          { type: 'text', html: '<h2>Цены на сентябрь</h2><p>Собрали то, о чём спрашивают чаще всего.</p>', align: 'left', padding: pad(4, 8) },
          { type: 'services', items: [
            { name: 'Приём терапевта', note: 'первичный', price: '1 200 ₽' },
            { name: 'Приём кардиолога', note: 'первичный', price: '1 500 ₽' },
            { name: 'Общий анализ крови', note: '', price: '450 ₽' },
          ], padding: pad(8, 12) },
          { type: 'button', text: 'Весь прайс', href: '', align: 'center', padding: pad(4, 28) },
        ]),
        {
          background: '#1C1C1E',
          innerBackground: '',
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          columns: [{ width: 100, blocks: [
            { type: 'contacts', address: 'г. Курск, ул. Ленина, 1', hours: 'Пн–Сб, 8:00–20:00', phone: '+7 (4712) 77-77-77', align: 'center', padding: pad(24, 24) },
          ] }],
        },
        plain([{ type: 'unsubscribe', html: '<p>Вы получили это письмо, потому что оставили адрес в медцентре «Альфа».</p>', linkText: 'Отписаться от рассылки', fontSize: 12, align: 'center', gap: 6, padding: pad(16, 28) }]),
      ],
    }),
  },
  {
    id: 'news',
    name: 'Новость',
    hint: 'Баннер с текстом поверх фото, две колонки',
    build: () => withIds({
      version: 2,
      settings: { ...DEFAULT_SETTINGS, preheader: 'Открыли новый медцентр' },
      sections: [
        plain([{
          type: 'hero', src: '', height: 240, overlay: 45, overlayStyle: 'bottom', bg: '#0B3D91', color: '#FFFFFF',
          title: 'Открыли медцентр на Ленина', text: 'Приёмы, УЗИ и анализы в одном месте',
          titleSize: 30, buttonText: 'Записаться', buttonHref: '', align: 'center',
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
        }]),
        plain([
          { type: 'text', html: '<p>Рассказываем, что там есть и как записаться.</p>', align: 'left', padding: pad(28, 8) },
          { type: 'iconlist', iconSize: 28, gap: 14, items: [
            { emoji: '🩺', title: 'Приём без очереди', text: 'По предварительной записи' },
            { emoji: '🧪', title: 'Анализы за сутки', text: 'Результат придёт на почту' },
          ], padding: pad(8, 12) },
        ]),
        {
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          gap: 16,
          columns: [
            { width: 50, blocks: [{ type: 'text', html: '<p><b>Что есть</b><br>Приёмы, УЗИ, анализы</p>', align: 'left', padding: pad(8, 8) }] },
            { width: 50, blocks: [{ type: 'text', html: '<p><b>Когда открыт</b><br>Пн–Сб, 8:00–20:00</p>', align: 'left', padding: pad(8, 8) }] },
          ],
        },
        plain([{ type: 'button', text: 'Записаться', href: '', align: 'center', padding: pad(12, 28) }]),
        plain([{ type: 'unsubscribe', html: '<p>Вы получили это письмо, потому что оставили адрес в медцентре «Альфа».</p>', linkText: 'Отписаться от рассылки', fontSize: 12, align: 'center', gap: 6, padding: pad(16, 28) }]),
      ],
    }),
  },
];

/**
 * Пройти по всем блокам письма, где бы они ни лежали.
 *
 * Нужно для действий над несколькими блоками сразу: выделение хранится
 * идентификаторами, а не позициями, и найти блок по идентификатору можно только
 * обходом. Зато выделение переживает любую правку — вставку секции выше,
 * перестановку колонок, удаление соседа. С индексами оно разъехалось бы на
 * первом же таком действии.
 */
export const mapAllBlocks = (d, fn) => ({
  ...d,
  sections: (d.sections || []).map(sec => ({
    ...sec,
    columns: (sec.columns || []).map(col => ({ ...col, blocks: fn(col.blocks || []) })),
  })),
});

/** Все блоки письма в порядке чтения — сверху вниз, слева направо. */
export const allBlocks = (d) => {
  const out = [];
  (d.sections || []).forEach((sec, si) => (sec.columns || []).forEach((col, ci) => (
    (col.blocks || []).forEach((b, bi) => out.push({ block: b, si, ci, bi }))
  )));
  return out;
};

/**
 * Снимает идентификаторы со всего дерева.
 *
 * Нужно ровно при сохранении модуля: в базе он лежит как заготовка, а свои
 * идентификаторы получает при каждой вставке. Иначе два экземпляра одного
 * модуля в письме оказались бы неразличимы для React — ключ списка один и тот
 * же, а содержимое уже разное.
 */
export const stripIds = (node) => {
  if (Array.isArray(node)) return node.map(stripIds);
  if (!node || typeof node !== 'object') return node;
  const { id: _dropped, ...rest } = node;
  const next = { ...rest };
  if (Array.isArray(next.columns)) next.columns = next.columns.map(stripIds);
  if (Array.isArray(next.blocks)) next.blocks = next.blocks.map(stripIds);
  return next;
};

export const cloneBlock = (block) => {
  const strip = (b) => {
    if (!b || typeof b !== 'object') return b;
    const next = { ...b, id: newId() };
    if (next.type === 'columns') {
      next.columns = (next.columns || []).map(col => ({ ...col, blocks: (col.blocks || []).map(strip) }));
    }
    return next;
  };
  return strip(JSON.parse(JSON.stringify(block)));
};

export const createBlock = (type) => {
  const block = BLOCK_TYPES[type]?.create();
  return block ? withIds({ blocks: [block] }).blocks[0] : block;
};
