# Глава 4. База данных и Sequelize

Эта глава — подробный разбор всех таблиц, их полей, связей и паттернов проектирования БД. Понимание структуры данных — ключ к пониманию работы всей системы.

---

## Как Sequelize соединяется с PostgreSQL

В `models/index.js` происходит инициализация соединения:

```js
const sequelize = new Sequelize(
  process.env.DB_NAME,      // 'alfa_wiki'
  process.env.DB_USER,      // 'postgres'
  process.env.DB_PASSWORD,  // пароль
  {
    host: process.env.DB_HOST,  // 'localhost'
    port: process.env.DB_PORT,  // 5432
    dialect: 'postgres',
    
    // Пул соединений — не создавать новое соединение на каждый запрос
    pool: {
      max: 10,      // Максимум 10 одновременных соединений
      min: 0,       // Минимум 0 (освобождать при простое)
      acquire: 30000, // Таймаут получения соединения из пула (30 сек)
      idle: 10000     // Закрыть простаивающее соединение через 10 сек
    },
    
    timezone: '+00:00',  // UTC
    logging: false       // Не логировать SQL-запросы (в dev можно включить)
  }
);
```

**Пул соединений** — важная концепция. Открытие TCP-соединения к PostgreSQL — дорогая операция. Пул держит несколько открытых соединений и переиспользует их. При запросе — берётся свободное соединение из пула, после завершения — возвращается обратно.

В конце `models/index.js` выполняется:
```js
await sequelize.authenticate(); // Проверить что соединение работает
// Опционально: sequelize.sync() — создать таблицы если нет
// Но в проекте используются явные SQL-миграции, не sync
```

---

## Все типы данных которые используются

Прежде чем разбирать модели — разберём типы данных Sequelize и их соответствие PostgreSQL:

| Sequelize | PostgreSQL | Описание |
|-----------|-----------|----------|
| `DataTypes.UUID` | `UUID` | 36-символьный идентификатор: `550e8400-e29b-41d4-a716-446655440000` |
| `DataTypes.UUIDV4` | — | Автогенерация UUID версии 4 (случайный) |
| `DataTypes.STRING(n)` | `VARCHAR(n)` | Строка с ограничением длины |
| `DataTypes.TEXT` | `TEXT` | Неограниченный текст |
| `DataTypes.INTEGER` | `INTEGER` | Целое число (4 байта, до 2 млрд) |
| `DataTypes.BIGINT` | `BIGINT` | Большое целое (8 байт, до 9×10¹⁸) |
| `DataTypes.FLOAT` | `FLOAT` | Число с плавающей точкой |
| `DataTypes.DECIMAL(10,2)` | `DECIMAL(10,2)` | Точное десятичное (для денег!) |
| `DataTypes.BOOLEAN` | `BOOLEAN` | true/false |
| `DataTypes.DATE` | `TIMESTAMP WITH TIME ZONE` | Дата и время |
| `DataTypes.DATEONLY` | `DATE` | Только дата (без времени) |
| `DataTypes.ENUM(...)` | `ENUM` | Ограниченный набор строковых значений |
| `DataTypes.JSONB` | `JSONB` | JSON с индексированием |
| `DataTypes.ARRAY(type)` | `type[]` | Массив значений |

**Почему DECIMAL для денег, не FLOAT?** FLOAT — число с плавающей точкой, оно не может точно представить многие десятичные дроби. `0.1 + 0.2 = 0.30000000000000004` в JavaScript/IEEE754. DECIMAL(10,2) хранит точно 10 цифр с 2 знаками после запятой — идеально для денежных сумм.

---

## Ключевые паттерны проектирования БД

Прежде чем разбирать каждую модель, разберём паттерны которые встречаются повсюду.

### UUID как первичный ключ

Во всех таблицах первичный ключ — UUID:
```js
id: {
  type: DataTypes.UUID,
  defaultValue: DataTypes.UUIDV4,  // Генерируется автоматически
  primaryKey: true
}
```

**Почему UUID, а не автоинкремент (1, 2, 3...)?**

