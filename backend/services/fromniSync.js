/**
 * Синхронизация подписчиков ботов из Fromni в МИС.
 *
 * Fromni — единственный источник (наши боты Telegram/MAX не поднимаем: это те же
 * боты, что подключены к Fromni, плюс Telegram требует VPN, а MAX — наоборот без VPN;
 * один процесс их не потянет. Fromni API доступен независимо).
 *
 * Логика: POST /contacts (фильтр по бот-каналу telegram/max, опц. createdAt >= since)
 *   -> для каждого контакта: phone -> getPatient -> addPatientCategory каждому пациенту
 *      (семьи = несколько карт) -> upsert bot_subscribers.
 * Идемпотентно: подписчик со status='tagged' пропускается до похода в МИС.
 *
 * Категория зависит только от платформы (2 категории), organization — разрез статистики.
 */
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const { BotSubscriber } = require('../models');
const { normalizePhone, getPatientsByPhone, addPatientCategory } = require('./misClient');
const { ORGANIZATIONS } = require('../bot/patient/config');

const FROMNI_BASE = process.env.FROMNI_BASE_URL || 'https://api.fromni.com/user';
const PAGE = Number(process.env.FROMNI_PAGE || 200); // меньше страница = быстрее ответ, меньше шанс RST от файрвола
const CONCURRENCY = 4;

// keep-alive + форс IPv4: лечит ECONNRESET на долгих запросах к Fromni из дата-центра
// (файрвол/балансировщик рвёт простаивающее или IPv6-соединение). Настраивается через env при необходимости.
const fromniAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 5000,
  family: process.env.FROMNI_IPV6 ? 0 : 4,
  maxSockets: 8,
  // Сервер Fromni (старый nginx) запрашивает legacy TLS-ренегоциацию, которую OpenSSL 3
  // по умолчанию запрещает → ECONNRESET. Разрешаем её (как это делает Windows/curl).
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT | crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION,
});

const FROMNI_KEY_ENV = {
  'alfa': 'FROMNI_KEY_ALFA',
  'alfa-deti': 'FROMNI_KEY_ALFA_DETI',
  'alfa-liniya': 'FROMNI_KEY_ALFA_LINIYA',
  'alfa-prof': 'FROMNI_KEY_ALFA_PROF',
  'alfa-smile': 'FROMNI_KEY_ALFA_SMILE',
  'alfa-3k': 'FROMNI_KEY_ALFA_3K'
};

// Fromni-канал -> наша платформа. misTag=true: помечаем пациента в МИС (нужен телефон).
// telegram-web (номерной телеграм) — без телефона/МИС, идёт в счётчик Telegram как status='web'.
// Порядок важен: сначала бот (tagged), потом telegram-web (не перезатирает бот-записи).
const CHANNELS = [
  { channel: 'telegram', platform: 'telegram', categoryId: process.env.MIS_CATEGORY_TELEGRAM, misTag: true },
  { channel: 'telegram-web', platform: 'telegram', categoryId: process.env.MIS_CATEGORY_TELEGRAM, misTag: false },
  { channel: 'max', platform: 'max', categoryId: process.env.MIS_CATEGORY_MAX, misTag: true }
];

