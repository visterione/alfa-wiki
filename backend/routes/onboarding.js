'use strict';

/**
 * Внутренний API онбординга врача.
 *
 * Маршруты только проверяют право и зовут движок: всё, что меняет состояние
 * заявки, живёт в services/onboarding/engine.js. Одно и то же событие приходит
 * из трёх мест — от сотрудника, от врача по публичной ссылке и от крона, — и
 * три копии логики разошлись бы на первой правке.
 */

const express = require('express');
const multer = require('multer');
const { Op, Sequelize } = require('sequelize');

const router = express.Router();

const {
  OnbApplication, OnbTask, OnbAssignment, OnbServiceChoice, OnbFile, OnbEvent,
  OnbChatLink, User, MedCenter
} = require('../models');
const { authenticate } = require('../middleware/auth');
const proc = require('../services/onboarding/process');
const access = require('../services/onboarding/access');
const assignments = require('../services/onboarding/assignments');
const projection = require('../services/onboarding/projection');
const formSchema = require('../services/onboarding/formSchema');
const engine = require('../services/onboarding/engine');
const misVerify = require('../services/onboarding/misVerify');
const sla = require('../services/onboarding/sla');
const links = require('../services/onboarding/links');
const cvPdf = require('../services/onboarding/cvPdf');
const mailer = require('../services/onboarding/mailer');
const chatLinks = require('../services/onboarding/chatLinks');
const fileAccess = require('../services/fileAccess');

const USER_FIELDS = ['id', 'displayName', 'username', 'avatar', 'position', 'isActive'];

/** Доступ к разделу плюс посчитанные полномочия — нужны почти каждому маршруту. */
async function withAccess(req, res, next) {
  try {
    const acl = await access.resolve(req.user);
    if (!acl.allowed) return res.status(403).json({ error: 'Нет доступа к разделу' });
    req.acl = acl;
    next();
  } catch (error) {
    console.error('[onboarding] access:', error);
    res.status(500).json({ error: 'Не удалось проверить доступ' });
  }
}

router.use(authenticate, withAccess);

// ── Что показать при входе ────────────────────────────────────────────────

router.get('/overview', async (req, res) => {
  try {
    const where = access.scopeWhere(req.acl);
    const apps = await OnbApplication.findAll({
      where, attributes: ['id', 'status'], raw: true
    });

    const byStatus = {};
    for (const app of apps) byStatus[app.status] = (byStatus[app.status] || 0) + 1;

    const myTasks = await access.myTasks(req.user);
    const now = new Date();

    res.json({
      byStatus,
      total: apps.length,
      myTasksCount: myTasks.length,
      myOverdueCount: myTasks.filter(t => t.dueAt && t.dueAt < now).length,
      canConfigure: access.canConfigure(req.user)
    });
  } catch (error) {
    console.error('[onboarding] overview:', error);
    res.status(500).json({ error: 'Не удалось загрузить сводку' });
  }
});

/**
 * Материалы для рассылки: постоянная ссылка на анкету и QR к ней.
 *
 * Доступны всем, у кого есть раздел, а не только администратору: ссылку
 * рассылает тот, кто ищет врача, и ходить за ней к админу незачем.
 */
router.get('/materials', async (req, res) => {
  try {
    res.json(await links.anketaMaterials());
  } catch (error) {
    console.error('[onboarding] materials:', error);
    res.status(500).json({ error: 'Не удалось собрать материалы' });
  }
});

/**
 * Отправить кандидату приглашение с ссылкой на анкету.
 *
 * Письмо не создаёт заявку и ничего не резервирует: ссылка постоянная и одна на
 * всех, заявка появится, когда врач подтвердит адрес и начнёт заполнять. Это
 * просто способ не копировать адрес в мессенджер руками.
 */
router.post('/materials/invite', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Укажите корректный адрес электронной почты' });
  }

  try {
    const sent = await mailer.sendAnketaInvite(email, {
      fromName: req.user.displayName || req.user.username,
      note: String(req.body?.note || '').trim().slice(0, 500) || null
    });
    if (!sent.success) {
      return res.status(502).json({ error: 'Письмо не ушло. Проверьте адрес и повторите позже' });
    }
    res.json({ ok: true, email });
  } catch (error) {
    console.error('[onboarding] invite:', error);
    res.status(500).json({ error: 'Не удалось отправить приглашение' });
  }
});

// ── Настройки: кто отвечает за шаг ────────────────────────────────────────

