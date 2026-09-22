const express = require('express');
const { randomUUID } = require('crypto');
const { body, validationResult } = require('express-validator');
const { EmailTemplate, EmailLog, EmailOptOut, EmailModule, EmailFavoriteRecipient, EmailFavoriteTemplate, User, Role } = require('../models');
const { authenticate, requireMarketing } = require('../middleware/auth');
const { sendBulkEmail } = require('../services/emailService');
const emailRenderer = require('../services/emailRenderer');
const emailIcons = require('../services/emailIconImage');
const darkMode = require('../services/emailDarkMode');
const quota = require('../services/emailQuota');
const optout = require('../services/emailOptout');
const { Op } = require('sequelize');
const multer = require('multer');
const XLSX = require('xlsx-js-style');
const { parsePagination } = require('../utils/pagination');

const router = express.Router();
// Права переехали в модуль «Маркетинг» (ver. 8.22) и разделились на чтение и
// правку: историю рассылок полезно видеть шире круга тех, кто их запускает.
const requireAnnouncements = requireMarketing('announcements', 'read');
const requireAnnouncementsEdit = requireMarketing('announcements', 'edit');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
// Картинкам потолок выше: снимок с телефона легко весит 15 МБ, а до письма он
// всё равно доедет ужатым до 1200px. Отказывать на входе из-за исходного веса
// значило бы просить маркетолога сначала сжать файл где-то ещё.
const uploadImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// In-memory store для активных задач рассылки
const sendJobs = new Map();

// Чистим завершённые задачи старше 1 часа
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [id, job] of sendJobs) {
    if (job.startedAt < cutoff) sendJobs.delete(id);
  }
}, 600_000);

// === EMAIL TEMPLATES ===

