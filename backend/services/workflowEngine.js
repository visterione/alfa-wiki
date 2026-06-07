/**
 * Workflow Engine для модуля Reviews
 * Выполняет сценарии автоматизации при событиях жизненного цикла отзывов
 *
 * Форматы workflowConfig:
 *  - Новый: { scenarios: [{ id, name, nodes, edges }] }
 *  - Старый: { nodes, edges } — обратная совместимость
 */

const { ReviewBoardRole } = require('../models');
const { getStatusById } = require('../config/reviewStatuses');

// ─── Получить сценарии ─────────────────────────────────────────────────────

function getScenarios(config) {
  if (!config) return [];
  if (Array.isArray(config.scenarios)) return config.scenarios;
  if (Array.isArray(config.nodes) && config.nodes.length > 0) {
    return [{ id: 'legacy', name: 'Основной', nodes: config.nodes, edges: config.edges || [] }];
  }
  return [];
}

// ─── Проверка триггеров ────────────────────────────────────────────────────

const RATING_THRESHOLD = 4;

function matchesTrigger(node, event, review, extraData) {
  if (event === 'review_created' && node.type === 'triggerNewReview') {
    const { condition = 'any', ratingThreshold = RATING_THRESHOLD } = node.data || {};
    if (condition === 'any') return true;
    if (condition === 'positive') return review.rating >= ratingThreshold;
    if (condition === 'negative') return review.rating < ratingThreshold;
  }

  if (event === 'status_changed' && node.type === 'triggerStatusChange') {
    const { fromStatus = 'any', toStatus, reviewCondition = 'any', ratingThreshold = RATING_THRESHOLD } = node.data || {};
    const { oldStatus, newStatus } = extraData || {};
    if (toStatus && toStatus !== newStatus) return false;
    if (fromStatus !== 'any' && fromStatus !== oldStatus) return false;
    if (reviewCondition === 'positive' && review.rating < ratingThreshold) return false;
    if (reviewCondition === 'negative' && review.rating >= ratingThreshold) return false;
    return true;
  }

  return false;
}

// ─── Выполнение action-нодов ───────────────────────────────────────────────

// chainContext накапливает assignedUserIds в процессе BFS-обхода цепочки
async function executeAction(node, review, board, notificationService, chainContext) {
  const { type, data = {} } = node;

  // Назначить (один ответственный — заменяет предыдущего)
  if (type === 'actionAssign') {
    const userId = data.userIds?.[0] || null;
    const userIds = userId ? [userId] : [];
    if (userId) {
      await review.update({ assigneeIds: userIds });
      console.log(`[WorkflowEngine] actionAssign: review ${review.id} → user`, userId);
      chainContext.assignedUserIds.add(userId);

      if (notificationService) {
        for (const userId of userIds) {
          try {
            await notificationService.sendReviewAssignedNotification(userId, review, board, null);
          } catch (e) {
            console.error(`[WorkflowEngine] assign notify userId=${userId}:`, e.message);
          }
        }
      }
    }
  }

  // Переместить
  if (type === 'actionMove') {
    const { targetStatus } = data;
    if (targetStatus && targetStatus !== review.status) {
      await review.update({ status: targetStatus });
      console.log(`[WorkflowEngine] actionMove: review ${review.id} → ${targetStatus}`);
    }
  }

  // Уведомить
  if (type === 'actionNotify' && notificationService) {
    const notifType = data.notificationType || 'statusChange';
    const currentStatusLabel = getStatusById(review.status)?.label || review.status;

    // notifyMode: 'chain_assignees' — уведомить тех, кого назначили в этой цепочке
    // notifyMode: 'fixed' (или не задан) — фиксированный список userIds
    const userIds = data.notifyMode === 'chain_assignees'
      ? Array.from(chainContext.assignedUserIds)
      : (data.userIds || []);

    for (const userId of userIds) {
      try {
        switch (notifType) {
          case 'newReview':
            await notificationService.sendReviewCreatedNotification(userId, review, board, review.creator || null, review.rating < RATING_THRESHOLD);
            break;
          case 'statusChange':
            await notificationService.sendReviewStatusChangedNotification(userId, review, '—', currentStatusLabel, null, false);
            break;
          case 'assignment':
            await notificationService.sendReviewAssignedNotification(userId, review, board, null);
            break;
          case 'workComplete':
            await notificationService.sendReviewWorkCompleteNotification(userId, review, null, null);
            break;
          case 'archive':
            await notificationService.sendReviewArchivedNotification(userId, review, null);
            break;
          default:
            await notificationService.sendReviewCreatedNotification(userId, review, board, review.creator || null, review.rating < RATING_THRESHOLD);
        }
      } catch (e) {
        console.error(`[WorkflowEngine] notify(${notifType}) userId=${userId}:`, e.message);
      }
    }
  }
}

// ─── Выполнение одного сценария ────────────────────────────────────────────

async function executeScenario(scenario, event, review, board, notificationService, extraData) {
  const { nodes = [], edges = [] } = scenario;

  const matchedTriggers = nodes.filter(n =>
    (n.type === 'triggerNewReview' || n.type === 'triggerStatusChange') &&
    matchesTrigger(n, event, review, extraData)
  );

  for (const trigger of matchedTriggers) {
    const chainContext = { assignedUserIds: new Set() };
    const visited = new Set();
    const queue = [trigger.id];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const node = nodes.find(n => n.id === nodeId);
      if (!node) continue;
      if (node.type.startsWith('action')) {
        await executeAction(node, review, board, notificationService, chainContext);
      }
      edges.filter(e => e.source === nodeId).forEach(e => queue.push(e.target));
    }
  }
}

// ─── Основная функция ──────────────────────────────────────────────────────

async function executeWorkflow(board, event, review, notificationService, extraData = {}) {
  try {
    const scenarios = getScenarios(board.workflowConfig);
    if (scenarios.length === 0) return;
    for (const scenario of scenarios) {
      await executeScenario(scenario, event, review, board, notificationService, extraData);
    }
  } catch (err) {
    console.error('[WorkflowEngine] error:', err.message, err.stack);
  }
}

module.exports = { executeWorkflow };
