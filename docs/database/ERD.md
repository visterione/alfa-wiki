# ERD production-БД

Диаграммы построены по **101 фактическим внешним ключам** production PostgreSQL на 6 августа 2026 г. в 22:29:08 (MSK). Для читаемости схема разделена на функциональные области; внешние сущности, на которые ссылается область, также показаны в соответствующей диаграмме.

В блоках сущностей приведены только поля PK/FK. Полный состав полей находится в [словаре полей](FIELDS.md).

## Пользователи и доступ

Учётные записи, роли, сессии, устройства и разграничение доступа.

```mermaid
erDiagram
    structural_divisions ||--o{ division_access : "division_id"
    users ||--o{ division_access : "user_id"
    users |o--o{ structural_divisions : "created_by"
    users ||--o{ user_devices : "userId"
    med_centers ||--o{ user_med_centers : "medCenterId"
    users ||--o{ user_med_centers : "userId"
    roles ||--o{ user_roles : "roleId"
    users ||--o{ user_roles : "userId"
    users ||--o{ user_sessions : "userId"
    users |o--o{ users : "deletedBy"
    roles |o--o{ users : "roleId"
    division_access {
      uuid id PK
      uuid division_id FK
      uuid user_id FK
    }
    med_centers {
      uuid id PK
    }
    rb_user_permissions {
      uuid id PK
    }
    roles {
      uuid id PK
    }
    structural_divisions {
      uuid id PK
      uuid created_by FK
    }
    user_devices {
      uuid id PK
      uuid userId FK
    }
    user_med_centers {
      uuid id PK
      uuid userId FK
      uuid medCenterId FK
    }
    user_roles {
      uuid id PK
      uuid userId FK
      uuid roleId FK
    }
    user_sessions {
      uuid id PK
      uuid userId FK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
```

## Wiki и контент

Страницы базы знаний, структура меню, файлы, поиск и журнал изменений.

```mermaid
erDiagram
    users |o--o{ analysis_page_notes : "updatedBy"
    users ||--o{ announcements : "authorId"
    users |o--o{ folders : "createdBy"
    folders |o--o{ folders : "parentId"
    users |o--o{ media : "uploadedBy"
    pages |o--o{ page_history : "pageId"
    users ||--o{ page_history : "userId"
    users |o--o{ pages : "createdBy"
    folders |o--o{ pages : "folderId"
    media |o--o{ pages : "mediaId"
    users |o--o{ pages : "updatedBy"
    release_notes ||--o{ release_note_reads : "releaseNoteId"
    users |o--o{ service_page_notes : "updatedBy"
    folders |o--o{ sidebar_items : "folderId"
    pages |o--o{ sidebar_items : "pageId"
    sidebar_items |o--o{ sidebar_items : "parentId"
    pages ||--o{ user_favorites : "pageId"
    users ||--o{ user_favorites : "userId"
    analysis_page_notes {
      uuid id PK
      uuid updatedBy FK
    }
    announcements {
      uuid id PK
      uuid authorId FK
    }
    folders {
      uuid id PK
      uuid parentId FK
      uuid createdBy FK
    }
    media {
      uuid id PK
      uuid uploadedBy FK
    }
    page_history {
      uuid id PK
      uuid pageId FK
      uuid userId FK
    }
    pages {
      uuid id PK
      uuid folderId FK
      uuid createdBy FK
      uuid updatedBy FK
      uuid mediaId FK
    }
    release_note_reads {
      uuid id PK
      uuid releaseNoteId FK
    }
    release_notes {
      uuid id PK
    }
    search_index {
      uuid id PK
    }
    service_page_notes {
      uuid id PK
      uuid updatedBy FK
    }
    sidebar_items {
      uuid id PK
      uuid pageId FK
      uuid folderId FK
      uuid parentId FK
    }
    user_favorites {
      uuid id PK
      uuid userId FK
      uuid pageId FK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
```

## Чаты и боты

Чаты, сообщения, реакции, подписчики и интеграции ботов.

