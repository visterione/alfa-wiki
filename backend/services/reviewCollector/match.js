'use strict';

/**
 * Сопоставление отзывов GetLoyalty и Альфа Парсера (ver. 8.80).
 *
 * На время перехода один и тот же отзыв приходит двумя путями, и общего
 * ключа у них почти никогда нет: GetLoyalty отдаёт свой номер (gl_…), парсер
 * — номер площадки. Родной номер у GetLoyalty виден только у ПроДокторов, в
 * ссылке на кабинет (…/lpu-rates/rate/7563417/), — для этого случая парсер
 * присылает подсказку urlFragment, и совпадение точное.
 *
 * В остальных случаях сравнивается содержимое: та же доска, та же площадка,
 * даты рядом, текст совпадает. Даты расходятся из-за часовых поясов и из-за
 * того, что GetLoyalty видит отзыв позже публикации, поэтому окно ±3 дня.
 * Текст GetLoyalty чистил (вырезал «врач такой-то» из начала), а ПроДокторов
 * у парсера склеивает «понравилось / не понравилось / комментарий», поэтому
 * сравнивается не строка целиком, а доля общих слов относительно более
 * короткого текста: лишние слова с одной стороны не мешают найти пару.
 *
 * Функции чистые, без базы, — их проверяют тесты
 * (tests/reviewCollectorMatch.test.js).
 */

const DATE_WINDOW_DAYS = 3;
// Доля слов короткого текста, которые должны найтись в длинном. Ниже 0.7
// начинают сходиться разные короткие благодарности («спасибо врачу, всё
// отлично»), выше — теряются пары, где GetLoyalty обрезал начало.
const MIN_CONTAINMENT = 0.7;
// Короче этого по словам текст сравнивается только целиком: у «Спасибо!»
// с «Спасибо большое!» доля общих слов высокая, а отзывы разные.
const MIN_TOKENS_FOR_FUZZY = 4;

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

function tokens(text) {
  return normalizeText(text).split(' ').filter(w => w.length >= 3);
}

/**
 * Насколько тексты — один отзыв. 0…1, где 1 — короткий целиком внутри
 * длинного. Пустой с пустым сравнивать нечем — 0: такие пары решаются
 * отдельно, по дате и врачу.
 */
function textSimilarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;

  const short = ta.length <= tb.length ? ta : tb;
  const long = ta.length <= tb.length ? tb : ta;

  if (short.length < MIN_TOKENS_FOR_FUZZY) {
    return normalizeText(a) === normalizeText(b) ? 1 : 0;
  }

  const pool = new Map();
  for (const w of long) pool.set(w, (pool.get(w) || 0) + 1);

  let common = 0;
  for (const w of short) {
    const n = pool.get(w);
    if (n) { common++; pool.set(w, n - 1); }
  }
  return common / short.length;
}

function dayDiff(a, b) {
  const da = new Date(`${String(a).slice(0, 10)}T00:00:00Z`);
  const db = new Date(`${String(b).slice(0, 10)}T00:00:00Z`);
  return Math.abs(da - db) / 86400000;
}

function sameDoctor(a, b) {
  if (!a || !b) return true;
  // Хватает фамилии: одна сторона пишет «Иванов И. И.», другая — полностью.
  const fa = normalizeText(a).split(' ')[0];
  const fb = normalizeText(b).split(' ')[0];
  return fa === fb;
}

function isEmptyText(text) {
  const t = normalizeText(text);
  return !t || t === 'текст отсутствует';
}

/**
 * Выбирает среди кандидатов пару для отзыва или возвращает null.
 *
 * @param {object} incoming  { date, text, rating, doctor, urlFragment? }
 * @param {Array}  candidates  строки reviews (или объекты с теми же полями):
 *   { reviewDate, reviewText, rating, doctorName, externalUrl }
 */
function pickCounterpart(incoming, candidates) {
  if (!candidates?.length) return null;

  if (incoming.urlFragment) {
    const exact = candidates.find(c => c.externalUrl && c.externalUrl.includes(incoming.urlFragment));
    if (exact) return exact;
  }

  const inDate = String(incoming.date).slice(0, 10);
  const near = candidates.filter(c => dayDiff(c.reviewDate, inDate) <= DATE_WINDOW_DAYS);

  // Отзыв без текста (на ПроДокторов бывает одна оценка) сравнить не с чем.
  // Берём пару, только если она единственная в тот же день у того же врача:
  // лучше оставить отзыв несовпавшим в отчёте, чем склеить два разных.
  if (isEmptyText(incoming.text)) {
    const same = near.filter(c =>
      isEmptyText(c.reviewText)
      && dayDiff(c.reviewDate, inDate) === 0
      && sameDoctor(c.doctorName, incoming.doctor));
    return same.length === 1 ? same[0] : null;
  }

  let best = null;
  let bestScore = 0;
  for (const c of near) {
    if (incoming.rating && c.rating && Math.abs(incoming.rating - c.rating) > 1) continue;
    if (!sameDoctor(c.doctorName, incoming.doctor)) continue;

    const score = textSimilarity(incoming.text, c.reviewText);
    if (score < MIN_CONTAINMENT) continue;

    // При равенстве побеждает ближайшая дата.
    if (score > bestScore
      || (score === bestScore && best && dayDiff(c.reviewDate, inDate) < dayDiff(best.reviewDate, inDate))) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

module.exports = {
  normalizeText,
  textSimilarity,
  pickCounterpart,
  DATE_WINDOW_DAYS,
};
