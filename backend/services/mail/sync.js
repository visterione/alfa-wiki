'use strict';

/**
 * Синхронизация ящиков (ver. 8.58).
 *
 * Зеркало наполняется в два прохода, и это главное решение модуля. Сначала для
 * всех писем забираются только конверты — тема, отправитель, дата, размер,
 * флаги. Они лёгкие, и список писем вместе с отбором по теме и отправителю
 * начинает работать в первый же час. Тела и вложения докачиваются вторым
 * проходом, фоном, от свежих к старым: обратиться к письму трёхлетней давности
 * просят единицы, а ждать неделю, пока доедет вся история, никто не должен.
 *
 * Полмиллиона писем — это полмиллиона обращений к серверу, и наивная выборка по
 * одному превращает шесть часов в неделю. Поэтому конверты берутся пачками, а
 * не поштучно: узкое место здесь не полоса, а круговая задержка.
 *
 * Догонять изменения стараемся дёшево. Если сервер умеет CONDSTORE, спрашиваем
 * только то, что изменилось с прошлого раза. Если нет — сверяем флаги целиком,
 * но редко. Исчезнувшие письма ловим по расхождению счётчиков: сервер в STATUS
 * говорит, сколько писем в папке, и если у нас другое число — идём сверять
 * список идентификаторов.
 */

const { simpleParser } = require('mailparser');
const { Op } = require('sequelize');

const { sequelize, MailAccount, MailFolder, MailMessage, MailSyncRun } = require('../../models');
const { withConnection } = require('./imap');
const { storeParsedBody } = require('./store');

// Сколько писем забирать одним FETCH. Двести — компромисс: пачка меньше платит
// круговой задержкой за каждое письмо, пачка больше надолго занимает соединение
// и задерживает остальные ящики в очереди.
const ENVELOPE_BATCH = 200;
// Сколько конвертов дочерпывать из архива за один заход в папку. Ограничение
// нужно, чтобы один забитый ящик не держал единственное соединение часами,
// пока остальные девяносто девять ждут.
const BACKFILL_CHUNK = 2000;

// ── Вспомогательное ───────────────────────────────────────────────────────

const toBigIntString = (value) => (value === null || value === undefined ? null : String(value));

/**
 * Письмо с вложением видно уже по структуре, скачивать тело ради этого не надо.
 * Встроенные картинки вёрстки не считаем: иначе у каждой рекламной рассылки в
 * списке висела бы скрепка.
 */
function hasRealAttachments(node) {
  if (!node) return false;
  const disposition = String(node.disposition || '').toLowerCase();
  if (disposition === 'attachment') return true;
  if (Array.isArray(node.childNodes)) return node.childNodes.some(hasRealAttachments);
  return false;
}

function countRealAttachments(node, acc = { n: 0 }) {
  if (!node) return acc.n;
  if (String(node.disposition || '').toLowerCase() === 'attachment') acc.n += 1;
  if (Array.isArray(node.childNodes)) node.childNodes.forEach((c) => countRealAttachments(c, acc));
  return acc.n;
}

function firstAddress(list) {
  const person = Array.isArray(list) ? list[0] : null;
  return {
    name: person?.name ? String(person.name).slice(0, 300) : null,
    email: person?.address ? String(person.address).toLowerCase().slice(0, 320) : null,
  };
}

/**
 * Корень цепочки. Первый идентификатор из References — это самое начало ветки;
 * если References нет, письмо само себе корень. Считаем при разборе, чтобы не
 * перебирать ссылки на каждый показ переписки.
 */
function threadKeyOf(messageId, references, inReplyTo) {
  if (references && references.length) return references[0].slice(0, 998);
  if (inReplyTo) return String(inReplyTo).slice(0, 998);
  return messageId ? String(messageId).slice(0, 998) : null;
}

function parseReferences(headerBuffer) {
  if (!headerBuffer) return null;
  const text = headerBuffer.toString('utf8');
  const ids = text.match(/<[^>\s]+>/g);
  return ids && ids.length ? ids.slice(0, 50) : null;
}

// ── Папки ─────────────────────────────────────────────────────────────────

