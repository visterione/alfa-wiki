'use strict';

/**
 * Рекламные рассылки подписчикам ботов (ver. 8.07).
 *
 * Третий повод, по которому бот пишет человеку сам. Первые два — напоминание о
 * визите и ответ оператора — приходят по делу и одному адресату; этот приходит
 * всем сразу и по нашей инициативе. Отсюда всё остальное устройство модуля.
 *
 * ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ:
 *
 *   • каскада. Не дошло ботом — значит не дошло. Реклама, ушедшая человеку
 *     SMS-кой через платного провайдера, — это уже не оплошность, а нарушение
 *     38-ФЗ ст. 18 с готовым заявителем на другом конце;
 *   • повторных попыток по расписанию. Анонс акции — не напоминание о визите,
 *     завтра он не нужен. Единственное исключение — 429: там платформа прямо
 *     говорит, через сколько секунд можно, и это не отложенная попытка, а пауза
 *     внутри той же;
 *   • фильтров сложнее медцентра. Отложенный запуск и повторное использование
 *     сохранённых шаблонов появились в 8.13, когда раздел стал самостоятельным.
 *
 * ПОЧЕМУ РАССЫЛКА ЗАПИСЫВАЕТ АДРЕСАТОВ ЗАРАНЕЕ. Набор фиксируется в момент
 * запуска, строкой на человека. Так рассылка переживает перезапуск процесса:
 * на сеть она идёт минутами, и без отметки на каждом адресате перезапуск
 * посередине означал бы либо второй экземпляр сообщения половине базы, либо
 * молчание для другой половины. Заодно это отвечает на вопрос «а Иванову ушло?»
 * — по журналу отправок такое не восстанавливается.
 */

const fs = require('fs').promises;
const path = require('path');
const { Op } = require('sequelize');
const { OmniBroadcast, OmniBroadcastTarget, BotSubscriber, MessengerBot,
        User, sequelize } = require('../models');
const { getChannel } = require('./messengers');
const settings = require('./notifications/settings');
const consent = require('./notifications/consent');

// Каталог картинок. Лежит в открытой части uploads: анонс акции — то же самое,
// что висит на сайте клиники, закрывать в нём нечего. Вложения открытой линии
// (фотографии направлений и анализов) живут отдельно и под охраной.
const IMAGE_DIR = path.join(__dirname, '..', 'uploads', 'broadcasts');

// Предел подписи под картинкой у Telegram. У обычного сообщения было бы 4096,
// но рассылка с картинкой и без должна вести себя одинаково: иначе добавленная
// в последний момент картинка молча обрезала бы уже написанный текст.
const TEXT_LIMIT = 1024;

// Сообщений в секунду. Telegram обрывает бота примерно на тридцати, и держаться
// у самой границы незачем: выигрыш — секунды на всю рассылку, проигрыш — 429 и
// пауза на всех остальных.
const PER_SECOND = Number(process.env.BROADCAST_PER_SECOND || 20);

// Сколько адресатов разбирать за один заход. При двадцати в секунду это ровно
// пять секунд работы — столько же, сколько между тиками таймера.
const BATCH = Number(process.env.BROADCAST_BATCH || 100);
const MAX_NETWORK_ATTEMPTS = Math.max(1, Number(process.env.BROADCAST_NETWORK_ATTEMPTS) || 3);

