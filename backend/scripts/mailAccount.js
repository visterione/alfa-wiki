#!/usr/bin/env node
'use strict';

/**
 * Управление почтовыми ящиками из командной строки (ver. 8.58).
 *
 * Нужен до того, как появится раздел в админке: чтобы проверить подключение к
 * настоящему ящику и посмотреть, как наполняется зеркало, интерфейс не
 * обязателен. Останется и после — заводить сотню ящиков через форму руками
 * никто не захочет, а здесь это делается строкой.
 *
 * Запуск из каталога backend:
 *
 *   npm run mail:account -- --list
 *   npm run mail:account -- --add --email info@alfa.ru --name "Регистратура"
 *   npm run mail:account -- --test info@alfa.ru
 *   npm run mail:account -- --grant info@alfa.ru --user ivanov --can-send
 *   npm run mail:account -- --remove info@alfa.ru
 *
 * Пароль спрашивается отдельно и не печатается: переданный аргументом, он попал
 * бы и в историю оболочки, и в вывод ps — то есть стал бы виден всем, у кого
 * есть доступ на сервер.
 */

require('dotenv').config();

const { sequelize, MailAccount, MailAccountUser, MailFolder, MailMessage, User, MedCenter } = require('../models');
const { encryptPassword } = require('../services/mail/crypto');
const { testAccount } = require('../services/mail/imap');

sequelize.options.logging = false;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
};

/**
 * Ввод пароля без эха. Сырой режим терминала, потому что readline умеет либо
 * показывать введённое, либо ничего не показывать вовсе — а нам нужно и то, и
 * другое: приглашение видно, ответ нет.
 */
function askHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('Пароль вводится только в интерактивном терминале. Либо передайте --password, либо запустите команду вручную.'));
      return;
    }

    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const finish = (result, code) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      if (code !== undefined) process.exit(code);
      resolve(result);
    };

    const onData = (char) => {
      switch (char) {
        case '\r':
        case '\n':
        case '':
          finish(value);
          break;
        case '':
          finish('', 130);
          break;
        case '':
        case '\b':
          value = value.slice(0, -1);
          break;
        default:
          value += char;
      }
    };

    stdin.on('data', onData);
  });
}

async function findAccount(key) {
  if (!key || key === true) throw new Error('Не указан ящик: нужен адрес или идентификатор');
  const where = /^[0-9a-f-]{36}$/i.test(key) ? { id: key } : { email: String(key).toLowerCase() };
  const account = await MailAccount.scope('withSecret').findOne({ where });
  if (!account) throw new Error(`Ящик «${key}» не найден`);
  return account;
}