```mermaid
erDiagram
    users ||--o{ bot_tokens : "userId"
    bot_tokens ||--o{ bot_updates : "botId"
    chats ||--o{ chat_members : "chatId"
    users ||--o{ chat_members : "userId"
    bot_tokens ||--o{ form_subscriptions : "botId"
    chats ||--o{ form_subscriptions : "chatId"
    messages ||--o{ message_reactions : "messageId"
    users ||--o{ message_reactions : "userId"
    chats ||--o{ messages : "chatId"
    messages |o--o{ messages : "replyToId"
    users ||--o{ messages : "senderId"
    bot_subscribers {
      uuid id PK
    }
    bot_tokens {
      uuid id PK
      uuid userId FK
    }
    bot_updates {
      integer id PK
      uuid botId FK
    }
    chat_members {
      uuid id PK
      uuid chatId FK
      uuid userId FK
    }
    chats {
      uuid id PK
    }
    form_subscriptions {
      uuid id PK
      uuid botId FK
      uuid chatId FK
    }
    message_reactions {
      uuid id PK
      uuid messageId FK
      uuid userId FK
    }
    messages {
      uuid id PK
      uuid chatId FK
      uuid senderId FK
      uuid replyToId FK
    }
    telegram_subscribers {
      uuid id PK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
```

## Курсы

Учебные курсы, уроки, вопросы, прогресс и правила доступа.

```mermaid
erDiagram
    courses ||--o{ course_medcenters : "courseId"
    med_centers ||--o{ course_medcenters : "medCenterId"
    courses ||--o{ course_progress : "courseId"
    lessons |o--o{ course_progress : "currentLessonId"
    users ||--o{ course_progress : "userId"
    courses ||--o{ course_roles : "courseId"
    roles ||--o{ course_roles : "roleId"
    courses ||--o{ course_users : "courseId"
    users ||--o{ course_users : "userId"
    users |o--o{ courses : "createdBy"
    courses ||--o{ lessons : "courseId"
    courses ||--o{ test_questions : "courseId"
    course_medcenters {
      uuid id PK
      uuid courseId FK
      uuid medCenterId FK
    }
    course_progress {
      uuid id PK
      uuid userId FK
      uuid courseId FK
      uuid currentLessonId FK
    }
    course_roles {
      uuid id PK
      uuid courseId FK
      uuid roleId FK
    }
    course_users {
      uuid id PK
      uuid courseId FK
      uuid userId FK
    }
    courses {
      uuid id PK
      uuid createdBy FK
    }
    lessons {
      uuid id PK
      uuid courseId FK
    }
    med_centers {
      uuid id PK
    }
    roles {
      uuid id PK
    }
    test_questions {
      uuid id PK
      uuid courseId FK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
```

## Канбан

Доски, задачи и права доступа к ним.

```mermaid
erDiagram
    kanban_boards ||--o{ board_permissions : "boardId"
    users ||--o{ board_permissions : "userId"
    users ||--o{ kanban_boards : "ownerId"
    kanban_boards |o--o{ kanban_tasks : "boardId"
    users |o--o{ kanban_tasks : "createdBy"
    board_permissions {
      uuid id PK
      uuid boardId FK
      uuid userId FK
    }
    kanban_boards {
      uuid id PK
      uuid ownerId FK
    }
    kanban_tasks {
      uuid id PK
      uuid createdBy FK
      uuid boardId FK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
```

## Отзывы

Сбор, синхронизация и обработка отзывов из внешних источников.

