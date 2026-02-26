'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('executor_settings', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      misUserId: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true,
        comment: 'ID врача-исполнителя в МИС'
      },
      doctorName: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      settings: {
        type: Sequelize.JSONB,
        defaultValue: {},
        allowNull: false,
        comment: 'Настройки исполнителя: расходники, материалы, оплата, оклад, дополнительно'
      },
      updatedBy: {
        type: Sequelize.UUID,
        allowNull: true
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    await queryInterface.addIndex('executor_settings', ['misUserId'], {
      name: 'executor_settings_mis_user_id_idx',
      unique: true
    });

    console.log('✅ Миграция add-executor-settings выполнена успешно');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('executor_settings');
    console.log('✅ Откат миграции add-executor-settings выполнен успешно');
  }
};