// GET /api/email/templates - Получить все шаблоны
router.get('/templates', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const templates = await EmailTemplate.findAll({
      where: {
        [Op.or]: [
          { isPublic: true },
          { createdBy: req.user.id }
        ]
      },
      include: [{ model: User, as: 'creator', attributes: ['id', 'displayName', 'username'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(templates);
  } catch (error) {
    console.error('❌ Error fetching templates:', error);
    res.status(500).json({ error: 'Ошибка загрузки шаблонов' });
  }
});

// POST /api/email/templates - Создать шаблон
router.post('/templates', authenticate, requireAnnouncementsEdit, [
  body('name').trim().notEmpty().withMessage('Название обязательно'),
  body('subject').trim().notEmpty().withMessage('Тема обязательна')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, subject, isPublic } = req.body;
    const design = req.body.design && typeof req.body.design === 'object' ? req.body.design : null;
    if (!design && !String(req.body.htmlContent || '').trim()) {
      return res.status(400).json({ error: 'Шаблон пустой: соберите письмо в конструкторе или вставьте готовый HTML' });
    }

    // У шаблона из конструктора HTML тоже хранится — им живёт предпросмотр в
    // списке шаблонов и старые места, которые о документе ничего не знают.
    const htmlContent = design
      ? emailRenderer.render(design, { subject }).html
      : req.body.htmlContent;

    const template = await EmailTemplate.create({
      name,
      subject,
      htmlContent,
      design,
      createdBy: req.user.id,
      isPublic: isPublic !== false // По умолчанию публичный
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('❌ Error creating template:', error);
    res.status(500).json({ error: 'Ошибка создания шаблона' });
  }
});

// PUT /api/email/templates/:id - Обновить шаблон
router.put('/templates/:id', authenticate, requireAnnouncementsEdit, async (req, res) => {
  try {
    const template = await EmailTemplate.findByPk(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Шаблон не найден' });
    }

    // Только создатель может редактировать
    if (template.createdBy !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Нет прав на редактирование' });
    }

    // Документ и HTML не должны разойтись: если пришёл design, HTML
    // пересобирается из него, а присланный игнорируется.
    const patch = { ...req.body };
    if (patch.design && typeof patch.design === 'object') {
      patch.htmlContent = emailRenderer.render(patch.design, { subject: patch.subject || template.subject }).html;
    }
    await template.update(patch);
    res.json(template);
  } catch (error) {
    console.error('❌ Error updating template:', error);
    res.status(500).json({ error: 'Ошибка обновления шаблона' });
  }
});

// DELETE /api/email/templates/:id - Удалить шаблон
router.delete('/templates/:id', authenticate, requireAnnouncementsEdit, async (req, res) => {
  try {
    const template = await EmailTemplate.findByPk(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Шаблон не найден' });
    }

    if (template.createdBy !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Нет прав на удаление' });
    }

    await template.destroy();
    res.json({ message: 'Шаблон удален' });
  } catch (error) {
    console.error('❌ Error deleting template:', error);
    res.status(500).json({ error: 'Ошибка удаления шаблона' });
  }
});

// === КОНСТРУКТОР ПИСЕМ (ver. 8.43) ===

/**
 * Предпросмотр: документ конструктора → HTML.
 *
 * Рендер живёт на сервере, а не во фронтенде, ради единственного правила: у
 * письма должен быть ОДИН способ превратиться в HTML. Холст конструктора —
 * приближение на React, и расходись он с настоящим письмом, узнавали бы об этом
 * уже получатели. Поэтому предпросмотр зовёт ровно ту же функцию, что и
 * отправка, и показывает её вывод в iframe.
 *
 * Возвращает и замечания: пустой текст превью, картинки без подписи, перевес
 * письма. Они ничего не запрещают — только называют.
 */
router.post('/preview', authenticate, requireAnnouncementsEdit, async (req, res) => {
  try {
    const { design, subject = '' } = req.body;
    if (!design || typeof design !== 'object') {
      return res.status(400).json({ error: 'Нужен документ письма' });
    }
    const { html, warnings } = emailRenderer.render(design, { subject });

    // В предпросмотре адрес отписки заглушаем решёткой: настоящий ведёт на
    // страницу отписки, и нажать его из предпросмотра было бы неприятным
    // сюрпризом. Больше в письме подставлять нечего.
    const preview = emailRenderer.personalize(html, { unsubscribe_url: '#' });

    // Тёмный снимок едет тем же ответом, а не отдельным запросом, и это важно:
    // оба вида обязаны быть сделаны из ОДНОГО рендера. Пока человек правит
    // письмо, два запроса подряд легко приносят два разных его состояния, и
    // светлый с тёмным начинают расходиться на глазах.
    const previewDark = darkMode.simulate(preview);

    res.json({
      html: preview,
      htmlDark: previewDark,
      warnings,
      darkWarnings: darkMode.inspect(design),
      bytes: Buffer.byteLength(html, 'utf8'),
    });
  } catch (error) {
    console.error('❌ Error rendering email preview:', error);
    res.status(500).json({ error: 'Не удалось собрать письмо' });
  }
});

/**
 * Загрузка картинки для письма (ver. 8.43).
 *
 * Отдельный маршрут вместо общего /media/upload, и не ради каприза. Картинка в
 * письме живёт по другим правилам, чем картинка на вики-странице:
 *
 *   • Шире 1200px она не нужна никогда. Письмо 600px, на экране с двойной
 *     плотностью нужно 1200 — всё, что сверху, это вес, который получатель
 *     скачивает по мобильному интернету и не видит.
 *   • Вес важнее качества. Фотография из телефона на 6 МБ в письме — это
 *     письмо, которое не откроют: почтовые клиенты тянут картинки по очереди, и
 *     первые секунды человек смотрит на пустые рамки.
 *   • Прозрачность в письме почти всегда вредна: тёмная тема Gmail подкладывает
 *     под картинку свой фон, и логотип с альфа-каналом оказывается чёрным по
 *     чёрному. PNG с прозрачностью мы не трогаем (иначе сломаем логотипы на
 *     светлой подложке), но говорим об этом в ответе.
 *
 * Файл кладётся в общий uploads, потому что именно он публично отдаётся с 443 —
 * картинка в письме должна открываться у человека, который в портал не входил.
 */
router.post('/image', authenticate, requireAnnouncementsEdit, uploadImage.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не пришёл' });
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Это не картинка' });
    }

    const sharp = require('sharp');
    const fsp = require('fs').promises;
    const path = require('path');

    // Картинки писем лежат отдельной веткой uploads: только у неё есть право
    // отдаваться с годовым сроком жизни (см. server.js), потому что имя файла —
    // случайный UUID и содержимое по нему не меняется.
    const dir = path.join(__dirname, '..', 'uploads', 'email', new Date().toISOString().slice(0, 7));
    await fsp.mkdir(dir, { recursive: true });

    const source = sharp(req.file.buffer, { animated: true });
    const meta = await source.metadata();

    // GIF остаётся GIF: пересобрать анимацию в jpeg значит потерять её, а
    // анимированная картинка в письме — осознанный выбор маркетолога.
    const isGif = meta.format === 'gif';
    const hasAlpha = Boolean(meta.hasAlpha);
    const ext = isGif ? 'gif' : (hasAlpha ? 'png' : 'jpg');
    const name = `${randomUUID()}.${ext}`;
    const target = path.join(dir, name);

    let pipeline = source.resize({ width: 1200, withoutEnlargement: true });
    if (isGif) pipeline = pipeline.gif();
    else if (hasAlpha) pipeline = pipeline.png({ compressionLevel: 9 });
    else pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true, progressive: true });

    const out = await pipeline.toBuffer();
    await fsp.writeFile(target, out);

    const relative = `/uploads/email/${path.basename(dir)}/${name}`;
    res.status(201).json({
      url: relative,
      width: Math.min(meta.width || 0, 1200),
      bytes: out.length,
      shrunk: (meta.width || 0) > 1200,
      hasAlpha,
    });
  } catch (error) {
    console.error('❌ Error uploading email image:', error);
    res.status(500).json({ error: 'Не удалось загрузить картинку' });
  }
});

