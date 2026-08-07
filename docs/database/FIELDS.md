# Словарь полей production-БД

Актуально на **6 августа 2026 г. в 22:29:08 (MSK)**. Таблиц: **111**, полей: **1161**.

Для каждого поля указаны фактические тип, допустимость `NULL`, значение по умолчанию и ключевые ограничения production PostgreSQL.

## Пользователи и доступ

### users

Учётные записи, профиль и индивидуальные разрешения пользователей.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `username` | `character varying(50)` | Нет | — | UQ | Имя пользователя для входа. |
| `password` | `character varying(255)` | Нет | — | — | Хеш пароля пользователя. |
| `displayName` | `character varying(100)` | Да | — | — | Отображаемое имя. |
| `email` | `character varying(255)` | Да | — | — | Адрес электронной почты. |
| `avatar` | `character varying(500)` | Да | — | — | Путь или URL изображения профиля. |
| `isActive` | `boolean` | Да | `true` | — | Признак активной записи. |
| `isAdmin` | `boolean` | Да | `false` | — | Признак администратора. |
| `lastLogin` | `timestamp with time zone` | Да | — | — | Дата и время события «last login». |
| `settings` | `jsonb` | Да | `'{}'::jsonb` | — | Структурированные настройки записи. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |
| `roleId` | `uuid` | Да | — | FK | Ссылка на `roles.id`. |
| `twoFactorEnabled` | `boolean` | Да | `false` | — | Включена ли 2FA для этого пользователя |
| `twoFactorCode` | `character varying(6)` | Да | — | — | Временный код для 2FA |
| `twoFactorCodeExpires` | `timestamp with time zone` | Да | — | — | Время истечения кода 2FA |
| `twoFactorAttempts` | `integer` | Да | `0` | — | Количество неудачных попыток ввода кода |
| `adminAccess` | `jsonb` | Да | `'{"media": false, "pages": false, "roles": false, "users": false, "backup": false, "courses": false, "sidebar": false, "settings": false}'::jsonb` | — | Гранулярный доступ к админ-разделам |
| `canEditDoctorCards` | `boolean` | Да | `false` | — | Разрешение на создание, редактирование и удаление карточек врачей |
| `isBot` | `boolean` | Нет | `false` | — | Признак учётной записи бота. |
| `lastSeen` | `timestamp with time zone` | Да | — | — | Дата и время последней активности. |
| `canEditAnalyses` | `boolean` | Нет | `false` | — | Разрешение редактировать анализы. |
| `canEditServices` | `boolean` | Нет | `false` | — | Разрешение редактировать услуги. |
| `canAccessSalary` | `boolean` | Нет | `false` | — | Разрешение доступа к зарплатному модулю. |
| `canManagePromotions` | `boolean` | Нет | `false` | — | Разрешение управлять акциями. |
| `phone` | `character varying(50)` | Да | — | — | Номер телефона. |
| `position` | `character varying(100)` | Да | — | — | Позиция или должность — в зависимости от контекста таблицы. |
| `bio` | `text` | Да | — | — | Краткая биографическая информация. |
| `specialty` | `character varying(200)` | Да | — | — | Медицинская специальность. |
| `gender` | `character varying(10)` | Да | — | — | Пол. |
| `birth_date` | `date` | Да | — | — | Дата события «birth». |
| `deletedAt` | `timestamp with time zone` | Да | — | — | Дата и время мягкого удаления записи. |
| `deletedBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `canAccessStatistics` | `boolean` | Нет | `false` | — | Разрешение доступа к статистике. |
| `canAccessTopSalary` | `boolean` | Нет | `false` | — | Разрешение просмотра рейтинга зарплат. |
| `misUserId` | `character varying(50)` | Да | — | — | ID сотрудника в МИС для персональных разделов врача |
| `chatBadge` | `jsonb` | Да | — | — | Администраторская метка в чате: { type, value, color, label } |

### roles

Роли пользователей и наборы разрешений.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `name` | `character varying(100)` | Нет | — | UQ | Наименование. |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `permissions` | `jsonb` | Да | `'{"pages": {"read": true, "admin": false, "write": false, "delete": false}}'::jsonb` | — | Набор разрешений. |
| `isSystem` | `boolean` | Да | `false` | — | Признак системной записи. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |

### user_roles

Связь пользователей с назначенными ролями.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `userId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `users.id`. |
| `roleId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `roles.id`. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |

### user_med_centers

Связь пользователей с доступными медицинскими центрами.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `userId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `users.id`. |
| `medCenterId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `med_centers.id`. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |

### med_centers

Справочник медицинских центров.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `name` | `enum_med_centers_name` | Нет | — | UQ | Название медицинского центра |
| `displayName` | `character varying(100)` | Да | — | — | Полное название для отображения |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |

### user_sessions

Сессии входа и refresh-токены пользователей.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `userId` | `uuid` | Нет | — | FK | Ссылка на `users.id`. |
| `platform` | `character varying(10)` | Нет | `'web'::character varying` | — | Значение поля «platform». |
| `deviceName` | `character varying(200)` | Да | — | — | Значение поля «device name». |
| `ip` | `character varying(64)` | Да | — | — | IP-адрес источника запроса. |
| `userAgent` | `character varying(512)` | Да | — | — | Значение HTTP-заголовка User-Agent. |
| `lastActivityAt` | `timestamp with time zone` | Да | — | — | Дата и время события «last activity». |
| `expiresAt` | `timestamp with time zone` | Нет | — | — | Дата и время окончания срока действия. |
| `revokedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «revoked». |
| `revokedReason` | `character varying(20)` | Да | — | — | Значение поля «revoked reason». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### user_devices

Устройства пользователей и push-токены.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `userId` | `uuid` | Нет | — | FK | Ссылка на `users.id`. |
| `token` | `character varying(512)` | Нет | — | — | Технический токен идентификации или доступа. |
| `platform` | `character varying(10)` | Нет | — | — | Значение поля «platform». |
| `provider` | `character varying(10)` | Нет | `'fcm'::character varying` | — | Значение поля «provider». |
| `appVersion` | `character varying(50)` | Да | — | — | Значение поля «app version». |
| `deviceName` | `character varying(120)` | Да | — | — | Значение поля «device name». |
| `isActive` | `boolean` | Нет | `true` | — | Признак активной записи. |
| `lastSeenAt` | `timestamp with time zone` | Да | — | — | Дата и время события «last seen». |
| `failureCount` | `integer` | Нет | `0` | — | Числовое значение «failure count». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### structural_divisions

Справочник структурных подразделений.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `name` | `character varying(255)` | Нет | — | — | Наименование. |
| `doctor_ids` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «doctor ids» в JSON. |
| `created_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updated_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |
| `created_by` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `rates` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «rates» в JSON. |

### division_access

Доступ пользователей к структурным подразделениям.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `division_id` | `uuid` | Нет | — | FK, UQ* | Ссылка на `structural_divisions.id`. |
| `user_id` | `uuid` | Нет | — | UQ*, FK | Ссылка на `users.id`. |
| `permission` | `character varying(10)` | Нет | `'read'::character varying` | — | Значение поля «permission». |
| `created_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updated_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### rb_user_permissions

Специализированные права пользователя в зарплатном модуле.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `userId` | `uuid` | Нет | — | UQ | Идентификатор связанной сущности «user». |
| `clinics` | `text[]` | Нет | `'{}'::text[]` | — | Список значений «clinics». |
| `tab1` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab1». |
| `tab2` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab2». |
| `tab3` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab3». |
| `tab4` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab4». |
| `tabArchive` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab archive». |
| `createdAt` | `timestamp without time zone` | Нет | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp without time zone` | Нет | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |
| `tabSummary` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab summary». |
| `tabHourNorms` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab hour norms». |
| `tabWorkTime` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab work time». |
| `tabSchedule` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab schedule». |
| `tabArchiveHistory` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab archive history». |
| `tabArchiveKassa` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab archive kassa». |
| `tabArchiveTabel` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab archive tabel». |
| `tabKpi` | `character varying(10)` | Нет | `'edit'::character varying` | — | Значение поля «tab kpi». |
| `bypassPeriodLock` | `boolean` | Нет | `false` | — | Разрешение обходить блокировку расчётного периода. |
| `defaultClinic` | `character varying(16)` | Да | — | — | Значение поля «default clinic». |

## Wiki и контент

### folders

Иерархия папок базы знаний.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `title` | `character varying(255)` | Нет | — | — | Заголовок или название. |
| `icon` | `character varying(50)` | Да | `'folder'::character varying` | — | Идентификатор или путь к иконке. |
| `parentId` | `uuid` | Да | — | FK | Ссылка на `folders.id`. |
| `sortOrder` | `integer` | Да | `0` | — | Порядок отображения. |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `createdBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |
| `allowedRoles` | `uuid[]` | Да | `'{}'::uuid[]` | — | Массив ID ролей, которым разрешен доступ к папке. Пустой массив означает доступ для всех |
| `slug` | `character varying(255)` | Да | — | — | Человекочитаемый идентификатор для URL. |

### pages

Страницы базы знаний и их содержимое.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `slug` | `character varying(255)` | Нет | — | UQ | Человекочитаемый идентификатор для URL. |
| `title` | `character varying(500)` | Нет | — | — | Заголовок или название. |
| `content` | `text` | Да | — | — | Основное содержимое записи. |
| `contentType` | `"enum_pages_contentType"` | Да | `'wysiwyg'::"enum_pages_contentType"` | — | Значение поля «content type». |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `keywords` | `character varying(255)[]` | Да | `(ARRAY[]::character varying[])::character varying(255)[]` | — | Список значений «keywords». |
| `searchContent` | `text` | Да | — | — | Значение поля «search content». |
| `icon` | `character varying(50)` | Да | — | — | Идентификатор или путь к иконке. |
| `folderId` | `uuid` | Да | — | FK | Ссылка на `folders.id`. |
| `sortOrder` | `integer` | Да | `0` | — | Порядок отображения. |
| `isPublished` | `boolean` | Да | `false` | — | Признак публикации. |
| `isFavorite` | `boolean` | Да | `false` | — | Признак добавления в избранное. |
| `allowedRoles` | `uuid[]` | Да | `ARRAY[]::uuid[]` | — | Список значений «allowed roles». |
| `customCss` | `text` | Да | — | — | Значение поля «custom css». |
| `customJs` | `text` | Да | — | — | Значение поля «custom js». |
| `metadata` | `jsonb` | Да | `'{}'::jsonb` | — | Дополнительные структурированные метаданные. |
| `createdBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `updatedBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |
| `mediaId` | `uuid` | Да | — | FK | Ссылка на `media.id`. |