```mermaid
erDiagram
    review_boards ||--o{ review_board_permissions : "boardId"
    users ||--o{ review_board_permissions : "userId"
    review_boards ||--o{ review_board_roles : "boardId"
    users ||--o{ review_board_roles : "userId"
    users ||--o{ review_boards : "ownerId"
    reviews ||--o{ review_history : "reviewId"
    users ||--o{ review_history : "userId"
    review_boards ||--o{ review_sync_configs : "boardId"
    review_boards ||--o{ reviews : "boardId"
    users |o--o{ reviews : "createdBy"
    users |o--o{ reviews : "finalizedBy"
    review_platforms ||--o{ reviews : "platformId"
    review_board_permissions {
      uuid id PK
      uuid boardId FK
      uuid userId FK
    }
    review_board_roles {
      uuid id PK
      uuid boardId FK
      uuid userId FK
    }
    review_boards {
      uuid id PK
      uuid ownerId FK
    }
    review_history {
      uuid id PK
      uuid reviewId FK
      uuid userId FK
    }
    review_platforms {
      uuid id PK
    }
    review_sync_configs {
      uuid id PK
      uuid boardId FK
    }
    reviews {
      uuid id PK
      uuid boardId FK
      uuid platformId FK
      uuid createdBy FK
      uuid finalizedBy FK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
```

## МИС и медицинские справочники

Данные МИС, услуги, анализы, врачи, аккредитации и медицинская номенклатура.

```mermaid
erDiagram
    accreditations ||--o{ accreditation_files : "accreditationId"
    users |o--o{ accreditation_files : "uploadedBy"
    doctor_cards |o--o{ doctor_service_durations : "sourceCardId"
    users |o--o{ doctor_service_durations : "updatedBy"
    accreditation_files {
      uuid id PK
      uuid accreditationId FK
      uuid uploadedBy FK
    }
    accreditations {
      uuid id PK
    }
    analyses {
      uuid id PK
    }
    doctor_cards {
      uuid id PK
    }
    doctor_service_durations {
      uuid id PK
      uuid sourceCardId FK
      uuid updatedBy FK
    }
    mis_appointments {
      integer id PK
    }
    mis_payments {
      integer id PK
    }
    nomenclature_804n {
      string code PK
    }
    partner_service_cache {
      integer id PK
    }
    services {
      uuid id PK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
```

## Зарплата и реферальные бонусы

Начисления, выплаты, расходники, отчёты и настройки расчёта.

```mermaid
erDiagram
    salary_records |o--o{ cash_payments : "salaryRecordId"
    users |o--o{ rb_activity_log : "user_id"
    users |o--o{ service_consumables : "createdBy"
    cash_payments {
      uuid id PK
      uuid salaryRecordId FK
    }
    executor_settings {
      uuid id PK
    }
    performed_service_bonuses {
      uuid id PK
    }
    rb_activity_log {
      uuid id PK
      uuid user_id FK
    }
    rb_doctor_headers {
      uuid id PK
    }
    rb_employees {
      uuid id PK
    }
    rb_excel_sources {
      uuid id PK
    }
    referral_bonuses {
      uuid id PK
    }
    referral_reports {
      uuid id PK
    }
    salary_records {
      uuid id PK
    }
    service_consumables {
      uuid id PK
      uuid createdBy FK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
```

## Расписания и нормы

Расписания врачей, нормы времени, табели, кабинеты и праздники.

```mermaid
erDiagram
    rb_schedule_categories ||--o{ category_norms : "categoryId"
    rb_schedule_cabinets |o--o{ doctor_schedules : "cabinet_id"
    rb_schedule_categories |o--o{ doctor_schedules : "category_id"
    rb_schedule_categories |o--o{ mis_schedule_category_map : "rb_category_id"
    tabel_records ||--o{ tabel_record_doctors : "tabel_record_id"
    users |o--o{ tabel_records : "created_by"
    category_norms {
      uuid id PK
      uuid categoryId FK
    }
    doctor_schedules {
      uuid id PK
      uuid category_id FK
      uuid cabinet_id FK
    }
    hour_norms {
      uuid id PK
    }
    mis_schedule_category_map {
      uuid id PK
      uuid rb_category_id FK
    }
    rb_holidays {
      uuid id PK
    }
    rb_schedule_cabinets {
      uuid id PK
    }
    rb_schedule_categories {
      uuid id PK
    }
    role_norms {
      uuid id PK
    }
    tabel_record_doctors {
      uuid id PK
      uuid tabel_record_id FK
    }
    tabel_records {
      uuid id PK
      uuid created_by FK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
```

