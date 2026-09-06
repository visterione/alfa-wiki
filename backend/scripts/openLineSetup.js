'use strict';

/**
 * Настройка открытой линии из командной строки (ver. 7.85).
 *
 * Экрана настройки пока нет — и на первое время он не нужен: линий шесть, состав
 * меняется редко, а завести их надо один раз. API для будущего экрана уже есть
 * (routes/open-line.js), здесь тот же самый набор действий без интерфейса.
 *
 * Запуск из каталога backend:
 *   node scripts/openLineSetup.js --list
 *   node scripts/openLineSetup.js --create "Альфа — колл-центр" [--medcenter "Альфа"]
 *   node scripts/openLineSetup.js --bind <id линии> <id бота>
 *   node scripts/openLineSetup.js --operator <id линии> <логин сотрудника>
 *   node scripts/openLineSetup.js --drop-operator <id линии> <логин сотрудника>
 *   node scripts/openLineSetup.js --offline <id линии> "текст автоответа"
 */

require('dotenv').config();

const { Op } = require('sequelize');
const {
  sequelize, OmniLine, OmniLineOperator, OmniConversation,
  MessengerBot, MedCenter, User
} = require('../models');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const after = (flag, n = 1) => {
  const i = args.indexOf(flag);
  if (i < 0) return [];
  return args.slice(i + 1, i + 1 + n);
};

async function findUser(login) {
  const user = await User.findOne({
    where: { [Op.or]: [{ username: login }, { id: /^[0-9a-f-]{36}$/i.test(login) ? login : null }] }
  });
  if (!user) throw new Error(`Сотрудник «${login}» не найден`);
  return user;
}

async function list() {
  const lines = await OmniLine.findAll({
    include: [
      { model: MedCenter, as: 'medCenter', attributes: ['name'] },
      { model: OmniLineOperator, as: 'operators', include: [{ model: User, as: 'user', attributes: ['username', 'displayName'] }] }
    ],
    order: [['name', 'ASC']]
  });

  if (!lines.length) {
    console.log('Линий пока нет. Завести:  node scripts/openLineSetup.js --create "Название"');
  }

  for (const line of lines) {
    const bots = await MessengerBot.findAll({ where: { lineId: line.id }, attributes: ['platform', 'username'] });
    const queued = await OmniConversation.count({ where: { lineId: line.id, status: 'queued' } });
    const onShift = line.operators.filter(o => o.onShift).length;

    console.log(`\n${line.isActive ? '●' : '○'} ${line.name}   ${line.id}`);
    if (line.medCenter) console.log(`   медцентр: ${line.medCenter.name}`);
    console.log(`   боты: ${bots.length ? bots.map(b => `${b.platform}/@${b.username}`).join(', ') : '— не привязаны, обращения не придут'}`);
    console.log(`   состав: ${line.operators.length ? line.operators.map(o => (o.user?.displayName || o.user?.username) + (o.onShift ? ' (на смене)' : '')).join(', ') : '— пусто'}`);
    console.log(`   на смене: ${onShift}   в очереди: ${queued}`);
  }

  const loose = await MessengerBot.findAll({ where: { lineId: null }, attributes: ['id', 'platform', 'username', 'organization'] });
  if (loose.length) {
    console.log('\nБоты без линии:');
    for (const b of loose) console.log(`   ${b.platform}/@${b.username}  (${b.organization})  ${b.id}`);
  }
}

async function create() {
  const [name] = after('--create');
  if (!name) throw new Error('Нужно название линии');

  let medCenterId = null;
  const [mcName] = after('--medcenter');
  if (mcName) {
    const mc = await MedCenter.findOne({ where: { [Op.or]: [{ name: mcName }, { code: mcName }] } });
    if (!mc) throw new Error(`Медцентр «${mcName}» не найден`);
    medCenterId = mc.id;
  }

  const line = await OmniLine.create({ name, medCenterId });
  console.log(`Линия «${line.name}» заведена: ${line.id}`);
  console.log('Дальше: привязать бота (--bind) и добавить сотрудников (--operator).');
}

async function bind() {
  const [lineId, botId] = after('--bind', 2);
  const line = await OmniLine.findByPk(lineId);
  if (!line) throw new Error('Линия не найдена');

  const bot = await MessengerBot.findByPk(botId);
  if (!bot) throw new Error('Бот не найден');

  await bot.update({ lineId: line.id });
  console.log(`@${bot.username} теперь кормит линию «${line.name}».`);
}

async function operator(add) {
  const [lineId, login] = after(add ? '--operator' : '--drop-operator', 2);
  const line = await OmniLine.findByPk(lineId);
  if (!line) throw new Error('Линия не найдена');

  const user = await findUser(login);

  if (add) {
    await OmniLineOperator.findOrCreate({ where: { lineId: line.id, userId: user.id }, defaults: { lineId: line.id, userId: user.id } });
    console.log(`${user.displayName || user.username} добавлен в линию «${line.name}».`);
    console.log('Раздел появится у него после выдачи доступа «Открытая линия» в карточке пользователя.');
  } else {
    await OmniLineOperator.destroy({ where: { lineId: line.id, userId: user.id } });
    console.log(`${user.displayName || user.username} убран из линии «${line.name}».`);
  }
}

async function offline() {
  const [lineId, text] = after('--offline', 2);
  const line = await OmniLine.findByPk(lineId);
  if (!line) throw new Error('Линия не найдена');

  await line.update({ offlineReply: text || null });
  console.log(text ? `Автоответ линии «${line.name}» изменён.` : `Автоответ линии «${line.name}» сброшен на текст по умолчанию.`);
}

(async () => {
  try {
    if (has('--create')) await create();
    else if (has('--bind')) await bind();
    else if (has('--operator')) await operator(true);
    else if (has('--drop-operator')) await operator(false);
    else if (has('--offline')) await offline();
    else await list();
  } catch (err) {
    console.error('Ошибка:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
