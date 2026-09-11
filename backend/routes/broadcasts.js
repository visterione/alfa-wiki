'use strict';

/**
 * Рекламные рассылки подписчикам ботов (ver. 8.07).
 *
 * У раздела собственное гранулярное право: сотруднику можно разрешить готовить
 * анонсы, не открывая настройки ботов и служебных уведомлений.
 *
 * Отправляет не этот контур, а движок в процессе notifier. Маршрут только
 * переводит рассылку в работу: две тысячи сообщений идут минутами, и держать
 * ради них открытым HTTP-запрос значит потерять рассылку на первом же таймауте.
 */

const express = require('express');
const multer = require('multer');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const { MedCenter, MessengerBot } = require('../models');
const broadcasts = require('../services/broadcasts');

const router = express.Router();
const requireAnnouncements = requireAdminAccess('announcements');

const STATUS_BY_CODE = {
  not_found: 404,
  bad_state: 400,
  empty_audience: 400
};

function fail(res, err, where) {
  if (err.name === 'BroadcastError') {
    return res.status(STATUS_BY_CODE[err.code] || 400).json({ error: err.message, code: err.code });
  }
  // Ошибка канала — это ответ мессенджера, а не наша авария: показываем как есть,
  // иначе составитель видит «500» там, где написано «бот заблокирован».
  if (err.name === 'ChannelError') {
    return res.status(400).json({ error: err.message, code: err.code });
  }
  console.error(`[broadcasts] ${where}:`, err);
  return res.status(500).json({ error: 'Internal server error' });
}

// Картинка держится в памяти: файл уходит в мессенджер телом запроса, и класть
// его на диск только ради того, чтобы тут же прочитать обратно, незачем.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Расширение к делу не относится — смотрим на тип. Картинка уходит в чужой
    // мессенджер, и присланный под видом jpg исполняемый файл нам ни к чему.
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Картинка должна быть JPEG, PNG или WebP'));
  }
});

// ── Справочники для формы ─────────────────────────────────────────────────

/**
 * Медцентры, по которым вообще есть кому рассылать. Показываем все, у которых
 * заведён бот, и отдельно говорим, у скольких он есть: медцентр без бота в
 * списке выглядел бы как забытая галка, а это настройка, а не недосмотр.
 */
router.get('/sources', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const centers = await MedCenter.findAll({
      where: { servesPatients: true },
      attributes: ['id', 'name', 'displayName'],
      order: [['name', 'ASC']]
    });
    const bots = await MessengerBot.findAll({
      where: { isActive: true },
      attributes: ['id', 'platform', 'medCenterId', 'username']
    });

    res.json(centers.map(c => ({
      id: c.id,
      name: c.displayName || c.name,
      bots: bots.filter(b => b.medCenterId === c.id)
        .map(b => ({ id: b.id, platform: b.platform, username: b.username }))
    })));
  } catch (err) {
    fail(res, err, 'sources');
  }
});

// Размер аудитории до отправки. Спрашивается на каждое движение галок, поэтому
// возвращает только цифры.
router.post('/audience', authenticate, requireAnnouncements, async (req, res) => {
  try {
    res.json(await broadcasts.audienceSize(req.body.medCenterIds || []));
  } catch (err) {
    fail(res, err, 'audience');
  }
});

// ── Рассылки ──────────────────────────────────────────────────────────────

router.get('/', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const rows = await broadcasts.list({ templates: req.query.kind === 'templates' });
    res.json(await Promise.all(rows.map(r => broadcasts.withCounts(r))));
  } catch (err) {
    fail(res, err, 'list');
  }
});

router.get('/:id', authenticate, requireAnnouncements, async (req, res) => {
  try {
    res.json(await broadcasts.withCounts(await broadcasts.get(req.params.id)));
  } catch (err) {
    fail(res, err, 'get');
  }
});

router.post('/', authenticate, requireAnnouncements, async (req, res) => {
  try {
    res.status(201).json(await broadcasts.create(req.body, req.user.id));
  } catch (err) {
    fail(res, err, 'create');
  }
});

router.put('/:id', authenticate, requireAnnouncements, async (req, res) => {
  try {
    res.json(await broadcasts.update(req.params.id, req.body));
  } catch (err) {
    fail(res, err, 'update');
  }
});

router.delete('/:id', authenticate, requireAnnouncements, async (req, res) => {
  try {
    await broadcasts.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'remove');
  }
});

// Картинка отдельным запросом, а не полем формы: она приходит один раз, а
// текст и галки правятся десяток раз подряд.
function uploadImage(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    // Ошибка multer — это ответ пользователю («не та порода файла», «слишком
    // большой»), а не наша авария. Через общий fail она стала бы пятисоткой.
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Картинка больше 10 МБ'
      : (err.message || 'Не удалось принять файл');
    res.status(400).json({ error: message });
  });
}

router.post('/:id/image', authenticate, requireAnnouncements, uploadImage, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не приложен' });

    const broadcast = await broadcasts.get(req.params.id);
    if (broadcast.status !== 'draft') {
      return res.status(400).json({ error: 'Рассылку уже отправляли — правится только черновик' });
    }

    const imagePath = await broadcasts.saveImage(req.file.buffer, req.file.originalname);
    await broadcasts.update(broadcast.id, { imagePath });

    res.json({ imagePath });
  } catch (err) {
    fail(res, err, 'image');
  }
});

// ── Отправка ──────────────────────────────────────────────────────────────

/**
 * Проверочная отправка себе. Обязательна перед боевой — не как придирка
 * интерфейса, а потому что это единственная возможность увидеть сообщение
 * глазами пациента до того, как его увидят две тысячи человек: подпись под
 * картинкой переносится не так, как в поле ввода, а кнопка отписки выглядит
 * иначе в каждом мессенджере.
 */
router.post('/:id/test', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const { externalUserId, botId } = req.body;
    if (!externalUserId) return res.status(400).json({ error: 'Укажите свой id в мессенджере' });
    if (!botId) return res.status(400).json({ error: 'Выберите бота' });

    res.json(await broadcasts.sendTest(req.params.id, String(externalUserId).trim(), botId));
  } catch (err) {
    fail(res, err, 'test');
  }
});

router.post('/:id/start', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const broadcast = await broadcasts.start(req.params.id);
    console.log(`[broadcasts] «${broadcast.title}» запущена пользователем ${req.user.username}`);
    res.json(await broadcasts.withCounts(broadcast));
  } catch (err) {
    fail(res, err, 'start');
  }
});

router.post('/:id/pause', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const broadcast = await broadcasts.pause(req.params.id);
    console.log(`[broadcasts] «${broadcast.title}» остановлена пользователем ${req.user.username}`);
    res.json(await broadcasts.withCounts(broadcast));
  } catch (err) {
    fail(res, err, 'pause');
  }
});

router.post('/:id/schedule', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const broadcast = await broadcasts.schedule(req.params.id, req.body.scheduledAt);
    res.json(await broadcasts.withCounts(broadcast));
  } catch (err) {
    fail(res, err, 'schedule');
  }
});

router.post('/:id/unschedule', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const broadcast = await broadcasts.unschedule(req.params.id);
    res.json(await broadcasts.withCounts(broadcast));
  } catch (err) {
    fail(res, err, 'unschedule');
  }
});

router.post('/:id/copy', authenticate, requireAnnouncements, async (req, res) => {
  try {
    const copy = await broadcasts.duplicate(req.params.id, {
      asTemplate: req.body?.asTemplate === true
    }, req.user.id);
    res.status(201).json(copy);
  } catch (err) {
    fail(res, err, 'copy');
  }
});

module.exports = router;
