/**
 * Общий язык раздела «Пользователи» в мобилке.
 *
 * Логин и пароль здесь считаются ровно так же, как в вебе
 * (frontend/src/pages/admin/AdminUsers.js): человек, заведённый с телефона,
 * должен получить такой же логин, как заведённый с компьютера, иначе в списке
 * появятся два вида логинов и по ним станет видно, кто как заводил.
 *
 * Роли и медцентры разложены здесь же: их читают три экрана — список, карточка
 * и форма заведения, — и три разные формулировки выглядели бы как три разных
 * набора данных.
 */

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e',
  ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const transliterate = text =>
  text.toLowerCase().split('').map(char => TRANSLIT[char] ?? char).join('');

/** Фамилия целиком плюс инициалы: «Иванов Пётр Ильич» → `ivanov_p_i`. */
const baseUsername = (displayName) => {
  const words = (displayName || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = transliterate(words[0]);
  const initials = words.slice(1).map(word => transliterate(word[0] || '')).join('_');
  const name = initials ? `${first}_${initials}` : first;
  return name.toLowerCase().replace(/[^a-z0-9_]/g, '');
};

/**
 * Свободный логин по имени.
 *
 * `taken` — логины, которые уже заняты. Список приезжает с экрана-списка, и
 * если он пуст (открыли форму, не дождавшись загрузки), суффикс не подберётся —
 * тогда занятый логин отобьёт сервер, и это единственное, на что можно
 * положиться: между проверкой и сохранением человека мог завести и коллега.
 */
export const uniqueUsername = (displayName, taken = []) => {
  const base = baseUsername(displayName);
  if (!base) return '';

  const busy = new Set(taken.map(name => String(name).toLowerCase()));
  if (!busy.has(base)) return base;

  for (let i = 1; i <= 1000; i += 1) {
    const candidate = `${base}_${i}`;
    if (!busy.has(candidate)) return candidate;
  }
  return base;
};

/**
 * Пароль на первый вход.
 *
 * Двенадцать знаков, по одному из каждого набора — те же правила, что в вебе.
 * Человек его не запоминает: пароль уходит письмом вместе с логином, а на
 * экране остаётся, чтобы продиктовать вслух, если почта ещё не заведена.
 */
export const generatePassword = () => {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const special = '!@#$%^&*';
  const all = lower + upper + digits + special;
  const pick = set => set[Math.floor(Math.random() * set.length)];

  const chars = [pick(lower), pick(upper), pick(digits), pick(special)];
  while (chars.length < 12) chars.push(pick(all));
  // Обязательные знаки стоят первыми, и без перемешивания пароль всегда
  // начинался бы с буквы, цифры и знака в одном и том же порядке
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

/** Роли одним набором: множественные плюс старая одиночная, без повторов. */
export const roleNames = user =>
  [...new Set([user?.role?.name, ...(user?.roles || []).map(r => r.name)].filter(Boolean))];

export const medCenterNames = user =>
  (user?.medCenters || []).map(mc => mc.name).filter(Boolean);

/** Подпись под именем в списке: чем человек занят и где. */
export const whoText = (user) => {
  const parts = [roleNames(user).join(', '), user?.position, medCenterNames(user).join(', ')];
  return parts.filter(Boolean).join(' · ') || `@${user?.username}`;
};

/**
 * Права — теми же словами и в том же порядке, что в дереве веба (AdminUsers.js).
 *
 * Списки продублированы, а не привезены с сервера, ровно как в вебе: там они
 * тоже вбиты в вёрстку. Исключение — склад: его разделы и отчёты приезжают
 * каталогом (`/warehouse/permissions/catalogue`), потому что новый отчёт иначе
 * пришлось бы дописывать в трёх местах и однажды забыть в одном.
 */
export const ADMIN_RIGHTS = [
  ['pages', 'Проводник'],
  ['roles', 'Роли и права'],
  ['settings', 'Настройки'],
  ['sidebar', 'Меню навигации'],
  ['media', 'Медиафайлы'],
  ['users', 'Пользователи'],
  ['backup', 'Резервные копии'],
  ['journal', 'Журнал'],
  ['parser', 'Парсер цен'],
];

/**
 * Модули. Часть флагов живёт в `adminAccess`, часть — отдельными полями самого
 * пользователя: так сложилось исторически, и дерево прав об этой разнице знает
 * (`where: 'access' | 'user'`), чтобы форма клала значение туда, где его ждёт
 * сервер.
 */
export const MODULE_RIGHTS = [
  ['reviews', 'Отзывы', 'access'],
  ['canEditServices', 'Услуги', 'user'],
  ['courses', 'Курсы', 'access'],
  ['canEditDoctorCards', 'Карточки врачей', 'user'],
  ['canEditAnalyses', 'Анализы', 'user'],
  ['canManagePromotions', 'Акции', 'user'],
  ['releaseNotes', 'Нововведения', 'access'],
  ['medCenters', 'Медцентры', 'access'],
  ['onboarding', 'Онбординг врача', 'access'],
];

/**
 * Клиники зарплатного модуля.
 *
 * Список локальный и в вебе тоже: модуль «Зарплата» на справочник медцентров
 * (ver. 6.67) не переведён, и трогать его без отдельного захода решено не было —
 * слишком велика цена ошибки в расчётах.
 */
export const SALARY_CLINICS = [
  {id: '2', name: 'Альфа', color: '#de64a1'},
  {id: '3', name: 'Кидс', color: '#ed9121'},
  {id: '1', name: 'Проф', color: '#9999ff'},
  {id: '6', name: 'Линия', color: '#e2d1bb'},
  {id: '4', name: '3К', color: '#800080'},
  {id: '7', name: 'Смайл', color: '#999999'},
  {id: '8', name: 'Направители', color: '#00bfff'},
  {id: '11', name: 'Сукко', color: '#2d7055'},
  {id: '12', name: 'Нео', color: '#008cb4'},
  {id: 'ip', name: 'ИП Микаелян', color: '#e05252'},
];

/** Вкладки зарплатного модуля: у каждой свой уровень block / read / edit. */
export const SALARY_TABS = [
  {key: 'tab1', label: 'Сотрудники'},
  {key: 'tabWorkTime', label: 'Учёт рабочего времени', group: 'Учёт времени'},
  {key: 'tabHourNorms', label: 'Норма часов', group: 'Учёт времени'},
  {key: 'tabSchedule', label: 'Расписание', group: 'Учёт времени'},
  {key: 'tab2', label: 'Услуги'},
  {key: 'tab3', label: 'Направления'},
  {key: 'tab4', label: 'Отчёт'},
  {key: 'tabArchiveHistory', label: 'Архив', group: 'Архив'},
  {key: 'tabArchiveKassa', label: 'Касса', group: 'Архив'},
  {key: 'tabArchiveTabel', label: 'Табели', group: 'Архив'},
  {key: 'tabSummary', label: 'Сводка'},
];

/**
 * Значения по умолчанию для нового человека — всё закрыто.
 *
 * `tabKpi` в дереве нет (его нет и в вебе), но в наборе он обязан быть: сервер
 * подставляет пропущенным вкладкам `edit`, и не отправленный ключ означал бы
 * молча выданный доступ к KPI.
 */
export const SALARY_PERM_DEFAULT = {
  clinics: [],
  tabKpi: 'block',
  ...Object.fromEntries(SALARY_TABS.map(tab => [tab.key, 'block'])),
};

/**
 * Вкладок статистики здесь нет намеренно.
 *
 * В вебе у ветки «Статистика» есть дерево галочек по вкладкам (аналитика,
 * справочники, услуги), но ни одна из них никуда не уезжает: поля
 * `statisticsTabs` нет ни в модели пользователя, ни в маршрутах — сервер о нём
 * не знает вовсе. Это осталось от незаконченной задумки, и повторять её здесь
 * значило бы нарисовать полтора десятка переключателей, которые ничего не
 * меняют. Реальное право одно — `canAccessStatistics`, оно и есть в дереве.
 */

export const WAREHOUSE_PERM_DEFAULT = {perms: {}, medCenterIds: []};

/** Уровень доступа: те же три ступени, что у трёхпозиционного переключателя веба. */
export const PERM_LEVELS = [
  {value: 'block', label: 'Нет'},
  {value: 'read', label: 'Чтение'},
  {value: 'edit', label: 'Правка'},
];

/** Что человеку открыто, списком названий. У администратора — открыто всё. */
export const grantedRights = (user) => {
  if (!user) return [];
  const access = user.adminAccess || {};
  return [
    ...ADMIN_RIGHTS.filter(([key]) => access[key]).map(([, label]) => label),
    ...(access.warehouse ? ['Складской учёт'] : []),
    ...MODULE_RIGHTS
      .filter(([key, , where]) => (where === 'access' ? access[key] : user[key]))
      .map(([, label]) => label),
    ...(user.canAccessSalary ? ['Зарплата'] : []),
    ...(user.canAccessStatistics ? ['Статистика'] : []),
    ...(user.canAccessTopSalary ? ['АУП — секретная клиника'] : []),
  ];
};

export const dateText = value =>
  (value ? new Date(value).toLocaleDateString('ru-RU') : '—');

export const dateTimeText = value => (value
  ? new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  : '—');

/** Дата рождения из МИС приходит и как `YYYY-MM-DD`, и как `DD.MM.YYYY`. */
export const misBirthDate = (value) => {
  if (!value) return '';
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(value)) {
    const [d, m, y] = value.split('.');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
};

/** Пол в МИС записан десятком способов — от «male» до «2». */
export const misGender = (value) => {
  const raw = String(value ?? '').toLowerCase().trim();
  if (['male', 'm', 'м', '1'].includes(raw) || raw.startsWith('муж')) return 'male';
  if (['female', 'f', 'ж', '2'].includes(raw) || raw.startsWith('жен')) return 'female';
  return '';
};
