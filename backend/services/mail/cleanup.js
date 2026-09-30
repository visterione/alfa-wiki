'use strict';

/**
 * Уборка хранилища почты (ver. 9.11).
 *
 * Строки писем исчезают многими путями: удаление в портале и в Roundcube,
 * перенос в другую папку (у письма там новый UID, и оно качается заново),
 * смена UIDVALIDITY, исчезнувшая папка, удалённый ящик. Файлы при этом
 * оставались на диске навсегда. Для места это терпимо, но в ящиках жалобы с
 * данными пациентов, и «удалённое» письмо, которое продолжает лежать на
 * сервере портала, — это уже не вопрос места.
 *
 * Удалять файл в каждом из этих путей значило бы размазать ответственность по
 * пяти местам и однажды забыть шестое — каскад в базе, например, вообще не
 * даёт знать, что он что-то удалил. Поэтому уборка устроена обходом: файл,
 * на который не ссылается ни одна строка, считается мусором. Сырые письма
 * называются UUID письма, вложения — sha256 содержимого, так что сверка
 * получается пачками по сотне имён за запрос.
 *
 * Свежие файлы не трогаем: тело письма пишется на диск до конца транзакции, и
 * на эти секунды файл уже есть, а строки о вложении ещё нет.
 */

const fsp = require('fs/promises');
const path = require('path');
const { Op } = require('sequelize');

const { sequelize, MailDraft, MailSyncRun, MailFlagOp } = require('../../models');
const { STORE_ROOT } = require('./store');
const { MAX_ATTEMPTS } = require('./flags');

const MIN_AGE_MS = 60 * 60 * 1000;
const BATCH = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Журнал синхронизации нужен, чтобы разобраться со свежим сбоем; двух недель
// хватает с запасом. Без чистки он рос на две строки на ящик за круг — около
// пятидесяти тысяч строк в сутки на сотню ящиков.
const SYNC_RUNS_KEEP_DAYS = 14;
// Файлы отправленных писем: копия уже лежит в «Отправленных» на сервере и
// приедет к нам обычной синхронизацией.
const OUTBOX_SENT_KEEP_DAYS = 7;

async function listDir(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
}

async function isOld(abs, now) {
  try {
    const stat = await fsp.stat(abs);
    return now - stat.mtimeMs > MIN_AGE_MS;
  } catch (e) {
    return false;
  }
}

/** Удаляет из пачки те файлы, чьих ключей нет в базе. */
async function removeUnreferenced(batch, sql, now, stats) {
  if (!batch.length) return;
  const [rows] = await sequelize.query(sql, { bind: [batch.map((f) => f.key)] });
  const alive = new Set(rows.map((r) => r.key));
  for (const file of batch) {
    if (alive.has(file.key)) continue;
    if (!(await isOld(file.abs, now))) continue;
    await fsp.unlink(file.abs).catch(() => {});
    stats.removed += 1;
  }
  batch.length = 0;
}

/**
 * Сырые письма: <accountId>/<год>/<месяц>/<uuid письма>.eml.gz. Каталог
 * ящика, которого больше нет, уходит целиком тем же обходом — все его файлы
 * окажутся без строк.
 */
async function sweepRaw(now = Date.now()) {
  const stats = { checked: 0, removed: 0 };
  const sql = 'SELECT id::text AS key FROM mail_messages WHERE id = ANY($1::uuid[])';
  const batch = [];

  for (const account of await listDir(STORE_ROOT)) {
    if (!account.isDirectory() || !UUID_RE.test(account.name)) continue;
    const accountDir = path.join(STORE_ROOT, account.name);
    for (const year of await listDir(accountDir)) {
      if (!year.isDirectory()) continue;
      for (const month of await listDir(path.join(accountDir, year.name))) {
        if (!month.isDirectory()) continue;
        const monthDir = path.join(accountDir, year.name, month.name);
        for (const file of await listDir(monthDir)) {
          const key = file.name.replace(/\.eml\.gz$/, '');
          if (!file.isFile() || !UUID_RE.test(key)) continue;
          stats.checked += 1;
          batch.push({ key, abs: path.join(monthDir, file.name) });
          if (batch.length >= BATCH) await removeUnreferenced(batch, sql, now, stats);
        }
        await removeUnreferenced(batch, sql, now, stats);
        await fsp.rmdir(monthDir).catch(() => {}); // уйдёт, только если пустой
      }
      await fsp.rmdir(path.join(accountDir, year.name)).catch(() => {});
    }
    await fsp.rmdir(accountDir).catch(() => {});
  }
  return stats;
}