async function list() {
  const accounts = await MailAccount.findAll({
    order: [['sortOrder', 'ASC'], ['email', 'ASC']],
    include: [{ model: MedCenter, as: 'medCenter', attributes: ['name'], required: false }],
  });

  if (!accounts.length) {
    console.log('Ящиков пока нет. Завести: npm run mail:account -- --add --email ... --name ...');
    return;
  }

  for (const account of accounts) {
    const [[stats]] = await sequelize.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "bodyState" = 'pending')::int AS pending,
             COUNT(*) FILTER (WHERE NOT "isSeen")::int AS unseen
      FROM mail_messages WHERE "accountId" = :id
    `, { replacements: { id: account.id } });

    const access = await MailAccountUser.count({ where: { accountId: account.id } });
    const folders = await MailFolder.count({ where: { accountId: account.id } });

    console.log(`\n${account.email}  «${account.displayName}»${account.isActive ? '' : '  [выключен]'}`);
    console.log(`  медцентр: ${account.medCenter?.name || '—'}, доступ у ${access} чел., папок: ${folders}`);
    console.log(`  состояние: ${account.syncState}${account.lastSyncAt ? `, синхронизация ${account.lastSyncAt.toISOString()}` : ''}`);
    console.log(`  писем: ${stats.total}, без тела: ${stats.pending}, непрочитанных: ${stats.unseen}`);
    if (account.lastError) console.log(`  ошибка: ${account.lastError}`);
  }
  console.log('');
}

async function add() {
  const email = String(flag('email') || '').toLowerCase().trim();
  const name = flag('name');
  if (!email || !name || name === true) {
    throw new Error('Нужны --email и --name, например: --email info@alfa.ru --name "Регистратура Ленина"');
  }

  const exists = await MailAccount.findOne({ where: { email } });
  if (exists) throw new Error(`Ящик ${email} уже заведён`);

  const provided = flag('password');
  const password = provided && provided !== true ? String(provided) : await askHidden(`Пароль для ${email}: `);
  if (!password) throw new Error('Пустой пароль');

  let medCenterId = null;
  const mc = flag('medcenter');
  if (mc && mc !== true) {
    const center = await MedCenter.findOne({ where: { code: mc } }) || await MedCenter.findOne({ where: { name: mc } });
    if (!center) throw new Error(`Медцентр «${mc}» не найден`);
    medCenterId = center.id;
  }

  const host = flag('host');
  const secret = encryptPassword(password);
  const account = await MailAccount.create({
    email,
    displayName: String(name),
    login: String(flag('login') || email),
    medCenterId,
    ...(host && host !== true ? { imapHost: String(host), smtpHost: String(host) } : {}),
    ...secret,
  });

  console.log(`Ящик ${email} заведён (${account.id}).`);
  console.log(`Проверить подключение: npm run mail:account -- --test ${email}`);
}

async function test(key) {
  const account = await findAccount(key);
  process.stdout.write(`Подключаюсь к ${account.email}… `);

  const result = await testAccount(account);
  console.log(`получилось за ${result.ms} мс\n`);

  const c = result.capabilities;
  console.log('Что сервер умеет:');
  const lines = [
    ['CONDSTORE', c.condstore, 'догонять изменения флагов, не перечитывая ящик'],
    ['QRESYNC', c.qresync, 'узнавать удалённые письма одним запросом'],
    ['IDLE', c.idle, 'мгновенное уведомление о новом письме'],
    ['MOVE', c.move, 'перенос письма без копии и удаления'],
    ['UIDPLUS', c.uidplus, 'узнать UID письма, положенного в «Отправленные»'],
    ['SPECIAL-USE', c.specialUse, 'понять, какая папка «Отправленные», не гадая по имени'],
    ['COMPRESS', c.compress, 'сжатие потока — ускоряет первичную заливку'],
  ];
  for (const [capName, ok, why] of lines) {
    console.log(`  ${ok ? '[есть]' : '[НЕТ ]'} ${capName.padEnd(12)} — ${why}`);
  }

  console.log(`\nПапки (${result.folders.length}):`);
  for (const f of result.folders) {
    console.log(`  ${f.name || f.path}${f.specialUse ? `  ${f.specialUse}` : ''}`);
  }

  await account.update({ capabilities: c });
  console.log('\nВозможности сохранены в карточке ящика.');
}

async function grant() {
  const account = await findAccount(flag('grant'));
  const username = flag('user');
  if (!username || username === true) throw new Error('Нужен --user с логином сотрудника');

  const user = await User.findOne({ where: { username: String(username) } });
  if (!user) throw new Error(`Сотрудник «${username}» не найден`);

  const [access, created] = await MailAccountUser.findOrCreate({
    where: { accountId: account.id, userId: user.id },
    defaults: {
      canSend: args.includes('--can-send'),
      canDelete: args.includes('--can-delete'),
      isDefault: args.includes('--default'),
    },
  });

  if (!created) {
    await access.update({
      canSend: args.includes('--can-send') || access.canSend,
      canDelete: args.includes('--can-delete') || access.canDelete,
    });
  }

  console.log(`${user.displayName || user.username}: доступ к ${account.email}` +
    ` (отправка: ${access.canSend ? 'да' : 'нет'}, удаление: ${access.canDelete ? 'да' : 'нет'})`);
}

async function remove() {
  const account = await findAccount(flag('remove'));
  const count = await MailMessage.count({ where: { accountId: account.id } });

  if (!args.includes('--yes')) {
    console.log(`Ящик ${account.email}: ${count} писем в зеркале.`);
    console.log('Удаление уберёт их из портала. На сервере письма останутся нетронутыми.');
    console.log('Повторите команду с --yes, если действительно нужно.');
    return;
  }

  await account.destroy();
  console.log(`Ящик ${account.email} и ${count} писем убраны из зеркала. На сервере ничего не тронуто.`);
}

async function main() {
  if (args.includes('--add')) return add();
  if (flag('test')) return test(flag('test'));
  if (flag('grant')) return grant();
  if (flag('remove')) return remove();
  if (args.includes('--list') || !args.length) return list();
  console.log('Неизвестная команда. Смотри комментарий в начале scripts/mailAccount.js');
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error(`\nНе вышло: ${err.message}`);
    await sequelize.close();
    process.exit(1);
  });
