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
 */

const { Setting } = require('../../models');
const misClient = require('../misClient');

const SAFETY_KEY = 'notif_safety';

// Провайдеры, которых предохранитель касается. Наши боты сюда не входят: они
// пишут только тем, кто сам нажал «поделиться контактом», и веерной рассылки по
// сети из них не выйдет.
const EXTERNAL_PROVIDERS = ['imobis', 'fromni'];

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

async function read() {
  if (cache.value && Date.now() - cache.at < TTL) return cache.value;

  const row = await Setting.findByPk(SAFETY_KEY);
  const stored = row && row.value ? row.value : null;
  const value = stored ? { ...fromEnv(), ...stored } : fromEnv();

  // Замок действует поверх сохранённого: если он стоит, наружу не уходит ничто,
  // что бы ни было записано в настройке.
  const effective = {
    ...value,
    allowExternal: isLocked() ? [] : (value.allowExternal || []).filter(p => EXTERNAL_PROVIDERS.includes(p)),
    pilotPhones: (value.pilotPhones || []).map(p => misClient.normalizePhone(p)).filter(Boolean),
    locked: isLocked()
  };

  cache = { at: Date.now(), value: effective };
  return effective;
}

async function write(patch, user) {
  if (isLocked() && (patch.allowExternal || []).length) {
    const err = new Error('Снятие предохранителя запрещено на сервере (NOTIFIER_LOCK_EXTERNAL)');
    err.code = 'locked';
    throw err;
  }

  const current = await read();
  const value = {
    allowExternal: patch.allowExternal !== undefined
      ? (patch.allowExternal || []).filter(p => EXTERNAL_PROVIDERS.includes(p))
      : current.allowExternal,
    pilotPhones: patch.pilotPhones !== undefined
      ? (patch.pilotPhones || []).map(p => misClient.normalizePhone(String(p).trim())).filter(Boolean)
      : current.pilotPhones,
    // Кто и когда снял предохранитель. Записывается всегда, а не только при
    // снятии: вопрос «кто это включил» задают через неделю, и ответ должен быть
    // в самой настройке, а не в чьей-то памяти.
    changedBy: user ? (user.displayName || user.username || user.id) : current.changedBy,
    changedAt: new Date().toISOString()
  };

  await Setting.upsert({
    key: SAFETY_KEY,
    value,
    description: 'Предохранители рассылки: кому разрешено отправлять наружу и на какие номера'
  });

  cache = { at: 0, value: null };
  return read();
}

const allowsProvider = async (provider) => (await read()).allowExternal.includes(provider);

/** Пустой список пилотных номеров означает «без ограничения», а не «никому». */
async function allowedByPilot(phone) {
  const { pilotPhones } = await read();
  if (!pilotPhones.length) return true;
  return pilotPhones.includes(misClient.normalizePhone(phone || ''));
}

function forget() {
  cache = { at: 0, value: null };
}

module.exports = {
  SAFETY_KEY, EXTERNAL_PROVIDERS,
  read, write, forget, allowsProvider, allowedByPilot, isLocked
};
