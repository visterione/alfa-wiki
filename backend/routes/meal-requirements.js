'use strict';

/**
 * Порционные требования на питание больных.
 *
 * Цепочка целиком: постовая медсестра заполняет таблицу палат на завтра →
 * жмёт «Отправить в буфет» → сервер рисует бланк картинкой и бот кладёт её в
 * общий чат буфета. Раньше эту бумажку фотографировали и слали в группу руками.
 *
 * Адрес доставки (бот и чат буфета) берётся только из .env и нигде в интерфейсе
 * не выбирается: чат один на всю больницу, и возможность указать другой — это
 * возможность отправить список пациентов не туда.
 *
 * Права на отделение держатся на уровне вики-страницы (Page.allowedRoles): у
 * каждого отделения своя страница со своим списком ролей. Здесь остаётся
 * проверка, что отделение вообще существует, — когда отделений станет три,
 * сюда же ляжет сопоставление «роль → отделение», чтобы адрес чужого отделения
 * нельзя было подставить руками в запрос.
 */

const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { Op } = require('sequelize');
const sharp = require('sharp');

const { MealRequirementDay, MealRequirementPatient, Setting, BotToken, ChatFile, sequelize } = require('../models');
const { authenticate } = require('../middleware/auth');
const { DEFAULT_DEPARTMENTS, getDefaultDepartment, parseRooms } = require('../config/mealDepartments');
const mealDoc = require('../services/mealRequirementDoc');
const { sendBotMessage, BotMessengerError } = require('../services/botMessenger');
const fileAccess = require('../services/fileAccess');
const { logReportHistory } = require('../utils/reportHistory');

const router = express.Router();

// Название отделения и список палат: правит администратор со страницы, а не выкат
const SETTINGS_KEY = 'mealDepartments';

// Картинка уходит вложением в чат, поэтому лежит там же, где остальные вложения:
// каталог закрыт chatFileGuard, и ФИО пациентов не читаются по прямой ссылке.
const ATTACH_DIR = path.join(__dirname, '..', 'uploads', 'chat-attachments');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// ── Отделение ─────────────────────────────────────────────────────────────────

async function loadOverrides() {
  const setting = await Setting.findByPk(SETTINGS_KEY);
  return (setting && setting.value) || {};
}

/**
 * Отделение: значения по умолчанию из config/mealDepartments.js, поверх —
 * настройка администратора. Возвращает null, если ключ отделения незнакомый.
 */
async function loadDepartment(req, res) {
  const key = cleanText(req.query.department || (req.body && req.body.department));
  const base = getDefaultDepartment(key);
  if (!base) {
    res.status(400).json({ error: 'Неизвестное отделение' });
    return null;
  }

  const override = (await loadOverrides())[base.key] || {};
  return {
    key: base.key,
    title: cleanText(override.title) || base.title,
    rooms: Array.isArray(override.rooms) && override.rooms.length ? override.rooms : base.rooms
  };
}

function resolveDate(req, res) {
  const raw = cleanText(req.query.date || (req.body && req.body.date));
  if (!ISO_DATE.test(raw)) {
    res.status(400).json({ error: 'Дата должна быть в формате ГГГГ-ММ-ДД' });
    return null;
  }
  return raw;
}

// Строки таблицы всегда пересобираем по списку палат отделения: каркас задаёт
// настройка, клиент присылает только содержимое ячеек. Иначе кривой запрос мог
// бы добавить палату, которой в отделении нет, или потерять существующую.
//
// Номер палаты может повторяться (двухместную расписывают по строке на койку),
// поэтому строки не сопоставляются по номеру, а разбираются очередью: на
// первую «309» в каркасе ложится первая присланная «309», на вторую — вторая.
// Так строки не схлопываются в одну и переживают вставку палаты в середину
// списка.
function normalizeEntries(department, incoming) {
  const byRoom = new Map();
  (Array.isArray(incoming) ? incoming : []).forEach(row => {
    if (!row || !cleanText(row.room)) return;
    const key = cleanText(row.room);
    if (!byRoom.has(key)) byRoom.set(key, []);
    byRoom.get(key).push(row);
  });

  return department.rooms.map(room => {
    const queue = byRoom.get(room);
    const row = (queue && queue.shift()) || {};
    return {
      room,
      // Перевод строки — разделитель пациентов в одной палате, его сохраняем
      patients: String(row.patients == null ? '' : row.patients).replace(/\r\n/g, '\n').trim().slice(0, 500),
      diet: cleanText(row.diet).slice(0, 50),
      breakfast: cleanText(row.breakfast).slice(0, 50),
      lunch: cleanText(row.lunch).slice(0, 50),
      dinner: cleanText(row.dinner).slice(0, 50)
    };
  });
}

