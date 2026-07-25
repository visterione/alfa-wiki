// Переводит встроенные в страницы бот-скрипты с хардкода :9001 на origin-aware базу.
//
// Причина: бот-HTML (услуги, отчёты, карточки врачей и т.д.) хранится в pages.content
// и выполняется PageView.js. Скрипты обращались к API по адресу
//   window.location.protocol + '//' + window.location.hostname + ':9001'
// На HTTPS страница живёт на 443, а :9001 — другой origin (и без TLS), поэтому запросы
// падают по CORS / таймауту. После правки прод ходит через nginx на том же origin (/api),
// а локальный дев (:9000) продолжает стучаться на :9001.
//
// ЗАПУСКАТЬ НА СЕРВЕРЕ, где backend/.env указывает на прод-БД:
//   node backend/scripts/fixApiBaseInPages.js
//
// Идемпотентно: страницы, уже содержащие маркер `window.location.port === '9000'`,
// пропускаются (повторный запуск безопасен).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize, Page } = require('../models');

// База до ":9001 включительно — остаток строки (/api/... или закрывающая кавычка) сохраняется.
const OLD = "window.location.protocol + '//' + window.location.hostname + ':9001";
const NEW = "(window.location.port === '9000' ? window.location.protocol + '//' + window.location.hostname + ':9001' : window.location.origin) + '";
const MARKER = "window.location.port === '9000'"; // признак уже мигрированного контента

function migrate(text) {
  if (typeof text !== 'string' || text.indexOf(OLD) === -1) return { text, count: 0 };
  if (text.indexOf(MARKER) !== -1) return { text, count: 0, skipped: true }; // уже мигрировано
  const count = text.split(OLD).length - 1;
  return { text: text.split(OLD).join(NEW), count };
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? '🔎 DRY RUN — изменения не сохраняются\n' : '🚀 Применение изменений\n');

  let pagesChanged = 0;
  let occurrences = 0;
  let skipped = 0;

  const pages = await Page.findAll({ attributes: ['id', 'title', 'content', 'customJs'] });
  console.log(`📄 Всего страниц: ${pages.length}\n`);

  for (const page of pages) {
    const c = migrate(page.content);
    const j = migrate(page.customJs);

    if (c.skipped || j.skipped) skipped++;
    if (c.count === 0 && j.count === 0) continue;

    occurrences += c.count + j.count;
    pagesChanged++;
    console.log(`   ✅ ${page.title} (${page.id}) — content: ${c.count}, customJs: ${j.count}`);

    if (!dryRun) {
      const patch = {};
      if (c.count > 0) patch.content = c.text;
      if (j.count > 0) patch.customJs = j.text;
      await page.update(patch);
    }
  }

  console.log(`\n${dryRun ? '📋 Будет изменено' : '✅ Изменено'}: страниц ${pagesChanged}, замен ${occurrences}` +
              (skipped ? `, пропущено уже мигрированных: ${skipped}` : ''));
  if (pagesChanged === 0 && skipped === 0) {
    console.log('⚠️  Старая база :9001 в страницах не найдена (возможно, уже мигрировано или другое поле).');
  }
}

run()
  .catch((e) => { console.error('❌ Ошибка:', e); process.exitCode = 1; })
  .finally(() => sequelize.close());