router.get('/settings', async (req, res) => {
  if (!access.canConfigure(req.user)) return res.status(403).json({ error: 'Только для администратора' });

  try {
    const [rows, centers, users] = await Promise.all([
      OnbAssignment.findAll({
        include: [{ model: User, as: 'user', attributes: USER_FIELDS }],
        order: [['stepKey', 'ASC']]
      }),
      // Только настоящие работающие филиалы: «АУП», «Направители» и прочие
      // служебные группировки помечены в справочнике isVirtual — врача туда не
      // нанимают, и в списке исполнителей они лишние. Тот же фильтр стоит в
      // публичной анкете (routes/public/v1/onboarding.js).
      MedCenter.findAll({
        where: { isActive: true, isVirtual: false },
        attributes: ['id', 'name'],
        order: [['sortOrder', 'ASC'], ['name', 'ASC']]
      }),
      // В выборе исполнителя — только те, у кого есть доступ к разделу. Назначить
      // человека, который раздел не откроет, значит поставить задачу, которую он
      // никогда не увидит: она просто протухнет по сроку. Полный список
      // сотрудников здесь ещё и бесполезно длинный — в онбординге участвует
      // десяток человек на всю сеть.
      User.findAll({
        where: {
          isActive: true,
          [Op.or]: [
            { isAdmin: true },
            Sequelize.literal(`"adminAccess"->>'onboarding' = 'true'`)
          ]
        },
        attributes: USER_FIELDS,
        order: [['displayName', 'ASC']]
      })
    ]);

    res.json({
      steps: assignments.configurableSteps(),
      medCenters: centers,
      users,
      assignments: rows.map(r => ({
        id: r.id, stepKey: r.stepKey, medCenterId: r.medCenterId, userId: r.userId, user: r.user
      }))
    });
  } catch (error) {
    console.error('[onboarding] settings:', error);
    res.status(500).json({ error: 'Не удалось загрузить настройки' });
  }
});

/**
 * Полная замена состава исполнителей шага в филиале. Именно замена, а не
 * добавление: экран настроек показывает список целиком, и «сохранить» должно
 * означать «стало так», иначе снятый человек останется назначенным.
 */
router.put('/settings/:stepKey', async (req, res) => {
  if (!access.canConfigure(req.user)) return res.status(403).json({ error: 'Только для администратора' });

  const { stepKey } = req.params;
  const known = assignments.configurableSteps().some(s => s.key === stepKey);
  if (!known) return res.status(400).json({ error: 'Неизвестный шаг' });

  const medCenterId = req.body?.medCenterId || null;
  const userIds = Array.isArray(req.body?.userIds) ? [...new Set(req.body.userIds)] : [];

  try {
    await OnbAssignment.destroy({ where: { stepKey, medCenterId } });
    if (userIds.length) {
      await OnbAssignment.bulkCreate(userIds.map(userId => ({ stepKey, medCenterId, userId })));
    }

    // Настройка должна действовать и на уже открытые задачи, а не только на
    // следующих врачей. Пересчитываем эффективных исполнителей с учётом
    // филиального приоритета над сетевым назначением.
    const openTasks = await OnbTask.findAll({
      where: { stepKey, completedAt: null },
      include: [{ model: OnbApplication, as: 'application', attributes: ['id', 'medCenterId'] }]
    });
    const affectedUsers = new Set();
    for (const task of openTasks) {
      if (!task.application) continue;
      (task.assigneeIds || []).forEach(id => affectedUsers.add(id));
      const effectiveIds = await assignments.resolveAssignees(stepKey, task.application.medCenterId);
      effectiveIds.forEach(id => affectedUsers.add(id));
      const claimStillValid = !task.claimedBy || effectiveIds.includes(task.claimedBy);
      await task.update({
        assigneeIds: effectiveIds,
        ...(claimStillValid ? {} : { claimedBy: null, claimedAt: null })
      });
    }
    engine.signalChanged([...affectedUsers], { reason: 'assignments_changed', stepKey });

    res.json({ ok: true, stepKey, medCenterId, userIds });
  } catch (error) {
    console.error('[onboarding] save settings:', error);
    res.status(500).json({ error: 'Не удалось сохранить назначения' });
  }
});

/** Назначения, которые не сработают: человек выбыл или лишился доступа к разделу. */
router.get('/settings/broken', async (req, res) => {
  if (!access.canConfigure(req.user)) return res.status(403).json({ error: 'Только для администратора' });
  res.json(await assignments.brokenAssignees());
});

// ── Настройки: рабочие чаты филиала ───────────────────────────────────────
//
// Аватарка принимается в память, а не на диск: на диск её всё равно пишет sharp
// после приведения к общему размеру, и промежуточный файл пришлось бы убирать.
const chatAvatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Нужна картинка'));
    cb(null, true);
  }
});

