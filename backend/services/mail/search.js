'use strict';

/**
 * Поиск по письмам (ver. 8.58).
 *
 * Одна строка ищет везде сразу: в теме, тексте, именах и адресах людей, именах
 * вложений. Заставлять человека выбирать, где искать, — лишний шаг перед каждым
 * запросом, а помнит он обычно не «где», а «что».
 *
 * Уточнения возможны приставками — from:, тема:, есть:вложение, после:2024-01-01.
 * Они задуманы как ускоритель для тех, кто втянется, а не как основной способ:
 * заставлять регистратуру учить синтаксис — верный способ добиться, чтобы
 * поиском не пользовались. Поэтому у каждой приставки есть русское имя, а
 * непонятное «слово:» трактуется как обычный текст, а не как ошибка.
 *
 * Про то, почему вектор собран двумя конфигурациями и почему запрос по
 * несклоняемой части идёт с префиксом, подробно написано в миграции у колонки
 * searchVector. Коротко: русский стеммер несимметрично калечит фамилии —
 * «Иванов» превращается в «иван», а «Иванову» в «иванов», — и на одной только
 * русской конфигурации поиск по фамилии работал бы через раз.
 */

const { sequelize } = require('../../models');

// Приставки и их русские имена. Русские здесь не украшение: человек, которому
// показали «тема:договор», повторит именно это, а не subject:.
const FIELD_ALIASES = {
  from: 'from', от: 'from', отправитель: 'from',
  to: 'to', кому: 'to',
  cc: 'cc', копия: 'cc',
  subject: 'subject', тема: 'subject',
  has: 'has', есть: 'has',
  is: 'is', статус: 'is',
  before: 'before', до: 'before',
  after: 'after', после: 'after', since: 'after',
  folder: 'folder', папка: 'folder',
  file: 'file', файл: 'file', вложение: 'file',
  larger: 'larger', больше: 'larger',
  smaller: 'smaller', меньше: 'smaller',
};

const HAS_VALUES = {
  attachment: 'attachment', вложение: 'attachment', вложения: 'attachment', файл: 'attachment',
};

const IS_VALUES = {
  unread: 'unread', непрочитанное: 'unread', непрочитанные: 'unread', новое: 'unread',
  read: 'read', прочитанное: 'read',
  flagged: 'flagged', флажок: 'flagged', важное: 'flagged',
  answered: 'answered', отвеченное: 'answered',
  unanswered: 'unanswered', неотвеченное: 'unanswered',
  unflagged: 'unflagged', безфлажка: 'unflagged',
};

/**
 * Разбивает строку на слова, не разрывая кавычки.
 *
 * Кавычки бывают в двух местах, и оба встречаются в живом наборе:
 * «"акт сверки"» — фраза целиком, и «тема:"акт сверки"» — значение уточнения из
 * нескольких слов. Во втором случае приставка остаётся приклеенной к значению,
 * и дальше её разбирает общий разбор по двоеточию.
 */
function tokenize(input) {
  const tokens = [];
  const re = /([^\s:"]+:)?"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(input || '')))) {
    if (m[2] !== undefined) {
      if (m[1]) tokens.push({ value: m[1] + m[2], quoted: false });
      else tokens.push({ value: m[2], quoted: true });
    } else {
      tokens.push({ value: m[3], quoted: false });
    }
  }
  return tokens;
}

/**
 * Дата. Принимаем и машинный вид, и привычный русский, и слова: человек скорее
 * напишет «после:вчера», чем станет считать, какое вчера было число.
 */
function parseDate(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;

  const now = new Date();
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shiftDays = (n) => startOfDay(new Date(now.getTime() - n * 86400000));

  if (text === 'сегодня' || text === 'today') return startOfDay(now);
  if (text === 'вчера' || text === 'yesterday') return shiftDays(1);
  if (text === 'неделя' || text === 'week') return shiftDays(7);
  if (text === 'месяц' || text === 'month') return shiftDays(30);
  if (text === 'год' || text === 'year') return shiftDays(365);

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  m = /^(\d{1,2})\.(\d{1,2})$/.exec(text);
  if (m) return new Date(now.getFullYear(), Number(m[2]) - 1, Number(m[1]));

  return null;
}