1. **Нет последовательности** — UUID генерируется без обращения к БД. Можно создать объект в браузере с заранее известным ID.
2. **Безопасность** — по UUID нельзя угадать сколько записей в таблице (`/api/reviews/550e...` не раскрывает что записей 100 или 100000).
3. **Будущий merge данных** — если когда-то понадобится объединить данные из двух экземпляров приложения, UUID гарантирует отсутствие коллизий.

**Минус**: UUID занимает 16 байт (vs 4 байта INT) и чуть медленнее как индекс. Для нашего масштаба — не критично.

**Исключение**: таблицы `int_id_map`, `bot_updates`, `partner_service_cache` используют числовые ID — там это нужно для совместимости с Telegram Bot API (он работает с числовыми ID).

### JSONB поля — хранение гибких структур

PostgreSQL JSONB (Binary JSON) — не просто строка с JSON. Это:
- Бинарное хранение (быстрее парсинг)
- Возможность индексирования (GIN-индекс)
- Операторы запросов (`@>`, `?`, `->`)

В проекте JSONB используется для:

```js
// Произвольные настройки пользователя
settings: { type: DataTypes.JSONB, defaultValue: {} }

// Права администрирования — каждый ключ — раздел
adminAccess: { 
  type: DataTypes.JSONB, 
  defaultValue: { pages: false, users: false, reviews: false, ... }
}

// Вложения в сообщениях
attachments: { type: DataTypes.JSONB }
// Формат: [{ id, filename, path, size, mimeType, uploadedAt }]

// Workflow граф для отзывов
workflowConfig: { type: DataTypes.JSONB }
// Формат: { scenarios: [{ id, name, nodes: [...], edges: [...] }] }
```

**Когда использовать JSONB, когда отдельную таблицу?**

JSONB хорош когда:
- Структура данных непредсказуема или часто меняется
- Данные всегда читаются вместе с основной записью (не нужны отдельные запросы)
- Нет необходимости делать сложные SQL-выборки по вложенным полям

Отдельная таблица лучше когда:
- Нужно искать/фильтровать по этим данным
- Данных много и они должны быть нормализованы
- Нужны ссылочная целостность и каскадные удаления

### ARRAY типы

```js
allowedRoles: { type: DataTypes.ARRAY(DataTypes.UUID) }
keywords: { type: DataTypes.ARRAY(DataTypes.STRING) }
```

Массивы в PostgreSQL — нативный тип. Запрос "найди все страницы, доступные для роли X":
```js
await Page.findAll({
  where: {
    [Op.or]: [
      { allowedRoles: { [Op.contains]: [roleId] } },  // roleId входит в массив
      { allowedRoles: { [Op.eq]: [] } }                // или массив пуст (все могут)
    ]
  }
});
```

### timestamps — автоматические даты

По умолчанию в Sequelize каждая модель имеет:
```
createdAt TIMESTAMP   — время создания записи (автоматически)
updatedAt TIMESTAMP   — время последнего обновления (автоматически)
```

Sequelize обновляет `updatedAt` при каждом `save()` или `update()`. Это удобно — не нужно ставить руками.

Для некоторых таблиц (`PageHistory`, `ReviewHistory`) отключено `updatedAt: false` — история не должна "обновляться".

### paranoid — мягкое удаление

```js
Review = sequelize.define('Review', {...}, { paranoid: true });
```

При `paranoid: true` Sequelize добавляет поле `deletedAt TIMESTAMP`. Вместо `DELETE` выполняется `UPDATE SET deletedAt = NOW()`. Все `findAll` автоматически фильтруют `WHERE deletedAt IS NULL`.

Восстановление:
```js
await review.restore();  // SET deletedAt = NULL
```

Найти включая удалённые:
```js
await Review.findAll({ paranoid: false });
```

---

## Полный разбор всех моделей

### Группа 1: Пользователи и права

#### User — центральная модель всей системы

Модель User — самая большая (58 полей). Хранит всё о пользователе.