### page_history

Журнал изменений страниц wiki

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | UUID записи истории |
| `pageId` | `uuid` | Да | — | FK | ID страницы |
| `userId` | `uuid` | Нет | — | FK | ID пользователя, внесшего изменения |
| `action` | `character varying(20)` | Нет | — | — | Тип действия: created - создание, updated - редактирование, published/unpublished - изменение статуса публикации |
| `changesSummary` | `text` | Да | — | — | Краткое описание изменений |
| `metadata` | `jsonb` | Да | `'{}'::jsonb` | — | Дополнительные данные: измененные поля, старые/новые значения |
| `createdAt` | `timestamp with time zone` | Нет | `CURRENT_TIMESTAMP` | — | Дата и время изменения |

### media

Метаданные загруженных файлов и изображений.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `filename` | `character varying(255)` | Нет | — | — | Имя файла в хранилище. |
| `originalName` | `character varying(255)` | Да | — | — | Исходное имя загруженного файла. |
| `mimeType` | `character varying(100)` | Да | — | — | MIME-тип файла. |
| `size` | `bigint` | Да | — | — | Размер файла в байтах. |
| `path` | `character varying(1000)` | Нет | — | — | Путь к ресурсу в хранилище. |
| `thumbnailPath` | `character varying(1000)` | Да | — | — | Значение поля «thumbnail path». |
| `alt` | `character varying(500)` | Да | — | — | Значение поля «alt». |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `uploadedBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |

### user_favorites

Избранные wiki-страницы пользователей.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `userId` | `uuid` | Нет | — | FK | Ссылка на `users.id`. |
| `pageId` | `uuid` | Нет | — | FK | Ссылка на `pages.id`. |
| `sortOrder` | `integer` | Да | `0` | — | Порядок отображения. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |

### sidebar_items

Элементы меню навигации. Разделители больше не используются - они автоматически рендерятся после папок на фронтенде

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `type` | `enum_sidebar_items_type` | Да | `'page'::enum_sidebar_items_type` | — | Тип или категория записи. |
| `title` | `character varying(255)` | Да | — | — | Заголовок или название. |
| `icon` | `character varying(50)` | Да | — | — | Идентификатор или путь к иконке. |
| `pageId` | `uuid` | Да | — | FK | Ссылка на `pages.id`. |
| `folderId` | `uuid` | Да | — | FK | Ссылка на `folders.id`. |
| `externalUrl` | `character varying(1000)` | Да | — | — | Значение поля «external url». |
| `parentId` | `uuid` | Да | — | FK | Ссылка на `sidebar_items.id`. |
| `sortOrder` | `integer` | Да | `0` | — | Порядок отображения. |
| `isExpanded` | `boolean` | Да | `true` | — | Признак развёрнутого состояния в интерфейсе. |
| `allowedRoles` | `uuid[]` | Да | `ARRAY[]::uuid[]` | — | Список значений «allowed roles». |
| `isVisible` | `boolean` | Да | `true` | — | Признак отображения записи. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |

### search_index

Материализованные данные для полнотекстового поиска.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `entityType` | `character varying(50)` | Нет | — | — | Значение поля «entity type». |
| `entityId` | `uuid` | Нет | — | — | Идентификатор связанной сущности «entity». |
| `title` | `character varying(500)` | Да | — | — | Заголовок или название. |
| `content` | `text` | Да | — | — | Основное содержимое записи. |
| `keywords` | `character varying(255)[]` | Да | `(ARRAY[]::character varying[])::character varying(255)[]` | — | Список значений «keywords». |
| `url` | `character varying(1000)` | Да | — | — | URL внешнего или внутреннего ресурса. |
| `metadata` | `jsonb` | Да | `'{}'::jsonb` | — | Дополнительные структурированные метаданные. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |

### announcements

Объявления, показываемые пользователям системы.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `title` | `character varying(255)` | Нет | — | — | Заголовок или название. |
| `body` | `text` | Нет | — | — | Значение поля «body». |
| `authorId` | `uuid` | Нет | — | FK | Ссылка на `users.id`. |
| `pinned` | `boolean` | Нет | `false` | — | Признак закреплённой записи. |
| `targetRoles` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «target roles» в JSON. |
| `targetMedCenterIds` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «target med center ids» в JSON. |
| `targetUserIds` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «target user ids» в JSON. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### release_notes

Заметки об изменениях версий приложения.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `title` | `character varying(255)` | Нет | — | — | Заголовок или название. |
| `content` | `text` | Нет | `''::text` | — | Основное содержимое записи. |
| `version` | `character varying(50)` | Да | — | — | Значение поля «version». |
| `severity` | `character varying(20)` | Нет | `'info'::character varying` | — | Значение поля «severity». |
| `targetRoleIds` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «target role ids» в JSON. |
| `targetMedCenterIds` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «target med center ids» в JSON. |
| `isPublished` | `boolean` | Нет | `false` | — | Признак публикации. |
| `publishedAt` | `timestamp with time zone` | Да | — | — | Дата и время публикации. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### release_note_reads

Факты прочтения заметок о релизах пользователями.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `releaseNoteId` | `uuid` | Нет | — | FK | Ссылка на `release_notes.id`. |
| `userId` | `uuid` | Нет | — | — | Идентификатор связанной сущности «user». |
| `readAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время события «read». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### analysis_page_notes

Примечания к анализам в контексте отдельных wiki-страниц.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `pageSlug` | `character varying(255)` | Нет | — | UQ | Значение поля «page slug». |
| `notes` | `text` | Да | — | — | Дополнительные примечания. |
| `updatedBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### service_page_notes

Примечания к услугам в контексте отдельных wiki-страниц.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `pageSlug` | `character varying(255)` | Нет | — | UQ | Значение поля «page slug». |
| `notes` | `text` | Да | — | — | Дополнительные примечания. |
| `updatedBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

## Чаты и боты

### chats

Диалоги, групповые чаты и служебные каналы.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `name` | `character varying(255)` | Да | — | — | Наименование. |
| `type` | `enum_chats_type` | Да | `'private'::enum_chats_type` | — | Тип или категория записи. |
| `avatar` | `character varying(500)` | Да | — | — | Путь или URL изображения профиля. |
| `lastMessage` | `text` | Да | — | — | Значение поля «last message». |
| `lastMessageAt` | `timestamp with time zone` | Да | — | — | Дата и время события «last message». |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |

### chat_members

Участники чатов, их роли и персональные настройки.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `chatId` | `uuid` | Нет | — | FK | Ссылка на `chats.id`. |
| `userId` | `uuid` | Нет | — | FK | Ссылка на `users.id`. |
| `role` | `enum_chat_members_role` | Да | `'member'::enum_chat_members_role` | — | Роль в рамках данной сущности. |
| `lastReadAt` | `timestamp with time zone` | Да | — | — | Дата и время события «last read». |
| `isNotificationMuted` | `boolean` | Да | `false` | — | Признак отключённых уведомлений. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |
| `isHidden` | `boolean` | Да | `false` | — | Чат скрыт у пользователя (видит только этот пользователь) |
| `isPinned` | `boolean` | Нет | `false` | — | Признак закреплённой записи. |
| `pinnedOrder` | `integer` | Да | — | — | Числовое значение «pinned order». |
| `isReadOnly` | `boolean` | Нет | `false` | — | Признак режима только для чтения. |

### messages

Сообщения чатов, вложения, пересылки и опросы.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `chatId` | `uuid` | Нет | — | FK | Ссылка на `chats.id`. |
| `senderId` | `uuid` | Нет | — | FK | Ссылка на `users.id`. |
| `content` | `text` | Нет | — | — | Основное содержимое записи. |
| `type` | `enum_messages_type` | Да | `'text'::enum_messages_type` | — | Тип или категория записи. |
| `attachments` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «attachments» в JSON. |
| `isEdited` | `boolean` | Да | `false` | — | Признак редактирования записи. |
| `replyToId` | `uuid` | Да | — | FK | Ссылка на `messages.id`. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |
| `forwardedFrom` | `jsonb` | Да | — | — | Структурированные данные «forwarded from» в JSON. |
| `telegramMsgId` | `bigint` | Да | — | — | Идентификатор связанной сущности «telegram msg». |
| `actions` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «actions» в JSON. |
| `mentions` | `jsonb` | Нет | `'[]'::jsonb` | — | Снимок адресатов упоминания: targetId, label, userIds |
| `poll` | `jsonb` | Да | — | — | Опрос: вопрос, варианты, настройки и карта голосов |

### message_reactions

Реакции пользователей на сообщения в чате

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор реакции |
| `messageId` | `uuid` | Нет | — | FK, UQ* | ID сообщения, на которое поставлена реакция |
| `userId` | `uuid` | Нет | — | FK, UQ* | ID пользователя, который поставил реакцию |
| `emoji` | `character varying(10)` | Нет | — | — | Эмодзи реакции: 👍 👎 ❤️ 😂 😮 🎉 🔥 |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания реакции |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего обновления реакции |

### bot_tokens

Токены и настройки подключённых ботов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `token` | `character varying(150)` | Нет | — | UQ | Технический токен идентификации или доступа. |
| `name` | `character varying(100)` | Нет | — | — | Наименование. |
| `username` | `character varying(100)` | Нет | — | UQ | Имя пользователя для входа. |
| `description` | `text` | Нет | `''::text` | — | Текстовое описание. |
| `userId` | `uuid` | Нет | — | FK | Ссылка на `users.id`. |
| `webhookUrl` | `text` | Да | — | — | Значение поля «webhook url». |
| `webhookSecretToken` | `character varying(256)` | Да | — | — | Значение поля «webhook secret token». |
| `allowedUpdates` | `text[]` | Нет | `'{}'::text[]` | — | Список значений «allowed updates». |
| `maxConnections` | `integer` | Нет | `40` | — | Значение поля «max connections». |
| `commands` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «commands» в JSON. |
| `isActive` | `boolean` | Нет | `true` | — | Признак активной записи. |
| `lastUpdateId` | `bigint` | Нет | `0` | — | Идентификатор связанной сущности «last update». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |
| `servesForms` | `jsonb` | Нет | `'[]'::jsonb` | — | Типы форм публичного API, которые доставляет этот бот, напр. ["patient-registration"] |

