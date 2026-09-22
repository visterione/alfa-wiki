'use strict';

/**
 * Отправка писем (ver. 8.58).
 *
 * Три вещи, без которых отправка выглядит работающей, но таковой не является.
 *
 * Первая — заголовки цепочки. Без In-Reply-To и References ответ у получателя
 * оказывается отдельным письмом на ту же тему, и переписка из десяти писем
 * превращается в десять несвязанных. Заметно это не у нас, а у собеседника,
 * поэтому проверить «на глаз» такую поломку нельзя.
 *
 * Вторая — копия в «Отправленные» на сервере. SMTP письмо только отправляет;
 * если не положить копию через IMAP APPEND, то в Roundcube и в почте на
 * телефоне отправленного не будет вовсе, и человек решит, что письмо не ушло.
 *
 * Третья — суточный предел. У reg.ru это 3000 писем в сутки на аккаунт, и тот
 * же предел тратит модуль рассылок. Упереться в него значит остаться без
 * исходящей почты до утра — молча, потому что сервер просто перестаёт
 * принимать. Поэтому свой потолок ниже и проверяется до отправки.
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

const { sequelize, MailAccount, MailMessage, MailFolder, MailDraft } = require('../../models');
const { decryptPassword } = require('./crypto');
const { withConnection } = require('./imap');
const { STORE_ROOT } = require('./store');

// Свой потолок на ящик в сутки. Заметно ниже предела reg.ru: почтовый клиент —
// это переписка, а не рассылка, и две сотни писем с одного ящика за день это
// уже очень много. Если кто-то упёрся, разбираться надо с тем, что он делает,
// а не поднимать порог.
const DAILY_PER_ACCOUNT = Math.max(1, parseInt(process.env.MAIL_DAILY_SEND_LIMIT || '200', 10));
// Общий потолок на всю сеть за сутки — страховка от того, что сотня ящиков
// одновременно упрётся в предел хостинга и оставит без почты всех.
const DAILY_TOTAL = Math.max(1, parseInt(process.env.MAIL_DAILY_SEND_TOTAL || '2000', 10));

const MAX_RECIPIENTS = 50;

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Сколько ящик и сеть уже отправили сегодня. Считается до отправки: узнать о
 * пределе после того, как сервер начал отказывать, — значит узнать слишком
 * поздно, письма к тому моменту уже потеряны.
 */
async function sentToday(accountId) {
  const since = startOfToday();
  const [[row]] = await sequelize.query(`
    SELECT COUNT(*) FILTER (WHERE "accountId" = $1)::int AS "byAccount",
           COUNT(*)::int AS total
    FROM mail_drafts
    WHERE status = 'sent' AND "sentAt" >= $2
  `, { bind: [accountId, since] });

  return { byAccount: Number(row.byAccount) || 0, total: Number(row.total) || 0 };
}

async function checkQuota(accountId) {
  const used = await sentToday(accountId);
  if (used.byAccount >= DAILY_PER_ACCOUNT) {
    throw new Error(
      `Ящик уже отправил сегодня ${used.byAccount} писем — это суточный предел портала. ` +
      'Отправка станет доступна после полуночи.'
    );
  }
  if (used.total >= DAILY_TOTAL) {
    throw new Error(
      `Сеть отправила сегодня ${used.total} писем — это общий суточный предел. ` +
      'Он ниже предела хостинга намеренно, чтобы почта не встала у всех сразу.'
    );
  }
  return used;
}

// ── Адреса ────────────────────────────────────────────────────────────────

/**
 * Приводит список получателей к виду, который понимает nodemailer. Принимаем и
 * строку, и объект: интерфейс отдаёт объекты, а импортированный из старой
 * переписки адрес приезжает строкой.
 */
function normalizeRecipients(list) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      const address = entry.trim();
      if (address) out.push({ address });
      continue;
    }
    const address = String(entry.address || entry.email || '').trim();
    if (!address) continue;
    out.push({ address, name: entry.name ? String(entry.name).trim() : undefined });
  }
  return out;
}