**Идентификация:**
- `id` UUID — первичный ключ
- `username` STRING(50) unique — логин для входа
- `password` STRING(255) — bcrypt-хэш пароля (не хранить plain text!)
- `displayName` STRING(100) — имя как отображается в интерфейсе
- `email` STRING(255) — для 2FA-кодов и уведомлений
- `avatar` STRING(500) — путь к файлу аватара

**Статус:**
- `isActive` BOOLEAN — деактивированный пользователь не может войти
- `isAdmin` BOOLEAN — полный доступ ко всему
- `lastLogin` DATE — когда последний раз входил
- `lastSeen` DATE — когда последний раз был онлайн (обновляется Socket.IO)

**Гранулярные права (adminAccess JSONB):**
```json
{
  "pages":    true,   // Управление вики-страницами
  "sidebar":  true,   // Редактирование боковой панели
  "users":    false,  // Управление пользователями
  "roles":    false,  // Управление ролями
  "media":    true,   // Медиатека
  "backup":   false,  // Резервные копии
  "settings": false,  // Настройки приложения
  "courses":  true,   // Управление курсами
  "kanban":   true,   // Администрирование Канбан
  "journal":  true,   // Просмотр журнала изменений
  "reviews":  true    // Модуль отзывов
}
```

Полный администратор (`isAdmin: true`) не проверяет `adminAccess` — у него всё разрешено. `adminAccess` используется для настройки ограниченных администраторов (например, "может только управлять курсами").

**Специфические флаги (boolean):**
- `canEditDoctorCards` — редактировать карточки врачей
- `canEditAnalyses` — редактировать справочник анализов
- `canEditServices` — редактировать справочник услуг
- `canAccessSalary` — доступ к зарплатному модулю
- `isBot` — системный пользователь-бот
- `canManagePromotions` — управление акциями

**2FA (двухфакторная аутентификация):**
- `twoFactorEnabled` BOOLEAN — включена ли 2FA
- `twoFactorCode` STRING(6) — текущий 6-значный код
- `twoFactorCodeExpires` DATE — время истечения кода
- `twoFactorAttempts` INTEGER — количество неверных попыток ввода

**Пользовательские настройки (settings JSONB):**
Хранит произвольные настройки интерфейса: тема (тёмная/светлая), язык, настройки уведомлений.

#### Role — роли доступа

```js
Role {
  id: UUID,
  name: STRING(100) unique,  // 'Врач', 'Менеджер', 'Администратор'
  description: TEXT,
  permissions: JSONB,         // { pages: { read, write, delete, admin } }
  isSystem: BOOLEAN           // Системная роль (нельзя удалить)
}
```

Роли связаны с пользователями через M2M таблицу `user_roles`.

Структура `permissions`:
```json
{
  "pages": {
    "read":   true,
    "write":  true,
    "delete": false,
    "admin":  false
  }
}
```

Каждый ресурс (`pages`, `courses` и т.д.) может иметь набор действий. Такая структура позволяет гибко настраивать права без изменения схемы БД.

#### Setting — настройки приложения

```js
Setting {
  key: STRING(100) PRIMARY KEY,  // 'app_name', 'maintenance_mode'
  value: JSONB,                  // Произвольное значение
  description: TEXT
}
```

Это простое key-value хранилище для настроек всей системы. Инициализируется через `POST /api/settings/init`.

---

### Группа 2: Вики-страницы

#### Page — основная сущность вики

```js
Page {
  id: UUID,
  slug: STRING(255) unique,        // 'doctor-oncology', 'hr-regulations'
  title: STRING(500),
  content: TEXT,                   // HTML (wysiwyg), JSON (spreadsheet), HTML (html)
  contentType: ENUM,               // 'wysiwyg' | 'html' | 'spreadsheet' | 'file'
  description: TEXT,               // Краткое описание для поиска
  keywords: ARRAY(STRING),         // Ключевые слова для поиска
  searchContent: TEXT,             // Оптимизированный текст для FTS
  icon: STRING(50),                // Emoji или имя иконки
  folderId: UUID,                  // Папка где находится страница
  sortOrder: INTEGER,              // Порядок в папке
  isPublished: BOOLEAN,            // Видна всем (true) или только редакторам
  isFavorite: BOOLEAN,             // Устаревшее поле
  allowedRoles: ARRAY(UUID),       // Ограничение по ролям (пустой = все)
  customCss: TEXT,                 // Кастомный CSS (для html-страниц)
  customJs: TEXT,                  // Кастомный JavaScript
  metadata: JSONB,                 // Доп. метаданные
  mediaId: UUID,                   // Прикреплённый файл (для contentType='file')
  createdBy: UUID,                 // Кто создал
  updatedBy: UUID                  // Кто последний редактировал
}
```

