#!/usr/bin/env node
'use strict';

/**
 * Пересчёт searchContent у всех страниц — ver. 6.92.
 *
 * До этой версии текст интерактивных таблиц (div[data-itable]) не попадал в
 * searchContent: он лежит percent-encoded в атрибуте data-table-html, а
 * sanitizeHtml снимает атрибуты вместе с содержимым. У страниц, где таблица —
 * это всё содержимое, searchContent оставался пустым, и глобальный поиск их
 * не находил вовсе. Правка в routes/pages.js чинит новые сохранения, этот
 * скрипт — уже сохранённые страницы.
 *
 * Из backend/:
 *   npm run migrate:6.92:check  # показать, у каких страниц изменится индекс
 *   npm run migrate:6.92        # пересчитать и переиндексировать
 */

const { Page, SearchIndex, sequelize } = require('../models');
const { extractTextContent } = require('../routes/pages');

sequelize.options.logging = false;

async function main() {
  const checkOnly = process.argv.includes('--check');

  try {
    await sequelize.authenticate();
    console.log('\n▶ Переиндексация searchContent страниц (ver. 6.92)');
    console.log(`   База: ${sequelize.config.database} на ${sequelize.config.host}\n`);

    const pages = await Page.findAll({
      attributes: ['id', 'slug', 'title', 'content', 'contentType', 'searchContent', 'keywords', 'isPublished'],
      order: [['slug', 'ASC']]
    });

    const changed = [];
    for (const page of pages) {
      // Таблицы и файлы searchContent не заполняют — их логика не менялась.
      if (page.contentType === 'spreadsheet' || page.contentType === 'file') continue;

      const next = extractTextContent(page.content || '');
      if (next === (page.searchContent || '')) continue;

      changed.push({ page, next, before: (page.searchContent || '').length });
    }

    if (changed.length === 0) {
      console.log('✅ Все страницы уже проиндексированы актуальным кодом\n');
      return;
    }

    console.log(`   Изменится страниц: ${changed.length}\n`);
    for (const { page, next, before } of changed) {
      console.log(`   ${page.slug} — ${before} → ${next.length} симв.${page.isPublished ? '' : ' (черновик)'}`);
    }

    if (checkOnly) {
      console.log('\n⚠️  Запустите без --check, чтобы применить\n');
      process.exitCode = 2;
      return;
    }

    for (const { page, next } of changed) {
      // Пишем напрямую, минуя PUT /pages/:id: обновляется только производное
      // поле, а content, история и updatedBy трогать не за что.
      await Page.update({ searchContent: next }, { where: { id: page.id }, silent: true });
      await SearchIndex.upsert({
        entityType: 'page',
        entityId: page.id,
        title: page.title,
        content: next,
        keywords: page.keywords || [],
        url: `/page/${page.slug}`
      });
    }

    console.log(`\n✅ Переиндексировано страниц: ${changed.length}`);
    console.log('   Кэш поиска живёт 60 секунд — результаты обновятся сразу после него.\n');
  } finally {
    await sequelize.close().catch(() => {});
  }
}

main().catch(error => {
  const message = error?.original?.message || error?.parent?.message || error?.message || String(error);
  console.error(`\n❌ Переиндексация не выполнена: ${message}\n`);
  process.exitCode = 1;
});