/**
 * Иконка письма картинкой (ver. 8.53).
 *
 * Единственный маршрут раздела без проверки входа, и иначе быть не может: по
 * этому адресу ходит не сотрудник портала, а почтовый клиент получателя —
 * Gmail тянет картинку своим прокси, у которого никакого токена нет.
 *
 * Открытость безопасна ровно настолько, насколько ограничены параметры: имя
 * берётся из набора в emailIcons.js, цвет обязан быть шестнадцатеричным,
 * размер зажат в вилку. Ничего, что пришло из адреса, не доходит ни до диска,
 * ни до разметки в исходном виде (см. normalize в emailIconImage.js).
 *
 * Год в Cache-Control — не оптимизация, а лечение жалобы: по умолчанию
 * express.static отдаёт max-age=0, и прокси Gmail перезапрашивает картинку при
 * каждом открытии письма. Здесь же адрес описывает картинку целиком, поэтому
 * содержимое по нему не изменится никогда.
 */
router.get('/icon/:key([a-z0-9-]+).png', async (req, res) => {
  try {
    const file = await emailIcons.iconFile({
      key: req.params.key,
      size: req.query.size,
      color: req.query.color,
      bg: req.query.bg,
    });
    if (!file) return res.status(404).end();

    res.type('png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(file);
  } catch (error) {
    console.error('❌ Error rendering email icon:', error);
    res.status(500).end();
  }
});

/**
 * Отправить письмо себе (ver. 8.43).
 *
 * Предпросмотр показывает, как письмо собралось, но не как оно доедет: не видно
 * ни того, что сделает с ним Gmail, ни того, как выглядит тема в списке писем,
 * ни того, обрежет ли клиент картинки. Проверить это можно ровно одним
 * способом — отправить себе.
 *
 * Адрес не принимается параметром намеренно: письмо уходит на почту того, кто
 * нажал кнопку. Иначе «отправить себе» становится способом разослать черновик
 * куда угодно мимо истории рассылок и мимо отписок.
 */
router.post('/test-send', authenticate, requireAnnouncementsEdit, async (req, res) => {
  try {
    if (!req.user.email) {
      return res.status(400).json({ error: 'У вашей учётной записи не указана почта' });
    }
    const { subject = '(без темы)', design = null, htmlContent = '' } = req.body;
    if (!design && !String(htmlContent).trim()) {
      return res.status(400).json({ error: 'Письмо пустое' });
    }

    const result = await sendBulkEmail({
      subject: `[проверка] ${subject}`,
      htmlContent,
      design,
      recipients: [{ email: req.user.email, displayName: req.user.displayName || req.user.username }],
      attachments: [],
      senderInfo: req.user.displayName || req.user.username,
    });

    // Собственная отписка не должна мешать проверять письма: её отсев здесь
    // выглядел бы как молчаливый сбой отправки.
    if (result.skipped) {
      return res.status(400).json({ error: 'Ваш адрес отписан от рассылок — проверочное письмо не ушло' });
    }
    if (!result.sent) {
      return res.status(500).json({ error: result.errors[0]?.error || 'Письмо не ушло' });
    }
    res.json({ ok: true, email: req.user.email });
  } catch (error) {
    console.error('❌ Error sending test email:', error);
    res.status(500).json({ error: 'Не удалось отправить проверочное письмо' });
  }
});

// === СОХРАНЁННЫЕ МОДУЛИ (ver. 8.43) ===
//
// Модуль — настроенная секция или блок, который вставляют в другие письма.
// Хранится кусок документа конструктора, а не готовый HTML: вставившись в
// письмо, модуль должен оставаться живым и правиться дальше.

router.get('/modules', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const modules = await EmailModule.findAll({
      include: [{ model: User, as: 'author', attributes: ['id', 'displayName', 'username'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json(modules);
  } catch (error) {
    console.error('❌ Error fetching email modules:', error);
    res.status(500).json({ error: 'Не удалось загрузить модули' });
  }
});

router.post('/modules', authenticate, requireAnnouncementsEdit, [
  body('name').trim().notEmpty().withMessage('Название обязательно'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { name, kind = 'section', payload } = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Модуль пустой' });
    }
    if (!['section', 'block'].includes(kind)) {
      return res.status(400).json({ error: 'Неизвестный вид модуля' });
    }

    // Проверяем, что модуль вообще собирается в письмо. Сохранить кусок,
    // который потом не отрендерится, — значит подложить мину в чужое письмо
    // через месяц, когда его вставят и отправят.
    const probe = kind === 'section'
      ? { version: 2, settings: {}, sections: [payload] }
      : { version: 2, settings: {}, sections: [{ columns: [{ width: 100, blocks: [payload] }] }] };
    emailRenderer.render(probe, { subject: 'Проверка модуля' });

    const module = await EmailModule.create({ name, kind, payload, createdBy: req.user.id });
    res.status(201).json(module);
  } catch (error) {
    console.error('❌ Error saving email module:', error);
    res.status(500).json({ error: 'Не удалось сохранить модуль' });
  }
});

router.put('/modules/:id', authenticate, requireAnnouncementsEdit, async (req, res) => {
  try {
    const module = await EmailModule.findByPk(req.params.id);
    if (!module) return res.status(404).json({ error: 'Модуль не найден' });
    // Правим только название: содержимое модуля меняют, вставив его в письмо и
    // сохранив заново. Иначе пришлось бы держать второй редактор для модулей.
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Название обязательно' });
    await module.update({ name });
    res.json(module);
  } catch (error) {
    console.error('❌ Error renaming email module:', error);
    res.status(500).json({ error: 'Не удалось переименовать модуль' });
  }
});

router.delete('/modules/:id', authenticate, requireAnnouncementsEdit, async (req, res) => {
  try {
    const module = await EmailModule.findByPk(req.params.id);
    if (!module) return res.status(404).json({ error: 'Модуль не найден' });
    await module.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Error deleting email module:', error);
    res.status(500).json({ error: 'Не удалось удалить модуль' });
  }
});

// === ОТПИСКИ ===

// GET /api/email/optouts - Кто отказался от рассылок
router.get('/optouts', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 100, maxLimit: 500 });
    const { count, rows } = await EmailOptOut.findAndCountAll({
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });
    res.json({ total: count, items: rows });
  } catch (error) {
    console.error('❌ Error fetching optouts:', error);
    res.status(500).json({ error: 'Ошибка загрузки списка отписавшихся' });
  }
});

