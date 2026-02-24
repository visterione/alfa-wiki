/**
 * Адаптер GetLoyalty (panel.getloyalty.io)
 *
 * Аутентификация — логин/пароль → PHP-сессия (cPHPSESSID).
 * Фильтрация по филиалу — через source_hash_key из sourcesCatalogue.
 *
 * Credentials для каждой доски:
 *   login    — email для входа в GetLoyalty
 *   password — пароль
 *   filialId — ID филиала (узнать через "Проверить подключение" без filialId)
 */

const axios = require('axios');

const BASE      = 'https://panel.getloyalty.io';
const TIMEOUT   = 20000;
const PAGE_SIZE = 100;

// Человекочитаемые названия площадок по ключу identity из GetLoyalty
const PLATFORM_NAMES = {
  yandex:      'Яндекс Карты',
  google:      'Google Maps',
  '2gis':      '2ГИС',
  prodoctorov: 'ПроДокторов',
  doctu:       'Докту',
  docdoc:      'DocDoc',
  napopravku:  'НаПоправку',
  flamp:       'Фламп',
  zoon:        'Зун',
  plasopro:    'Plaso.pro'
};

// ──────────────────────────────────────────────────────────────────────────────
// Логин: возвращает строку сессионной куки cPHPSESSID
// ──────────────────────────────────────────────────────────────────────────────

async function login(loginStr, password) {
  const endpoints = ['/action/login', '/login', '/'];

  for (const endpoint of endpoints) {
    try {
      const params = new URLSearchParams();
      params.append('login', loginStr);
      params.append('password', password);

      const resp = await axios.post(`${BASE}${endpoint}`, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (compatible; ReviewSync/1.0)'
        },
        timeout: TIMEOUT,
        maxRedirects: 5,
        validateStatus: s => s < 500
      });

      const cookies = [].concat(resp.headers['set-cookie'] || []);
      const sessionCookie = cookies.find(c => c.includes('cPHPSESSID='));
      if (sessionCookie) {
        const match = sessionCookie.match(/cPHPSESSID=([^;]+)/);
        if (match) return match[1];
      }

      if (resp.data?.status && resp.data.status !== 200) {
        throw new Error(resp.data.message || 'Неверный логин или пароль');
      }
    } catch (err) {
      if (err.response?.status === 404) continue;
      throw err;
    }
  }

  throw new Error('Не удалось войти в GetLoyalty. Проверьте логин и пароль.');
}

// ──────────────────────────────────────────────────────────────────────────────
// sourcesCatalogue: возвращает { filials, sources }
// filials: { "23263": { filial_name, ... }, ... }
// sources: { "<hash_key>": { identity, filials: ["23263", ...], ... }, ... }
// ──────────────────────────────────────────────────────────────────────────────

async function getSourcesCatalogue(session) {
  const resp = await axios.post(`${BASE}/action/platform/sourcesCatalogue`, null, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': `cPHPSESSID=${session}`,
      'User-Agent': 'Mozilla/5.0 (compatible; ReviewSync/1.0)'
    },
    timeout: TIMEOUT
  });

  if (!resp.data?.filials) {
    throw new Error('Не удалось получить список филиалов');
  }

  return resp.data;
}

// ──────────────────────────────────────────────────────────────────────────────
// Список филиалов — для UI "Проверить подключение"
// ──────────────────────────────────────────────────────────────────────────────

