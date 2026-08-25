'use strict';

/**
 * Переходы процесса: кто когда получает задачу и когда заявка считается
 * запущенной.
 *
 * Здесь собрано всё, что меняет состояние заявки. Маршруты этого не делают —
 * они только проверяют право и зовут нужную функцию. Причина простая: одно и то
 * же событие приходит из трёх мест (сотрудник нажал кнопку, врач отправил форму,
 * крон проверил срок), и три копии логики разошлись бы на первой же правке.
 */

const {
  OnbTask, OnbEvent, OnbServiceChoice, MedCenter, DoctorServiceDuration
} = require('../../models');
const proc = require('./process');
const assignments = require('./assignments');
const sla = require('./sla');
const mailer = require('./mailer');
const misVerify = require('./misVerify');
const notificationService = require('../notificationService');

// ── Журнал ─────────────────────────────────────────────────────────────────

async function log(applicationId, action, payload = {}, userId = null) {
  try {
    await OnbEvent.create({ applicationId, action, payload, userId });
  } catch (error) {
    // Журнал не должен ронять сам переход: событие важно, но заявка уже
    // изменилась, и откат сделал бы состояние противоречивым.
    console.error('[onboarding] Не удалось записать событие:', error.message);
  }
}

// ── Уведомления исполнителям ───────────────────────────────────────────────
//
// Сотруднику — сообщение от бота в портал (оно же уходит пушем в мобилку).
// Письма исполнителям намеренно не шлём: задача и так видна в разделе, а третий
// канал приучает не читать ни один.

async function notify(userIds, text, metadata = {}) {
  for (const userId of userIds) {
    try {
      await notificationService.sendMessageToUser(userId, text, metadata);
    } catch (error) {
      console.error(`[onboarding] Уведомление пользователю ${userId} не ушло:`, error.message);
    }
  }
}

/**
 * Мгновенно сообщает открытым вкладкам, что состав задач изменился.
 * Сообщение Ассистента и этот сигнал решают разные задачи: первое остаётся в
 * истории и приходит пушем, второй беззвучно синхронизирует список и бейдж.
 */
function signalChanged(userIds, payload = {}) {
  const socket = notificationService.getIo();
  if (!socket) return;
  for (const userId of [...new Set((userIds || []).filter(Boolean))]) {
    socket.to(`user:${userId}`).emit('onboarding:changed', payload);
  }
}

// ── Создание задач ─────────────────────────────────────────────────────────

/**
 * Ставит задачу по шагу. Если задача уже есть — переоткрывает её, а не создаёт
 * вторую: на заявку приходится ровно одна задача на шаг, иначе чек-лист увидит
 * две записи с разным состоянием.
 */
async function openTask(app, stepKey) {
  const step = proc.getStep(stepKey);
  if (!step) return null;

  const assignees = await assignments.resolveAssignees(stepKey, app.medCenterId);
  const dueAt = await sla.dueAfterWorkingHours(step.slaHours);

  const [task, created] = await OnbTask.findOrCreate({
    where: { applicationId: app.id, stepKey },
    defaults: { assigneeIds: assignees, dueAt }
  });

  if (!created) {
    await task.update({
      assigneeIds: assignees,
      dueAt,
      completedAt: null,
      completedBy: null,
      verifiedByMis: false,
      claimedBy: null,
      claimedAt: null,
      remindedAt: null,
      escalatedAt: null
    });
  }

  if (!assignees.length) {
    // Некому — это не повод молча потерять шаг. Задача остаётся открытой и без
    // исполнителей: на доске она подсвечена, админ переназначит вручную.
    await log(app.id, 'task_unassigned', { stepKey });
  } else {
    // Список должен обновиться раньше, чем пользователь увидит уведомление от
    // Ассистента и успеет перейти в «Мои задачи».
    signalChanged(assignees, { reason: 'task_opened', applicationId: app.id, stepKey });
    const who = assignees.length > 1 ? 'Задача общая: кто первым возьмёт, за тем она и закрепится.' : '';
    await notify(assignees,
      `🩺 Онбординг врача — ${app.fullName || 'без имени'}\n${step.title}\n${who}`,
      { type: 'onboarding_task', applicationId: app.id, stepKey });
  }

  await log(app.id, 'task_opened', { stepKey, assignees });
  return task;
}

