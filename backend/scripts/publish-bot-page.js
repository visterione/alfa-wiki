'use strict';

/**
 * Выложить страницу из backend/bot/*.html в вики.
 *
 * Страницы вики хранят разметку целиком в pages.content — файлы в bot/ это
 * исходники, которые до сих пор переносились копипастом через редактор.
 * Скрипт делает то же самое, но без ручного переноса шести тысяч строк.
 *
 * Запуск из каталога backend:
 *   node scripts/publish-bot-page.js competitor-map.html karta-konkurentov "Карта конкурентов"
 *   node scripts/publish-bot-page.js price-compare.html analiz-cenovoy-politiki-uslug
 *
 * Существующая страница обновляется, новая заводится. Название нужно только
 * при создании: у уже заведённой страницы его не трогаем — его мог поменять
 * человек, и перебивать это чужой правкой нельзя.
 */

const fs = require('fs');
const path = require('path');
const { sequelize, Page } = require('../models');

const [fileArg, slugArg, titleArg] = process.argv.slice(2);

async function run() {
  if (!fileArg || !slugArg) {
    console.log('Укажите файл и адрес страницы:');
    console.log('  node scripts/publish-bot-page.js competitor-map.html karta-konkurentov "Карта конкурентов"');
    return;
  }

  const file = path.resolve(__dirname, '..', 'bot', fileArg);
  if (!fs.existsSync(file)) {
    throw new Error(`файла нет: ${file}`);
  }

  const content = fs.readFileSync(file, 'utf8');
  console.log(`🔄 ${fileArg} → /${slugArg} (${Math.round(content.length / 1024)} КБ)`);

  await sequelize.authenticate();
  const existing = await Page.findOne({ where: { slug: slugArg } });

  if (existing) {
    const before = existing.content ? existing.content.length : 0;
    await existing.update({ content });
    console.log(`✅ Обновлена «${existing.title}»: было ${Math.round(before / 1024)} КБ, стало ${Math.round(content.length / 1024)} КБ`);
    return;
  }

  if (!titleArg) {
    throw new Error('страницы с таким адресом нет — укажите третьим аргументом её название');
  }

  const page = await Page.create({ slug: slugArg, title: titleArg, content });
  console.log(`✅ Заведена страница «${page.title}» по адресу /${page.slug}`);
  console.log('   Права доступа и папку задайте в интерфейсе вики.');
}

run()
  .then(() => console.log('🎉 Готово'))
  .catch(err => {
    console.error('❌ Не вышло:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