### bot_updates

Очередь и журнал входящих обновлений от ботов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `bigint` | Нет | `nextval('bot_updates_id_seq'::regclass)` | PK | Уникальный идентификатор записи. |
| `botId` | `uuid` | Нет | — | FK | Ссылка на `bot_tokens.id`. |
| `updateType` | `character varying(50)` | Нет | — | — | Значение поля «update type». |
| `updateData` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «update data» в JSON. |
| `processed` | `boolean` | Нет | `false` | — | Признак завершённой обработки. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### bot_subscribers

Подписчики внутренних ботов и параметры доставки уведомлений.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `platform` | `character varying(20)` | Нет | — | — | Значение поля «platform». |
| `organization` | `character varying(50)` | Нет | — | — | Значение поля «organization». |
| `externalUserId` | `character varying(50)` | Нет | — | — | Идентификатор связанной сущности «external user». |
| `username` | `character varying(100)` | Да | — | — | Имя пользователя для входа. |
| `firstName` | `character varying(100)` | Да | — | — | Имя. |
| `lastName` | `character varying(100)` | Да | — | — | Фамилия. |
| `phone` | `character varying(30)` | Да | — | — | Номер телефона. |
| `patientIds` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «patient ids» в JSON. |
| `status` | `character varying(20)` | Нет | `'started'::character varying` | — | Текущий статус записи. |
| `source` | `character varying(20)` | Нет | `'bot'::character varying` | — | Источник получения данных. |
| `startedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «started». |
| `identifiedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «identified». |
| `taggedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «tagged». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### telegram_subscribers

Подписчики Telegram-уведомлений.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `chatId` | `character varying(50)` | Нет | — | UQ | Идентификатор связанной сущности «chat». |
| `username` | `character varying(100)` | Да | — | — | Имя пользователя для входа. |
| `firstName` | `character varying(100)` | Да | — | — | Имя. |
| `lastName` | `character varying(100)` | Да | — | — | Фамилия. |
| `isActive` | `boolean` | Да | `true` | — | Признак активной записи. |
| `subscribedToAccreditations` | `boolean` | Да | `true` | — | Признак подписки на события аккредитаций. |
| `subscribedToVehicles` | `boolean` | Да | `true` | — | Признак подписки на события транспорта. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |
| `subscribeAccreditations` | `boolean` | Да | `true` | — | Настройка подписки на события аккредитаций. |
| `subscribeVehicles` | `boolean` | Да | `true` | — | Настройка подписки на события транспорта. |

### form_subscriptions

Подписки чатов и пользователей на события публичных форм.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `botId` | `uuid` | Нет | — | FK | Ссылка на `bot_tokens.id`. |
| `chatId` | `uuid` | Нет | — | FK | Ссылка на `chats.id`. |
| `formType` | `character varying(50)` | Нет | — | — | Значение поля «form type». |
| `filters` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «filters» в JSON. |
| `isActive` | `boolean` | Нет | `true` | — | Признак активной записи. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

## Курсы

### courses

Учебные курсы и параметры их публикации.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `title` | `character varying(255)` | Нет | — | — | Заголовок или название. |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `icon` | `character varying(50)` | Да | `'book-open'::character varying` | — | Идентификатор или путь к иконке. |
| `estimatedDuration` | `integer` | Да | — | — | Числовое значение «estimated duration». |
| `createdBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `isPublished` | `boolean` | Да | `false` | — | Признак публикации. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### lessons

Уроки, входящие в учебные курсы.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `courseId` | `uuid` | Нет | — | FK | Ссылка на `courses.id`. |
| `title` | `character varying(255)` | Нет | — | — | Заголовок или название. |
| `content` | `text` | Да | — | — | Основное содержимое записи. |
| `sortOrder` | `integer` | Да | `0` | — | Порядок отображения. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### test_questions

Контрольные вопросы учебных курсов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `courseId` | `uuid` | Нет | — | FK | Ссылка на `courses.id`. |
| `question` | `text` | Нет | — | — | Значение поля «question». |
| `options` | `jsonb` | Нет | — | — | Структурированные данные «options» в JSON. |
| `correctAnswer` | `integer` | Нет | — | — | Значение поля «correct answer». |
| `sortOrder` | `integer` | Да | `0` | — | Порядок отображения. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### course_progress

Прогресс пользователей по урокам и курсам.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `userId` | `uuid` | Нет | — | UQ*, FK | Ссылка на `users.id`. |
| `courseId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `courses.id`. |
| `completedLessons` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «completed lessons» в JSON. |
| `currentLessonId` | `uuid` | Да | — | FK | Ссылка на `lessons.id`. |
| `testScore` | `integer` | Да | — | — | Значение поля «test score». |
| `testAttempts` | `integer` | Да | `0` | — | Числовое значение «test attempts». |
| `completedAt` | `timestamp with time zone` | Да | — | — | Дата и время завершения. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### course_roles

Связь курсов с ролями для контроля доступа. Если таблица пустая для курса - доступен всем.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `courseId` | `uuid` | Нет | — | FK, UQ* | ID курса |
| `roleId` | `uuid` | Нет | — | UQ*, FK | ID роли, которая имеет доступ к курсу |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### course_medcenters

Связь курсов с медцентрами для контроля доступа. Если таблица пустая для курса - доступен всем.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `courseId` | `uuid` | Нет | — | FK, UQ* | ID курса |
| `medCenterId` | `uuid` | Нет | — | UQ*, FK | ID медцентра, пользователи которого имеют доступ к курсу |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### course_users

Индивидуальные разрешения пользователей на доступ к курсам.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `courseId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `courses.id`. |
| `userId` | `uuid` | Нет | — | UQ*, FK | Ссылка на `users.id`. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

## Канбан

### kanban_boards

Канбан-доски медицинских центров.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `name` | `character varying(255)` | Нет | — | — | Наименование. |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `ownerId` | `uuid` | Нет | — | FK | Ссылка на `users.id`. |
| `archived` | `boolean` | Да | `false` | — | Признак нахождения записи в архиве. |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### kanban_tasks

Задачи на Канбан-доске медицинского центра

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `title` | `character varying(500)` | Нет | — | — | Заголовок или название. |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `status` | `character varying(50)` | Нет | `'backlog'::character varying` | — | Статус задачи: backlog, todo, in_progress, review, done |
| `priority` | `character varying(20)` | Да | `'medium'::character varying` | — | Приоритет: low, medium, high, urgent |
| `createdBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `tags` | `jsonb` | Да | `'[]'::jsonb` | — | Теги задачи в формате массива строк |
| `dueDate` | `timestamp with time zone` | Да | — | — | Дата и время события «due date». |
| `sortOrder` | `integer` | Да | `0` | — | Порядок сортировки внутри колонки |
| `metadata` | `jsonb` | Да | `'{}'::jsonb` | — | Дополнительные данные задачи |
| `createdAt` | `timestamp with time zone` | Да | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `now()` | — | Дата и время последнего изменения записи. |
| `assigneeIds` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «assignee ids» в JSON. |
| `attachments` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «attachments» в JSON. |
| `archived` | `boolean` | Да | `false` | — | Признак нахождения записи в архиве. |
| `archivedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «archived». |
| `completedAt` | `timestamp with time zone` | Да | — | — | Дата и время завершения. |
| `boardId` | `uuid` | Да | — | FK | Ссылка на `kanban_boards.id`. |
| `subtasks` | `jsonb` | Да | `'[]'::jsonb` | — | Array of subtasks: [{id: UUID, text: string, completed: boolean}] |

### board_permissions

Права пользователей на канбан-доски.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `boardId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `kanban_boards.id`. |
| `userId` | `uuid` | Нет | — | UQ*, FK | Ссылка на `users.id`. |
| `role` | `character varying(20)` | Нет | — | — | Роль в рамках данной сущности. |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

## Отзывы

### review_boards

Доски для группировки и обработки отзывов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `name` | `character varying(255)` | Нет | — | — | Наименование. |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `ownerId` | `uuid` | Нет | — | FK | Ссылка на `users.id`. |
| `archived` | `boolean` | Да | `false` | — | Признак нахождения записи в архиве. |
| `notificationSettings` | `jsonb` | Да | `'{"newReview": {"roles": ["creator"], "users": []}, "assignment": {"roles": [], "users": []}, "statusChange": {"roles": ["creator", "negative_handler"], "users": []}}'::jsonb` | — | Структурированные данные «notification settings» в JSON. |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |
| `workflowConfig` | `jsonb` | Да | `'{"edges": [], "nodes": []}'::jsonb` | — | Структурированные данные «workflow config» в JSON. |
| `columnNames` | `jsonb` | Да | `'{}'::jsonb` | — | Структурированные данные «column names» в JSON. |
| `columnSettings` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «column settings» в JSON. |

### reviews

Отзывы клиентов и состояние их обработки.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `boardId` | `uuid` | Нет | — | FK | Ссылка на `review_boards.id`. |
| `patientName` | `character varying(255)` | Нет | — | — | ФИО пациента. |
| `reviewDate` | `date` | Нет | — | — | Дата события «review». |
| `platformId` | `uuid` | Нет | — | FK | Ссылка на `review_platforms.id`. |
| `doctorName` | `character varying(255)` | Да | — | — | ФИО врача. |
| `rating` | `integer` | Нет | — | — | Значение поля «rating». |
| `reviewText` | `text` | Нет | — | — | Значение поля «review text». |
| `additionalInfo` | `text` | Да | — | — | Значение поля «additional info». |
| `status` | `character varying(50)` | Нет | `'new'::character varying` | — | Текущий статус записи. |
| `attachments` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «attachments» в JSON. |
| `createdBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `assigneeIds` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «assignee ids» в JSON. |
| `sortOrder` | `integer` | Да | `0` | — | Порядок отображения. |
| `archived` | `boolean` | Да | `false` | — | Признак нахождения записи в архиве. |
| `archivedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «archived». |
| `decisionCategory` | `character varying(50)` | Да | — | — | Значение поля «decision category». |
| `decisionDescription` | `text` | Да | — | — | Значение поля «decision description». |
| `finalizedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «finalized». |
| `finalizedBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `reportPdfPath` | `character varying(1000)` | Да | — | — | Значение поля «report pdf path». |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |
| `externalId` | `character varying(500)` | Да | — | — | Идентификатор связанной сущности «external». |
| `externalUrl` | `text` | Да | — | — | Значение поля «external url». |
| `isAutoImported` | `boolean` | Нет | `false` | — | Признак автоматического импорта. |
| `syncedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «synced». |
| `importSource` | `character varying(50)` | Да | — | — | Значение поля «import source». |
| `deletedAt` | `timestamp with time zone` | Да | — | — | Дата и время мягкого удаления записи. |
| `syncMeta` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «sync meta» в JSON. |

