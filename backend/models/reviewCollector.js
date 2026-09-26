/**
 * Модели сбора отзывов Альфа Парсером (ver. 8.80).
 *
 * Отдельным файлом, как почта и склад: models/index.js и без того огромен, а
 * три таблицы сборщика по смыслу стоят особняком от доски и её карточек.
 * Схема заведена миграцией «ver. 8.80 review-collector.sql», причины решений
 * записаны там. Здесь только то, что нужно знать Sequelize.
 */

module.exports = function defineReviewCollectorModels(sequelize, DataTypes) {
  const ReviewPlatformAccount = sequelize.define('ReviewPlatformAccount', {
    id:                 { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    platform:           { type: DataTypes.STRING(20), allowNull: false },
    label:              { type: DataTypes.STRING(200) },
    login:              { type: DataTypes.STRING(320), allowNull: false },
    passwordEnc:        { type: DataTypes.TEXT, allowNull: false },
    passwordIv:         { type: DataTypes.STRING(64), allowNull: false },
    passwordTag:        { type: DataTypes.STRING(64), allowNull: false },
    keyVersion:         { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    credentialsVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    isEnabled:          { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    status:             { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'new' },
    statusMessage:      { type: DataTypes.TEXT },
    statusAt:           { type: DataTypes.DATE },
    challenge:          { type: DataTypes.JSONB },
    lastCollectedAt:    { type: DataTypes.DATE },
    createdBy:          { type: DataTypes.UUID },
  }, {
    tableName: 'review_platform_accounts',
    timestamps: true,
    // Пароль уходит из базы только парсеру, и только явным scope — так его
    // нельзя случайно отдать в интерфейс вместе со списком учёток.
    defaultScope: { attributes: { exclude: ['passwordEnc', 'passwordIv', 'passwordTag'] } },
    scopes: { withSecret: { attributes: { include: ['passwordEnc', 'passwordIv', 'passwordTag'] } } },
  });

  const ReviewPlatformPlace = sequelize.define('ReviewPlatformPlace', {
    id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    accountId:  { type: DataTypes.UUID, allowNull: false },
    externalId: { type: DataTypes.STRING(200), allowNull: false },
    name:       { type: DataTypes.STRING(300) },
    address:    { type: DataTypes.STRING(500) },
    boardId:    { type: DataTypes.UUID },
    mode:       { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'off' },
    stats:      { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    lastSeenAt: { type: DataTypes.DATE },
  }, {
    tableName: 'review_platform_places',
    timestamps: true,
  });

  const ReviewCollectorJob = sequelize.define('ReviewCollectorJob', {
    id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    kind:       { type: DataTypes.STRING(20), allowNull: false },
    accountId:  { type: DataTypes.UUID, allowNull: false },
    placeId:    { type: DataTypes.UUID },
    reviewId:   { type: DataTypes.UUID },
    payload:    { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    status:     { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'queued' },
    attempts:   { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    result:     { type: DataTypes.JSONB },
    error:      { type: DataTypes.TEXT },
    takenAt:    { type: DataTypes.DATE },
    finishedAt: { type: DataTypes.DATE },
    createdBy:  { type: DataTypes.UUID },
  }, {
    tableName: 'review_collector_jobs',
    timestamps: true,
  });

  const models = { ReviewPlatformAccount, ReviewPlatformPlace, ReviewCollectorJob };

  function associateReviewCollector({ ReviewBoard, Review }) {
    ReviewPlatformAccount.hasMany(ReviewPlatformPlace, { foreignKey: 'accountId', as: 'places', onDelete: 'CASCADE' });
    ReviewPlatformPlace.belongsTo(ReviewPlatformAccount, { foreignKey: 'accountId', as: 'account' });
    ReviewPlatformPlace.belongsTo(ReviewBoard, { foreignKey: 'boardId', as: 'board' });

    ReviewCollectorJob.belongsTo(ReviewPlatformAccount, { foreignKey: 'accountId', as: 'account' });
    ReviewCollectorJob.belongsTo(ReviewPlatformPlace, { foreignKey: 'placeId', as: 'place' });
    ReviewCollectorJob.belongsTo(Review, { foreignKey: 'reviewId', as: 'review' });
  }

  return { models, associateReviewCollector };
};
