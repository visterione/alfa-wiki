'use strict';

/**
 * Переходы процесса: кто когда получает задачу и когда заявка считается
 * запущенной (ver. 8.20).
 *
 * Здесь собрано всё, что меняет состояние заявки. Маршруты этого не делают —
 * они только проверяют право и зовут нужную функцию. Причина простая: одно и то
 * же событие приходит из трёх мест (сотрудник нажал кнопку, кандидат закрыл
 * свой шаг, крон проверил срок), и три копии логики разошлись бы на первой же
 * правке.
 *
 * Главное отличие от первого поколения. Там порядок шагов был зашит, и после
 * закрытия задачи открывались те, у кого `after` совпадал с её ключом. Здесь
 * процесс произвольный и зависимость — список: шаг ждёт всех перечисленных.
 * Поэтому «что открыть дальше» не выводится из одного ключа, а пересчитывается
 * целиком — openReady() смотрит на весь процесс и всё, что уже закрыто. Это
 * дороже на один запрос, зато не зависит от того, в каком порядке закрывались
 * предшественники, и переживает добавление шага в живой процесс.
 */

const {
  VacApplication, VacTemplate, VacTask, VacEvent, VacServiceChoice,
  MedCenter, DoctorServiceDuration
} = require('../../models');

const processSchema = require('./processSchema');
const assignments = require('./assignments');
const sla = require('../workingHours');
const mailer = require('./mailer');
const chatLinks = require('./chatLinks');
const misStaff = require('../misStaff');
const notificationService = require('../notificationService');

// ── Журнал ─────────────────────────────────────────────────────────────────

async function log(applicationId, action, payload = {}, userId = null) {
  try {
    await VacEvent.create({ applicationId, action, payload, userId });
  } catch (error) {
    // Журнал не должен ронять сам переход: заявка уже изменилась, и откат
    // сделал бы состояние противоречивым.
    console.error('[vacancies] Не удалось записать событие:', error.message);
  }
}

// ── Уведомления исполнителям ───────────────────────────────────────────────
//
// Сотруднику — сообщение от бота в портал (оно же уходит пушем в мобилку).
// Письма исполнителям намеренно не шлём: задача и так видна в разделе, а третий
// канал приучает не читать ни один.

/**
 * Дописывает ссылку на заявку. Без неё уведомление читается как извещение «вот
 * что случилось», и человек не понимает, куда идти: раздел он видит редко и в
 * меню его не ищет. Разметка та же, что у бота отзывов: мессенджер открывает
 * такие ссылки внутри портала, не перезагружая страницу.
 */
function withLink(text, applicationId) {
  const body = String(text || '').trimEnd();
  if (!applicationId) return body;
  return `${body}\n\n[Открыть заявку →](/vacancies?screen=apps&app=${applicationId})`;
}

async function notify(userIds, text, metadata = {}) {
  const message = withLink(text, metadata.applicationId);
  for (const userId of [...new Set((userIds || []).filter(Boolean))]) {
    try {
      await notificationService.sendMessageToUser(userId, message, metadata);
    } catch (error) {
      console.error(`[vacancies] Уведомление пользователю ${userId} не ушло:`, error.message);
    }
  }
}

/**
 * Мгновенно сообщает открытым вкладкам, что состав задач изменился. Сообщение
 * бота и этот сигнал решают разные задачи: первое остаётся в истории и приходит
 * пушем, второй беззвучно обновляет список и счётчик.
 */
function signalChanged(userIds, payload = {}) {
  const socket = notificationService.getIo();
  if (!socket) return;
  for (const userId of [...new Set((userIds || []).filter(Boolean))]) {
    socket.to(`user:${userId}`).emit('vacancies:changed', payload);
  }
}

// ── Процесс заявки ─────────────────────────────────────────────────────────

/**
 * Процесс берётся живой из шаблона, а не из снимка: новый шаг обязан появиться
 * и у тех заявок, что уже в работе. Анкета, наоборот, у заявки своя — это то,
 * под чем человек подписался.
 */
async function processOf(app) {
  const template = app.template || await VacTemplate.findByPk(app.templateId);
  return { template, process: template?.process || { steps: [] } };
}

function decisionStep(process) {
  return (process.steps || []).find(s => s.kind === 'decision' && !s.archived) || null;
}

// ── Создание задач ─────────────────────────────────────────────────────────

/**
 * Ставит задачу по шагу. Если задача уже есть — переоткрывает её, а не создаёт
 * вторую: на заявку приходится ровно одна задача на шаг, иначе чек-лист увидит
 * две записи с разным состоянием.
 */