**slug** — это человекочитаемый идентификатор страницы. URL: `/page/doctor-oncology`. Должен быть уникальным. Определяет URL, по которому страница доступна.

**contentType** определяет как рендерить контент:
- `wysiwyg` — HTML от TipTap, рендерится через `dangerouslySetInnerHTML`
- `html` — чистый HTML, рендерится в `<iframe>` или с полным стилизованием
- `spreadsheet` — JSON для Univer/LuckySheet
- `file` — `mediaId` указывает на файл в таблице `media`

**allowedRoles** — если пустой массив (`[]`), страница доступна всем авторизованным. Если содержит UUID ролей — только пользователям с этими ролями.

#### Folder — папки для страниц

```js
Folder {
  id: UUID,
  title: STRING(255),
  icon: STRING(50),
  parentId: UUID,           // Self-reference: папка внутри папки
  sortOrder: INTEGER,
  description: TEXT,
  createdBy: UUID,
  allowedRoles: ARRAY(UUID)  // Ограничение по ролям
}
```

Папки образуют дерево (иерархию). `parentId` ссылается на `id` той же таблицы. Корневые папки имеют `parentId: null`.

#### SidebarItem — элементы боковой навигации

```js
SidebarItem {
  id: UUID,
  type: ENUM,         // 'page' | 'folder' | 'header' | 'link' | 'divider'
  title: STRING(255),
  icon: STRING(50),
  pageId: UUID,       // Для type='page'
  folderId: UUID,     // Для type='folder'
  externalUrl: STRING(1000),  // Для type='link'
  parentId: UUID,     // Self-reference: вложенность в сайдбаре
  sortOrder: INTEGER,
  isExpanded: BOOLEAN,
  allowedRoles: ARRAY(UUID),
  isVisible: BOOLEAN
}
```

Сайдбар — это отдельная от структуры папок навигация. Администратор строит её вручную: добавляет заголовки, ссылки на страницы, вложенность, разделители.

#### PageHistory — история изменений

```js
PageHistory {
  id: UUID,
  pageId: UUID,
  userId: UUID,         // Кто изменил
  action: ENUM,         // 'created' | 'updated' | 'published' | 'unpublished'
  changesSummary: TEXT, // Текстовое описание изменений (diff)
  metadata: JSONB       // Доп. данные
  // updatedAt отключён — история не меняется
}
```

При каждом сохранении страницы создаётся запись. `changesSummary` — это текстовый diff (пакет `diff`): показывает что именно изменилось в тексте.

---

### Группа 3: Чат

#### Chat — беседа

```js
Chat {
  id: UUID,
  name: STRING(255),         // Название группы (для private — null)
  type: ENUM,                // 'private' | 'group'
  avatar: STRING(500),       // Путь к файлу аватара группы
  lastMessage: TEXT,         // Текст последнего сообщения (для превью)
  lastMessageAt: DATE,       // Для сортировки чатов
  createdBy: UUID
}
```

#### ChatMember — участник беседы

```js
ChatMember {
  id: UUID,
  chatId: UUID,
  userId: UUID,
  role: ENUM,                    // 'admin' | 'member'
  lastReadAt: DATE,              // До этого момента сообщения считаются прочитанными
  isNotificationMuted: BOOLEAN,  // Выключить уведомления
  isHidden: BOOLEAN,             // Скрыть чат из списка
  isPinned: BOOLEAN,             // Закрепить чат
  pinnedOrder: INTEGER,          // Порядок среди закреплённых
  isReadOnly: BOOLEAN            // Только читать (не писать)
}
// UNIQUE (chatId, userId) — один человек один раз в беседе
```