function formatRecipients(list) {
  return list.map((r) => (r.name ? { name: r.name, address: r.address } : r.address));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRecipients(draft) {
  const to = normalizeRecipients(draft.toList);
  const cc = normalizeRecipients(draft.ccList);
  const bcc = normalizeRecipients(draft.bccList);

  if (!to.length && !cc.length && !bcc.length) throw new Error('Не указан ни один получатель');

  const all = [...to, ...cc, ...bcc];
  if (all.length > MAX_RECIPIENTS) {
    throw new Error(
      `Получателей больше ${MAX_RECIPIENTS}. Столько адресов за раз — это уже рассылка, ` +
      'и делать её надо в разделе «Маркетинг»: там есть отписка, разбивка по дням и учёт предела.'
    );
  }

  const bad = all.find((r) => !EMAIL_RE.test(r.address));
  if (bad) throw new Error(`Неверный адрес: ${bad.address}`);

  return { to, cc, bcc };
}

// ── Цепочка ───────────────────────────────────────────────────────────────

/**
 * Заголовки, которые вплетают письмо в переписку. References по стандарту —
 * это цепочка от корня к родителю, и собирается она из References исходного
 * письма плюс сам его Message-ID.
 */
async function threadHeaders(draft) {
  if (!draft.replyToId) return {};

  const original = await MailMessage.findByPk(draft.replyToId);
  if (!original || !original.messageId) return {};

  const refs = Array.isArray(original.references) ? [...original.references] : [];
  refs.push(original.messageId);

  return {
    inReplyTo: original.messageId,
    // Длинные ветки разрастаются до сотен идентификаторов; по стандарту хвост
    // можно подрезать, сохранив начало (корень) и конец (ближайших предков).
    references: refs.length > 20 ? [refs[0], ...refs.slice(-19)] : refs,
  };
}

// ── Подпись ───────────────────────────────────────────────────────────────

function withSignature(html, text, signature) {
  if (!signature || !String(signature).trim()) return { html, text };

  const sig = String(signature).trim();
  const sigText = sig.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();

  return {
    // Разделитель из двух дефисов и пробела — не украшение: по нему почтовые
    // клиенты отличают подпись от текста и не тащат её в цитату при ответе.
    html: `${html || ''}<br><br><div class="mail-signature">-- <br>${sig}</div>`,
    text: `${text || ''}\n\n-- \n${sigText}`,
  };
}

// ── Отправка ──────────────────────────────────────────────────────────────

function buildTransport(account, password) {
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure !== false,
    auth: { user: account.login || account.email, pass: password },
    // Отправка одного письма не должна висеть дольше минуты: если SMTP молчит
    // столько, он и дальше промолчит, а человек ждёт ответа формы.
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });
}

function loadAttachments(draft) {
  const list = Array.isArray(draft.attachments) ? draft.attachments : [];
  return list.map((att) => {
    const abs = path.join(STORE_ROOT, att.storagePath);
    if (!fs.existsSync(abs)) throw new Error(`Файл «${att.filename}» потерялся, приложите его заново`);
    return { filename: att.filename, path: abs, contentType: att.mimeType || undefined };
  });
}

/**
 * Отправляет черновик и кладёт копию в «Отправленные» на сервере.
 *
 * Порядок именно такой: сначала SMTP, потом IMAP. Если упадёт APPEND, письмо
 * всё равно ушло, и отменить это нельзя — значит, отметить отправленным надо в
 * любом случае, а недоехавшую копию просто записать в журнал. Обратный порядок
 * дал бы копию в «Отправленных» у письма, которое не отправилось, — а это хуже:
 * человек уверен, что ответил, хотя не ответил.
 */