// Отказ загрузчика — это ответ человеку, а не пятисотка: он выбрал не тот файл
// и должен прочитать, какой нужен.
function receiveAvatar(req, res, next) {
  chatAvatarUpload.single('avatar')(req, res, (error) => {
    if (!error) return next();
    res.status(400).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? 'Картинка больше 8 МБ' : error.message
    });
  });
}
//
// Ссылки, которые уходят врачу письмом после закрытия последнего шага. Раньше
// их кидали руками, и врач регулярно оказывался не в том чате.

/** Только администратор: список видят все филиалы, и это настройка сети. */
function requireAdmin(req, res, next) {
  if (!access.canConfigure(req.user)) return res.status(403).json({ error: 'Только для администратора' });
  next();
}

router.get('/settings/chats', requireAdmin, async (req, res) => {
  try {
    const [rows, centers] = await Promise.all([
      OnbChatLink.findAll({ order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] }),
      MedCenter.findAll({
        where: { isActive: true, isVirtual: false },
        attributes: ['id', 'name'],
        order: [['sortOrder', 'ASC'], ['name', 'ASC']]
      })
    ]);
    res.json({ chats: rows.map(chatLinks.toJson), medCenters: centers });
  } catch (error) {
    console.error('[onboarding] chats:', error);
    res.status(500).json({ error: 'Не удалось загрузить список чатов' });
  }
});

/**
 * Превью по ссылке — до сохранения. Администратор вставляет приглашение и сразу
 * видит, что за чат он добавляет: у приватных ссылок вида «t.me/+AbCdEf» по
 * самой ссылке этого не понять, а ошибиться чатом здесь дороже всего.
 */
router.post('/settings/chats/preview', requireAdmin, async (req, res) => {
  try {
    res.json(await chatLinks.fetchPreview(req.body?.url));
  } catch (error) {
    console.error('[onboarding] chat preview:', error);
    res.status(500).json({ error: 'Не удалось прочитать страницу чата' });
  }
});

router.post('/settings/chats', requireAdmin, async (req, res) => {
  const check = chatLinks.normalizeUrl(req.body?.url);
  if (!check.ok) return res.status(400).json({ error: check.error });

  try {
    // Один и тот же чат дважды в одном письме — то, ради чего этот список и
    // заводили: раньше врачу присылали по две ссылки на одну группу.
    const duplicate = await OnbChatLink.findOne({
      where: { url: check.url, medCenterId: req.body?.medCenterId || null }
    });
    if (duplicate) return res.status(409).json({ error: 'Этот чат уже в списке' });

    // Название и аватарку тянем сами, но не блокируем сохранение, если чат
    // закрыт и превью не отдал ничего: администратор подпишет строку руками, а
    // обновить превью можно потом.
    const preview = await chatLinks.fetchPreview(check.url);
    const title = String(req.body?.title || '').trim() || preview.title || 'Рабочий чат';
    const avatarPath = await chatLinks.storeAvatar(preview);

    const link = await OnbChatLink.create({
      medCenterId: req.body?.medCenterId || null,
      url: check.url,
      title: title.slice(0, 255),
      subtitle: String(req.body?.subtitle || '').trim().slice(0, 255) || null,
      avatarPath,
      sortOrder: Number(req.body?.sortOrder) || 0,
      fetchedAt: new Date(),
      fetchError: preview.ok ? null : preview.error
    });

    res.status(201).json(chatLinks.toJson(link));
  } catch (error) {
    console.error('[onboarding] chat create:', error);
    res.status(500).json({ error: 'Не удалось добавить чат' });
  }
});

router.put('/settings/chats/:id', requireAdmin, async (req, res) => {
  try {
    const link = await OnbChatLink.findByPk(req.params.id);
    if (!link) return res.status(404).json({ error: 'Чат не найден' });

    const patch = {};
    if (req.body?.url !== undefined) {
      const check = chatLinks.normalizeUrl(req.body.url);
      if (!check.ok) return res.status(400).json({ error: check.error });
      patch.url = check.url;
    }
    if (req.body?.title !== undefined) {
      const title = String(req.body.title).trim();
      if (!title) return res.status(400).json({ error: 'Название нужно: врач увидит его в письме' });
      patch.title = title.slice(0, 255);
    }
    if (req.body?.subtitle !== undefined) {
      patch.subtitle = String(req.body.subtitle).trim().slice(0, 255) || null;
    }
    if (req.body?.medCenterId !== undefined) patch.medCenterId = req.body.medCenterId || null;
    if (req.body?.sortOrder !== undefined) patch.sortOrder = Number(req.body.sortOrder) || 0;
    if (req.body?.isActive !== undefined) patch.isActive = Boolean(req.body.isActive);

    await link.update(patch);

    // Смена адреса — это другой чат, и старое превью к нему уже не относится:
    // перечитываем вместе с названием. Исключение — когда название пришло в
    // том же запросе: значит, его только что написали руками.
    if (patch.url) await chatLinks.refresh(link, { keepTitle: patch.title !== undefined });

    res.json(chatLinks.toJson(link));
  } catch (error) {
    console.error('[onboarding] chat update:', error);
    res.status(500).json({ error: 'Не удалось сохранить чат' });
  }
});