Количество непрочитанных сообщений вычисляется через:
```sql
SELECT COUNT(*) FROM messages 
WHERE chatId = :chatId 
AND createdAt > (SELECT lastReadAt FROM chat_members WHERE chatId = :chatId AND userId = :userId)
```

#### Message — сообщение

```js
Message {
  id: UUID,
  chatId: UUID,
  senderId: UUID,
  content: TEXT,              // Текст сообщения
  type: ENUM,                 // 'text' | 'image' | 'file' | 'system'
  attachments: JSONB,         // [{ id, filename, path, size, mimeType }]
  isEdited: BOOLEAN,
  replyToId: UUID,            // Ответ на другое сообщение
  forwardedFrom: JSONB,       // { chatId, chatName, senderName, originalDate }
  telegramMsgId: BIGINT       // ID в Telegram (для бот-мостов)
}
```

`type: 'system'` используется для системных сообщений: "Пользователь добавлен в группу", "Название изменено" и т.д.

Вложения хранятся как JSONB в сообщении, а файлы — в файловой системе. Это денормализация: данные о файле дублируются в поле сообщения и в файловой системе. Зато не нужен JOIN при загрузке сообщения.

---

### Группа 4: Медицинские данные

#### Accreditation — аккредитации врачей

```js
Accreditation {
  id: UUID,
  medCenter: ENUM,          // 'Альфа' | 'Кидс' | 'Проф' | 'Линия' | 'Смайл' | '3К'
  fullName: STRING(255),    // ФИО врача
  specialty: STRING(255),   // Специальность
  expirationDate: DATEONLY, // Дата истечения (только дата, без времени)
  comment: TEXT,
  isArchived: BOOLEAN,
  
  // Флаги отправленных напоминаний — чтобы не слать дважды
  reminded90: BOOLEAN,      // Напоминание за 90 дней отправлено
  reminded60: BOOLEAN,
  reminded30: BOOLEAN,
  reminded14: BOOLEAN,
  reminded7: BOOLEAN
}
```

Флаги `remindedXX` — важный паттерн. Cron-задача каждый день проверяет "какие аккредитации истекают через X дней". Без флага она бы отправляла уведомление снова каждый день. Флаг говорит: "это напоминание уже отправлено — пропустить".

#### Analysis + Service — справочники из МИС

```js
Analysis {
  id: UUID,
  lab: STRING(50),             // Лаборатория: 'invitro', 'helix', 'kdl'
  serviceCode: STRING(100),    // Код услуги в МИС
  serviceName: STRING(500),    // Название
  price: DECIMAL(10,2),        // Актуальная цена
  isStopped: BOOLEAN,          // Услуга приостановлена
  preparationLink: STRING,     // Ссылка на подготовку
  comment: TEXT,
  misServiceId: STRING(50),    // ID в МИС (для синхронизации)
  lastPriceUpdate: DATE        // Когда последний раз обновлялась цена
}
```

`Service` — такая же модель, но для медицинских услуг (не анализов). Добавлено поле `medCenter` и `pageSlug` (к какой вики-странице привязаны услуги).

Цены синхронизируются автоматически через cron в 02:00 и 03:00.

---

### Группа 5: Курсы

#### Course — курс обучения

```js
Course {
  id: UUID,
  title: STRING(255),
  description: TEXT,
  icon: STRING(50),               // Emoji
  estimatedDuration: INTEGER,     // Планируемое время в минутах
  createdBy: UUID,
  isPublished: BOOLEAN            // Виден пользователям
}
```

#### Lesson — урок

```js
Lesson {
  id: UUID,
  courseId: UUID,
  title: STRING(255),
  content: TEXT,       // HTML от TipTap
  sortOrder: INTEGER   // Порядок урока в курсе
}
```

#### TestQuestion — вопрос теста

