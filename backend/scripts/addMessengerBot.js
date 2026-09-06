'use strict';

/**
 * Регистрация нашего бота и установка вебхука (ver. 7.84).
 *
 * Токен не хранится в репозитории и не попадает в .env: он живёт строкой в
 * messenger_bots, и этим скриптом туда попадает. Отсюда же ставится вебхук —
 * шаг, который нельзя забыть: пока адрес не указан, бот молчит, потому что
 * платформа держит обновления у себя.
 *
 * Запуск из каталога backend:
 *   node scripts/addMessengerBot.js --token 123:ABC --org test --title "Тестовый"
 *   node scripts/addMessengerBot.js --token 123:ABC --org test --polling
 *   node scripts/addMessengerBot.js --list
 *   node scripts/addMessengerBot.js --mode <id> --polling   перевести на самостоятельный забор
 *   node scripts/addMessengerBot.js --mode <id> --webhook   вернуть на вебхук
 *   node scripts/addMessengerBot.js --unhook <id>     снять вебхук (вернуть бота агрегатору)
 *
 * Режим забора нужен там, где платформа не может достучаться до нас снаружи:
 * тогда бот сам ходит за обновлениями, и вебхук у него должен быть снят —
 * Telegram не отдаёт getUpdates, пока адрес вебхука прописан.
 */

require('dotenv').config();

const crypto = require('crypto');
const { sequelize, MessengerBot } = require('../models');
const { getChannel } = require('../services/messengers');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE_URL = (valueOf('--base', process.env.BASE_URL) || 'https://wiki.medcentralfa.ru').replace(/\/+$/, '');

function webhookUrl(bot) {
  return `${BASE_URL}/api/messenger/${bot.platform}/${bot.id}`;
}

async function list() {
  const bots = await MessengerBot.findAll({ order: [['organization', 'ASC'], ['platform', 'ASC']] });
  if (!bots.length) return console.log('Ботов пока нет.');

  for (const bot of bots) {
    const channel = getChannel(bot.platform);
    let state = '';
    try {
      const info = await channel.getWebhookInfo(bot.token);
      state = info.url ? `вебхук: ${info.url}` : 'вебхук НЕ установлен';
      if (info.last_error_message) state += `  ⚠ ${info.last_error_message}`;
      if (info.pending_update_count) state += `  (в очереди: ${info.pending_update_count})`;
    } catch (err) {
      state = `недоступен: ${err.message}`;
    }
    const mode = bot.deliveryMode === 'polling' ? 'забор обновлений' : 'вебхук';
    console.log(`${bot.isActive ? '●' : '○'} ${bot.platform}/${bot.organization}  @${bot.username || '?'}  ${bot.id}`);
    console.log(`   режим: ${mode}`);
    console.log(`   ${state}`);
  }
}

async function unhook(id) {
  const bot = await MessengerBot.findByPk(id);
  if (!bot) throw new Error(`Бот ${id} не найден`);

  await getChannel(bot.platform).deleteWebhook(bot.token);
  await bot.update({ isActive: false });
  console.log(`Вебхук снят, бот @${bot.username} выключен. Теперь его можно вернуть агрегатору.`);
}

async function setMode(id) {
  const bot = await MessengerBot.findByPk(id);
  if (!bot) throw new Error(`Бот ${id} не найден`);

  const channel = getChannel(bot.platform);

  if (has('--polling')) {
    // Вебхук и getUpdates взаимно исключают друг друга: пока адрес прописан,
    // Telegram отвечает на getUpdates ошибкой конфликта.
    await channel.deleteWebhook(bot.token);
    await bot.update({ deliveryMode: 'polling', isActive: true });
    console.log(`@${bot.username}: вебхук снят, режим — самостоятельный забор.`);
    console.log('Не забудь поднять процесс: pm2 start ecosystem.config.js --only alfa-wiki-poller');
    return;
  }

  await channel.setWebhook(bot.token, webhookUrl(bot), bot.webhookSecret);
  await bot.update({ deliveryMode: 'webhook', isActive: true });
  console.log(`@${bot.username}: режим — вебхук на ${webhookUrl(bot)}`);
}

async function add() {
  const token = valueOf('--token');
  const platform = valueOf('--platform', 'telegram');
  const organization = valueOf('--org');

  if (!token || !organization) {
    console.error('Нужны --token и --org. Пример:');
    console.error('  node scripts/addMessengerBot.js --token 123:ABC --org test --title "Тестовый бот"');
    process.exit(1);
  }

  const channel = getChannel(platform);

  // Сначала проверяем токен: незачем заводить строку под бота, которого нет.
  const me = await channel.getMe(token);
  console.log(`Бот: @${me.username} (${me.first_name})`);

  const existing = await MessengerBot.findOne({ where: { token } });
  const bot = existing
    ? await existing.update({ platform, organization, username: me.username, title: valueOf('--title', me.first_name), isActive: true })
    : await MessengerBot.create({
        platform,
        organization,
        token,
        username: me.username,
        title: valueOf('--title', me.first_name),
        webhookSecret: crypto.randomBytes(24).toString('hex'),
        isActive: true
      });

  if (has('--polling')) {
    await channel.deleteWebhook(bot.token);
    await bot.update({ deliveryMode: 'polling' });
    console.log('Режим: самостоятельный забор обновлений (вебхук снят).');
    console.log('Поднять процесс: pm2 start ecosystem.config.js --only alfa-wiki-poller');
  } else {
    const url = webhookUrl(bot);
    await channel.setWebhook(bot.token, url, bot.webhookSecret);

    const info = await channel.getWebhookInfo(bot.token);
    console.log(`Вебхук: ${info.url || '(пусто)'}`);
    if (info.last_error_message) console.log(`⚠ последняя ошибка: ${info.last_error_message}`);
  }
  console.log(`Готово. id бота: ${bot.id}`);
}

(async () => {
  try {
    if (has('--list')) await list();
    else if (has('--mode')) await setMode(valueOf('--mode'));
    else if (has('--unhook')) await unhook(valueOf('--unhook'));
    else await add();
  } catch (err) {
    console.error('Ошибка:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