/**
 * Перечитать превью. Отдельной кнопкой, а не по расписанию: чат переименовывают
 * раз в год, а инвайт-ссылка либо живёт, либо протухла — и то, и другое видно
 * прямо здесь, до того как письмо уйдёт врачу.
 */
router.post('/settings/chats/:id/refresh', requireAdmin, async (req, res) => {
  try {
    const link = await OnbChatLink.findByPk(req.params.id);
    if (!link) return res.status(404).json({ error: 'Чат не найден' });
    await chatLinks.refresh(link, { keepTitle: req.body?.keepTitle !== false });
    res.json(chatLinks.toJson(link));
  } catch (error) {
    console.error('[onboarding] chat refresh:', error);
    res.status(500).json({ error: 'Не удалось обновить превью' });
  }
});

/**
 * Аватарка файлом.
 *
 * Нужна там, где превью бесполезно: WhatsApp og-теги не отдаёт вовсе, а MAX и
 * VK отдают описание самого приложения, а не группы. Кружок с буквой письмо не
 * ломает, но чат с фотографией узнают, а с буквой — читают.
 */
router.post('/settings/chats/:id/avatar', requireAdmin, receiveAvatar, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не пришёл' });

  try {
    const link = await OnbChatLink.findByPk(req.params.id);
    if (!link) return res.status(404).json({ error: 'Чат не найден' });

    const filename = await chatLinks.saveAvatar(req.file.buffer);
    chatLinks.removeAvatar(link.avatarPath);
    await link.update({ avatarPath: filename });

    res.json(chatLinks.toJson(link));
  } catch (error) {
    console.error('[onboarding] chat avatar:', error);
    res.status(500).json({ error: 'Не удалось сохранить картинку' });
  }
});

router.delete('/settings/chats/:id', requireAdmin, async (req, res) => {
  try {
    const link = await OnbChatLink.findByPk(req.params.id);
    if (!link) return res.status(404).json({ error: 'Чат не найден' });
    chatLinks.removeAvatar(link.avatarPath);
    await link.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('[onboarding] chat delete:', error);
    res.status(500).json({ error: 'Не удалось удалить чат' });
  }
});

/**
 * Пробное письмо себе — ровно то, что получит врач этого филиала.
 *
 * Иначе проверить вёрстку нечем: письмо уходит один раз, в момент запуска
 * врача, и «посмотрим на живой заявке» здесь означает «отправим человеку
 * кривое письмо».
 */
router.post('/settings/chats/test', requireAdmin, async (req, res) => {
  const email = String(req.user.email || '').trim();
  if (!email) return res.status(400).json({ error: 'В вашем профиле не указана почта' });

  try {
    const medCenterId = req.body?.medCenterId || null;
    const chats = await chatLinks.forMedCenter(medCenterId);
    const mc = medCenterId ? await MedCenter.findByPk(medCenterId, { attributes: ['name'] }) : null;

    const sent = await mailer.sendWelcome({ email }, mc?.name, chats);
    if (!sent.success) {
      return res.status(502).json({ error: 'Письмо не ушло. Проверьте настройки SMTP' });
    }
    res.json({ ok: true, email, chats: chats.length });
  } catch (error) {
    console.error('[onboarding] chat test mail:', error);
    res.status(500).json({ error: 'Не удалось отправить пробное письмо' });
  }
});

// ── Список заявок ─────────────────────────────────────────────────────────

