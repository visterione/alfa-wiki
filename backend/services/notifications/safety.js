'use strict';

/**
 * Предохранители рассылки (ver. 8.06).
 *
 * Два ограничителя, и вместе они составляют то, что называют безопасным
 * режимом: кому вообще разрешено отправлять наружу и на какие номера.
 *
 * ПОЧЕМУ ПЕРЕЕХАЛИ ИЗ .env. Прежде оба жили переменными окружения, и это
 * казалось правильным: предохранитель должен быть трудно снимаемым. На деле
 * вышло наоборот. Переменная называлась NOTIFIER_ALLOW_FROMNI, проверялась
 * внутри ветки Fromni и не покрывала появившийся в 7.95 Имобис — дыра прожила
 * два релиза именно потому, что предохранитель жил там, куда никто не смотрит.
 * Настройка, состояние которой нельзя увидеть, не защищает, а создаёт ложное
 * чувство защиты.
 *
 * Теперь состояние видно на экране, снимается осознанно и записывает, кто и
 * когда его снял. Это важнее трудности снятия: модуль передают человеку,
 * который в консоль не ходит, и предохранитель, снимаемый только программистом,
 * — не предохранитель, а очередь к программисту.
 *
 * ЖЁСТКИЙ ЗАМОК. На время пилота снятие можно запретить совсем:
 *
 *     NOTIFIER_LOCK_EXTERNAL=true
 *
 * Тогда переключатель на экране виден, но не работает, и включить отправку
 * наружу можно только через сервер. Замок односторонний намеренно: он умеет
 * только запрещать. Переменная, которая умела бы разрешать, вернула бы ровно ту
 * беду, от которой уходим, — состояние в двух местах и расхождение между ними.
 *
 * ПО МЕДЦЕНТРАМ (ver. 9.21). До 9.21 переключатель был один на сеть, и запуск
 * выглядел как «всё или ничего»: проверить отправку на одном медцентре, оставив
 * остальные закрытыми, было нельзя. Теперь список открытых провайдеров свой у
 * каждого филиала, а общего нет вовсе. Пробовали оставить общий рубильником
 * «вся сеть» поверх филиальных — заказчик отклонил: два органа управления одним
 * и тем же путают, какой из них сейчас решает.
 *
 * Перенос без миграции. Пока в настройке нет поля branches, действует прежний
 * общий список — для каждого филиала, как и раньше. При первом сохранении он
 * раскладывается по всем филиалам, и дальше они расходятся. Так релиз не
 * меняет поведения на бою ни в одну сторону, а перенос не требует отдельного
 * шага, который можно забыть.
 *
 * Филиал, заведённый после раскладки, начинает закрытым: открыть его наружу —
 * решение, а не наследство. Сообщение без опознанного филиала тоже не уходит
 * наружу — пускать его по чужому разрешению нельзя.
 *
 * ПИЛОТНЫЕ НОМЕРА ПО МЕДЦЕНТРАМ (ver. 9.23). В 9.21 их оставили общими — как
 * список проверочных телефонов, к филиалу не привязанный. На деле запуск идёт
 * так: у одного медцентра сняты все предохранители, но отправка только на один
 * номер, а у другого — свой номер или вся сеть. С общим списком выбор
 * медцентра на экране менял провайдеров, но не номера, и поле телефона у всех
 * медцентров показывало одно и то же.
 *
 * Перенос тот же, что у провайдеров, — без миграции и без ослабления: медцентр
 * без своего списка живёт по прежнему общему (pilotPhones). Свой список
 * появляется только при сохранении у этого медцентра, и пустой свой список —
 * это осознанное «вся сеть», а не отсутствие настройки. Поэтому пустые списки
 * здесь, в отличие от провайдеров, хранятся.
 */

const { Setting, MedCenter } = require('../../models');
const misClient = require('../misClient');

const SAFETY_KEY = 'notif_safety';

