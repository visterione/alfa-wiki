'use strict';

/**
 * Сессия веб-МИС, общая на всю вики (ver. 9.12).
 *
 * Робот ходит в МИС под личной учёткой сотрудника, и код входа приходит на его
 * личную почту. Прочитать письмо сами мы не можем, поэтому вход проводит
 * человек: вводит в вики логин, пароль и код, а бэкенд сохраняет только куки.
 * Пароль в базу не попадает вообще. Куки МИС живут 30 дней, так что вход
 * нужен примерно раз в месяц, а не на каждую выгрузку.
 *
 * Куки — это полноценный доступ к МИС с персональными данными пациентов,
 * поэтому хранятся зашифрованными. Шифр и ключ взяты у почтового модуля
 * (MAIL_SECRET_KEY): второй ключ ради одной записи означал бы ещё одну
 * переменную окружения, которую забудут перенести на бой.
 */

const { encryptPassword, decryptPassword } = require('../mail/crypto');
const { CookieJar } = require('./client');

const SETTING_KEY = 'mis_web_session';

// Между паролем и кодом МИС держит у себя форму со скрытым паролем. Храним её
// в памяти процесса и недолго: письмо с кодом приходит за минуту, а висящий
// в памяти пароль после ухода человека никому не нужен. Процесс на бою один
// (pm2 fork), так что общей памяти достаточно.
const PENDING_TTL_MS = 10 * 60 * 1000;
const pending = new Map();

function setPending(userId, state) {
  pending.set(userId, { ...state, expiresAt: Date.now() + PENDING_TTL_MS });
}

function getPending(userId) {
  const p = pending.get(userId);
  if (!p) return null;
  if (p.expiresAt < Date.now()) {
    pending.delete(userId);
    return null;
  }
  return p;
}

function dropPending(userId) {
  pending.delete(userId);
}

// Модели подключаются при первом обращении, а не при загрузке модуля: так
// задача выгрузки и её тесты поднимаются без базы.
const Setting = () => require('../../models').Setting;

async function readSetting() {
  const row = await Setting().findByPk(SETTING_KEY);
  return row?.value || null;
}

async function writeSetting(value) {
  await Setting().upsert({
    key: SETTING_KEY,
    value,
    description: 'Сессия веб-МИС для выгрузки услуг (куки зашифрованы)',
  });
}

async function save(jar, { login, connectedBy }) {
  await writeSetting({
    login,
    connectedBy,
    connectedAt: new Date().toISOString(),
    secret: encryptPassword(JSON.stringify(jar.toJSON())),
  });
}

/**
 * Сессия для работы. null — входа нет или он истёк; тогда выгрузка не
 * начинается, а вкладка предлагает войти.
 */
async function loadJar() {
  const v = await readSetting();
  if (!v?.secret) return null;
  return new CookieJar(JSON.parse(decryptPassword(v.secret)));
}

/**
 * Куки больше не пускают. Сами куки стираем (они мертвы), а кто и когда
 * входил — оставляем, чтобы вкладка могла сказать, чья сессия кончилась.
 */
async function markExpired() {
  const v = await readSetting();
  if (!v) return;
  const { secret, ...meta } = v;
  await writeSetting({ ...meta, expiredAt: new Date().toISOString() });
}

async function forget() {
  await Setting().destroy({ where: { key: SETTING_KEY } });
}

/**
 * Что показать во вкладке. Без секрета: наружу уходят только имя учётки и
 * даты.
 */
async function describe() {
  const v = await readSetting();
  if (!v) return { connected: false };
  return {
    connected: !!v.secret,
    login: v.login || null,
    connectedBy: v.connectedBy || null,
    connectedAt: v.connectedAt || null,
    expiredAt: v.expiredAt || null,
  };
}

module.exports = {
  setPending,
  getPending,
  dropPending,
  save,
  loadJar,
  markExpired,
  forget,
  describe,
};