async function openTask(app, step) {
  const spec = processSchema.STEP_KINDS[step.kind];

  // Шаг, который закрывает сам кандидат, исполнителей внутри клиники не имеет:
  // ему уходит письмо, а не задача кому-то из сотрудников.
  const assignees = spec?.assignee
    ? await assignments.resolveAssignees(app.templateId, step.key, app.medCenterId)
    : [];

  const dueAt = await sla.dueAfterWorkingHours(step.slaHours || 8);

  const [task, created] = await VacTask.findOrCreate({
    where: { applicationId: app.id, stepKey: step.key },
    defaults: { assigneeIds: assignees, dueAt }
  });

  if (!created) {
    if (task.completedAt) return task; // закрытый шаг заново не открываем
    await task.update({ assigneeIds: assignees, dueAt });
    return task;
  }

  if (spec?.assignee && !assignees.length) {
    // Некому — это не повод молча потерять шаг. Задача остаётся открытой и без
    // исполнителей: в списке она подсвечена, админ переназначит вручную.
    await log(app.id, 'task_unassigned', { stepKey: step.key });
  } else if (assignees.length) {
    // Список должен обновиться раньше, чем человек увидит уведомление и успеет
    // перейти в «Мои задачи».
    signalChanged(assignees, { reason: 'task_opened', applicationId: app.id, stepKey: step.key });
    const shared = assignees.length > 1 ? '\nЗадача общая: кто первым возьмёт, за тем она и закрепится.' : '';
    await notify(assignees,
      `📋 ${app.fullName || 'Заявка без имени'} — ${step.title}${shared}`,
      { type: 'vacancy_task', applicationId: app.id, stepKey: step.key });
  }

  await log(app.id, 'task_opened', { stepKey: step.key, assignees });

  // Выбор услуг закрывает кандидат по своей ссылке — значит, его надо позвать.
  if (step.kind === 'services_pick') {
    const { template } = await processOf(app);
    const sent = await mailer.sendServicesInvite(template, app);
    await log(app.id, 'services_invited', { mail: sent.success, reason: sent.reason || null });
  }

  return task;
}

/**
 * Открывает все шаги, которые стали готовы: не в архиве, задачи ещё нет, и все
 * предшественники закрыты.
 *
 * Пересчёт целиком, а не «что идёт после закрытого», — единственный способ
 * поддержать зависимость-список. Шаг, ждущий двоих, становится готов при
 * закрытии второго, и кто из них закрылся последним, движку знать не нужно.
 */
async function openReady(app, process) {
  const tasks = await VacTask.findAll({ where: { applicationId: app.id } });
  const done = new Set(tasks.filter(t => t.completedAt).map(t => t.stepKey));
  const existing = new Set(tasks.map(t => t.stepKey));

  const opened = [];
  for (const step of process.steps || []) {
    if (step.archived || existing.has(step.key)) continue;
    if (step.kind === 'decision') continue; // решение открывается отправкой анкеты
    const after = step.after || [];
    if (!after.length || !after.every(key => done.has(key))) continue;
    opened.push(await openTask(app, step));
  }
  return opened;
}

// ── Переходы ───────────────────────────────────────────────────────────────

/**
 * Анкета отправлена. Открывается единственная задача — решение: пока его нет,
 * остальные шаги не задействованы, и это единственная точка, где процесс может
 * встать целиком.
 *
 * Вызывается из публичного контура, где заявка уже переведена в 'submitted':
 * статус там ставится вместе с согласиями и снимком ответов, одной записью.
 */
async function onSubmitted(app) {
  const { process } = await processOf(app);
  const step = decisionStep(process);
  if (!step) {
    // Шаблон опубликовать без шага решения нельзя, но его могли убрать в архив
    // уже после. Заявка не теряется — она видна в списке и ждёт настройки.
    await log(app.id, 'decision_missing', {});
    return app;
  }
  await openTask(app, step);
  return app;
}

/** Согласовано: решение закрыто, запускается всё, что его ждало. */
async function approve(app, user, note) {
  const { process } = await processOf(app);
  const step = decisionStep(process);

  await app.update({
    status: 'in_progress',
    decidedBy: user.id,
    decidedAt: new Date(),
    decisionNote: null,
    revisionFields: []
  });

  if (step) {
    await VacTask.update(
      { completedAt: new Date(), completedBy: user.id, note: note || null },
      { where: { applicationId: app.id, stepKey: step.key, completedAt: null } }
    );
  }

  await log(app.id, 'approved', { note: note || null }, user.id);
  await openReady(app, process);
  await tryLaunch(app);
  return app;
}

