/**
 * Скрипт: Создание аватара для α-Ассистента
 *
 * Создаёт простой аватар с буквой α на синем фоне.
 *
 * Запуск: node backend/migrations/create-assistant-avatar.js
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const AVATAR_PATH = path.join(__dirname, '..', 'uploads', 'avatars', 'assistant-avatar.png');

async function createAvatar() {
  try {
    console.log('🎨 Создание аватара для α-Ассистента...');

    // Убедимся, что директория существует
    const dir = path.dirname(AVATAR_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Создана директория: ${dir}`);
    }

    // Создаём SVG с буквой α на градиентном фоне
    const svg = `
      <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="200" height="200" fill="url(#bg)" rx="100" />
        <text x="100" y="130" font-family="Arial, sans-serif" font-size="100" font-weight="bold" fill="white" text-anchor="middle">α</text>
      </svg>
    `;

    // Конвертируем SVG в PNG
    await sharp(Buffer.from(svg))
      .resize(200, 200)
      .png()
      .toFile(AVATAR_PATH);

    console.log(`✅ Аватар создан: ${AVATAR_PATH}`);
    console.log('');
    console.log('🎉 Готово!');

  } catch (error) {
    console.error('❌ Ошибка создания аватара:', error);
    throw error;
  }
}

// Запуск если файл запущен напрямую
if (require.main === module) {
  createAvatar();
}

module.exports = { createAvatar, AVATAR_PATH };