### review_platforms

Внешние площадки, с которых собираются отзывы.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `name` | `character varying(100)` | Нет | — | UQ | Наименование. |
| `isActive` | `boolean` | Да | `true` | — | Признак активной записи. |
| `sortOrder` | `integer` | Да | `0` | — | Порядок отображения. |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### review_history

История изменения статусов и содержимого отзывов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `reviewId` | `uuid` | Нет | — | FK | Ссылка на `reviews.id`. |
| `userId` | `uuid` | Нет | — | FK | Ссылка на `users.id`. |
| `action` | `character varying(50)` | Нет | — | — | Значение поля «action». |
| `oldValue` | `text` | Да | — | — | Значение поля «old value». |
| `newValue` | `text` | Да | — | — | Значение поля «new value». |
| `comment` | `text` | Да | — | — | Комментарий. |
| `attachments` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «attachments» в JSON. |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |

### review_board_permissions

Индивидуальные права пользователей на доски отзывов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `boardId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `review_boards.id`. |
| `userId` | `uuid` | Нет | — | UQ*, FK | Ссылка на `users.id`. |
| `role` | `character varying(20)` | Нет | — | — | Роль в рамках данной сущности. |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### review_board_roles

Права ролей на доски отзывов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `boardId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `review_boards.id`. |
| `roleName` | `character varying(50)` | Нет | — | UQ* | Значение поля «role name». |
| `userId` | `uuid` | Нет | — | UQ*, FK | Ссылка на `users.id`. |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### review_sync_configs

Настройки автоматической синхронизации отзывов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `boardId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `review_boards.id`. |
| `provider` | `character varying(50)` | Нет | — | UQ* | Значение поля «provider». |
| `isEnabled` | `boolean` | Нет | `false` | — | Признак включённой записи или функции. |
| `credentials` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «credentials» в JSON. |
| `lastSyncAt` | `timestamp with time zone` | Да | — | — | Дата и время события «last sync». |
| `lastSyncStatus` | `character varying(20)` | Да | — | — | Значение поля «last sync status». |
| `lastSyncError` | `text` | Да | — | — | Значение поля «last sync error». |
| `lastSyncCount` | `integer` | Да | `0` | — | Числовое значение «last sync count». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

## МИС и медицинские справочники

### mis_appointments

Записи пациентов на приём, импортированные из МИС.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `integer` | Нет | `nextval('mis_appointments_id_seq'::regclass)` | PK | Уникальный идентификатор записи. |
| `appt_id` | `integer` | Нет | — | — | Идентификатор связанной сущности «appt». |
| `clinic_id` | `smallint` | Да | — | — | Идентификатор связанной сущности «clinic». |
| `room` | `character varying(100)` | Да | — | — | Значение поля «room». |
| `doctor_id` | `integer` | Да | — | — | Идентификатор связанной сущности «doctor». |
| `patient_id` | `integer` | Да | — | — | Идентификатор связанной сущности «patient». |
| `time_start` | `timestamp with time zone` | Да | — | — | Дата и время события «time start». |
| `time_end` | `timestamp with time zone` | Да | — | — | Дата и время события «time end». |
| `status_id` | `smallint` | Да | — | — | Идентификатор связанной сущности «status». |
| `status` | `character varying(20)` | Да | — | — | Текущий статус записи. |
| `date_created` | `timestamp with time zone` | Да | — | — | Дата и время события «date created». |
| `date_updated` | `timestamp with time zone` | Да | — | — | Дата и время события «date updated». |
| `data` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «data» в JSON. |
| `synced_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время события «synced». |

### mis_payments

Платежи и оплаты, импортированные из МИС.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `integer` | Нет | `nextval('mis_payments_id_seq'::regclass)` | PK | Уникальный идентификатор записи. |
| `op_date` | `timestamp with time zone` | Да | — | — | Дата и время события «op date». |
| `value` | `numeric(14,2)` | Да | — | — | Значение поля «value». |
| `type` | `smallint` | Да | — | — | Тип или категория записи. |
| `type_name` | `character varying(255)` | Да | — | — | Значение поля «type name». |
| `is_refund` | `boolean` | Нет | `false` | — | Признак возвратной операции. |
| `income_type` | `smallint` | Да | — | — | Значение поля «income type». |
| `income_type_name` | `character varying(255)` | Да | — | — | Значение поля «income type name». |
| `invoice_number` | `character varying(100)` | Да | — | — | Значение поля «invoice number». |
| `title` | `character varying(500)` | Да | — | — | Заголовок или название. |
| `patient_id` | `integer` | Да | — | — | Идентификатор связанной сущности «patient». |
| `patient` | `character varying(500)` | Да | — | — | Значение поля «patient». |
| `clinic_id` | `smallint` | Да | — | — | Идентификатор связанной сущности «clinic». |
| `clinic_name` | `character varying(255)` | Да | — | — | Значение поля «clinic name». |
| `is_company` | `boolean` | Нет | `false` | — | Признак юридического лица. |
| `author_id` | `integer` | Да | — | — | Идентификатор связанной сущности «author». |
| `author_name` | `character varying(255)` | Да | — | — | Значение поля «author name». |
| `device` | `character varying(100)` | Да | — | — | Значение поля «device». |
| `is_deleted` | `boolean` | Нет | `false` | — | Признак удаления записи. |
| `data` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «data» в JSON. |
| `synced_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время события «synced». |

### analyses

Справочник лабораторных анализов и связанных wiki-страниц.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `lab` | `character varying(50)` | Нет | — | — | Значение поля «lab». |
| `serviceCode` | `character varying(100)` | Нет | — | — | Код медицинской услуги. |
| `serviceName` | `character varying(500)` | Нет | — | — | Наименование медицинской услуги. |
| `price` | `numeric(10,2)` | Нет | — | — | Цена. |
| `isStopped` | `boolean` | Да | `false` | — | Признак остановленного процесса. |
| `preparationLink` | `character varying(1000)` | Да | — | — | Значение поля «preparation link». |
| `comment` | `text` | Да | — | — | Комментарий. |
| `misServiceId` | `character varying(50)` | Да | — | — | Идентификатор связанной сущности «mis service». |
| `lastPriceUpdate` | `timestamp with time zone` | Да | — | — | Дата и время события «last price update». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### services

Медицинские услуги, привязанные к страницам wiki

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `pageSlug` | `character varying(255)` | Нет | — | — | Slug страницы wiki, к которой привязаны услуги |
| `medCenter` | `character varying(50)` | Нет | — | — | Медицинский центр (Альфа, Кидс, Проф, Линия, Смайл, 3К) |
| `serviceCode` | `character varying(100)` | Нет | — | — | Код услуги из МИС |
| `serviceName` | `character varying(500)` | Нет | — | — | Название услуги |
| `price` | `numeric(10,2)` | Нет | — | — | Стоимость услуги |
| `isStopped` | `boolean` | Да | `false` | — | Услуга временно не выполняется |
| `preparationLink` | `character varying(1000)` | Да | — | — | Ссылка на файл с подготовкой к услуге |
| `comment` | `text` | Да | — | — | Дополнительный комментарий |
| `misServiceId` | `character varying(50)` | Да | — | — | ID услуги в МИС для обновления цен |
| `lastPriceUpdate` | `timestamp with time zone` | Да | — | — | Время последнего обновления цены из МИС |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### nomenclature_804n

Медицинская номенклатура по приказу №804н.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `code` | `character varying(100)` | Нет | — | PK | Код записи во внутреннем или внешнем справочнике. |
| `name` | `character varying(500)` | Нет | — | — | Наименование. |
| `nameAlt` | `character varying(500)` | Да | — | — | Значение поля «name alt». |
| `deprecated` | `boolean` | Нет | `false` | — | Признак устаревшей записи. |
| `edition` | `character varying(20)` | Нет | `'2.10'::character varying` | — | Значение поля «edition». |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### partner_service_cache

Кэш услуг и цен внешних партнёров.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `integer` | Нет | `nextval('partner_service_cache_id_seq'::regclass)` | PK | Уникальный идентификатор записи. |
| `clinicId` | `integer` | Нет | — | — | Идентификатор связанной сущности «clinic». |
| `serviceId` | `integer` | Нет | — | — | Идентификатор связанной сущности «service». |
| `code` | `character varying(100)` | Да | — | — | Код записи во внутреннем или внешнем справочнике. |
| `subCode` | `character varying(100)` | Да | — | — | Значение поля «sub code». |
| `title` | `character varying(500)` | Нет | — | — | Заголовок или название. |
| `categoryId` | `integer` | Да | — | — | Идентификатор связанной сущности «category». |
| `categoryTitle` | `character varying(500)` | Да | — | — | Значение поля «category title». |
| `categoryPath` | `text` | Да | — | — | Значение поля «category path». |
| `price` | `numeric(10,2)` | Да | — | — | Цена. |
| `duration` | `integer` | Да | — | — | Значение поля «duration». |
| `lab` | `character varying(255)` | Да | — | — | Значение поля «lab». |
| `isHidden` | `boolean` | Нет | `false` | — | Признак скрытой записи. |
| `isDeleted` | `boolean` | Нет | `false` | — | Признак удаления записи. |
| `syncedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «synced». |
| `costPrice` | `numeric(10,2)` | Да | — | — | Себестоимость. |

