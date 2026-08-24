/**
 * Модели онбординга врача (ver. 7.30).
 *
 * Вынесены отдельным файлом по тем же соображениям, что и складской учёт: в
 * index.js уже 109 моделей, и семь новых там было бы не найти.
 *
 * Файл экспортирует фабрику — index.js передаёт свой экземпляр sequelize,
 * второго подключения к базе не появляется. Ассоциации с User и MedCenter
 * объявляются в associateOnboarding, когда модели ядра уже определены.
 */

module.exports = function defineOnboardingModels(sequelize, DataTypes) {
  const ts = { timestamps: true };

  // ── Заявка ────────────────────────────────────────────────────────────────
  //
  // Анкета целиком лежит в form (JSONB), а не разложена по колонкам. Причина не
  // в лени: блоков с повторяемыми записями шесть (образование, квалификация,
  // сертификаты, труды, конференции, ресурсы), число записей в каждом не
  // ограничено, и в реляционном виде это шесть таблиц, которые всегда читаются
  // и пишутся целиком вместе с заявкой. Наружу form не отдаётся как есть — на
  // каждом шаге показывается свой срез, см. services/onboarding/projection.js.
  //
  // В колонки вынесено только то, по чему ищут, фильтруют и проверяют
  // уникальность.
  const OnbApplication = sequelize.define('OnbApplication', {
    id:     { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    // Человеческий номер заявки. Выдаётся последовательностью в базе: заявки
    // создаёт публичный контур, где двое могут отправить форму в одну секунду.
    //
    // defaultValue именно литералом: без него Sequelize подставляет в INSERT
    // явный NULL по объявленному, но незаполненному полю, и умолчание из схемы
    // до базы не доходит.
    number: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      defaultValue: sequelize.literal("nextval('onb_application_number_seq')")
    },

    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'draft',
      comment: 'draft, submitted, revision, rejected, approved, mis_created, launched, cancelled'
    },

    // Персональная ссылка врача на его заявку. По ней он дозаполняет анкету и
    // потом выбирает услуги — аккаунта в портале у него нет и не заводится.
    accessToken: { type: DataTypes.STRING(64), allowNull: false, unique: true },

    // Ключ уникальности заявки. Вторую активную заявку на тот же адрес не
    // создаём — вместо этого предлагаем продолжить существующую.
    email:           { type: DataTypes.STRING(255), allowNull: false },
    emailVerifiedAt: { type: DataTypes.DATE },

    fullName:  { type: DataTypes.STRING(255) },
    phone:     { type: DataTypes.STRING(50) },
    startDate: { type: DataTypes.DATEONLY, comment: 'Дата выхода на работу — точка отсчёта сроков' },

    // Филиал определяет всех исполнителей заявки, поэтому спрашивается в самом
    // начале анкеты, до основных блоков: пока он не выбран, неизвестно, какому
    // главврачу отправлять на согласование.
    medCenterId: { type: DataTypes.UUID },

    // Специальностей может быть несколько — в МИС profession у сотрудника тоже
    // массив. Набор услуг на шаге выбора считается объединением по всем.
    professions: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
      comment: 'Из справочника Реновации: [{ id, name }]'
    },

    form: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // Согласия фиксируются не галочкой, а фактом: время, адрес и версия текста.
    // Галочка без этого юридически ничего не значит, а публиковать фото врача на
    // сайте без согласия на изображение нельзя.
    consents: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    // doctor_id из «Реновации». Появляется на шаге создания учётки и дальше
    // нужен всем: по нему тянутся услуги, расписание и длительности приёма.
    misUserId: { type: DataTypes.STRING(50) },

    submittedAt: { type: DataTypes.DATE },

    // Решение главврача
    decidedBy:   { type: DataTypes.UUID },
    decidedAt:   { type: DataTypes.DATE },
    decisionNote: { type: DataTypes.TEXT, comment: 'Комментарий при доработке или причина отклонения' },
    // Какие поля анкеты главврач пометил проблемными: врачу подсвечиваются
    // только они, остальное заполненное остаётся нетронутым.
    revisionFields: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

    launchedAt:  { type: DataTypes.DATE },
    cancelledAt: { type: DataTypes.DATE },
    cancelledBy: { type: DataTypes.UUID },
    cancelReason: { type: DataTypes.TEXT }
  }, {
    ...ts,
    tableName: 'onb_applications',
    indexes: [
      { fields: ['status'] },
      { fields: ['email'] },
      { fields: ['medCenterId'] },
      { fields: ['misUserId'] }
    ]
  });

  // ── Кто отвечает за шаг ───────────────────────────────────────────────────
  //
  // Одна таблица покрывает оба случая: у шага с scope 'branch' филиал заполнен,
  // у сетевого — NULL («все филиалы»). Если завтра маркетологов разведут по
  // филиалам, поменяется описание шага в process.js, а не схема.
  const OnbAssignment = sequelize.define('OnbAssignment', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    stepKey:     { type: DataTypes.STRING(40), allowNull: false },
    medCenterId: { type: DataTypes.UUID, comment: 'NULL — исполнитель общий на сеть' },
    userId:      { type: DataTypes.UUID, allowNull: false }
  }, {
    ...ts,
    tableName: 'onb_assignments',
    indexes: [
      { fields: ['stepKey'] },
      { fields: ['userId'] },
      { unique: true, fields: ['stepKey', 'medCenterId', 'userId'] }
    ]
  });

  // ── Задача по шагу ────────────────────────────────────────────────────────
  //
  // Свой лёгкий список, а не модуль «Задачи»: TaskPart требует оценку в часах и
  // дату, у него планирование в календарь и блокировка после третьего переноса.
  // «Заведи учётку, 4 часа SLA» в эту модель не ложится.
  const OnbTask = sequelize.define('OnbTask', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    applicationId: { type: DataTypes.UUID, allowNull: false },
    stepKey:       { type: DataTypes.STRING(40), allowNull: false },

    // Кому задача видна. Для шага-гонки здесь оба старших сотрудника колл-центра,
    // и после взятия список не меняется — меняется claimedBy.
    assigneeIds:   { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },

    // Кто взял задачу в работу. У шага-гонки после этого она пропадает у
    // остальных, а в карточке навсегда остаётся, кто именно её выполнил —
    // ровно чтобы не было «думали, сделал другой».
    claimedBy:  { type: DataTypes.UUID },
    claimedAt:  { type: DataTypes.DATE },

    completedBy: { type: DataTypes.UUID },
    completedAt: { type: DataTypes.DATE },
    // Подтверждена ли отметка чтением из МИС. Для шагов с verify:'manual'
    // остаётся false — там подтверждать нечем.
    verifiedByMis: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    // Срок, посчитанный в рабочих часах от появления задачи.
    dueAt:        { type: DataTypes.DATE },
    remindedAt:   { type: DataTypes.DATE },
    escalatedAt:  { type: DataTypes.DATE },
    note:         { type: DataTypes.TEXT, comment: 'Комментарий исполнителя при закрытии' }
  }, {
    ...ts,
    tableName: 'onb_tasks',
    indexes: [
      { fields: ['applicationId'] },
      { fields: ['stepKey'] },
      { fields: ['completedAt'] },
      { fields: ['dueAt'] },
      { unique: true, fields: ['applicationId', 'stepKey'] }
    ]
  });

  // ── Услуги, отмеченные врачом ─────────────────────────────────────────────
  //
  // Строка на услугу, а не массив в заявке: бухгалтеру нужен диф «что врач
  // поменял против прайса», и считать его по JSONB пришлось бы в приложении.
  const OnbServiceChoice = sequelize.define('OnbServiceChoice', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    applicationId: { type: DataTypes.UUID, allowNull: false },

    // NULL только у позиций, которых нет в справочнике: врач вписал их текстом.
    // Заведение такой услуги в прайс — отдельный процесс с ценообразованием, он
    // может тянуться неделями и запуск врача не блокирует.
    serviceId: { type: DataTypes.STRING(50) },
    code:      { type: DataTypes.STRING(100) },
    title:     { type: DataTypes.STRING(500), allowNull: false },
    price:     { type: DataTypes.DECIMAL(12, 2) },

    // Длительность из МИС на момент выбора и то, что поставил врач. Храним обе,
    // потому что бухгалтеру показываются только расхождения.
    misDuration:    { type: DataTypes.INTEGER },
    doctorDuration: { type: DataTypes.INTEGER },

    comment:  { type: DataTypes.TEXT, comment: 'Условия оказания, оборудование, ограничения' },
    isCustom: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    ...ts,
    tableName: 'onb_service_choices',
    indexes: [
      { fields: ['applicationId'] },
      { fields: ['isCustom'] }
    ]
  });

  // ── Файлы анкеты ──────────────────────────────────────────────────────────
  //
  // Отдельной таблицей, а не полем в form: доступ к файлу проверяется по имени
  // файла в момент запроса статики, и это должен быть один индексированный
  // SELECT, а не разбор JSONB всех заявок. Ровно так устроен реестр chat_files.
  const OnbFile = sequelize.define('OnbFile', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    applicationId: { type: DataTypes.UUID, allowNull: false },
    kind: {
      type: DataTypes.STRING(30),
      allowNull: false,
      comment: 'photo, diploma, certificate'
    },
    filename:     { type: DataTypes.STRING(255), allowNull: false, unique: true },
    originalName: { type: DataTypes.STRING(255) },
    mimeType:     { type: DataTypes.STRING(100) },
    size:         { type: DataTypes.INTEGER }
  }, {
    ...ts,
    tableName: 'onb_files',
    indexes: [
      { fields: ['applicationId'] },
      { fields: ['filename'] }
    ]
  });

  // ── Журнал ────────────────────────────────────────────────────────────────
  // Кто, когда и что решил. Отдельно от задач: часть событий к задачам не
  // относится (отправка анкеты, возврат на доработку, смена филиала).
  const OnbEvent = sequelize.define('OnbEvent', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    applicationId: { type: DataTypes.UUID, allowNull: false },
    // NULL — событие породил не сотрудник: врач по своей ссылке или сама система
    // (автопроверка МИС, напоминание по SLA).
    userId:  { type: DataTypes.UUID },
    action:  { type: DataTypes.STRING(40), allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} }
  }, {
    ...ts,
    tableName: 'onb_events',
    indexes: [
      { fields: ['applicationId'] },
      { fields: ['createdAt'] }
    ]
  });

  // ── Коды подтверждения e-mail ─────────────────────────────────────────────
  //
  // Публичная ссылка одна на всех, поэтому анкета открывается только после
  // подтверждения адреса кодом. Это заодно и защита от спама (вместе с
  // honeypot-полем и лимитом по IP), и гарантия, что ключ уникальности заявки
  // настоящий. Код хранится хэшем: таблица с живыми кодами на почту — это
  // готовый обход подтверждения для того, кто дотянулся до базы.
  const OnbEmailCode = sequelize.define('OnbEmailCode', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email:     { type: DataTypes.STRING(255), allowNull: false },
    codeHash:  { type: DataTypes.STRING(64), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    attempts:  { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    usedAt:    { type: DataTypes.DATE },
    // Чтобы «отправить код повторно» не превращалось в рассылку с нашего домена
    // на чужой адрес.
    requestIp: { type: DataTypes.STRING(64) }
  }, {
    ...ts,
    tableName: 'onb_email_codes',
    indexes: [
      { fields: ['email'] },
      { fields: ['expiresAt'] }
    ]
  });

  const models = {
    OnbApplication,
    OnbAssignment,
    OnbTask,
    OnbServiceChoice,
    OnbFile,
    OnbEvent,
    OnbEmailCode
  };

  function associateOnboarding({ User, MedCenter }) {
    OnbApplication.belongsTo(MedCenter, { foreignKey: 'medCenterId', as: 'medCenter' });
    OnbApplication.belongsTo(User, { foreignKey: 'decidedBy', as: 'decider' });
    OnbApplication.belongsTo(User, { foreignKey: 'cancelledBy', as: 'canceller' });

    OnbApplication.hasMany(OnbTask, { foreignKey: 'applicationId', as: 'tasks', onDelete: 'CASCADE' });
    OnbTask.belongsTo(OnbApplication, { foreignKey: 'applicationId', as: 'application' });
    OnbTask.belongsTo(User, { foreignKey: 'claimedBy', as: 'claimer' });
    OnbTask.belongsTo(User, { foreignKey: 'completedBy', as: 'completer' });

    OnbApplication.hasMany(OnbServiceChoice, { foreignKey: 'applicationId', as: 'serviceChoices', onDelete: 'CASCADE' });
    OnbServiceChoice.belongsTo(OnbApplication, { foreignKey: 'applicationId', as: 'application' });

    OnbApplication.hasMany(OnbFile, { foreignKey: 'applicationId', as: 'files', onDelete: 'CASCADE' });
    OnbFile.belongsTo(OnbApplication, { foreignKey: 'applicationId', as: 'application' });

    OnbApplication.hasMany(OnbEvent, { foreignKey: 'applicationId', as: 'events', onDelete: 'CASCADE' });
    OnbEvent.belongsTo(OnbApplication, { foreignKey: 'applicationId', as: 'application' });
    OnbEvent.belongsTo(User, { foreignKey: 'userId', as: 'author' });

    OnbAssignment.belongsTo(User, { foreignKey: 'userId', as: 'user' });
    OnbAssignment.belongsTo(MedCenter, { foreignKey: 'medCenterId', as: 'medCenter' });
  }

  return { models, associateOnboarding };
};