/**
 * Вернуть адрес в рассылку.
 *
 * Нужно ровно для одного случая: человек отписался по ошибке и просит вернуть.
 * Поэтому право требуется то же, что на отправку, — иначе это кнопка «подписать
 * обратно всех, кто ушёл».
 */
router.delete('/optouts/:email', authenticate, requireAnnouncementsEdit, async (req, res) => {
  try {
    await optout.optIn(req.params.email);
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Error removing optout:', error);
    res.status(500).json({ error: 'Не удалось вернуть адрес в рассылку' });
  }
});

// POST /api/email/optouts - Отписать адрес вручную (по просьбе человека)
router.post('/optouts', authenticate, requireAnnouncementsEdit, [
  body('email').trim().isEmail().withMessage('Нужен корректный адрес')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    await optout.optOut(req.body.email, { source: 'manual', reason: req.body.reason || null });
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Error adding optout:', error);
    res.status(500).json({ error: 'Не удалось записать отказ' });
  }
});

// === EMAIL SENDING ===

// POST /api/email/send - Запустить рассылку (возвращает jobId сразу, отправка идёт в фоне)
router.post('/send', authenticate, requireAnnouncementsEdit, [
  body('subject').trim().notEmpty().withMessage('Тема обязательна'),
  body('recipients').isArray({ min: 1 }).withMessage('Укажите получателей')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { subject, recipients, attachments = [], scheduledAt } = req.body;
  const design = req.body.design && typeof req.body.design === 'object' ? req.body.design : null;

  // Письмо приходит одним из двух способов и ровно одним: документом
  // конструктора или готовым HTML. Проверка не в express-validator, потому что
  // требование перекрёстное — обязательно одно ИЛИ другое.
  if (!design && !String(req.body.htmlContent || '').trim()) {
    return res.status(400).json({ error: 'Письмо пустое: соберите его в конструкторе или вставьте готовый HTML' });
  }

  // HTML рядом с документом — снимок того, что ушло людям, для истории. Боевая
  // отправка всё равно пересобирает письмо из документа на каждого получателя:
  // адрес отписки у всех свой.
  const htmlContent = design
    ? emailRenderer.render(design, { subject }).html
    : req.body.htmlContent;
  const senderInfo = req.user.displayName || req.user.username;
  const sentBy = req.user.id;

  if (scheduledAt) {
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Время отправки должно быть в будущем' });
    }
  }

  const startAt = scheduledAt ? new Date(scheduledAt) : new Date();
  const slim = (r) => ({ email: r.email, userId: r.userId, displayName: r.displayName });
  const slimAttachments = attachments.map(a => ({ name: a.name, path: a.path, size: a.size, mimeType: a.mimeType }));

  /**
   * Суточный предел (ver. 8.57).
   *
   * Список, который не помещается в сутки, не отменяется и не режется — он
   * растягивается по дням. Каждый день становится отдельной отложенной
   * рассылкой: у неё свой список получателей, свой статус и своя отмена, а
   * связывает их batchId. Отдельного механизма под это нет намеренно — порция
   * это обычная отложенная рассылка, и весь ход отправки у неё уже есть.
   */
  let planned;
  try {
    planned = await quota.planFor(recipients.length, startAt);
  } catch (error) {
    // Предел — это предосторожность, а не условие отправки. Если посчитать его
    // не удалось (упал запрос, нет таблицы settings), рассылка должна уйти, а
    // не встать: молчаливый отказ отправить письмо хуже, чем отправленное без
    // проверки. Но сказать об этом в журнале надо.
    console.error('❌ Не удалось посчитать суточный предел рассылки:', error.message);
    planned = { perDay: 0, plan: [{ date: null, count: recipients.length }] };
  }

  if (planned.overflow) {
    return res.status(400).json({
      error: `Суточный предел (${planned.perDay}) слишком мал: даже за год рассылка не помещается. Поднимите предел или сократите список.`,
    });
  }

  if (planned.plan.length > 1) {
    // Многодневную рассылку не начинаем молча: человек должен сначала увидеть,
    // на сколько дней она растянется. Интерфейс показывает план заранее, а эта
    // проверка страхует от отправки в обход него — например, повтором старого
    // запроса.
    if (req.body.acceptPlan !== true) {
      return res.status(409).json({
        error: 'Рассылка не помещается в суточный предел',
        needsPlan: true,
        perDay: planned.perDay,
        plan: planned.plan,
        total: recipients.length,
      });
    }

    const batchId = randomUUID();
    try {
      let offset = 0;
      const rows = [];
      for (let i = 0; i < planned.plan.length; i += 1) {
        const portion = planned.plan[i];
        const slice = recipients.slice(offset, offset + portion.count);
        offset += portion.count;
        // Первая порция уходит в назначенное время (или сейчас), следующие — в
        // тот же час следующих дней: рассылка, начатая в десять утра,
        // продолжается в десять утра.
        const when = i === 0 ? startAt : quota.portionTime(portion.date, startAt);
        // eslint-disable-next-line no-await-in-loop
        const log = await EmailLog.create({
          subject,
          htmlContent,
          design,
          recipients: slice.map(slim),
          attachments: slimAttachments,
          sentBy,
          sentAt: null,
          scheduledAt: when,
          status: 'scheduled',
          batchId,
          partIndex: i + 1,
          partTotal: planned.plan.length,
        });
        rows.push({ id: log.id, date: portion.date, count: portion.count, scheduledAt: when });
      }
      return res.json({
        scheduled: true,
        split: true,
        batchId,
        perDay: planned.perDay,
        parts: rows,
        total: recipients.length,
      });
    } catch (error) {
      console.error('❌ Error splitting email broadcast:', error);
      // Порции, успевшие записаться до сбоя, уберём: половина плана хуже, чем
      // его отсутствие — человек увидит в истории рассылку, которая уйдёт
      // неполной, и не поймёт почему.
      await EmailLog.destroy({ where: { batchId } }).catch(() => {});
      return res.status(500).json({ error: 'Не удалось разложить рассылку по дням' });
    }
  }

  if (scheduledAt) {
    const when = new Date(scheduledAt);
    try {
      const log = await EmailLog.create({
        subject,
        htmlContent,
        design,
        recipients: recipients.map(slim),
        attachments: slimAttachments,
        sentBy,
        sentAt: null,
        scheduledAt: when,
        status: 'scheduled'
      });
      return res.json({ scheduled: true, id: log.id, total: recipients.length });
    } catch (error) {
      console.error('❌ Error scheduling email broadcast:', error);
      return res.status(500).json({ error: 'Не удалось запланировать рассылку' });
    }
  }

  const jobId = randomUUID();
  sendJobs.set(jobId, {
    status: 'running',
    sent: 0,
    failed: 0,
    total: recipients.length,
    skipped: 0,
    errors: [],
    startedAt: Date.now()
  });

  /*
    Строка в истории заводится ДО отправки, а не после неё (ver. 8.57).

    Раньше рассылка появлялась в истории, только когда дойдёт последнее письмо.
    Пока она шла, её не было нигде — и это мешало дважды. Во-первых, коллега,
    открывший раздел в эту минуту, не видел, что рассылка уже идёт, и мог
    запустить такую же. Во-вторых, суточный предел считается по этой же
    таблице: три рассылки по девятьсот писем, запущенные подряд, проходили бы
    проверку каждая, потому что предыдущие ещё не записались.

    Если процесс упадёт посреди отправки, строка останется в состоянии
    «отправляется». Это лучше, чем её отсутствие: повторно её никто не заберёт
    (планировщик берёт только запланированные), зато видно, что случилось.
  */
  let log = null;
  try {
    log = await EmailLog.create({
      subject,
      htmlContent,
      design,
      recipients: recipients.map(slim),
      attachments: slimAttachments,
      sentBy,
      sentAt: null,
      status: 'sending'
    });
  } catch (error) {
    console.error('❌ Error creating email log:', error);
    return res.status(500).json({ error: 'Не удалось начать рассылку' });
  }

  // Отвечаем клиенту немедленно
  res.json({ jobId, id: log.id, total: recipients.length });

  // Отправка в фоне
  (async () => {
    try {
      const result = await sendBulkEmail({
        subject,
        htmlContent,
        design,
        recipients,
        attachments,
        senderInfo,
        onProgress: ({ sent, failed, total, skipped }) => {
          const job = sendJobs.get(jobId);
          if (!job) return;
          job.sent = sent;
          job.failed = failed;
          // Отписавшиеся выбывают уже внутри отправки, поэтому итог здесь
          // меньше того, что мы назвали клиенту в ответе. Без этой поправки
          // полоса замирала бы на «95 из 100» и выглядела зависшей.
          if (typeof total === 'number') job.total = total;
          if (typeof skipped === 'number') job.skipped = skipped;
        }
      });

      const job = sendJobs.get(jobId);
      if (job) {
        // Рассылка, где все адресаты отписаны, — это не провал отправки:
        // отправлять было некому, и ошибок при этом не случилось.
        job.status = result.failed === 0 ? 'done' : (result.sent === 0 ? 'failed' : 'partial');
        job.sent = result.sent;
        job.failed = result.failed;
        job.skipped = result.skipped;
        job.total = result.sent + result.failed;
        job.errors = result.errors;
      }

      const status = result.failed === 0 ? 'sent' : (result.sent === 0 ? 'failed' : 'partial');
      await log.update({
        status,
        sentAt: new Date(),
        errorDetails: result.errors.length > 0 ? JSON.stringify(result.errors) : null
      });
    } catch (error) {
      console.error('❌ Background email broadcast error:', error);
      const job = sendJobs.get(jobId);
      if (job) { job.status = 'failed'; job.errors = [{ error: error.message }]; }
      // Строка уже в истории: не оставляем её вечно «отправляется» — иначе
      // упавшая рассылка навсегда занимает место в суточном пределе.
      await log.update({ status: 'failed', sentAt: new Date(), errorDetails: error.message }).catch(() => {});
    }
  })();
});

