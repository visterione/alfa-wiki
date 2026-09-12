/**
 * Напоминания и эскалация по срокам раздела «Вакансии» (ver. 8.20).
 *
 * Срок у задачи посчитан в рабочих часах (services/workingHours.js). Здесь
 * только два действия: когда срок вышел — напомнить исполнителю, когда прошло
 * ещё столько же — сказать тому, кто назначен на эскалацию.
 *
 * Оба уведомления шлются один раз: поля remindedAt и escalatedAt существуют
 * ровно для этого. Без них человек получал бы одно и то же сообщение каждые
 * полчаса и перестал бы их читать — а вместе с ними и все остальные.
 *
 * Свой обход, а не общий со старым онбордингом: у задач разные таблицы, разные
 * тексты и разный адрес в ссылке. Общий цикл по двум моделям читался бы хуже,
 * чем два цикла по одной, и уехал бы вместе с удалением первого поколения.
 */

const cron = require('node-cron');
const { Op } = require('sequelize');

const { VacTask, VacApplication, VacTemplate, VacEmailCode } = require('../models');
const processSchema = require('../services/vacancies/processSchema');
const assignments = require('../services/vacancies/assignments');
const engine = require('../services/vacancies/engine');
const sla = require('../services/workingHours');

// Каждые полчаса: сроки здесь в часах, чаще проверять нечего.
const SCHEDULE = '*/30 * * * *';

async function run() {
  const now = new Date();

  // Заодно подчищаем отработавшие коды подтверждения: публичную ссылку
  // открывают чаще, чем доводят анкету до конца, и таблица иначе растёт
  // бесконечно. Сутки после истечения — запас на разбор жалоб «код не пришёл».
  try {
    await VacEmailCode.destroy({
      where: { expiresAt: { [Op.lt]: new Date(now - 24 * 60 * 60 * 1000) } }
    });
  } catch (error) {
    console.error('[Вакансии SLA] Очистка кодов:', error.message);
  }

  const overdue = await VacTask.findAll({
    where: { completedAt: null, dueAt: { [Op.lt]: now } },
    include: [{
      model: VacApplication, as: 'application',
      include: [{ model: VacTemplate, as: 'template', attributes: ['id', 'process'] }]
    }]
  });

  for (const task of overdue) {
    const app = task.application;
    // Остановленные заявки напоминаний не порождают: их задачи уже сняты
    // движком, но подстраховка дешевле разбора жалоб.
    if (!app || ['cancelled', 'rejected'].includes(app.status)) continue;

    const step = processSchema.getStep(app.template?.process, task.stepKey);
    const label = step?.title || task.stepKey;
    const hours = await sla.overdueWorkingHours(task.dueAt, now);

    try {
      if (!task.remindedAt) {
        const targets = (task.assigneeIds || []).filter(Boolean);
        if (targets.length) {
          await engine.notify(targets,
            `⏰ Просрочен шаг: ${label}\n`
            + `${app.fullName || 'заявка без имени'}. Просрочка ${hours} раб. ч.`,
            { type: 'vacancy_overdue', applicationId: app.id, stepKey: task.stepKey });
        }
        await task.update({ remindedAt: now });
        await engine.log(app.id, 'sla_reminded', { stepKey: task.stepKey, hours });
        continue;
      }

      // Эскалация — когда просрочка сравнялась с самим сроком: шаг на 4 часа
      // эскалируется через 4 часа после срока, а не через сутки.
      const budget = step?.slaHours || 8;
      if (!task.escalatedAt && hours >= budget) {
        const targets = await assignments.resolveEscalation(app.templateId, app.medCenterId);
        if (targets.length) {
          await engine.notify(targets,
            `🚨 Заявка стоит: ${label}\n`
            + `${app.fullName || 'заявка без имени'}. Просрочка ${hours} раб. ч.`,
            { type: 'vacancy_escalated', applicationId: app.id, stepKey: task.stepKey });
        }
        await task.update({ escalatedAt: now });
        await engine.log(app.id, 'sla_escalated', { stepKey: task.stepKey, hours });
      }
    } catch (error) {
      console.error(`[Вакансии SLA] Задача ${task.id}:`, error.message);
    }
  }
}

cron.schedule(SCHEDULE, () => {
  run().catch(error => console.error('[Вакансии SLA] Ошибка обхода:', error.message));
});

console.log('[Вакансии SLA] Проверка сроков запущена (каждые 30 минут)');

module.exports = { run };
