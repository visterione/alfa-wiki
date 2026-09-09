'use strict';

/**
 * Согласие пациента на сообщения (ver. 8.08).
 *
 * В карточке МИС есть поле send_sms. По умолчанию оно true, но пациент при
 * оформлении может подписать отказ, и тогда в карточке стоит false. Пока
 * рассылку вёл движок Renovatio, отказ учитывал он сам. Мы этот движок
 * выключаем и забираем отправку себе — вместе с ней забирается и обязанность
 * никому лишнему не написать. Поле называется «sms», но означает согласие на
 * оповещения вообще, поэтому отказ закрывает все каналы: и бота, и SMS, и
 * рекламную рассылку. Разделять их было бы толкованием подписи, которую человек
 * ставил не за этим.
 *
 * ЧТО СЧИТАЕТСЯ ОТКАЗОМ. Только явное false. МИС отдаёт ещё и null — у карточек,
 * которых это поле ни разу не касалось; в выборке за март 2024 таких 14 из 3638.
 * Считать null отказом значило бы замолчать для людей, ничего не отказывавших.
 * Отсутствие карточки — тоже не отказ: подписи нет, потому что нет и карточки.
 *
 * ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ. Поля send_newsletter, которое МИС отдаёт рядом и по
 * названию просится под рекламные рассылки. В боевой базе оно null у всех
 * карточек без исключения — то есть его не заполняют, и опереться на него
 * нельзя: получилось бы либо правило, не действующее никогда, либо, при чтении
 * null как отказа, отменённая рассылка на всю сеть.
 *
 * ЧЕГО НЕ КАСАЕТСЯ ВООБЩЕ. Ответов оператора в открытой линии. Там человек
 * написал сам и ждёт ответа; молчать в ответ на прямой вопрос — не соблюдение
 * отказа, а его извращение.
 */

const misClient = require('../misClient');

// Срок годности ответа. Отказ подписывают на стойке регистратуры, а напоминание
// уходит часами позже — десяти минут достаточно, чтобы не спрашивать МИС на
// каждую строку очереди и при этом узнать о свежем отказе почти сразу.
const TTL = 10 * 60 * 1000;

// Сколько карточек помним. Рассылка на сеть — это тысячи адресатов за один
// заход, и расти без предела кэшу нельзя.
const MAX_ENTRIES = 5000;

// Сколько id спрашивать одним запросом. Сотня возвращается за полсекунды.
const CHUNK = 100;

// Пауза после отказа МИС. Без неё очередь в момент недоступности МИС
// превращается в сотни запросов по пятнадцать секунд каждый: строки
// откладываются, приходят снова и снова стучатся в мёртвый адрес.
const OUTAGE_MS = 30 * 1000;

const cache = new Map();
let outageUntil = 0;

function remember(patientId, allowed) {
  const key = String(patientId);
  // Map хранит ключи в порядке вставки — переставляем, чтобы вытеснялся
  // действительно давний, а не тот, кого просто давно не перезаписывали.
  cache.delete(key);
  cache.set(key, { allowed, at: Date.now() });

  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function known(patientId) {
  const hit = cache.get(String(patientId));
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL) {
    cache.delete(String(patientId));
    return undefined;
  }
  return hit.allowed;
}

/** Забыть всё — для тестов и для кнопки «проверить заново». */
function forget() {
  cache.clear();
  outageUntil = 0;
}

/**
 * Решение по набору карточек, уже полученных из МИС.
 *
 * Вынесено отдельно и без обращений наружу: это и есть то правило, ради
 * которого написан модуль, и проверять его надо без сети и без базы.
 *
 * Хватает одного отказа. По одному телефону нередко заведена семья, и понять,
 * кому из них уйдёт сообщение, мы не можем — значит выбираем в пользу того, кто
 * отказ подписал. Ошибиться здесь в другую сторону дороже: несделанное
 * напоминание — неудобство, а сообщение вопреки подписи — нарушение.
 */
function decide(cards) {
  const rows = Array.isArray(cards) ? cards.filter(Boolean) : [];
  const refused = rows.find(card => card.send_sms === false);

  if (refused) {
    return { allowed: false, reason: `в карточке ${refused.patient_id} стоит отказ от оповещений` };
  }
  return { allowed: true, reason: null };
}