// GET /api/email/send/status/:jobId - Статус задачи рассылки
router.get('/send/status/:jobId', authenticate, requireAnnouncements, (req, res) => {
  const job = sendJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(job);
});

// === СУТОЧНЫЙ ПРЕДЕЛ И ПЛАН РАССЫЛКИ (ver. 8.57) ===

/**
 * Предел и загруженность ближайших дней.
 *
 * Смотреть его может любой, у кого есть доступ к разделу: «почему рассылка
 * растянулась на неделю» — первый вопрос, и ответ на него не секрет.
 */
router.get('/limit', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const days = Math.min(60, Math.max(1, parseInt(req.query.days, 10) || 14));
    res.json(await quota.calendar(days));
  } catch (error) {
    console.error('❌ Error reading email daily limit:', error);
    res.status(500).json({ error: 'Не удалось прочитать суточный предел' });
  }
});

/** Смена предела. 0 — снять ограничение совсем. */
router.put('/limit', authenticate, requireAnnouncementsEdit, [
  body('perDay').isInt({ min: 0, max: 1000000 }).withMessage('Предел — целое число от 0'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const perDay = await quota.setLimit(req.body.perDay);
    res.json(await quota.calendar(14));
    console.log(`📧 Суточный предел рассылок изменён на ${perDay} (${req.user.username})`);
  } catch (error) {
    console.error('❌ Error saving email daily limit:', error);
    res.status(500).json({ error: 'Не удалось сохранить суточный предел' });
  }
});