```js
TestQuestion {
  id: UUID,
  courseId: UUID,
  question: TEXT,
  options: JSONB,        // ['Вариант A', 'Вариант B', 'Вариант C', 'Вариант D']
  correctAnswer: INTEGER, // 0-based индекс правильного ответа
  sortOrder: INTEGER
}
```

Хранение вариантов ответов в JSONB массиве — простое решение. Количество вариантов не фиксировано, нет нужды в отдельной таблице.

#### CourseProgress — прогресс пользователя

```js
CourseProgress {
  id: UUID,
  userId: UUID,
  courseId: UUID,
  completedLessons: JSONB,   // ['lesson-uuid-1', 'lesson-uuid-2', ...]
  currentLessonId: UUID,     // На каком уроке остановился
  testScore: INTEGER,        // Результат теста (0-100)
  testAttempts: INTEGER,     // Сколько раз проходил тест
  completedAt: DATE          // Когда завершил курс (null если не завершил)
}
// UNIQUE (userId, courseId)
```

---

### Группа 6: Канбан

#### KanbanTask — задача

```js
KanbanTask {
  id: UUID,
  title: STRING(500),
  description: TEXT,
  status: STRING(50),          // 'backlog', 'todo', 'in_progress', 'review', 'done' (произвольно)
  priority: STRING(20),        // 'low', 'medium', 'high', 'critical'
  assigneeIds: JSONB,          // ['user-uuid-1', 'user-uuid-2']  — массив исполнителей
  createdBy: UUID,
  boardId: UUID,
  tags: JSONB,                 // ['tag1', 'tag2']
  attachments: JSONB,          // [{ id, filename, path, size, uploadedAt }]
  subtasks: JSONB,             // [{ id, text, completed: boolean }]
  dueDate: DATE,
  sortOrder: INTEGER,
  metadata: JSONB,
  archived: BOOLEAN,
  archivedAt: DATE,
  completedAt: DATE            // Автоархивировать через N дней после completedAt
}
```

Подзадачи (`subtasks`) хранятся прямо в задаче как JSONB массив. Это денормализация — но подзадачи всегда читаются вместе с задачей, отдельный запрос не нужен.

---

### Группа 7: Отзывы (Review module)

#### ReviewBoard — доска для отзывов

```js
ReviewBoard {
  id: UUID,
  name: STRING(255),
  description: TEXT,
  ownerId: UUID,
  archived: BOOLEAN,
  
  // Настройки уведомлений — кому слать при каких событиях
  notificationSettings: JSONB,
  /* Пример:
  {
    "newReview": { "roles": ["role-uuid"], "users": ["user-uuid"] },
    "statusChange": { "roles": [], "users": ["user-uuid-1", "user-uuid-2"] },
    "assignment": { "roles": [], "users": [] }
  }
  */
  
  // Граф автоматизации (React Flow)
  workflowConfig: JSONB,
  /* Пример:
  {
    "scenarios": [{
      "id": "scenario-1",
      "name": "Новый негативный отзыв",
      "nodes": [
        { "id": "trigger-1", "type": "triggerNewReview", "data": { "condition": "negative" } },
        { "id": "action-1", "type": "actionAssign", "data": { "userIds": ["uuid"] } }
      ],
      "edges": [{ "source": "trigger-1", "target": "action-1" }]
    }]
  }
  */
  
  // Кастомные названия колонок
  columnNames: JSONB
  /* Пример:
  {
    "new": "Входящие",
    "in_progress": "В работе",
    "request_info": "Запрос информации",
    "verification_done": "Проверено",
    "final": "Закрыто"
  }
  */
}
```

#### Review — сам отзыв