### doctor_cards

Карточки врачей для публикации и внутренних процессов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `pageSlug` | `character varying(255)` | Нет | — | — | Slug страницы wiki, к которой привязаны карточки |
| `fullName` | `character varying(255)` | Нет | — | — | Полное имя человека. |
| `specialty` | `character varying(255)` | Да | — | — | Медицинская специальность. |
| `experience` | `character varying(100)` | Да | — | — | Значение поля «experience». |
| `profileUrl` | `character varying(1000)` | Да | — | — | Ссылка на страницу врача (wiki или внешняя) |
| `photo` | `character varying(1000)` | Да | — | — | Значение поля «photo». |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `phones` | `jsonb` | Да | `'[]'::jsonb` | — | Массив телефонов: [{type: "internal", number: "123"}] |
| `sortOrder` | `integer` | Да | `0` | — | Порядок отображения. |
| `metadata` | `jsonb` | Да | `'{}'::jsonb` | — | Дополнительные структурированные метаданные. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |

### doctor_service_durations

Продолжительность услуг для конкретных врачей и клиник.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `misUserId` | `character varying(50)` | Нет | — | — | Идентификатор связанной сущности «mis user». |
| `clinicId` | `character varying(50)` | Нет | — | — | Идентификатор связанной сущности «clinic». |
| `serviceId` | `character varying(50)` | Нет | — | — | Идентификатор связанной сущности «service». |
| `durationMinutes` | `integer` | Нет | — | — | Числовое значение «duration minutes». |
| `sourceCardId` | `uuid` | Да | — | FK | Ссылка на `doctor_cards.id`. |
| `updatedBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### accreditations

Реестр аккредитаций медицинских работников.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `medCenter` | `"enum_accreditations_medCenter"` | Нет | — | — | Значение поля «med center». |
| `fullName` | `character varying(255)` | Нет | — | — | Полное имя человека. |
| `specialty` | `character varying(255)` | Нет | — | — | Медицинская специальность. |
| `expirationDate` | `date` | Нет | — | — | Дата события «expiration». |
| `comment` | `text` | Да | — | — | Комментарий. |
| `reminded90` | `boolean` | Да | `false` | — | Признак отправки напоминания за 90 дней. |
| `reminded60` | `boolean` | Да | `false` | — | Признак отправки напоминания за 60 дней. |
| `reminded30` | `boolean` | Да | `false` | — | Признак отправки напоминания за 30 дней. |
| `reminded14` | `boolean` | Да | `false` | — | Признак отправки напоминания за 14 дней. |
| `reminded7` | `boolean` | Да | `false` | — | Признак отправки напоминания за 7 дней. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |
| `isArchived` | `boolean` | Да | `false` | — | Запись перенесена в архив |
| `medCenters` | `jsonb` | Да | — | — | Медцентры, на которые распространяется аккредитация (массив) |
| `misUserId` | `integer` | Да | — | — | ID сотрудника в МИС (источник ФИО/специальности/клиник) |
| `supersededById` | `uuid` | Да | — | — | ID новой версии аккредитации, заменившей эту (для архива/истории) |
| `series` | `character varying(50)` | Да | — | — | Серия аккредитации (буквы/цифры, необязательно) |
| `number` | `character varying(50)` | Да | — | — | Номер аккредитации (буквы/цифры, необязательно) |

### accreditation_files

Файлы, прикрепленные к аккредитациям

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор файла |
| `accreditationId` | `uuid` | Нет | — | FK | ID аккредитации, к которой прикреплен файл |
| `filename` | `character varying(255)` | Нет | — | — | Имя файла на сервере |
| `originalName` | `character varying(255)` | Нет | — | — | Оригинальное имя файла |
| `mimeType` | `character varying(100)` | Да | — | — | MIME тип файла |
| `size` | `bigint` | Да | — | — | Размер файла в байтах |
| `path` | `character varying(1000)` | Нет | — | — | Путь к файлу на сервере |
| `uploadedBy` | `uuid` | Да | — | FK | ID пользователя, загрузившего файл |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

## Зарплата и реферальные бонусы

### referral_bonuses

Начисления реферальных бонусов врачам и клиникам.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `misUserId` | `character varying(50)` | Нет | — | UQ* | Идентификатор связанной сущности «mis user». |
| `doctorName` | `character varying(255)` | Нет | `''::character varying` | — | ФИО врача. |
| `serviceCode` | `character varying(100)` | Нет | — | UQ* | Код медицинской услуги. |
| `serviceName` | `character varying(500)` | Нет | — | — | Наименование медицинской услуги. |
| `bonusPercent` | `numeric(10,2)` | Да | — | — | Значение поля «bonus percent». |
| `bonusRub` | `numeric(10,2)` | Да | — | — | Значение поля «bonus rub». |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |
| `clinicId` | `character varying(50)` | Нет | `''::character varying` | UQ* | Идентификатор связанной сущности «clinic». |

### performed_service_bonuses

Бонусные начисления за оказанные услуги.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `misUserId` | `character varying(50)` | Нет | — | UQ* | Идентификатор связанной сущности «mis user». |
| `doctorName` | `character varying(255)` | Да | — | — | ФИО врача. |
| `serviceCode` | `character varying(255)` | Нет | — | UQ* | Код медицинской услуги. |
| `serviceName` | `character varying(500)` | Да | — | — | Наименование медицинской услуги. |
| `bonusPercent` | `numeric(10,4)` | Да | — | — | Значение поля «bonus percent». |
| `bonusRub` | `numeric(10,2)` | Да | — | — | Значение поля «bonus rub». |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |
| `clinicId` | `character varying(50)` | Нет | `''::character varying` | UQ* | Идентификатор связанной сущности «clinic». |
| `cabinetId` | `character varying(100)` | Нет | `''::character varying` | UQ* | Идентификатор связанной сущности «cabinet». |

### service_consumables

Расходные материалы и себестоимость медицинских услуг.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `misUserId` | `character varying(50)` | Нет | — | — | Идентификатор связанной сущности «mis user». |
| `doctorName` | `character varying(255)` | Нет | `''::character varying` | — | ФИО врача. |
| `serviceCode` | `character varying(100)` | Нет | — | — | Код медицинской услуги. |
| `serviceName` | `character varying(500)` | Нет | `''::character varying` | — | Наименование медицинской услуги. |
| `name` | `character varying(255)` | Нет | — | — | Наименование. |
| `quantity` | `numeric(10,3)` | Нет | `1` | — | Количество единиц. |
| `costPerUnit` | `numeric(10,2)` | Нет | `0` | — | Значение поля «cost per unit». |
| `createdBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### referral_reports

Сформированные отчёты по реферальным бонусам.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `reportType` | `character varying(10)` | Нет | `'single'::character varying` | — | Значение поля «report type». |
| `title` | `character varying(500)` | Нет | — | — | Заголовок или название. |
| `doctorName` | `character varying(255)` | Да | — | — | ФИО врача. |
| `misUserId` | `character varying(50)` | Да | — | — | Идентификатор связанной сущности «mis user». |
| `dateFrom` | `date` | Да | — | — | Дата события «date from». |
| `dateTo` | `date` | Да | — | — | Дата события «date to». |
| `totalAmount` | `numeric(12,2)` | Да | — | — | Значение поля «total amount». |
| `reportData` | `jsonb` | Нет | — | — | Структурированные данные «report data» в JSON. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### salary_records

Расчётные строки заработной платы.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `misUserId` | `character varying(50)` | Нет | — | — | Идентификатор связанной сущности «mis user». |
| `doctorName` | `character varying(255)` | Нет | — | — | ФИО врача. |
| `dateFrom` | `date` | Да | — | — | Дата события «date from». |
| `dateTo` | `date` | Да | — | — | Дата события «date to». |
| `periodLabel` | `character varying(100)` | Да | — | — | Значение поля «period label». |
| `reportData` | `jsonb` | Да | — | — | Структурированные данные «report data» в JSON. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Да | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `now()` | — | Дата и время последнего изменения записи. |
| `excelData` | `text` | Да | — | — | Значение поля «excel data». |

### cash_payments

Денежные выплаты, связанные с зарплатными начислениями.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `salaryRecordId` | `uuid` | Да | — | FK | Ссылка на `salary_records.id`. |
| `misUserId` | `character varying(50)` | Нет | — | — | Идентификатор связанной сущности «mis user». |
| `doctorName` | `character varying(255)` | Нет | — | — | ФИО врача. |
| `periodLabel` | `character varying(100)` | Да | — | — | Значение поля «period label». |
| `amount` | `numeric(10,2)` | Нет | — | — | Денежная сумма или количественное значение. |
| `issuedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время события «issued». |
| `issuedByUserId` | `uuid` | Да | — | — | Идентификатор связанной сущности «issued by user». |
| `financistName` | `character varying(100)` | Да | — | — | Значение поля «financist name». |
| `note` | `text` | Да | — | — | Значение поля «note». |
| `createdAt` | `timestamp with time zone` | Да | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `now()` | — | Дата и время последнего изменения записи. |
| `editHistory` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «edit history» в JSON. |

### executor_settings

Персональные настройки исполнителей для расчётов и отчётов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `misUserId` | `character varying(50)` | Нет | — | UQ | Идентификатор связанной сущности «mis user». |
| `doctorName` | `character varying(255)` | Да | — | — | ФИО врача. |
| `settings` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные настройки записи. |
| `updatedBy` | `uuid` | Да | — | — | Идентификатор пользователя, последним изменившего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### rb_employees

Сотрудники, участвующие в расчётах реферальных бонусов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `misUserId` | `character varying(50)` | Нет | — | UQ | Идентификатор связанной сущности «mis user». |
| `name` | `character varying(255)` | Да | — | — | Наименование. |
| `professions` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «professions» в JSON. |
| `roles` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «roles» в JSON. |
| `clinics` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «clinics» в JSON. |
| `status` | `character varying(10)` | Нет | `'active'::character varying` | — | Текущий статус записи. |
| `seededBaseline` | `boolean` | Нет | `false` | — | Признак автоматически созданного базового значения. |
| `firstSeenAt` | `timestamp with time zone` | Да | — | — | Дата и время события «first seen». |
| `lastSeenAt` | `timestamp with time zone` | Да | — | — | Дата и время события «last seen». |
| `archivedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «archived». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### rb_activity_log

