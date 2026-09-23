'use strict';

/**
 * Почта: чтение писем и администрирование ящиков (ver. 8.58).
 *
 * Разделено на два круга людей. Всё, что под /admin, требует права
 * adminAccess.mail — это заведение ящиков и раздача доступов. Остальное
 * доступно тому, у кого есть доступ хотя бы к одному ящику, и каждый запрос
 * проверяет доступ именно к тому ящику, о котором спрашивают: подставить чужой
 * accountId в адресе — первое, что придёт в голову любопытному.
 *
 * Отправки писем здесь пока нет, она следующим этапом.
 */

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');

const {
  sequelize, MailAccount, MailAccountUser, MailAccountAccessRule, MailFolder,
  MailMessage, MailMessageBody, MailAttachment, MailAudit, MailSavedSearch,
  MailDraft, User, MedCenter, Role,
} = require('../models');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const { parsePagination } = require('../utils/pagination');
const { accessibleAccounts, accessibleAccountIds, accessTo } = require('../services/mail/access');
const { encryptPassword } = require('../services/mail/crypto');
const { testAccount, withConnection } = require('../services/mail/imap');
const { setFlag, setTaken, requestDelete } = require('../services/mail/flags');
const { attachmentAbsPath, STORE_ROOT } = require('../services/mail/store');
const { sendDraft, sentToday, DAILY_PER_ACCOUNT, MAX_RECIPIENTS } = require('../services/mail/send');
const { htmlToPlain } = require('../services/mail/parse');
const { syncAccount, syncFolders } = require('../services/mail/sync');
const { searchMessages, parseQuery } = require('../services/mail/search');
const { Op } = require('sequelize');

const router = express.Router();
const requireMailAdmin = requireAdminAccess('mail');

// Вложение к письму. Потолок в 25 МБ — не наша прихоть: почтовые серверы
// массово режут письма тяжелее этого, и принять файл, который всё равно не
// уйдёт, значит соврать человеку.
const uploadAttachment = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ── Общее ─────────────────────────────────────────────────────────────────

/**
 * Журнал. Пишется без await в обработчике: ящик общий, и вопрос «кто это
 * открыл» однажды обязательно возникнет, но ответ человеку задерживать из-за
 * записи в журнал незачем.
 */
function audit(req, { accountId, messageId, action, detail }) {
  MailAudit.create({
    userId: req.user.id,
    accountId: accountId || null,
    messageId: messageId || null,
    action,
    detail: detail || {},
    ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().slice(0, 64),
  }).catch((err) => console.error('📬 Почта: не записался журнал —', err.message));
}

/** Достаёт письмо вместе с проверкой, что спрашивающий имеет право его видеть. */
async function loadMessageForUser(req, messageId) {
  const message = await MailMessage.findByPk(messageId, {
    include: [{ model: MailFolder, as: 'folder' }],
  });
  if (!message) return { error: 404 };

  const access = await accessTo(req.user.id, message.accountId);
  if (!access) return { error: 403 };

  return { message, access };
}

// ── Ящики и папки ─────────────────────────────────────────────────────────

// GET /api/mail/accounts — ящики, к которым у меня есть доступ
router.get('/accounts', authenticate, async (req, res) => {
  try {
    const accounts = await accessibleAccounts(req.user.id);
    if (!accounts.length) return res.json({ accounts: [] });

    // Непрочитанные одним запросом на все ящики: по запросу на ящик — это
    // сотня запросов при каждом открытии раздела.
    const [counts] = await sequelize.query(`
      SELECT "accountId", COUNT(*)::int AS unread
      FROM mail_messages
      WHERE "accountId" = ANY($1::uuid[]) AND NOT "isSeen" AND NOT "isDraft" AND NOT "pendingDelete"
      GROUP BY "accountId"
    `, { bind: [accounts.map((a) => a.id)] });

    const unreadBy = new Map(counts.map((r) => [r.accountId, Number(r.unread)]));

    res.json({
      accounts: accounts.map((a) => ({ ...a, unread: unreadBy.get(a.id) || 0 })),
    });
  } catch (error) {
    console.error('❌ Почта: не отдались ящики:', error);
    res.status(500).json({ error: 'Не удалось получить список ящиков' });
  }
});

// GET /api/mail/accounts/:accountId/folders
router.get('/accounts/:accountId/folders', authenticate, async (req, res) => {
  try {
    const access = await accessTo(req.user.id, req.params.accountId);
    if (!access) return res.status(403).json({ error: 'Нет доступа к этому ящику' });

    const [folders] = await sequelize.query(`
      SELECT f.id, f.path, f.name, f."specialUse", f."sortOrder", f."messagesTotal",
             f."backfillDone", f."lastSyncAt",
             COUNT(m.id) FILTER (WHERE NOT m."isSeen" AND NOT m."pendingDelete")::int AS unread,
             COUNT(m.id) FILTER (WHERE NOT m."pendingDelete")::int AS "inMirror"
      FROM mail_folders f
      LEFT JOIN mail_messages m ON m."folderId" = f.id
      WHERE f."accountId" = $1 AND f.selectable
      GROUP BY f.id
      ORDER BY f."sortOrder", f.name
    `, { bind: [req.params.accountId] });

    res.json({ folders });
  } catch (error) {
    console.error('❌ Почта: не отдались папки:', error);
    res.status(500).json({ error: 'Не удалось получить список папок' });
  }
});

// Список IMAP принадлежит тому же серверу, что и Roundcube. Обновляем зеркало
// по запросу человека; после этого фоновая заливка подхватит старые письма.
router.post('/accounts/:accountId/folders/refresh', authenticate, async (req, res) => {
  try {
    if (!await accessTo(req.user.id, req.params.accountId)) {
      return res.status(403).json({ error: 'Нет доступа к этому ящику' });
    }
    const account = await MailAccount.scope('withSecret').findByPk(req.params.accountId);
    if (!account || !account.isActive) return res.status(404).json({ error: 'Ящик не найден' });
    const folders = await withConnection(account, (client) => syncFolders(client, account));
    audit(req, { accountId: account.id, action: 'folders_refresh' });
    res.json({ folders: folders.map((f) => ({ id: f.id, path: f.path, name: f.name,
      specialUse: f.specialUse, backfillDone: f.backfillDone })) });
    syncAccount(account.id).catch((err) => console.error('📬 Почта: загрузка папок не прошла —', err.message));
  } catch (error) {
    console.error('❌ Почта: не обновились папки:', error);
    res.status(502).json({ error: 'Не удалось прочитать папки на почтовом сервере' });
  }
});