async function sendDraft(draftId, userId) {
  const draft = await MailDraft.findByPk(draftId);
  if (!draft) throw new Error('Черновик не найден');
  if (draft.status === 'sent') throw new Error('Это письмо уже отправлено');

  const account = await MailAccount.scope('withSecret').findByPk(draft.accountId);
  if (!account || !account.isActive) throw new Error('Ящик недоступен');

  const recipients = validateRecipients(draft);
  await checkQuota(draft.accountId);

  await draft.update({ status: 'sending', error: null });

  const password = decryptPassword(account);
  const transport = buildTransport(account, password);

  // Свой Message-ID: по нему мы узнаем это письмо, когда оно вернётся к нам из
  // папки «Отправленные» обычной синхронизацией, и не покажем его дважды.
  const domain = String(account.email).split('@')[1] || 'localhost';
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2, 10)}@${domain}>`;

  const thread = await threadHeaders(draft);
  const body = withSignature(draft.bodyHtml, draft.bodyText, account.signature);

  const message = {
    messageId,
    from: { name: account.displayName, address: account.email },
    to: formatRecipients(recipients.to),
    cc: recipients.cc.length ? formatRecipients(recipients.cc) : undefined,
    bcc: recipients.bcc.length ? formatRecipients(recipients.bcc) : undefined,
    subject: draft.subject || '(без темы)',
    text: body.text || undefined,
    html: body.html || undefined,
    attachments: loadAttachments(draft),
    inReplyTo: thread.inReplyTo,
    references: thread.references,
  };

  let info;
  try {
    info = await transport.sendMail(message);
  } catch (err) {
    await draft.update({ status: 'error', error: String(err.message || err).slice(0, 2000) });
    throw new Error(`Письмо не отправилось: ${err.message || err}`);
  } finally {
    transport.close();
  }

  await draft.update({ status: 'sent', sentAt: new Date(), messageId, error: null });

  // Копия в «Отправленные». Неудача здесь письма не отменяет, поэтому она
  // только записывается — и в черновик, чтобы было видно в интерфейсе.
  try {
    await appendToSent(account, info.message || message, messageId, draft);
  } catch (err) {
    await draft.update({ error: `Письмо отправлено, но копия не попала в «Отправленные»: ${err.message}` });
    console.warn(`📬 Почта: APPEND в «Отправленные» не прошёл для ${account.email} — ${err.message}`);
  }

  // Исходное письмо помечаем отвеченным — и у нас, и на сервере, чтобы в
  // Roundcube у коллег стояла та же стрелка.
  if (draft.replyToId) {
    try {
      const { setFlag } = require('./flags');
      const original = await MailMessage.findByPk(draft.replyToId);
      if (original) await setFlag(original, userId, 'answered');
    } catch (e) { /* пометка «отвечено» не стоит того, чтобы ронять отправку */ }
  }

  return { ok: true, messageId, sentAt: draft.sentAt };
}

/**
 * Кладёт копию в папку «Отправленные». Папку ищем по SPECIAL-USE, а не по
 * имени: на разных ящиках она называется «Sent», «Отправленные» или «Sent
 * Items», и угадывание здесь однажды промахнётся.
 */
async function appendToSent(account, builtMessage, messageId, draft) {
  const folder = await MailFolder.findOne({
    where: { accountId: account.id, specialUse: '\\Sent' },
  }) || await MailFolder.findOne({
    where: { accountId: account.id, name: { [Op.iLike]: '%отправленн%' } },
  });

  // Имя переменной не path: так называется подключённый выше модуль, и
  // перекрывать его внутри функции — верный способ однажды получить загадочную
  // ошибку при добавлении сюда работы с файлами.
  const folderPath = folder ? folder.path : 'Sent';

  // Собираем письмо заново тем же построителем — нам нужен сырой MIME, а
  // sendMail отдаёт только сведения об отправке.
  const MailComposer = require('nodemailer/lib/mail-composer');
  const raw = await new MailComposer({ ...builtMessage, messageId }).compile().build();

  await withConnection(account, async (client) => {
    await client.append(folderPath, raw, ['\\Seen'], new Date());
  });

  // Письмо приедет к нам обычной синхронизацией в свой черёд; отдельно в
  // зеркало его не кладём, чтобы не заводить две версии одного письма.
  return true;
}

module.exports = {
  sendDraft,
  sentToday,
  checkQuota,
  normalizeRecipients,
  validateRecipients,
  threadHeaders,
  withSignature,
  DAILY_PER_ACCOUNT,
  DAILY_TOTAL,
  MAX_RECIPIENTS,
};
