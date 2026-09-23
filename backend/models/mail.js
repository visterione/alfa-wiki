/**
 * Модели модуля «Почта» (ver. 8.58).
 *
 * Отдельным файлом по той же причине, что склад и вакансии: в models/index.js
 * уже 3780 строк, и одиннадцать таблиц почтового клиента там бы просто утонули.
 * Экземпляр sequelize приходит снаружи — второго подключения к базе не
 * появляется. Ассоциации с User и MedCenter объявляются в associateMail, когда
 * модели ядра уже определены.
 *
 * Схема заведена миграцией «ver. 8.58 mail-module.sql», и причины решений
 * записаны там. Здесь только то, что нужно знать Sequelize.
 */

module.exports = function defineMailModels(sequelize, DataTypes) {
  const ts = { timestamps: true };

  // ── Ящик ────────────────────────────────────────────────────────────────

  const MailAccount = sequelize.define('MailAccount', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email:         { type: DataTypes.STRING(320), allowNull: false, unique: true },
    displayName:   { type: DataTypes.STRING(150), allowNull: false },
    medCenterId:   { type: DataTypes.UUID },

    imapHost:      { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'mail.hosting.reg.ru' },
    imapPort:      { type: DataTypes.INTEGER, allowNull: false, defaultValue: 993 },
    imapSecure:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    smtpHost:      { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'mail.hosting.reg.ru' },
    smtpPort:      { type: DataTypes.INTEGER, allowNull: false, defaultValue: 465 },
    smtpSecure:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    login:         { type: DataTypes.STRING(320), allowNull: false },

    // Наружу эти три поля не отдаются никогда — см. toSafeJSON ниже.
    passwordEnc:   { type: DataTypes.TEXT, allowNull: false },
    passwordIv:    { type: DataTypes.STRING(64), allowNull: false },
    passwordTag:   { type: DataTypes.STRING(64), allowNull: false },
    keyVersion:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },

    isActive:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    signature:     { type: DataTypes.TEXT },
    capabilities:  { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

    syncState:     { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'idle' },
    syncStartedAt: { type: DataTypes.DATE },
    syncFinishedAt:{ type: DataTypes.DATE },
    lastSyncAt:    { type: DataTypes.DATE },
    lastError:     { type: DataTypes.TEXT },
    lastErrorAt:   { type: DataTypes.DATE },

    sortOrder:     { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    createdBy:     { type: DataTypes.UUID },
  }, {
    ...ts,
    tableName: 'mail_accounts',
    // Пароль не должен уезжать в ответ по недосмотру, поэтому он исключён на
    // уровне модели: чтобы его получить, нужно попросить явно. Синхронизатору
    // это не мешает — он читает ящик через scope 'withSecret'.
    defaultScope: { attributes: { exclude: ['passwordEnc', 'passwordIv', 'passwordTag'] } },
    scopes: { withSecret: { attributes: { include: ['passwordEnc', 'passwordIv', 'passwordTag'] } } },
  });

  // ── Доступ ──────────────────────────────────────────────────────────────

  const MailAccountUser = sequelize.define('MailAccountUser', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    accountId: { type: DataTypes.UUID, allowNull: false },
    userId:    { type: DataTypes.UUID, allowNull: false },
    canSend:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    canDelete: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    grantedBy: { type: DataTypes.UUID },
  }, { ...ts, tableName: 'mail_account_users' });

  // Групповое правило не разворачивается в сотни персональных строк. Так
  // новый сотрудник автоматически получает ящик, когда ему назначают нужный
  // медцентр/роль, а удалённый из группы автоматически его теряет. Если
  // заполнены оба поля, они работают как пересечение (медцентр И роль).
  const MailAccountAccessRule = sequelize.define('MailAccountAccessRule', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    accountId:   { type: DataTypes.UUID, allowNull: false },
    medCenterId: { type: DataTypes.UUID },
    roleId:      { type: DataTypes.UUID },
    canSend:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    canDelete:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    grantedBy:   { type: DataTypes.UUID },
  }, { ...ts, tableName: 'mail_account_access_rules' });

  // ── Папки ───────────────────────────────────────────────────────────────

  const MailFolder = sequelize.define('MailFolder', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    accountId:     { type: DataTypes.UUID, allowNull: false },
    path:          { type: DataTypes.STRING(1000), allowNull: false },
    name:          { type: DataTypes.STRING(500), allowNull: false },
    delimiter:     { type: DataTypes.STRING(8) },
    specialUse:    { type: DataTypes.STRING(20) },
    flags:         { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    selectable:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // BIGINT приходит из pg строкой, и это правильно: UID и MODSEQ у активного
    // ящика перерастают 2^53, а молча потерять точность здесь означало бы
    // перезалить папку с нуля.
    uidValidity:   { type: DataTypes.BIGINT },
    uidNext:       { type: DataTypes.BIGINT },
    highestModSeq: { type: DataTypes.BIGINT },
    messagesTotal: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    unseenTotal:   { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    backfillUid:   { type: DataTypes.BIGINT },
    backfillDone:  { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lastSyncAt:    { type: DataTypes.DATE },
    sortOrder:     { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
  }, { ...ts, tableName: 'mail_folders' });

  // ── Письмо ──────────────────────────────────────────────────────────────

  const MailMessage = sequelize.define('MailMessage', {
    id:               { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    accountId:        { type: DataTypes.UUID, allowNull: false },
    folderId:         { type: DataTypes.UUID, allowNull: false },
    uid:              { type: DataTypes.BIGINT, allowNull: false },
    messageId:        { type: DataTypes.STRING(998) },
    inReplyTo:        { type: DataTypes.STRING(998) },
    references:       { type: DataTypes.ARRAY(DataTypes.TEXT) },
    threadKey:        { type: DataTypes.STRING(998) },
    subject:          { type: DataTypes.STRING(2000) },
    fromName:         { type: DataTypes.STRING(300) },
    fromEmail:        { type: DataTypes.STRING(320) },
    sentAt:           { type: DataTypes.DATE },
    receivedAt:       { type: DataTypes.DATE, allowNull: false },
    size:             { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    flags:            { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false, defaultValue: [] },
    isSeen:           { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isFlagged:        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isAnswered:       { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isDraft:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    hasAttachments:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    attachmentsCount: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
    preview:          { type: DataTypes.STRING(300) },
    rawPath:          { type: DataTypes.STRING(500) },
    bodyState:        { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
    modSeq:           { type: DataTypes.BIGINT },
    pendingDelete:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  }, { ...ts, tableName: 'mail_messages' });

  // ── Адреса ──────────────────────────────────────────────────────────────

  const MailAddress = sequelize.define('MailAddress', {
    id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    email:         { type: DataTypes.STRING(320), allowNull: false, unique: true },
    name:          { type: DataTypes.STRING(300) },
    messagesCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastSeenAt:    { type: DataTypes.DATE },
  }, { ...ts, tableName: 'mail_addresses' });

  const MailMessageAddress = sequelize.define('MailMessageAddress', {
    messageId: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    addressId: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    role:      { type: DataTypes.STRING(10), allowNull: false, primaryKey: true },
    name:      { type: DataTypes.STRING(300) },
  }, { timestamps: false, tableName: 'mail_message_addresses' });

  // ── Тело ────────────────────────────────────────────────────────────────

  const MailMessageBody = sequelize.define('MailMessageBody', {
    messageId:        { type: DataTypes.UUID, primaryKey: true },
    textBody:         { type: DataTypes.TEXT },
    textStripped:     { type: DataTypes.TEXT },
    htmlSanitized:    { type: DataTypes.TEXT },
    sanitizerVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    // Тип tsvector Sequelize не знает. Объявлен как TEXT только чтобы модель не
    // спотыкалась при describe; пишется он всегда сырым SQL, потому что
    // to_tsvector считает Postgres, а не мы.
    searchVector:     { type: DataTypes.TEXT },
  }, { ...ts, tableName: 'mail_message_bodies' });

  // ── Вложения ────────────────────────────────────────────────────────────

  const MailAttachment = sequelize.define('MailAttachment', {
    id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    messageId:   { type: DataTypes.UUID, allowNull: false },
    filename:    { type: DataTypes.STRING(500) },
    mimeType:    { type: DataTypes.STRING(200) },
    size:        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    sha256:      { type: DataTypes.CHAR(64) },
    storagePath: { type: DataTypes.STRING(500) },
    isInline:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    contentId:   { type: DataTypes.STRING(300) },
    partId:      { type: DataTypes.STRING(50) },
    textContent: { type: DataTypes.TEXT },
  }, { tableName: 'mail_attachments', timestamps: true, updatedAt: false });

  // ── Личное состояние и журналы ──────────────────────────────────────────

  const MailUserMessageState = sequelize.define('MailUserMessageState', {
    userId:    { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    messageId: { type: DataTypes.UUID, allowNull: false, primaryKey: true },
    isRead:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    readAt:    { type: DataTypes.DATE },
    isStarred: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    takenAt:   { type: DataTypes.DATE },
  }, { tableName: 'mail_user_message_state', timestamps: true, createdAt: false });

  const MailAudit = sequelize.define('MailAudit', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId:    { type: DataTypes.UUID },
    accountId: { type: DataTypes.UUID },
    messageId: { type: DataTypes.UUID },
    action:    { type: DataTypes.STRING(30), allowNull: false },
    detail:    { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    ip:        { type: DataTypes.STRING(64) },
  }, { tableName: 'mail_audit', timestamps: true, updatedAt: false });

  // Очередь изменений, которые надо донести до IMAP. Отправка флага требует
  // соединения, а их мало и они общие на сотню ящиков — ждать свободного слота
  // внутри HTTP-запроса значит подвесить интерфейс на действии, которое человек
  // считает мгновенным.
  const MailFlagOp = sequelize.define('MailFlagOp', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    messageId: { type: DataTypes.UUID, allowNull: false },
    userId:    { type: DataTypes.UUID },
    op:        { type: DataTypes.STRING(20), allowNull: false },
    attempts:  { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
    lastError: { type: DataTypes.TEXT },
    doneAt:    { type: DataTypes.DATE },
  }, { tableName: 'mail_flag_ops', timestamps: true, updatedAt: false });

  // Исходящие: черновики и отправленное. Черновик хранится у нас, а не в папке
  // «Черновики» на сервере, — недописанное письмо дело одного человека, и класть
  // его в общий ящик, где его увидит вся смена, незачем.
  const MailDraft = sequelize.define('MailDraft', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    accountId: { type: DataTypes.UUID, allowNull: false },
    userId:    { type: DataTypes.UUID },
    replyToId: { type: DataTypes.UUID },
    kind:      { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'new' },
    subject:   { type: DataTypes.STRING(2000) },
    toList:    { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ccList:    { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    bccList:   { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    bodyHtml:  { type: DataTypes.TEXT },
    bodyText:  { type: DataTypes.TEXT },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status:    { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'draft' },
    error:     { type: DataTypes.TEXT },
    sentAt:    { type: DataTypes.DATE },
    messageId: { type: DataTypes.STRING(998) },
  }, { ...ts, tableName: 'mail_drafts' });

  // Сохранённый поиск, он же «умная папка». Пустой userId означает общий на
  // ящик: «гарантийные письма» нужны всей смене, «мои жалобы» — одному.
  const MailSavedSearch = sequelize.define('MailSavedSearch', {
    id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId:    { type: DataTypes.UUID },
    accountId: { type: DataTypes.UUID },
    name:      { type: DataTypes.STRING(150), allowNull: false },
    query:     { type: DataTypes.TEXT, allowNull: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    createdBy: { type: DataTypes.UUID },
  }, { ...ts, tableName: 'mail_saved_searches' });

  const MailSyncRun = sequelize.define('MailSyncRun', {
    id:              { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    accountId:       { type: DataTypes.UUID },
    folderId:        { type: DataTypes.UUID },
    kind:            { type: DataTypes.STRING(20), allowNull: false },
    startedAt:       { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    finishedAt:      { type: DataTypes.DATE },
    messagesFetched: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    bytesFetched:    { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    error:           { type: DataTypes.TEXT },
  }, { tableName: 'mail_sync_runs', timestamps: false });

  const models = {
    MailAccount, MailAccountUser, MailAccountAccessRule, MailFolder, MailMessage,
    MailAddress, MailMessageAddress, MailMessageBody, MailAttachment,
    MailUserMessageState, MailAudit, MailSyncRun, MailFlagOp, MailSavedSearch, MailDraft,
  };

  function associateMail({ User, MedCenter, Role }) {
    MailAccount.belongsTo(MedCenter, { foreignKey: 'medCenterId', as: 'medCenter' });
    MailAccount.belongsTo(User, { foreignKey: 'createdBy', as: 'author' });

    MailAccount.hasMany(MailAccountUser, { foreignKey: 'accountId', as: 'access', onDelete: 'CASCADE' });
    MailAccountUser.belongsTo(MailAccount, { foreignKey: 'accountId', as: 'account' });
    MailAccountUser.belongsTo(User, { foreignKey: 'userId', as: 'user' });
    MailAccountUser.belongsTo(User, { foreignKey: 'grantedBy', as: 'grantor' });

    MailAccount.hasMany(MailAccountAccessRule, { foreignKey: 'accountId', as: 'accessRules', onDelete: 'CASCADE' });
    MailAccountAccessRule.belongsTo(MailAccount, { foreignKey: 'accountId', as: 'account' });
    MailAccountAccessRule.belongsTo(MedCenter, { foreignKey: 'medCenterId', as: 'medCenter' });
    MailAccountAccessRule.belongsTo(Role, { foreignKey: 'roleId', as: 'role' });
    MailAccountAccessRule.belongsTo(User, { foreignKey: 'grantedBy', as: 'grantor' });

    MailAccount.hasMany(MailFolder, { foreignKey: 'accountId', as: 'folders', onDelete: 'CASCADE' });
    MailFolder.belongsTo(MailAccount, { foreignKey: 'accountId', as: 'account' });

    MailFolder.hasMany(MailMessage, { foreignKey: 'folderId', as: 'messages', onDelete: 'CASCADE' });
    MailMessage.belongsTo(MailFolder, { foreignKey: 'folderId', as: 'folder' });
    MailMessage.belongsTo(MailAccount, { foreignKey: 'accountId', as: 'account' });

    MailMessage.hasOne(MailMessageBody, { foreignKey: 'messageId', as: 'body', onDelete: 'CASCADE' });
    MailMessageBody.belongsTo(MailMessage, { foreignKey: 'messageId', as: 'message' });

    MailMessage.hasMany(MailAttachment, { foreignKey: 'messageId', as: 'attachments', onDelete: 'CASCADE' });
    MailAttachment.belongsTo(MailMessage, { foreignKey: 'messageId', as: 'message' });

    MailMessage.belongsToMany(MailAddress, {
      through: MailMessageAddress, foreignKey: 'messageId', otherKey: 'addressId', as: 'addresses',
    });
    MailAddress.belongsToMany(MailMessage, {
      through: MailMessageAddress, foreignKey: 'addressId', otherKey: 'messageId', as: 'messages',
    });
    MailMessageAddress.belongsTo(MailAddress, { foreignKey: 'addressId', as: 'address' });
    MailMessageAddress.belongsTo(MailMessage, { foreignKey: 'messageId', as: 'message' });

    MailMessage.hasMany(MailUserMessageState, { foreignKey: 'messageId', as: 'userStates', onDelete: 'CASCADE' });
    MailUserMessageState.belongsTo(MailMessage, { foreignKey: 'messageId', as: 'message' });
    MailUserMessageState.belongsTo(User, { foreignKey: 'userId', as: 'user' });

    MailAudit.belongsTo(User, { foreignKey: 'userId', as: 'user' });
    MailAudit.belongsTo(MailAccount, { foreignKey: 'accountId', as: 'account' });

    MailFlagOp.belongsTo(MailMessage, { foreignKey: 'messageId', as: 'message' });
    MailFlagOp.belongsTo(User, { foreignKey: 'userId', as: 'user' });

    MailDraft.belongsTo(MailAccount, { foreignKey: 'accountId', as: 'account' });
    MailDraft.belongsTo(User, { foreignKey: 'userId', as: 'author' });
    MailDraft.belongsTo(MailMessage, { foreignKey: 'replyToId', as: 'replyTo' });

    MailSavedSearch.belongsTo(MailAccount, { foreignKey: 'accountId', as: 'account' });
    MailSavedSearch.belongsTo(User, { foreignKey: 'userId', as: 'user' });

    MailSyncRun.belongsTo(MailAccount, { foreignKey: 'accountId', as: 'account' });
    MailSyncRun.belongsTo(MailFolder, { foreignKey: 'folderId', as: 'folder' });
  }

  return { models, associateMail };
};