router.post('/accounts/:accountId/folders', authenticate, async (req, res) => {
  try {
    if (!await accessTo(req.user.id, req.params.accountId)) {
      return res.status(403).json({ error: 'Нет доступа к этому ящику' });
    }
    const name = String(req.body.name || '').trim();
    // Разделитель каталога берём с сервера: пользователь задаёт только один
    // сегмент. Иначе можно нечаянно создать иерархию или системную папку.
    if (!name || name.length > 100 || /[\\/\x00-\x1f]/.test(name) || /^inbox$/i.test(name)) {
      return res.status(400).json({ error: 'Введите имя папки до 100 символов без / и \\' });
    }
    const account = await MailAccount.scope('withSecret').findByPk(req.params.accountId);
    if (!account || !account.isActive) return res.status(404).json({ error: 'Ящик не найден' });
    const parentId = req.body.parentId || null;
    let parent = null;
    if (parentId) {
      parent = await MailFolder.findOne({ where: { id: parentId, accountId: account.id } });
      if (!parent) return res.status(404).json({ error: 'Родительская папка не найдена' });
    }
    const delimiter = parent?.delimiter || (await MailFolder.findOne({ where: { accountId: account.id, path: 'INBOX' } }))?.delimiter || '.';
    if (name.includes(delimiter)) return res.status(400).json({ error: 'Имя содержит разделитель папок' });
    const folderPath = parent ? `${parent.path}${delimiter}${name}` : name;
    if (folderPath.length > 1000) return res.status(400).json({ error: 'Слишком длинный путь папки' });
    await withConnection(account, async (client) => {
      await client.mailboxCreate(folderPath);
      await syncFolders(client, account);
    });
    const folder = await MailFolder.findOne({ where: { accountId: account.id, path: folderPath } });
    audit(req, { accountId: account.id, action: 'folder_create', detail: { path: folderPath } });
    res.status(201).json({ folder });
  } catch (error) {
    console.error('❌ Почта: папка не создалась:', error);
    res.status(502).json({ error: 'Не удалось создать папку на почтовом сервере' });
  }
});

// ── Список писем ──────────────────────────────────────────────────────────

// GET /api/mail/messages?accountId=&folderId=&unread=&attachments=&limit=&offset=
router.get('/messages', authenticate, async (req, res) => {
  try {
    const { accountId, folderId } = req.query;
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    let accountIds;
    if (accountId) {
      const access = await accessTo(req.user.id, accountId);
      if (!access) return res.status(403).json({ error: 'Нет доступа к этому ящику' });
      accountIds = [accountId];
    } else {
      // Без указания ящика показываем всё доступное: человеку с пятью ящиками
      // это главное удобство.
      accountIds = await accessibleAccountIds(req.user.id);
      if (!accountIds.length) return res.json({ messages: [], total: 0 });
    }

    // Спрятанное на удаление в списке не показываем: для человека письмо уже
    // удалено, даже если до сервера это ещё не доехало.
    const where = ['m."accountId" = ANY($1::uuid[])', 'NOT m."pendingDelete"'];
    const bind = [accountIds];

    if (folderId) {
      bind.push(folderId);
      where.push(`m."folderId" = $${bind.length}`);
    }
    if (req.query.unread === 'true') where.push('NOT m."isSeen"');
    if (req.query.attachments === 'true') where.push('m."hasAttachments"');
    if (req.query.flagged === 'true') where.push('m."isFlagged"');

    bind.push(limit, offset);
    const limitParam = `$${bind.length - 1}`;
    const offsetParam = `$${bind.length}`;

    const [messages] = await sequelize.query(`
      SELECT m.id, m."accountId", m."folderId", m.uid, m.subject, m."fromName", m."fromEmail",
             m."sentAt", m."receivedAt", m.size, m."isSeen", m."isFlagged", m."isAnswered",
             m."hasAttachments", m."attachmentsCount", m.preview, m."bodyState", m."threadKey",
             a.email AS "accountEmail", f.name AS "folderName", f."specialUse",
             s."isRead" AS "readByMe", s."takenAt" AS "takenByMe"
      FROM mail_messages m
      JOIN mail_accounts a ON a.id = m."accountId"
      JOIN mail_folders f ON f.id = m."folderId"
      LEFT JOIN mail_user_message_state s ON s."messageId" = m.id AND s."userId" = $${bind.length + 1}
      WHERE ${where.join(' AND ')}
      ORDER BY m."receivedAt" DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `, { bind: [...bind, req.user.id] });

    // Точное число писем на полумиллионе строк считается дольше, чем берётся
    // первая страница. Отдаём признак «есть ещё» — этого хватает для листания,
    // а точную цифру в почтовом списке никто не читает.
    res.json({ messages, hasMore: messages.length === limit, limit, offset });
  } catch (error) {
    console.error('❌ Почта: не отдался список писем:', error);
    res.status(500).json({ error: 'Не удалось получить письма' });
  }
});

// ── Поиск ─────────────────────────────────────────────────────────────────

// GET /api/mail/search?q=...&accountId=&folderId=&limit=&offset=
//
// Ищет по всем доступным ящикам, если не указан конкретный. Для человека с
// пятью ящиками это главное, ради чего затевался модуль: в IMAP такого запроса
// не существует в принципе — там поиск живёт внутри одной папки одного ящика.
router.get('/search', authenticate, async (req, res) => {
  try {
    const query = String(req.query.q || '');
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });

    let accountIds;
    if (req.query.accountId) {
      const access = await accessTo(req.user.id, req.query.accountId);
      if (!access) return res.status(403).json({ error: 'Нет доступа к этому ящику' });
      accountIds = [req.query.accountId];
    } else {
      accountIds = await accessibleAccountIds(req.user.id);
      if (!accountIds.length) return res.json({ messages: [], empty: true });
    }

    const started = Date.now();
    const { messages, parsed, empty } = await searchMessages({
      query,
      userId: req.user.id,
      accountIds,
      accountId: req.query.accountId || null,
      folderId: req.query.folderId || null,
      limit,
      offset,
    });

    res.json({
      messages,
      empty: Boolean(empty),
      hasMore: messages.length === limit,
      limit,
      offset,
      ms: Date.now() - started,
      // Разобранный запрос возвращаем, чтобы интерфейс мог показать, что именно
      // он понял: «тема: договор», «после 1 января». Человек, увидевший разбор,
      // сам исправит опечатку в приставке — без этого он решит, что поиск врёт.
      parsed: {
        terms: parsed.terms,
        phrases: parsed.phrases,
        from: parsed.from, to: parsed.to, cc: parsed.cc,
        subject: parsed.subject, file: parsed.file, folder: parsed.folder,
        has: parsed.has, is: parsed.is,
        after: parsed.after, before: parsed.before,
        larger: parsed.larger, smaller: parsed.smaller,
      },
    });
  } catch (error) {
    console.error('❌ Почта: поиск не отработал:', error);
    res.status(500).json({ error: 'Поиск не отработал' });
  }
});