Аудит действий в модуле реферальных бонусов и зарплаты.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `user_id` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `tab` | `character varying(50)` | Нет | — | — | Значение поля «tab». |
| `action` | `character varying(50)` | Нет | — | — | Значение поля «action». |
| `entity_type` | `character varying(100)` | Да | — | — | Значение поля «entity type». |
| `entity_id` | `character varying(255)` | Да | — | — | Идентификатор связанной сущности «entity». |
| `doctor_name` | `character varying(255)` | Да | — | — | ФИО врача. |
| `mis_user_id` | `character varying(100)` | Да | — | — | Идентификатор связанной сущности «mis user». |
| `clinic_id` | `character varying(100)` | Да | — | — | Идентификатор связанной сущности «clinic». |
| `summary` | `text` | Нет | — | — | Значение поля «summary». |
| `diff` | `jsonb` | Да | — | — | Структурированные данные «diff» в JSON. |
| `created_at` | `timestamp with time zone` | Да | `now()` | — | Дата и время создания записи. |

### rb_excel_sources

Excel-источники для автоподгрузки при формировании зарплатных отчётов

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `dateFrom` | `date` | Нет | — | — | Начало периода, которому соответствует файл |
| `dateTo` | `date` | Нет | — | — | Конец периода, которому соответствует файл |
| `periodLabel` | `character varying(255)` | Да | — | — | Человекочитаемое название периода (напр. «Январь 2026») |
| `fileName` | `character varying(500)` | Нет | — | — | Оригинальное имя файла для скачивания |
| `fileData` | `text` | Нет | — | — | Содержимое файла в формате base64 |
| `uploadedBy` | `character varying(255)` | Да | — | — | Имя пользователя, загрузившего файл |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### rb_doctor_headers

Пользовательские заголовки и группировка врачей в отчётах.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `mis_user_id` | `character varying(100)` | Нет | — | UQ | Идентификатор связанной сущности «mis user». |
| `tabel_number` | `character varying(50)` | Да | — | — | Значение поля «tabel number». |
| `created_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updated_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

## Расписания и нормы

### doctor_schedules

Рабочие смены и интервалы расписания врачей.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `misUserId` | `character varying(100)` | Нет | — | — | Идентификатор связанной сущности «mis user». |
| `clinicId` | `character varying(50)` | Нет | — | — | Идентификатор связанной сущности «clinic». |
| `dateFrom` | `date` | Нет | — | — | Дата события «date from». |
| `dateTo` | `date` | Нет | — | — | Дата события «date to». |
| `pattern` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «pattern» в JSON. |
| `timeFrom` | `character varying(5)` | Нет | `'09:00'::character varying` | — | Значение поля «time from». |
| `timeTo` | `character varying(5)` | Нет | `'18:00'::character varying` | — | Значение поля «time to». |
| `exceptions` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «exceptions» в JSON. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |
| `category_id` | `uuid` | Да | — | FK | Ссылка на `rb_schedule_categories.id`. |
| `cabinet_id` | `uuid` | Да | — | FK | Ссылка на `rb_schedule_cabinets.id`. |
| `role_title` | `character varying(200)` | Да | — | — | Значение поля «role title». |
| `source` | `character varying(20)` | Нет | `'manual'::character varying` | — | Источник получения данных. |
| `mis_data` | `jsonb` | Да | — | — | Структурированные данные «mis data» в JSON. |

### rb_schedule_categories

Категории смен и записей расписания.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `name` | `character varying(100)` | Нет | — | — | Наименование. |
| `color` | `character varying(20)` | Нет | `'#94a3b8'::character varying` | — | Цвет для отображения в интерфейсе. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### rb_schedule_cabinets

Кабинеты, используемые в расписаниях.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `name` | `character varying(100)` | Нет | — | — | Наименование. |
| `clinic_id` | `character varying(50)` | Нет | — | — | Идентификатор связанной сущности «clinic». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### mis_schedule_category_map

Сопоставление категорий расписания с обозначениями МИС.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `mis_category_id` | `integer` | Нет | — | UQ | Идентификатор связанной сущности «mis category». |
| `rb_category_id` | `uuid` | Да | — | FK | Ссылка на `rb_schedule_categories.id`. |
| `created_at` | `timestamp with time zone` | Да | `now()` | — | Дата и время создания записи. |
| `updated_at` | `timestamp with time zone` | Да | `now()` | — | Дата и время последнего изменения записи. |

### rb_holidays

Праздничные и нерабочие дни для расчёта расписаний.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `date` | `date` | Нет | — | UQ | Календарная дата записи. |
| `name` | `character varying(200)` | Да | — | — | Наименование. |
| `created_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updated_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### hour_norms

Месячные и периодические нормы рабочих часов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `professionTitle` | `character varying(255)` | Нет | — | UQ* | Значение поля «profession title». |
| `year` | `integer` | Нет | — | UQ* | Год, к которому относится запись. |
| `month` | `integer` | Нет | — | UQ* | Месяц, к которому относится запись. |
| `normHours` | `numeric(10,2)` | Да | — | — | Числовое значение «norm hours». |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### role_norms

Нормы рабочего времени для ролей сотрудников.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `roleTitle` | `character varying(255)` | Нет | — | UQ* | Значение поля «role title». |
| `year` | `integer` | Нет | — | UQ* | Год, к которому относится запись. |
| `month` | `integer` | Нет | — | UQ* | Месяц, к которому относится запись. |
| `normHours` | `numeric(10,2)` | Да | — | — | Числовое значение «norm hours». |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### category_norms

Нормы рабочего времени по категориям расписания.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `categoryId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `rb_schedule_categories.id`. |
| `year` | `integer` | Нет | — | UQ* | Год, к которому относится запись. |
| `month` | `integer` | Нет | — | UQ* | Месяц, к которому относится запись. |
| `normHours` | `numeric(10,2)` | Да | — | — | Числовое значение «norm hours». |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### tabel_records

Строки табеля рабочего времени.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `month` | `smallint` | Нет | — | — | Месяц, к которому относится запись. |
| `year` | `smallint` | Нет | — | — | Год, к которому относится запись. |
| `org_name` | `character varying(255)` | Да | — | — | Значение поля «org name». |
| `subdivision` | `character varying(255)` | Да | — | — | Значение поля «subdivision». |
| `doc_number` | `character varying(50)` | Да | — | — | Значение поля «doc number». |
| `created_by` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `created_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updated_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |
| `user_name` | `character varying(255)` | Да | — | — | Значение поля «user name». |
| `tabel_type` | `character varying(20)` | Нет | `'standard'::character varying` | — | Значение поля «tabel type». |

### tabel_record_doctors

Связь строк табеля с врачами.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `tabel_record_id` | `uuid` | Нет | — | FK | Ссылка на `tabel_records.id`. |
| `mis_user_id` | `character varying(100)` | Нет | — | — | Идентификатор связанной сущности «mis user». |
| `doctor_name` | `character varying(255)` | Да | — | — | ФИО врача. |
| `entries` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «entries» в JSON. |
| `pay_data` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «pay data» в JSON. |
| `created_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updated_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

## Сравнение цен

### price_comparisons

Сохранённые наборы сравнения цен.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `name` | `character varying(255)` | Нет | — | — | Наименование. |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `createdBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `competitors` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «competitors» в JSON. |
| `ownMedCenters` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «own med centers» в JSON. |
| `createdAt` | `timestamp with time zone` | Нет | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |
| `comparisonType` | `character varying(20)` | Нет | `'external'::character varying` | — | Значение поля «comparison type». |
| `competitorBindings` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «competitor bindings» в JSON. |
| `columnOrder` | `jsonb` | Нет | `'[]'::jsonb` | — | Порядок колонок в таблице; пустой массив — порядок по умолчанию |

### price_comparison_items

Строки и показатели одного сравнения цен.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `comparisonId` | `uuid` | Нет | — | FK | Ссылка на `price_comparisons.id`. |
| `serviceCode` | `character varying(100)` | Нет | — | — | Код медицинской услуги. |
| `serviceName` | `character varying(500)` | Нет | — | — | Наименование медицинской услуги. |
| `misServiceId` | `character varying(50)` | Да | — | — | Идентификатор связанной сущности «mis service». |
| `prices` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «prices» в JSON. |
| `sortOrder` | `integer` | Нет | `0` | — | Порядок отображения. |
| `createdAt` | `timestamp with time zone` | Нет | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |
| `priceHistory` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «price history» в JSON. |
| `costPrices` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «cost prices» в JSON. |
| `lab` | `character varying(255)` | Нет | `''::character varying` | — | Значение поля «lab». |
| `priceSources` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «price sources» в JSON. |

### competitor_sources