/** Задача врача на выбор услуг. Исполнителя в клинике у неё нет — только письмо. */
async function openDoctorServicesTask(app, { notifyDoctor = true } = {}) {
  const dueAt = await sla.dueAfterWorkingHours(proc.DOCTOR_STEP_SLA_HOURS);
  const [task, created] = await OnbTask.findOrCreate({
    where: { applicationId: app.id, stepKey: proc.DOCTOR_STEP },
    defaults: { assigneeIds: [], dueAt }
  });
  if (!created) {
    await task.update({ dueAt, completedAt: null, completedBy: null });
  }

  if (notifyDoctor) {
    const sent = await mailer.sendServicesInvite(app);
    await log(app.id, 'doctor_services_invited', { mail: sent.success, reason: sent.reason || null });
  }
  return task;
}

// ── Переходы ───────────────────────────────────────────────────────────────

/**
 * Врач отправил анкету. Уходит только главврачу филиала: пока он не согласовал,
 * остальные роли не задействованы — это условие ТЗ и единственная точка, где
 * процесс может встать целиком.
 */
async function submit(app) {
  await app.update({ status: proc.STATUS.SUBMITTED, submittedAt: new Date() });

  const chiefs = await assignments.resolveChiefs(app.medCenterId);
  if (chiefs.length) {
    await notify(chiefs,
      `🩺 Новая анкета врача — ${app.fullName || 'без имени'}\nНужно согласование.`,
      { type: 'onboarding_approval', applicationId: app.id });
  } else {
    await log(app.id, 'chief_unassigned', {});
  }

  await log(app.id, 'submitted', { medCenterId: app.medCenterId });
  return app;
}

/**
 * Согласование запускает две независимые ветки: создание учётки в МИС и выбор
 * услуг врачом. Для показа каталога doctor_id не нужен.
 */
async function approve(app, user) {
  await app.update({
    status: proc.STATUS.APPROVED,
    decidedBy: user.id,
    decidedAt: new Date(),
    decisionNote: null,
    revisionFields: []
  });
  await log(app.id, 'approved', {}, user.id);
  await openTask(app, 'mis_account');
  await openDoctorServicesTask(app);
  return app;
}

/** Возврат на доработку: подсвечиваются только отмеченные поля. */
async function sendToRevision(app, user, note, fields = []) {
  await app.update({
    status: proc.STATUS.REVISION,
    decidedBy: user.id,
    decidedAt: new Date(),
    decisionNote: note || null,
    revisionFields: fields
  });
  const sent = await mailer.sendRevision(app, note, fields);
  await log(app.id, 'revision', { note, fields, mail: sent.success }, user.id);
  return app;
}

async function reject(app, user, reason) {
  await app.update({
    status: proc.STATUS.REJECTED,
    decidedBy: user.id,
    decidedAt: new Date(),
    decisionNote: reason || null
  });
  await mailer.sendRejected(app);
  await log(app.id, 'rejected', { reason }, user.id);
  return app;
}

/**
 * Учётка создана — запускаются зависимые от неё внутренние задачи. Если врач
 * уже успел выбрать услуги, теперь можно открыть задачу бухгалтеру.
 */
async function onMisAccountCreated(app, misUserId) {
  await app.update({ status: proc.STATUS.MIS_CREATED, misUserId: String(misUserId) });
  await log(app.id, 'mis_created', { misUserId });

  for (const step of proc.stepsAfter('mis_account')) {
    await openTask(app, step.key);
  }
  const servicesTask = await OnbTask.findOne({
    where: { applicationId: app.id, stepKey: proc.DOCTOR_STEP }
  });
  if (servicesTask?.completedAt) await openTask(app, 'services_mis');
  return app;
}

/**
 * Врач отметил услуги. Бухгалтер получает задачу сразу, если учётка уже есть;
 * иначе выбор спокойно ждёт завершения шага создания пользователя.
 */