/**
 * Вложения: attachments/ab/cd/<sha256>. Файл один на все письма с тем же
 * содержимым, поэтому удаляется, только когда на него не ссылается никто.
 * Недописанные .tmp от прерванной записи убираются тем же проходом.
 */
async function sweepAttachments(now = Date.now()) {
  const stats = { checked: 0, removed: 0 };
  const sql = 'SELECT DISTINCT sha256 AS key FROM mail_attachments WHERE sha256 = ANY($1::text[])';
  const root = path.join(STORE_ROOT, 'attachments');
  const batch = [];

  for (const a of await listDir(root)) {
    if (!a.isDirectory()) continue;
    for (const b of await listDir(path.join(root, a.name))) {
      if (!b.isDirectory()) continue;
      const dir = path.join(root, a.name, b.name);
      for (const file of await listDir(dir)) {
        if (!file.isFile()) continue;
        const abs = path.join(dir, file.name);
        if (file.name.endsWith('.tmp')) {
          if (await isOld(abs, now)) {
            await fsp.unlink(abs).catch(() => {});
            stats.removed += 1;
          }
          continue;
        }
        if (!/^[0-9a-f]{64}$/.test(file.name)) continue;
        stats.checked += 1;
        batch.push({ key: file.name, abs });
        if (batch.length >= BATCH) await removeUnreferenced(batch, sql, now, stats);
      }
      await removeUnreferenced(batch, sql, now, stats);
      await fsp.rmdir(dir).catch(() => {});
    }
    await fsp.rmdir(path.join(root, a.name)).catch(() => {});
  }
  return stats;
}

/**
 * Файлы черновиков: outbox/<id черновика>/. Уходят вместе с удалённым
 * черновиком (это делает маршрут), но черновик, удалённый каскадом вместе с
 * ящиком, и отправленные письма оставляли их навсегда.
 */
async function sweepOutbox(now = Date.now()) {
  const stats = { checked: 0, removed: 0 };
  const root = path.join(STORE_ROOT, 'outbox');
  const dirs = (await listDir(root)).filter((d) => d.isDirectory() && UUID_RE.test(d.name)).map((d) => d.name);
  if (!dirs.length) return stats;

  const sentBefore = new Date(now - OUTBOX_SENT_KEEP_DAYS * 24 * 3600 * 1000);
  for (let i = 0; i < dirs.length; i += BATCH) {
    const chunk = dirs.slice(i, i + BATCH);
    const drafts = await MailDraft.findAll({ where: { id: chunk }, attributes: ['id', 'status', 'sentAt'] });
    const keep = new Set(drafts
      .filter((d) => d.status !== 'sent' || !d.sentAt || d.sentAt > sentBefore)
      .map((d) => d.id));

    for (const id of chunk) {
      stats.checked += 1;
      if (keep.has(id)) continue;
      const abs = path.join(root, id);
      if (!(await isOld(abs, now))) continue;
      await fsp.rm(abs, { recursive: true, force: true });
      stats.removed += 1;
    }
  }
  return stats;
}

/** Строки, которые копятся без пользы: журнал синхронизации и мёртвые отметки. */
async function cleanupTables(now = Date.now()) {
  const runs = await MailSyncRun.destroy({
    where: { startedAt: { [Op.lt]: new Date(now - SYNC_RUNS_KEEP_DAYS * 24 * 3600 * 1000) } },
  });
  // Отметки, на которых сдались после MAX_ATTEMPTS попыток. Выполненные чистит
  // cleanupFlagOps; эти раньше оставались навсегда.
  const deadOps = await MailFlagOp.destroy({
    where: {
      doneAt: null,
      attempts: { [Op.gte]: MAX_ATTEMPTS },
      createdAt: { [Op.lt]: new Date(now - 30 * 24 * 3600 * 1000) },
    },
  });
  return { syncRuns: runs, deadFlagOps: deadOps };
}

async function sweepStore() {
  const now = Date.now();

  // Предохранитель: уборка считает мусором всё, чего нет в базе. Воркер,
  // по ошибке запущенный против пустой или тестовой базы при боевом
  // MAIL_STORE_PATH, иначе стёр бы хранилище целиком.
  const [[{ n }]] = await sequelize.query('SELECT COUNT(*)::int AS n FROM mail_messages WHERE "rawPath" IS NOT NULL');
  if (!n) {
    throw new Error('в базе нет ни одного письма с телом — похоже на чужую или пустую базу, файлы не трогаю');
  }

  return {
    raw: await sweepRaw(now),
    attachments: await sweepAttachments(now),
    outbox: await sweepOutbox(now),
    tables: await cleanupTables(now),
  };
}

module.exports = { sweepStore, sweepRaw, sweepAttachments, sweepOutbox, cleanupTables, MIN_AGE_MS };