router.get('/applications', async (req, res) => {
  try {
    const where = { ...access.scopeWhere(req.acl) };

    if (req.query.status) where.status = String(req.query.status).split(',');
    if (req.query.medCenterId) where.medCenterId = String(req.query.medCenterId);
    if (req.query.archived !== 'true') {
      where.status = where.status || { [Op.notIn]: [proc.STATUS.REJECTED, proc.STATUS.CANCELLED] };
    }
    if (req.query.q) {
      where.fullName = { [Op.iLike]: `%${String(req.query.q).trim()}%` };
    }

    const apps = await OnbApplication.findAll({
      where,
      include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }],
      order: [['createdAt', 'DESC']],
      limit: Math.min(Number(req.query.limit) || 200, 500)
    });

    const tasks = await OnbTask.findAll({
      where: { applicationId: { [Op.in]: apps.map(a => a.id) } },
      raw: true
    });
    const tasksByApp = new Map();
    for (const task of tasks) {
      if (!tasksByApp.has(task.applicationId)) tasksByApp.set(task.applicationId, []);
      tasksByApp.get(task.applicationId).push(task);
    }

    const now = new Date();
    res.json(apps.map(app => {
      const appTasks = tasksByApp.get(app.id) || [];
      return {
        id: app.id,
        fullName: app.fullName,
        professions: app.professions || [],
        medCenter: app.medCenter,
        status: app.status,
        stage: proc.stageOf(app, appTasks),
        startDate: app.startDate,
        createdAt: app.createdAt,
        checklist: proc.checklistOf(appTasks),
        // Просрочка считается по задачам: у заявки как таковой срока нет.
        overdue: appTasks.some(t => !t.completedAt && t.dueAt && new Date(t.dueAt) < now)
      };
    }));
  } catch (error) {
    console.error('[onboarding] applications:', error);
    res.status(500).json({ error: 'Не удалось загрузить заявки' });
  }
});

/** Загружает заявку и проверяет, что она в области видимости этого человека. */
async function loadApplication(req, res, next) {
  try {
    const app = await OnbApplication.findByPk(req.params.id, {
      include: [{ model: MedCenter, as: 'medCenter', attributes: ['id', 'name'] }]
    });
    if (!app) return res.status(404).json({ error: 'Заявка не найдена' });

    const viewKey = access.viewKeyFor(req.acl, app);
    if (!viewKey) return res.status(403).json({ error: 'Заявка вне вашей зоны' });

    req.application = app;
    req.viewKey = viewKey;
    next();
  } catch (error) {
    console.error('[onboarding] loadApplication:', error);
    res.status(500).json({ error: 'Не удалось открыть заявку' });
  }
}

router.get('/applications/:id', loadApplication, async (req, res) => {
  const app = req.application;
  try {
    const [tasks, appFiles, events] = await Promise.all([
      OnbTask.findAll({
        where: { applicationId: app.id },
        include: [
          { model: User, as: 'claimer', attributes: USER_FIELDS },
          { model: User, as: 'completer', attributes: USER_FIELDS }
        ]
      }),
      OnbFile.findAll({ where: { applicationId: app.id } }),
      OnbEvent.findAll({
        where: { applicationId: app.id },
        include: [{ model: User, as: 'author', attributes: USER_FIELDS }],
        order: [['createdAt', 'DESC']],
        limit: 200
      })
    ]);

    // Сканы документов видит только тот, кто согласовывает допуск.
    const visibleFiles = projection.canSeeDocuments(req.viewKey)
      ? appFiles
      : appFiles.filter(f => f.kind === 'photo');

    const now = new Date();
    res.json({
      application: projection.project(app, req.viewKey, visibleFiles),
      // Подписи полей — из той же схемы, по которой рисуется анкета: иначе в
      // карточке стояли бы «fullName» и «experienceSpecialty».
      labels: formSchema.labelMap(),
      // Разделы документа-карточки врача — из той же схемы, что и форма.
      sections: formSchema.sections(),
      medCenter: app.medCenter,
      stage: proc.stageOf(app, tasks),
      timeline: proc.timeline(app, tasks),
      statusLabel: proc.STATUS_LABELS[app.status] || app.status,
      checklist: proc.checklistOf(tasks),
      tasks: tasks.map(task => {
        const step = proc.getStep(task.stepKey);
        return {
          id: task.id,
          stepKey: task.stepKey,
          title: step?.title || (task.stepKey === proc.DOCTOR_STEP ? 'Врач выбирает услуги' : task.stepKey),
          verify: step?.verify || 'manual',
          assigneeIds: task.assigneeIds || [],
          requiresClaim: proc.requiresClaim(task),
          mine: (task.assigneeIds || []).includes(req.user.id)
            && (!task.claimedBy || task.claimedBy === req.user.id),
          claimedBy: task.claimedBy,
          claimer: task.claimer,
          completedAt: task.completedAt,
          completer: task.completer,
          verifiedByMis: task.verifiedByMis,
          dueAt: task.dueAt,
          overdue: !task.completedAt && task.dueAt && new Date(task.dueAt) < now,
          note: task.note
        };
      }),
      permissions: {
        canDecide: access.canDecide(req.acl, app) && app.status === proc.STATUS.SUBMITTED,
        canManage: access.canManage(req.acl, app),
        canSeeDocuments: projection.canSeeDocuments(req.viewKey)
      },
      // Токен для просмотра файлов: заголовок Authorization в <img src> не
      // подставить, поэтому право предъявляется подписанным токеном в query.
      fileToken: projection.canSeeDocuments(req.viewKey) || visibleFiles.length
        ? fileAccess.issueToken(req.user.id)
        : null,
      events: events.map(e => ({
        id: e.id, action: e.action, payload: e.payload,
        author: e.author, createdAt: e.createdAt
      }))
    });
  } catch (error) {
    console.error('[onboarding] application card:', error);
    res.status(500).json({ error: 'Не удалось открыть заявку' });
  }
});

