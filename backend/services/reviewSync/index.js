/**
 * Сервис синхронизации отзывов через GetLoyalty
 *
 * GetLoyalty агрегирует все площадки (Яндекс, Google, ПроДокторов, 2ГИС,
 * НаПоправку, DocDoc, Докту) в одном месте.
 * Каждая доска настраивается отдельно (login + password + filialId).
 */

const { ReviewSyncConfig, ReviewPlatform, Review, ReviewBoard } = require('../../models');
const { v4: uuidv4 } = require('uuid');
const adapter = require('./adapters/getloyalty');
const workflowEngine = require('../workflowEngine');
const notificationService = require('../notificationService');

const PROVIDER = 'getloyalty';

// ──────────────────────────────────────────────────────────────────────────────
// Маппинг платформ: имя из GetLoyalty → ID в нашей БД
// ──────────────────────────────────────────────────────────────────────────────

const platformCache = {};

async function getPlatformId(name) {
  if (!name) name = 'Другая площадка';

  if (platformCache[name]) return platformCache[name];

  const [platform] = await ReviewPlatform.findOrCreate({
    where: { name },
    defaults: { name, isActive: true, sortOrder: 99 }
  });

  platformCache[name] = platform.id;
  return platform.id;
}

// ──────────────────────────────────────────────────────────────────────────────
// Синхронизация одной конфигурации (одна доска)
// ──────────────────────────────────────────────────────────────────────────────

async function syncConfig(config) {
  // Всегда берём только предыдущий день — дедупликация по externalId не допустит дублей
  const rawReviews = await adapter.fetchReviews(config.credentials, {});

  if (!rawReviews.length) return 0;

  const board = await ReviewBoard.findByPk(config.boardId);
  if (!board) return 0;

  const now = new Date();
  let imported = 0;

  for (const raw of rawReviews) {
    // Дедупликация по externalId + boardId
    // paranoid: false — находим в т.ч. мягко-удалённые, чтобы не реимпортировать
    const existing = await Review.findOne({
      where: { externalId: raw.externalId, boardId: config.boardId },
      paranoid: false
    });
    if (existing) {
      if (!existing.doctorName && raw.doctorName) {
        await existing.update({ doctorName: raw.doctorName });
      }
      continue;
    }

    const platformId = await getPlatformId(raw.platformName);

    const rating = raw.rating != null
      ? Math.max(1, Math.min(5, Math.round(raw.rating)))
      : 3;

    const review = await Review.create({
      id:             uuidv4(),
      boardId:        config.boardId,
      platformId,
      patientName:    raw.authorName || 'Аноним',
      reviewDate:     (raw.date || now).toISOString().slice(0, 10),
      rating,
      reviewText:     raw.text || '(текст отсутствует)',
      doctorName:     raw.doctorName || null,
      status:         'new',
      externalId:     raw.externalId,
      externalUrl:    raw.externalUrl || null,
      isAutoImported: true,
      syncedAt:       now,
      importSource:   PROVIDER,
      sortOrder:      0,
      archived:       false,
      attachments:    [],
      assigneeIds:    []
    });

    try {
      await workflowEngine.executeWorkflow(board, 'review_created', review, notificationService);
    } catch (wfErr) {
      console.error(`[WorkflowEngine] review_created hook error (sync):`, wfErr.message);
    }

    imported++;
  }

  return imported;
}

// ──────────────────────────────────────────────────────────────────────────────
// Синхронизировать одну доску
// ──────────────────────────────────────────────────────────────────────────────

async function syncBoard(boardId) {
  const config = await ReviewSyncConfig.findOne({
    where: { boardId, provider: PROVIDER, isEnabled: true }
  });

  if (!config) {
    console.log(`ℹ️ [ReviewSync] Доска ${boardId}: синхронизация не настроена или отключена`);
    return [];
  }

  try {
    await config.update({ lastSyncStatus: 'running' });

    const count = await syncConfig(config);

    await config.update({
      lastSyncAt:     new Date(),
      lastSyncStatus: 'success',
      lastSyncError:  null,
      lastSyncCount:  count
    });

    console.log(`✅ [ReviewSync] Доска ${boardId}: импортировано ${count} отзывов`);
    return [{ provider: PROVIDER, count, status: 'success' }];
  } catch (err) {
    const errorMsg = err.message || 'Неизвестная ошибка';
    await config.update({
      lastSyncAt:     new Date(),
      lastSyncStatus: 'error',
      lastSyncError:  errorMsg,
      lastSyncCount:  0
    });
    console.error(`❌ [ReviewSync] Доска ${boardId}: ${errorMsg}`);
    return [{ provider: PROVIDER, count: 0, status: 'error', error: errorMsg }];
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Синхронизировать все включённые доски
// ──────────────────────────────────────────────────────────────────────────────

async function syncAll() {
  console.log('🔄 [ReviewSync] Запуск глобальной синхронизации через GetLoyalty...');

  const configs = await ReviewSyncConfig.findAll({
    where: { provider: PROVIDER, isEnabled: true }
  });

  if (!configs.length) {
    console.log('ℹ️ [ReviewSync] Нет включённых конфигураций');
    return;
  }

  let totalImported = 0;

  for (const config of configs) {
    const results = await syncBoard(config.boardId);
    totalImported += results.reduce((s, r) => s + r.count, 0);
  }

  console.log(`✅ [ReviewSync] Завершено. Импортировано всего: ${totalImported}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Проверить подключение
// ──────────────────────────────────────────────────────────────────────────────

async function testConnection(provider, credentials) {
  if (provider !== PROVIDER) return { success: false, message: `Неизвестный провайдер: ${provider}` };
  return adapter.testConnection(credentials);
}

function getCredentialsSchema(provider) {
  if (provider !== PROVIDER) return [];
  return adapter.credentialsSchema;
}

// ──────────────────────────────────────────────────────────────────────────────
// Метаданные провайдера (для UI)
// ──────────────────────────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    key:           PROVIDER,
    label:         'GetLoyalty',
    icon:          '⭐',
    hasOfficialApi: false,
    description:   'Агрегирует отзывы со всех площадок: Яндекс, Google, ПроДокторов, 2ГИС, НаПоправку, DocDoc, Докту'
  }
];

module.exports = {
  syncAll,
  syncBoard,
  syncConfig,
  testConnection,
  getCredentialsSchema,
  PROVIDERS
};