/**
 * Спрашивает у МИС карточки, которых нет в кэше, и раскладывает ответ по нему.
 * Возвращает false, если МИС не ответила: это не «согласия нет», а «мы не
 * знаем», и обходиться с этим вызывающий должен иначе.
 */
async function load(ids) {
  if (!ids.length) return true;
  if (Date.now() < outageUntil) return false;

  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      const cards = await misClient.getPatientsByIds(part);
      const seen = new Set();

      for (const card of cards) {
        if (!card || card.patient_id == null) continue;
        seen.add(String(card.patient_id));
        remember(card.patient_id, card.send_sms !== false);
      }

      // Карточки, которой МИС не вернула, не существует или она в корзине.
      // Отказа на ней быть не может, и держать такой id вечно неизвестным
      // значило бы навсегда запереть очередь для этого человека.
      part.filter(id => !seen.has(id)).forEach(id => remember(id, true));
    }
    return true;
  } catch (err) {
    outageUntil = Date.now() + OUTAGE_MS;
    console.error('[consent] МИС не ответила на проверку согласия:', err.message);
    return false;
  }
}

/**
 * Разрешено ли писать этому человеку.
 *
 * @param {Object} target
 * @param {number|string|Array} [target.patientId]  карточка (или несколько)
 * @param {string} [target.phone]  запасной путь, когда карточка неизвестна
 * @returns {Promise<{allowed:boolean, unknown:boolean, reason:string|null}>}
 *
 * unknown — отдельный исход, а не разновидность запрета. Он означает ровно
 * «МИС не ответила», и решать, отложить сообщение или отправить, должен тот,
 * кто знает, что это за сообщение.
 */
async function check({ patientId = null, phone = null } = {}) {
  const ids = (Array.isArray(patientId) ? patientId : [patientId])
    .filter(v => v != null && v !== '')
    .map(String);

  if (ids.length) {
    // Известный отказ отвечает сразу: идти в МИС за остальными карточками
    // семьи незачем, ответ от них не изменится.
    if (ids.some(id => known(id) === false)) {
      return { allowed: false, unknown: false, reason: 'в карточке пациента стоит отказ от оповещений' };
    }

    const missing = ids.filter(id => known(id) === undefined);
    if (missing.length && !await load(missing)) {
      return { allowed: false, unknown: true, reason: 'МИС не ответила — согласие не проверено' };
    }

    const refused = ids.find(id => known(id) === false);
    return refused
      ? { allowed: false, unknown: false, reason: `в карточке ${refused} стоит отказ от оповещений` }
      : { allowed: true, unknown: false, reason: null };
  }

  // Карточка неизвестна — ищем по телефону. Так живут строки очереди, пришедшие
  // не из визита, и подписчики, которых в МИС не нашлось.
  if (!phone) return { allowed: true, unknown: false, reason: null };
  if (Date.now() < outageUntil) {
    return { allowed: false, unknown: true, reason: 'МИС не ответила — согласие не проверено' };
  }

  try {
    const cards = await misClient.getPatientsByPhone(phone);
    (cards || []).forEach(card => {
      if (card && card.patient_id != null) remember(card.patient_id, card.send_sms !== false);
    });
    const verdict = decide(cards);
    return { ...verdict, unknown: false };
  } catch (err) {
    outageUntil = Date.now() + OUTAGE_MS;
    console.error('[consent] МИС не ответила на поиск по телефону:', err.message);
    return { allowed: false, unknown: true, reason: 'МИС не ответила — согласие не проверено' };
  }
}

/**
 * Заранее выясняет согласие для целой пачки адресатов — одним запросом на
 * сотню. Нужен рассылке: она идёт по адресатам в темпе двадцати в секунду, и
 * поштучный поход в МИС на каждом из них растянул бы её на часы.
 *
 * Возвращает false, если МИС не ответила, — тогда рассылке лучше подождать, а
 * не решать за каждого адресата в одиночку.
 */
async function prefetch(patientIds) {
  const ids = [...new Set((patientIds || []).flat().filter(Boolean).map(String))];
  return load(ids.filter(id => known(id) === undefined));
}

module.exports = { check, prefetch, decide, remember, known, forget, TTL, MAX_ENTRIES };