// ── Решение главврача ─────────────────────────────────────────────────────

function requireDecider(req, res, next) {
  if (!access.canDecide(req.acl, req.application)) {
    return res.status(403).json({ error: 'Решение по анкете принимает главврач филиала' });
  }
  if (req.application.status !== proc.STATUS.SUBMITTED) {
    return res.status(409).json({ error: 'Анкета не на согласовании' });
  }
  next();
}

router.post('/applications/:id/approve', loadApplication, requireDecider, async (req, res) => {
  try {
    await engine.approve(req.application, req.user);
    res.json({ ok: true, status: req.application.status });
  } catch (error) {
    console.error('[onboarding] approve:', error);
    res.status(500).json({ error: 'Не удалось согласовать' });
  }
});

router.post('/applications/:id/revision', loadApplication, requireDecider, async (req, res) => {
  const note = String(req.body?.note || '').trim();
  if (!note) return res.status(400).json({ error: 'Напишите, что нужно поправить' });

  const fields = Array.isArray(req.body?.fields) ? req.body.fields.slice(0, 50).map(String) : [];
  try {
    await engine.sendToRevision(req.application, req.user, note, fields);
    res.json({ ok: true, status: req.application.status });
  } catch (error) {
    console.error('[onboarding] revision:', error);
    res.status(500).json({ error: 'Не удалось вернуть на доработку' });
  }
});

router.post('/applications/:id/reject', loadApplication, requireDecider, async (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Укажите причину отклонения' });

  try {
    await engine.reject(req.application, req.user, reason);
    res.json({ ok: true, status: req.application.status });
  } catch (error) {
    console.error('[onboarding] reject:', error);
    res.status(500).json({ error: 'Не удалось отклонить' });
  }
});

// ── Управление заявкой ────────────────────────────────────────────────────

router.post('/applications/:id/cancel', loadApplication, async (req, res) => {
  if (!access.canManage(req.acl, req.application)) {
    return res.status(403).json({ error: 'Отменить процесс может главврач филиала или администратор' });
  }
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Укажите причину отмены' });

  try {
    await engine.cancel(req.application, req.user, reason);
    res.json({ ok: true, status: req.application.status });
  } catch (error) {
    console.error('[onboarding] cancel:', error);
    res.status(500).json({ error: 'Не удалось отменить процесс' });
  }
});

/**
 * Смена филиала. Врач выбирает его сам в публичной форме, и ошибка здесь —
 * вопрос времени: от филиала зависят все исполнители заявки.
 */
router.put('/applications/:id/med-center', loadApplication, async (req, res) => {
  if (!access.canManage(req.acl, req.application)) {
    return res.status(403).json({ error: 'Менять филиал может главврач или администратор' });
  }
  const medCenterId = String(req.body?.medCenterId || '');
  const mc = await MedCenter.findByPk(medCenterId, { attributes: ['id'] });
  if (!mc) return res.status(400).json({ error: 'Филиал не найден' });

  try {
    await engine.changeMedCenter(req.application, req.user, mc.id);
    res.json({ ok: true });
  } catch (error) {
    console.error('[onboarding] change med center:', error);
    res.status(500).json({ error: 'Не удалось сменить филиал' });
  }
});

// ── Задачи ────────────────────────────────────────────────────────────────

