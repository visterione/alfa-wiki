# Каталог таблиц production-БД

Актуально на **6 августа 2026 г. в 22:29:08 (MSK)**. Всего таблиц: **111**.

## Пользователи и доступ

Учётные записи, роли, сессии, устройства и разграничение доступа.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`users`](FIELDS.md#users) | Учётные записи, профиль и индивидуальные разрешения пользователей. | 37 | `id` | 2 |
| [`roles`](FIELDS.md#roles) | Роли пользователей и наборы разрешений. | 7 | `id` | 0 |
| [`user_roles`](FIELDS.md#user_roles) | Связь пользователей с назначенными ролями. | 5 | `id` | 2 |
| [`user_med_centers`](FIELDS.md#user_med_centers) | Связь пользователей с доступными медицинскими центрами. | 5 | `id` | 2 |
| [`med_centers`](FIELDS.md#med_centers) | Справочник медицинских центров. | 6 | `id` | 0 |
| [`user_sessions`](FIELDS.md#user_sessions) | Сессии входа и refresh-токены пользователей. | 12 | `id` | 1 |
| [`user_devices`](FIELDS.md#user_devices) | Устройства пользователей и push-токены. | 12 | `id` | 1 |
| [`structural_divisions`](FIELDS.md#structural_divisions) | Справочник структурных подразделений. | 7 | `id` | 1 |
| [`division_access`](FIELDS.md#division_access) | Доступ пользователей к структурным подразделениям. | 6 | `id` | 2 |
| [`rb_user_permissions`](FIELDS.md#rb_user_permissions) | Специализированные права пользователя в зарплатном модуле. | 20 | `id` | 0 |

## Wiki и контент

Страницы базы знаний, структура меню, файлы, поиск и журнал изменений.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`folders`](FIELDS.md#folders) | Иерархия папок базы знаний. | 11 | `id` | 2 |
| [`pages`](FIELDS.md#pages) | Страницы базы знаний и их содержимое. | 22 | `id` | 4 |
| [`page_history`](FIELDS.md#page_history) | Журнал изменений страниц wiki | 7 | `id` | 2 |
| [`media`](FIELDS.md#media) | Метаданные загруженных файлов и изображений. | 12 | `id` | 1 |
| [`user_favorites`](FIELDS.md#user_favorites) | Избранные wiki-страницы пользователей. | 6 | `id` | 2 |
| [`sidebar_items`](FIELDS.md#sidebar_items) | Элементы меню навигации. Разделители больше не используются - они автоматически рендерятся после папок на фронтенде | 14 | `id` | 3 |
| [`search_index`](FIELDS.md#search_index) | Материализованные данные для полнотекстового поиска. | 10 | `id` | 0 |
| [`announcements`](FIELDS.md#announcements) | Объявления, показываемые пользователям системы. | 10 | `id` | 1 |
| [`release_notes`](FIELDS.md#release_notes) | Заметки об изменениях версий приложения. | 12 | `id` | 0 |
| [`release_note_reads`](FIELDS.md#release_note_reads) | Факты прочтения заметок о релизах пользователями. | 6 | `id` | 1 |
| [`analysis_page_notes`](FIELDS.md#analysis_page_notes) | Примечания к анализам в контексте отдельных wiki-страниц. | 6 | `id` | 1 |
| [`service_page_notes`](FIELDS.md#service_page_notes) | Примечания к услугам в контексте отдельных wiki-страниц. | 6 | `id` | 1 |

## Чаты и боты

Чаты, сообщения, реакции, подписчики и интеграции ботов.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`chats`](FIELDS.md#chats) | Диалоги, групповые чаты и служебные каналы. | 9 | `id` | 0 |
| [`chat_members`](FIELDS.md#chat_members) | Участники чатов, их роли и персональные настройки. | 12 | `id` | 2 |
| [`messages`](FIELDS.md#messages) | Сообщения чатов, вложения, пересылки и опросы. | 15 | `id` | 3 |
| [`message_reactions`](FIELDS.md#message_reactions) | Реакции пользователей на сообщения в чате | 6 | `id` | 2 |
| [`bot_tokens`](FIELDS.md#bot_tokens) | Токены и настройки подключённых ботов. | 16 | `id` | 1 |
| [`bot_updates`](FIELDS.md#bot_updates) | Очередь и журнал входящих обновлений от ботов. | 7 | `id` | 1 |
| [`bot_subscribers`](FIELDS.md#bot_subscribers) | Подписчики внутренних ботов и параметры доставки уведомлений. | 16 | `id` | 0 |
| [`telegram_subscribers`](FIELDS.md#telegram_subscribers) | Подписчики Telegram-уведомлений. | 12 | `id` | 0 |
| [`form_subscriptions`](FIELDS.md#form_subscriptions) | Подписки чатов и пользователей на события публичных форм. | 9 | `id` | 2 |

## Курсы

Учебные курсы, уроки, вопросы, прогресс и правила доступа.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`courses`](FIELDS.md#courses) | Учебные курсы и параметры их публикации. | 9 | `id` | 1 |
| [`lessons`](FIELDS.md#lessons) | Уроки, входящие в учебные курсы. | 7 | `id` | 1 |
| [`test_questions`](FIELDS.md#test_questions) | Контрольные вопросы учебных курсов. | 8 | `id` | 1 |
| [`course_progress`](FIELDS.md#course_progress) | Прогресс пользователей по урокам и курсам. | 10 | `id` | 3 |
| [`course_roles`](FIELDS.md#course_roles) | Связь курсов с ролями для контроля доступа. Если таблица пустая для курса - доступен всем. | 5 | `id` | 2 |
| [`course_medcenters`](FIELDS.md#course_medcenters) | Связь курсов с медцентрами для контроля доступа. Если таблица пустая для курса - доступен всем. | 5 | `id` | 2 |
| [`course_users`](FIELDS.md#course_users) | Индивидуальные разрешения пользователей на доступ к курсам. | 5 | `id` | 2 |

## Канбан

Доски, задачи и права доступа к ним.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`kanban_boards`](FIELDS.md#kanban_boards) | Канбан-доски медицинских центров. | 7 | `id` | 1 |
| [`kanban_tasks`](FIELDS.md#kanban_tasks) | Задачи на Канбан-доске медицинского центра | 19 | `id` | 2 |
| [`board_permissions`](FIELDS.md#board_permissions) | Права пользователей на канбан-доски. | 6 | `id` | 2 |

## Отзывы

Сбор, синхронизация и обработка отзывов из внешних источников.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`review_boards`](FIELDS.md#review_boards) | Доски для группировки и обработки отзывов. | 11 | `id` | 1 |
| [`reviews`](FIELDS.md#reviews) | Отзывы клиентов и состояние их обработки. | 30 | `id` | 4 |
| [`review_platforms`](FIELDS.md#review_platforms) | Внешние площадки, с которых собираются отзывы. | 6 | `id` | 0 |
| [`review_history`](FIELDS.md#review_history) | История изменения статусов и содержимого отзывов. | 9 | `id` | 2 |
| [`review_board_permissions`](FIELDS.md#review_board_permissions) | Индивидуальные права пользователей на доски отзывов. | 6 | `id` | 2 |
| [`review_board_roles`](FIELDS.md#review_board_roles) | Права ролей на доски отзывов. | 6 | `id` | 2 |
| [`review_sync_configs`](FIELDS.md#review_sync_configs) | Настройки автоматической синхронизации отзывов. | 11 | `id` | 1 |

## МИС и медицинские справочники

Данные МИС, услуги, анализы, врачи, аккредитации и медицинская номенклатура.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`mis_appointments`](FIELDS.md#mis_appointments) | Записи пациентов на приём, импортированные из МИС. | 14 | `id` | 0 |
| [`mis_payments`](FIELDS.md#mis_payments) | Платежи и оплаты, импортированные из МИС. | 21 | `id` | 0 |
| [`analyses`](FIELDS.md#analyses) | Справочник лабораторных анализов и связанных wiki-страниц. | 12 | `id` | 0 |
| [`services`](FIELDS.md#services) | Медицинские услуги, привязанные к страницам wiki | 13 | `id` | 0 |
| [`nomenclature_804n`](FIELDS.md#nomenclature_804n) | Медицинская номенклатура по приказу №804н. | 6 | `code` | 0 |
| [`partner_service_cache`](FIELDS.md#partner_service_cache) | Кэш услуг и цен внешних партнёров. | 16 | `id` | 0 |
| [`doctor_cards`](FIELDS.md#doctor_cards) | Карточки врачей для публикации и внутренних процессов. | 13 | `id` | 0 |
| [`doctor_service_durations`](FIELDS.md#doctor_service_durations) | Продолжительность услуг для конкретных врачей и клиник. | 9 | `id` | 2 |
| [`accreditations`](FIELDS.md#accreditations) | Реестр аккредитаций медицинских работников. | 19 | `id` | 0 |
| [`accreditation_files`](FIELDS.md#accreditation_files) | Файлы, прикрепленные к аккредитациям | 10 | `id` | 2 |

## Зарплата и реферальные бонусы

Начисления, выплаты, расходники, отчёты и настройки расчёта.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`referral_bonuses`](FIELDS.md#referral_bonuses) | Начисления реферальных бонусов врачам и клиникам. | 11 | `id` | 0 |
| [`performed_service_bonuses`](FIELDS.md#performed_service_bonuses) | Бонусные начисления за оказанные услуги. | 12 | `id` | 0 |
| [`service_consumables`](FIELDS.md#service_consumables) | Расходные материалы и себестоимость медицинских услуг. | 11 | `id` | 1 |
| [`referral_reports`](FIELDS.md#referral_reports) | Сформированные отчёты по реферальным бонусам. | 12 | `id` | 0 |
| [`salary_records`](FIELDS.md#salary_records) | Расчётные строки заработной платы. | 11 | `id` | 0 |
| [`cash_payments`](FIELDS.md#cash_payments) | Денежные выплаты, связанные с зарплатными начислениями. | 13 | `id` | 1 |
| [`executor_settings`](FIELDS.md#executor_settings) | Персональные настройки исполнителей для расчётов и отчётов. | 7 | `id` | 0 |
| [`rb_employees`](FIELDS.md#rb_employees) | Сотрудники, участвующие в расчётах реферальных бонусов. | 13 | `id` | 0 |
| [`rb_activity_log`](FIELDS.md#rb_activity_log) | Аудит действий в модуле реферальных бонусов и зарплаты. | 12 | `id` | 1 |
| [`rb_excel_sources`](FIELDS.md#rb_excel_sources) | Excel-источники для автоподгрузки при формировании зарплатных отчётов | 9 | `id` | 0 |
| [`rb_doctor_headers`](FIELDS.md#rb_doctor_headers) | Пользовательские заголовки и группировка врачей в отчётах. | 5 | `id` | 0 |

## Расписания и нормы

Расписания врачей, нормы времени, табели, кабинеты и праздники.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`doctor_schedules`](FIELDS.md#doctor_schedules) | Рабочие смены и интервалы расписания врачей. | 17 | `id` | 2 |
| [`rb_schedule_categories`](FIELDS.md#rb_schedule_categories) | Категории смен и записей расписания. | 5 | `id` | 0 |
| [`rb_schedule_cabinets`](FIELDS.md#rb_schedule_cabinets) | Кабинеты, используемые в расписаниях. | 5 | `id` | 0 |
| [`mis_schedule_category_map`](FIELDS.md#mis_schedule_category_map) | Сопоставление категорий расписания с обозначениями МИС. | 5 | `id` | 1 |
| [`rb_holidays`](FIELDS.md#rb_holidays) | Праздничные и нерабочие дни для расчёта расписаний. | 5 | `id` | 0 |
| [`hour_norms`](FIELDS.md#hour_norms) | Месячные и периодические нормы рабочих часов. | 8 | `id` | 0 |
| [`role_norms`](FIELDS.md#role_norms) | Нормы рабочего времени для ролей сотрудников. | 8 | `id` | 0 |
| [`category_norms`](FIELDS.md#category_norms) | Нормы рабочего времени по категориям расписания. | 8 | `id` | 1 |
| [`tabel_records`](FIELDS.md#tabel_records) | Строки табеля рабочего времени. | 11 | `id` | 1 |
| [`tabel_record_doctors`](FIELDS.md#tabel_record_doctors) | Связь строк табеля с врачами. | 8 | `id` | 1 |

## Сравнение цен

Источники конкурентов, география, услуги, цены и сопоставления.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`price_comparisons`](FIELDS.md#price_comparisons) | Сохранённые наборы сравнения цен. | 11 | `id` | 1 |
| [`price_comparison_items`](FIELDS.md#price_comparison_items) | Строки и показатели одного сравнения цен. | 13 | `id` | 1 |
| [`competitor_sources`](FIELDS.md#competitor_sources) | Источники данных о ценах и услугах конкурентов. | 19 | `id` | 0 |
| [`competitor_locations`](FIELDS.md#competitor_locations) | Филиалы и географические точки медицинских организаций-конкурентов. | 15 | `id` | 1 |
| [`competitor_services`](FIELDS.md#competitor_services) | Нормализованный каталог услуг конкурентов. | 15 | `id` | 1 |
| [`competitor_prices`](FIELDS.md#competitor_prices) | Полученные цены конкурентов на медицинские услуги. | 12 | `id` | 1 |
| [`competitor_service_matches`](FIELDS.md#competitor_service_matches) | Сопоставления услуг конкурентов с внутренним справочником. | 10 | `id` | 2 |

## Публичный API и формы

API-клиенты, аудит запросов, формы и доставка результатов.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`api_clients`](FIELDS.md#api_clients) | Клиенты публичного API и их параметры доступа. | 15 | `id` | 0 |
| [`api_request_logs`](FIELDS.md#api_request_logs) | Технический журнал обращений к публичному API. | 9 | `id` | 0 |
| [`submissions`](FIELDS.md#submissions) | Полученные через публичный API данные форм. | 16 | `id` | 1 |
| [`submission_deliveries`](FIELDS.md#submission_deliveries) | Попытки доставки данных формы конечным получателям. | 11 | `id` | 1 |
| [`int_id_map`](FIELDS.md#int_id_map) | Соответствие внешних целочисленных идентификаторов внутренним UUID. | 4 | `id` | 0 |

## Email

Шаблоны, журнал рассылок и пользовательское избранное.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`email_templates`](FIELDS.md#email_templates) | Шаблоны email-рассылок | 8 | `id` | 1 |
| [`email_logs`](FIELDS.md#email_logs) | История отправленных email-рассылок | 11 | `id` | 1 |
| [`email_favorite_templates`](FIELDS.md#email_favorite_templates) | Избранные шаблоны email для каждого пользователя | 5 | `id` | 2 |
| [`email_favorite_recipients`](FIELDS.md#email_favorite_recipients) | Избранные получатели email для каждого пользователя | 6 | `id` | 1 |

## Реестры и отчёты

Операционные журналы, реестры и специализированные медицинские отчёты.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`ambulance_report_entries`](FIELDS.md#ambulance_report_entries) | Строки отчёта по работе скорой медицинской помощи. | 12 | `id` | 0 |
| [`certificate_registry_entries`](FIELDS.md#certificate_registry_entries) | Реестр выданных сертификатов. | 9 | `id` | 0 |
| [`doctor_day_report_entries`](FIELDS.md#doctor_day_report_entries) | Строки ежедневного отчёта врача. | 8 | `id` | 0 |
| [`operations_report_entries`](FIELDS.md#operations_report_entries) | Строки отчёта о проведённых операциях. | 7 | `id` | 0 |
| [`gynecology_report_entries`](FIELDS.md#gynecology_report_entries) | Строки гинекологического отчёта. | 7 | `id` | 0 |
| [`therapy_report_entries`](FIELDS.md#therapy_report_entries) | Строки терапевтического отчёта. | 7 | `id` | 0 |
| [`surgery_report_entries`](FIELDS.md#surgery_report_entries) | Строки отчёта о хирургических вмешательствах. | 7 | `id` | 0 |
| [`discount_report_entries`](FIELDS.md#discount_report_entries) | Строки отчёта по предоставленным скидкам. | 7 | `id` | 0 |

## Прочее и системные данные

Календарь, акции, транспорт, карта, настройки и учёт миграций.

| Таблица | Назначение | Полей | PK | FK |
|---|---|---:|---|---:|
| [`calendar_events`](FIELDS.md#calendar_events) | События общего и персонального календаря. | 26 | `id` | 2 |
| [`promotions`](FIELDS.md#promotions) | Маркетинговые акции и сроки их действия. | 9 | `id` | 0 |
| [`vehicles`](FIELDS.md#vehicles) | Реестр транспортных средств. | 17 | `id` | 0 |
| [`vehicle_files`](FIELDS.md#vehicle_files) | Файлы, прикрепленные к записям о транспортных средствах | 10 | `id` | 2 |
| [`map_markers`](FIELDS.md#map_markers) | Метки и объекты, отображаемые на карте. | 11 | `id` | 1 |
| [`directories_meta`](FIELDS.md#directories_meta) | Метаданные справочников и время их обновления. | 6 | `id` | 0 |
| [`settings`](FIELDS.md#settings) | Глобальные настройки приложения в формате ключ–значение. | 5 | `key` | 0 |
| [`schema_migrations`](FIELDS.md#schema_migrations) | Технический журнал применённых миграций БД. | 3 | `name` | 0 |