const RETRIABLE_CODES = ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN'];
async function postWithRetry(client, path, body, tries = 6) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try { return await client.post(path, body); }
    catch (err) {
      lastErr = err;
      const status = err.response && err.response.status;
      const retriable = !status || status >= 502 || RETRIABLE_CODES.includes(err.code);
      if (!retriable || attempt === tries) throw err;
      const wait = 2000 * attempt;
      console.warn(`     Fromni ${err.code || status}, ретрай ${attempt}/${tries - 1} через ${wait / 1000}с...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function mapPool(items, limit, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await worker(items[idx], idx); }
  }));
}

// Тянет контакты организации по бот-каналу (опц. только созданные с sinceDate), с пагинацией
async function fetchContacts(key, channel, sinceDate, limitCap) {
  const client = axios.create({
    baseURL: FROMNI_BASE,
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json', Connection: 'keep-alive' },
    timeout: 90000,
    httpsAgent: fromniAgent,
  });
  const conditions = [{ union: 'and', conditions: [{ field: 'channels', op: 'eq', value: channel }] }];
  if (sinceDate) {
    conditions.push({ union: 'and', conditions: [{ field: 'createdAt', op: 'gte', value: sinceDate.toISOString() }] });
  }
  const body = (offset) => ({ filter: { union: 'and', conditions }, limit: PAGE, offset, order: [['createdAt', 'ASC']] });

  const out = [];
  let offset = 0, total = Infinity;
  while (offset < total) {
    const { data } = await postWithRetry(client, '/contacts', body(offset));
    total = data.total || 0;
    const rows = data.data || [];
    for (const c of rows) {
      const profile = (c.profiles || []).find(p => p.channel === channel);
      if (!profile) continue;
      const info = profile.info || {};
      out.push({
        externalUserId: String(profile.profileId),
        phone: c.phone || null,
        username: info.username || null,
        firstName: info.first_name || info.firstName || null,
        lastName: info.last_name || info.lastName || null,
        subscribedAt: profile.createdAt ? new Date(profile.createdAt) : (c.createdAt ? new Date(c.createdAt) : null)
      });
    }
    offset += PAGE;
    console.log(`     Fromni[${channel}]: загружено ${Math.min(offset, total)}/${total}`);
    if (rows.length < PAGE) break;
    if (limitCap && out.length >= limitCap) break;
  }
  return limitCap ? out.slice(0, limitCap) : out;
}

async function upsert(cfg, c, fields) {
  const where = { platform: cfg.platform, organization: cfg.org, externalUserId: c.externalUserId };
  const base = {
    organization: cfg.org, source: 'import',
    username: c.username, firstName: c.firstName, lastName: c.lastName,
    startedAt: c.subscribedAt || new Date()
  };
  const [row, created] = await BotSubscriber.findOrCreate({ where, defaults: { ...base, ...fields } });
  if (!created) await row.update({ ...base, ...fields });
}

async function processOrgChannel(org, orgName, ch, opts, ctx, stats) {
  const key = process.env[FROMNI_KEY_ENV[org]];
  if (!key) { console.warn(`  ⚠️ нет ключа Fromni для ${org}, пропуск`); return; }
  if (ch.misTag && !ch.categoryId) { console.warn(`  ⚠️ нет category_id для ${ch.platform}, пропуск`); return; }

  const contacts = await fetchContacts(key, ch.channel, opts.sinceDate, opts.limit);
  const cfg = { org, orgName, platform: ch.platform, categoryId: ch.categoryId };

  // Номерной телеграм: без телефона/МИС — только счётчик (status='web').
  // findOrCreate не перезатирает существующие бот-записи (человек в боте И номерном считается один раз).
  if (!ch.misTag) {
    if (contacts.length) console.log(`  [${ch.channel}] контактов: ${contacts.length} (счётчик, без МИС)`);
    stats.fetched += contacts.length;
    if (opts.dryRun) { stats.wouldTag += contacts.length; return; }
    await mapPool(contacts, CONCURRENCY, async (c) => {
      try {
        const [, created] = await BotSubscriber.findOrCreate({
          where: { platform: ch.platform, organization: org, externalUserId: c.externalUserId },
          defaults: {
            organization: org, source: 'import',
            username: c.username, firstName: c.firstName, lastName: c.lastName,
            phone: null, patientIds: [], status: 'web', startedAt: c.subscribedAt || new Date()
          }
        });
        if (created) stats.web++; else stats.alreadyTagged++;
      } catch (err) { stats.errors++; console.error(`     web ошибка:`, err.message); }
    });
    return;
  }

  const withPhone = contacts.filter(c => c.phone);
  if (contacts.length) console.log(`  [${ch.platform}] контактов: ${contacts.length} (с телефоном: ${withPhone.length})`);
  stats.fetched += contacts.length;
  stats.noPhone += contacts.length - withPhone.length;

  if (opts.dryRun) { stats.wouldTag += withPhone.length; return; }

  let done = 0;
  await mapPool(withPhone, CONCURRENCY, async (c) => {
    try {
      const existing = await BotSubscriber.findOne({ where: { platform: ch.platform, organization: org, externalUserId: c.externalUserId } });
      if (existing && existing.status === 'tagged') { stats.alreadyTagged++; return; }

      const patients = await ctx.getPatientsCached(c.phone);
      const patientIds = patients.map(p => p.patient_id).filter(Boolean);
      const now = new Date();

      if (patientIds.length === 0) {
        await upsert(cfg, c, { phone: normalizePhone(c.phone), patientIds: [], status: 'identified', identifiedAt: c.subscribedAt || now });
        stats.notFound++;
        return;
      }
      for (const patient of patients) {
        const pid = patient.patient_id;
        if (!pid) continue;
        const cacheKey = `${pid}:${ch.categoryId}`;
        if (ctx.taggedCache.has(cacheKey)) continue;
        const cats = Array.isArray(patient.category_ids) ? patient.category_ids.map(String) : null;
        if (cats && cats.includes(String(ch.categoryId))) { ctx.taggedCache.add(cacheKey); continue; }
        const ok = await addPatientCategory(pid, ch.categoryId);
        if (ok) { ctx.taggedCache.add(cacheKey); stats.patientsTagged++; }
      }
      await upsert(cfg, c, { phone: normalizePhone(c.phone), patientIds, status: 'tagged', identifiedAt: c.subscribedAt || now, taggedAt: now });
      stats.tagged++;
    } catch (err) {
      stats.errors++;
      console.error(`     ошибка ${c.phone}:`, err.message);
    } finally {
      if (++done % 100 === 0) console.log(`     [${ch.platform}] МИС: обработано ${done}/${withPhone.length}`);
    }
  });
}

/**
 * @param {object} opts { sinceDate?: Date, onlyOrg?, onlyPlatform?, dryRun?, limit? }
 * @returns {object} stats
 */
async function runSync(opts = {}) {
  const phoneCache = new Map();
  const ctx = {
    taggedCache: new Set(),
    getPatientsCached(phone) {
      const k = normalizePhone(phone);
      if (!phoneCache.has(k)) phoneCache.set(k, getPatientsByPhone(k).catch(() => []));
      return phoneCache.get(k);
    }
  };
  const orgs = Object.entries(ORGANIZATIONS).filter(([o]) => !opts.onlyOrg || o === opts.onlyOrg);
  const channels = CHANNELS.filter(c => !opts.onlyPlatform || c.platform === opts.onlyPlatform);
  const stats = { fetched: 0, noPhone: 0, wouldTag: 0, alreadyTagged: 0, notFound: 0, tagged: 0, patientsTagged: 0, web: 0, errors: 0 };

  for (const [org, orgName] of orgs) {
    console.log(`▶ ${orgName} (${org})`);
    for (const ch of channels) {
      try { await processOrgChannel(org, orgName, ch, opts, ctx, stats); }
      catch (err) { console.error(`  ❌ ${ch.platform}: ${err.message}`); stats.errors++; }
    }
  }
  return stats;
}

module.exports = { runSync };
