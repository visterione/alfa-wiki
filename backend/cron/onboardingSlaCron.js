/**
 * Напоминания и эскалация по срокам онбординга.
 *
 * Срок у задачи посчитан в рабочих часах (services/onboarding/sla.js). Здесь
 * только два действия: когда срок вышел — напомнить исполнителю, когда прошло
 * ещё столько же — сказать тому, кто назначен на эскалацию.
 *
 * Оба уведомления шлются один раз: поля remindedAt и escalatedAt существуют
 * ровно для этого. Без них человек получал бы одно и то же сообщение каждые
 * полчаса и перестал бы их читать — а вместе с ними и все остальные.
 */

const cron = require('node-cron');
const { Op } = require('sequelize');
const { OnbTask, OnbApplication, OnbEmailCode } = require('../models');
const proc = require('../services/onboarding/process');
const assignments = require('../services/onboarding/assignments');
const engine = require('../services/onboarding/engine');
const sla = require('../services/onboarding/sla');

// Каждые полчаса: сроки здесь в часах, чаще проверять нечего.
const SCHEDULE = '*/30 * * * *';

async function run() {
  const now = new Date();

  // Заодно подчищаем отработавшие коды подтверждения: публичную ссылку
  // открывают чаще, чем доводят анкету до конца, и таблица иначе растёт
  // бесконечно. Сутки после истечения — запас на разбор жалоб «код не пришёл».
  try {
    await OnbEmailCode.destroy({
      where: { expiresAt: { [Op.lt]: new Date(now - 24 * 60 * 60 * 1000) } }
    });
  } catch (error) {
    console.error('[Onboarding SLA] Очистка кодов:', error.message);
  }

  const overdue = await OnbTask.findAll({
    where: { completedAt: null, dueAt: { [Op.lt]: now } },
    include: [{ model: OnbApplication, as: 'application' }]
  });

  for (const task of overdue) {
    const app = task.application;
    // Отменённые и отклонённые заявки напоминаний не порождают: их задачи уже
    // закрыты движком, но подстраховка дешевле разбора жалоб.
    if (!app || [proc.STATUS.CANCELLED, proc.STATUS.REJECTED].includes(app.status)) continue;

    const step = proc.getStep(task.stepKey);
    const label = step?.title || task.stepKey;
    const hours = await sla.overdueWorkingHours(task.dueAt, now);

    try {
      if (!task.remindedAt) {
        const targets = (task.assigneeIds || []).filter(Boolean);
        if (targets.length) {
          await engine.notify(targets,
            `⏰ Просрочен шаг онбординга: ${label}\n` +
            `Заявка №${app.number}, ${app.fullName || 'без имени'}. Просрочка ${hours} раб. ч.`,
            { type: 'onboarding_overdue', applicationId: app.id, stepKey: task.stepKey });
        }
        await task.update({ remindedAt: now });
        await engine.log(app.id, 'sla_reminded', { stepKey: task.stepKey, hours });
        continue;
      }

      // Эскалация — когда просрочка сравнялась с самим сроком: шаг на 4 часа
      // эскалируется через 4 часа после срока, а не через сутки.
      const budget = step?.slaHours || proc.DOCTOR_STEP_SLA_HOURS;
      if (!task.escalatedAt && hours >= budget) {
        const targets = await assignments.resolveEscalation(app.medCenterId);
        if (targets.length) {
          await engine.notify(targets,
            `🚨 Онбординг стоит: ${label}\n` +
            `Заявка №${app.number}, ${app.fullName || 'без имени'}. Просрочка ${hours} раб. ч.`,
            { type: 'onboarding_escalated', applicationId: app.id, stepKey: task.stepKey });
        }
        await task.update({ escalatedAt: now });
        await engine.log(app.id, 'sla_escalated', { stepKey: task.stepKey, hours });
      }
    } catch (error) {
      console.error(`[Onboarding SLA] Задача ${task.id}:`, error.message);
    }
  }
}

cron.schedule(SCHEDULE, () => {
  run().catch(error => console.error('[Onboarding SLA] Ошибка обхода:', error.message));
});

console.log('[Onboarding SLA] Проверка сроков запущена (каждые 30 минут)');

module.exports = { run };
