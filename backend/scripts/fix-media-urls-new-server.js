const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize, User, Page, Media, Lesson, Message, MapMarker, DoctorCard, KanbanTask } = require('../models');

const OLD_URL      = 'http://192.168.22.39:9001';
const OLD_URL_ALT  = '192.168.22.39:9001';
const NEW_URL      = 'http://172.16.16.210:9001';

function replaceAll(str) {
  return str
    .replace(new RegExp(OLD_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), NEW_URL)
    .replace(new RegExp(OLD_URL_ALT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), NEW_URL);
}

function hasOld(str) {
  return typeof str === 'string' && (str.includes(OLD_URL) || str.includes(OLD_URL_ALT));
}

async function fixMediaUrls() {
  try {
    console.log(`Замена: ${OLD_URL} → ${NEW_URL}\n`);

    let totalFixed = 0;

    // 1. Pages (content)
    console.log('Проверка таблицы pages...');
    const pages = await Page.findAll({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('content')),
        'LIKE', `%${OLD_URL.toLowerCase()}%`
      )
    });
    console.log(`  Найдено: ${pages.length}`);
    for (const page of pages) {
      const newContent = replaceAll(page.content);
      if (newContent !== page.content) {
        await page.update({ content: newContent });
        console.log(`  ✓ Страница: ${page.title} (${page.id})`);
        totalFixed++;
      }
    }

    // 2. Users (avatar)
    console.log('\nПроверка таблицы users (avatar)...');
    const users = await User.findAll({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('avatar')),
        'LIKE', `%${OLD_URL.toLowerCase()}%`
      )
    });
    console.log(`  Найдено: ${users.length}`);
    for (const user of users) {
      if (hasOld(user.avatar)) {
        await user.update({ avatar: replaceAll(user.avatar) });
        console.log(`  ✓ Пользователь: ${user.username} (${user.id})`);
        totalFixed++;
      }
    }

    // 3. Media (url, path, thumbnailPath)
    console.log('\nПроверка таблицы media...');
    const mediaItems = await Media.findAll();
    let mediaFixed = 0;
    for (const item of mediaItems) {
      const updates = {};
      if (hasOld(item.url))           updates.url           = replaceAll(item.url);
      if (hasOld(item.path))          updates.path          = replaceAll(item.path);
      if (hasOld(item.thumbnailPath)) updates.thumbnailPath = replaceAll(item.thumbnailPath);
      if (Object.keys(updates).length) {
        await item.update(updates);
        console.log(`  ✓ Media: ${item.filename} (${item.id})`);
        mediaFixed++;
        totalFixed++;
      }
    }
    console.log(`  Найдено: ${mediaFixed}`);

    // 4. Lessons (content)
    console.log('\nПроверка таблицы lessons...');
    const lessons = await Lesson.findAll({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('content')),
        'LIKE', `%${OLD_URL.toLowerCase()}%`
      )
    });
    console.log(`  Найдено: ${lessons.length}`);
    for (const lesson of lessons) {
      const newContent = replaceAll(lesson.content);
      if (newContent !== lesson.content) {
        await lesson.update({ content: newContent });
        console.log(`  ✓ Урок: ${lesson.title} (${lesson.id})`);
        totalFixed++;
      }
    }

    // 5. Messages (content)
    console.log('\nПроверка таблицы messages...');
    const messages = await Message.findAll({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('content')),
        'LIKE', `%${OLD_URL.toLowerCase()}%`
      )
    });
    console.log(`  Найдено: ${messages.length}`);
    for (const message of messages) {
      const newContent = replaceAll(message.content);
      if (newContent !== message.content) {
        await message.update({ content: newContent });
        console.log(`  ✓ Сообщение: ${message.id}`);
        totalFixed++;
      }
    }

    // 6. Messages (attachments JSONB)
    console.log('\nПроверка attachments в messages...');
    const msgsWithAttachments = await Message.findAll({
      where: sequelize.literal(
        `attachments::text ILIKE '%${OLD_URL}%' OR attachments::text ILIKE '%${OLD_URL_ALT}%'`
      )
    });
    console.log(`  Найдено: ${msgsWithAttachments.length}`);
    for (const msg of msgsWithAttachments) {
      if (Array.isArray(msg.attachments)) {
        const newAttachments = msg.attachments.map(a => {
          const updated = { ...a };
          if (hasOld(a.url))  updated.url  = replaceAll(a.url);
          if (hasOld(a.path)) updated.path = replaceAll(a.path);
          return updated;
        });
        await msg.update({ attachments: newAttachments });
        console.log(`  ✓ Attachments сообщения: ${msg.id}`);
        totalFixed++;
      }
    }

    // 7. MapMarkers (media JSONB)
    console.log('\nПроверка таблицы map_markers...');
    const markers = await MapMarker.findAll({
      where: sequelize.literal(
        `media::text ILIKE '%${OLD_URL}%' OR media::text ILIKE '%${OLD_URL_ALT}%'`
      )
    });
    console.log(`  Найдено: ${markers.length}`);
    for (const marker of markers) {
      if (Array.isArray(marker.media)) {
        const newMedia = marker.media.map(item => {
          if (typeof item === 'string' && hasOld(item)) return replaceAll(item);
          if (typeof item === 'object' && item !== null) {
            const updated = { ...item };
            if (hasOld(item.url))  updated.url  = replaceAll(item.url);
            if (hasOld(item.path)) updated.path = replaceAll(item.path);
            return updated;
          }
          return item;
        });
        await marker.update({ media: newMedia });
        console.log(`  ✓ Маркер: ${marker.title} (${marker.id})`);
        totalFixed++;
      }
    }

    // 8. DoctorCards (photo)
    console.log('\nПроверка таблицы doctor_cards...');
    const doctors = await DoctorCard.findAll({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('photo')),
        'LIKE', `%${OLD_URL.toLowerCase()}%`
      )
    });
    console.log(`  Найдено: ${doctors.length}`);
    for (const doctor of doctors) {
      if (hasOld(doctor.photo)) {
        await doctor.update({ photo: replaceAll(doctor.photo) });
        console.log(`  ✓ Врач: ${doctor.fullName} (${doctor.id})`);
        totalFixed++;
      }
    }

    // 9. KanbanTasks (attachments JSONB)
    console.log('\nПроверка таблицы kanban_tasks...');
    const tasks = await KanbanTask.findAll({
      where: sequelize.literal(
        `attachments::text ILIKE '%${OLD_URL}%' OR attachments::text ILIKE '%${OLD_URL_ALT}%'`
      )
    });
    console.log(`  Найдено: ${tasks.length}`);
    for (const task of tasks) {
      if (Array.isArray(task.attachments)) {
        const newAttachments = task.attachments.map(a => {
          const updated = { ...a };
          if (hasOld(a.url))  updated.url  = replaceAll(a.url);
          if (hasOld(a.path)) updated.path = replaceAll(a.path);
          return updated;
        });
        await task.update({ attachments: newAttachments });
        console.log(`  ✓ Задача: ${task.title} (${task.id})`);
        totalFixed++;
      }
    }

    console.log(`\n✅ Готово. Всего обновлено записей: ${totalFixed}`);

    if (totalFixed === 0) {
      console.log('\n⚠️  Старые URL не найдены. Возможные причины:');
      console.log('  1. Пути в БД уже относительные (/uploads/...) — это нормально');
      console.log('  2. Проверьте BASE_URL в .env на новом сервере');
      console.log('  3. Возможно кэш браузера — Ctrl+Shift+R');
    }

  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

fixMediaUrls();