function emptyEntries(department) {
  return normalizeEntries(department, []);
}

function entriesEqual(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function totals(entries) {
  return {
    breakfast: mealDoc.sumMeal(entries, 'breakfast'),
    lunch: mealDoc.sumMeal(entries, 'lunch'),
    dinner: mealDoc.sumMeal(entries, 'dinner')
  };
}

function dayToJson(day, department) {
  const entries = day && Array.isArray(day.entries) && day.entries.length
    ? day.entries
    : emptyEntries(department);
  const sent = day && Array.isArray(day.sentEntries) ? day.sentEntries : null;

  return {
    department: department.key,
    departmentTitle: department.title,
    date: day ? day.reportDate : null,
    entries,
    status: !sent ? 'draft' : (entriesEqual(entries, sent) ? 'sent' : 'changed'),
    sentVersion: day ? day.sentVersion : 0,
    sentAt: day ? day.sentAt : null,
    nurseName: day ? day.nurseName : null,
    totals: totals(entries)
  };
}

async function findDay(department, date) {
  return MealRequirementDay.findOne({ where: { department: department.key, reportDate: date } });
}

// Словарь подсказок пополняем именами из сохранённого дня. Дубли гасит
// уникальный индекс по (отделение, ФИО в нижнем регистре).
async function rememberPatients(department, entries) {
  const names = new Set();
  (entries || []).forEach(row => {
    String(row.patients || '').split('\n').forEach(line => {
      const name = line.trim().replace(/\s+/g, ' ');
      if (name.length >= 3) names.add(name.slice(0, 200));
    });
  });
  if (!names.size) return;

  const now = new Date();
  for (const name of names) {
    try {
      const [row, created] = await MealRequirementPatient.findOrCreate({
        where: { department: department.key, name },
        defaults: { department: department.key, name, lastUsedAt: now }
      });
      if (!created) await row.update({ lastUsedAt: now });
    } catch (err) {
      // Регистр мог отличаться — уникальный индекс по LOWER(name) это отсечёт.
      // Подсказка не стоит того, чтобы из-за неё падало сохранение дня.
      if (err.name !== 'SequelizeUniqueConstraintError') {
        console.error('[meal] remember patient failed:', err.message);
      }
    }
  }
}

// ── Справочники и настройка отделения ─────────────────────────────────────────

router.get('/whoami', authenticate, (req, res) => {
  res.json({
    isAdmin: !!req.user.isAdmin,
    displayName: req.user.displayName || req.user.username || ''
  });
});

router.get('/config', authenticate, async (req, res) => {
  try {
    const department = await loadDepartment(req, res);
    if (!department) return;
    res.json({
      department: department.key,
      title: department.title,
      rooms: department.rooms,
      isAdmin: !!req.user.isAdmin,
      departments: Object.values(DEFAULT_DEPARTMENTS).map(function(d) { return { key: d.key, title: d.title }; })
    });
  } catch (error) {
    console.error('[meal] config error:', error);
    res.status(500).json({ error: 'Не удалось загрузить настройки отделения' });
  }
});

router.put('/config', authenticate, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Нет доступа' });

    const department = await loadDepartment(req, res);
    if (!department) return;

    const title = cleanText(req.body.title).slice(0, 120);
    const rooms = parseRooms(req.body.rooms);
    if (!title) return res.status(400).json({ error: 'Название отделения не может быть пустым' });
    if (!rooms.length) return res.status(400).json({ error: 'Список палат не может быть пустым' });

    const overrides = await loadOverrides();
    overrides[department.key] = { title, rooms };

    const existing = await Setting.findByPk(SETTINGS_KEY);
    if (existing) await existing.update({ value: overrides });
    else await Setting.create({
      key: SETTINGS_KEY,
      value: overrides,
      description: 'Порционные требования: названия отделений и списки палат'
    });

    res.json({ department: department.key, title: title, rooms: rooms });
  } catch (error) {
    console.error('[meal] config save error:', error);
    res.status(500).json({ error: 'Не удалось сохранить настройки отделения' });
  }
});