/** Возврат на доработку: подсвечиваются только отмеченные поля. */
async function sendToRevision(app, user, note, fields = []) {
  await app.update({
    status: 'revision',
    decidedBy: user.id,
    decidedAt: new Date(),
    decisionNote: note || null,
    revisionFields: fields
  });

  // Незакрытая задача решения снимается: она вернётся, когда человек пришлёт
  // исправленное, — onSubmitted откроет её заново. Иначе у главврача висела бы
  // задача на анкету, которой у него сейчас нет, и её срок тикал бы всё то
  // время, пока кандидат дописывает ответы.
  const { template, process } = await processOf(app);
  const step = decisionStep(process);
  if (step) {
    await VacTask.destroy({
      where: { applicationId: app.id, stepKey: step.key, completedAt: null }
    });
  }

  const sent = await mailer.sendRevision(template, app, note, fields);
  await log(app.id, 'revision', { note, fields, mail: sent.success }, user.id);
  return app;
}

async function reject(app, user, reason) {
  const { template } = await processOf(app);
  await app.update({
    status: 'rejected',
    decidedBy: user.id,
    decidedAt: new Date(),
    decisionNote: reason || null
  });
  await VacTask.destroy({ where: { applicationId: app.id, completedAt: null } });
  await mailer.sendRejected(template, app, reason);
  await log(app.id, 'rejected', { reason }, user.id);
  return app;
}

async function cancel(app, user, reason) {
  await app.update({
    status: 'cancelled',
    cancelledAt: new Date(),
    cancelledBy: user.id,
    cancelReason: reason || null
  });
  await VacTask.destroy({ where: { applicationId: app.id, completedAt: null } });
  await log(app.id, 'cancelled', { reason }, user.id);
  return app;
}

/** Кандидат отметил услуги — его шаг закрыт, дальше считает openReady. */
async function onServicesPicked(app) {
  const { process } = await processOf(app);
  const step = (process.steps || []).find(s => s.kind === 'services_pick' && !s.archived);
  if (!step) return app;

  const task = await VacTask.findOne({ where: { applicationId: app.id, stepKey: step.key } });
  if (task && !task.completedAt) await task.update({ completedAt: new Date() });

  await log(app.id, 'services_picked', {});
  await openReady(app, process);
  await tryLaunch(app);
  return app;
}

/**
 * Закрытие задачи исполнителем.
 *
 * У шагов с умением отметка сначала проверяется чтением из «Реновации». Не
 * подтвердилось — задача остаётся открытой, а человек получает конкретную
 * причину, а не «ошибка».
 *
 * @returns {Promise<{ ok: boolean, reason?: string, missing?: Array, candidates?: Array }>}
 */
async function completeTask(app, task, user, { note, misUserId } = {}) {
  const { process } = await processOf(app);
  const step = processSchema.getStep(process, task.stepKey);
  if (!step) return { ok: false, reason: 'Такого шага в процессе больше нет' };

  const spec = processSchema.STEP_KINDS[step.kind];
  let verified = false;

  if (spec?.ability && step.kind !== 'services_pick') {
    const check = await verifyStep(app, step, misUserId);

    // Шаг с blocking:false закрывается и при расхождении: решение о том, какие
    // услуги клиника берёт, принимает она, а не сверка. Расхождение при этом не
    // теряется — оно уходит в журнал, чтобы потом не гадать, почему в МИС не всё.
    if (!check.ok && step.blocking !== false) return check;

    verified = check.ok;

    if (check.ok && step.kind === 'mis_account') {
      await app.update({ misUserId: String(check.misUserId) });
      await log(app.id, 'mis_account_created', { misUserId: check.misUserId }, user.id);
    }
    if (!check.ok) {
      await log(app.id, 'closed_unverified', {
        stepKey: step.key,
        reason: check.reason,
        missing: (check.missing || []).map(item => item.title)
      }, user.id);
    }
  }

  await task.update({
    completedAt: new Date(),
    completedBy: user.id,
    verifiedByMis: verified,
    note: note || null
  });

  await log(app.id, 'task_completed', { stepKey: step.key, verified }, user.id);
  signalChanged(task.assigneeIds, { reason: 'task_completed', applicationId: app.id, stepKey: step.key });

  // Услуги внесены — их фактические длительности становятся настройкой врача.
  if (step.kind === 'mis_services') await applyServiceDurations(app);

  await openReady(app, process);
  await tryLaunch(app);
  return { ok: true };
}