function parseSize(value) {
  const match = /^(\d+(?:[.,]\d+)?)\s*(б|b|кб|kb|мб|mb)?$/i.exec(String(value || '').trim());
  if (!match) return null;
  const unit = (match[2] || 'б').toLowerCase();
  const multiplier = { 'б': 1, b: 1, 'кб': 1024, kb: 1024, 'мб': 1048576, mb: 1048576 }[unit];
  const bytes = Math.round(Number(match[1].replace(',', '.')) * multiplier);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

/**
 * Разбирает строку запроса. Ничего не отвергает: непонятная приставка остаётся
 * обычным словом, битая дата просто игнорируется. Поиск, который отвечает «вы
 * неправильно написали» вместо результатов, люди обходят стороной.
 */
function parseQuery(input) {
  const result = {
    terms: [],      // обычные слова
    phrases: [],    // то, что взято в кавычки — ищется подряд
    from: [], to: [], cc: [], subject: [], file: [], folder: [],
    has: [], is: [],
    before: null, after: null, larger: null, smaller: null,
  };

  for (const token of tokenize(input)) {
    if (token.quoted) {
      if (token.value.trim()) result.phrases.push(token.value.trim());
      continue;
    }

    const colon = token.value.indexOf(':');
    if (colon > 0) {
      const key = token.value.slice(0, colon).toLowerCase();
      const raw = token.value.slice(colon + 1);
      const field = FIELD_ALIASES[key];

      if (field && raw) {
        const value = raw.replace(/^"|"$/g, '').trim();
        if (!value) continue;

        if (field === 'before' || field === 'after') {
          const date = parseDate(value);
          if (date) result[field] = date;
          // Непонятная дата молча отбрасывается: превращать её в слово для
          // поиска было бы хуже — «после:позавчера» не должно искать текст.
          continue;
        }
        if (field === 'larger' || field === 'smaller') {
          result[field] = parseSize(value);
          continue;
        }
        if (field === 'has') {
          const v = HAS_VALUES[value.toLowerCase()];
          if (v) result.has.push(v);
          continue;
        }
        if (field === 'is') {
          const v = IS_VALUES[value.toLowerCase()];
          if (v) result.is.push(v);
          continue;
        }
        result[field].push(value);
        continue;
      }
    }

    if (token.value.trim()) result.terms.push(token.value.trim());
  }

  return result;
}

/** Есть ли вообще что искать, или человек задал одни лишь фильтры. */
function hasAnything(parsed) {
  return Boolean(
    parsed.terms.length || parsed.phrases.length || parsed.from.length || parsed.to.length ||
    parsed.cc.length || parsed.subject.length || parsed.file.length || parsed.folder.length ||
    parsed.has.length || parsed.is.length || parsed.before || parsed.after ||
    parsed.larger !== null || parsed.smaller !== null
  );
}

// ── Построение tsquery ────────────────────────────────────────────────────

/**
 * Один искомый термин превращается в три условия, соединённых «или»:
 *
 *   1. русская лемма          — «договору» найдёт «договор»
 *   2. префикс сырого слова   — «иванов:*» найдёт «иванову», «иванова»
 *   3. префикс русской леммы  — «гулиева» → лемма «гулиев» → найдёт «Гулиев»
 *
 * Третье нужно для обратного случая: человек ищет фамилию в косвенном падеже, а
 * в письме она в именительном.
 */
function termMatchSql(index) {
  return `(
    plainto_tsquery('russian', $${index})
    || to_tsquery('simple', quote_literal(lower(trim($${index}))) || ':*')
    || CASE
         WHEN length(mail_lexeme($${index})) >= 4
         THEN to_tsquery('simple', quote_literal(mail_lexeme($${index})) || ':*')
         ELSE to_tsquery('simple', quote_literal(lower(trim($${index}))) || ':*')
       END
  )`;
}

/**
 * Та же строка, но только точная её часть — без русской леммы.
 *
 * Нужна для сортировки, и вот почему. Стеммер укорачивает фамилии до
 * неузнаваемости: «Гулиев» превращается в лемму «гул», и письмо про гул в
 * вентиляции честно совпадает с запросом. Выбросить лемму совсем нельзя — тогда
 * сломается морфология обычных слов («разобраться» не найдёт «разобрался»), а
 * терять результаты хуже, чем показать лишний.
 *
 * Поэтому лемму оставляем в отборе, но в сортировке точное попадание слова
 * весит вдвое больше. Письмо, где слово стоит как есть, всегда оказывается выше
 * письма, которое совпало только общим корнем.
 */
function termPreciseSql(index) {
  return `(
    to_tsquery('simple', quote_literal(lower(trim($${index}))) || ':*')
    || CASE
         WHEN length(mail_lexeme($${index})) >= 4
         THEN to_tsquery('simple', quote_literal(mail_lexeme($${index})) || ':*')
         ELSE to_tsquery('simple', quote_literal(lower(trim($${index}))) || ':*')
       END
  )`;
}

/**
 * Фраза в кавычках ищется как последовательность слов — phraseto_tsquery знает
 * про порядок. Морфология при этом остаётся: «акт сверки» найдёт и «акта
 * сверки», и это правильно — в кавычки берут, чтобы слова стояли рядом, а не
 * чтобы отключить русский язык.
 */
function phraseQuerySql(index) {
  return `phraseto_tsquery('russian', $${index})`;
}

/**
 * Собирает запрос к базе. Возвращает готовый SQL и параметры: склеивать их на
 * стороне вызова негде, и подставить сюда чужой текст нельзя.
 */
function buildSearchSql(parsed, { accountIds, userId, limit, offset, folderId, accountId }) {
  const bind = [];
  const p = (value) => { bind.push(value); return bind.length; };

  const where = [
    `m."accountId" = ANY($${p(accountIds)}::uuid[])`,
    // Спрятанное на удаление не ищется: для человека этих писем уже нет.
    'NOT m."pendingDelete"',
  ];

  if (accountId) where.push(`m."accountId" = $${p(accountId)}`);
  if (folderId) where.push(`m."folderId" = $${p(folderId)}`);

  // ── Текстовая часть ──
  //
  // Два запроса на одних и тех же параметрах: matchParts решает, что вообще
  // попадёт в выдачу, preciseParts — что окажется наверху. Индексы параметров
  // переиспользуются, повторять значения в списке не нужно.
  const matchParts = [];
  const preciseParts = [];

  for (const term of parsed.terms) {
    const idx = p(term);
    matchParts.push(termMatchSql(idx));
    preciseParts.push(termPreciseSql(idx));
  }
  for (const phrase of parsed.phrases) {
    const idx = p(phrase);
    matchParts.push(phraseQuerySql(idx));
    preciseParts.push(phraseQuerySql(idx));
  }

  // Подсветка считается дважды, и это не расточительство.
  //
  // ts_headline разбирает текст одной конфигурацией, и лексемы запроса должны
  // быть из неё же. Русская версия подсвечивает морфологию («договору» при
  // запросе «договор»), но спотыкается на фамилиях: «Иванов» даёт лемму «иван»,
  // а в тексте лежит «иванов» — совпадения нет, и человек видит выдачу без
  // единого выделенного слова. Несклоняемая версия с префиксом ловит как раз
  // этот случай, но бессильна там, где слово изменилось не по суффиксу.
  //
  // Берём ту, что действительно что-то нашла: наличие <em> — достаточный и
  // самый дешёвый признак.
  const headlineRu = [
    ...parsed.terms.map((t) => `plainto_tsquery('russian', $${p(t)})`),
    ...parsed.phrases.map((ph) => `phraseto_tsquery('russian', $${p(ph)})`),
  ];
  const headlineSimple = [
    ...parsed.terms.map((t) => `to_tsquery('simple', quote_literal(lower(trim($${p(t)}))) || ':*')`),
    ...parsed.phrases.map((ph) => `phraseto_tsquery('simple', $${p(ph)})`),
  ];

  const hasText = matchParts.length > 0;
  const tsQuery = hasText ? matchParts.join(' && ') : null;
  const preciseQuery = hasText ? preciseParts.join(' && ') : null;
  // Для подсветки части соединяются через «или»: выделить надо всё найденное, а
  // не только те письма, где сошлись все слова разом.
  const headlineRuQuery = headlineRu.length ? headlineRu.join(' || ') : `to_tsquery('russian', '')`;
  const headlineSimpleQuery = headlineSimple.length ? headlineSimple.join(' || ') : `to_tsquery('simple', '')`;
  const HEADLINE_OPTIONS = "'StartSel=<em>, StopSel=</em>, MaxWords=26, MinWords=10, ShortWord=2, MaxFragments=1, FragmentDelimiter= … '";

  if (hasText) where.push(`b."searchVector" @@ (${tsQuery})`);

  // ── Уточнения ──
  for (const value of parsed.subject) {
    where.push(`m.subject ILIKE '%' || $${p(value)} || '%'`);
  }

  for (const [field, role] of [['from', 'from'], ['to', 'to'], ['cc', 'cc']]) {
    for (const value of parsed[field]) {
      // Ищем и по адресу, и по отображаемому имени: какое из двух человек
      // помнит — заранее неизвестно.
      const idx = p(value);
      where.push(`EXISTS (
        SELECT 1 FROM mail_message_addresses ma
        JOIN mail_addresses ad ON ad.id = ma."addressId"
        WHERE ma."messageId" = m.id AND ma.role = '${role}'
          AND (ad.email ILIKE '%' || $${idx} || '%' OR ad.name ILIKE '%' || $${idx} || '%')
      )`);
    }
  }

  for (const value of parsed.file) {
    const idx = p(value);
    where.push(`EXISTS (
      SELECT 1 FROM mail_attachments at2
      WHERE at2."messageId" = m.id AND NOT at2."isInline"
        AND (at2.filename ILIKE '%' || $${idx} || '%' OR at2."textContent" ILIKE '%' || $${idx} || '%')
    )`);
  }

  for (const value of parsed.folder) {
    where.push(`f.name ILIKE '%' || $${p(value)} || '%'`);
  }

  if (parsed.has.includes('attachment')) where.push('m."hasAttachments"');
  if (parsed.is.includes('unread')) where.push('NOT m."isSeen"');
  if (parsed.is.includes('read')) where.push('m."isSeen"');
  if (parsed.is.includes('flagged')) where.push('m."isFlagged"');
  if (parsed.is.includes('answered')) where.push('m."isAnswered"');
  if (parsed.is.includes('unanswered')) where.push('NOT m."isAnswered"');
  if (parsed.is.includes('unflagged')) where.push('NOT m."isFlagged"');

  if (parsed.after) where.push(`m."receivedAt" >= $${p(parsed.after)}`);
  if (parsed.before) where.push(`m."receivedAt" < $${p(parsed.before)}`);
  if (parsed.larger !== null) where.push(`m.size >= $${p(parsed.larger)}`);
  if (parsed.smaller !== null) where.push(`m.size <= $${p(parsed.smaller)}`);

  // ── Сортировка ──
  //
  // Веса {D,C,B,A} = {0.1, 0.2, 0.4, 1.0}: слово в теме весит вдесятеро больше
  // того же слова в теле. Плюс поправка на свежесть — письмо этого месяца при
  // равном совпадении должно стоять выше письма трёхлетней давности, иначе
  // выдача начинается с архива.
  const rank = hasText
    ? `ts_rank('{0.1,0.2,0.4,1.0}'::float4[], b."searchVector", (${tsQuery}))
        / (1 + EXTRACT(EPOCH FROM (NOW() - m."receivedAt")) / (86400 * 365))`
    : '0';

  // Точное попадание — первый ключ сортировки, а не прибавка к весу. Прибавки
  // не хватает: слово-однокоренник может стоять в теме (вес 1.0), а настоящее
  // совпадение — в теле (вес 0.1), и десятикратная разница весов перебивает
  // любую разумную надбавку. Проверено на живом примере: запрос «Гулиев» ставил
  // письмо «Про сильный гул в вентиляции» выше письма, где фамилия есть на
  // самом деле.
  //
  // Под «точным» понимается совпадение по префиксу несклоняемого разбора, то
  // есть «договор» → «договору» сюда тоже входит. Вниз уходит только то, что
  // совпало исключительно общим корнем по русской лемме.
  const exact = hasText ? `(b."searchVector" @@ (${preciseQuery}))` : 'true';

  const order = hasText ? `"exact" DESC, "rank" DESC, m."receivedAt" DESC` : `m."receivedAt" DESC`;

  const userIdx = p(userId);
  const limitIdx = p(limit);
  const offsetIdx = p(offset);

  const sql = `
    SELECT m.id, m."accountId", m."folderId", m.uid, m.subject, m."fromName", m."fromEmail",
           m."sentAt", m."receivedAt", m.size, m."isSeen", m."isFlagged", m."isAnswered",
           m."hasAttachments", m."attachmentsCount", m.preview, m."bodyState", m."threadKey",
           a.email AS "accountEmail", f.name AS "folderName", f."specialUse",
           s."isRead" AS "readByMe", s."takenAt" AS "takenByMe",
           ${rank} AS "rank",
           ${exact} AS "exact",
           CASE
             WHEN ts_headline('simple', COALESCE(b."textStripped", ''), (${headlineSimpleQuery}), ${HEADLINE_OPTIONS}) LIKE '%<em>%'
             THEN ts_headline('simple', COALESCE(b."textStripped", ''), (${headlineSimpleQuery}), ${HEADLINE_OPTIONS})
             ELSE ts_headline('russian', COALESCE(b."textStripped", ''), (${headlineRuQuery}), ${HEADLINE_OPTIONS})
           END AS "highlight"
    FROM mail_messages m
    JOIN mail_accounts a ON a.id = m."accountId"
    JOIN mail_folders f ON f.id = m."folderId"
    LEFT JOIN mail_message_bodies b ON b."messageId" = m.id
    LEFT JOIN mail_user_message_state s ON s."messageId" = m.id AND s."userId" = $${userIdx}
    WHERE ${where.join(' AND ')}
    ORDER BY ${order}
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  return { sql, bind, hasText };
}

/**
 * Вспомогательная функция базы: первая лемма русского разбора слова. Нужна,
 * чтобы строить префикс от леммы прямо в запросе, не гоняя слово туда-обратно.
 * Заводится при первом обращении — отдельной миграции ради одной строки не надо.
 */
const LEXEME_FUNCTION = `
  CREATE OR REPLACE FUNCTION mail_lexeme(word text) RETURNS text AS $$
    SELECT COALESCE(
      (SELECT lexeme FROM unnest(to_tsvector('russian', word)) AS t(lexeme, positions, weights) LIMIT 1),
      lower(trim(word))
    );
  $$ LANGUAGE sql IMMUTABLE;
`;

let lexemeReady = false;

async function ensureLexemeFunction() {
  if (lexemeReady) return;
  await sequelize.query(LEXEME_FUNCTION);
  lexemeReady = true;
}

async function searchMessages(options) {
  await ensureLexemeFunction();

  const parsed = parseQuery(options.query);
  if (!hasAnything(parsed)) return { messages: [], parsed, empty: true };

  const { sql, bind } = buildSearchSql(parsed, options);
  const [rows] = await sequelize.query(sql, { bind });

  return { messages: rows, parsed, empty: false };
}

module.exports = {
  parseQuery,
  parseDate,
  parseSize,
  tokenize,
  hasAnything,
  buildSearchSql,
  searchMessages,
  ensureLexemeFunction,
  FIELD_ALIASES,
  HAS_VALUES,
  IS_VALUES,
};