/**
 * План рассылки: по скольку писем и в какие дни она уйдёт.
 *
 * Спрашивается до отправки, чтобы человек увидел расклад заранее, а не узнал о
 * нём из ответа сервера. Тот же расчёт делает и сам /send — здесь он только
 * показывается, ничего не создавая.
 */
router.post('/plan', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const count = Math.max(0, parseInt(req.body.count, 10) || 0);
    const startAt = req.body.startAt ? new Date(req.body.startAt) : new Date();
    if (Number.isNaN(startAt.getTime())) {
      return res.status(400).json({ error: 'Непонятная дата начала' });
    }
    const planned = await quota.planFor(count, startAt);
    res.json({ ...planned, total: count });
  } catch (error) {
    console.error('❌ Error planning email broadcast:', error);
    res.status(500).json({ error: 'Не удалось построить план рассылки' });
  }
});

// === EMAIL HISTORY ===

// GET /api/email/history - История рассылок
router.get('/history', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    // История общая для раздела: иначе два сотрудника с правом «Анонсы» не
    // понимают, что коллега уже отправил то же письмо.
    const where = {};

    const { count, rows } = await EmailLog.findAndCountAll({
      where,
      include: [{ model: User, as: 'sender', attributes: ['id', 'displayName', 'username'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    res.json({ total: count, logs: rows });
  } catch (error) {
    console.error('❌ Error fetching email history:', error);
    res.status(500).json({ error: 'Ошибка загрузки истории' });
  }
});

// GET /api/email/history/:id - Детали рассылки
router.get('/history/:id', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const log = await EmailLog.findByPk(req.params.id, {
      include: [{ model: User, as: 'sender', attributes: ['id', 'displayName', 'username'] }]
    });

    if (!log) {
      return res.status(404).json({ error: 'Лог не найден' });
    }

    res.json(log);
  } catch (error) {
    console.error('❌ Error fetching email log:', error);
    res.status(500).json({ error: 'Ошибка загрузки лога' });
  }
});

router.post('/history/:id/cancel', authenticate, requireAnnouncementsEdit, async (req, res) => {
  try {
    /*
      Рассылку, растянутую по дням, отменяем целиком (ver. 8.57).

      Порции — это строки одной рассылки, а не десять разных писем, и «отменить»
      человек нажимает именно на рассылку. Отменять их по одной значило бы
      девять раз подтвердить одно решение, а забытая порция ушла бы через
      неделю сама. Порции, которые уже ушли, остаются отправленными: отменить
      письмо, которое у получателя, нечем.
    */
    const row = await EmailLog.findByPk(req.params.id, { attributes: ['id', 'batchId'] });
    const where = row?.batchId
      ? { batchId: row.batchId, status: 'scheduled' }
      : { id: req.params.id, status: 'scheduled' };

    const [changed] = await EmailLog.update({ status: 'canceled' }, { where });
    if (!changed) {
      return res.status(400).json({ error: 'Отменить можно только запланированную рассылку' });
    }
    res.json({ ok: true, canceled: changed });
  } catch (error) {
    console.error('❌ Error canceling scheduled email:', error);
    res.status(500).json({ error: 'Не удалось отменить рассылку' });
  }
});

// === RECIPIENT HELPERS ===

// GET /api/email/recipients/users - Получить всех пользователей для выбора получателей
router.get('/recipients/users', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const users = await User.findAll({
      where: {
        isActive: true,
        email: { [Op.ne]: null }
      },
      attributes: ['id', 'displayName', 'username', 'email'],
      order: [['displayName', 'ASC']]
    });
    res.json(users);
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({ error: 'Ошибка загрузки пользователей' });
  }
});