// GET /api/mail/search/parse?q=... — только разбор, без запроса к письмам.
// Нужен подсказке под строкой поиска, пока человек ещё печатает.
router.get('/search/parse', authenticate, (req, res) => {
  const parsed = parseQuery(String(req.query.q || ''));
  res.json({ parsed });
});

// ── Сохранённые поиски ────────────────────────────────────────────────────

// GET /api/mail/saved-searches — свои и общие по доступным ящикам
router.get('/saved-searches', authenticate, async (req, res) => {
  try {
    const accountIds = await accessibleAccountIds(req.user.id);

    const items = await MailSavedSearch.findAll({
      where: {
        [Op.or]: [
          { userId: req.user.id },
          // Общие видны только по тем ящикам, куда есть доступ: иначе человек
          // увидел бы чужую «умную папку» и пустую выдачу по ней.
          { userId: null, accountId: accountIds.length ? { [Op.in]: accountIds } : null },
        ],
      },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']],
    });

    res.json({ items });
  } catch (error) {
    console.error('❌ Почта: сохранённые поиски не отдались:', error);
    res.status(500).json({ error: 'Не удалось получить сохранённые поиски' });
  }
});

// POST /api/mail/saved-searches — { name, query, accountId, shared }
router.post('/saved-searches', authenticate, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const query = String(req.body.query || '').trim();
    if (!name || !query) return res.status(400).json({ error: 'Нужны название и запрос' });

    const accountId = req.body.accountId || null;
    if (accountId && !(await accessTo(req.user.id, accountId))) {
      return res.status(403).json({ error: 'Нет доступа к этому ящику' });
    }

    // Общий поиск привязывается к ящику: «гарантийные письма» без указания, в
    // каком ящике их искать, — это не папка, а недоразумение.
    const shared = Boolean(req.body.shared) && Boolean(accountId);

    const item = await MailSavedSearch.create({
      name: name.slice(0, 150),
      query,
      accountId,
      userId: shared ? null : req.user.id,
      createdBy: req.user.id,
      sortOrder: req.body.sortOrder ?? 100,
    });

    res.status(201).json({ item });
  } catch (error) {
    console.error('❌ Почта: поиск не сохранился:', error);
    res.status(500).json({ error: 'Не удалось сохранить' });
  }
});

// DELETE /api/mail/saved-searches/:id
router.delete('/saved-searches/:id', authenticate, async (req, res) => {
  try {
    const item = await MailSavedSearch.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Не найдено' });

    // Свой — удаляет владелец. Общий — тот, у кого есть доступ к ящику: общая
    // «умная папка» и заводится ради смены, значит и убирать её может смена.
    const mine = item.userId === req.user.id;
    const sharedAndAllowed = !item.userId && item.accountId && await accessTo(req.user.id, item.accountId);
    if (!mine && !sharedAndAllowed) return res.status(403).json({ error: 'Это не ваш поиск' });

    await item.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Почта: поиск не удалился:', error);
    res.status(500).json({ error: 'Не удалось удалить' });
  }
});

// ── Одно письмо ───────────────────────────────────────────────────────────

