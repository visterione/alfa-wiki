'use strict';

/**
 * Шифрование паролей почтовых ящиков (ver. 8.58).
 *
 * IMAP и SMTP требуют пароль в открытом виде при каждом подключении, поэтому
 * хэш здесь бесполезен — нужно обратимое шифрование. AES-256-GCM: кроме
 * собственно шифра он даёт метку подлинности (tag), и подменённая или побитая
 * строка не расшифруется молча в мусор, а честно бросит ошибку.
 *
 * Ключ живёт в MAIL_SECRET_KEY и только там: в репозитории его нет и быть не
 * должно. Сгенерировать новый:
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Смена ключа. У каждой записи хранится keyVersion, а старые ключи остаются в
 * окружении под именами MAIL_SECRET_KEY_V1, MAIL_SECRET_KEY_V2 и так далее.
 * Благодаря этому ключ меняется на ходу: поднимаем MAIL_KEY_VERSION, новые и
 * перезаписанные ящики шифруются свежим ключом, старые продолжают читаться
 * прежним. Без версии пришлось бы останавливать почту всей сети ради разовой
 * операции — а значит, её бы просто никогда не сделали.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // Рекомендованная для GCM длина: 96 бит.
const KEY_LENGTH = 32;  // 256 бит.

/**
 * Ключ принимается только в виде 64 шестнадцатеричных символов. Соблазн
 * разрешить произвольную парольную фразу и растянуть её через scrypt был, но
 * тогда стойкость ключа определялась бы тем, что человек придумал в спешке, и
 * догадаться об этом по коду было бы нельзя. Пусть лучше сразу откажет.
 */
function loadKey(version) {
  const name = version ? `MAIL_SECRET_KEY_V${version}` : 'MAIL_SECRET_KEY';
  let raw = process.env[name];

  // Текущая версия может лежать и под общим именем, и под версионным: при
  // первой смене ключа удобно дописать MAIL_SECRET_KEY_V1, не трогая рабочую
  // переменную.
  if (!raw && version && version === currentVersion()) raw = process.env.MAIL_SECRET_KEY;
  if (!raw && !version) raw = process.env[`MAIL_SECRET_KEY_V${currentVersion()}`];

  if (!raw) {
    throw new Error(
      `Ключ шифрования ${name} не задан. Без него почтовый модуль не работает: ` +
      'пароли ящиков негде взять. Сгенерировать: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  const trimmed = String(raw).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      `Ключ ${name} должен быть ровно 64 шестнадцатеричными символами (32 байта). ` +
      'Парольные фразы не принимаются намеренно — стойкость ключа не должна зависеть от того, что придумали в спешке.'
    );
  }

  return Buffer.from(trimmed, 'hex');
}

function currentVersion() {
  const v = parseInt(process.env.MAIL_KEY_VERSION || '1', 10);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * Шифрует пароль. Возвращает ровно те четыре поля, что лежат в mail_accounts.
 */
function encryptPassword(plain) {
  if (typeof plain !== 'string' || plain === '') {
    throw new Error('Пустой пароль ящика шифровать нечего');
  }

  const keyVersion = currentVersion();
  const key = loadKey(keyVersion);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

  return {
    passwordEnc: enc.toString('base64'),
    passwordIv: iv.toString('base64'),
    passwordTag: cipher.getAuthTag().toString('base64'),
    keyVersion,
  };
}

/**
 * Расшифровывает. Принимает запись ящика целиком — так на стороне вызова
 * негде перепутать поля местами.
 */
function decryptPassword(account) {
  const { passwordEnc, passwordIv, passwordTag } = account || {};
  if (!passwordEnc || !passwordIv || !passwordTag) {
    throw new Error(
      'У ящика нет сохранённого пароля. Частая причина — запись прочитана без ' +
      "scope('withSecret'): по умолчанию модель пароль не отдаёт."
    );
  }

  const key = loadKey(account.keyVersion || currentVersion());
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(passwordIv, 'base64'));
  decipher.setAuthTag(Buffer.from(passwordTag, 'base64'));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(passwordEnc, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (err) {
    // final() у GCM падает именно здесь, когда метка не сошлась. Сообщение
    // самого Node («Unsupported state or unable to authenticate data»)
    // не говорит ничего о причине, а причина почти всегда одна.
    throw new Error(
      `Пароль ящика не расшифровывается (версия ключа ${account.keyVersion || currentVersion()}). ` +
      'Скорее всего сменился MAIL_SECRET_KEY, а старый ключ не остался в окружении под именем ' +
      `MAIL_SECRET_KEY_V${account.keyVersion || currentVersion()}.`
    );
  }
}

/**
 * Проверка при старте: лучше отказаться подниматься, чем обнаружить нехватку
 * ключа на первом же подключении к ящику посреди рабочего дня.
 */
function assertKeyUsable() {
  const probe = encryptPassword('проверка ключа');
  const back = decryptPassword(probe);
  if (back !== 'проверка ключа') throw new Error('Ключ шифрования почты не проходит проверку');
  return true;
}

module.exports = { encryptPassword, decryptPassword, assertKeyUsable, currentVersion };