router.get('/tasks/my', async (req, res) => {
  try {
    const tasks = await access.myTasks(req.user);
    const now = new Date();

    const result = [];
    for (const task of tasks) {
      const step = proc.getStep(task.stepKey);
      const app = task.application;
      result.push({
        id: task.id,
        applicationId: app.id,
        fullName: app.fullName,
        professions: app.professions || [],
        stepKey: task.stepKey,
        title: step?.title || task.stepKey,
        requiresClaim: proc.requiresClaim(task),
        claimedBy: task.claimedBy,
        dueAt: task.dueAt,
        overdue: task.dueAt ? task.dueAt < now : false,
        overdueHours: task.dueAt && task.dueAt < now
          ? await sla.overdueWorkingHours(task.dueAt, now)
          : 0
      });
    }
    res.json(result);
  } catch (error) {
    console.error('[onboarding] my tasks:', error);
    res.status(500).json({ error: 'Не удалось загрузить задачи' });
  }
});

async function loadTask(req, res, next) {
  try {
    const task = await OnbTask.findByPk(req.params.taskId, {
      include: [{ model: OnbApplication, as: 'application' }]
    });
    if (!task) return res.status(404).json({ error: 'Задача не найдена' });

    const isAssignee = (task.assigneeIds || []).includes(req.user.id);
    if (!isAssignee && !req.acl.isAdmin) {
      return res.status(403).json({ error: 'Задача назначена не вам' });
    }
    req.task = task;
    req.application = task.application;
    next();
  } catch (error) {
    console.error('[onboarding] loadTask:', error);
    res.status(500).json({ error: 'Не удалось открыть задачу' });
  }
}

/**
 * Взять общую задачу. После этого она пропадает у остальных, а в карточке
 * навсегда остаётся, кто именно её выполнил — ровно чтобы не было ситуации
 * «думали, сделал другой».
 */
router.post('/tasks/:taskId/claim', loadTask, async (req, res) => {
  const task = req.task;
  if (task.completedAt) return res.status(409).json({ error: 'Задача уже закрыта' });
  if (!proc.requiresClaim(task)) {
    return res.status(409).json({ error: 'У этой задачи один исполнитель, брать её отдельно не нужно' });
  }

  // Условный UPDATE не даёт двум одновременным кликам перезаписать друг друга:
  // победит только тот запрос, который первым увидел claimedBy = NULL.
  const [claimed] = await OnbTask.update(
    { claimedBy: req.user.id, claimedAt: new Date() },
    {
      where: {
        id: task.id,
        completedAt: null,
        [Op.or]: [{ claimedBy: null }, { claimedBy: req.user.id }]
      }
    }
  );
  if (!claimed) {
    return res.status(409).json({ error: 'Задачу уже взял другой сотрудник' });
  }

  await engine.log(task.applicationId, 'task_claimed', { stepKey: task.stepKey }, req.user.id);
  engine.signalChanged(task.assigneeIds, {
    reason: 'task_claimed', applicationId: task.applicationId, stepKey: task.stepKey
  });
  res.json({ ok: true });
});

/** Проверить шаг в МИС, не закрывая задачу. */
router.post('/tasks/:taskId/verify', loadTask, async (req, res) => {
  if (proc.requiresClaim(req.task) && req.task.claimedBy !== req.user.id) {
    return res.status(409).json({ error: req.task.claimedBy ? 'Задачу взял другой сотрудник' : 'Сначала возьмите задачу в работу' });
  }
  try {
    const result = await engine.verifyStep(req.application, req.task.stepKey, req.body?.misUserId);
    res.json(result);
  } catch (error) {
    console.error('[onboarding] verify:', error);
    res.status(500).json({ error: 'Не удалось проверить в МИС' });
  }
});

router.post('/tasks/:taskId/complete', loadTask, async (req, res) => {
  const task = req.task;
  if (task.completedAt) return res.status(409).json({ error: 'Задача уже закрыта' });

  if (proc.requiresClaim(task) && task.claimedBy !== req.user.id) {
    return res.status(409).json({ error: task.claimedBy ? 'Задачу взял другой сотрудник' : 'Сначала возьмите задачу в работу' });
  }

  try {
    const result = await engine.completeTask(req.application, task, req.user, {
      note: req.body?.note,
      misUserId: req.body?.misUserId
    });
    if (!result.ok) return res.status(422).json(result);
    res.json({ ok: true });
  } catch (error) {
    console.error('[onboarding] complete:', error);
    res.status(500).json({ error: 'Не удалось закрыть задачу' });
  }
});

// ── Услуги и выгрузка ─────────────────────────────────────────────────────

/**
 * Что врач отметил — для бухгалтера. Отдельными блоками идут расхождения и
 * позиции, вписанные текстом: их немного, и разбирать нужно только их.
 */
