'use strict';

/**
 * Скрипт: register-existing-bots.js
 * Находит всех пользователей с isBot=true и регистрирует их в bot_tokens
 * (если запись ещё не существует).
 *
 * Запуск: node backend/scripts/register-existing-bots.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const { sequelize, User, BotToken } = require('../models');

function generateToken(userId) {
  // Берём числовой префикс из первых 7 символов UUID (hex)
  const hex = userId.replace(/-/g, '').substring(0, 7);
  const numericId = parseInt(hex, 16) & 0x7fffffff;
  const random = crypto.randomBytes(20).toString('base64url').substring(0, 35);
  return `${numericId}:${random}`;
}

async function main() {
  await sequelize.authenticate();
  console.log('✅ БД подключена\n');

  const botUsers = await User.findAll({
    where: { isBot: true },
    order: [['createdAt', 'ASC']]
  });

  if (!botUsers.length) {
    console.log('Пользователей с isBot=true не найдено.');
    return;
  }

  console.log(`Найдено ${botUsers.length} бот-пользователей:\n`);

  for (const u of botUsers) {
    console.log(`  • ${u.displayName || u.username} (id: ${u.id})`);

    const existing = await BotToken.findOne({ where: { userId: u.id } });
    if (existing) {
      console.log(`    → уже зарегистрирован (token: ${existing.token.substring(0, 20)}...)\n`);
      continue;
    }

    // Определяем username для BotToken (убираем префикс bot_ если есть)
    const username = (u.username || '').replace(/^bot_/, '') || u.id.substring(0, 8);

    const token = generateToken(u.id);

    const bot = await BotToken.create({
      token,
      name: u.displayName || u.username,
      username,
      description: 'Импортирован из существующих пользователей',
      userId: u.id,
      isActive: u.isActive !== false
    });

    console.log(`    → создан BotToken`);
    console.log(`       Токен:    ${bot.token}`);
    console.log(`       Username: @${bot.username}\n`);
  }

  console.log('Готово. Обновите страницу /admin/bots.');
}

main()
  .catch(e => { console.error('Ошибка:', e.message); process.exit(1); })
  .finally(() => sequelize.close());
