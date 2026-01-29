const { sequelize, Page, Lesson, Message, MapMarker, DoctorCard, KanbanTask } = require('../models');

const OLD_URL = 'http://192.168.10.55:9001';
const OLD_URL_ALT = '192.168.10.55:9001';

async function fixMediaUrls() {
  try {
    console.log('🔍 Поиск записей со старыми URL медиа-файлов...\n');

    let totalFixed = 0;

    // 1. Fix Pages
    console.log('📄 Проверка таблицы pages...');
    const pages = await Page.findAll({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('content')),
        'LIKE',
        `%${OLD_URL.toLowerCase()}%`
      )
    });

    console.log(`   Найдено страниц: ${pages.length}`);
    for (const page of pages) {
      const oldContent = page.content;
      const newContent = oldContent
        .replace(new RegExp(OLD_URL, 'g'), '')
        .replace(new RegExp(OLD_URL_ALT, 'g'), '');

      if (oldContent !== newContent) {
        await page.update({ content: newContent });
        console.log(`   ✅ Обновлена страница: ${page.title} (${page.id})`);
        totalFixed++;
      }
    }

    // 2. Fix Lessons
    console.log('\n📚 Проверка таблицы lessons...');
    const lessons = await Lesson.findAll({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('content')),
        'LIKE',
        `%${OLD_URL.toLowerCase()}%`
      )
    });

    console.log(`   Найдено уроков: ${lessons.length}`);
    for (const lesson of lessons) {
      const oldContent = lesson.content;
      const newContent = oldContent
        .replace(new RegExp(OLD_URL, 'g'), '')
        .replace(new RegExp(OLD_URL_ALT, 'g'), '');

      if (oldContent !== newContent) {
        await lesson.update({ content: newContent });
        console.log(`   ✅ Обновлен урок: ${lesson.title} (${lesson.id})`);
        totalFixed++;
      }
    }

    // 3. Fix Messages (chat attachments)
    console.log('\n💬 Проверка таблицы messages...');
    const messages = await Message.findAll({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('content')),
        'LIKE',
        `%${OLD_URL.toLowerCase()}%`
      )
    });

    console.log(`   Найдено сообщений: ${messages.length}`);
    for (const message of messages) {
      const oldContent = message.content;
      const newContent = oldContent
        .replace(new RegExp(OLD_URL, 'g'), '')
        .replace(new RegExp(OLD_URL_ALT, 'g'), '');

      if (oldContent !== newContent) {
        await message.update({ content: newContent });
        console.log(`   ✅ Обновлено сообщение: ${message.id}`);
        totalFixed++;
      }
    }

    // 4. Fix MapMarkers (media field is JSONB)
    console.log('\n🗺️  Проверка таблицы map_markers...');
    const markers = await MapMarker.findAll();
    let markersFixed = 0;

    for (const marker of markers) {
      if (marker.media && Array.isArray(marker.media)) {
        let hasChanges = false;
        const newMedia = marker.media.map(item => {
          if (typeof item === 'string' && (item.includes(OLD_URL) || item.includes(OLD_URL_ALT))) {
            hasChanges = true;
            return item
              .replace(new RegExp(OLD_URL, 'g'), '')
              .replace(new RegExp(OLD_URL_ALT, 'g'), '');
          } else if (typeof item === 'object' && item.url) {
            if (item.url.includes(OLD_URL) || item.url.includes(OLD_URL_ALT)) {
              hasChanges = true;
              return {
                ...item,
                url: item.url
                  .replace(new RegExp(OLD_URL, 'g'), '')
                  .replace(new RegExp(OLD_URL_ALT, 'g'), '')
              };
            }
          }
          return item;
        });

        if (hasChanges) {
          await marker.update({ media: newMedia });
          console.log(`   ✅ Обновлен маркер: ${marker.title} (${marker.id})`);
          markersFixed++;
          totalFixed++;
        }
      }
    }
    console.log(`   Найдено маркеров: ${markersFixed}`);

    // 5. Fix DoctorCards (photo field)
    console.log('\n👨‍⚕️ Проверка таблицы doctor_cards...');
    const doctors = await DoctorCard.findAll({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('photo')),
        'LIKE',
        `%${OLD_URL.toLowerCase()}%`
      )
    });

    console.log(`   Найдено карточек врачей: ${doctors.length}`);
    for (const doctor of doctors) {
      const oldPhoto = doctor.photo;
      if (oldPhoto) {
        const newPhoto = oldPhoto
          .replace(new RegExp(OLD_URL, 'g'), '')
          .replace(new RegExp(OLD_URL_ALT, 'g'), '');

        if (oldPhoto !== newPhoto) {
          await doctor.update({ photo: newPhoto });
          console.log(`   ✅ Обновлена карточка врача: ${doctor.fullName} (${doctor.id})`);
          totalFixed++;
        }
      }
    }

    // 6. Fix KanbanTasks (attachments field is JSONB)
    console.log('\n📋 Проверка таблицы kanban_tasks...');
    const tasks = await KanbanTask.findAll();
    let tasksFixed = 0;

    for (const task of tasks) {
      if (task.attachments && Array.isArray(task.attachments)) {
        let hasChanges = false;
        const newAttachments = task.attachments.map(attachment => {
          if (attachment.path && (attachment.path.includes(OLD_URL) || attachment.path.includes(OLD_URL_ALT))) {
            hasChanges = true;
            return {
              ...attachment,
              path: attachment.path
                .replace(new RegExp(OLD_URL, 'g'), '')
                .replace(new RegExp(OLD_URL_ALT, 'g'), '')
            };
          }
          return attachment;
        });

        if (hasChanges) {
          await task.update({ attachments: newAttachments });
          console.log(`   ✅ Обновлена задача: ${task.title} (${task.id})`);
          tasksFixed++;
          totalFixed++;
        }
      }
    }
    console.log(`   Найдено задач: ${tasksFixed}`);

    console.log(`\n✅ Готово! Всего исправлено записей: ${totalFixed}`);

    if (totalFixed === 0) {
      console.log('\n⚠️  Старые URL не найдены в базе данных.');
      console.log('Возможные причины проблемы:');
      console.log('1. Проблема в кэше браузера - попробуйте Ctrl+Shift+R');
      console.log('2. Старые медиа-файлы могут быть в других таблицах');
      console.log('3. Проверьте конфигурацию фронтенда (.env файлы)');
    }

  } catch (error) {
    console.error('❌ Ошибка:', error);
  } finally {
    await sequelize.close();
  }
}

fixMediaUrls();
