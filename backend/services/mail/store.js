'use strict';

/**
 * Запись писем в зеркало (ver. 8.58).
 *
 * Сюда стекается всё, что синхронизатор достал с сервера: конверт, тело,
 * адреса, вложения и поисковый вектор. Вынесено из sync.js, потому что там
 * логика «что забирать», а здесь — «куда это положить», и смешивать их значило
 * бы получить файл, в котором нельзя найти ни то, ни другое.
 *
 * Сырые письма и вложения лежат НЕ в uploads/: ту папку express раздаёт
 * статикой целиком, и письмо стало бы доступно любому, кто угадает ссылку. В
 * ящиках переписка с пациентами, поэтому файлы отдаются только через
 * маршрут с проверкой доступа.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');

const { sequelize, MailMessage, MailMessageBody, MailAddress, MailMessageAddress, MailAttachment } = require('../../models');
const { stripQuotedText, htmlToPlain, buildPreview, sanitizeEmailHtml, SANITIZER_VERSION } = require('./parse');
const { extractText } = require('./extract');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const STORE_ROOT = process.env.MAIL_STORE_PATH || path.join(__dirname, '..', '..', 'mail-store');

// Потолок текста, который отдаётся в индекс. tsvector в Postgres ограничен
// мегабайтом, и рассылка с гигантской вёрсткой способна в него упереться.
// Двести тысяч знаков — это примерно сто страниц; если нужное слово не
// встретилось на ста страницах, поиск по письму всё равно не спасёт.
const INDEX_TEXT_LIMIT = 150_000;

// Столько же отводим на вложения. Вместе с телом это около четверти миллиона
// знаков на письмо — tsvector такой объём переваривает с запасом, потому что
// повторяющиеся слова в нём схлопываются.
const ATTACHMENT_TEXT_LIMIT = 100_000;

// ── Файлы ─────────────────────────────────────────────────────────────────

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function rawPathFor(accountId, messageUuid, receivedAt) {
  const d = receivedAt instanceof Date && !Number.isNaN(receivedAt.valueOf()) ? receivedAt : new Date();
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return path.join(accountId, yyyy, mm, `${messageUuid}.eml.gz`);
}

/**
 * Сырое письмо сохраняем целиком и сжатым, вместе с вложениями внутри. Да, оно
 * дублирует распакованные вложения рядом — и это осознанно: оригинал нужен,
 * чтобы переслать письмо без потерь, а места на диске у нас с запасом. Экономия
 * здесь стоила бы сложности, которая потом всплывает при каждой пересылке.
 */
async function saveRaw(accountId, messageUuid, receivedAt, source) {
  const rel = rawPathFor(accountId, messageUuid, receivedAt);
  const abs = path.join(STORE_ROOT, rel);
  await ensureDir(path.dirname(abs));
  await fsp.writeFile(abs, await gzip(source));
  return rel;
}

async function readRaw(relPath) {
  return gunzip(await fsp.readFile(path.join(STORE_ROOT, relPath)));
}

/**
 * Вложения адресуются содержимым: путь считается из sha256. Одно и то же
 * коммерческое предложение, разосланное на восемь ящиков сети, лежит одним
 * файлом, а повторная запись просто попадает в уже существующий путь.
 */
function attachmentPathFor(sha256) {
  return path.join('attachments', sha256.slice(0, 2), sha256.slice(2, 4), sha256);
}

