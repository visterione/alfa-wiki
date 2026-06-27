const fs = require('fs');
const path = require('path');
const { sequelize, Folder } = require('../models');

// Та же транслитерация, что и в routes/folders.js
function generateSlug(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[а-яё]/gi, char => {
      const ru = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
      const en = ['a','b','v','g','d','e','yo','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','c','ch','sh','sch','','y','','e','yu','ya'];
      const idx = ru.indexOf(char.toLowerCase());
      return idx >= 0 ? en[idx] : char;
    })
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function runMigration() {
  try {
    console.log('Запуск миграции: добавление slug для папок...');

    // 1. Добавляем колонку и индекс (идемпотентно)
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/add-folder-slug.sql'), 'utf8');
    await sequelize.query(sql);
    console.log('✅ Колонка folders.slug готова');

    // 2. Бэкфилл: генерируем slug для папок без него, уникально в пределах родителя
    const folders = await Folder.findAll({ order: [['parentId', 'ASC'], ['createdAt', 'ASC']] });

    // Учитываем уже занятые slug по родителям
    const usedByParent = new Map(); // parentKey -> Set(slug)
    const keyOf = (pid) => pid || 'root';
    folders.forEach(f => {
      if (f.slug) {
        const k = keyOf(f.parentId);
        if (!usedByParent.has(k)) usedByParent.set(k, new Set());
        usedByParent.get(k).add(f.slug);
      }
    });

    let updated = 0;
    for (const folder of folders) {
      if (folder.slug) continue;
      const k = keyOf(folder.parentId);
      if (!usedByParent.has(k)) usedByParent.set(k, new Set());
      const used = usedByParent.get(k);

      const base = generateSlug(folder.title) || 'folder';
      let slug = base;
      let n = 1;
      while (used.has(slug)) { n += 1; slug = `${base}-${n}`; }

      used.add(slug);
      await folder.update({ slug });
      updated += 1;
    }

    console.log(`✅ Миграция выполнена. Slug проставлен для ${updated} папок (всего ${folders.length}).`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка выполнения миграции:', error);
    process.exit(1);
  }
}

runMigration();