// Провайдеры, которых предохранитель касается. Наши боты сюда не входят: они
// пишут только тем, кто сам нажал «поделиться контактом», и веерной рассылки по
// сети из них не выйдет.
// CRM с ИИ-звонками входит сюда с 8.52 и по более сильной причине, чем
// остальные: наружу уходит не текст, который мы сами составили, а карточка
// пациента — имя, телефон, врач и время приёма. Провайдер, которому такое
// отдают, обязан выключаться тем же переключателем, что и все прочие, иначе
// повторится беда 7.95, когда Имобис два релиза ходил мимо предохранителя.
const EXTERNAL_PROVIDERS = ['imobis', 'fromni', 'aicall'];

/** Замок запрещает снятие, но не может ничего разрешить. */
const isLocked = () => process.env.NOTIFIER_LOCK_EXTERNAL === 'true';

/**
 * Значение по умолчанию собирается из .env — того, что уже настроено на бою.
 * Так первый запуск после релиза сохраняет прежнее поведение, а не сбрасывает
 * его в «всё выключено» и не в «всё включено».
 */
function fromEnv() {
  const raw = String(process.env.NOTIFIER_ALLOW_EXTERNAL || '').trim().toLowerCase();
  const list = raw === 'all'
    ? [...EXTERNAL_PROVIDERS]
    : raw.split(',').map(s => s.trim()).filter(v => EXTERNAL_PROVIDERS.includes(v));

  // Прежнее имя продолжает работать: на бою оно вписано, и релиз не должен
  // молча выключить то, что включали осознанно.
  if (process.env.NOTIFIER_ALLOW_FROMNI === 'true' && !list.includes('fromni')) list.push('fromni');

  return {
    allowExternal: list,
    pilotPhones: (process.env.NOTIFIER_PILOT_PHONES || '')
      .split(',').map(s => misClient.normalizePhone(s.trim())).filter(Boolean),
    changedBy: null,
    changedAt: null
  };
}

// Состояние спрашивают на каждое сообщение очереди — держим в памяти. Срок
// короче, чем у остальных настроек: между «выключил» и «перестало уходить»
// десять секунд ожидания терпимы, минута — нет.
const TTL = 10000;
let cache = { at: 0, value: null };

const onlyKnown = (list) => (Array.isArray(list) ? list : []).filter(p => EXTERNAL_PROVIDERS.includes(p));

const normalizePhones = (list) => (Array.isArray(list) ? list : [])
  .map(p => misClient.normalizePhone(String(p).trim())).filter(Boolean);

/**
 * Пилотные номера по медцентрам. Пустой список сохраняется: у медцентра это
 * «вся сеть», выбранное осознанно, а отсутствие записи — «как в общем списке».
 */
function cleanPilots(map) {
  const out = {};
  for (const [id, list] of Object.entries(map || {})) {
    if (id && Array.isArray(list)) out[id] = [...new Set(normalizePhones(list))];
  }
  return out;
}

/** Пустые списки не храним: филиал без записи и филиал с [] — одно и то же. */
function cleanBranches(map) {
  const out = {};
  for (const [id, list] of Object.entries(map || {})) {
    const known = [...new Set(onlyKnown(list))];
    if (id && known.length) out[id] = known;
  }
  return out;
}

async function read() {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value;

  const row = await Setting.findByPk(SAFETY_KEY);
  const stored = row && row.value ? row.value : null;
  const value = stored ? { ...fromEnv(), ...stored } : fromEnv();
  const split = !!value.branches && typeof value.branches === 'object';

  // Замок действует поверх сохранённого: если он стоит, наружу не уходит ничто,
  // что бы ни было записано в настройке.
  const effective = {
    // null — настройка ещё не разложена по филиалам, и для каждого действует
    // прежний общий список (см. шапку).
    branches: split ? (isLocked() ? {} : cleanBranches(value.branches)) : null,
    legacy: isLocked() ? [] : onlyKnown(value.allowExternal),
    // Общий список: действует у медцентров, не сохранивших свой (см. шапку).
    pilotPhones: normalizePhones(value.pilotPhones),
    pilotByBranch: cleanPilots(value.pilotByBranch),
    changedBy: value.changedBy || null,
    changedAt: value.changedAt || null,
    locked: isLocked()
  };

  cache = { at: Date.now(), value: effective };
  return effective;
}

/** Открытые провайдеры филиала по уже прочитанному состоянию. */
function allowedFor(state, medCenterId) {
  if (!medCenterId) return [];
  if (!state.branches) return state.legacy;
  return state.branches[String(medCenterId)] || [];
}