// ── День ──────────────────────────────────────────────────────────────────────

router.get('/day', authenticate, async (req, res) => {
  try {
    const department = await loadDepartment(req, res);
    if (!department) return;
    const date = resolveDate(req, res);
    if (!date) return;

    const day = await findDay(department, date);
    res.json(dayToJson(day, department));
  } catch (error) {
    console.error('[meal] get day error:', error);
    res.status(500).json({ error: 'Не удалось загрузить день' });
  }
});

router.put('/day', authenticate, async (req, res) => {
  try {
    const department = await loadDepartment(req, res);
    if (!department) return;
    const date = resolveDate(req, res);
    if (!date) return;

    const entries = normalizeEntries(department, req.body.entries);
    let day = await findDay(department, date);

    if (day) {
      await day.update({ entries, updatedBy: req.user.id });
    } else {
      day = await MealRequirementDay.create({
        department: department.key,
        reportDate: date,
        entries,
        createdBy: req.user.id,
        updatedBy: req.user.id
      });
    }

    await rememberPatients(department, entries);
    res.json(dayToJson(day, department));
  } catch (error) {
    console.error('[meal] save day error:', error);
    res.status(500).json({ error: 'Не удалось сохранить день' });
  }
});

// Список пациентов предыдущего дня — чтобы не набирать состав палат заново:
// за сутки он меняется на одного-двух человек.
router.get('/previous', authenticate, async (req, res) => {
  try {
    const department = await loadDepartment(req, res);
    if (!department) return;
    const date = resolveDate(req, res);
    if (!date) return;

    const previous = await MealRequirementDay.findOne({
      where: { department: department.key, reportDate: { [Op.lt]: date } },
      order: [['reportDate', 'DESC']]
    });

    if (!previous) return res.json({ found: false });
    res.json({
      found: true,
      date: previous.reportDate,
      entries: normalizeEntries(department, previous.entries)
    });
  } catch (error) {
    console.error('[meal] previous day error:', error);
    res.status(500).json({ error: 'Не удалось загрузить предыдущий день' });
  }
});

// ── Архив ─────────────────────────────────────────────────────────────────────

router.get('/days', authenticate, async (req, res) => {
  try {
    const department = await loadDepartment(req, res);
    if (!department) return;

    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { rows, count } = await MealRequirementDay.findAndCountAll({
      where: { department: department.key },
      order: [['reportDate', 'DESC']],
      limit,
      offset
    });

    res.json({
      total: count,
      rows: rows.map(function(day) {
        return {
          date: day.reportDate,
          status: dayToJson(day, department).status,
          sentVersion: day.sentVersion,
          sentAt: day.sentAt,
          nurseName: day.nurseName,
          totals: totals(day.sentEntries || day.entries)
        };
      })
    });
  } catch (error) {
    console.error('[meal] archive error:', error);
    res.status(500).json({ error: 'Не удалось загрузить архив' });
  }
});

/**
 * PDF бланка. По умолчанию печатается отправленная версия — именно она лежит в
 * буфете; черновик (source=draft) нужен, только чтобы распечатать ещё не
 * отправленный день.
 */
