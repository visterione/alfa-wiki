/**
 * Модели раздела «Вакансии» (ver. 8.20).
 *
 * Второе поколение онбординга. Старый модуль (models/onboarding.js, таблицы
 * onb_*) остаётся рядом рабочим и будет удалён целиком, когда сюда переедут
 * живые заявки, — поэтому ничего общего с ним здесь нет, вплоть до отдельных
 * таблиц под то же самое (файлы, коды на почту, чаты). Разделять одну таблицу
 * между двумя модулями, один из которых доживает последние недели, дороже, чем
 * завести вторую: удаление старого станет отдельным коммитом без миграции
 * данных.
 *
 * Отличие от первого поколения одно, но оно меняет всё: анкета и процесс больше
 * не лежат в коде, а собираются в конструкторе и хранятся в шаблоне. Из этого
 * следуют роли полей (см. VacTemplate.form) и снимок анкеты в заявке
 * (см. VacApplication.formSnapshot) — двух этих вещей в onb_* нет и быть не
 * могло.
 *
 * Файл экспортирует фабрику по образцу склада и онбординга: index.js передаёт
 * свой экземпляр sequelize, второго подключения к базе не появляется.
 */

module.exports = function defineVacancyModels(sequelize, DataTypes) {
  const ts = { timestamps: true };

  // ── Шаблон: анкета плюс процесс ───────────────────────────────────────────
  //
  // Один шаблон на должность: «Врач», «Медсестра», «Техничка». Анкета и процесс
  // лежат в JSONB, а не разложены по таблицам блоков, полей и шагов. Причина
  // та же, по которой анкета врача лежит в JSONB в старом модуле: и то и другое
  // всегда читается и пишется целиком. Редактор присылает форму одним куском,
  // движок при каждом переходе разбирает процесс целиком, и реляционный вид дал
  // бы пять таблиц ради запросов, которых никто не делает.
  //
  // form: {
  //   blocks: [{ key, title, hint, repeat, fields: [{ key, label, type, role,
  //              required, min, max, options, hint }] }],
  //   steps:  [{ key, title, blocks: [ключи блоков] }],
  //   consentVersion: '2026-08-24'
  // }
  //
  // steps — шаги мастера, которым анкета показывается кандидату. Одним полотном
  // она прокручивается на телефоне минуту, и до конца доходят не все.
  //
  // consentVersion меняется вместе с текстом согласий: в заявке фиксируется та
  // версия, на которую человек согласился, иначе через год будет непонятно, под
  // чем именно стоит его галочка.
  //
  // Про role. В первом поколении анкета была одна, и движок знал, что ФИО лежит
  // в form.fullName, а дата выхода — в form.startDate. Теперь ключи полей
  // придумывает тот, кто собирает анкету, и «ФИО» в анкете технички может
  // называться как угодно. Поэтому у поля есть необязательная роль — чем это
  // поле является для движка: 'fullName' (подпись заявки в списках и письмах),
  // 'phone', 'birthDate', 'startDate' (точка отсчёта сроков), 'professions'
  // (специальности из справочника МИС, без них не работают шаги с МИС).
  // Роль в шаблоне не повторяется, 'fullName' обязателен — иначе список заявок
  // окажется безымянным.
  //
  // process: {
  //   steps: [{ key, title, hint, scope, after, kind, slaHours, checklist,
  //             archived }]
  // }
  //
  // kind — чем шаг выполняется: 'decision' (согласовать / вернуть на доработку /
  // отклонить, ровно один на шаблон и корень всего процесса), 'manual' (отметка
  // исполнителя) либо одно из встроенных умений — 'mis_account', 'mis_schedule',
  // 'mis_services', 'services_pick'. Умения не создаются в конструкторе, а
  // выбираются из списка: за каждым стоит код, который ходит в «Реновацию» или
  // рисует кандидату экран выбора услуг. Это и есть граница между шаблоном и
  // кодом — в данных «когда», в коде «чем».
  //
  // scope — 'branch' (исполнитель свой в каждом филиале), 'network' (один на
  // сеть) или 'candidate' (шаг закрывает сам кандидат по своей ссылке, как
  // выбор услуг). У последнего исполнителя нет, и в настройках он не
  // показывается.
  //
  // after — список ключей шагов, после закрытия которых задача появляется; шаг
  // ждёт всех сразу. Ветвлений в движке нет намеренно: списком предшественников
  // выражается всё, что реально нужно, а «если филиал такой-то, то» превратило
  // бы конструктор в язык программирования. Кольцо ловится проверкой при
  // сохранении — иначе процесс молча не тронется с места, и понять почему
  // будет неоткуда.
  const VacTemplate = sequelize.define('VacTemplate', {
    id:    { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    title: { type: DataTypes.STRING(150), allowNull: false, comment: 'Должность: «Врач», «Медсестра»' },
    description: { type: DataTypes.TEXT, comment: 'Для тех, кто собирает вакансии, кандидат этого не видит' },

    form:    { type: DataTypes.JSONB, allowNull: false, defaultValue: { blocks: [] } },
    process: { type: DataTypes.JSONB, allowNull: false, defaultValue: { steps: [] } },

    // Тексты писем кандидату. Вёрстка остаётся в коде: она выстрадана под
    // почтовые клиенты (таблицы, инлайновые стили, отсутствие флексбокса), и
    // отдавать её в редактор — это чинить письма после каждой правки.
    emails: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // Черновик не показывается при создании вакансии: собрать анкету из
    // тридцати полей за один присест нельзя, а полуготовый шаблон, случайно
    // выбранный в вакансии, обернётся заявками по недоделанной анкете.
    isPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isArchived:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    createdBy: { type: DataTypes.UUID }
  }, {
    ...ts,
    tableName: 'vac_templates',
    indexes: [
      { fields: ['isArchived'] },
      { fields: ['isPublished'] }
    ]
  });

  // ── Вакансия: публикация шаблона в филиале ────────────────────────────────
  //
  // Шаблон описывает должность вообще, вакансия — конкретное место работы.
  // «Терапевт на Ленина» и «Невролог на Мира» — две вакансии на одном шаблоне
  // «Врач»: анкета и процесс у них общие, различаются заголовок, описание и
  // филиал.
  //
  // Филиал живёт здесь, а не в анкете. В первом поколении его выбирал сам врач
  // первым блоком формы, потому что ссылка на анкету была одна на всю сеть.
  // Теперь у каждого медцентра свой QR (адрес /vacancy/:код, код берётся из
  // MedCenter.code — он латинский и не меняется при переименовании), человек
  // приходит по нему и видит вакансии только этого филиала. Спрашивать у
  // кандидата то, что уже известно из ссылки, незачем, и ошибиться он больше
  // не может.
  const VacVacancy = sequelize.define('VacVacancy', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    templateId:  { type: DataTypes.UUID, allowNull: false },
    medCenterId: { type: DataTypes.UUID, allowNull: false },

    title:       { type: DataTypes.STRING(200), allowNull: false, comment: 'Что видит кандидат в списке' },
    description: { type: DataTypes.TEXT, comment: 'Условия, график, требования — показывается перед анкетой' },

    // Закрытая вакансия пропадает из списка по QR, но остаётся со своими
    // заявками: их ещё доводить до выхода человека на работу, когда набор уже
    // закрыт.
    isOpen:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    createdBy: { type: DataTypes.UUID }
  }, {
    ...ts,
    tableName: 'vac_vacancies',
    indexes: [
      { fields: ['templateId'] },
      { fields: ['medCenterId'] },
      { fields: ['isOpen'] }
    ]
  });

  // ── Заявка ────────────────────────────────────────────────────────────────
  const VacApplication = sequelize.define('VacApplication', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },

    // Именованных стадий процесса («Согласован», «Заведён в МИС») здесь нет, в
    // отличие от первого поколения. При произвольном процессе они врут: для
    // технички «Заведён в МИС» не наступает никогда, и заявка навсегда зависла
    // бы в предыдущей. Осталось только служебное состояние, одинаковое для
    // любого шаблона, а «где мы сейчас» считается по закрытым шагам — три из
    // семи, и видно каким именно.
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'draft',
      comment: 'draft, submitted, revision, rejected, in_progress, launched, cancelled'
    },

    vacancyId: { type: DataTypes.UUID, allowNull: false },

    // Шаблон и филиал продублированы из вакансии сознательно. По филиалу
    // считаются исполнители каждого шага, по шаблону — процесс, и оба нужны в
    // каждом запросе списка задач. Через вакансию это лишний JOIN в самом
    // горячем месте раздела. Вакансию при этом никто не переносит между
    // филиалами — форма редактирования такого не даёт.
    templateId:  { type: DataTypes.UUID, allowNull: false },
    medCenterId: { type: DataTypes.UUID, allowNull: false },

    // Персональная ссылка кандидата. Аккаунта в портале у него нет и не
    // заводится, право на заявку предъявляется этим токеном.
    accessToken: { type: DataTypes.STRING(64), allowNull: false, unique: true },

    email:           { type: DataTypes.STRING(255), allowNull: false },
    emailVerifiedAt: { type: DataTypes.DATE },

    // Копии полей анкеты с соответствующей ролью. В колонках они лежат потому,
    // что по ним ищут и сортируют список заявок, а тянуть ФИО из JSONB через
    // ключ, который у каждого шаблона свой, — это отказ от индекса.
    fullName:    { type: DataTypes.STRING(255) },
    phone:       { type: DataTypes.STRING(50) },
    startDate:   { type: DataTypes.DATEONLY, comment: 'Поле с ролью startDate — точка отсчёта сроков' },
    professions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], comment: 'Поле с ролью professions: [{ id, name }]' },

    form: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // Снимок схемы анкеты на момент создания заявки. Анкета — это то, под чем
    // человек подписался, и менять её задним числом нельзя: если завтра из
    // шаблона уберут блок, заявка обязана показывать его таким, каким он был.
    //
    // Снимок снимается именно при создании, а не при отправке: черновик
    // заполняют в несколько заходов с телефона, и правка шаблона посреди этого
    // меняла бы форму под руками у человека. Процесс,
    // наоборот, берётся живой из шаблона — новый шаг должен появиться у всех,
    // кто уже в работе, иначе каждое изменение процесса требует переноса
    // заявок вручную.
    //
    // Снимок лежит в самой заявке, а не ссылкой на версию шаблона: заявок
    // десятки в год, дублирование ничего не стоит, а отдельная таблица версий
    // добавила бы способ сломать старую заявку, удалив версию.
    formSnapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // Согласия фиксируются не галочкой, а фактом: время, адрес и версия текста.
    consents: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // doctor_id из «Реновации». Появляется на шаге с умением mis_account и
    // дальше нужен остальным шагам с МИС. У шаблонов без таких шагов остаётся
    // пустым.
    misUserId: { type: DataTypes.STRING(50) },

    submittedAt: { type: DataTypes.DATE },

    // Решение на шаге kind: 'decision'
    decidedBy:    { type: DataTypes.UUID },
    decidedAt:    { type: DataTypes.DATE },
    decisionNote: { type: DataTypes.TEXT, comment: 'Комментарий при доработке или причина отклонения' },
    // Какие поля анкеты помечены проблемными: кандидату подсвечиваются только
    // они, остальное заполненное остаётся нетронутым.
    revisionFields: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

    launchedAt:   { type: DataTypes.DATE },
    cancelledAt:  { type: DataTypes.DATE },
    cancelledBy:  { type: DataTypes.UUID },
    cancelReason: { type: DataTypes.TEXT }
  }, {
    ...ts,
    tableName: 'vac_applications',
    indexes: [
      { fields: ['status'] },
      { fields: ['email'] },
      { fields: ['vacancyId'] },
      { fields: ['templateId'] },
      { fields: ['medCenterId'] },
      { fields: ['misUserId'] },
      // Уникальность считается по паре «почта + вакансия», а не по одной почте,
      // как в первом поколении: откликаться на несколько вакансий сети один
      // человек вправе, а дважды на одну и ту же — нет. Частичный индекс
      // (только активные статусы) доделывается миграцией: Sequelize условие в
      // определении индекса не выражает.
      { fields: ['email', 'vacancyId'] }
    ]
  });

  // ── Кто отвечает за шаг ───────────────────────────────────────────────────
  //
  // Ролей под процесс по-прежнему не заводим: исполнитель — конкретный человек.
  // В проекте ролей и так много, а здесь связка «шаг + филиал → пользователь»
  // себя оправдала в первом поколении и в складском модуле.
  //
  // В отличие от onb_assignments здесь есть templateId: ключ шага уникален
  // внутри шаблона, и 'hr_check' у врача и у технички — разные шаги с разными
  // исполнителями. У шага со scope 'network' филиал пустой («все филиалы»).
  //
  // Под тем же ключом шага хранится одна служебная точка, шагом не являющаяся:
  // '_escalation' — кому писать о просрочке. Иерархии подчинения в портале нет,
  // и выдумывать её ради одного уведомления незачем, поэтому получатель
  // назначается поимённо, ровно как исполнитель. Подчёркивание в начале ключа
  // отличает служебные точки от шагов шаблона; в конструкторе такой ключ
  // создать нельзя.
  const VacAssignment = sequelize.define('VacAssignment', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    templateId:  { type: DataTypes.UUID, allowNull: false },
    stepKey:     { type: DataTypes.STRING(60), allowNull: false },
    medCenterId: { type: DataTypes.UUID, comment: 'NULL — исполнитель общий на сеть' },
    userId:      { type: DataTypes.UUID, allowNull: false }
  }, {
    ...ts,
    tableName: 'vac_assignments',
    indexes: [
      { fields: ['templateId'] },
      { fields: ['userId'] },
      { unique: true, fields: ['templateId', 'stepKey', 'medCenterId', 'userId'] }
    ]
  });

  // ── Задача по шагу ────────────────────────────────────────────────────────
  //
  // Свой лёгкий список, а не модуль «Задачи»: TaskPart требует оценку в часах и
  // дату, планирует в календарь и блокирует после третьего переноса. «Заведи
  // учётку, 4 часа SLA» в эту модель не ложится.
  const VacTask = sequelize.define('VacTask', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    applicationId: { type: DataTypes.UUID, allowNull: false },
    stepKey:       { type: DataTypes.STRING(60), allowNull: false },

    // Кому задача видна. После того как её взяли, список не меняется —
    // меняется claimedBy.
    assigneeIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

    claimedBy: { type: DataTypes.UUID },
    claimedAt: { type: DataTypes.DATE },

    completedBy: { type: DataTypes.UUID },
    completedAt: { type: DataTypes.DATE },
    // Подтверждена ли отметка чтением из «Реновации». У шагов kind 'manual'
    // остаётся false — там подтверждать нечем.
    verifiedByMis: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    dueAt:       { type: DataTypes.DATE, comment: 'Срок в рабочих часах от появления задачи' },
    remindedAt:  { type: DataTypes.DATE },
    escalatedAt: { type: DataTypes.DATE },
    note:        { type: DataTypes.TEXT, comment: 'Комментарий исполнителя при закрытии' }
  }, {
    ...ts,
    tableName: 'vac_tasks',
    indexes: [
      { fields: ['applicationId'] },
      { fields: ['stepKey'] },
      { fields: ['completedAt'] },
      { fields: ['dueAt'] },
      { unique: true, fields: ['applicationId', 'stepKey'] }
    ]
  });

  // ── Услуги, отмеченные кандидатом ─────────────────────────────────────────
  //
  // Заполняется шагом с умением services_pick. Строка на услугу, а не массив в
  // заявке: бухгалтеру нужен диф «что кандидат поменял против прайса», и
  // считать его по JSONB пришлось бы в приложении.
  const VacServiceChoice = sequelize.define('VacServiceChoice', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    applicationId: { type: DataTypes.UUID, allowNull: false },

    // NULL только у позиций, которых нет в справочнике: их вписали текстом.
    // Заведение такой услуги в прайс — отдельный процесс с ценообразованием, он
    // может тянуться неделями и выход человека на работу не блокирует.
    serviceId: { type: DataTypes.STRING(50) },
    code:      { type: DataTypes.STRING(100) },
    title:     { type: DataTypes.STRING(500), allowNull: false },
    price:     { type: DataTypes.DECIMAL(12, 2) },

    // Длительность из МИС на момент выбора и то, что поставил кандидат. Храним
    // обе, потому что бухгалтеру показываются только расхождения.
    misDuration:    { type: DataTypes.INTEGER },
    doctorDuration: { type: DataTypes.INTEGER },

    comment:  { type: DataTypes.TEXT, comment: 'Условия оказания, оборудование, ограничения' },
    isCustom: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    ...ts,
    tableName: 'vac_service_choices',
    indexes: [
      { fields: ['applicationId'] },
      { fields: ['isCustom'] }
    ]
  });

  // ── Файлы анкеты ──────────────────────────────────────────────────────────
  //
  // Отдельной таблицей, а не полем в form: доступ к файлу проверяется по имени
  // в момент запроса статики, и это должен быть один индексированный SELECT, а
  // не разбор JSONB всех заявок.
  //
  // kind здесь — ключ поля анкеты, из которого файл загружен, а не список из
  // трёх значений, как в первом поколении: какие бывают файлы, теперь решает
  // тот, кто собирает анкету.
  const VacFile = sequelize.define('VacFile', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    applicationId: { type: DataTypes.UUID, allowNull: false },
    fieldKey:      { type: DataTypes.STRING(60), allowNull: false, comment: 'Ключ поля анкеты типа file или files' },
    filename:      { type: DataTypes.STRING(255), allowNull: false, unique: true },
    originalName:  { type: DataTypes.STRING(255) },
    mimeType:      { type: DataTypes.STRING(100) },
    size:          { type: DataTypes.INTEGER }
  }, {
    ...ts,
    tableName: 'vac_files',
    indexes: [
      { fields: ['applicationId'] },
      { fields: ['filename'] }
    ]
  });

  // ── Журнал ────────────────────────────────────────────────────────────────
  // Отдельно от задач: часть событий к задачам не относится — отправка анкеты,
  // возврат на доработку, отмена.
  const VacEvent = sequelize.define('VacEvent', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    applicationId: { type: DataTypes.UUID, allowNull: false },
    // NULL — событие породил не сотрудник: кандидат по своей ссылке или сама
    // система (автопроверка МИС, напоминание по сроку).
    userId:  { type: DataTypes.UUID },
    action:  { type: DataTypes.STRING(40), allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    ...ts,
    tableName: 'vac_events',
    indexes: [
      { fields: ['applicationId'] },
      { fields: ['createdAt'] }
    ]
  });

  // ── Коды подтверждения e-mail ─────────────────────────────────────────────
  //
  // Публичная ссылка одна на филиал, поэтому анкета открывается только после
  // подтверждения адреса кодом. Это и защита от спама (вместе с полем-приманкой
  // и лимитом по IP), и гарантия, что почта, по которой считается уникальность
  // отклика, настоящая. Внешнюю капчу не берём: она тянет чужой скрипт, а
  // значит правки CSP и nginx, аккаунт и ключи — ради задачи, которую
  // подтверждение адреса решает лучше.
  //
  // Код хранится хэшем: таблица с живыми кодами — это готовый обход
  // подтверждения для того, кто дотянулся до базы.
  const VacEmailCode = sequelize.define('VacEmailCode', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email:     { type: DataTypes.STRING(255), allowNull: false },
    // Код выдаётся под конкретную вакансию: на одну у человека уже может быть
    // заявка, а на соседнюю он вправе откликнуться, и общий код сделал бы
    // проверку «есть ли активная заявка» неоднозначной.
    vacancyId: { type: DataTypes.UUID, allowNull: false },
    codeHash:  { type: DataTypes.STRING(64), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    attempts:  { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    usedAt:    { type: DataTypes.DATE },
    // Чтобы «отправить код повторно» не превращалось в рассылку с нашего домена
    // на чужой адрес.
    requestIp: { type: DataTypes.STRING(64) }
  }, {
    ...ts,
    tableName: 'vac_email_codes',
    indexes: [
      { fields: ['email'] },
      { fields: ['vacancyId'] },
      { fields: ['expiresAt'] }
    ]
  });

  // ── Рабочие чаты ──────────────────────────────────────────────────────────
  //
  // Ссылки на групповые чаты, которые уходят одним письмом, когда закрыт
  // последний шаг чек-листа.
  //
  // Привязка к паре «шаблон + филиал», а не к одному филиалу, как в первом
  // поколении: медсестру на Ленина зовут не туда, куда врача там же, и не туда,
  // куда медсестру в соседнем медцентре. Пустой филиал означает «этот шаблон во
  // всех филиалах» — так заводится общий чат сети.
  //
  // Название и аватарка не собираются в момент отправки письма: превью тянется
  // из открытой страницы приглашения, а она может не ответить — и тогда письмо
  // ушло бы с голыми ссылками именно в тот момент, когда его читают. Поэтому
  // превью забирается при настройке и хранится здесь, а обновляется кнопкой.
  const VacChatLink = sequelize.define('VacChatLink', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    templateId:  { type: DataTypes.UUID, allowNull: false },
    medCenterId: { type: DataTypes.UUID, comment: 'NULL — чат общий на сеть для этого шаблона' },

    url: { type: DataTypes.STRING(500), allowNull: false },

    // Что видит человек в письме. Заполняется превью, но остаётся
    // редактируемым: в телеграме группа зовётся «Альфа | Ресепшн 24/7», а тому,
    // кто выходит на работу первый раз, понятнее «Чат регистратуры».
    title:    { type: DataTypes.STRING(255), allowNull: false },
    subtitle: { type: DataTypes.STRING(255), comment: 'Пояснение под названием: зачем этот чат' },

    // Путь внутри uploads, а не адрес картинки в телеграме: их CDN отдаёт файл
    // по временной ссылке, и через месяц в письме была бы дырка. Плюс почтовые
    // клиенты охотнее показывают картинки с того же домена, что и ссылки.
    avatarPath: { type: DataTypes.STRING(255) },

    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isActive:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    // Когда последний раз удалось прочитать превью и чем закончилась попытка.
    // Чат могли переименовать, а инвайт-ссылка — протухнуть, и узнать об этом
    // лучше до того, как письмо уйдёт человеку.
    fetchedAt:  { type: DataTypes.DATE },
    fetchError: { type: DataTypes.STRING(255) }
  }, {
    ...ts,
    tableName: 'vac_chat_links',
    indexes: [
      { fields: ['templateId'] },
      { fields: ['medCenterId'] },
      { fields: ['isActive'] }
    ]
  });

  const models = {
    VacTemplate,
    VacVacancy,
    VacApplication,
    VacAssignment,
    VacTask,
    VacServiceChoice,
    VacFile,
    VacEvent,
    VacEmailCode,
    VacChatLink
  };

  function associateVacancies({ User, MedCenter }) {
    VacVacancy.belongsTo(VacTemplate, { foreignKey: 'templateId', as: 'template' });
    VacVacancy.belongsTo(MedCenter,   { foreignKey: 'medCenterId', as: 'medCenter' });
    VacTemplate.hasMany(VacVacancy,   { foreignKey: 'templateId', as: 'vacancies' });

    VacApplication.belongsTo(VacVacancy,  { foreignKey: 'vacancyId', as: 'vacancy' });
    VacApplication.belongsTo(VacTemplate, { foreignKey: 'templateId', as: 'template' });
    VacApplication.belongsTo(MedCenter,   { foreignKey: 'medCenterId', as: 'medCenter' });
    VacApplication.belongsTo(User,        { foreignKey: 'decidedBy', as: 'decider' });
    VacApplication.belongsTo(User,        { foreignKey: 'cancelledBy', as: 'canceller' });
    VacVacancy.hasMany(VacApplication,    { foreignKey: 'vacancyId', as: 'applications' });

    VacApplication.hasMany(VacTask, { foreignKey: 'applicationId', as: 'tasks', onDelete: 'CASCADE' });
    VacTask.belongsTo(VacApplication, { foreignKey: 'applicationId', as: 'application' });
    VacTask.belongsTo(User, { foreignKey: 'claimedBy', as: 'claimer' });
    VacTask.belongsTo(User, { foreignKey: 'completedBy', as: 'completer' });

    VacApplication.hasMany(VacServiceChoice, { foreignKey: 'applicationId', as: 'serviceChoices', onDelete: 'CASCADE' });
    VacServiceChoice.belongsTo(VacApplication, { foreignKey: 'applicationId', as: 'application' });

    VacApplication.hasMany(VacFile, { foreignKey: 'applicationId', as: 'files', onDelete: 'CASCADE' });
    VacFile.belongsTo(VacApplication, { foreignKey: 'applicationId', as: 'application' });

    VacApplication.hasMany(VacEvent, { foreignKey: 'applicationId', as: 'events', onDelete: 'CASCADE' });
    VacEvent.belongsTo(VacApplication, { foreignKey: 'applicationId', as: 'application' });
    VacEvent.belongsTo(User, { foreignKey: 'userId', as: 'author' });

    VacAssignment.belongsTo(VacTemplate, { foreignKey: 'templateId', as: 'template' });
    VacAssignment.belongsTo(User,        { foreignKey: 'userId', as: 'user' });
    VacAssignment.belongsTo(MedCenter,   { foreignKey: 'medCenterId', as: 'medCenter' });

    VacChatLink.belongsTo(VacTemplate, { foreignKey: 'templateId', as: 'template' });
    VacChatLink.belongsTo(MedCenter,   { foreignKey: 'medCenterId', as: 'medCenter' });

    VacEmailCode.belongsTo(VacVacancy, { foreignKey: 'vacancyId', as: 'vacancy' });
  }

  return { models, associateVacancies };
};