/**
 * Пилотные номера медцентра по уже прочитанному состоянию: свои, если
 * сохранены, иначе общий список. Сообщение без опознанного медцентра проверяем
 * по общему — наружу оно всё равно не уйдёт (allowedFor), а для наших ботов
 * общий список остаётся прежним ограничением.
 */
function pilotFor(state, medCenterId) {
  const own = medCenterId ? state.pilotByBranch[String(medCenterId)] : undefined;
  return {
    phones: own !== undefined ? own : state.pilotPhones,
    own: own !== undefined
  };
}

/**
 * @param {Object} patch
 * @param {{medCenterId:string, allowExternal:string[]}} [patch.branch] Правим по
 *   одному филиалу, а не всей картой: два администратора, включающие разные
 *   филиалы, не должны затирать друг друга.
 * @param {string[]} [patch.pilotPhones] общий список — для медцентров без своего
 * @param {{medCenterId:string, phones:string[]}} [patch.pilot] пилотные номера
 *   одного медцентра (ver. 9.23); тоже по одному, по той же причине
 */
async function write(patch, user) {
  if (isLocked() && patch.branch && (patch.branch.allowExternal || []).length) {
    const err = new Error('Снятие предохранителя запрещено на сервере (NOTIFIER_LOCK_EXTERNAL)');
    err.code = 'locked';
    throw err;
  }

  // Перед записью читаем мимо кэша: десяти секунд достаточно, чтобы правка
  // соседнего филиала, сделанная из другой вкладки, потерялась.
  cache = { at: 0, value: null };
  const current = await read();

  // Первая запись после 9.21 раскладывает прежний общий список по филиалам.
  // Берём все филиалы, куда ходит пациент, — тот же круг, что видит экран.
  let branches = current.branches;
  if (!branches) {
    branches = {};
    if (current.legacy.length) {
      const all = await MedCenter.findAll({ attributes: ['id'], where: { servesPatients: true } });
      for (const mc of all) branches[String(mc.id)] = [...current.legacy];
    }
  } else {
    branches = { ...branches };
  }

  if (patch.branch && patch.branch.medCenterId) {
    branches[String(patch.branch.medCenterId)] = patch.branch.allowExternal || [];
  }

  const pilotByBranch = { ...current.pilotByBranch };
  if (patch.pilot && patch.pilot.medCenterId) {
    pilotByBranch[String(patch.pilot.medCenterId)] = normalizePhones(patch.pilot.phones);
  }

  const value = {
    branches: cleanBranches(branches),
    pilotPhones: patch.pilotPhones !== undefined
      ? normalizePhones(patch.pilotPhones)
      : current.pilotPhones,
    pilotByBranch: cleanPilots(pilotByBranch),
    // Кто и когда снял предохранитель. Записывается всегда, а не только при
    // снятии: вопрос «кто это включил» задают через неделю, и ответ должен быть
    // в самой настройке, а не в чьей-то памяти.
    changedBy: user ? (user.displayName || user.username || user.id) : current.changedBy,
    changedAt: new Date().toISOString()
  };

  await Setting.upsert({
    key: SAFETY_KEY,
    value,
    description: 'Предохранители рассылки: кому разрешено отправлять наружу и на какие номера, по филиалам'
  });

  cache = { at: 0, value: null };
  return read();
}

/** Открыт ли провайдер для отправки по визиту этого филиала. */
async function allowsProvider(provider, medCenterId) {
  return allowedFor(await read(), medCenterId).includes(provider);
}

/**
 * Пустой список пилотных номеров означает «без ограничения», а не «никому».
 * Список — медцентра, по визиту которого сообщение (ver. 9.23).
 */
async function allowedByPilot(phone, medCenterId = null) {
  const { phones } = pilotFor(await read(), medCenterId);
  if (!phones.length) return true;
  return phones.includes(misClient.normalizePhone(phone || ''));
}

function forget() {
  cache = { at: 0, value: null };
}

module.exports = {
  SAFETY_KEY, EXTERNAL_PROVIDERS,
  read, write, forget, allowsProvider, allowedFor, allowedByPilot, pilotFor, isLocked
};