```js
Review {
  id: UUID,
  boardId: UUID,
  patientName: STRING(255),
  reviewDate: DATEONLY,
  platformId: UUID,           // На какой платформе оставлен
  doctorName: STRING(255),
  rating: INTEGER,            // 1-5 звёзд
  reviewText: TEXT,
  additionalInfo: TEXT,       // Доп. информация (не из отзыва)
  
  status: STRING(50),         // 'new' | 'in_progress' | 'request_info' | 'verification_done' | 'final'
  attachments: JSONB,
  createdBy: UUID,
  assigneeIds: JSONB,         // UUID исполнителей
  sortOrder: INTEGER,
  archived: BOOLEAN,
  archivedAt: DATE,
  
  // Итог работы
  decisionCategory: STRING(50),    // 'resolved' | 'compensation' | 'refund' | 'clarification'
  decisionDescription: TEXT,
  finalizedAt: DATE,
  finalizedBy: UUID,
  reportPdfPath: STRING(1000),     // Путь к PDF-отчёту
  
  // Для автоимпортированных отзывов
  externalId: STRING(500),         // ID в системе агрегатора
  externalUrl: TEXT,               // Ссылка на оригинальный отзыв
  isAutoImported: BOOLEAN,
  syncedAt: DATE,
  importSource: STRING(50),        // 'getloyalty', 'google' и т.д.
  
  deletedAt: DATE                  // Paranoid: мягкое удаление
}
```

---

### Группа 8: Зарплата

#### ReferralBonus — реферальные бонусы

```js
ReferralBonus {
  id: UUID,
  misUserId: STRING(50),      // ID врача в МИС (не UUID — число как строка)
  doctorName: STRING(255),
  serviceCode: STRING(100),   // Код услуги в МИС
  serviceName: STRING(500),
  bonusPercent: DECIMAL(10,2), // % от стоимости услуги
  bonusRub: DECIMAL(10,2),     // Фиксированная сумма в рублях
  clinicId: STRING(50),        // ID клиники в МИС
  createdBy: UUID
}
// UNIQUE (misUserId, serviceCode, clinicId)
```

Уникальность по тройке `(врач, услуга, клиника)` — нельзя дважды задать бонус одному врачу за одну услугу в одной клинике.

#### SalaryRecord — запись расчёта зарплаты

```js
SalaryRecord {
  id: UUID,
  misUserId: STRING(50),
  doctorName: STRING(255),
  dateFrom: DATEONLY,
  dateTo: DATEONLY,
  periodLabel: STRING(100),   // 'Январь 2026', '1-15 апреля 2026'
  reportData: JSONB,          // Полные данные расчёта
  excelData: TEXT,            // Base64 Excel файл
  createdBy: UUID
}
```

`reportData` — это большой JSONB объект со всеми деталями расчёта: список услуг, суммы, бонусы, вычеты. `excelData` — готовый Excel файл в base64, чтобы не регенерировать при каждой загрузке.

---

### Группа 9: Telegram Bot API эмуляция

#### BotToken — токен бота

```js
BotToken {
  id: UUID,
  token: STRING(150) unique,      // Случайная строка — "токен" бота
  name: STRING(100),              // Имя бота ('Ассистент')
  username: STRING(100) unique,   // @username бота
  description: TEXT,
  userId: UUID,                   // Какой User представляет этот бот
  webhookUrl: TEXT,               // Куда слать обновления
  webhookSecretToken: STRING(256),
  allowedUpdates: ARRAY(TEXT),    // Типы обновлений: ['message', 'callback_query']
  maxConnections: INTEGER,
  commands: JSONB,                // [{ command: '/start', description: 'Начать' }]
  isActive: BOOLEAN,
  lastUpdateId: BIGINT            // Последний обработанный update_id
}
```

#### IntIdMap — маппинг UUID ↔ Integer

```js
IntIdMap {
  id: BIGINT autoincrement,   // Целочисленный ID (нужен для Telegram Bot API)
  uuid: UUID unique,          // Соответствующий UUID
  entityType: STRING(20)      // 'user' | 'chat'
}
```

Telegram Bot API работает с целочисленными ID (`from.id: 123456789`, `chat.id: -100987654`). В нашей системе всё — UUID. `IntIdMap` — словарь для конвертации. UUID `550e8400-...` ↔ целое число `42`.

---

## Связи между таблицами (ассоциации)

### One-to-Many (один ко многим)

