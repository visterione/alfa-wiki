'use strict';

/**
 * Логотип внешнего отправителя по BIMI или favicon его домена.
 *
 * Письма показываются без внешних картинок, чтобы пиксели слежения не узнали,
 * что сотрудник открыл письмо. Поэтому логотип тоже не отдаём браузеру прямой
 * ссылкой: сервер сам получает картинку, превращает её в небольшой PNG и кладёт
 * результат в короткий кэш.
 */

const dns = require('dns').promises;
const net = require('net');
const axios = require('axios');
const sharp = require('sharp');

const HIT_TTL = 24 * 60 * 60 * 1000;
const MISS_TTL = 4 * 60 * 60 * 1000;
const MAX_SOURCE_BYTES = 512 * 1024;
const cache = new Map();
const pending = new Map();

function normalizeDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!domain || domain.length > 253 || net.isIP(domain)) return null;
  if (!domain.includes('.') || !domain.split('.').every((label) => (
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))) return null;
  return domain;
}

function domainCandidates(domain) {
  const labels = domain.split('.');
  const result = [];
  const secondLevelSuffixes = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);
  const minimumLabels = labels.at(-1).length === 2 && secondLevelSuffixes.has(labels.at(-2)) ? 3 : 2;
  // BIMI может лежать как на полном From-домене, так и на домене организации.
  for (let i = 0; i <= labels.length - minimumLabels; i += 1) result.push(labels.slice(i).join('.'));
  return result;
}

function isPrivateIp(address) {
  const normalized = String(address || '').toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:')) return isPrivateIp(normalized.slice(7));

  if (net.isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19));
  }

  if (net.isIP(normalized) === 6) {
    return normalized === '::' || normalized === '::1'
      || normalized.startsWith('fc') || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized);
  }
  return true;
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolveBimiUrl(domain) {
  for (const candidate of domainCandidates(domain)) {
    try {
      const rows = await withTimeout(dns.resolveTxt(`default._bimi.${candidate}`), 2500);
      const record = rows.map((parts) => parts.join('')).find((value) => /^\s*v\s*=\s*BIMI1\s*;/i.test(value));
      if (!record) continue;
      const location = record.split(';')
        .map((part) => part.trim())
        .find((part) => /^l\s*=/i.test(part));
      const rawUrl = location?.replace(/^l\s*=\s*/i, '').trim();
      if (!rawUrl) continue;
      const url = new URL(rawUrl);
      if (url.protocol === 'https:') return url;
    } catch (error) {
      // NXDOMAIN, таймаут и некорректная запись означают только отсутствие
      // аватарки. Сам список писем из-за этого не должен шуметь ошибками.
    }
  }
  return null;
}

async function assertPublicHost(hostname) {
  const addresses = await withTimeout(dns.lookup(hostname, { all: true }), 2500);
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('BIMI logo host is not public');
  }
}

async function downloadSource(url, redirectsLeft = 3) {
  await assertPublicHost(url.hostname);
  const response = await axios.get(url.toString(), {
    responseType: 'arraybuffer',
    timeout: 5000,
    maxContentLength: MAX_SOURCE_BYTES,
    maxBodyLength: MAX_SOURCE_BYTES,
    maxRedirects: 0,
    validateStatus: (status) => status === 200 || (status >= 300 && status < 400),
    headers: { Accept: 'image/svg+xml,image/*;q=0.8' },
  });

  if (response.status !== 200) {
    if (!redirectsLeft || !response.headers.location) throw new Error('Too many image redirects');
    const redirected = new URL(response.headers.location, url);
    if (redirected.protocol !== 'https:') throw new Error('Unsafe image redirect');
    return downloadSource(redirected, redirectsLeft - 1);
  }

  const source = Buffer.from(response.data);
  if (!source.length || source.length > MAX_SOURCE_BYTES) throw new Error('BIMI logo is too large');
  return source;
}

function assertSafeSvg(source) {
  const text = source.toString('utf8');
  if (!/<svg\b/i.test(text) || /<!doctype|<!entity|<script|<foreignObject|<(?:image|use)\b|\bon\w+\s*=|\b(?:href|xlink:href)\s*=/i.test(text)) {
    throw new Error('Unsafe or invalid logo SVG');
  }
}

async function renderLogo(source, requireSvg = false) {
  const looksLikeSvg = /<svg\b/i.test(source.toString('utf8', 0, Math.min(source.length, 2048)));
  if (requireSvg && !looksLikeSvg) throw new Error('BIMI logo is not SVG');
  if (looksLikeSvg) assertSafeSvg(source);

  // Растрирование отделяет браузер от исходного SVG и от его метаданных.
  return sharp(source, { limitInputPixels: 4_000_000 })
    .resize(80, 80, { fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function downloadBimiLogo(url) {
  return renderLogo(await downloadSource(url), true);
}

async function downloadFavicon(domain) {
  for (const candidate of domainCandidates(domain)) {
    try {
      return await renderLogo(await downloadSource(new URL(`https://${candidate}/favicon.ico`)));
    } catch (error) {
      // У почтовых поддоменов favicon обычно нет; продолжаем до домена бренда.
    }
  }

  // Некоторые площадки (в частности REG.RU) вместо favicon отдают антибот-
  // страницу. Публичный кэш Google в таком случае возвращает ту же иконку без
  // выполнения JavaScript. Запрос идёт с backend и не раскрывает пользователя.
  try {
    const cached = new URL('https://www.google.com/s2/favicons');
    cached.searchParams.set('domain', domain);
    cached.searchParams.set('sz', '64');
    return await renderLogo(await downloadSource(cached));
  } catch (error) {
    // Цветной инициал в интерфейсе остаётся последним безопасным вариантом.
  }
  return null;
}

async function loadSenderLogo(domainValue) {
  const domain = normalizeDomain(domainValue);
  if (!domain) return null;

  const cached = cache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (pending.has(domain)) return pending.get(domain);

  const work = (async () => {
    let value = null;
    try {
      const url = await resolveBimiUrl(domain);
      if (url) {
        try { value = await downloadBimiLogo(url); } catch (error) { value = null; }
      }
      if (!value) value = await downloadFavicon(domain);
    } catch (error) {
      value = null;
    }
    cache.set(domain, { value, expiresAt: Date.now() + (value ? HIT_TTL : MISS_TTL) });
    return value;
  })().finally(() => pending.delete(domain));

  pending.set(domain, work);
  return work;
}

module.exports = {
  loadSenderLogo,
  normalizeDomain,
  domainCandidates,
  isPrivateIp,
  resolveBimiUrl,
  assertSafeSvg,
};