/** Проверка шага в МИС. Вынесена отдельно — ей же пользуется кнопка «проверить». */
async function verifyStep(app, step, misUserIdOverride) {
  if (step.kind === 'mis_account') {
    // Если человек выбрал сотрудника руками из нескольких совпадений — верим
    // ему: МИС мы всё равно спрашивали, неоднозначность решает человек.
    if (misUserIdOverride) return { ok: true, misUserId: String(misUserIdOverride) };
    return misStaff.findDoctor(app);
  }
  if (step.kind === 'mis_schedule') return misStaff.verifySchedule(app);
  if (step.kind === 'mis_services') {
    const choices = await VacServiceChoice.findAll({ where: { applicationId: app.id } });
    return misStaff.verifyServices(app, choices);
  }
  return { ok: true };
}

/**
 * Длительности, которые кандидат переопределил на странице услуг, переносятся в
 * doctor_service_durations — таблицу, из которой их берёт онлайн-запись. Своей
 * копии не заводим: два места с длительностью приёма разойдутся в первый же
 * месяц.
 */
async function applyServiceDurations(app) {
  if (!app.misUserId) return;
  const clinicIds = await misStaff.clinicIdsFor(app.medCenterId);
  const clinicId = clinicIds[0];
  if (!clinicId) return;

  const choices = await VacServiceChoice.findAll({
    where: { applicationId: app.id, isCustom: false }
  });

  let applied = 0;
  for (const choice of choices) {
    const minutes = Number(choice.doctorDuration);
    if (!choice.serviceId || !minutes || minutes === Number(choice.misDuration)) continue;
    try {
      await DoctorServiceDuration.upsert({
        clinicId: String(clinicId),
        doctorId: String(app.misUserId),
        serviceId: String(choice.serviceId),
        durationMinutes: minutes
      });
      applied += 1;
    } catch (error) {
      console.error('[vacancies] Длительность услуги не сохранилась:', error.message);
    }
  }
  if (applied) await log(app.id, 'durations_applied', { applied });
}

// ── Запуск ─────────────────────────────────────────────────────────────────

/**
 * Заявка считается запущенной, когда закрыты все шаги чек-листа. Шаги в архиве
 * в чек-лист не входят: они больше не появляются у новых заявок, а у старых
 * доживают свой век, и требовать их закрытия значило бы держать заявку вечно.
 */
async function tryLaunch(app) {
  if (app.status === 'launched') return false;

  const { template, process } = await processOf(app);
  const needed = processSchema.checklistSteps(process);
  if (!needed.length) return false;

  const tasks = await VacTask.findAll({ where: { applicationId: app.id } });
  const done = new Set(tasks.filter(t => t.completedAt).map(t => t.stepKey));
  if (!needed.every(step => done.has(step.key))) return false;

  await app.update({ status: 'launched', launchedAt: new Date() });

  const mc = app.medCenterId
    ? await MedCenter.findByPk(app.medCenterId, { attributes: ['name'] })
    : null;

  // Ссылки в рабочие чаты — то, ради чего это письмо и читают. Пустой список
  // бывает штатно (чаты для этой должности в этом филиале ещё не завели), и
  // письмо тогда уходит без блока со ссылками: оно остаётся единственным
  // сообщением о том, что всё готово, и гасить его целиком нельзя.
  let chats = [];
  try {
    chats = await chatLinks.forApplication(app);
  } catch (error) {
    console.error('[vacancies] Список чатов не собрался:', error.message);
  }

  const welcome = await mailer.sendWelcome(template, app, mc?.name, chats);
  await log(app.id, 'launched', {
    mail: welcome.success, chats: chats.length, reason: welcome.reason || null
  });

  const participants = [...new Set(tasks.flatMap(t => [t.completedBy, t.claimedBy]).filter(Boolean))];
  await notify(participants,
    `✅ ${app.fullName || 'Заявка без имени'} — всё закрыто, человек выходит на работу.`,
    { type: 'vacancy_launched', applicationId: app.id });

  return true;
}

module.exports = {
  log,
  notify,
  signalChanged,
  processOf,
  decisionStep,
  openTask,
  openReady,
  onSubmitted,
  approve,
  sendToRevision,
  reject,
  cancel,
  onServicesPicked,
  completeTask,
  verifyStep,
  tryLaunch
};