Источники данных о ценах и услугах конкурентов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `parserSourceId` | `integer` | Нет | — | — | Идентификатор связанной сущности «parser source». |
| `name` | `character varying(255)` | Нет | — | — | Наименование. |
| `baseUrl` | `text` | Нет | — | — | Значение поля «base url». |
| `city` | `character varying(150)` | Да | — | — | Значение поля «city». |
| `servicesTotal` | `integer` | Нет | `0` | — | Значение поля «services total». |
| `lastRunAt` | `timestamp with time zone` | Да | — | — | Дата и время события «last run». |
| `lastRunStatus` | `character varying(16)` | Да | — | — | Значение поля «last run status». |
| `syncedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «synced». |
| `syncStatus` | `character varying(16)` | Нет | `'pending'::character varying` | — | Значение поля «sync status». |
| `syncError` | `text` | Да | — | — | Значение поля «sync error». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |
| `competitorLabel` | `character varying(255)` | Да | — | — | Значение поля «competitor label». |
| `displayName` | `character varying(255)` | Да | — | — | Отображаемое имя. |
| `logoUrl` | `text` | Да | — | — | Значение поля «logo url». |
| `logoData` | `bytea` | Да | — | — | Значение поля «logo data». |
| `logoContentType` | `character varying(100)` | Да | — | — | Значение поля «logo content type». |
| `logoIsCustom` | `boolean` | Нет | `false` | — | Логотип загружен человеком — автосбор с сайта его не трогает |

### competitor_locations

Филиалы и географические точки медицинских организаций-конкурентов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `sourceId` | `uuid` | Нет | — | FK | Ссылка на `competitor_sources.id`. |
| `parserLocationId` | `integer` | Нет | — | — | Идентификатор связанной сущности «parser location». |
| `name` | `character varying(255)` | Да | — | — | Наименование. |
| `address` | `text` | Нет | — | — | Значение поля «address». |
| `city` | `character varying(150)` | Да | — | — | Значение поля «city». |
| `origin` | `character varying(16)` | Нет | `'text'::character varying` | — | Значение поля «origin». |
| `parserFilialId` | `integer` | Да | — | — | Идентификатор связанной сущности «parser filial». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |
| `lat` | `numeric(9,6)` | Да | — | — | Географическая широта. |
| `lon` | `numeric(9,6)` | Да | — | — | Географическая долгота. |
| `geoOrigin` | `character varying(16)` | Да | — | — | nominatim \| manual — выправленное мышью автопрогон не трогает |
| `geocodedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «geocoded». |
| `filialIdManual` | `integer` | Да | — | — | Филиал прайса, указанный человеком; перекрывает parserFilialId |

### competitor_services

Нормализованный каталог услуг конкурентов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `sourceId` | `uuid` | Нет | — | FK | Ссылка на `competitor_sources.id`. |
| `parserServiceId` | `integer` | Нет | — | — | Идентификатор связанной сущности «parser service». |
| `externalId` | `character varying(255)` | Да | — | — | Идентификатор связанной сущности «external». |
| `name` | `text` | Нет | — | — | Наименование. |
| `url` | `text` | Да | — | — | URL внешнего или внутреннего ресурса. |
| `category` | `text` | Да | — | — | Категория записи. |
| `categoryPath` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «category path» в JSON. |
| `turnaround` | `character varying(255)` | Да | — | — | Значение поля «turnaround». |
| `codes` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «codes» в JSON. |
| `isActive` | `boolean` | Нет | `true` | — | Признак активной записи. |
| `lastSeenAt` | `timestamp with time zone` | Да | — | — | Дата и время события «last seen». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |
| `nameNormalized` | `text` | Да | — | — | Значение поля «name normalized». |

### competitor_prices

Полученные цены конкурентов на медицинские услуги.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `serviceId` | `uuid` | Нет | — | FK | Ссылка на `competitor_services.id`. |
| `filialId` | `integer` | Да | — | — | Идентификатор связанной сущности «filial». |
| `filialName` | `character varying(255)` | Да | — | — | Значение поля «filial name». |
| `price` | `numeric(12,2)` | Да | — | — | Цена. |
| `priceMin` | `numeric(12,2)` | Да | — | — | Значение поля «price min». |
| `priceMax` | `numeric(12,2)` | Да | — | — | Значение поля «price max». |
| `priceDiscount` | `numeric(12,2)` | Да | — | — | Значение поля «price discount». |
| `currency` | `character varying(3)` | Нет | `'RUB'::character varying` | — | Значение поля «currency». |
| `observedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «observed». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### competitor_service_matches

Сопоставления услуг конкурентов с внутренним справочником.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `itemId` | `uuid` | Нет | — | FK | Ссылка на `price_comparison_items.id`. |
| `competitorServiceId` | `uuid` | Нет | — | FK | Ссылка на `competitor_services.id`. |
| `status` | `character varying(16)` | Нет | `'suggested'::character varying` | — | Текущий статус записи. |
| `method` | `character varying(16)` | Нет | `'name'::character varying` | — | Значение поля «method». |
| `score` | `numeric(4,3)` | Да | — | — | Значение поля «score». |
| `confirmedBy` | `uuid` | Да | — | — | Значение поля «confirmed by». |
| `confirmedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «confirmed». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

## Публичный API и формы

### api_clients

Клиенты публичного API и их параметры доступа.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `name` | `character varying(150)` | Нет | — | — | Наименование. |
| `keyType` | `character varying(10)` | Нет | `'secret'::character varying` | — | Значение поля «key type». |
| `keyPrefix` | `character varying(32)` | Нет | — | — | Значение поля «key prefix». |
| `keyHash` | `character varying(64)` | Нет | — | — | Значение поля «key hash». |
| `scopes` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «scopes» в JSON. |
| `allowedOrigins` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «allowed origins» в JSON. |
| `allowedIps` | `jsonb` | Нет | `'[]'::jsonb` | — | Структурированные данные «allowed ips» в JSON. |
| `rateLimitPerMin` | `integer` | Нет | `60` | — | Значение поля «rate limit per min». |
| `isActive` | `boolean` | Нет | `true` | — | Признак активной записи. |
| `lastUsedAt` | `timestamp with time zone` | Да | — | — | Дата и время события «last used». |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |
| `updatedBy` | `uuid` | Да | — | — | Кто последним менял права ключа |

### api_request_logs

Технический журнал обращений к публичному API.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `bigint` | Нет | `nextval('api_request_logs_id_seq'::regclass)` | PK | Уникальный идентификатор записи. |
| `clientId` | `uuid` | Да | — | — | Идентификатор связанной сущности «client». |
| `method` | `character varying(10)` | Нет | — | — | Значение поля «method». |
| `path` | `text` | Нет | — | — | Путь к ресурсу в хранилище. |
| `statusCode` | `integer` | Нет | — | — | Значение поля «status code». |
| `errorCode` | `character varying(50)` | Да | — | — | Значение поля «error code». |
| `durationMs` | `integer` | Да | — | — | Значение поля «duration ms». |
| `ip` | `character varying(64)` | Да | — | — | IP-адрес источника запроса. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |

### submissions

Полученные через публичный API данные форм.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `formType` | `character varying(50)` | Нет | — | — | Значение поля «form type». |
| `clientId` | `uuid` | Да | — | FK | Ссылка на `api_clients.id`. |
| `payload` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированное содержимое события или запроса. |
| `status` | `character varying(20)` | Нет | `'new'::character varying` | — | Текущий статус записи. |
| `deliveryStatus` | `character varying(20)` | Нет | `'pending'::character varying` | — | Значение поля «delivery status». |
| `deliveryAttempts` | `integer` | Нет | `0` | — | Числовое значение «delivery attempts». |
| `deliveryError` | `text` | Да | — | — | Значение поля «delivery error». |
| `deliveredMsgId` | `bigint` | Да | — | — | Идентификатор связанной сущности «delivered msg». |
| `deliveredAt` | `timestamp with time zone` | Да | — | — | Дата и время события «delivered». |
| `assignedUserId` | `uuid` | Да | — | — | Идентификатор связанной сущности «assigned user». |
| `sourceIp` | `character varying(64)` | Да | — | — | Значение поля «source ip». |
| `userAgent` | `text` | Да | — | — | Значение HTTP-заголовка User-Agent. |
| `idempotencyKey` | `character varying(100)` | Да | — | — | Значение поля «idempotency key». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### submission_deliveries

Попытки доставки данных формы конечным получателям.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `bigint` | Нет | `nextval('submission_deliveries_id_seq'::regclass)` | PK | Уникальный идентификатор записи. |
| `submissionId` | `uuid` | Нет | — | FK | Ссылка на `submissions.id`. |
| `chatId` | `uuid` | Нет | — | — | Идентификатор связанной сущности «chat». |
| `botId` | `uuid` | Да | — | — | Идентификатор связанной сущности «bot». |
| `status` | `character varying(20)` | Нет | `'pending'::character varying` | — | Текущий статус записи. |
| `attempts` | `integer` | Нет | `0` | — | Значение поля «attempts». |
| `error` | `text` | Да | — | — | Описание возникшей ошибки. |
| `messageId` | `bigint` | Да | — | — | Идентификатор связанной сущности «message». |
| `deliveredAt` | `timestamp with time zone` | Да | — | — | Дата и время события «delivered». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### int_id_map

Соответствие внешних целочисленных идентификаторов внутренним UUID.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `bigint` | Нет | `nextval('int_id_map_id_seq'::regclass)` | PK | Уникальный идентификатор записи. |
| `uuid` | `uuid` | Нет | — | UQ | Значение поля «uuid». |
| `entityType` | `character varying(20)` | Нет | — | — | Значение поля «entity type». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |

## Email

### email_templates

Шаблоны email-рассылок

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `name` | `character varying(200)` | Нет | — | — | Название шаблона письма |
| `subject` | `character varying(500)` | Нет | — | — | Тема письма |
| `htmlContent` | `text` | Нет | — | — | HTML содержимое письма |
| `createdBy` | `uuid` | Нет | — | FK | ID пользователя-создателя шаблона |
| `isPublic` | `boolean` | Да | `true` | — | Публичный шаблон (доступен всем) или личный |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### email_logs

История отправленных email-рассылок

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `subject` | `character varying(500)` | Нет | — | — | Тема письма |
| `htmlContent` | `text` | Нет | — | — | HTML содержимое письма |
| `recipients` | `jsonb` | Нет | — | — | Массив получателей: [{email, userId, displayName}] |
| `attachments` | `jsonb` | Да | `'[]'::jsonb` | — | Массив вложений: [{name, path, size, mimeType}] |
| `sentBy` | `uuid` | Нет | — | FK | ID пользователя, отправившего рассылку |
| `sentAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Время отправки |
| `status` | `character varying(50)` | Да | `'sent'::character varying` | — | Статус отправки: sent (успешно), failed (ошибка), partial (частично) |
| `errorDetails` | `text` | Да | — | — | JSON с деталями ошибок отправки |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### email_favorite_templates

Избранные шаблоны email для каждого пользователя

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `userId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `users.id`. |
| `templateId` | `uuid` | Нет | — | FK, UQ* | Ссылка на `email_templates.id`. |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