async function getFilials(session) {
  const catalogue = await getSourcesCatalogue(session);

  return Object.entries(catalogue.filials).map(([id, f]) => {
    // Собираем площадки для этого филиала
    const platforms = Object.values(catalogue.sources || {})
      .filter(s => s.filials?.includes(id))
      .map(s => PLATFORM_NAMES[s.identity] || s.identity)
      .filter((v, i, a) => a.indexOf(v) === i); // unique

    return { id, name: f.filial_name, platforms };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Основная функция: получить отзывы для конкретного филиала
// Фильтрация по филиалу — через source_hash_key, т.к. API не поддерживает
// фильтр filialId напрямую.
// ──────────────────────────────────────────────────────────────────────────────

async function fetchReviews(credentials, options = {}) {
  const { login: loginStr, password, filialId } = credentials;
  if (!loginStr || !password || !filialId) {
    throw new Error('Не заданы login, password или filialId');
  }

  const session = await login(loginStr, password);

  // Получаем source_hash_keys для нужного филиала
  const catalogue = await getSourcesCatalogue(session);
  const filialHashKeys = new Set();
  const sourceMap = {}; // hash_key → название площадки

  for (const [hashKey, source] of Object.entries(catalogue.sources || {})) {
    if (source.filials?.includes(String(filialId))) {
      filialHashKeys.add(hashKey);
      sourceMap[hashKey] = PLATFORM_NAMES[source.identity] || source.identity;
    }
  }

  if (filialHashKeys.size === 0) {
    throw new Error(`Филиал ${filialId} не найден или не имеет площадок`);
  }

  // Диапазон дат: вчера–сегодня (или явно переданный since)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const dateFrom = options.since
    ? options.since.toISOString().slice(0, 10)
    : yesterday.toISOString().slice(0, 10);
  const dateTo = new Date().toISOString().slice(0, 10);

  // Фильтры без filial — API не поддерживает фильтр по филиалу
  const filters = {
    sorting_direction: 'desc',
    date: { from: dateFrom, to: dateTo },
    tag: { value: [], mode: 'OR' }
  };

  const results = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const formData = new URLSearchParams();
    formData.append('offset', String(offset));
    formData.append('filters', JSON.stringify(filters));
    formData.append('sorting_direction', 'desc');

    const resp = await axios.post(
      `${BASE}/action/platform/review/catalogue`,
      formData,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Cookie': `cPHPSESSID=${session}`,
          'User-Agent': 'Mozilla/5.0 (compatible; ReviewSync/1.0)'
        },
        timeout: TIMEOUT
      }
    );

    if (!resp.data || resp.data.status !== 200) {
      throw new Error(`GetLoyalty API: ${resp.data?.message || resp.data?.status}`);
    }

    const reviews = resp.data.reviews || [];
    if (reviews.length === 0) { hasMore = false; break; }

    for (const r of reviews) {
      // Пропускаем отзывы других филиалов
      if (!filialHashKeys.has(r.source_hash_key)) continue;

      const reviewDate = r.date
        ? new Date(r.date * 1000)
        : new Date(r.created_at);

      const rawText = stripHtml(r.text || '');
      const { doctorName, cleanText } = extractDoctor(rawText);

      results.push({
        externalId:   `gl_${r.id}`,
        externalUrl:  r.review_link || null,
        authorName:   r.user_name || 'Аноним',
        rating:       r.rating ? Math.min(5, Math.max(1, Math.round(r.rating))) : null,
        text:         cleanText,
        date:         reviewDate,
        platformName: sourceMap[r.source_hash_key] || null,
        doctorName,
        tonal:        r.tonal || null,
        isAnswered:   !!r.is_answered
      });
    }

    offset += PAGE_SIZE;
    hasMore = reviews.length === PAGE_SIZE;
  }

  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// Проверить подключение
// ──────────────────────────────────────────────────────────────────────────────

async function testConnection(credentials) {
  try {
    const { login: loginStr, password, filialId } = credentials;
    if (!loginStr || !password) throw new Error('Не заданы login и password');

    const session = await login(loginStr, password);
    const filials = await getFilials(session);

    if (filialId) {
      const found = filials.find(f => f.id === String(filialId));
      if (!found) {
        return {
          success: false,
          message: `Филиал ${filialId} не найден. Доступные: ${filials.map(f => `${f.id} (${f.name})`).join(', ')}`
        };
      }
      return {
        success: true,
        message: `Подключено: ${found.name} | Площадки: ${found.platforms.join(', ')}`,
        filials
      };
    }

    return {
      success: true,
      message: `Вход успешен. Найдено филиалов: ${filials.length}`,
      filials
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────────

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Извлекает имя врача из начала текста отзыва.
 * Паттерн: "отзыв о враче/докторе/специалисте Фамилия Имя [Отчество]"
 * Отчество определяется по окончанию (-ович/-овна/-евич/-евна/-ична/-ьич).
 * Возвращает { doctorName, cleanText } — текст без вступительной фразы.
 */
const OTCHESTVO_RE = /(?:ович|евич|овна|евна|ична|иевна|ьич)$/;

function extractDoctor(text) {
  if (!text) return { doctorName: null, cleanText: text };

  // Паттерн 1: "Отзыв о враче/докторе/специалисте Фамилия Имя [Отчество]" — начало текста
  const prefixMatch = text.match(/^[Оо]тзыв\s+о\s+(?:враче?|докторе?|специалисте?)\s+/);
  if (prefixMatch) {
    const rest = text.slice(prefixMatch[0].length);

    const three = rest.match(/^([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)/);
    if (three && OTCHESTVO_RE.test(three[3])) {
      const doctorName = `${three[1]} ${three[2]} ${three[3]}`;
      return { doctorName, cleanText: rest.slice(doctorName.length).trim() };
    }

    const two = rest.match(/^([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)/);
    if (two) {
      const doctorName = `${two[1]} ${two[2]}`;
      return { doctorName, cleanText: rest.slice(doctorName.length).trim() };
    }
  }

  // Паттерн 2: "Лечащий врач: Фамилия Имя [Отчество]" — в любом месте текста (ПроДокторов)
  const lcMatch = text.match(/Лечащий врач:\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})/);
  if (lcMatch) {
    const doctorName = lcMatch[1].trim();
    const cleanText = text.replace(lcMatch[0], '').trim();
    return { doctorName, cleanText };
  }

  return { doctorName: null, cleanText: text };
}

const credentialsSchema = [
  {
    key: 'login',
    label: 'Логин',
    type: 'text',
    placeholder: 'email@example.com',
    required: true
  },
  {
    key: 'password',
    label: 'Пароль',
    type: 'password',
    placeholder: '••••••••',
    required: true
  },
  {
    key: 'filialId',
    label: 'ID филиала',
    type: 'text',
    placeholder: '23263',
    required: true,
    hint: 'Нажмите "Проверить подключение" без ID — система покажет список всех ваших филиалов'
  }
];

module.exports = { fetchReviews, testConnection, credentialsSchema, getFilials, login };