// Справочник ролей принадлежит форме рассылки. Не заставляем пользователя с
// правом «Анонсы» дополнительно получать административное право на редактор
// ролей только ради выбора аудитории.
router.get('/recipients/roles', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const roles = await Role.findAll({
      attributes: ['id', 'name', 'description'],
      order: [['name', 'ASC']]
    });
    res.json(roles);
  } catch (error) {
    console.error('❌ Error fetching email recipient roles:', error);
    res.status(500).json({ error: 'Ошибка загрузки ролей' });
  }
});

// GET /api/email/recipients/by-role/:roleId - Получить пользователей по роли
router.get('/recipients/by-role/:roleId', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const { UserRole } = require('../models');

    const users = await User.findAll({
      where: {
        isActive: true,
        email: { [Op.ne]: null }
      },
      attributes: ['id', 'displayName', 'username', 'email'],
      include: [{
        model: Role,
        as: 'roles',
        where: { id: req.params.roleId },
        through: { attributes: [] }
      }],
      order: [['displayName', 'ASC']]
    });

    res.json(users);
  } catch (error) {
    console.error('❌ Error fetching users by role:', error);
    res.status(500).json({ error: 'Ошибка загрузки пользователей по роли' });
  }
});

// === FAVORITES ===

// GET /api/email/favorites/recipients - Получить избранных получателей
router.get('/favorites/recipients', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const favorites = await EmailFavoriteRecipient.findAll({
      where: { userId: req.user.id },
      order: [['displayName', 'ASC']]
    });
    res.json(favorites);
  } catch (error) {
    console.error('❌ Error fetching favorite recipients:', error);
    res.status(500).json({ error: 'Ошибка загрузки избранных получателей' });
  }
});

// POST /api/email/favorites/recipients - Добавить избранного получателя
router.post('/favorites/recipients', authenticate, requireAnnouncementsEdit, [
  body('email').isEmail().withMessage('Некорректный email'),
  body('displayName').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, displayName } = req.body;
    const [favorite, created] = await EmailFavoriteRecipient.findOrCreate({
      where: { userId: req.user.id, email },
      defaults: { userId: req.user.id, email, displayName: displayName || email }
    });

    if (!created) {
      // Обновляем displayName если изменился
      await favorite.update({ displayName: displayName || email });
    }

    res.json(favorite);
  } catch (error) {
    console.error('❌ Error adding favorite recipient:', error);
    res.status(500).json({ error: 'Ошибка добавления избранного получателя' });
  }
});

