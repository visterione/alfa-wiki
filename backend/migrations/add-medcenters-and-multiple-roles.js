/**
 * Миграция: Добавление медицинских центров и множественных ролей для пользователей
 *
 * Описание:
 * 1. Создаёт таблицу med_centers с 6 медцентрами (Альфа, Кидс, Проф, Линия, Смайл, 3К)
 * 2. Создаёт связующую таблицу user_med_centers (many-to-many)
 * 3. Создаёт связующую таблицу user_roles (many-to-many для множественных ролей)
 * 4. Мигрирует существующие данные из users.roleId в новую таблицу user_roles
 *
 * Запуск: node backend/migrations/add-medcenters-and-multiple-roles.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize, MedCenter, UserMedCenter, UserRole, User } = require('../models');

async function migrate() {
  try {
    console.log('🚀 Начало миграции: медцентры и множественные роли');

    // 1. Создаём таблицы (если они ещё не существуют)
    await sequelize.sync({ alter: false });
    console.log('✅ Таблицы синхронизированы');

    // 2. Проверяем, есть ли уже данные в med_centers
    const existingMedCenters = await MedCenter.count();

    if (existingMedCenters === 0) {
      // 3. Добавляем 6 медицинских центров
      const medCenters = [
        { name: 'Альфа', displayName: 'МЦ Альфа', description: 'Медицинский центр Альфа' },
        { name: 'Кидс', displayName: 'МЦ Кидс', description: 'Детский медицинский центр' },
        { name: 'Проф', displayName: 'МЦ Проф', description: 'Медицинский центр Профосмотров' },
        { name: 'Линия', displayName: 'МЦ Линия', description: 'Медицинский центр Линия' },
        { name: 'Смайл', displayName: 'МЦ Смайл', description: 'Стоматология Смайл' },
        { name: '3К', displayName: 'МЦ 3К', description: 'Медицинский центр 3К' }
      ];

      await MedCenter.bulkCreate(medCenters);
      console.log('✅ Добавлено 6 медицинских центров');
    } else {
      console.log('ℹ️  Медцентры уже существуют, пропускаем');
    }

    // 4. Мигрируем существующие роли пользователей в новую таблицу user_roles
    const usersWithRoles = await User.findAll({
      where: {
        roleId: { [sequelize.Sequelize.Op.ne]: null }
      },
      attributes: ['id', 'roleId']
    });

    console.log(`📊 Найдено ${usersWithRoles.length} пользователей с ролями для миграции`);

    for (const user of usersWithRoles) {
      // Проверяем, не мигрирована ли уже эта роль
      const existing = await UserRole.findOne({
        where: { userId: user.id, roleId: user.roleId }
      });

      if (!existing) {
        await UserRole.create({
          userId: user.id,
          roleId: user.roleId
        });
        console.log(`  ✓ Мигрирована роль для пользователя ${user.id}`);
      } else {
        console.log(`  ℹ️  Роль для пользователя ${user.id} уже мигрирована`);
      }
    }

    console.log('✅ Миграция ролей завершена');

    // 5. Опционально: можно удалить поле roleId из таблицы users в будущем
    // Пока оставляем для обратной совместимости
    console.log('ℹ️  Поле users.roleId сохранено для обратной совместимости');

    console.log('');
    console.log('🎉 Миграция успешно завершена!');
    console.log('');
    console.log('Следующие шаги:');
    console.log('1. Обновите код приложения для работы с новыми таблицами');
    console.log('2. Протестируйте назначение медцентров и ролей пользователям');
    console.log('3. После проверки можно удалить поле users.roleId из схемы');

  } catch (error) {
    console.error('❌ Ошибка миграции:', error);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Запуск миграции
migrate();