router.get('/applications/:id/services', loadApplication, async (req, res) => {
  try {
    const choices = await OnbServiceChoice.findAll({
      where: { applicationId: req.application.id },
      order: [['isCustom', 'ASC'], ['title', 'ASC']]
    });

    const regular = choices.filter(c => !c.isCustom);
    res.json({
      total: regular.length,
      services: regular.map(serialiseChoice),
      // Врач поменял длительность или оставил комментарий — только это и нужно
      // разбирать глазами.
      differences: regular
        .filter(c => (c.doctorDuration && c.doctorDuration !== c.misDuration) || c.comment)
        .map(serialiseChoice),
      custom: choices.filter(c => c.isCustom).map(serialiseChoice)
    });
  } catch (error) {
    console.error('[onboarding] services:', error);
    res.status(500).json({ error: 'Не удалось загрузить услуги' });
  }
});

function serialiseChoice(choice) {
  return {
    id: choice.id,
    serviceId: choice.serviceId,
    code: choice.code,
    title: choice.title,
    price: choice.price != null ? Number(choice.price) : null,
    misDuration: choice.misDuration,
    doctorDuration: choice.doctorDuration,
    comment: choice.comment,
    isCustom: choice.isCustom
  };
}

/**
 * Анкета файлом.
 *
 * Собирается на сервере, а не печатью из браузера: в файл попадает тот же срез,
 * что и в карточку, — маркетолог не выгрузит СНИЛС, даже открыв ссылку
 * напрямую. И у файла осмысленное имя, а печать давала «Альфа Вики.pdf».
 */
router.get('/applications/:id/cv.pdf', loadApplication, async (req, res) => {
  try {
    const app = req.application;
    const files = await OnbFile.findAll({ where: { applicationId: app.id } });
    const visible = projection.canSeeDocuments(req.viewKey)
      ? files
      : files.filter(f => f.kind === 'photo');

    const projected = projection.project(app, req.viewKey, visible);

    res.setHeader('Content-Type', 'application/pdf');
    // filename* с UTF-8: без него кириллица в имени превращается в вопросы.
    const name = encodeURIComponent(cvPdf.fileName(app));
    res.setHeader('Content-Disposition', `attachment; filename="cv.pdf"; filename*=UTF-8''${name}`);

    const doc = cvPdf.buildCv(app, projected, app.medCenter);
    doc.pipe(res);
    doc.end();
  } catch (error) {
    console.error('[onboarding] cv.pdf:', error);
    res.status(500).json({ error: 'Не удалось собрать файл' });
  }
});

/**
 * Список услуг файлом — распечатать и вносить по листку.
 *
 * Тем же порядком, что анкета: собирает сервер, имя файла осмысленное.
 */
router.get('/applications/:id/services.pdf', loadApplication, async (req, res) => {
  try {
    const app = req.application;
    const choices = await OnbServiceChoice.findAll({
      where: { applicationId: app.id },
      order: [['isCustom', 'ASC'], ['title', 'ASC']]
    });

    res.setHeader('Content-Type', 'application/pdf');
    const name = encodeURIComponent(cvPdf.servicesFileName(app));
    res.setHeader('Content-Disposition', `attachment; filename="services.pdf"; filename*=UTF-8''${name}`);

    const doc = cvPdf.buildServices(app, choices, app.medCenter);
    doc.pipe(res);
    doc.end();
  } catch (error) {
    console.error('[onboarding] services.pdf:', error);
    res.status(500).json({ error: 'Не удалось собрать файл' });
  }
});

/**
 * Сотрудники филиала из МИС — для ручного выбора, когда сверка по ФИО не нашла
 * врача. Иначе шаг «создать учётку» становится тупиком: задача открыта, МИС
 * говорит «нет такого», и сделать с этим нечего.
 */
router.get('/applications/:id/mis-users', loadApplication, async (req, res) => {
  try {
    const result = await misVerify.searchDoctors(req.application, String(req.query.q || ''));
    if (!result.ok) return res.status(502).json({ error: result.reason });
    res.json(result.users);
  } catch (error) {
    console.error('[onboarding] mis-users:', error);
    res.status(500).json({ error: 'Не удалось получить список сотрудников МИС' });
  }
});

/** Выгрузка карточки врача из МИС — то, ради чего существует шаг колл-центра. */
router.get('/applications/:id/export', loadApplication, async (req, res) => {
  try {
    const result = await misVerify.doctorExport(req.application);
    if (!result.ok) return res.status(502).json({ error: result.reason });
    res.json(result);
  } catch (error) {
    console.error('[onboarding] export:', error);
    res.status(500).json({ error: 'Не удалось выгрузить данные из МИС' });
  }
});

module.exports = router;