async function onServicesPicked(app) {
  const task = await OnbTask.findOne({ where: { applicationId: app.id, stepKey: proc.DOCTOR_STEP } });
  if (task && !task.completedAt) {
    await task.update({ completedAt: new Date() });
  }
  await log(app.id, 'services_picked', {});

  // Учётка могла появиться одновременно с отправкой формы. Перечитываем
  // заявку, чтобы обе стороны гонки гарантированно увидели результат другой:
  // либо этот переход откроет задачу бухгалтеру, либо onMisAccountCreated.
  await app.reload();
  if (app.misUserId) await openTask(app, 'services_mis');
  return app;
}

/**
 * Закрытие задачи исполнителем.
 *
 * У шагов с verify:'mis' отметка сначала проверяется чтением из «Реновации».
 * Не подтвердилось — задача остаётся открытой, а человек получает конкретную
 * причину, а не «ошибка».
 *
 * @returns {Promise<{ ok: boolean, reason?: string, extra?: Object }>}
 */
async function completeTask(app, task, user, { note, misUserId } = {}) {
  const step = proc.getStep(task.stepKey);
  if (!step) return { ok: false, reason: 'Неизвестный шаг' };

  if (step.verify === 'mis') {
    const check = await verifyStep(app, task.stepKey, misUserId);

    // Шаг с blocking:false закрывается и при расхождении: решение о том, какие
    // услуги клиника берёт, принимает она, а не сверка. Расхождение при этом не
    // теряется — оно уходит в журнал, чтобы потом не гадать, почему в МИС не всё.
    if (!check.ok && step.blocking !== false) return check;

    if (check.ok && task.stepKey === 'mis_account') {
      await onMisAccountCreated(app, check.misUserId);
    }
    if (!check.ok) {
      await log(app.id, 'closed_unverified', {
        stepKey: task.stepKey,
        reason: check.reason,
        missing: (check.missing || []).map(item => item.title)
      }, user.id);
    }

    await task.update({
      completedAt: new Date(),
      completedBy: user.id,
      verifiedByMis: check.ok,
      note: note || null
    });
  } else {
    await task.update({
      completedAt: new Date(), completedBy: user.id, note: note || null
    });
  }

  await log(app.id, 'task_completed', { stepKey: task.stepKey, verified: task.verifiedByMis }, user.id);
  signalChanged(task.assigneeIds, {
    reason: 'task_completed', applicationId: app.id, stepKey: task.stepKey
  });

  // Услуги внесены — их фактические длительности становятся настройкой врача, а
  // следом уходит выгрузка колл-центру.
  if (task.stepKey === 'services_mis') {
    await applyServiceDurations(app);
  }

  for (const next of proc.stepsAfter(task.stepKey)) {
    await openTask(app, next.key);
  }

  await tryLaunch(app);
  return { ok: true };
}

/** Проверка конкретного шага в МИС. Вынесена отдельно — ей же пользуется кнопка «проверить». */
async function verifyStep(app, stepKey, misUserIdOverride) {
  if (stepKey === 'mis_account') {
    // Если человек выбрал сотрудника руками из нескольких совпадений — верим
    // ему: МИС мы всё равно спрашивали, неоднозначность решает человек.
    if (misUserIdOverride) return { ok: true, misUserId: String(misUserIdOverride) };
    return misVerify.findDoctor(app);
  }
  if (stepKey === 'schedule') {
    return misVerify.verifySchedule(app);
  }
  if (stepKey === 'services_mis') {
    const choices = await OnbServiceChoice.findAll({ where: { applicationId: app.id } });
    return misVerify.verifyServices(app, choices);
  }
  return { ok: true };
}

/**
 * Длительности, которые врач переопределил на странице услуг, переносятся в
 * doctor_service_durations — таблицу, из которой их берёт онлайн-запись. Своей
 * копии не заводим: два места с длительностью приёма разойдутся в первый же
 * месяц.
 */
async function applyServiceDurations(app) {
  if (!app.misUserId) return;
  const clinicIds = await misVerify.clinicIdsFor(app.medCenterId);
  const clinicId = clinicIds[0];
  if (!clinicId) return;

  const choices = await OnbServiceChoice.findAll({
    where: { applicationId: app.id, isCustom: false }
  });

  let applied = 0;
  for (const choice of choices) {
    const minutes = Number(choice.doctorDuration);
    if (!choice.serviceId || !minutes || minutes === Number(choice.misDuration)) continue;
    try {
      await DoctorServiceDuration.upsert({
        misUserId: String(app.misUserId),
        clinicId: String(clinicId),
        serviceId: String(choice.serviceId),
        durationMinutes: minutes
      });
      applied += 1;
    } catch (error) {
      console.error('[onboarding] Длительность не сохранилась:', error.message);
    }
  }

  if (applied) await log(app.id, 'durations_applied', { applied });
}

