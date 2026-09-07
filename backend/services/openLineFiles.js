'use strict';

/**
 * Вложения открытой линии (ver. 7.85).
 *
 * Файлы забираем к себе в момент приёма сообщения, а не по клику оператора:
 * ссылка Telegram живёт около часа, и к моменту, когда до обращения дойдут руки,
 * её уже нет. Плюс внутри вполне может оказаться фотография направления или
 * анализов — такое не должно жить на чужом сервере.
 *
 * Раздача закрыта проверкой доступа по тем же причинам, что вложения чатов и
 * файлы онбординга: express.static отдаёт файл любому, кто знает имя, а здесь
 * лежат медицинские документы пациентов.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const { OmniConversation, OmniLineOperator, sequelize } = require('../models');
const fileAccess = require('./fileAccess');

const ROOT = path.join(__dirname, '..', 'uploads', 'open-line');
const MAX_BYTES = 25 * 1024 * 1024;   // столько же отдаёт Bot API одним файлом

const EXT_BY_KIND = { photo: '.jpg', voice: '.ogg', video: '.mp4' };

function extensionFor(media, suggestedName) {
  const fromName = suggestedName && path.extname(suggestedName);
  if (fromName && fromName.length <= 8) return fromName.toLowerCase();
  return EXT_BY_KIND[media.kind] || '.bin';
}

/**
 * Скачивает присланный файл в каталог обращения.
 *
 * @returns {Promise<Object>} описание вложения для omni_messages.attachments
 */
async function saveIncoming(channel, bot, media, conversationId) {
  // У Telegram во вложении лежит идентификатор, и ссылку надо спросить отдельно;
  // у MAX она приходит сразу. Канал прячет разницу, здесь только выбор источника.
  const link = await channel.fileLink(bot, media.fileId || media.url);

  if (link.size && link.size > MAX_BYTES) {
    // Не молчим и не падаем: в переписке останется отметка, что файл был, но
    // не поместился — оператору этого хватит, чтобы попросить прислать иначе.
    return { kind: media.kind, title: media.title || null, tooLarge: true, size: link.size };
  }

  const dir = path.join(ROOT, conversationId);
  await fs.promises.mkdir(dir, { recursive: true });

  const name = crypto.randomUUID() + extensionFor(media, link.suggestedName);
  const dest = path.join(dir, name);

  const { stream, contentType } = await channel.fileStream(link.url);
  await pipeline(stream, fs.createWriteStream(dest));

  const { size } = await fs.promises.stat(dest);

  return {
    kind: media.kind,
    title: media.title || null,
    url: `/uploads/open-line/${conversationId}/${name}`,
    mime: contentType,
    size
  };
}

/**
 * Линия, которой принадлежит файл, — по самой ссылке в переписке.
 *
 * Нужно из-за слияния переписок в 7.99: до него каталог назывался по id
 * переписки, а слияние часть этих переписок удалило. Файлы остались лежать по
 * старым путям и по-прежнему открываются из ленты, но каталога с таким id в
 * базе уже нет — по имени папки линию не найти. Зато ссылка целиком хранится в
 * attachments того сообщения, к которому файл приложен, и через сообщение
 * находится и переписка, и линия.
 */
async function lineByAttachmentUrl(url) {
  const [row] = await sequelize.query(`
    SELECT c."lineId"
    FROM omni_messages m
    JOIN omni_conversations c ON c.id = m."conversationId"
    WHERE m.attachments @> jsonb_build_array(jsonb_build_object('url', :url))
    LIMIT 1
  `, { replacements: { url }, type: sequelize.QueryTypes.SELECT });

  return row ? row.lineId : null;
}

/**
 * Пускает к файлу только сотрудника той линии, которой принадлежит переписка.
 * Путь построен так, что переписка видна прямо в нём: /<id переписки>/<файл>.
 */
async function openLineFileGuard(req, res, next) {
  try {
    const token = req.query && req.query.t;
    const userId = token ? fileAccess.verifyToken(token) : null;
    if (!userId) return res.status(401).send('Unauthorized');

    const relative = decodeURIComponent(req.path);
    const parts = relative.split('/').filter(Boolean);
    const conversationId = parts[0];
    if (!conversationId) return res.status(404).send('Not found');

    const conversation = await OmniConversation.findByPk(conversationId, { attributes: ['lineId'] });
    // Переписки с таким id нет — значит файл из слитой (см. lineByAttachmentUrl).
    const lineId = conversation ? conversation.lineId : await lineByAttachmentUrl(`/uploads/open-line${relative}`);
    if (!lineId) return res.status(404).send('Not found');

    const isOperator = await OmniLineOperator.count({ where: { lineId, userId } });
    if (!isOperator) return res.status(403).send('Forbidden');

    next();
  } catch (error) {
    console.error('[open-line] проверка доступа к файлу:', error);
    res.status(500).send('Internal error');
  }
}

module.exports = { saveIncoming, openLineFileGuard, ROOT };