router.get('/day/pdf', authenticate, async (req, res) => {
  try {
    const department = await loadDepartment(req, res);
    if (!department) return;
    const date = resolveDate(req, res);
    if (!date) return;

    const day = await findDay(department, date);
    const useDraft = cleanText(req.query.source) === 'draft' || !day || !Array.isArray(day.sentEntries);
    const entries = day
      ? (useDraft ? day.entries : day.sentEntries)
      : emptyEntries(department);

    const pdf = await mealDoc.renderPdf({
      department,
      reportDate: date,
      entries: Array.isArray(entries) && entries.length ? entries : emptyEntries(department),
      nurseName: day ? day.nurseName : '',
      correction: !useDraft && day && day.sentVersion > 1
        ? 'Исправлено, версия ' + day.sentVersion
        : ''
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="meal-' + department.key + '-' + date + '.pdf"');
    res.send(pdf);
  } catch (error) {
    console.error('[meal] pdf error:', error);
    res.status(500).json({ error: 'Не удалось сформировать PDF' });
  }
});

// ── Подсказки при вводе ───────────────────────────────────────────────────────

// Отдаём только совпадения по началу строки и не больше десятка: за год в
// словаре накопятся тысячи фамилий, и вываливать их в список целиком нельзя.
router.get('/patients', authenticate, async (req, res) => {
  try {
    const department = await loadDepartment(req, res);
    if (!department) return;

    const q = cleanText(req.query.q);
    if (q.length < 2) return res.json([]);

    const rows = await sequelize.query(`
      SELECT name
      FROM meal_requirement_patients
      WHERE department = :department
        AND LOWER(name) LIKE :prefix
      ORDER BY "lastUsedAt" DESC
      LIMIT 10
    `, {
      replacements: {
        department: department.key,
        prefix: q.toLowerCase().replace(/[%_\\]/g, function(ch) { return '\\' + ch; }) + '%'
      },
      type: sequelize.QueryTypes.SELECT
    });

    res.json(rows.map(function(r) { return r.name; }));
  } catch (error) {
    console.error('[meal] patients error:', error);
    res.status(500).json({ error: 'Не удалось загрузить подсказки' });
  }
});

// Подсказки по столам: свободный ввод, но набирать «15» заново каждый день не
// нужно. Дней в таблице сотни, не миллионы, поэтому считаем прямо по JSONB.
router.get('/diets', authenticate, async (req, res) => {
  try {
    const department = await loadDepartment(req, res);
    if (!department) return;

    const rows = await sequelize.query(`
      SELECT entry->>'diet' AS diet, COUNT(*) AS uses
      FROM meal_requirement_days d, jsonb_array_elements(d.entries) entry
      WHERE d.department = :department
        AND COALESCE(entry->>'diet', '') <> ''
      GROUP BY 1
      ORDER BY uses DESC
      LIMIT 20
    `, {
      replacements: { department: department.key },
      type: sequelize.QueryTypes.SELECT
    });

    res.json(rows.map(function(r) { return r.diet; }));
  } catch (error) {
    console.error('[meal] diets error:', error);
    res.status(500).json({ error: 'Не удалось загрузить подсказки по столам' });
  }
});

// ── Отправка в буфет ──────────────────────────────────────────────────────────

/**
 * Бот и чат — из окружения. MEAL_BOT_USERNAME это username бота на портале
 * (без @), MEAL_CHAT_ID — идентификатор группового чата буфета (UUID или
 * целочисленный, как в мессенджере).
 */
async function loadDelivery() {
  const botUsername = cleanText(process.env.MEAL_BOT_USERNAME).replace(/^@/, '');
  const chatId = cleanText(process.env.MEAL_CHAT_ID);
  if (!botUsername || !chatId) return null;

  const bot = await BotToken.findOne({ where: { username: botUsername, isActive: true } });
  if (!bot) return null;

  return { botId: bot.id, chatId };
}

// Подпись к картинке — одной строкой. Всё остальное (итоги, состав палат) и так
// написано в самом бланке, а в ленте чата дублирующий текст только отжимает
// картинку вниз.
function messageText({ department, date, version }) {
  return mealDoc.formatDateShort(date) + ' | ' + department.title +
    (version > 1 ? ' | исправлено' : '');
}

router.post('/day/send', authenticate, async (req, res) => {
  try {
    const department = await loadDepartment(req, res);
    if (!department) return;
    const date = resolveDate(req, res);
    if (!date) return;

    const delivery = await loadDelivery();
    if (!delivery) {
      return res.status(400).json({
        error: 'Не настроена доставка в буфет (MEAL_BOT_USERNAME и MEAL_CHAT_ID) — обратитесь к администратору портала'
      });
    }

    const entries = normalizeEntries(department, req.body.entries);
    const sums = totals(entries);
    if (!sums.breakfast && !sums.lunch && !sums.dinner) {
      return res.status(400).json({ error: 'В требовании нет ни одной порции' });
    }

    let day = await findDay(department, date);
    const version = (day ? day.sentVersion : 0) + 1;
    const nurseName = cleanText(req.user.displayName) || cleanText(req.user.username);

    const png = await mealDoc.renderPng({
      department,
      reportDate: date,
      entries,
      nurseName,
      correction: version > 1 ? 'Исправлено, версия ' + version + ' — заменяет предыдущее' : ''
    });

    // Имя со случайным хвостом: файл лежит в общем каталоге вложений, и
    // предсказуемое имя означало бы предсказуемую ссылку на ФИО пациентов.
    const filename = 'meal-' + department.key + '-' + date + '-v' + version + '-' + crypto.randomBytes(6).toString('hex') + '.png';
    const thumbName = 'thumb-' + filename;
    await fs.mkdir(ATTACH_DIR, { recursive: true });
    await fs.writeFile(path.join(ATTACH_DIR, filename), png);
    await sharp(png).resize(200, 200, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(path.join(ATTACH_DIR, thumbName));

    const attachment = {
      id: Date.now().toString(),
      name: 'Порционное требование ' + mealDoc.formatDateShort(date) + '.png',
      path: 'uploads/chat-attachments/' + filename,
      thumbnailPath: 'uploads/chat-attachments/' + thumbName,
      mimeType: 'image/png',
      size: png.length
    };

    let sent;
    try {
      sent = await sendBotMessage({
        botId: delivery.botId,
        chatId: delivery.chatId,
        text: messageText({ department, date, version }),
        attachments: [attachment],
        io: req.app.get('io')
      });
    } catch (err) {
      // Файл уже на диске, но сообщения нет — убираем за собой, иначе каталог
      // вложений будет копить картинки, до которых никто никогда не доберётся.
      await fs.unlink(path.join(ATTACH_DIR, filename)).catch(function() {});
      await fs.unlink(path.join(ATTACH_DIR, thumbName)).catch(function() {});
      if (err instanceof BotMessengerError) {
        const hint = {
          invalid_token: 'бот не найден или отключён',
          chat_not_found: 'чат буфета не найден',
          not_a_member: 'бот не состоит в чате буфета'
        }[err.code] || err.message;
        return res.status(400).json({ error: 'Не удалось отправить: ' + hint });
      }
      throw err;
    }

    // Пока файл не привязан к чату, chatFileGuard не пустит к нему участников:
    // право на вложение выводится из членства в чате (services/fileAccess.js).
    await ChatFile.bulkCreate(
      [filename, thumbName].map(function(name) {
        return { filename: name, chatId: sent.chat.id, messageId: sent.messageUuid };
      }),
      { ignoreDuplicates: true }
    ).catch(function(err) { console.error('[meal] register chat file failed:', err.message); });
    [filename, thumbName].forEach(fileAccess.invalidateFile);

    const patch = {
      entries,
      sentEntries: entries,
      status: 'sent',
      sentVersion: version,
      sentAt: new Date(),
      sentBy: req.user.id,
      nurseName,
      updatedBy: req.user.id
    };

    if (day) await day.update(patch);
    else day = await MealRequirementDay.create({ department: department.key, reportDate: date, createdBy: req.user.id, ...patch });

    await rememberPatients(department, entries);

    logReportHistory(req, {
      source: 'meal',
      event: version > 1 ? 'update' : 'create',
      summary: 'Порционное требование на ' + mealDoc.formatDateShort(date) + ' отправлено в буфет' +
        (version > 1 ? ' (исправление, версия ' + version + ')' : '')
    });

    res.json({ ...dayToJson(day, department), messageId: sent.messageId });
  } catch (error) {
    console.error('[meal] send error:', error);
    res.status(500).json({ error: 'Не удалось отправить требование' });
  }
});

module.exports = router;
