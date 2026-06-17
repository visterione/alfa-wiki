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
const { replyToReview: adapterReplyToReview } = adapter;
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

async function syncConfig(config, options = {}) {
  const rawReviews = await adapter.fetchReviews(config.credentials, options);

  if (!rawReviews.length) return 0;

  const board = await ReviewBoard.findByPk(config.boardId);
  if (!board) return 0;

  const now = new Date();
  let imported = 0;

  for (const raw of rawReviews) {
    // Дедупликация: сначала по externalId, затем по содержимому (защита от дублей GL)
    // paranoid: false — находим в т.ч. мягко-удалённые, чтобы не реимпортировать
    let existing = await Review.findOne({
      where: { externalId: raw.externalId, boardId: config.boardId },
      paranoid: false
    });

    if (!existing && raw.externalId) {
      // GetLoyalty иногда возвращает один отзыв с двумя разными ID.
      // Ищем по patientName + reviewDate + boardId чтобы не создавать дубли.
      const reviewDateStr = (raw.date || now).toISOString().slice(0, 10);
      existing = await Review.findOne({
        where: {
          patientName: raw.authorName || 'Аноним',
          reviewDate:  reviewDateStr,
          boardId:     config.boardId,
          importSource: PROVIDER
        },
        paranoid: false
      });
    }

    if (existing) {
      const updates = {};
      // Если нашли по content-дедупликации — зафиксируем externalId (GL дубль)
      if (existing.externalId !== raw.externalId && !existing.externalId) {
        updates.externalId = raw.externalId;
      }
      if (!existing.doctorName && raw.doctorName) updates.doctorName = raw.doctorName;

      const currentMeta = existing.syncMeta || {};
      const newMeta = { ...currentMeta };
      let metaChanged = false;

      if (raw.sourceHashKey && !currentMeta.sourceHashKey) {
        newMeta.sourceHashKey = raw.sourceHashKey;
        metaChanged = true;
      }
      // Обновляем данные ответа при каждой синхронизации
      if (raw.firstComment) {
        if (newMeta.replyText !== raw.firstComment.text ||
            newMeta.isAnswered !== raw.isAnswered ||
            newMeta.replyPending !== raw.firstComment.isPending) {
          newMeta.replyText    = raw.firstComment.text;
          newMeta.replyDate    = raw.firstComment.date;
          newMeta.isAnswered   = raw.isAnswered;
          newMeta.replyPending = raw.firstComment.isPending;
          metaChanged = true;
        }
      } else if (currentMeta.replyText && !raw.isAnswered) {
        // Ответ удалён на платформе
        delete newMeta.replyText;
        delete newMeta.replyDate;
        delete newMeta.replyPending;
        newMeta.isAnswered = false;
        metaChanged = true;
      }

      if (metaChanged) updates.syncMeta = newMeta;
      if (Object.keys(updates).length > 0) await existing.update(updates);
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
      assigneeIds:    [],
      syncMeta: {
        ...(raw.sourceHashKey ? { sourceHashKey: raw.sourceHashKey } : {}),
        ...(raw.firstComment ? {
          replyText:    raw.firstComment.text,
          replyDate:    raw.firstComment.date,
          isAnswered:   raw.isAnswered,
          replyPending: raw.firstComment.isPending
        } : {})
      }
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

// ──────────────────────────────────────────────────────────────────────────────
// Полная синхронизация (backfill): обновляет syncMeta для всех старых отзывов
// Находит дату самого раннего отзыва доски и тянет всё с того момента
// ──────────────────────────────────────────────────────────────────────────────

async function backfillBoard(boardId) {
  const config = await ReviewSyncConfig.findOne({
    where: { boardId, provider: PROVIDER, isEnabled: true }
  });
  if (!config) throw new Error('Синхронизация GetLoyalty не настроена или отключена для этой доски');

  // Находим дату самого старого отзыва этой доски
  const oldest = await Review.findOne({
    where: { boardId, importSource: PROVIDER },
    order: [['reviewDate', 'ASC']],
    attributes: ['reviewDate'],
    paranoid: false
  });

  const since = oldest ? new Date(oldest.reviewDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  try {
    await config.update({ lastSyncStatus: 'running' });
    const count = await syncConfig(config, { since });
    await config.update({
      lastSyncAt: new Date(),
      lastSyncStatus: 'success',
      lastSyncError: null,
      lastSyncCount: count
    });
    console.log(`✅ [ReviewSync] Backfill доски ${boardId}: обработано отзывов с ${since.toISOString().slice(0, 10)}`);
    return { count, since };
  } catch (err) {
    await config.update({ lastSyncAt: new Date(), lastSyncStatus: 'error', lastSyncError: err.message });
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Отправить ответ на отзыв через GetLoyalty
// ──────────────────────────────────────────────────────────────────────────────

async function replyToReview(boardId, review) {
  const config = await ReviewSyncConfig.findOne({
    where: { boardId, provider: PROVIDER, isEnabled: true }
  });
  if (!config) throw new Error('Синхронизация GetLoyalty не настроена или отключена для этой доски');

  const sourceHashKey = review.syncMeta?.sourceHashKey || null;
  const result = await adapterReplyToReview(
    config.credentials,
    review.externalId,
    sourceHashKey,
    review.replyText,
    review.reviewDate
  );

  // Сохраняем найденный hashKey в syncMeta для последующих ответов (fast path)
  if (result.resolvedHashKey && result.resolvedHashKey !== sourceHashKey) {
    await Review.update(
      { syncMeta: { ...(review.syncMeta || {}), sourceHashKey: result.resolvedHashKey } },
      { where: { id: review.id } }
    );
  }

  return result;
}

module.exports = {
  syncAll,
  syncBoard,
  syncConfig,
  backfillBoard,
  testConnection,
  getCredentialsSchema,
  replyToReview,
  PROVIDERS
};