async function saveAttachment(content) {
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const rel = attachmentPathFor(sha256);
  const abs = path.join(STORE_ROOT, rel);

  try {
    await fsp.access(abs, fs.constants.R_OK);
  } catch (e) {
    await ensureDir(path.dirname(abs));
    // Пишем через временное имя: прерванная на середине запись иначе оставила
    // бы обрезанный файл, который выглядит как настоящий — по пути из хэша его
    // уже никто не перепроверит.
    const tmp = `${abs}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, content);
    await fsp.rename(tmp, abs);
  }

  return { sha256, storagePath: rel, size: content.length };
}

function attachmentAbsPath(relPath) {
  return path.join(STORE_ROOT, relPath);
}

// ── Адреса ────────────────────────────────────────────────────────────────

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 320) || null;
}

/**
 * Заводит адрес, если его ещё нет, и обновляет отображаемое имя на последнее
 * встреченное. Люди меняют подпись, и спорить с этим бессмысленно.
 */
async function upsertAddress(email, name, seenAt, transaction) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const [row] = await sequelize.query(`
    INSERT INTO mail_addresses (id, email, name, "messagesCount", "lastSeenAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), :email, :name, 1, :seenAt, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(NULLIF(EXCLUDED.name, ''), mail_addresses.name),
      "messagesCount" = mail_addresses."messagesCount" + 1,
      "lastSeenAt" = GREATEST(mail_addresses."lastSeenAt", EXCLUDED."lastSeenAt"),
      "updatedAt" = NOW()
    RETURNING id
  `, {
    replacements: { email: normalized, name: (name || '').trim().slice(0, 300) || null, seenAt: seenAt || new Date() },
    transaction,
    type: sequelize.QueryTypes.SELECT,
  });

  return row ? row.id : null;
}

async function linkAddresses(messageId, groups, receivedAt, transaction) {
  const rows = [];
  for (const [role, list] of Object.entries(groups)) {
    for (const person of list || []) {
      const addressId = await upsertAddress(person.address, person.name, receivedAt, transaction);
      if (!addressId) continue;
      rows.push({ messageId, addressId, role, name: (person.name || '').slice(0, 300) || null });
    }
  }
  if (!rows.length) return;

  await MailMessageAddress.bulkCreate(rows, {
    transaction,
    // Один и тот же адрес легко встречается в «Кому» дважды — письмо от этого
    // не становится ошибочным, просто связь уже есть.
    ignoreDuplicates: true,
  });
}

// ── Поисковый вектор ──────────────────────────────────────────────────────

/**
 * Собирает вектор из четырёх частей с разным весом: тема важнее тела, люди
 * важнее имён файлов. Веса потом дают осмысленную сортировку по совпадению —
 * письмо с нужным словом в теме должно стоять выше, чем то, где оно мелькнуло
 * в подписи на двадцатой странице.
 *
 * Каждая часть индексируется дважды — конфигурациями russian и simple. Причина
 * подробно записана в миграции: русский стеммер несимметрично калечит фамилии
 * («Иванов» → «иван», но «Иванову» → «иванов»), и одной его версии мало.
 */
function buildSearchVectorSql() {
  const pair = (param, weight) =>
    `setweight(to_tsvector('russian', ${param}), '${weight}') || setweight(to_tsvector('simple', ${param}), '${weight}')`;

  return [
    pair(':subject', 'A'),
    pair(':people', 'B'),
    pair(':files', 'C'),
    pair(':body', 'D'),
  ].join(' || ');
}

async function updateSearchVector(messageId, parts, transaction) {
  await sequelize.query(`
    UPDATE mail_message_bodies
    SET "searchVector" = ${buildSearchVectorSql()}, "updatedAt" = NOW()
    WHERE "messageId" = :messageId
  `, {
    replacements: {
      messageId,
      subject: (parts.subject || '').slice(0, 2000),
      people: (parts.people || '').slice(0, 4000),
      // Вложения несут не только имена, но и вытащенный из них текст, поэтому
      // потолок здесь того же порядка, что у тела письма.
      files: (parts.files || '').slice(0, ATTACHMENT_TEXT_LIMIT),
      body: (parts.body || '').slice(0, INDEX_TEXT_LIMIT),
    },
    transaction,
  });
}

// ── Тело письма ───────────────────────────────────────────────────────────

/**
 * Раскладывает разобранное mailparser письмо: текст, очищенный HTML, вложения,
 * адреса и поисковый вектор. Всё одной транзакцией — письмо, у которого
 * сохранилось тело, но не сохранились вложения, выглядит целым и врёт.
 */
async function storeParsedBody(message, parsed, rawSource) {
  const plainText = parsed.text || (parsed.html ? htmlToPlain(parsed.html) : '');
  const stripped = stripQuotedText(plainText);
  const { html: safeHtml } = parsed.html ? sanitizeEmailHtml(parsed.html) : { html: '' };

  const attachments = (parsed.attachments || []).filter((a) => a && a.content);

  await sequelize.transaction(async (transaction) => {
    const rawPath = await saveRaw(message.accountId, message.id, message.receivedAt, rawSource);

    await sequelize.query(`
      INSERT INTO mail_message_bodies ("messageId", "textBody", "textStripped", "htmlSanitized", "sanitizerVersion", "createdAt", "updatedAt")
      VALUES (:messageId, :textBody, :textStripped, :html, :version, NOW(), NOW())
      ON CONFLICT ("messageId") DO UPDATE SET
        "textBody" = EXCLUDED."textBody",
        "textStripped" = EXCLUDED."textStripped",
        "htmlSanitized" = EXCLUDED."htmlSanitized",
        "sanitizerVersion" = EXCLUDED."sanitizerVersion",
        "updatedAt" = NOW()
    `, {
      replacements: {
        messageId: message.id,
        textBody: plainText || null,
        textStripped: stripped || null,
        html: safeHtml || null,
        version: SANITIZER_VERSION,
      },
      transaction,
    });

    // Вложения переписываем целиком: если письмо перечитывается, прежние строки
    // относятся к той же версии письма и дубли не нужны.
    await MailAttachment.destroy({ where: { messageId: message.id }, transaction });

    const attachmentRows = [];
    for (const att of attachments) {
      const saved = await saveAttachment(att.content);
      // Наличие Content-ID уже означает, что HTML может ссылаться на эту часть
      // через cid:. Некоторые серверы при этом не ставят disposition/related.
      const inline = att.contentDisposition === 'inline' || Boolean(att.cid);

      // Текст достаём только из приложенных файлов. Картинки вёрстки разбирать
      // нечего, а тратить на них время при заливке архива — значит растянуть её.
      const textContent = inline
        ? null
        : await extractText(att.content, att.contentType, att.filename);

      attachmentRows.push({
        textContent,
        messageId: message.id,
        filename: (att.filename || 'без-имени').slice(0, 500),
        mimeType: (att.contentType || 'application/octet-stream').slice(0, 200),
        size: saved.size,
        sha256: saved.sha256,
        storagePath: saved.storagePath,
        // Картинки из вёрстки письма — не приложенные файлы. Иначе у каждой
        // рекламной рассылки в списке было бы «12 вложений».
        isInline: inline,
        contentId: att.cid ? String(att.cid).slice(0, 300) : null,
        partId: att.partId ? String(att.partId).slice(0, 50) : null,
      });
    }
    if (attachmentRows.length) await MailAttachment.bulkCreate(attachmentRows, { transaction });

    await MailMessageAddress.destroy({ where: { messageId: message.id }, transaction });
    await linkAddresses(message.id, {
      from: addressList(parsed.from),
      to: addressList(parsed.to),
      cc: addressList(parsed.cc),
      bcc: addressList(parsed.bcc),
      'reply-to': addressList(parsed.replyTo),
    }, message.receivedAt, transaction);

    const visible = attachmentRows.filter((a) => !a.isInline);

    await MailMessage.update({
      preview: buildPreview(stripped || plainText),
      rawPath,
      bodyState: 'done',
      hasAttachments: visible.length > 0,
      attachmentsCount: visible.length,
    }, { where: { id: message.id }, transaction });

    // Имена файлов и их содержимое идут одной весовой группой: и то, и другое —
    // «что было во вложении», и разделять их в сортировке смысла нет.
    const filesForIndex = [
      ...visible.map((a) => a.filename || ''),
      ...visible.map((a) => a.textContent || ''),
    ].filter(Boolean).join('\n');

    await updateSearchVector(message.id, {
      subject: message.subject || parsed.subject || '',
      people: peopleForIndex(parsed),
      files: filesForIndex,
      body: stripped || plainText || '',
    }, transaction);
  });
}

function addressList(field) {
  if (!field) return [];
  const value = Array.isArray(field) ? field : [field];
  const out = [];
  for (const entry of value) {
    for (const person of entry?.value || []) {
      if (person?.address) out.push({ address: person.address, name: person.name });
    }
  }
  return out;
}

/**
 * Строка для весовой группы «люди». Имена и адреса идут вместе: жалобу ищут и
 * по фамилии автора, и по адресу компании, а какое из двух помнит человек —
 * заранее неизвестно.
 */
function peopleForIndex(parsed) {
  const groups = [parsed.from, parsed.to, parsed.cc, parsed.replyTo];
  const parts = [];
  for (const group of groups) {
    for (const person of addressList(group)) {
      if (person.name) parts.push(person.name);
      if (person.address) {
        parts.push(person.address);
        // Локальная часть отдельно: «ivan.petrov@x.ru» иначе останется одним
        // токеном, и поиск по «петров» его не найдёт.
        parts.push(String(person.address).split('@')[0].replace(/[._-]+/g, ' '));
      }
    }
  }
  return parts.join(' ');
}

module.exports = {
  STORE_ROOT,
  saveRaw,
  readRaw,
  saveAttachment,
  attachmentAbsPath,
  storeParsedBody,
  updateSearchVector,
  upsertAddress,
  normalizeEmail,
  peopleForIndex,
  addressList,
  INDEX_TEXT_LIMIT,
  ATTACHMENT_TEXT_LIMIT,
};