// DELETE /api/email/favorites/recipients/:id - Удалить избранного получателя
router.delete('/favorites/recipients/:id', authenticate, requireAnnouncementsEdit, async (req, res) => {
  try {
    const favorite = await EmailFavoriteRecipient.findOne({
      where: { id: req.params.id, userId: req.user.id }
    });

    if (!favorite) {
      return res.status(404).json({ error: 'Избранный получатель не найден' });
    }

    await favorite.destroy();
    res.json({ message: 'Удалено из избранного' });
  } catch (error) {
    console.error('❌ Error removing favorite recipient:', error);
    res.status(500).json({ error: 'Ошибка удаления избранного получателя' });
  }
});

// GET /api/email/favorites/templates - Получить избранные шаблоны (список ID)
router.get('/favorites/templates', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const favorites = await EmailFavoriteTemplate.findAll({
      where: { userId: req.user.id },
      attributes: ['id', 'templateId']
    });
    res.json(favorites.map(f => f.templateId));
  } catch (error) {
    console.error('❌ Error fetching favorite templates:', error);
    res.status(500).json({ error: 'Ошибка загрузки избранных шаблонов' });
  }
});

// POST /api/email/favorites/templates/:templateId - Переключить избранный шаблон
router.post('/favorites/templates/:templateId', authenticate, requireAnnouncementsEdit, async (req, res) => {
  try {
    const { templateId } = req.params;

    const existing = await EmailFavoriteTemplate.findOne({
      where: { userId: req.user.id, templateId }
    });

    if (existing) {
      await existing.destroy();
      res.json({ favorited: false });
    } else {
      await EmailFavoriteTemplate.create({ userId: req.user.id, templateId });
      res.json({ favorited: true });
    }
  } catch (error) {
    console.error('❌ Error toggling favorite template:', error);
    res.status(500).json({ error: 'Ошибка обновления избранного шаблона' });
  }
});

// === EXCEL IMPORT ===

/**
 * Разбор файла с получателями (ver. 8.43).
 *
 * Файл читается как ТАБЛИЦА: ищем строку заголовков, в ней — колонки с адресом
 * и именем. Заголовки распознаются по смыслу, а не по точному написанию:
 * «E-mail», «почта», «Адрес электронной почты» — всё это одно и то же, и
 * заставлять человека переименовывать колонку ради нас значит гарантированно
 * получать файлы с неправильным заголовком.
 *
 * Имя в письмо не подставляется — персонализацию убрали. Оно нужно в списке
 * получателей: выбирать из сотни строк «Иванов Иван» проще, чем из сотни
 * почтовых адресов.
 *
 * Если заголовков нет — берём только адреса, как делал самый первый вариант
 * разбора. Старые файлы не должны перестать открываться.
 */
const EMAIL_HEADER = /(e-?mail|почт|адрес)/i;
const NAME_HEADER = /(имя|фио|ф\.и\.о|name|получател|клиент|пациент)/i;

router.post('/recipients/parse-excel', authenticate, requireAnnouncementsEdit, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не передан' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const byEmail = new Map();

    const remember = (email, displayName) => {
      const addr = String(email || '').trim().toLowerCase();
      if (!emailRegex.test(addr)) return;
      const existing = byEmail.get(addr);
      // Первое непустое значение выигрывает: если адрес встретился дважды и во
      // второй раз без имени, имя терять не надо.
      byEmail.set(addr, {
        email: addr,
        displayName: existing?.displayName || String(displayName || '').trim() || addr,
      });
    };

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
      if (!rows.length) continue;

      // Строка заголовков — первая, где есть колонка, похожая на адрес, и при
      // этом в ней самой адреса нет (иначе это уже данные).
      let headerIndex = -1;
      let cols = null;
      for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = (rows[i] || []).map(c => String(c ?? '').trim());
        const emailCol = row.findIndex(c => EMAIL_HEADER.test(c) && !emailRegex.test(c.toLowerCase()));
        if (emailCol === -1) continue;
        headerIndex = i;
        cols = { email: emailCol, name: row.findIndex(c => NAME_HEADER.test(c)) };
        break;
      }

      if (cols) {
        for (let i = headerIndex + 1; i < rows.length; i++) {
          const row = rows[i] || [];
          remember(row[cols.email], cols.name >= 0 ? row[cols.name] : '');
        }
        continue;
      }

      // Заголовков нет — старое поведение: выбираем всё, что похоже на адрес.
      for (const row of rows) {
        for (const cell of row) {
          for (const part of String(cell ?? '').split(/[\s,;]+/)) {
            remember(part, '');
          }
        }
      }
    }

    const recipients = Array.from(byEmail.values());
    res.json({
      recipients,
      // Старое поле оставлено: им пользуется прежний код на фронтенде, пока он
      // не обновится, и по нему же удобно считать, сколько адресов нашлось.
      emails: recipients.map(r => r.email),
      count: recipients.length,
      withNames: recipients.filter(r => r.displayName !== r.email).length,
    });
  } catch (error) {
    console.error('❌ Error parsing Excel:', error);
    res.status(500).json({ error: 'Ошибка разбора файла' });
  }
});

module.exports = router;