// GET /api/mail/messages/:id
router.get('/messages/:id', authenticate, async (req, res) => {
  try {
    const { message, error } = await loadMessageForUser(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Письмо не найдено' });
    if (error === 403) return res.status(403).json({ error: 'Нет доступа к этому ящику' });

    const body = await MailMessageBody.findByPk(message.id);
    const attachments = await MailAttachment.findAll({
      where: { messageId: message.id, isInline: false },
      attributes: ['id', 'filename', 'mimeType', 'size'],
      order: [['filename', 'ASC']],
    });
    const inlineAttachments = await MailAttachment.findAll({
      // Старые письма могли получить isInline=false, если сервер не передал
      // Content-Disposition, хотя HTML ссылался на файл через cid:.
      where: { messageId: message.id, contentId: { [Op.ne]: null } },
      attributes: ['id', 'filename', 'mimeType', 'size', 'contentId'],
      order: [['id', 'ASC']],
    });

    const [addresses] = await sequelize.query(`
      SELECT ma.role, ma.name, a.email
      FROM mail_message_addresses ma
      JOIN mail_addresses a ON a.id = ma."addressId"
      WHERE ma."messageId" = $1
      ORDER BY ma.role, a.email
    `, { bind: [message.id] });

    audit(req, { accountId: message.accountId, messageId: message.id, action: 'open',
      detail: { subject: message.subject, from: message.fromEmail } });

    res.json({
      message: {
        id: message.id,
        accountId: message.accountId,
        folderId: message.folderId,
        uid: String(message.uid),
        subject: message.subject,
        fromName: message.fromName,
        fromEmail: message.fromEmail,
        sentAt: message.sentAt,
        receivedAt: message.receivedAt,
        size: message.size,
        isSeen: message.isSeen,
        isFlagged: message.isFlagged,
        isAnswered: message.isAnswered,
        threadKey: message.threadKey,
        folderName: message.folder?.name,
        bodyState: message.bodyState,
      },
      // Пусто, пока тело не доехало вторым проходом заливки. Интерфейс должен
      // показать это честно, а не пустое письмо.
      body: body ? { text: body.textBody, html: body.htmlSanitized } : null,
      attachments,
      inlineAttachments,
      addresses,
    });
  } catch (error) {
    console.error('❌ Почта: не отдалось письмо:', error);
    res.status(500).json({ error: 'Не удалось открыть письмо' });
  }
});

// POST /api/mail/messages/:id/flags — { op: seen | unseen | flag | unflag }
router.post('/messages/:id/flags', authenticate, async (req, res) => {
  try {
    const { message, error } = await loadMessageForUser(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Письмо не найдено' });
    if (error === 403) return res.status(403).json({ error: 'Нет доступа к этому ящику' });

    const op = String(req.body.op || '');
    if (!['seen', 'unseen', 'flag', 'unflag'].includes(op)) {
      return res.status(400).json({ error: 'Неизвестная отметка' });
    }

    await setFlag(message, req.user.id, op);
    res.json({ ok: true, op });
  } catch (error) {
    console.error('❌ Почта: не проставилась отметка:', error);
    res.status(500).json({ error: 'Не удалось поставить отметку' });
  }
});

// POST /api/mail/messages/:id/taken — { taken: true|false }
router.post('/messages/:id/taken', authenticate, async (req, res) => {
  try {
    const { message, error } = await loadMessageForUser(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Письмо не найдено' });
    if (error === 403) return res.status(403).json({ error: 'Нет доступа к этому ящику' });

    await setTaken(message.id, req.user.id, Boolean(req.body.taken));
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Почта: не отметилось «в работе»:', error);
    res.status(500).json({ error: 'Не удалось отметить письмо' });
  }
});

// GET /api/mail/messages/:id/thread — остальные письма той же переписки
//
// Деловая переписка почти всегда ветка, а не одиночное письмо: претензию
// обсуждают в пять заходов, и читать их по одному, возвращаясь в список, —
// худший способ понять, чем дело кончилось.
//
// Ищем по threadKey, а он считается при разборе из References. Ветка собирается
// по всем доступным человеку ящикам: письмо ушло с одного адреса, ответ пришёл
// на другой — для переписки это одна история, хотя для IMAP два разных ящика.
router.get('/messages/:id/thread', authenticate, async (req, res) => {
  try {
    const { message, error } = await loadMessageForUser(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Письмо не найдено' });
    if (error === 403) return res.status(403).json({ error: 'Нет доступа к этому ящику' });

    if (!message.threadKey) return res.json({ messages: [] });

    const accountIds = await accessibleAccountIds(req.user.id);

    const [rows] = await sequelize.query(`
      SELECT m.id, m.subject, m."fromName", m."fromEmail", m."receivedAt",
             m."isSeen", m."hasAttachments", m.preview,
             a.email AS "accountEmail", f.name AS "folderName", f."specialUse"
      FROM mail_messages m
      JOIN mail_accounts a ON a.id = m."accountId"
      JOIN mail_folders f ON f.id = m."folderId"
      WHERE m."threadKey" = $1
        AND m."accountId" = ANY($2::uuid[])
        AND NOT m."pendingDelete"
      ORDER BY m."receivedAt" ASC
      LIMIT 100
    `, { bind: [message.threadKey, accountIds] });

    // Одно и то же письмо лежит и во «Входящих», и в пользовательской папке, и
    // приходит сразу на два наших ящика. В переписке это одно событие.
    const seen = new Set();
    const unique = rows.filter((row) => {
      const key = `${row.fromEmail}|${row.receivedAt}|${row.subject}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({ messages: unique });
  } catch (error) {
    console.error('❌ Почта: переписка не собралась:', error);
    res.status(500).json({ error: 'Не удалось собрать переписку' });
  }
});

// DELETE /api/mail/messages/:id
//
// Удаление настоящее: письмо уезжает в «Корзину» на reg.ru и пропадает у всех,
// включая тех, кто работает через Roundcube. Это решение заказчика, и именно
// поэтому здесь отдельное право и подробная запись в журнале — ящик общий, и
// вопрос «кто это стёр» однажды обязательно возникнет.
router.delete('/messages/:id', authenticate, async (req, res) => {
  try {
    const { message, access, error } = await loadMessageForUser(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Письмо не найдено' });
    if (error === 403) return res.status(403).json({ error: 'Нет доступа к этому ящику' });
    if (!access.canDelete) return res.status(403).json({ error: 'Удаление писем вам не разрешено' });

    // В журнал кладём всё нужное для опознания письма: сама строка сейчас
    // исчезнет, а запись об удалении обязана пережить удалённое.
    audit(req, {
      accountId: message.accountId,
      messageId: message.id,
      action: 'delete',
      detail: {
        subject: message.subject,
        from: message.fromEmail,
        uid: String(message.uid),
        folder: message.folder?.name,
        receivedAt: message.receivedAt,
      },
    });

    await requestDelete(message, req.user.id);
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Почта: письмо не удалилось:', error);
    res.status(500).json({ error: 'Не удалось удалить письмо' });
  }
});

// Переносим в папку на сервере: она сразу станет видна и в Roundcube.
router.post('/messages/:id/move', authenticate, async (req, res) => {
  try {
    const { message, error } = await loadMessageForUser(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Письмо не найдено' });
    if (error === 403) return res.status(403).json({ error: 'Нет доступа к этому ящику' });
    const target = await MailFolder.findOne({ where: {
      id: req.body.folderId, accountId: message.accountId, selectable: true,
    } });
    if (!target) return res.status(404).json({ error: 'Папка не найдена в этом ящике' });
    if (target.id === message.folderId) return res.json({ ok: true });
    const account = await MailAccount.scope('withSecret').findByPk(message.accountId);
    const result = await withConnection(account, async (client) => {
      await client.mailboxOpen(message.folder.path, { readOnly: false });
      if (client.capabilities.has('MOVE')) {
        return client.messageMove(String(message.uid), target.path, { uid: true });
      } else {
        const copied = await client.messageCopy(String(message.uid), target.path, { uid: true });
        await client.messageFlagsAdd(String(message.uid), ['\\Deleted'], { uid: true });
        await client.messageDelete(String(message.uid), { uid: true });
        return copied;
      }
    });
    audit(req, { accountId: message.accountId, messageId: message.id, action: 'move',
      detail: { from: message.folder.path, to: target.path } });
    // С UIDPLUS сервер сразу сообщает UID в новой папке, поэтому сохраняем уже
    // скачанные тело и вложения. Без него запись восстановит синхронизатор.
    const newUid = result?.uidMap?.get(Number(message.uid));
    if (newUid) await message.update({ folderId: target.id, uid: String(newUid) });
    else await message.destroy();
    res.json({ ok: true, pendingSync: !newUid });
  } catch (error) {
    console.error('❌ Почта: письмо не перенеслось:', error);
    res.status(502).json({ error: 'Не удалось перенести письмо на почтовом сервере' });
  }
});

// GET /api/mail/messages/:id/attachments/:attachmentId
router.get('/messages/:id/attachments/:attachmentId', authenticate, async (req, res) => {
  try {
    const { message, error } = await loadMessageForUser(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Письмо не найдено' });
    if (error === 403) return res.status(403).json({ error: 'Нет доступа к этому ящику' });

    const attachment = await MailAttachment.findOne({
      where: { id: req.params.attachmentId, messageId: message.id },
    });
    if (!attachment || !attachment.storagePath) return res.status(404).json({ error: 'Вложение не найдено' });

    const abs = attachmentAbsPath(attachment.storagePath);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Файл вложения потерялся' });

    audit(req, { accountId: message.accountId, messageId: message.id, action: 'download',
      detail: { filename: attachment.filename, size: attachment.size } });

    // Только скачиванием: показывать чужой HTML или SVG прямо в нашем домене
    // значит отдать ему наши куки и наш origin.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename || 'file')}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(abs).pipe(res);
  } catch (error) {
    console.error('❌ Почта: не отдалось вложение:', error);
    res.status(500).json({ error: 'Не удалось скачать вложение' });
  }
});

// ── Черновики и отправка ──────────────────────────────────────────────────

/** Черновик вместе с проверкой, что он принадлежит спрашивающему. */
async function loadDraft(req, id) {
  const draft = await MailDraft.findByPk(id);
  if (!draft) return { error: 404 };
  // Черновик — дело одного человека, даже в общем ящике: недописанное письмо
  // коллеги видеть незачем.
  if (draft.userId !== req.user.id) return { error: 403 };
  return { draft };
}

/**
 * Готовит цитату для ответа и пересылки. Делается на сервере, а не в браузере,
 * чтобы вид цитаты был одинаковым у всех и не зависел от того, что сумел
 * собрать интерфейс.
 */
function quoteOriginal(message, body) {
  const when = message.sentAt || message.receivedAt;
  const date = when ? new Date(when).toLocaleString('ru-RU') : '';
  const who = message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail;

  const intro = `В ${date} ${who} написал(а):`;
  const text = (body?.textBody || '').split('\n').map((l) => `> ${l}`).join('\n');

  return {
    html: `<br><br><div>${intro}</div><blockquote style="margin:8px 0;padding-left:12px;border-left:3px solid #e2e5ea;color:#6b7280">${body?.htmlSanitized || ''}</blockquote>`,
    text: `\n\n${intro}\n${text}`,
  };
}

// GET /api/mail/drafts — мои незавершённые письма
router.get('/drafts', authenticate, async (req, res) => {
  try {
    const drafts = await MailDraft.findAll({
      where: { userId: req.user.id, status: { [Op.in]: ['draft', 'error'] } },
      order: [['updatedAt', 'DESC']],
      limit: 50,
      include: [{ model: MailAccount, as: 'account', attributes: ['id', 'email', 'displayName'] }],
    });
    res.json({ drafts });
  } catch (error) {
    console.error('❌ Почта: черновики не отдались:', error);
    res.status(500).json({ error: 'Не удалось получить черновики' });
  }
});

// POST /api/mail/drafts — { accountId, kind, replyToId, subject, toList… }
router.post('/drafts', authenticate, async (req, res) => {
  try {
    const accountId = req.body.accountId;
    const access = await accessTo(req.user.id, accountId);
    if (!access) return res.status(403).json({ error: 'Нет доступа к этому ящику' });
    if (!access.canSend) return res.status(403).json({ error: 'Отправка с этого ящика вам не разрешена' });

    const kind = ['new', 'reply', 'forward'].includes(req.body.kind) ? req.body.kind : 'new';
    const payload = {
      accountId,
      userId: req.user.id,
      kind,
      subject: req.body.subject || '',
      toList: req.body.toList || [],
      ccList: req.body.ccList || [],
      bccList: req.body.bccList || [],
      bodyHtml: req.body.bodyHtml || '',
      bodyText: req.body.bodyText || '',
    };

    // Ответ и пересылка заполняются сервером: получатели, тема с приставкой и
    // цитата должны выглядеть одинаково у всех.
    if (req.body.replyToId) {
      const { message, error } = await loadMessageForUser(req, req.body.replyToId);
      if (error) return res.status(error).json({ error: 'Исходное письмо недоступно' });

      payload.replyToId = message.id;
      const body = await MailMessageBody.findByPk(message.id);
      const quote = quoteOriginal(message, body);

      if (kind === 'reply') {
        const subject = message.subject || '';
        payload.subject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
        payload.toList = [{ address: message.fromEmail, name: message.fromName }];

        if (req.body.replyAll) {
          const [addresses] = await sequelize.query(`
            SELECT ma.role, ma.name, a.email FROM mail_message_addresses ma
            JOIN mail_addresses a ON a.id = ma."addressId"
            WHERE ma."messageId" = $1 AND ma.role IN ('to','cc')
          `, { bind: [message.id] });

          const account = await MailAccount.findByPk(accountId);
          // Себя из получателей вычищаем: ответить всем не значит ответить и
          // себе тоже.
          const others = addresses
            .filter((a) => a.email !== account.email && a.email !== message.fromEmail)
            .map((a) => ({ address: a.email, name: a.name }));
          payload.ccList = others;
        }

        payload.bodyHtml = quote.html;
        payload.bodyText = quote.text;
      }

      if (kind === 'forward') {
        const subject = message.subject || '';
        payload.subject = /^fwd:/i.test(subject) ? subject : `Fwd: ${subject}`;
        payload.bodyHtml = quote.html;
        payload.bodyText = quote.text;
      }
    }

    const draft = await MailDraft.create(payload);
    res.status(201).json({ draft });
  } catch (error) {
    console.error('❌ Почта: черновик не создался:', error);
    res.status(500).json({ error: 'Не удалось создать черновик' });
  }
});

// PUT /api/mail/drafts/:id
router.put('/drafts/:id', authenticate, async (req, res) => {
  try {
    const { draft, error } = await loadDraft(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Черновик не найден' });
    if (error === 403) return res.status(403).json({ error: 'Это не ваш черновик' });
    if (draft.status === 'sent') return res.status(400).json({ error: 'Письмо уже отправлено' });

    const patch = {};
    for (const field of ['subject', 'toList', 'ccList', 'bccList', 'bodyHtml', 'bodyText']) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }
    // Текстовая версия нужна получателям, у которых HTML отключён, и поисковым
    // роботам почтовых служб. Если интерфейс её не прислал — делаем сами.
    if (patch.bodyHtml !== undefined && req.body.bodyText === undefined) {
      patch.bodyText = htmlToPlain(patch.bodyHtml);
    }
    if (draft.status === 'error') patch.status = 'draft';

    await draft.update(patch);
    res.json({ ok: true, updatedAt: draft.updatedAt });
  } catch (error) {
    console.error('❌ Почта: черновик не сохранился:', error);
    res.status(500).json({ error: 'Не удалось сохранить черновик' });
  }
});

// DELETE /api/mail/drafts/:id
router.delete('/drafts/:id', authenticate, async (req, res) => {
  try {
    const { draft, error } = await loadDraft(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Черновик не найден' });
    if (error === 403) return res.status(403).json({ error: 'Это не ваш черновик' });

    // Приложенные файлы уходят вместе с черновиком: держать их без письма
    // незачем, а места они занимают.
    for (const att of draft.attachments || []) {
      if (att.storagePath) await fsp.unlink(path.join(STORE_ROOT, att.storagePath)).catch(() => {});
    }
    await draft.destroy();
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Почта: черновик не удалился:', error);
    res.status(500).json({ error: 'Не удалось удалить черновик' });
  }
});

// POST /api/mail/drafts/:id/attachments
router.post('/drafts/:id/attachments', authenticate, uploadAttachment.single('file'), async (req, res) => {
  try {
    const { draft, error } = await loadDraft(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Черновик не найден' });
    if (error === 403) return res.status(403).json({ error: 'Это не ваш черновик' });
    if (!req.file) return res.status(400).json({ error: 'Файл не пришёл' });

    const existing = draft.attachments || [];
    const totalSize = existing.reduce((sum, a) => sum + (a.size || 0), 0) + req.file.size;
    if (totalSize > 25 * 1024 * 1024) {
      return res.status(400).json({
        error: 'Вместе файлы весят больше 25 МБ — почтовые серверы такое письмо не пропустят',
      });
    }

    const id = crypto.randomUUID();
    const storagePath = path.join('outbox', draft.id, id);
    const abs = path.join(STORE_ROOT, storagePath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, req.file.buffer);

    const attachment = {
      id,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      storagePath,
    };

    await draft.update({ attachments: [...existing, attachment] });
    res.status(201).json({ attachment });
  } catch (error) {
    console.error('❌ Почта: вложение не приложилось:', error);
    res.status(500).json({ error: 'Не удалось приложить файл' });
  }
});

// DELETE /api/mail/drafts/:id/attachments/:attachmentId
router.delete('/drafts/:id/attachments/:attachmentId', authenticate, async (req, res) => {
  try {
    const { draft, error } = await loadDraft(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Черновик не найден' });
    if (error === 403) return res.status(403).json({ error: 'Это не ваш черновик' });

    const keep = (draft.attachments || []).filter((a) => a.id !== req.params.attachmentId);
    const gone = (draft.attachments || []).find((a) => a.id === req.params.attachmentId);
    if (gone?.storagePath) await fsp.unlink(path.join(STORE_ROOT, gone.storagePath)).catch(() => {});

    await draft.update({ attachments: keep });
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Почта: вложение не убралось:', error);
    res.status(500).json({ error: 'Не удалось убрать файл' });
  }
});

// POST /api/mail/drafts/:id/send
router.post('/drafts/:id/send', authenticate, async (req, res) => {
  try {
    const { draft, error } = await loadDraft(req, req.params.id);
    if (error === 404) return res.status(404).json({ error: 'Черновик не найден' });
    if (error === 403) return res.status(403).json({ error: 'Это не ваш черновик' });

    const access = await accessTo(req.user.id, draft.accountId);
    if (!access?.canSend) return res.status(403).json({ error: 'Отправка с этого ящика вам не разрешена' });

    const result = await sendDraft(draft.id, req.user.id);

    audit(req, {
      accountId: draft.accountId, messageId: draft.replyToId, action: 'send',
      detail: { subject: draft.subject, to: (draft.toList || []).map((r) => r.address || r) },
    });

    res.json(result);
  } catch (error) {
    // Отказ SMTP и упёршийся предел — это рабочие ответы формы, а не сбой
    // портала: человек должен увидеть причину и решить, что делать.
    console.warn('📬 Почта: письмо не отправилось —', error.message);
    res.status(400).json({ error: String(error.message || error) });
  }
});

// GET /api/mail/quota?accountId= — сколько писем ящик может отправить сегодня
router.get('/quota', authenticate, async (req, res) => {
  try {
    const accountId = req.query.accountId;
    if (!accountId) return res.status(400).json({ error: 'Нужен accountId' });
    if (!(await accessTo(req.user.id, accountId))) return res.status(403).json({ error: 'Нет доступа' });

    const used = await sentToday(accountId);
    res.json({
      used: used.byAccount,
      limit: DAILY_PER_ACCOUNT,
      left: Math.max(0, DAILY_PER_ACCOUNT - used.byAccount),
      maxRecipients: MAX_RECIPIENTS,
    });
  } catch (error) {
    console.error('❌ Почта: предел не посчитался:', error);
    res.status(500).json({ error: 'Не удалось посчитать предел' });
  }
});

// ══ Администрирование ═════════════════════════════════════════════════════

// Справочники лежат под почтовым правом, а не под /roles: человек, которому
// поручили раздавать доступ к ящикам, не обязан иметь право редактировать роли.
router.get('/admin/access-options', authenticate, requireMailAdmin, async (req, res) => {
  try {
    const [medCenters, roles] = await Promise.all([
      MedCenter.findAll({
        where: { isActive: true },
        attributes: ['id', 'name', 'displayName'],
        order: [['sortOrder', 'ASC'], ['name', 'ASC']],
      }),
      Role.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }),
    ]);
    res.json({ medCenters, roles });
  } catch (error) {
    console.error('❌ Почта: не отдались справочники группового доступа:', error);
    res.status(500).json({ error: 'Не удалось получить медцентры и роли' });
  }
});

// GET /api/mail/admin/accounts
router.get('/admin/accounts', authenticate, requireMailAdmin, async (req, res) => {
  try {
    const accounts = await MailAccount.findAll({
      order: [['sortOrder', 'ASC'], ['email', 'ASC']],
      include: [
        { model: MedCenter, as: 'medCenter', attributes: ['id', 'name'], required: false },
        {
          model: MailAccountUser,
          as: 'access',
          required: false,
          include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName'] }],
        },
        {
          model: MailAccountAccessRule,
          as: 'accessRules',
          required: false,
          include: [
            { model: MedCenter, as: 'medCenter', attributes: ['id', 'name', 'displayName'], required: false },
            { model: Role, as: 'role', attributes: ['id', 'name'], required: false },
          ],
        },
      ],
    });

    const [stats] = await sequelize.query(`
      SELECT "accountId",
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "bodyState" = 'pending')::int AS pending,
             COUNT(*) FILTER (WHERE NOT "isSeen")::int AS unread
      FROM mail_messages GROUP BY "accountId"
    `);
    const statsBy = new Map(stats.map((s) => [s.accountId, s]));

    // Число людей под правилом полезнее абстрактного «роль + филиал»: до
    // сохранения состава групп оно позволяет заметить пустое пересечение.
    const [ruleCounts] = await sequelize.query(`
      SELECT rule.id, COUNT(DISTINCT u.id)::int AS count
      FROM mail_account_access_rules rule
      JOIN users u ON u."isActive" AND u."deletedAt" IS NULL
        AND (
          rule."medCenterId" IS NULL
          OR EXISTS (
            SELECT 1 FROM user_med_centers umc
            WHERE umc."userId" = u.id AND umc."medCenterId" = rule."medCenterId"
          )
        )
        AND (
          rule."roleId" IS NULL
          OR u."roleId" = rule."roleId"
          OR EXISTS (
            SELECT 1 FROM user_roles ur
            WHERE ur."userId" = u.id AND ur."roleId" = rule."roleId"
          )
        )
      GROUP BY rule.id
    `);
    const ruleCountBy = new Map(ruleCounts.map((row) => [row.id, Number(row.count)]));

    res.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        email: a.email,
        displayName: a.displayName,
        login: a.login,
        medCenter: a.medCenter,
        imapHost: a.imapHost,
        imapPort: a.imapPort,
        imapSecure: a.imapSecure,
        smtpHost: a.smtpHost,
        smtpPort: a.smtpPort,
        smtpSecure: a.smtpSecure,
        signature: a.signature,
        isActive: a.isActive,
        syncState: a.syncState,
        lastSyncAt: a.lastSyncAt,
        lastError: a.lastError,
        capabilities: a.capabilities,
        sortOrder: a.sortOrder,
        stats: statsBy.get(a.id) || { total: 0, pending: 0, unread: 0 },
        access: (a.access || []).map((x) => ({
          id: x.id,
          userId: x.userId,
          user: x.user ? { id: x.user.id, username: x.user.username, displayName: x.user.displayName } : null,
          canSend: x.canSend,
          canDelete: x.canDelete,
          isDefault: x.isDefault,
        })),
        accessRules: (a.accessRules || []).map((rule) => ({
          id: rule.id,
          medCenterId: rule.medCenterId,
          medCenter: rule.medCenter ? {
            id: rule.medCenter.id,
            name: rule.medCenter.name,
            displayName: rule.medCenter.displayName,
          } : null,
          roleId: rule.roleId,
          role: rule.role ? { id: rule.role.id, name: rule.role.name } : null,
          canSend: rule.canSend,
          canDelete: rule.canDelete,
          matchedUsers: ruleCountBy.get(rule.id) || 0,
        })),
      })),
    });
  } catch (error) {
    console.error('❌ Почта: не отдался список ящиков для админки:', error);
    res.status(500).json({ error: 'Не удалось получить ящики' });
  }
});

// POST /api/mail/admin/accounts
router.post('/admin/accounts', authenticate, requireMailAdmin, [
  body('email').isEmail().withMessage('Нужен корректный адрес ящика'),
  body('displayName').trim().notEmpty().withMessage('Нужно название ящика'),
  body('password').notEmpty().withMessage('Нужен пароль ящика'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const email = String(req.body.email).toLowerCase().trim();
    if (await MailAccount.findOne({ where: { email } })) {
      return res.status(400).json({ error: `Ящик ${email} уже заведён` });
    }

    const secret = encryptPassword(String(req.body.password));
    const account = await MailAccount.create({
      email,
      displayName: String(req.body.displayName).trim(),
      login: String(req.body.login || email).trim(),
      medCenterId: req.body.medCenterId || null,
      imapHost: req.body.imapHost || undefined,
      imapPort: req.body.imapPort || undefined,
      imapSecure: req.body.imapSecure !== false,
      smtpHost: req.body.smtpHost || undefined,
      smtpPort: req.body.smtpPort || undefined,
      smtpSecure: req.body.smtpSecure !== false,
      sortOrder: req.body.sortOrder ?? 100,
      createdBy: req.user.id,
      ...secret,
    });

    audit(req, { accountId: account.id, action: 'account-create', detail: { email } });
    res.status(201).json({ id: account.id, email: account.email });
  } catch (error) {
    console.error('❌ Почта: ящик не завёлся:', error);
    res.status(500).json({ error: error.message || 'Не удалось завести ящик' });
  }
});

// PUT /api/mail/admin/accounts/:id — пароль меняется только если прислан
router.put('/admin/accounts/:id', authenticate, requireMailAdmin, async (req, res) => {
  try {
    const account = await MailAccount.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Ящик не найден' });

    const patch = {};
    for (const field of ['displayName', 'login', 'imapHost', 'imapPort', 'imapSecure', 'smtpHost', 'smtpPort', 'smtpSecure', 'sortOrder', 'isActive', 'signature']) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }
    if (req.body.medCenterId !== undefined) patch.medCenterId = req.body.medCenterId || null;

    // Пустое поле пароля в форме означает «не трогать», а не «стереть»: иначе
    // любое исправление опечатки в названии обнуляло бы доступ к ящику.
    if (req.body.password) Object.assign(patch, encryptPassword(String(req.body.password)));

    await account.update(patch);
    audit(req, { accountId: account.id, action: 'account-update', detail: { fields: Object.keys(patch) } });
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Почта: ящик не обновился:', error);
    res.status(500).json({ error: 'Не удалось сохранить ящик' });
  }
});

// POST /api/mail/admin/accounts/:id/test — проверка подключения
router.post('/admin/accounts/:id/test', authenticate, requireMailAdmin, async (req, res) => {
  try {
    const account = await MailAccount.scope('withSecret').findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Ящик не найден' });

    const result = await testAccount(account);
    await account.update({ capabilities: result.capabilities, lastError: null, lastErrorAt: null });

    res.json(result);
  } catch (error) {
    // Отказ сервера — это рабочий ответ формы, а не сбой портала: чаще всего
    // просто опечатка в пароле, и администратор должен увидеть, какая именно.
    await MailAccount.update(
      { lastError: String(error.message || error).slice(0, 2000), lastErrorAt: new Date() },
      { where: { id: req.params.id } }
    ).catch(() => {});
    res.status(200).json({ ok: false, error: String(error.message || error) });
  }
});

// POST /api/mail/admin/accounts/:id/sync — синхронизировать сейчас
router.post('/admin/accounts/:id/sync', authenticate, requireMailAdmin, async (req, res) => {
  try {
    const account = await MailAccount.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Ящик не найден' });

    // Отвечаем сразу: полный проход по ящику с пятью тысячами писем идёт
    // минутами, и держать ради него открытый запрос незачем.
    res.json({ ok: true, started: true });

    syncAccount(account.id).catch((err) => {
      console.error(`📬 Почта: ручная синхронизация ${account.email} не прошла —`, err.message);
    });
  } catch (error) {
    console.error('❌ Почта: синхронизация не запустилась:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Не удалось запустить синхронизацию' });
  }
});

// DELETE /api/mail/admin/accounts/:id
router.delete('/admin/accounts/:id', authenticate, requireMailAdmin, async (req, res) => {
  try {
    const account = await MailAccount.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Ящик не найден' });

    const total = await MailMessage.count({ where: { accountId: account.id } });
    const email = account.email;
    await account.destroy();

    audit(req, { action: 'account-delete', detail: { email, messages: total } });
    res.json({ ok: true, removed: total });
  } catch (error) {
    console.error('❌ Почта: ящик не удалился:', error);
    res.status(500).json({ error: 'Не удалось удалить ящик' });
  }
});

// ── Доступы ───────────────────────────────────────────────────────────────

// POST /api/mail/admin/accounts/:id/access — { userId, canSend, canDelete }
router.post('/admin/accounts/:id/access', authenticate, requireMailAdmin, async (req, res) => {
  try {
    const account = await MailAccount.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Ящик не найден' });

    const user = await User.findByPk(req.body.userId);
    if (!user) return res.status(404).json({ error: 'Сотрудник не найден' });

    const [access] = await MailAccountUser.findOrCreate({
      where: { accountId: account.id, userId: user.id },
      defaults: {
        canSend: Boolean(req.body.canSend),
        canDelete: Boolean(req.body.canDelete),
        grantedBy: req.user.id,
      },
    });

    if (req.body.canSend !== undefined || req.body.canDelete !== undefined) {
      await access.update({
        canSend: Boolean(req.body.canSend),
        canDelete: Boolean(req.body.canDelete),
      });
    }

    audit(req, { accountId: account.id, action: 'access-grant',
      detail: { user: user.username, canSend: access.canSend, canDelete: access.canDelete } });

    res.json({ ok: true, id: access.id });
  } catch (error) {
    console.error('❌ Почта: доступ не выдался:', error);
    res.status(500).json({ error: 'Не удалось выдать доступ' });
  }
});

// DELETE /api/mail/admin/accounts/:id/access/:userId
router.delete('/admin/accounts/:id/access/:userId', authenticate, requireMailAdmin, async (req, res) => {
  try {
    const removed = await MailAccountUser.destroy({
      where: { accountId: req.params.id, userId: req.params.userId },
    });
    if (!removed) return res.status(404).json({ error: 'Доступа и так нет' });

    audit(req, { accountId: req.params.id, action: 'access-revoke', detail: { userId: req.params.userId } });
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Почта: доступ не отозвался:', error);
    res.status(500).json({ error: 'Не удалось отозвать доступ' });
  }
});

// POST /api/mail/admin/accounts/:id/access-rules
// { medCenterId?, roleId?, canSend, canDelete }; если заданы оба фильтра, это И.
router.post('/admin/accounts/:id/access-rules', authenticate, requireMailAdmin, [
  body('medCenterId').optional({ nullable: true, checkFalsy: true }).isUUID(),
  body('roleId').optional({ nullable: true, checkFalsy: true }).isUUID(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Некорректная группа доступа' });

    const account = await MailAccount.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Ящик не найден' });

    const medCenterId = req.body.medCenterId || null;
    const roleId = req.body.roleId || null;
    if (!medCenterId && !roleId) {
      return res.status(400).json({ error: 'Выберите медцентр, роль или оба условия' });
    }

    const [medCenter, role] = await Promise.all([
      medCenterId ? MedCenter.findByPk(medCenterId, { attributes: ['id', 'name'] }) : null,
      roleId ? Role.findByPk(roleId, { attributes: ['id', 'name'] }) : null,
    ]);
    if (medCenterId && !medCenter) return res.status(404).json({ error: 'Медцентр не найден' });
    if (roleId && !role) return res.status(404).json({ error: 'Роль не найдена' });

    const where = { accountId: account.id, medCenterId, roleId };
    const [rule, created] = await MailAccountAccessRule.findOrCreate({
      where,
      defaults: {
        canSend: Boolean(req.body.canSend),
        canDelete: Boolean(req.body.canDelete),
        grantedBy: req.user.id,
      },
    });
    if (!created) {
      await rule.update({
        canSend: Boolean(req.body.canSend),
        canDelete: Boolean(req.body.canDelete),
        grantedBy: req.user.id,
      });
    }

    audit(req, {
      accountId: account.id,
      action: created ? 'access-rule-create' : 'access-rule-update',
      detail: {
        medCenter: medCenter?.name || null,
        role: role?.name || null,
        canSend: rule.canSend,
        canDelete: rule.canDelete,
      },
    });

    res.json({ ok: true, id: rule.id });
  } catch (error) {
    console.error('❌ Почта: групповое правило не сохранилось:', error);
    res.status(500).json({ error: 'Не удалось сохранить групповое правило' });
  }
});

router.delete('/admin/accounts/:id/access-rules/:ruleId', authenticate, requireMailAdmin, async (req, res) => {
  try {
    const removed = await MailAccountAccessRule.destroy({
      where: { id: req.params.ruleId, accountId: req.params.id },
    });
    if (!removed) return res.status(404).json({ error: 'Правило не найдено' });

    audit(req, {
      accountId: req.params.id,
      action: 'access-rule-revoke',
      detail: { ruleId: req.params.ruleId },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('❌ Почта: групповое правило не удалилось:', error);
    res.status(500).json({ error: 'Не удалось удалить групповое правило' });
  }
});

// GET /api/mail/admin/audit?accountId=&limit=
router.get('/admin/audit', authenticate, requireMailAdmin, async (req, res) => {
  try {
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 100, maxLimit: 500 });
    const where = {};
    if (req.query.accountId) where.accountId = req.query.accountId;
    if (req.query.action) where.action = req.query.action;

    const rows = await MailAudit.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      include: [{ model: User, as: 'user', attributes: ['id', 'username', 'displayName'], required: false }],
    });

    res.json({ entries: rows });
  } catch (error) {
    console.error('❌ Почта: не отдался журнал:', error);
    res.status(500).json({ error: 'Не удалось получить журнал' });
  }
});

module.exports = router;