/**
 * Заявка переходит в «Запущен», только когда закрыты все пункты чек-листа.
 * Проверяется после каждого закрытия задачи, а не отдельной кнопкой: иначе
 * появится состояние «всё сделано, но никто не нажал».
 */
async function tryLaunch(app) {
  if (app.status === proc.STATUS.LAUNCHED) return false;

  const tasks = await OnbTask.findAll({ where: { applicationId: app.id } });
  if (!proc.isReadyToLaunch(tasks)) return false;

  await app.update({ status: proc.STATUS.LAUNCHED, launchedAt: new Date() });

  const mc = app.medCenterId ? await MedCenter.findByPk(app.medCenterId, { attributes: ['name'] }) : null;
  await mailer.sendWelcome(app, mc?.name);

  const participants = [...new Set(tasks.flatMap(t => [t.completedBy, t.claimedBy]).filter(Boolean))];
  await notify(participants,
    `✅ Врач ${app.fullName || 'по заявке без имени'} запущен. Все пункты чек-листа закрыты.`,
    { type: 'onboarding_launched', applicationId: app.id });

  await log(app.id, 'launched', {});
  return true;
}

/**
 * Отмена процесса.
 *
 * Портал не трогает то, что уже завели в МИС: прав на запись у него нет. Но
 * молча оставить врача-призрака, на которого колл-центр будет записывать
 * пациентов, тоже нельзя — поэтому админу МИС уходит задача на деактивацию, а в
 * карточке остаётся список того, что успели сделать.
 */
async function cancel(app, user, reason) {
  const tasks = await OnbTask.findAll({ where: { applicationId: app.id } });
  const doneSteps = tasks.filter(t => t.completedAt).map(t => t.stepKey);

  await app.update({
    status: proc.STATUS.CANCELLED,
    cancelledAt: new Date(),
    cancelledBy: user.id,
    cancelReason: reason || null
  });

  await OnbTask.update(
    { completedAt: new Date(), note: 'Заявка отменена' },
    { where: { applicationId: app.id, completedAt: null } }
  );

  if (app.misUserId) {
    const admins = await assignments.resolveAssignees('mis_account', app.medCenterId);
    await notify(admins,
      `⚠️ Онбординг врача ${app.fullName || 'без имени'} отменён, ` +
      `но учётная запись в «Реновации» уже создана (id ${app.misUserId}). Её нужно деактивировать вручную.`,
      { type: 'onboarding_cancelled', applicationId: app.id });
  }

  await log(app.id, 'cancelled', { reason, doneSteps, misUserId: app.misUserId }, user.id);
  return app;
}

/**
 * Смена филиала. Отдельным переходом, потому что филиал определяет всех
 * исполнителей: врач выбирает его сам в публичной форме и ошибается, это
 * вопрос времени.
 */
async function changeMedCenter(app, user, medCenterId) {
  const previous = app.medCenterId;
  await app.update({ medCenterId });

  // Переназначаем открытые задачи на исполнителей нового филиала.
  const openTasks = await OnbTask.findAll({ where: { applicationId: app.id, completedAt: null } });
  for (const task of openTasks) {
    if (task.stepKey === proc.DOCTOR_STEP) continue;
    const assignees = await assignments.resolveAssignees(task.stepKey, medCenterId);
    await task.update({ assigneeIds: assignees, claimedBy: null, claimedAt: null });
  }

  await log(app.id, 'medcenter_changed', { from: previous, to: medCenterId }, user.id);
  return app;
}

module.exports = {
  log,
  notify,
  signalChanged,
  openTask,
  openDoctorServicesTask,
  submit,
  approve,
  sendToRevision,
  reject,
  onMisAccountCreated,
  onServicesPicked,
  completeTask,
  verifyStep,
  applyServiceDurations,
  tryLaunch,
  cancel,
  changeMedCenter
};