class BroadcastError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BroadcastError';
    this.code = code; // not_found | bad_state | empty_audience | no_test
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function nextNetworkAttempt(error) {
  return Number(String(error || '').match(/попытка (\d+)\//)?.[1] || 0) + 1;
}

// ── Аудитория ─────────────────────────────────────────────────────────────

/**
 * Боты выбранных медцентров. Бот и есть мост между рассылкой и подписчиком:
 * подписчик привязан к паре «платформа + организация», а медцентр знает о себе
 * только бот (messenger_bots."medCenterId", ver. 8.05).
 */
async function botsFor(medCenterIds) {
  if (!Array.isArray(medCenterIds) || !medCenterIds.length) return [];
  return MessengerBot.findAll({
    where: { isActive: true, medCenterId: { [Op.in]: medCenterIds } }
  });
}

/**
 * Кому уйдёт рассылка. Возвращает пары «подписчик — бот»: у одного медцентра
 * два бота, Telegram и MAX, и человек, подписанный на оба, получит анонс
 * дважды. Это не дефект: подписки разные, и отписаться от одной, оставшись в
 * другой, он тоже может по отдельности.
 *
 * Кого выборка не видит:
 *   • заблокировавших бота — им и так ничего не уходит;
 *   • отписавшихся от рассылок;
 *   • выгрузку из Fromni (source='import'). Отложено осознанно: у этих записей
 *     пуст botId, и они же те самые, на которых известен пробел в
 *     sender.subscriberFor.
 */
function subscriberFilter(bot) {
  return {
    // Подписчик уникален по паре «платформа + организация + пользователь».
    // botId появился позднее и у части живых подписок остался старым после
    // переподключения токена. Отсекать по нему нельзя: это как раз превращало
    // оставшегося живого адресата в ложное «в медцентре нет подписчиков».
    platform: bot.platform,
    organization: bot.organization,
    source: 'bot',
    isBlocked: false,
    marketingOptOut: false
  };
}

async function audience(medCenterIds) {
  const bots = await botsFor(medCenterIds);
  const pairs = [];

  for (const bot of bots) {
    const subscribers = await BotSubscriber.findAll({
      where: subscriberFilter(bot),
      attributes: ['id', 'externalUserId', 'patientIds']
    });
    subscribers.forEach(s => pairs.push({ subscriber: s, bot }));
  }

  return pairs;
}

/**
 * Размер аудитории с разбивкой по каналам — цифра, которую составитель видит до
 * того, как нажмёт «Отправить». Пустая аудитория здесь не ошибка, а нормальный
 * ответ: у медцентра может не быть ни одного бота.
 */
async function audienceSize(medCenterIds) {
  const pairs = await audience(medCenterIds);
  const byPlatform = {};
  pairs.forEach(({ bot }) => { byPlatform[bot.platform] = (byPlatform[bot.platform] || 0) + 1; });
  return { total: pairs.length, byPlatform };
}

// ── Черновик ──────────────────────────────────────────────────────────────

/**
 * Что проверяется у черновика. Пустой текст здесь не ошибка: черновик заводят
 * до того, как придумали, что писать, и запрет на пустоту превратил бы создание
 * рассылки в обязанность сразу её сочинить.
 */
function validate({ title, text }) {
  if (!title || !String(title).trim()) {
    throw new BroadcastError('bad_state', 'У рассылки должно быть название');
  }
  if (String(text || '').length > TEXT_LIMIT) {
    throw new BroadcastError('bad_state', `Текст длиннее ${TEXT_LIMIT} символов — столько не вмещает подпись под картинкой`);
  }
}

/**
 * А это проверяется у того, что вот-вот уйдёт людям. Отдельно от validate
 * намеренно: у черновика и у отправляемого сообщения разные требования, и
 * единственная общая проверка их только запутала бы.
 */
function validateSendable(broadcast) {
  if (!String(broadcast.text || '').trim()) {
    throw new BroadcastError('bad_state', 'Пустую рассылку отправлять нечего');
  }
  if (String(broadcast.text).length > TEXT_LIMIT) {
    throw new BroadcastError('bad_state', `Текст длиннее ${TEXT_LIMIT} символов — столько не вмещает подпись под картинкой`);
  }
  if (!Array.isArray(broadcast.medCenterIds) || !broadcast.medCenterIds.length) {
    throw new BroadcastError('bad_state', 'Не выбрано ни одного медцентра');
  }
}

async function list({ templates = false } = {}) {
  return OmniBroadcast.findAll({
    where: { isTemplate: Boolean(templates) },
    order: [['createdAt', 'DESC']],
    limit: 50,
    include: [{ model: User, as: 'author', attributes: ['id', 'displayName', 'username'] }]
  });
}

/**
 * Рассылка с посчитанными адресатами. Счётчики берём запросом, а не полями на
 * самой рассылке: поле пришлось бы обновлять на каждое отправленное сообщение,
 * и при двадцати в секунду это двадцать лишних UPDATE-ов в секунду ради цифры,
 * на которую смотрят раз в минуту.
 */
async function withCounts(broadcast) {
  const rows = await OmniBroadcastTarget.findAll({
    where: { broadcastId: broadcast.id },
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true
  });

  const counts = { pending: 0, sent: 0, failed: 0, skipped: 0 };
  rows.forEach(r => { counts[r.status] = Number(r.count); });
  counts.total = counts.pending + counts.sent + counts.failed + counts.skipped;

  const issueRows = await OmniBroadcastTarget.findAll({
    where: {
      broadcastId: broadcast.id,
      [Op.or]: [
        { status: { [Op.in]: ['failed', 'skipped'] } },
        { status: 'pending', error: { [Op.ne]: null } }
      ]
    },
    attributes: ['status', 'error', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status', 'error'],
    order: [[sequelize.fn('COUNT', sequelize.col('id')), 'DESC']],
    raw: true
  });

  return {
    ...broadcast.toJSON(),
    counts,
    issues: issueRows.map(row => ({ status: row.status, error: row.error || 'причина не указана', count: Number(row.count) }))
  };
}

async function get(id) {
  const broadcast = await OmniBroadcast.findByPk(id, {
    include: [{ model: User, as: 'author', attributes: ['id', 'displayName', 'username'] }]
  });
  if (!broadcast) throw new BroadcastError('not_found', 'Рассылка не найдена');
  return broadcast;
}

async function create(data, userId) {
  validate(data);
  return OmniBroadcast.create({
    title: String(data.title).trim(),
    text: String(data.text),
    medCenterIds: Array.isArray(data.medCenterIds) ? data.medCenterIds : [],
    imagePath: data.imagePath || null,
    isTemplate: Boolean(data.isTemplate),
    createdBy: userId
  });
}

async function update(id, data) {
  const broadcast = await get(id);
  // Правится только черновик. Запущенная рассылка уже наполовину у людей, и
  // подмена текста посередине означала бы две разные акции под одним именем.
  if (broadcast.status !== 'draft') {
    throw new BroadcastError('bad_state', 'Рассылку уже отправляли — правится только черновик');
  }
  validate({ title: data.title ?? broadcast.title, text: data.text ?? broadcast.text });

  const imageChanged = data.imagePath !== undefined && data.imagePath !== broadcast.imagePath;
  const previous = broadcast.imagePath;

  await broadcast.update({
    title: data.title !== undefined ? String(data.title).trim() : broadcast.title,
    text: data.text !== undefined ? String(data.text) : broadcast.text,
    medCenterIds: data.medCenterIds !== undefined ? data.medCenterIds : broadcast.medCenterIds,
    imagePath: data.imagePath !== undefined ? data.imagePath : broadcast.imagePath,
    // Картинку поменяли — забываем её идентификаторы у платформ, иначе адресаты
    // получили бы новый текст со старой картинкой.
    mediaIds: imageChanged ? {} : broadcast.mediaIds
  });

  // Старый файл убираем здесь, а не у вызывающего: заменить картинку можно из
  // двух мест, и забытый файл нашёлся бы только при разборе диска.
  if (imageChanged && previous) await removeImage(previous);

  return broadcast;
}

async function remove(id) {
  const broadcast = await get(id);
  if (broadcast.status === 'sending') {
    throw new BroadcastError('bad_state', 'Рассылка идёт — сначала остановите её');
  }
  if (broadcast.imagePath) await removeImage(broadcast.imagePath);
  await broadcast.destroy();
}

// ── Картинка ──────────────────────────────────────────────────────────────

async function saveImage(buffer, originalName) {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  const ext = (path.extname(originalName || '') || '.jpg').toLowerCase();
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  await fs.writeFile(path.join(IMAGE_DIR, name), buffer);
  return `broadcasts/${name}`;
}

async function removeImage(imagePath) {
  // Имя файла строим сами, но путь всё равно проверяем: он приезжает из строки
  // в базе, а «../» в ней превратил бы удаление картинки в удаление чего угодно.
  const full = path.resolve(__dirname, '..', 'uploads', imagePath);
  if (!full.startsWith(IMAGE_DIR + path.sep)) return;
  await fs.unlink(full).catch(() => {});
}

async function copyImage(imagePath) {
  if (!imagePath) return null;
  const source = path.resolve(__dirname, '..', 'uploads', imagePath);
  if (!source.startsWith(IMAGE_DIR + path.sep)) return null;
  await fs.mkdir(IMAGE_DIR, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(source)}`;
  await fs.copyFile(source, path.join(IMAGE_DIR, name));
  return `broadcasts/${name}`;
}

async function imageBuffer(broadcast) {
  if (!broadcast.imagePath) return null;
  const full = path.resolve(__dirname, '..', 'uploads', broadcast.imagePath);
  if (!full.startsWith(IMAGE_DIR + path.sep)) return null;
  return fs.readFile(full);
}

// ── Отправка ──────────────────────────────────────────────────────────────

// Кнопка отписки. Висит только под рекламным сообщением: под напоминанием о
// визите её быть не должно — от напоминаний никто не отписывался.
const OPT_OUT_BUTTON = [[{ text: 'Не присылать рассылки', data: 'unsub' }]];

/**
 * Отправляет одно сообщение и возвращает то, чем оно закончилось. Идентификатор
 * загруженной картинки возвращается наружу, чтобы вызывающий положил его в
 * рассылку: со второго адресата картинка уже не грузится.
 */
async function deliver(channel, bot, subscriber, broadcast, buffer, fileId) {
  if (!buffer) {
    const sent = await channel.sendText(bot, subscriber.externalUserId, broadcast.text, { buttons: OPT_OUT_BUTTON });
    return { externalMessageId: sent.externalMessageId, fileId: null };
  }

  return channel.sendPhoto(
    bot,
    subscriber.externalUserId,
    { fileId: fileId || null, buffer, fileName: path.basename(broadcast.imagePath) },
    broadcast.text,
    { buttons: OPT_OUT_BUTTON }
  );
}

/**
 * Фиксирует адресатов и переводит рассылку в работу. Набор считается один раз:
 * подписавшийся через минуту после запуска в эту рассылку уже не попадёт, и это
 * правильнее, чем догонять его анонсом посреди чужой очереди.
 */
async function activate(broadcast) {
  validateSendable(broadcast);

  const pairs = await audience(broadcast.medCenterIds);
  if (!pairs.length) {
    const bots = await botsFor(broadcast.medCenterIds);
    throw new BroadcastError('empty_audience', bots.length
      ? 'У подключённых ботов нет доступных подписчиков: пациенты ещё не запускали их либо ранее заблокировали'
      : 'В выбранных медцентрах нет активных ботов');
  }

  await OmniBroadcastTarget.bulkCreate(
    pairs.map(({ subscriber, bot }) => ({
      broadcastId: broadcast.id,
      subscriberId: subscriber.id,
      botId: bot.id
    })),
    { ignoreDuplicates: true }
  );

  await broadcast.update({ status: 'sending', startedAt: new Date(), scheduledAt: null });
  return broadcast;
}

async function start(id) {
  const broadcast = await get(id);
  if (broadcast.isTemplate) {
    throw new BroadcastError('bad_state', 'Сначала создайте рассылку из шаблона');
  }
  if (broadcast.status !== 'draft' && broadcast.status !== 'paused') {
    throw new BroadcastError('bad_state', 'Рассылка уже отправлена или идёт');
  }

  if (broadcast.status === 'paused') {
    await broadcast.update({ status: 'sending' });
    return broadcast;
  }
  return activate(broadcast);
}

function parseScheduledAt(value, now = new Date()) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new BroadcastError('bad_state', 'Укажите дату и время запуска');
  }
  if (date.getTime() <= now.getTime()) {
    throw new BroadcastError('bad_state', 'Время запуска должно быть в будущем');
  }
  return date;
}

async function schedule(id, value, now = new Date()) {
  const broadcast = await get(id);
  if (broadcast.isTemplate || broadcast.status !== 'draft') {
    throw new BroadcastError('bad_state', 'Запланировать можно только обычный черновик');
  }
  validateSendable(broadcast);
  await broadcast.update({ status: 'scheduled', scheduledAt: parseScheduledAt(value, now) });
  return broadcast;
}

async function unschedule(id) {
  const broadcast = await get(id);
  if (broadcast.status !== 'scheduled') {
    throw new BroadcastError('bad_state', 'Эта рассылка не запланирована');
  }
  await broadcast.update({ status: 'draft', scheduledAt: null });
  return broadcast;
}

async function duplicate(id, { asTemplate = false } = {}, userId = null) {
  const source = await get(id);
  const imagePath = await copyImage(source.imagePath);
  return create({
    title: asTemplate ? source.title : `${source.title} — копия`,
    text: source.text,
    medCenterIds: source.medCenterIds,
    imagePath,
    isTemplate: asTemplate
  }, userId);
}

async function pause(id) {
  const broadcast = await get(id);
  if (broadcast.status !== 'sending') {
    throw new BroadcastError('bad_state', 'Останавливать нечего — рассылка не идёт');
  }
  await broadcast.update({ status: 'paused' });
  return broadcast;
}

/**
 * Проверочная отправка одному адресату. Идёт мимо очереди и мимо таблицы
 * адресатов: это не часть рассылки, а способ увидеть её глазами пациента.
 *
 * Тихие часы здесь не соблюдаются намеренно — по той же причине, что и у
 * проверочной отправки уведомлений: смотреть, как получилось, в девять утра
 * неудобно, а получатель у проверки один и он же её и запросил.
 */
async function sendTest(id, externalUserId, botId) {
  const broadcast = await get(id);
  validateSendable(broadcast);

  // Бот выбирается явно, а не угадывается по платформе. У анонса на три клиники
  // телеграмных ботов три, и получить проверку можно только от того, которому
  // ты сам когда-то написал /start: первым бот написать не может. Угаданный не
  // тот бот отвечал бы «chat not found» — сообщением, по которому не догадаешься,
  // что выбирать надо было другого.
  const bots = await botsFor(broadcast.medCenterIds);
  const bot = bots.find(b => b.id === botId);
  if (!bot) throw new BroadcastError('bad_state', 'Выберите бота, которому вы писали /start');

  const channel = getChannel(bot.platform);
  const buffer = await imageBuffer(broadcast);

  let result;
  try {
    result = await deliver(channel, bot, { externalUserId }, broadcast, buffer, null);
  } catch (err) {
    // Единственная ошибка, которую здесь стоит перевести: бот не может написать
    // первым, и человек, впервые открывший вкладку, об этом не знает.
    if (err.code === 'unknown_chat' || err.code === 'blocked') {
      throw new BroadcastError('bad_state',
        `Бот @${bot.username || bot.platform} не может вам написать. Откройте его в мессенджере, ` +
        'нажмите /start и повторите — первым бот написать не вправе.');
    }
    throw err;
  }

  // Идентификатор картинки, полученный на проверке, годится и для боевой
  // рассылки: бот тот же, картинка та же. Заодно это значит, что после проверки
  // первый настоящий адресат не ждёт загрузки.
  if (result.fileId) {
    await broadcast.update({ mediaIds: { ...broadcast.mediaIds, [bot.platform]: result.fileId } });
  }
  return result;
}

/**
 * Один заход движка: берёт порцию адресатов и рассылает её в темпе.
 *
 * Тихие часы проверяются по медцентру бота, а не по рассылке: анонс на три
 * клиники сразу может застать одну из них в тишине, а другую нет. Адресаты,
 * попавшие в тихие часы, остаются нетронутыми и разберутся следующим заходом —
 * рассылка, запущенная ночью, не отменяется и не теряется, а ждёт утра.
 */
async function runOnce() {
  const due = await OmniBroadcast.findOne({
    where: { status: 'scheduled', isTemplate: false, scheduledAt: { [Op.lte]: new Date() } },
    order: [['scheduledAt', 'ASC']]
  });
  if (due) {
    try {
      await activate(due);
      console.log(`[broadcasts] «${due.title}» запущена по расписанию`);
    } catch (err) {
      await due.update({ status: 'failed', finishedAt: new Date() });
      console.error(`[broadcasts] «${due.title}» не запущена по расписанию: ${err.message}`);
    }
  }

  const active = await OmniBroadcast.findOne({
    where: { status: 'sending' },
    order: [['startedAt', 'ASC']]
  });
  if (!active) return { sent: 0, failed: 0 };

  const targets = await OmniBroadcastTarget.findAll({
    where: { broadcastId: active.id, status: 'pending' },
    include: [
      { model: BotSubscriber, as: 'subscriber' },
      { model: MessengerBot, as: 'bot' }
    ],
    limit: BATCH
  });

  if (!targets.length) {
    await active.update({ status: 'done', finishedAt: new Date() });
    console.log(`[broadcasts] «${active.title}» разослана`);
    return { sent: 0, failed: 0, finished: true };
  }

  const buffer = await imageBuffer(active);

  // Картинку выбрали, а файла нет — рассылку останавливаем. Молча отправить
  // один текст было бы хуже всего: анонс ушёл бы половине сети без того, ради
  // чего его составляли, и заметили бы это по жалобам.
  if (active.imagePath && !buffer) {
    await active.update({ status: 'failed', finishedAt: new Date() });
    console.error(`[broadcasts] «${active.title}»: картинка ${active.imagePath} не читается, рассылка остановлена`);
    return { sent: 0, failed: 0 };
  }

  // Тихие часы считаем один раз на филиал, а не на адресата: у анонса на три
  // клиники филиалов три, а адресатов две тысячи, и ответ у них общий.
  const quietBy = new Map();
  const audible = [];
  for (const target of targets) {
    if (!target.bot || !target.subscriber) {
      await target.update({ status: 'skipped', error: 'бот или подписчик удалён' });
      continue;
    }
    const key = target.bot.medCenterId || '-';
    if (!quietBy.has(key)) {
      quietBy.set(key, settings.isQuiet(await settings.quietHoursFor(target.bot.medCenterId), new Date()));
    }
    if (!quietBy.get(key)) audible.push(target);
  }

  // Вся порция в тишине — ждём утра. Рассылка при этом остаётся в работе:
  // запущенная ночью не отменяется, а досыпается следующим заходом.
  if (!audible.length) return { sent: 0, failed: 0, quiet: true };

  // Согласие на оповещения спрашиваем на всю порцию сразу — сотня карточек
  // одним запросом (ver. 8.08). Поштучно это было бы сто походов в МИС внутри
  // цикла, идущего двадцать сообщений в секунду.
  //
  // МИС не ответила — заход прекращаем целиком, не тронув ни одного адресата.
  // Они останутся в очереди и уйдут следующим заходом: реклама не срочна, а
  // разослать её, не проверив отказы, — ровно то, ради чего эта проверка и
  // писалась.
  if (!await consent.prefetch(audible.map(t => t.subscriber.patientIds || []))) {
    console.warn(`[broadcasts] «${active.title}»: МИС не отвечает, отказы не проверены — ждём`);
    return { sent: 0, failed: 0, unverified: true };
  }

  const mediaIds = { ...active.mediaIds };
  let sent = 0;
  let failed = 0;
  const now = new Date();

  for (let i = 0; i < audible.length; i++) {
    const target = audible[i];

    // Остановили посреди порции — дорабатывать её незачем: смысл кнопки в том,
    // чтобы сообщение перестало уходить сейчас, а не через сто адресатов.
    // Спрашиваем не на каждом адресате: при двадцати в секунду это два десятка
    // лишних запросов в секунду ради кнопки, которую нажимают раз в месяц.
    if (i % 20 === 0 && await stopped(active.id)) break;

    // Отписаться и заблокировать бота человек мог уже после того, как аудиторию
    // зафиксировали: между запуском и его строкой в очереди проходят минуты.
    if (target.subscriber.marketingOptOut || target.subscriber.isBlocked) {
      await target.update({ status: 'skipped', error: 'отписался или заблокировал бота' });
      continue;
    }

    // Отказ от оповещений в карточке МИС. Ответ уже в кэше — prefetch выше
    // сходил за всей порцией, — так что похода в МИС здесь нет.
    const allowed = await consent.check({ patientId: target.subscriber.patientIds || [] });
    if (!allowed.allowed) {
      await target.update({ status: 'skipped', error: allowed.reason });
      continue;
    }

    const channel = getChannel(target.bot.platform);
    try {
      const result = await deliver(channel, target.bot, target.subscriber, active,
                                   buffer, mediaIds[target.bot.platform]);
      if (result.fileId && !mediaIds[target.bot.platform]) {
        mediaIds[target.bot.platform] = result.fileId;
        await active.update({ mediaIds });
      }
      await target.update({ status: 'sent', error: null, externalMessageId: result.externalMessageId, sentAt: new Date() });
      sent++;
    } catch (err) {
      // Заблокировавшего помечаем сразу: иначе каскад уведомлений будет тратить
      // на него попытку при каждой записи к врачу.
      if (err.code === 'blocked' || err.code === 'unknown_chat') {
        await target.subscriber.update({ isBlocked: true, blockedAt: now });
        await target.update({ status: 'skipped', error: 'бот заблокирован' });
        continue;
      }
      // 429 — не отказ, а просьба подождать. Пауза общая: следующему адресату
      // ответили бы тем же самым.
      if (err.code === 'rate_limited') {
        await sleep((err.retryAfter || 1) * 1000);
        continue;
      }

      // Таймаут или обрыв соединения ничего не говорит о получателе. Раньше
      // ECONNABORTED сразу становился окончательным failed, хотя следующий
      // запрос обычно проходит. Номер попытки храним в уже имеющемся поле
      // error, чтобы не требовать отдельной миграции очереди.
      if (err.code === 'network') {
        const attempt = nextNetworkAttempt(target.error);
        if (attempt < MAX_NETWORK_ATTEMPTS) {
          await target.update({
            status: 'pending',
            error: `временная ошибка, попытка ${attempt}/${MAX_NETWORK_ATTEMPTS}: ${err.message}`
          });
          continue;
        }
        await target.update({
          status: 'failed',
          error: `сеть не ответила после ${MAX_NETWORK_ATTEMPTS} попыток: ${err.message}`
        });
        failed++;
        continue;
      }
      await target.update({ status: 'failed', error: err.message });
      failed++;
    }

    await sleep(Math.ceil(1000 / PER_SECOND));
  }

  return { sent, failed };
}

/**
 * Не остановили ли рассылку, пока мы разбирали порцию. Спрашиваем базу, а не
 * помним в памяти: кнопку нажимают в другом процессе — в портале, а движок
 * живёт в notifier.
 */
async function stopped(broadcastId) {
  const row = await OmniBroadcast.findByPk(broadcastId, { attributes: ['status'] });
  return !row || row.status !== 'sending';
}

/**
 * Отказ от рассылок по кнопке под сообщением. Возвращает признак, что что-то
 * изменилось, — второе нажатие по старому сообщению не должно выглядеть как
 * первое.
 */
async function optOut(bot, externalUserId) {
  const subscriber = await BotSubscriber.findOne({
    where: { platform: bot.platform, organization: bot.organization, externalUserId }
  });
  if (!subscriber || subscriber.marketingOptOut) return false;

  await subscriber.update({ marketingOptOut: true, marketingOptOutAt: new Date() });
  return true;
}

module.exports = {
  TEXT_LIMIT,
  MAX_NETWORK_ATTEMPTS,
  BroadcastError,
  validate, validateSendable, parseScheduledAt, nextNetworkAttempt, subscriberFilter, deliver,
  list, get, create, update, remove, withCounts,
  audience, audienceSize,
  saveImage, removeImage,
  start, schedule, unschedule, duplicate, pause, sendTest, runOnce, optOut
};
