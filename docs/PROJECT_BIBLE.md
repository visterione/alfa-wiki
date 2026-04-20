# Alfa-Wiki — Библия проекта

> Полная техническая документация. Версия: 3.26 (апрель 2026)

---

## Содержание

1. [Что это за проект](#1-что-это-за-проект)
2. [Стек технологий](#2-стек-технологий)
3. [Архитектура системы](#3-архитектура-системы)
4. [Структура файлов проекта](#4-структура-файлов-проекта)
5. [Backend — Node.js/Express](#5-backend--nodejsexpress)
   - [server.js — точка входа](#51-serverjs--точка-входа)
   - [Middleware (промежуточные обработчики)](#52-middleware-промежуточные-обработчики)
   - [Маршруты (Routes)](#53-маршруты-routes)
   - [Модели данных (Sequelize)](#54-модели-данных-sequelize)
   - [Аутентификация и авторизация](#55-аутентификация-и-авторизация)
   - [Сервисы (Services)](#56-сервисы-services)
   - [Cron-задачи (фоновые задания)](#57-cron-задачи-фоновые-задания)
6. [База данных PostgreSQL](#6-база-данных-postgresql)
   - [Структура таблиц по модулям](#61-структура-таблиц-по-модулям)
   - [Миграции](#62-миграции)
   - [Ключевые паттерны в БД](#63-ключевые-паттерны-в-бд)
7. [Frontend — React](#7-frontend--react)
   - [Структура React-приложения](#71-структура-react-приложения)
   - [Роутинг (React Router)](#72-роутинг-react-router)
   - [Контексты (Context API)](#73-контексты-context-api)
   - [Страницы (Pages)](#74-страницы-pages)
   - [Компоненты](#75-компоненты)
   - [API-клиент (axios)](#76-api-клиент-axios)
8. [Реальное время — Socket.IO](#8-реальное-время--socketio)
9. [Ключевые модули проекта](#9-ключевые-модули-проекта)
   - [Вики-страницы (Pages)](#91-вики-страницы-pages)
   - [Чат](#92-чат)
   - [Канбан](#93-канбан)
   - [Отзывы (Reviews)](#94-отзывы-reviews)
   - [Курсы (Courses)](#95-курсы-courses)
   - [Почта (Email)](#96-почта-email)
   - [Зарплатный модуль](#97-зарплатный-модуль)
   - [Телеграм-боты](#98-телеграм-боты)
10. [Деплой и инфраструктура](#10-деплой-и-инфраструктура)
11. [Переменные окружения (.env)](#11-переменные-окружения-env)
12. [Справочник: как что работает](#12-справочник-как-что-работает)

---

## 1. Что это за проект

Alfa-Wiki — внутренняя корпоративная платформа медицинского центра «Альфа». Это не просто вики — это полноценная информационная система, включающая:

| Модуль | Назначение |
|--------|-----------|
| Вики-страницы | Внутренняя база знаний с редактором, папками, поиском |
| Чат | Внутренний мессенджер с группами, ботами, реакциями |
| Канбан | Управление задачами по доскам |
| Отзывы | Обработка отзывов пациентов с Kanban-флоу |
| Курсы | Система обучения сотрудников с тестами |
| Почта | Рассылки через внутренний SMTP |
| Аккредитации | Отслеживание сроков аккредитаций врачей |
| Автомобили | Учёт транспорта и сроков ТО |
| Анализы/Услуги | Справочники цен и услуг из МИС |
| Зарплата | Расчёт зарплаты, реферальные бонусы |
| Карточки врачей | Профили специалистов |
| Карта | Интерактивная карта с маркерами |
| Таблицы табельного учёта | Табель рабочего времени |
| Телеграм-боты | Уведомления и пропущенные звонки |

Сервер работает на IP `192.168.22.39`, порт `9001` — это локальная сеть медцентра. Доступ извне через VPN.

---

## 2. Стек технологий

### Backend
| Технология | Версия | Роль |
|-----------|--------|------|
| **Node.js** | 18+ | Среда выполнения JavaScript на сервере |
| **Express** | 4.18 | HTTP-фреймворк (роутинг, middleware) |
| **Sequelize** | 6.35 | ORM — работа с БД через JavaScript-объекты вместо SQL |
| **PostgreSQL** | 14+ | Реляционная база данных |
| **Socket.IO** | 4.8 | WebSocket — двусторонняя связь в реальном времени |
| **JWT** | jsonwebtoken 9.0 | Токены аутентификации |
| **bcryptjs** | 2.4 | Хэширование паролей |
| **node-cron** | 3.0 | Планировщик задач (аналог crontab) |
| **multer** | 1.4 | Загрузка файлов |
| **sharp** | 0.33 | Обработка изображений (превью) |
| **pdfkit** | 0.17 | Генерация PDF |
| **nodemailer** | 7.0 | Отправка email |
| **axios** | 1.13 | HTTP-клиент (запросы к МИС API) |
| **xlsx-js-style** | 1.2 | Экспорт в Excel |

### Frontend
| Технология | Версия | Роль |
|-----------|--------|------|
| **React** | 18.2 | UI-фреймворк (декларативный интерфейс) |
| **React Router** | 6.21 | Клиентский роутинг (переход между страницами без перезагрузки) |
| **axios** | 1.6 | HTTP-запросы к backend API |
| **Socket.IO Client** | 4.8 | WebSocket-соединение |
| **TipTap** | 2.1 | WYSIWYG-редактор (на основе ProseMirror) |
| **Univer** | 0.15 | Современный табличный редактор (Excel-подобный) |
| **LuckySheet** | 2.1 | Старый табличный редактор (устаревший, оставлен для совместимости) |
| **React Flow** | 11.11 | Редактор графа/диаграммы (workflow отзывов) |
| **Recharts** | 3.7 | Графики и диаграммы |
| **@hello-pangea/dnd** | 18.0 | Drag-and-drop (перетаскивание карточек в Канбане) |
| **Lucide React** | 0.303 | Библиотека иконок |
| **react-hot-toast** | 2.4 | Всплывающие уведомления (toasts) |
| **date-fns** | 3.2 | Работа с датами |
| **Tauri** | 2.x | Обёртка для Desktop-приложения (Windows) |

### Инфраструктура
| Технология | Роль |
|-----------|------|
| **PM2** | Process manager — запуск и мониторинг Node.js-процесса |
| **PostgreSQL** | СУБД |
| **Nextcloud** | Интеграция с АТС для пропущенных звонков |
| **Telegram Bot API** | Уведомления, эмуляция Bot API |
| **Renovatio MIS** | Медицинская информационная система — источник данных о врачах/услугах |

---

## 3. Архитектура системы

### Общая схема

```
[Браузер/Tauri App]  ←→  [React SPA]
        ↕ HTTP REST + WebSocket
[Express Server :9001]
        ├── /api/*         — REST API
        ├── /bot:token/*   — Telegram Bot API эмуляция
        ├── /uploads/*     — Статические файлы
        └── /* (prod)      — React build (статика)
        ↕
[PostgreSQL] + [Файловая система ./uploads/]
        ↕
[MIS API (Renovatio)] + [Telegram] + [SMTP] + [Nextcloud ATS]
```

### Паттерн взаимодействия (Request-Response)

Каждый запрос из браузера проходит следующий путь:

```
Frontend (axios) 
  → HTTP Request с заголовком Authorization: Bearer <token>
  → Express Router (находит нужный route handler)
  → authenticate middleware (проверяет JWT)
  → Route handler (бизнес-логика, запросы к Sequelize)
  → Sequelize ORM → PostgreSQL
  → JSON-ответ обратно
```

### Монолит vs. микросервисы

Проект — **монолит**. Один Node.js-процесс делает всё: REST API, Socket.IO, cron-задачи, PDF-генерацию, отправку email, интеграции. Это упрощает разработку и деплой при данном масштабе.

### Режим работы в production

Frontend (`create-react-app build`) собирается в `frontend/build/`. Express **сам отдаёт** эту статику — отдельный веб-сервер (nginx) не нужен:

```js
// server.js (production)
app.use(express.static(path.join(__dirname, '../frontend/build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
});
```

---

## 4. Структура файлов проекта

```
c:\alfa-wiki\
├── backend/
│   ├── bot/              Скрипты Telegram-бота + HTML-шаблоны
│   ├── config/
│   │   └── reviewStatuses.js   Конфиг статусов для отзывов
│   ├── cron/             9 файлов — фоновые задачи по расписанию
│   ├── fonts/            Шрифт DejaVuSans для PDF
│   ├── jobs/             Разовые задачи (переиндексация и т.д.)
│   ├── middleware/
│   │   └── auth.js       JWT-проверка + проверки прав
│   ├── migrations/       ~60 файлов миграций БД (SQL и JS)
│   ├── models/
│   │   └── index.js      ВСЕ Sequelize-модели в одном файле
│   ├── routes/           44 файла — обработчики маршрутов
│   ├── scripts/          ~35 разовых скриптов исправления данных
│   ├── services/
│   │   ├── notificationService.js
│   │   ├── emailService.js
│   │   ├── pdfService.js
│   │   ├── botWebhookService.js
│   │   ├── workflowEngine.js
│   │   └── reviewSync/   Синхронизация отзывов с агрегаторами
│   ├── uploads/          Загруженные файлы (структурировано по типу/дате)
│   ├── utils/
│   │   └── xlsxConverter.js
│   ├── .env              Реальные настройки (не в git!)
│   ├── .env.example      Шаблон настроек
│   └── server.js         ТОЧКА ВХОДА
│
├── frontend/
│   ├── build/            Собранный production-build React (генерируется npm run build)
│   ├── public/           Статика + LuckySheet библиотека
│   ├── src/
│   │   ├── App.js        Корень приложения + маршруты
│   │   ├── components/   18+ переиспользуемых компонентов
│   │   ├── context/      AuthContext, SocketContext, ThemeContext
│   │   ├── pages/        28 страниц (один файл = одна страница)
│   │   ├── services/
│   │   │   └── api.js    Axios-клиент (все API-вызовы)
│   │   └── utils/        Константы (статусы отзывов, формулы)
│   ├── src-tauri/        Конфиг Tauri (Desktop-приложение)
│   └── craco.config.js   Настройка Webpack (добавляет jQuery глобально)
│
├── mobile/               React Native мобильное приложение
├── docs/                 Документация (этот файл!)
├── logs/                 PM2-логи
├── ecosystem.config.js   PM2-конфигурация
└── backup.sql            Резервная копия БД
```

---

## 5. Backend — Node.js/Express

### 5.1 server.js — точка входа

`backend/server.js` — главный файл, который запускается командой `node server.js` (или через PM2).

**Что происходит при запуске:**

1. Загружаются переменные окружения из `.env` (`dotenv`)
2. Sequelize синхронизирует/проверяет соединение с БД
3. Регистрируются все middleware
4. Регистрируются все роуты (`/api/...`)
5. Инициализируется Socket.IO на том же HTTP-сервере
6. Запускаются cron-задачи
7. Сервер начинает слушать порт `9001`

**Ключевой момент**: Socket.IO и Express используют **один HTTP-сервер**:
```js
const http = require('http');
const server = http.createServer(app);  // app — это Express
const io = new Server(server);          // Socket.IO навешивается сверху
server.listen(9001);
```

Это важно: в production нельзя использовать `cluster` режим PM2 (несколько процессов), потому что Socket.IO хранит состояние подключений в памяти одного процесса.

### 5.2 Middleware (промежуточные обработчики)

Middleware — это функции, которые обрабатывают каждый запрос **до** того, как он дойдёт до route handler. Регистрируются в порядке вызова `app.use()`.

#### Что такое middleware (для понимания)

```js
// Упрощённая схема
app.use((req, res, next) => {
  // Что-то делаем с запросом
  console.log(req.method, req.url);
  next(); // Передаём управление следующему middleware
});
```

Если `next()` не вызвать — цепочка остановится и ответ не уйдёт.

#### Стек middleware в проекте

| Middleware | Пакет | Что делает |
|-----------|-------|------------|
| `helmet()` | helmet | Добавляет защитные HTTP-заголовки (CSP, X-Frame-Options и т.д.) |
| `cors()` | cors | Разрешает кросс-доменные запросы (браузер → сервер с другого домена) |
| `express.json()` | express (встроен) | Парсит тело запроса из JSON в `req.body` |
| `express.urlencoded()` | express (встроен) | Парсит form-data |
| `morgan('dev')` | morgan | Логирует все HTTP-запросы в консоль |
| `express.static('./uploads')` | express (встроен) | Отдаёт файлы из папки uploads как статику |

Лимит `10gb` в `express.json` — намеренно большой, чтобы можно было передавать большие файлы как base64.

### 5.3 Маршруты (Routes)

**Маршрут** — это обработчик конкретного URL + HTTP-метода.

```js
// Пример из routes/users.js
router.get('/', authenticate, requireAdmin, async (req, res) => {
  const users = await User.findAll();
  res.json(users);
});
```

Все маршруты монтируются в `server.js`:
```js
app.use('/api/users', usersRouter);
app.use('/api/pages', pagesRouter);
// ... и так для всех 44 файлов
```

#### Полный список маршрутов

| URL-префикс | Файл | Назначение |
|-------------|------|------------|
| `/api/auth` | auth.js | Вход, выход, 2FA, профиль |
| `/api/users` | users.js | Управление пользователями |
| `/api/roles` | roles.js | Роли и права доступа |
| `/api/pages` | pages.js | Вики-страницы (CRUD + история + экспорт) |
| `/api/folders` | folders.js | Папки для страниц |
| `/api/sidebar` | sidebar.js | Элементы боковой панели |
| `/api/media` | media.js | Медиафайлы |
| `/api/search` | search.js | Поиск по всей системе |
| `/api/settings` | settings.js | Настройки приложения |
| `/api/backup` | backup.js | Резервные копии БД |
| `/api/chat` | chat.js | Чат (сообщения, группы, реакции) |
| `/api/favorites` | favorites.js | Избранные страницы |
| `/api/journal` | journal.js | Журнал изменений страниц |
| `/api/accreditations` | accreditations.js | Аккредитации врачей |
| `/api/vehicles` | vehicles.js | Автопарк |
| `/api/map` | map.js | Карта с маркерами |
| `/api/doctor-cards` | doctor-cards.js | Карточки врачей |
| `/api/mis` | mis-proxy.js | Прокси к Renovatio MIS API |
| `/api/courses` | courses.js | Курсы обучения |
| `/api/analyses` | analyses.js | Справочник анализов |
| `/api/services` | services.js | Справочник услуг |
| `/api/calendar` | calendar.js | Календарь событий |
| `/api/kanban` | kanban.js | Канбан-доски и задачи |
| `/api/reviews` | reviews.js | Модуль отзывов |
| `/api/email` | email.js | Шаблоны и рассылки |
| `/api/salary-records` | salary-records.js | Записи расчёта зарплаты |
| `/api/cash-payments` | cash-payments.js | Выплаты наличными |
| `/api/referral-bonuses` | referral-bonuses.js | Реферальные бонусы |
| `/api/referral-reports` | referral-reports.js | Отчёты по рефералам |
| `/api/hour-norms` | hour-norms.js | Нормы часов по профессиям |
| `/api/role-norms` | role-norms.js | Нормы часов по ролям |
| `/api/executor-settings` | executor-settings.js | Настройки исполнителей |
| `/api/performed-service-bonuses` | performed-service-bonuses.js | Бонусы за выполненные услуги |
| `/api/service-consumables` | service-consumables.js | Расходники к услугам |
| `/api/price-comparisons` | price-comparisons.js | Сравнение цен |
| `/api/partner-services` | partner-services.js | Кэш партнёрских услуг |
| `/api/doctor-schedules` | doctor-schedules.js | Расписания врачей |
| `/api/tabel-records` | tabel-records.js | Табель учёта рабочего времени |
| `/api/structural-divisions` | structural-divisions.js | Структурные подразделения |
| `/api/promotions` | promotions.js | Акции |
| `/api/bots` | bot-management.js | Управление Telegram-ботами |
| `/api/notify` | notify.js | Вебхук для внешних уведомлений |
| `/bot:token/*` | telegram-bot-api.js | Эмуляция Telegram Bot API |
| `GET /api/health` | server.js inline | Health check |

### 5.4 Модели данных (Sequelize)

**Sequelize** — ORM (Object-Relational Mapping). Вместо написания SQL вручную описываешь таблицы как JavaScript-классы, и Sequelize сам генерирует SQL.

#### Как это выглядит

```js
// Из models/index.js
const User = sequelize.define('User', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  username: { type: DataTypes.STRING(50), unique: true, allowNull: false },
  password: { type: DataTypes.STRING(255), allowNull: false },
  isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
  // ...
}, { tableName: 'users' });
```

Это создаёт таблицу `users` со всеми этими полями.

#### Ассоциации (связи между таблицами)

```js
User.belongsToMany(Role, { through: 'user_roles' });
Role.belongsToMany(User, { through: 'user_roles' });
```

Это Many-to-Many связь: один пользователь может иметь несколько ролей, одна роль — у нескольких пользователей. Sequelize создаёт промежуточную таблицу `user_roles`.

#### Все модели по группам

**Система:**
- `User` — пользователи (58 полей!)
- `Role` — роли доступа
- `Setting` — настройки приложения (key-value хранилище)
- `Media` — загруженные файлы

**Вики:**
- `Folder` — папки для страниц
- `Page` — вики-страницы (content в виде TipTap JSON/HTML)
- `PageHistory` — история изменений страниц
- `UserFavorite` — избранные страницы
- `SidebarItem` — элементы боковой навигации
- `SearchIndex` — индекс полнотекстового поиска

**Чат:**
- `Chat` — беседы (private/group)
- `ChatMember` — участники беседы с настройками (мьют, закреп, скрытие)
- `Message` — сообщения с вложениями (JSONB)
- `MessageReaction` — реакции на сообщения

**Медицинские:**
- `Accreditation` — аккредитации врачей
- `AccreditationFile` — файлы к аккредитациям
- `Vehicle` — транспортные средства
- `VehicleFile` — файлы к ТС
- `Analysis` — анализы (справочник из МИС)
- `Service` — услуги (справочник из МИС)
- `MedCenter` — медицинские центры (Альфа, Кидс, Проф, Линия, Смайл, 3К)
- `DoctorCard` — карточки врачей
- `MapMarker` — маркеры на карте

**Обучение:**
- `Course` — курсы
- `Lesson` — уроки курса
- `TestQuestion` — вопросы теста
- `CourseProgress` — прогресс пользователя по курсу

**Планирование:**
- `CalendarEvent` — события календаря (с рекуррентностью!)
- `KanbanBoard` — Канбан-доски
- `BoardPermission` — права доступа к доскам
- `KanbanTask` — задачи (с подзадачами в JSONB)

**Отзывы:**
- `ReviewPlatform` — платформы (Яндекс, Google и т.д.)
- `ReviewBoard` — доски для отзывов
- `ReviewBoardPermission` — права к доскам отзывов
- `ReviewBoardRole` — специализированные роли (создатель, обработчик, ревьюер, публикатор)
- `Review` — сам отзыв (paranoid = мягкое удаление!)
- `ReviewHistory` — история изменений отзыва
- `ReviewSyncConfig` — конфиги синхронизации с агрегаторами

**Почта:**
- `EmailTemplate` — шаблоны писем
- `EmailLog` — история отправок
- `EmailFavoriteRecipient` — избранные получатели
- `EmailFavoriteTemplate` — избранные шаблоны

**Зарплата:**
- `HourNorm` — нормы часов по профессии/периоду
- `RoleNorm` — нормы часов по роли/периоду
- `ReferralBonus` — реферальные бонусы (% от услуги)
- `ReferralReport` — отчёты по рефералам
- `ExecutorSettings` — настройки исполнителя
- `PerformedServiceBonus` — бонусы за выполненные услуги
- `ServiceConsumable` — расходники к услугам
- `RbUserPermission` — права доступа к зарплатным вкладкам
- `SalaryRecord` — записи расчёта зарплаты
- `CashPayment` — выплаты наличными

**Прочее:**
- `Promotion` — акции
- `PartnerServiceCache` — кэш услуг партнёров
- `DoctorSchedule` — расписания врачей
- `TabelRecord` / `TabelRecordDoctor` — табельный учёт
- `StructuralDivision` — структурные подразделения
- `TelegramSubscriber` — подписчики Telegram-бота
- `BotToken` / `BotUpdate` — Telegram Bot API эмуляция
- `IntIdMap` — маппинг UUID ↔ integer для Bot API

**Итого: ~58 моделей, ~55+ таблиц в PostgreSQL**

### 5.5 Аутентификация и авторизация

#### Как работает аутентификация (JWT)

**JWT (JSON Web Token)** — это подписанная строка, которая содержит информацию о пользователе. Сервер не хранит сессии — вся информация в токене.

```
Вход пользователя:
  POST /api/auth/login { username, password }
  → Сервер проверяет пароль (bcrypt.compare)
  → Создаёт JWT: jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '12h' })
  → Возвращает { token, user }

Каждый следующий запрос:
  Заголовок: Authorization: Bearer eyJhbGci...
  → authenticate middleware: jwt.verify(token, JWT_SECRET)
  → Загружает User из БД по id из токена
  → Добавляет в req.user
  → next() — передаёт управление route handler'у
```

#### Двухфакторная аутентификация (2FA)

```
1. POST /login → если 2FA включена у пользователя:
   - Генерируется 6-значный код (emailService.generateCode())
   - Код сохраняется в user.twoFactorCode с временем истечения (twoFactorCodeExpires)
   - Письмо с кодом уходит на email пользователя
   - Возвращается { requiresTwoFactor: true, userId }

2. POST /verify-2fa { userId, code }
   - Проверяется код и время истечения
   - Если верно — возвращается настоящий JWT-токен
```

#### Система прав доступа

В проекте **два уровня** прав:

**Уровень 1: Роли с разрешениями**
```js
// Роль хранит объект permissions
{
  pages: { read: true, write: true, delete: false, admin: false },
  courses: { read: true }
}
```
Проверяется через `requirePermission(resource, action)`.

**Уровень 2: adminAccess (гранулярный доступ к разделам)**
```js
// Поле users.adminAccess (JSONB)
{
  users: true,      // Может управлять пользователями
  roles: false,
  sidebar: true,
  backup: false,
  reviews: true,   // Может заходить в модуль отзывов
  // ...
}
```
Проверяется через `requireAdminAccess('reviews')`.

**Уровень 3: Индивидуальные флаги на пользователе**
```
canEditDoctorCards, canEditAnalyses, canEditServices,
canAccessSalary, isBot, canManagePromotions
```

#### Файл middleware/auth.js — экспортируемые функции

```js
authenticate           // Проверяет JWT, загружает req.user
requireAdmin           // req.user.isAdmin === true
requireAdminAccess(section) // req.user.adminAccess[section] === true
requirePermission(resource, action) // Проверяет через роли
checkPageAccess        // Проверяет allowedRoles страницы
checkCourseAccess      // Проверяет курс по ролям И медцентрам
optionalAuth           // Как authenticate, но не блокирует при отсутствии токена
```

### 5.6 Сервисы (Services)

Сервисы — это вынесенная бизнес-логика, которую используют несколько route handlers.

#### notificationService.js

Три встроенных бота (hardcoded UUID):
- `00000000-0000-0000-0000-000000000001` — «Ассистент» (общие уведомления)
- `00000000-0000-0000-0000-000000000002` — «Reviews bot» (уведомления по отзывам)
- `00000000-0000-0000-0000-000000000003` — «ATC bot» (пропущенные звонки)

Функция `getOrCreateBotChat(userId, botId)` находит или создаёт приватный чат между пользователем и ботом.

Уведомления приходят через Socket.IO — сервис вызывает `io.to('user_${userId}').emit(...)`.

#### emailService.js

Два SMTP-транспортера:
- **Системный** (`SMTP_HOST`) — для 2FA и технических писем
- **Рассылочный** (`SMTP_HOST_BROADCAST`) — для массовых рассылок (может быть другой сервер с лучшим репутационным рейтингом)

#### pdfService.js

Генерирует PDF-отчёт по отзыву: `generateReviewPdf(review, board, history)`.
Использует шрифт DejaVuSans из `backend/fonts/` (нужен для кириллицы в pdfkit).
Файл сохраняется в `uploads/reviews/YYYY-MM/review-{id}.pdf`.

#### workflowEngine.js

Обрабатывает автоматизацию workflow для отзывов.

Поддерживаемые **триггеры** (события, запускающие автоматику):
- `review_created` — новый отзыв добавлен
- `status_changed` — статус отзыва изменился

Поддерживаемые **действия**:
- `actionAssign` — назначить исполнителей

В ReviewBoard хранится граф (React Flow nodes+edges) в поле `workflowConfig`. При срабатывании события engine обходит граф и выполняет действия.

#### reviewSync/

Синхронизирует отзывы с платформами через агрегатор GetLoyalty (покрывает: Яндекс, Google, ПроДокторов, 2ГИС, НаПоправку, DocDoc, Докту).

Дедупликация по полю `externalId + boardId` — один и тот же отзыв не импортируется дважды.

### 5.7 Cron-задачи (фоновые задания)

`node-cron` — аналог Unix crontab, но внутри Node.js-процесса.

| Файл | Расписание | Что делает |
|------|-----------|------------|
| `analysesCron.js` | `0 2 * * *` (02:00 ежедневно) | Обновляет цены анализов из МИС |
| `servicesCron.js` | `0 3 * * *` (03:00 ежедневно) | Обновляет цены услуг из МИС |
| `calendarRemindersCron.js` | `* * * * *` (каждую минуту!) | Отправляет напоминания о событиях |
| `accreditationsVehiclesCron.js` | `0 9 * * *` (09:00 ежедневно) | Telegram-уведомления об истекающих аккредитациях и ТО |
| `reviewSyncCron.js` | `0 9,12,15,18 * * *` (4 раза в день) | Синхронизирует отзывы с агрегаторами |
| `reviewArchiveCron.js` | `0 4 * * *` (04:00 ежедневно) | Архивирует финальные отзывы |
| `missedCallsCron.js` | `* * * * *` (каждую минуту!) | Опрашивает Nextcloud AТС, маршрутизирует пропущенные в чат |
| `partnerServicesCacheCron.js` | `0 2 * * *` (02:00 ежедневно) | Пересобирает кэш услуг партнёров |
| `kanbanArchiveCron.js` | `0 3 * * *` (03:00 ежедневно) | Архивирует выполненные Канбан-задачи |

**Синтаксис cron**: `секунды минуты часы день_месяца месяц день_недели`
- `* * * * *` — каждую минуту
- `0 2 * * *` — каждый день в 02:00
- `0 9,12,15,18 * * *` — в 9:00, 12:00, 15:00, 18:00 каждый день

---

## 6. База данных PostgreSQL

### 6.1 Структура таблиц по модулям

#### Пользователи и права

```sql
users              -- Пользователи системы
roles              -- Роли (Врач, Менеджер, Администратор и т.д.)
user_roles         -- M2M: пользователь ↔ роль
user_med_centers   -- M2M: пользователь ↔ медцентр
med_centers        -- Медцентры (Альфа, Кидс, Проф, Линия, Смайл, 3К)
```

Важные поля `users`:
- `adminAccess` — JSONB с доступом к разделам администрирования
- `settings` — JSONB с пользовательскими настройками (тема и т.д.)
- `twoFactorCode` + `twoFactorCodeExpires` — для 2FA
- `canAccessSalary`, `canEditDoctorCards`, `canEditAnalyses`, `canEditServices` — специфические флаги

#### Вики

```sql
folders            -- Иерархические папки (parentId ссылается на себя)
pages              -- Страницы (контент, slug, тип, права)
page_history       -- История изменений (diff)
user_favorites     -- Избранные страницы пользователя
sidebar_items      -- Элементы боковой навигации
search_index       -- Полнотекстовый индекс
media              -- Загруженные файлы
```

#### Чат

```sql
chats              -- Беседы
chat_members       -- Участники с настройками (isPinned, isMuted, isHidden)
messages           -- Сообщения (attachments в JSONB)
message_reactions  -- Реакции (эмодзи) на сообщения
```

#### Отзывы

```sql
review_platforms          -- Платформы (Яндекс, Google и т.д.)
review_boards             -- Доски (с workflow в JSONB)
review_board_permissions  -- Права доступа к доске
review_board_roles        -- Специальные роли (creator, reviewer и т.д.)
reviews                   -- Отзывы (paranoid = soft delete!)
review_history            -- Лог изменений отзыва
review_sync_configs       -- Конфиги синхронизации с агрегаторами
```

### 6.2 Миграции

Миграция — это файл с изменением схемы БД. В проекте ~60 миграций.

**Именование файлов**: `ver. X.XX название.sql` или `add-feature-name.sql`

**Применение вручную**:
```bash
psql -d alfa_wiki -f "backend/migrations/ver. 3.26 add-missing-indexes.sql"
```

Важно: в проекте нет автоматического применения миграций! Каждая миграция применяется вручную администратором после деплоя.

**Примеры важных миграций:**
- `ver. 3.26 add-missing-indexes.sql` — добавляет недостающие индексы для производительности
- `create-reviews-module.sql` — создал весь модуль отзывов
- `add-admin-access.sql` — добавил колонку `adminAccess` к пользователям
- `20260129-add-spreadsheet-contenttype.sql` — добавил новый тип контента страницы

### 6.3 Ключевые паттерны в БД

#### UUID как первичный ключ

Все таблицы используют UUID вместо числовых ID:
```sql
id UUID DEFAULT uuid_generate_v4() PRIMARY KEY
```

**Зачем**: UUID гарантирует уникальность без координации между серверами, не раскрывает счётчики (нельзя угадать существование записи), безопасен при merge данных.

**Минус**: UUID занимает больше места (16 байт vs 4 байта), чуть медленнее как индекс.

#### JSONB поля

Многие таблицы используют JSONB для хибридного хранения структурированных данных:
```sql
attachments JSONB    -- В сообщениях чата: [{id, filename, path, size}]
settings JSONB       -- В пользователях: произвольные настройки
workflowConfig JSONB -- В досках отзывов: граф React Flow
```

**Зачем**: позволяет хранить динамические/расширяемые данные без изменения схемы. PostgreSQL поддерживает индексы на JSONB (GIN) и операции выборки по вложенным полям.

#### Paranoid (мягкое удаление)

Модель `Review` использует `paranoid: true`:
```js
Review = sequelize.define('Review', {...}, { paranoid: true });
```

Sequelize добавляет поле `deletedAt`. При `review.destroy()` запись не удаляется физически — только ставится `deletedAt = NOW()`. При обычных запросах `findAll` Sequelize автоматически добавляет `WHERE deletedAt IS NULL`.

**Зачем**: возможность восстановить случайно удалённые данные.

#### ARRAY типы

PostgreSQL поддерживает хранение массивов в колонке:
```sql
keywords TEXT[]          -- В pages: массив ключевых слов
allowedRoles UUID[]      -- В pages/folders: массив UUID ролей
```

Sequelize: `type: DataTypes.ARRAY(DataTypes.UUID)`.

---

## 7. Frontend — React

### 7.1 Структура React-приложения

React — это библиотека для построения пользовательского интерфейса. Главная идея: **UI = функция от состояния**.

```js
// Компонент — это функция, возвращающая JSX
function UserCard({ user }) {
  return (
    <div className="user-card">
      <img src={user.avatar} alt={user.displayName} />
      <span>{user.displayName}</span>
    </div>
  );
}
```

JSX — это синтаксический сахар над `React.createElement()`. Выглядит как HTML, но это JavaScript.

#### Жизненный цикл компонента (хуки)

```js
// useState — локальное состояние компонента
const [users, setUsers] = useState([]);
const [loading, setLoading] = useState(true);

// useEffect — побочные эффекты (загрузка данных, подписки)
useEffect(() => {
  // Выполняется после рендера
  api.users.getList().then(data => {
    setUsers(data);
    setLoading(false);
  });
}, []); // [] означает "только при монтировании компонента"

// useEffect с зависимостями
useEffect(() => {
  // Выполняется при каждом изменении userId
  fetchUser(userId);
}, [userId]);
```

### 7.2 Роутинг (React Router)

React Router — клиентский роутинг. Страница не перезагружается при переходе, меняется только URL и рендерится другой компонент.

```js
// App.js
<Routes>
  <Route path="/login" element={<Login />} />
  <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
  <Route path="/page/:slug" element={<ProtectedRoute><PageView /></ProtectedRoute>} />
</Routes>
```

`ProtectedRoute` — обёртка, которая проверяет авторизацию и перенаправляет на `/login` если не залогинен.

`:slug` — динамический параметр, доступен в компоненте через:
```js
const { slug } = useParams(); // Из react-router-dom
```

#### Полная таблица маршрутов

| Путь | Компонент | Доступ |
|------|-----------|--------|
| `/login` | Login | Публичный |
| `/` | Dashboard | Залогинен |
| `/page/:slug` | PageView | Залогинен |
| `/page/:slug/edit` | PageEditor | Залогинен |
| `/new-page` | PageEditor | Залогинен |
| `/profile` | Profile | Залогинен |
| `/favorites` | Favorites | Залогинен |
| `/calendar` | Calendar | Залогинен |
| `/kanban` | BoardsList | Залогинен |
| `/kanban/board/:id` | Kanban | Залогинен |
| `/kanban/board/:id/settings` | BoardSettings | Залогинен |
| `/kanban/board/:id/archive` | KanbanArchive | Залогинен |
| `/reviews` | ReviewBoardsList | adminAccess.reviews |
| `/reviews/board/:id` | ReviewBoard | adminAccess.reviews |
| `/reviews/board/:id/settings` | ReviewBoardSettings | adminAccess.reviews |
| `/reviews/board/:id/stats` | ReviewStatistics | adminAccess.reviews |
| `/reviews/archive` | ReviewArchive | adminAccess.reviews |
| `/courses` | Courses | Залогинен |
| `/courses/:id` | CourseView | Залогинен |
| `/explorer` | AdminPages | Залогинен |
| `/referral-bonuses` | ReferralBonusesPage | Залогинен |
| `/admin/users` | AdminUsers | adminAccess.users |
| `/admin/roles` | AdminRoles | adminAccess.roles |
| `/admin/sidebar` | AdminSidebar | adminAccess.sidebar |
| `/admin/settings` | AdminSettings | adminAccess.settings |
| `/admin/backup` | AdminBackup | adminAccess.backup |
| `/admin/courses` | AdminCourses | adminAccess.courses |
| `/admin/journal` | AdminJournal | adminAccess.journal |
| `/admin/bots` | AdminBots | isAdmin |
| `/admin/referral-bonuses-access` | AdminRbAccess | isAdmin |

### 7.3 Контексты (Context API)

Context — механизм React для "глобального состояния" без передачи props через все уровни дерева.

Все три контекста оборачивают приложение в `App.js`:
```
BrowserRouter
  └── AuthProvider          ← AuthContext
        └── SocketProvider  ← SocketContext
              └── ThemeProvider ← ThemeContext
                    └── Layout (всё приложение)
```

#### AuthContext.js

Самый важный контекст. Хранит данные о текущем пользователе.

```js
const { user, isAdmin, hasAdminAccess, login, logout } = useContext(AuthContext);
// Или через хук:
const { user } = useAuth(); // если есть кастомный хук
```

**Что хранится:**
- `user` — объект пользователя (id, displayName, adminAccess, роли и т.д.)
- `loading` — загружается ли данные пользователя

**Что умеет:**
- `login(username, password)` — вызывает API, сохраняет токен в `localStorage`
- `logout()` — очищает токен и пользователя
- `updateUser(data)` — обновляет данные пользователя без перезагрузки
- `refreshUser()` — перезапрашивает данные пользователя с сервера
- `hasPermission(resource, action)` — проверяет через роли
- `hasAdminAccess(section)` — проверяет `user.adminAccess[section]`

**Хранение в localStorage:**
```js
localStorage.setItem('token', token);
localStorage.setItem('user', JSON.stringify(user));
```
При загрузке страницы контекст восстанавливает состояние из localStorage.

#### SocketContext.js

Управляет WebSocket-соединением.

После логина создаётся Socket.IO соединение с сервером. Контекст слушает события и:
- Показывает системные уведомления Tauri при новых сообщениях
- Проигрывает звук уведомления (`/sounds/notification.mp3`)
- Обновляет иконку в трее (canvas-рисует красный кружок с цифрой)
- При клике на уведомление вызывает `bring_to_front` (Tauri команда)

#### ThemeContext.js

Тёмная/светлая тема. Переключается в профиле пользователя.

### 7.4 Страницы (Pages)

Каждая страница — это React-компонент, соответствующий одному URL. Обычная структура страницы:

```js
// Упрощённый пример
function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    loadUsers();
  }, []);
  
  const loadUsers = async () => {
    const data = await api.users.getAll();
    setUsers(data);
    setLoading(false);
  };
  
  const handleDelete = async (id) => {
    await api.users.delete(id);
    loadUsers(); // Перезагружаем список
    toast.success('Пользователь удалён');
  };
  
  if (loading) return <div>Загрузка...</div>;
  
  return (
    <div>
      {users.map(user => (
        <UserRow key={user.id} user={user} onDelete={handleDelete} />
      ))}
    </div>
  );
}
```

### 7.5 Компоненты

Компоненты — переиспользуемые блоки UI. Ключевые:

#### Layout.js
Главная оболочка приложения после логина. Рендерит:
- Левую боковую панель (Sidebar)
- Верхнюю навигацию (Header)
- Область контента (Outlet из React Router)

#### Editor.js / EditorExtensions.js
TipTap — это расширяемый WYSIWYG-редактор. В проекте зарегистрированы расширения для:
- Заголовков, списков, таблиц
- Вставки изображений и видео
- Вставки ссылок
- Code blocks с подсветкой синтаксиса
- И многого другого

#### SpreadsheetEditor.js
Интеграция с двумя движками:
- **Univer** (современный, основной) — Excel-подобный редактор
- **LuckySheet** (устаревший, fallback) — для старых страниц

#### ContentRenderer.js
Рендерит содержимое вики-страниц в зависимости от `contentType`:
- `wysiwyg` — HTML от TipTap
- `html` — чистый HTML с CSS/JS (опасный режим!)
- `spreadsheet` — таблица Univer/LuckySheet
- `file` — предпросмотр прикреплённого файла

#### ReviewWorkflowEditor.js
Редактор автоматизации на базе React Flow. Позволяет строить граф:
- Узлы-триггеры (при создании/смене статуса)
- Узлы-действия (назначить исполнителя)

### 7.6 API-клиент (axios)

`frontend/src/services/api.js` — централизованное место всех HTTP-запросов к backend.

#### Как определяется BASE_URL

```js
// Приоритет:
// 1. Переменная окружения REACT_APP_API_URL
// 2. Если Tauri (desktop app): http://192.168.22.39:9001
// 3. Иначе: текущий хост + порт 9001
const BASE_URL = process.env.REACT_APP_API_URL 
  || (isTauri ? 'http://192.168.22.39:9001' : `${window.location.protocol}//${window.location.hostname}:9001`);
```

#### Интерцепторы

```js
// Request interceptor — добавляет токен к каждому запросу
axiosInstance.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor — обрабатывает 401 (токен истёк)
axiosInstance.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.clear();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

#### Структура API-объекта

```js
export const api = {
  auth: {
    login: (data) => axiosInstance.post('/api/auth/login', data),
    me: () => axiosInstance.get('/api/auth/me'),
    // ...
  },
  users: {
    getAll: () => axiosInstance.get('/api/users'),
    getById: (id) => axiosInstance.get(`/api/users/${id}`),
    create: (data) => axiosInstance.post('/api/users', data),
    update: (id, data) => axiosInstance.put(`/api/users/${id}`, data),
    delete: (id) => axiosInstance.delete(`/api/users/${id}`),
  },
  // ... 32 пространства имён
};
```

---

## 8. Реальное время — Socket.IO

Socket.IO — библиотека для двусторонней связи в реальном времени. В отличие от HTTP (запрос-ответ), WebSocket — это постоянное соединение.

### Как это работает

```
Браузер открывается → Socket.IO устанавливает WebSocket соединение
Сервер может PUSH данные в браузер без запроса
Браузер может слать события на сервер без HTTP-запроса
```

### Архитектура комнат (rooms)

Socket.IO использует концепцию "комнат" для адресной доставки:

```js
// При подключении пользователя:
socket.on('join', (userId) => {
  socket.join(`user_${userId}`); // Личная комната пользователя
});

// При входе в чат:
socket.on('join_chat', (chatId) => {
  socket.join(`chat_${chatId}`); // Комната конкретного чата
});
```

### Серверные события

| Событие | Откуда | Кому | Данные |
|---------|--------|------|--------|
| `new_message` | При отправке сообщения | Комната чата | Объект сообщения |
| `message_updated` | При редактировании | Комната чата | Обновлённое сообщение |
| `message_deleted` | При удалении | Комната чата | `{messageId}` |
| `user_status_changed` | При disconnect/connect | Всем | `{userId, status, lastSeen}` |
| `typing_start` / `typing_stop` | При наборе текста | Комната чата | `{userId, chatId}` |
| `new_notification` | Из notificationService | Комната пользователя | Объект уведомления |
| `bring_to_front` | Из notificationService | Комната пользователя | — |

### Состояние онлайн пользователей

Сервер хранит Map `onlineUsers: Map<userId, Set<socketId>>` — у одного пользователя может быть несколько соединений (разные вкладки/устройства).

При disconnect: если `Set<socketId>` становится пустым — пользователь считается offline, обновляется `user.lastSeen = now()`.

---

## 9. Ключевые модули проекта

### 9.1 Вики-страницы (Pages)

#### Типы страниц (`contentType`)
- `wysiwyg` — TipTap WYSIWYG редактор
- `html` — Чистый HTML с CodeMirror редактором (кастомный CSS/JS)
- `spreadsheet` — Таблица (Univer/LuckySheet)
- `file` — Прикреплённый файл из медиатеки

#### Slug vs ID
Страницы идентифицируются по `slug` (человекочитаемый URL): `/page/doctor-oncology`. Slug должен быть уникальным.

#### Система прав на страницы
Поле `allowedRoles: UUID[]` — только пользователи с этими ролями видят страницу. Пустой массив = доступно всем.

#### История изменений
Каждое сохранение страницы создаёт запись в `page_history` с `diff` изменений. Просматривается в `PageHistoryModal`.

#### Полнотекстовый поиск
При создании/обновлении страницы данные индексируются в таблице `search_index`. Поиск работает по полям: title, content, keywords. Поддерживается нечёткий поиск (`fulltext`) и подсказки (`suggest`).

### 9.2 Чат

#### Архитектура
- `chats` — описание беседы (название, тип, аватар)
- `chat_members` — связь пользователь↔беседа с индивидуальными настройками
- `messages` — сообщения с JSONB вложениями

#### Типы чатов
- `private` — 1 на 1 (создаётся/находится через `POST /api/chat/private`)
- `group` — группы

#### Специальные члены
Боты тоже являются Users с флагом `isBot: true`. Уведомления от системы — это сообщения в чате от бота «Ассистент».

#### Вложения (attachments)
Файлы не хранятся в сообщении — хранятся пути к файлам:
```json
[
  { "id": "uuid", "filename": "file.pdf", "path": "/uploads/chat/...", "size": 1024 }
]
```

#### Пересылка сообщений
При пересылке заполняется `forwardedFrom: {chatId, chatName, senderName, originalDate}`.

### 9.3 Канбан

#### Доски и задачи
- `KanbanBoard` — доска с владельцем
- `BoardPermission` — права: `owner`, `editor`, `viewer`
- `KanbanTask` — задача с полями:
  - `status` — произвольная строка (backlog, todo, in_progress, done и т.д.)
  - `assigneeIds` — JSONB массив UUID исполнителей
  - `subtasks` — JSONB `[{id, text, completed}]`
  - `attachments` — JSONB вложения
  - `tags` — JSONB теги

#### Проверка доступа
```
GET /api/kanban/check-access → { hasAccess: true, role: 'editor' }
```
Route handler использует это для рендера кнопок "редактировать"/"удалить".

### 9.4 Отзывы (Reviews)

Это самый сложный модуль. Представляет собой Канбан для работы с отзывами пациентов.

#### Статусы (фиксированные 5 штук)
```
new → in_progress → request_info → verification_done → final
```
Хранятся в `backend/config/reviewStatuses.js` и `frontend/src/utils/reviewConstants.js`.

#### Workflow автоматизации
В каждой доске можно настроить автоматику через визуальный граф (React Flow):
1. Пользователь строит граф в `ReviewWorkflowEditor.js`
2. Граф (nodes + edges) сохраняется в `ReviewBoard.workflowConfig` (JSONB)
3. При событиях (`review_created`, `status_changed`) `workflowEngine.js` исполняет граф

#### Специальные роли на доске
```
creator          — добавляет новые отзывы
negative_handler — обрабатывает негативные отзывы  
reviewer         — проверяет выполненную работу
publisher        — публикует ответ
```

#### Синхронизация с агрегаторами
`ReviewSyncConfig` хранит настройки для каждого провайдера:
- `provider`: getloyalty, google, yandex, prodoctorov, docdoc, napopravku, 2gis, doctu
- `credentials` — JSONB с ключами API
- `lastSyncAt`, `lastSyncCount` — статистика

Запуск: 4 раза в день через `reviewSyncCron.js` или вручную через `POST /api/reviews/sync/:configId/run`.

#### PDF-отчёт
Каждый финализированный отзыв можно скачать как PDF (`GET /api/reviews/:id/pdf`). Генерируется через `pdfService.js`.

### 9.5 Курсы (Courses)

#### Структура
```
Course
  └── Lesson (несколько уроков, с sortOrder)
  └── TestQuestion (вопросы для финального теста)
  └── CourseProgress (прогресс каждого пользователя)
```

#### Прохождение курса
1. Пользователь открывает курс — создаётся/обновляется `CourseProgress`
2. После каждого урока: `POST /courses/:courseId/lessons/:lessonId/complete`
3. После всех уроков — тест: `GET /courses/:courseId/test` → вопросы
4. Ответы: `POST /courses/:courseId/test/submit` → `{score, passed}`
5. Проходной балл — настраивается в курсе

#### Доступ
Курс может быть ограничен по ролям AND медцентрам (обе проверки должны пройти).

### 9.6 Почта (Email)

#### Два транспортера
- **Системный** — для 2FA и технических писем. Отправляется всегда.
- **Рассылочный** — для маркетинговых/массовых рассылок. Может быть другой SMTP с лучшим рейтингом.

#### Шаблоны (EmailTemplate)
Хранят HTML + subject. Публичные шаблоны (`isPublic: true`) видны всем пользователям.

#### Избранные шаблоны
Каждый пользователь может добавить шаблон в избранное (`EmailFavoriteTemplate`).

#### Получатели
При отправке можно выбрать:
- Конкретного пользователя по имени
- Всех пользователей с определённой ролью
- Загрузить список из Excel
- Из сохранённых избранных получателей (`EmailFavoriteRecipient`)

### 9.7 Зарплатный модуль

Самый сложный модуль с точки зрения бизнес-логики.

#### Основные сущности
- `HourNorm` — нормо-часы по профессии/месяцу (плановые)
- `ReferralBonus` — бонус врачу за направление к другому врачу (% от суммы услуги)
- `PerformedServiceBonus` — бонус за выполнение конкретной услуги (% от суммы)
- `ServiceConsumable` — расходники к услуге (вычитаются из прибыли)
- `SalaryRecord` — готовый расчёт зарплаты (хранит отчёт + Excel-данные)
- `CashPayment` — запись о выплате наличными конкретному врачу

#### Источник данных
Данные о фактически выполненных услугах берутся из МИС (Renovatio) через `/api/mis/*`. Поле `misUserId` — ID врача в МИС.

#### Разграничение доступа
`RbUserPermission` хранит для каждого пользователя:
- `clinics` — список клиник, к которым есть доступ
- `tab1`, `tabHourNorms`, `tab2`, `tab3`... — уровень доступа к каждой вкладке (`edit` / `view` / `none`)

### 9.8 Телеграм-боты

#### Встроенный Telegram-бот
Настраивается через `TELEGRAM_BOT_TOKEN`. Используется для:
- Уведомлений об истекающих аккредитациях/ТО автомобилей
- Рассылок подписчикам (`TelegramSubscriber`)

#### Эмуляция Telegram Bot API
Проект реализует **совместимый с Telegram Bot API эндпоинт** — `/bot{token}/*`.

Это позволяет использовать стандартные Telegram Bot клиенты (python-telegram-bot, node-telegram-bot-api и т.д.), направив их на локальный сервер вместо `api.telegram.org`.

Боты создаются в `/admin/bots`. У каждого бота есть:
- Токен (`BotToken.token`)
- Webhook URL (куда слать обновления)
- Команды, описание

Сообщения из чата, направленные боту, создают `BotUpdate` записи и доставляются на webhook.

**Зачем это нужно**: внутренние боты-интеграции могут работать без доступа к внешнему интернету, используя только локальную сеть.

#### Пропущенные звонки (ATS)
`missedCallsCron.js` каждую минуту опрашивает Nextcloud (`MISSED_CALLS_NEXTCLOUD_URL`). При обнаружении пропущенного звонка:
1. Номер телефона сопоставляется с `MISSED_CALLS_ROUTE_{number}` переменными
2. Находится нужный Chat ID
3. Бот «ATC» пишет сообщение в этот чат

---

## 10. Деплой и инфраструктура

### PM2 (Process Manager 2)

PM2 — менеджер процессов Node.js. Аналог systemd для Node.js.

```bash
# Основные команды
pm2 start ecosystem.config.js   # Запуск по конфигу
pm2 restart alfa-wiki            # Рестарт процесса
pm2 stop alfa-wiki               # Остановка
pm2 logs alfa-wiki               # Просмотр логов
pm2 monit                        # Мониторинг в реальном времени
pm2 status                       # Статус всех процессов
```

**Конфигурация `ecosystem.config.js`:**
```js
{
  name: 'alfa-wiki',
  script: 'server.js',
  cwd: './backend',
  exec_mode: 'fork',   // НЕ cluster! Socket.IO не поддерживает cluster без адаптера
  instances: 1,
  autorestart: true,
  max_restarts: 10,
}
```

**Логи**: `logs/pm2-error.log`, `logs/pm2-out.log` — ротируются автоматически.

### Как делается деплой (обновление кода)

```bash
# 1. Получить новый код
git pull origin main

# 2. Если изменились зависимости backend
cd backend && npm install

# 3. Если изменились зависимости frontend
cd ../frontend && npm install

# 4. Собрать frontend
cd frontend && npm run build

# 5. Применить миграции БД (если есть новые)
psql -d alfa_wiki -f "backend/migrations/новая-миграция.sql"

# 6. Перезапустить backend
pm2 restart alfa-wiki
```

### Таури (Desktop App)

`frontend/src-tauri/` содержит конфиг Tauri 2 — обёртки для Windows.

```
productName: "Альфа Вики"
Цель: Windows NSIS installer
frontendDist: http://192.168.22.39:9001  (production — указывает на сервер!)
devUrl: http://localhost:9000
```

В production режиме Tauri-приложение — это просто WebView, открывающий URL сервера. Это значит: **один и тот же React-код** работает и в браузере, и в Desktop-приложении.

Tauri-специфичные возможности (только в desktop):
- Desktop-уведомления через `@tauri-apps/plugin-notification`
- Обновление иконки в трее (красный кружок с числом непрочитанных)
- `bring_to_front` — вывести окно на передний план при клике на уведомление

Определение среды в коде:
```js
const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;
```

### Мобильное приложение (React Native)

`mobile/` — React Native приложение. Пока находится в начальной стадии:
- Экраны: Auth (вход), Chat (чат)
- Сервисы: API, Socket.IO, VPN

Подключается к тому же серверу `192.168.22.39:9001`.

---

## 11. Переменные окружения (.env)

Файл `backend/.env` — **никогда не коммитится в git** (в `.gitignore`).
Шаблон: `backend/.env.example`.

| Переменная | Пример | Назначение |
|-----------|--------|------------|
| `PORT` | `9001` | Порт HTTP-сервера |
| `NODE_ENV` | `production` | Режим работы |
| `DB_HOST` | `localhost` | PostgreSQL хост |
| `DB_PORT` | `5432` | PostgreSQL порт |
| `DB_NAME` | `alfa_wiki` | Имя базы данных |
| `DB_USER` | `postgres` | Пользователь БД |
| `DB_PASSWORD` | `...` | Пароль БД |
| `JWT_SECRET` | 128-символьный hex | Секрет для подписи JWT |
| `JWT_EXPIRES_IN` | `12h` | Время жизни токена |
| `MAX_FILE_SIZE` | `52428800` | Лимит файла (50 MB) |
| `UPLOAD_PATH` | `./uploads` | Папка для загрузок |
| `BACKUP_PATH` | `./backups` | Папка для бэкапов |
| `BACKUP_RETENTION_DAYS` | `30` | Хранить бэкапы N дней |
| `TELEGRAM_BOT_TOKEN` | `8468685048:AAE...` | Основной Telegram-бот |
| `SMTP_HOST` | `mail.medcentralfa.ru` | SMTP для системных писем |
| `SMTP_PORT` | `465` | SMTP порт |
| `SMTP_SECURE` | `true` | SSL |
| `SMTP_USER` | `wiki@medcentralfa.ru` | SMTP логин |
| `SMTP_FROM` | `"Альфа Вики" <wiki@...>` | Отображаемый отправитель |
| `SMTP_HOST_BROADCAST` | (опционально) | SMTP для рассылок |
| `MIS_API_KEY` | `c58544b...` | Ключ Renovatio MIS API |
| `MIS_BASE_URL` | `https://rnova.medcentralfa.ru:3010/api/public` | URL МИС API |
| `MISSED_CALLS_NEXTCLOUD_URL` | `https://cloud.medcentralfa.ru/comfortel/...` | URL АТС |
| `MISSED_CALLS_ROUTE_{НОМЕР}` | UUID чата | Маршрут для конкретного номера |
| `MISSED_CALLS_FALLBACK_CHAT_ID` | UUID | Дефолтный чат при несовпадении |
| `FRONTEND_URL` | `http://...,http://...` | Допустимые URL для Socket.IO CORS |

---

## 12. Справочник: как что работает

### Как добавить нового пользователя?

```
/admin/users → кнопка «Добавить пользователя»
POST /api/users { username, password, displayName, email, isAdmin, adminAccess, ... }
```

### Как создать новую вики-страницу?

```
Кнопка «Новая страница» в сайдбаре
или /new-page
POST /api/pages { title, slug, content, contentType, folderId, allowedRoles }
```

### Как работает резервное копирование?

```
/admin/backup
POST /api/backup → выполняет pg_dump, архивирует uploads, создаёт .zip
GET /api/backup → список существующих бэкапов
GET /api/backup/download/:filename → скачать бэкап
POST /api/backup/restore/:filename → восстановить из бэкапа
```

### Как работает интеграция с МИС?

Renovatio MIS — внешняя система. Бэкенд делает HTTP-запросы к `MIS_BASE_URL` с API-ключом.

```
frontend → POST /api/mis/doctors → backend → POST rnova.medcentralfa.ru/api/public/doctors
```

`mis-proxy.js` — просто прокси, перенаправляет запросы с нужными заголовками.

Автоматическая синхронизация цен — через `analysesCron.js` и `servicesCron.js` (02:00 и 03:00 ежедневно).

### Как работает поиск?

```
GET /api/search?q=слово&type=page
```

1. `SearchIndex` таблица содержит денормализованные данные всех сущностей
2. При создании/обновлении страницы — индекс обновляется
3. Для переиндексации всего: `POST /api/search/index`

### Как отлаживать проблемы?

**Смотреть логи в реальном времени:**
```bash
pm2 logs alfa-wiki --lines 100
```

**Логи в файлах:**
```
logs/pm2-error.log   — ошибки Node.js
logs/pm2-out.log     — console.log вывод
```

**morgan** логирует все HTTP-запросы в консоль (в dev режиме):
```
GET /api/users 200 45ms
POST /api/pages 201 123ms
```

**Здоровье сервера:**
```bash
curl http://192.168.22.39:9001/api/health
```

### Как работает загрузка файлов?

**multer** — middleware для обработки multipart/form-data.

```
POST /api/media/upload → multer сохраняет файл в uploads/YYYY-MM/
sharp создаёт превью для изображений
Запись создаётся в таблице media
```

Структура папки uploads:
```
uploads/
├── 2025-01/       По дате загрузки
├── 2025-02/
├── avatars/       Аватары пользователей
├── chat-avatars/  Аватары групп
├── reviews/       PDF отчёты отзывов
│   └── 2026-04/
└── ...
```

### Паттерны кода, которые встречаются повсюду

**Async/Await с try/catch:**
```js
router.get('/', authenticate, async (req, res) => {
  try {
    const items = await Model.findAll({ where: { userId: req.user.id } });
    res.json(items);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

**Деструктуризация из req.body:**
```js
const { title, description, assigneeIds } = req.body;
```

**Sequelize findOrCreate:**
```js
const [instance, created] = await Model.findOrCreate({
  where: { userId, chatId },
  defaults: { role: 'member' }
});
```

**Sequelize update с findByPk:**
```js
const item = await Model.findByPk(req.params.id);
if (!item) return res.status(404).json({ error: 'Not found' });
await item.update(req.body);
res.json(item);
```

**React useState + useEffect паттерн:**
```js
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  const load = async () => {
    try {
      const result = await api.something.get();
      setData(result.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  load();
}, []);
```

---

*Документация создана на основе кода версии 3.26. При добавлении новых функций — обновляйте соответствующие разделы.*