### email_favorite_recipients

Избранные получатели email для каждого пользователя

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `userId` | `uuid` | Нет | — | UQ*, FK | Ссылка на `users.id`. |
| `email` | `character varying(255)` | Нет | — | UQ* | Адрес электронной почты. |
| `displayName` | `character varying(200)` | Да | — | — | Отображаемое имя. |
| `createdAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `CURRENT_TIMESTAMP` | — | Дата и время последнего изменения записи. |

## Реестры и отчёты

### ambulance_report_entries

Строки отчёта по работе скорой медицинской помощи.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `entryType` | `ambulance_report_entry_type` | Нет | — | — | Значение поля «entry type». |
| `seqNumber` | `integer` | Да | — | — | Числовое значение «seq number». |
| `entryDate` | `date` | Да | — | — | Дата события «entry». |
| `entryTime` | `character varying(5)` | Да | — | — | Значение поля «entry time». |
| `patientName` | `character varying(255)` | Да | — | — | ФИО пациента. |
| `sourceCallId` | `uuid` | Да | — | — | Идентификатор связанной сущности «source call». |
| `searchText` | `text` | Да | — | — | Нормализованный текст для поиска. |
| `data` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «data» в JSON. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### certificate_registry_entries

Реестр выданных сертификатов.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `org` | `certificate_registry_org` | Нет | — | — | Значение поля «org». |
| `seqNumber` | `integer` | Да | — | — | Числовое значение «seq number». |
| `searchText` | `text` | Да | — | — | Нормализованный текст для поиска. |
| `data` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «data» в JSON. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |
| `year` | `integer` | Да | — | — | Год, к которому относится запись. |

### doctor_day_report_entries

Строки ежедневного отчёта врача.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `year` | `integer` | Нет | — | — | Год, к которому относится запись. |
| `month` | `integer` | Нет | — | — | Месяц, к которому относится запись. |
| `doctorName` | `text` | Нет | — | — | ФИО врача. |
| `days` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «days» в JSON. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### operations_report_entries

Строки отчёта о проведённых операциях.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `entryDate` | `date` | Да | — | — | Дата события «entry». |
| `searchText` | `text` | Да | — | — | Нормализованный текст для поиска. |
| `data` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «data» в JSON. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### gynecology_report_entries

Строки гинекологического отчёта.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `entryDate` | `date` | Да | — | — | Дата события «entry». |
| `searchText` | `text` | Да | — | — | Нормализованный текст для поиска. |
| `data` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «data» в JSON. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### therapy_report_entries

Строки терапевтического отчёта.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `entryDate` | `date` | Да | — | — | Дата события «entry». |
| `searchText` | `text` | Да | — | — | Нормализованный текст для поиска. |
| `data` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «data» в JSON. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### surgery_report_entries

Строки отчёта о хирургических вмешательствах.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `entryDate` | `date` | Да | — | — | Дата события «entry». |
| `searchText` | `text` | Да | — | — | Нормализованный текст для поиска. |
| `data` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «data» в JSON. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### discount_report_entries

Строки отчёта по предоставленным скидкам.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `entryDate` | `date` | Да | — | — | Дата события «entry». |
| `searchText` | `text` | Да | — | — | Нормализованный текст для поиска. |
| `data` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «data» в JSON. |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

## Прочее и системные данные

### calendar_events

События общего и персонального календаря.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `title` | `character varying(255)` | Нет | — | — | Заголовок или название. |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `startTime` | `timestamp with time zone` | Нет | — | — | Время начала. |
| `endTime` | `timestamp with time zone` | Нет | — | — | Время окончания. |
| `allDay` | `boolean` | Да | `false` | — | Признак события на весь день. |
| `eventType` | `character varying(50)` | Нет | `'personal'::character varying` | — | Значение поля «event type». |
| `priority` | `character varying(20)` | Да | `'medium'::character varying` | — | Значение поля «priority». |
| `status` | `character varying(20)` | Да | `'planned'::character varying` | — | Текущий статус записи. |
| `color` | `character varying(20)` | Да | `'#4a90e2'::character varying` | — | Цвет для отображения в интерфейсе. |
| `location` | `character varying(500)` | Да | — | — | Значение поля «location». |
| `isRecurring` | `boolean` | Да | `false` | — | Признак повторяющегося события. |
| `recurrenceRule` | `jsonb` | Да | — | — | Структурированные данные «recurrence rule» в JSON. |
| `parentEventId` | `uuid` | Да | — | FK | Ссылка на `calendar_events.id`. |
| `participants` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «participants» в JSON. |
| `reminders` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «reminders» в JSON. |
| `linkedEntityType` | `character varying(50)` | Да | — | — | Значение поля «linked entity type». |
| `linkedEntityId` | `uuid` | Да | — | — | Идентификатор связанной сущности «linked entity». |
| `createdBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `visibility` | `character varying(20)` | Да | `'private'::character varying` | — | Значение поля «visibility». |
| `sharedWith` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «shared with» в JSON. |
| `lastReminderSent` | `timestamp with time zone` | Да | — | — | Дата и время события «last reminder sent». |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |
| `exceptions` | `jsonb` | Да | `'[]'::jsonb` | — | Массив дат (ISO строк) когда повторяющееся событие НЕ должно происходить |
| `sentReminders` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «sent reminders» в JSON. |

### promotions

Маркетинговые акции и сроки их действия.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `title` | `character varying(255)` | Нет | — | — | Заголовок или название. |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `medCenter` | `character varying(50)` | Нет | — | — | Значение поля «med center». |
| `dateFrom` | `date` | Да | — | — | Дата события «date from». |
| `deadline` | `date` | Да | — | — | Дата события «deadline». |
| `createdBy` | `uuid` | Да | — | — | Идентификатор пользователя, создавшего запись. |
| `createdAt` | `timestamp with time zone` | Да | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Да | `now()` | — | Дата и время последнего изменения записи. |

### vehicles

Реестр транспортных средств.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | — | PK | Уникальный идентификатор записи. |
| `organization` | `character varying(255)` | Нет | — | — | Значение поля «organization». |
| `carBrand` | `character varying(255)` | Нет | — | — | Значение поля «car brand». |
| `licensePlate` | `character varying(20)` | Нет | — | — | Значение поля «license plate». |
| `carYear` | `integer` | Нет | — | — | Числовое значение «car year». |
| `mileage` | `integer` | Нет | `0` | — | Значение поля «mileage». |
| `nextTO` | `integer` | Нет | `0` | — | Значение поля «next to». |
| `insuranceDate` | `date` | Нет | — | — | Дата события «insurance». |
| `condition` | `enum_vehicles_condition` | Да | `'Хорошее'::enum_vehicles_condition` | — | Значение поля «condition». |
| `comment` | `text` | Да | — | — | Комментарий. |
| `reminded30` | `boolean` | Да | `false` | — | Признак отправки напоминания за 30 дней. |
| `reminded14` | `boolean` | Да | `false` | — | Признак отправки напоминания за 14 дней. |
| `reminded7` | `boolean` | Да | `false` | — | Признак отправки напоминания за 7 дней. |
| `remindedTO` | `boolean` | Да | `false` | — | Признак отправки напоминания о техническом обслуживании. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |
| `isArchived` | `boolean` | Да | `false` | — | Запись перенесена в архив |

### vehicle_files

Файлы, прикрепленные к записям о транспортных средствах

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `vehicleId` | `uuid` | Нет | — | FK | ID транспортного средства, к которому прикреплен файл |
| `filename` | `character varying(255)` | Нет | — | — | Имя файла на сервере |
| `originalName` | `character varying(255)` | Нет | — | — | Оригинальное имя файла |
| `mimeType` | `character varying(100)` | Да | — | — | MIME тип файла |
| `size` | `bigint` | Да | — | — | Размер файла в байтах |
| `path` | `character varying(1000)` | Нет | — | — | Путь к файлу на сервере |
| `uploadedBy` | `uuid` | Да | — | FK | ID пользователя, загрузившего файл |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### map_markers

Метки и объекты, отображаемые на карте.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `lat` | `double precision` | Нет | — | — | Географическая широта. |
| `lng` | `double precision` | Нет | — | — | Значение поля «lng». |
| `title` | `character varying(255)` | Нет | — | — | Заголовок или название. |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `color` | `character varying(20)` | Да | `'#4a90e2'::character varying` | — | Цвет для отображения в интерфейсе. |
| `media` | `jsonb` | Да | `'[]'::jsonb` | — | Структурированные данные «media» в JSON. |
| `category` | `character varying(100)` | Да | — | — | Категория записи. |
| `createdBy` | `uuid` | Да | — | FK | Ссылка на `users.id`. |
| `createdAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### directories_meta

Метаданные справочников и время их обновления.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `id` | `uuid` | Нет | `gen_random_uuid()` | PK | Уникальный идентификатор записи. |
| `entity_type` | `character varying(50)` | Нет | — | UQ* | Значение поля «entity type». |
| `entity_id` | `character varying(255)` | Нет | — | UQ* | Идентификатор связанной сущности «entity». |
| `data` | `jsonb` | Нет | `'{}'::jsonb` | — | Структурированные данные «data» в JSON. |
| `created_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время создания записи. |
| `updated_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время последнего изменения записи. |

### settings

Глобальные настройки приложения в формате ключ–значение.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `key` | `character varying(100)` | Нет | — | PK | Значение поля «key». |
| `value` | `jsonb` | Да | — | — | Структурированные данные «value» в JSON. |
| `description` | `text` | Да | — | — | Текстовое описание. |
| `createdAt` | `timestamp with time zone` | Нет | — | — | Дата и время создания записи. |
| `updatedAt` | `timestamp with time zone` | Нет | — | — | Дата и время последнего изменения записи. |

### schema_migrations

Технический журнал применённых миграций БД.

| Поле | Тип PostgreSQL | Допускает NULL | Default | Ключ | Описание |
|---|---|:---:|---|:---:|---|
| `name` | `text` | Нет | — | PK | Наименование. |
| `checksum` | `character(64)` | Нет | — | — | Значение поля «checksum». |
| `applied_at` | `timestamp with time zone` | Нет | `now()` | — | Дата и время события «applied». |