```js
// Один пользователь — много сообщений
User.hasMany(Message, { foreignKey: 'senderId' });
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });

// Один чат — много сообщений  
Chat.hasMany(Message, { foreignKey: 'chatId' });
Message.belongsTo(Chat, { foreignKey: 'chatId' });
```

### Many-to-Many (много ко многим)

```js
// Пользователь ↔ Роль через user_roles
User.belongsToMany(Role, { through: 'user_roles', foreignKey: 'userId' });
Role.belongsToMany(User, { through: 'user_roles', foreignKey: 'roleId' });

// Пользователь ↔ МедЦентр через user_med_centers
User.belongsToMany(MedCenter, { through: 'user_med_centers' });
MedCenter.belongsToMany(User, { through: 'user_med_centers' });

// Курс ↔ Роль (кому доступен) через course_roles
Course.belongsToMany(Role, { through: CourseRole });
```

При запросе с `include: [{ model: Role }]` Sequelize делает JOIN:
```sql
SELECT users.*, roles.*
FROM users
LEFT JOIN user_roles ON users.id = user_roles.user_id
LEFT JOIN roles ON user_roles.role_id = roles.id
WHERE users.id = $1
```

---

## Миграции — как менялась схема БД

Миграции — это файлы с изменениями схемы. Каждое изменение (новая таблица, новая колонка, новый индекс) — отдельный файл.

**Зачем не использовать `sequelize.sync({ alter: true })`?**

`sequelize.sync({ alter: true })` автоматически обновляет схему БД на основе моделей. Это удобно в разработке, но опасно в production: может удалить данные, не учесть нюансы, выполниться не в нужный момент.

Явные миграции — надёжнее. Ты точно знаешь что именно изменится.

### Именование файлов

В проекте смешанный подход:
- `ver. 3.26 add-missing-indexes.sql` — версионированные
- `add-accreditation-files.sql` — по названию фичи
- `20260129-add-spreadsheet-contenttype.sql` — с датой
- `add-reviews-bot.js` — JavaScript (когда нужно более сложное действие)

### JS-миграции

Некоторые "миграции" — JavaScript файлы, которые делают что-то сложнее ALTER TABLE:

```js
// add-reviews-bot.js
async function run() {
  const existingBot = await User.findByPk('00000000-0000-0000-0000-000000000002');
  if (!existingBot) {
    await User.create({
      id: '00000000-0000-0000-0000-000000000002',
      username: 'reviews_bot',
      displayName: 'Модуль отзывов',
      isBot: true,
      isActive: true,
      password: await bcrypt.hash(randomBytes(32).toString('hex'), 10)
    });
  }
}
```

Такие скрипты создают начальные данные (seed data) которые должны существовать в системе.

### Как применять миграции

```bash
# SQL миграция
psql -U postgres -d alfa_wiki -f "backend/migrations/ver. 3.26 add-missing-indexes.sql"

# JavaScript миграция (если файл экспортирует функцию run)
node -e "require('./backend/migrations/add-reviews-bot.js').run()"
```

**Важно**: в проекте нет автоматического применения миграций. При каждом деплое с изменениями схемы нужно вручную запустить новые миграции.

---

## Индексы — почему они важны

Индекс — это дополнительная структура данных, которая ускоряет поиск. Без индекса PostgreSQL делает full table scan: просматривает каждую строку.

В проекте индексы создаются двумя способами:

**В Sequelize:**
```js
sequelize.define('Page', {
  slug: { type: DataTypes.STRING(255), unique: true },  // Автоматический индекс
}, {
  indexes: [
    { fields: ['folderId'] },           // Обычный индекс
    { fields: ['title'] },
    { type: 'GIN', fields: ['keywords'] }  // GIN-индекс для массивов/JSONB
  ]
});
```

**В SQL-миграциях:**
```sql
-- ver. 3.26 add-missing-indexes.sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reviews_board_status ON reviews(board_id, status);
```

`CONCURRENTLY` — создать индекс не блокируя таблицу (важно в production, таблица остаётся доступной во время создания).

**GIN-индекс** нужен для JSONB полей и массивов — обычный B-tree индекс с ними не работает.