## Сравнение цен

Источники конкурентов, география, услуги, цены и сопоставления.

```mermaid
erDiagram
    competitor_sources ||--o{ competitor_locations : "sourceId"
    competitor_services ||--o{ competitor_prices : "serviceId"
    competitor_services ||--o{ competitor_service_matches : "competitorServiceId"
    price_comparison_items ||--o{ competitor_service_matches : "itemId"
    competitor_sources ||--o{ competitor_services : "sourceId"
    price_comparisons ||--o{ price_comparison_items : "comparisonId"
    users |o--o{ price_comparisons : "createdBy"
    competitor_locations {
      uuid id PK
      uuid sourceId FK
    }
    competitor_prices {
      uuid id PK
      uuid serviceId FK
    }
    competitor_service_matches {
      uuid id PK
      uuid itemId FK
      uuid competitorServiceId FK
    }
    competitor_services {
      uuid id PK
      uuid sourceId FK
    }
    competitor_sources {
      uuid id PK
    }
    price_comparison_items {
      uuid id PK
      uuid comparisonId FK
    }
    price_comparisons {
      uuid id PK
      uuid createdBy FK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
```

## Публичный API и формы

API-клиенты, аудит запросов, формы и доставка результатов.

```mermaid
erDiagram
    submissions ||--o{ submission_deliveries : "submissionId"
    api_clients |o--o{ submissions : "clientId"
    api_clients {
      uuid id PK
    }
    api_request_logs {
      integer id PK
    }
    int_id_map {
      integer id PK
    }
    submission_deliveries {
      integer id PK
      uuid submissionId FK
    }
    submissions {
      uuid id PK
      uuid clientId FK
    }
```

## Email

Шаблоны, журнал рассылок и пользовательское избранное.

```mermaid
erDiagram
    users ||--o{ email_favorite_recipients : "userId"
    email_templates ||--o{ email_favorite_templates : "templateId"
    users ||--o{ email_favorite_templates : "userId"
    users ||--o{ email_logs : "sentBy"
    users ||--o{ email_templates : "createdBy"
    email_favorite_recipients {
      uuid id PK
      uuid userId FK
    }
    email_favorite_templates {
      uuid id PK
      uuid userId FK
      uuid templateId FK
    }
    email_logs {
      uuid id PK
      uuid sentBy FK
    }
    email_templates {
      uuid id PK
      uuid createdBy FK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
```

## Реестры и отчёты

Операционные журналы, реестры и специализированные медицинские отчёты.

```mermaid
erDiagram
    ambulance_report_entries {
      uuid id PK
    }
    certificate_registry_entries {
      uuid id PK
    }
    discount_report_entries {
      uuid id PK
    }
    doctor_day_report_entries {
      uuid id PK
    }
    gynecology_report_entries {
      uuid id PK
    }
    operations_report_entries {
      uuid id PK
    }
    surgery_report_entries {
      uuid id PK
    }
    therapy_report_entries {
      uuid id PK
    }
```

## Прочее и системные данные

Календарь, акции, транспорт, карта, настройки и учёт миграций.

```mermaid
erDiagram
    users |o--o{ calendar_events : "createdBy"
    calendar_events |o--o{ calendar_events : "parentEventId"
    users |o--o{ map_markers : "createdBy"
    users |o--o{ vehicle_files : "uploadedBy"
    vehicles ||--o{ vehicle_files : "vehicleId"
    calendar_events {
      uuid id PK
      uuid parentEventId FK
      uuid createdBy FK
    }
    directories_meta {
      uuid id PK
    }
    map_markers {
      uuid id PK
      uuid createdBy FK
    }
    promotions {
      uuid id PK
    }
    schema_migrations {
      string name PK
    }
    settings {
      string key PK
    }
    users {
      uuid id PK
      uuid roleId FK
      uuid deletedBy FK
    }
    vehicle_files {
      uuid id PK
      uuid vehicleId FK
      uuid uploadedBy FK
    }
    vehicles {
      uuid id PK
    }
```