async function syncFolders(client, account) {
  const remote = await client.list();
  const seen = new Set();

  for (const box of remote) {
    seen.add(box.path);
    const selectable = !box.flags.has('\\Noselect');

    await sequelize.query(`
      INSERT INTO mail_folders (id, "accountId", path, name, delimiter, "specialUse", flags, selectable, "sortOrder", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), :accountId, :path, :name, :delimiter, :specialUse, :flags::jsonb, :selectable, :sortOrder, NOW(), NOW())
      ON CONFLICT ("accountId", path) DO UPDATE SET
        name = EXCLUDED.name,
        delimiter = EXCLUDED.delimiter,
        "specialUse" = EXCLUDED."specialUse",
        flags = EXCLUDED.flags,
        selectable = EXCLUDED.selectable,
        "updatedAt" = NOW()
    `, {
      replacements: {
        accountId: account.id,
        path: box.path.slice(0, 1000),
        name: (box.name || box.path).slice(0, 500),
        delimiter: box.delimiter || null,
        specialUse: box.specialUse || null,
        flags: JSON.stringify([...box.flags]),
        selectable,
        sortOrder: folderOrder(box),
      },
    });
  }

  // Папка, исчезнувшая на сервере, исчезает и у нас — вместе с письмами. Это
  // то же удаление, просто оптом, а расходиться с сервером зеркало не должно.
  const gone = await MailFolder.findAll({ where: { accountId: account.id, path: { [Op.notIn]: [...seen] } } });
  for (const folder of gone) {
    console.log(`📬 Почта: папка «${folder.name}» исчезла на сервере, убираем из зеркала`);
    await folder.destroy();
  }

  return MailFolder.findAll({ where: { accountId: account.id, selectable: true }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
}

/** Порядок как в любом почтовом клиенте: Входящие, потом свои, потом служебные. */
function folderOrder(box) {
  if (box.path.toUpperCase() === 'INBOX') return 0;
  switch (box.specialUse) {
    case '\\Sent': return 10;
    case '\\Drafts': return 20;
    case '\\Archive': return 30;
    case '\\Junk': return 80;
    case '\\Trash': return 90;
    default: return 50;
  }
}

// ── Конверты ──────────────────────────────────────────────────────────────

/**
 * Забирает конверты диапазона UID и кладёт их в зеркало. Возвращает, сколько
 * писем реально пришло: сервер отдаёт только существующие, и дырки в нумерации
 * — норма.
 */
async function fetchEnvelopes(client, account, folder, range, { routeCandidates, routeFromUid } = {}) {
  const rows = [];
  let fetched = 0;

  for await (const msg of client.fetch(range, {
    uid: true,
    envelope: true,
    flags: true,
    internalDate: true,
    size: true,
    bodyStructure: true,
    // References в конверте нет, а цепочки без него разваливаются. Заголовок
    // лёгкий, и просить его сейчас дешевле, чем потом перечитывать ящик.
    headers: ['references'],
  }, { uid: true })) {
    const env = msg.envelope || {};
    const from = firstAddress(env.from);
    const references = parseReferences(msg.headers);
    const flags = msg.flags ? [...msg.flags] : [];

    const row = {
      accountId: account.id,
      folderId: folder.id,
      uid: String(msg.uid),
      messageId: env.messageId ? String(env.messageId).slice(0, 998) : null,
      inReplyTo: env.inReplyTo ? String(env.inReplyTo).slice(0, 998) : null,
      references,
      threadKey: threadKeyOf(env.messageId, references, env.inReplyTo),
      subject: env.subject ? String(env.subject).slice(0, 2000) : null,
      fromName: from.name,
      fromEmail: from.email,
      sentAt: env.date || null,
      receivedAt: msg.internalDate || env.date || new Date(),
      size: Number(msg.size) || 0,
      flags,
      isSeen: flags.includes('\\Seen'),
      isFlagged: flags.includes('\\Flagged'),
      isAnswered: flags.includes('\\Answered'),
      isDraft: flags.includes('\\Draft'),
      hasAttachments: hasRealAttachments(msg.bodyStructure),
      attachmentsCount: countRealAttachments(msg.bodyStructure),
      modSeq: toBigIntString(msg.modseq),
    };
    rows.push(row);
    fetched += 1;
    if (routeCandidates && routeFromUid !== null && routeFromUid !== undefined && BigInt(msg.uid) >= routeFromUid) {
      routeCandidates.push(row);
    }

    if (rows.length >= ENVELOPE_BATCH) await flushEnvelopes(rows.splice(0, rows.length));
  }

  if (rows.length) await flushEnvelopes(rows);
  return fetched;
}

/**
 * Пишет пачку конвертов. Повторная встреча того же UID обновляет флаги и
 * ничего не ломает: тело и его состояние остаются как были, иначе повторный
 * проход по папке сбрасывал бы всю уже скачанную переписку в очередь заново.
 */
async function flushEnvelopes(rows) {
  if (!rows.length) return;

  // Параметры передаются через bind ($1, $2, …), а не через replacements с
  // именами. Причина не стилистическая: replacements разворачивает массив в
  // список значений через запятую, и «flags: []» превращается в пустоту перед
  // ::text[] — запрос падает синтаксической ошибкой ровно на письмах без
  // флагов, то есть на непрочитанных. Через bind массив уезжает в pg массивом.
  const COLUMNS = 21;
  const bind = [];
  const values = rows.map((row, i) => {
    const p = (n) => `$${i * COLUMNS + n}`;
    bind.push(
      row.accountId, row.folderId, row.uid, row.messageId, row.inReplyTo, row.references,
      row.threadKey, row.subject, row.fromName, row.fromEmail, row.sentAt, row.receivedAt,
      row.size, row.flags, row.isSeen, row.isFlagged, row.isAnswered, row.isDraft,
      row.hasAttachments, row.attachmentsCount, row.modSeq
    );
    return `(
      gen_random_uuid(), ${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}::text[],
      ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)}, ${p(13)},
      ${p(14)}::text[], ${p(15)}, ${p(16)}, ${p(17)}, ${p(18)}, ${p(19)},
      ${p(20)}, ${p(21)}, NOW(), NOW()
    )`;
  }).join(',');

  await sequelize.query(`
    INSERT INTO mail_messages (
      id, "accountId", "folderId", uid, "messageId", "inReplyTo", "references",
      "threadKey", subject, "fromName", "fromEmail", "sentAt", "receivedAt", size,
      flags, "isSeen", "isFlagged", "isAnswered", "isDraft", "hasAttachments",
      "attachmentsCount", "modSeq", "createdAt", "updatedAt"
    ) VALUES ${values}
    ON CONFLICT ("folderId", uid) DO UPDATE SET
      flags = EXCLUDED.flags,
      "isSeen" = EXCLUDED."isSeen",
      "isFlagged" = EXCLUDED."isFlagged",
      "isAnswered" = EXCLUDED."isAnswered",
      "isDraft" = EXCLUDED."isDraft",
      "modSeq" = EXCLUDED."modSeq",
      "updatedAt" = NOW()
  `, { bind });
}

// ── Одна папка ────────────────────────────────────────────────────────────

async function syncFolder(client, account, folder, capabilities) {
  const box = await client.mailboxOpen(folder.path, { readOnly: true });
  let previousUidNext = folder.uidNext ? BigInt(folder.uidNext) : null;
  const routeCandidates = [];

  const remoteValidity = toBigIntString(box.uidValidity);
  const localValidity = toBigIntString(folder.uidValidity);
  if (localValidity && remoteValidity !== localValidity) previousUidNext = null;

  // Смена UIDVALIDITY означает, что нумерация на сервере началась заново и все
  // наши UID указывают в пустоту. Единственный честный выход — перезалить папку.
  if (localValidity && remoteValidity !== localValidity) {
    console.warn(`📬 Почта: у «${folder.name}» сменился UIDVALIDITY (${localValidity} → ${remoteValidity}), папка перезаливается`);
    await MailMessage.destroy({ where: { folderId: folder.id } });
    folder.set({ backfillUid: null, backfillDone: false, highestModSeq: null });
  }

  const [[local]] = await sequelize.query(
    'SELECT COUNT(*)::int AS count, MAX(uid)::bigint AS "maxUid", MIN(uid)::bigint AS "minUid" FROM mail_messages WHERE "folderId" = :folderId',
    { replacements: { folderId: folder.id } }
  );

  let fetched = 0;

  // 1. Новое. Всё, что старше известного нам максимума.
  const from = local.maxUid ? BigInt(local.maxUid) + 1n : 1n;
  if (BigInt(box.uidNext || 1) > from) {
    fetched += await fetchEnvelopes(client, account, folder, `${from}:*`, {
      routeCandidates: folder.path.toUpperCase() === 'INBOX' ? routeCandidates : null,
      routeFromUid: previousUidNext,
    });
  }

  // 2. Архив. Первичная заливка идёт вниз от самого старого известного письма,
  // порциями: один забитый ящик не должен держать соединение часами.
  if (!folder.backfillDone) {
    const ceiling = folder.backfillUid ? BigInt(folder.backfillUid) : (local.minUid ? BigInt(local.minUid) : null);
    if (ceiling === null || ceiling <= 1n) {
      folder.set({ backfillDone: true, backfillUid: null });
    } else {
      const bottom = ceiling - BigInt(BACKFILL_CHUNK) > 1n ? ceiling - BigInt(BACKFILL_CHUNK) : 1n;
      fetched += await fetchEnvelopes(client, account, folder, `${bottom}:${ceiling - 1n}`);
      folder.set({ backfillUid: String(bottom), backfillDone: bottom <= 1n });
    }
  }

  // 3. Изменения флагов. С CONDSTORE спрашиваем только изменившееся, без него —
  // сверяем целиком, но лишь когда счётчики разошлись.
  if (capabilities.condstore && folder.highestModSeq && box.highestModseq) {
    if (BigInt(box.highestModseq) > BigInt(folder.highestModSeq)) {
      fetched += await fetchFlagsChangedSince(client, folder, folder.highestModSeq);
    }
  }

  // 4. Исчезнувшие письма. Счётчик сервера — дешёвый и точный признак: если он
  // сошёлся с нашим, сверять список незачем.
  const localCount = Number(local.count) + fetched;
  if (box.exists !== undefined && box.exists !== localCount) {
    await reconcileDeletions(client, folder, box.exists);
  }

  folder.set({
    uidValidity: remoteValidity,
    uidNext: toBigIntString(box.uidNext),
    highestModSeq: toBigIntString(box.highestModseq),
    messagesTotal: box.exists ?? 0,
    lastSyncAt: new Date(),
  });
  await folder.save();

  await client.mailboxClose();
  if (routeCandidates.length) await autoRouteNewMessages(client, account, folder, routeCandidates);
  return fetched;
}

function matchesFolderRule(message, folder) {
  if (folder.rulesUpdatedAt && new Date(message.receivedAt) < new Date(folder.rulesUpdatedAt)) return false;
  const tests = [];
  if (folder.fromContains) tests.push(`${message.fromEmail || ''} ${message.fromName || ''}`.toLowerCase().includes(folder.fromContains.toLowerCase()));
  if (folder.subjectContains) tests.push(String(message.subject || '').toLowerCase().includes(folder.subjectContains.toLowerCase()));
  if (folder.requireAttachments) tests.push(Boolean(message.hasAttachments));
  return tests.some(Boolean);
}

/**
 * Автосортировка работает только для UID, появившихся после предыдущей
 * синхронизации INBOX. Начальная заливка и историческая дозагрузка сюда не
 * попадают, поэтому настройка никогда не перекладывает старую переписку.
 */
async function autoRouteNewMessages(client, account, inbox, candidates) {
  const targets = await MailFolder.findAll({
    where: { accountId: account.id, selectable: true },
    order: [['sortOrder', 'ASC'], ['name', 'ASC']],
  });
  const rules = targets.filter((folder) => folder.id !== inbox.id && !folder.specialUse && folder.path.toUpperCase() !== 'INBOX' && (
    folder.fromContains || folder.subjectContains || folder.requireAttachments
  ));
  if (!rules.length) return;

  await client.mailboxOpen(inbox.path, { readOnly: false });
  for (const message of candidates) {
    const target = rules.find((folder) => matchesFolderRule(message, folder));
    if (!target) continue;
    try {
      let result;
      if (client.capabilities.has('MOVE')) {
        result = await client.messageMove(String(message.uid), target.path, { uid: true });
      } else {
        result = await client.messageCopy(String(message.uid), target.path, { uid: true });
        await client.messageFlagsAdd(String(message.uid), ['\\Deleted'], { uid: true });
        await client.messageDelete(String(message.uid), { uid: true });
      }
      const newUid = result?.uidMap?.get(Number(message.uid));
      const local = await MailMessage.findOne({ where: { folderId: inbox.id, uid: String(message.uid) } });
      if (local) {
        if (newUid) await local.update({ folderId: target.id, uid: String(newUid) });
        else await local.destroy(); // папка назначения получит копию при своей следующей синхронизации
      }
    } catch (error) {
      console.warn(`📬 Почта: не удалось автоматически переместить письмо UID ${message.uid}:`, error.message);
    }
  }
  await client.mailboxClose();
}

async function fetchFlagsChangedSince(client, folder, modSeq) {
  let updated = 0;
  for await (const msg of client.fetch('1:*', { uid: true, flags: true }, { uid: true, changedSince: BigInt(modSeq) })) {
    const flags = msg.flags ? [...msg.flags] : [];
    await sequelize.query(`
      UPDATE mail_messages SET
        flags = $1::text[], "isSeen" = $2, "isFlagged" = $3,
        "isAnswered" = $4, "isDraft" = $5, "modSeq" = $6, "updatedAt" = NOW()
      WHERE "folderId" = $7 AND uid = $8
    `, {
      bind: [
        flags,
        flags.includes('\\Seen'),
        flags.includes('\\Flagged'),
        flags.includes('\\Answered'),
        flags.includes('\\Draft'),
        toBigIntString(msg.modseq),
        folder.id,
        String(msg.uid),
      ],
    });
    updated += 1;
  }
  return updated;
}

/**
 * Сверяет список UID с сервером и убирает у себя то, чего там уже нет. Пока
 * первичная заливка не закончена, нижнюю границу ограничиваем: всё, что ниже
 * курсора, мы ещё просто не забирали, и удалять там нечего.
 */
async function reconcileDeletions(client, folder, remoteCount) {
  const remoteUids = await client.search({ all: true }, { uid: true });
  if (!Array.isArray(remoteUids)) return 0;

  const floor = folder.backfillDone ? '0' : String(folder.backfillUid || 0);

  const [result] = await sequelize.query(`
    DELETE FROM mail_messages
    WHERE "folderId" = $1
      AND uid >= $2
      AND NOT (uid = ANY($3::bigint[]))
    RETURNING id
  `, {
    bind: [folder.id, floor, remoteUids.map(String)],
  });

  const removed = Array.isArray(result) ? result.length : 0;
  if (removed) {
    console.log(`📬 Почта: в «${folder.name}» исчезло ${removed} писем (на сервере ${remoteCount}), убраны из зеркала`);
  }
  return removed;
}

// ── Ящик целиком ──────────────────────────────────────────────────────────

async function syncAccount(accountId) {
  const account = await MailAccount.scope('withSecret').findByPk(accountId);
  if (!account) throw new Error(`Ящик ${accountId} не найден`);
  if (!account.isActive) return { skipped: true };

  const run = await MailSyncRun.create({ accountId: account.id, kind: 'envelopes' });
  let fetched = 0;

  try {
    await account.update({ syncState: account.syncState === 'idle' ? 'headers' : account.syncState, syncStartedAt: new Date() });

    await withConnection(account, async (client, capabilities) => {
      await account.update({ capabilities });

      const folders = await syncFolders(client, account);
      for (const folder of folders) {
        fetched += await syncFolder(client, account, folder, capabilities);
      }
    });

    const [[pending]] = await sequelize.query(
      `SELECT COUNT(*)::int AS n FROM mail_messages WHERE "accountId" = :id AND "bodyState" = 'pending'`,
      { replacements: { id: account.id } }
    );
    const [[unfinished]] = await sequelize.query(
      'SELECT COUNT(*)::int AS n FROM mail_folders WHERE "accountId" = :id AND NOT "backfillDone"',
      { replacements: { id: account.id } }
    );

    const state = unfinished.n > 0 ? 'headers' : (pending.n > 0 ? 'bodies' : 'ready');

    await account.update({
      syncState: state,
      lastSyncAt: new Date(),
      syncFinishedAt: state === 'ready' ? new Date() : null,
      lastError: null,
      lastErrorAt: null,
    });

    await run.update({ finishedAt: new Date(), messagesFetched: fetched });
    return { fetched, state, pendingBodies: pending.n };
  } catch (err) {
    await account.update({ syncState: 'error', lastError: String(err.message || err).slice(0, 2000), lastErrorAt: new Date() });
    await run.update({ finishedAt: new Date(), messagesFetched: fetched, error: String(err.message || err).slice(0, 2000) });
    throw err;
  }
}

// ── Второй проход: тела ───────────────────────────────────────────────────

/**
 * Докачивает тела писем, у которых их ещё нет, от свежих к старым. Одно
 * соединение на пачку: открывать сессию ради каждого письма дороже, чем
 * подержать её на полсотни.
 */
async function fetchBodies(accountId, limit = 50) {
  const account = await MailAccount.scope('withSecret').findByPk(accountId);
  if (!account || !account.isActive) return { done: 0 };

  const pending = await MailMessage.findAll({
    where: { accountId: account.id, bodyState: 'pending' },
    order: [['receivedAt', 'DESC']],
    limit,
    include: [{ model: MailFolder, as: 'folder' }],
  });
  if (!pending.length) return { done: 0 };

  const run = await MailSyncRun.create({ accountId: account.id, kind: 'bodies' });
  let done = 0;
  let bytes = 0;

  // Письма одной папки идут подряд — так папка открывается один раз, а не на
  // каждое письмо.
  const byFolder = new Map();
  for (const msg of pending) {
    if (!byFolder.has(msg.folderId)) byFolder.set(msg.folderId, []);
    byFolder.get(msg.folderId).push(msg);
  }

  try {
    await withConnection(account, async (client) => {
      for (const [, messages] of byFolder) {
        const folder = messages[0].folder;
        if (!folder) continue;
        await client.mailboxOpen(folder.path, { readOnly: true });

        for (const message of messages) {
          try {
            // BODY.PEEK[]: читаем, не выставляя \Seen. Иначе синхронизация
            // молча помечала бы прочитанным всё, до чего дотянулась.
            const { content } = await client.download(String(message.uid), undefined, { uid: true });
            const source = await streamToBuffer(content);
            bytes += source.length;

            const parsed = await simpleParser(source, { skipImageLinks: true });
            await storeParsedBody(message, parsed, source);
            done += 1;
          } catch (err) {
            // Одно битое письмо не должно останавливать проход по ящику:
            // кривая кодировка и обрезанное вложение — обычное дело в архиве.
            console.warn(`📬 Почта: не разобралось письмо uid=${message.uid} (${err.message})`);
            await message.update({ bodyState: 'error' });
          }
        }

        await client.mailboxClose();
      }
    });

    await run.update({ finishedAt: new Date(), messagesFetched: done, bytesFetched: bytes });

    const [[left]] = await sequelize.query(
      `SELECT COUNT(*)::int AS n FROM mail_messages WHERE "accountId" = :id AND "bodyState" = 'pending'`,
      { replacements: { id: account.id } }
    );
    if (left.n === 0 && account.syncState === 'bodies') {
      await account.update({ syncState: 'ready', syncFinishedAt: new Date() });
    }

    return { done, bytes, left: left.n };
  } catch (err) {
    await run.update({ finishedAt: new Date(), messagesFetched: done, bytesFetched: bytes, error: String(err.message || err).slice(0, 2000) });
    throw err;
  }
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

module.exports = {
  syncAccount,
  fetchBodies,
  // Наружу ради проверок: разбор почты нельзя держать нетронутым тестами,
  // а поднимать ради них настоящий IMAP-сервер — несоразмерно.
  flushEnvelopes,
  syncFolders,
  syncFolder,
  hasRealAttachments,
  countRealAttachments,
  threadKeyOf,
  parseReferences,
  folderOrder,
  ENVELOPE_BATCH,
  BACKFILL_CHUNK,
};
