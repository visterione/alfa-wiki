'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('rb_user_permissions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        comment: 'ID пользователя wiki'
      },
      clinics: {
        type: Sequelize.ARRAY(Sequelize.STRING),
        defaultValue: [],
        allowNull: false,
        comment: 'Список ID медцентров, которые видит пользователь (пусто = все)'
      },
      tab1: {
        type: Sequelize.STRING(10),
        defaultValue: 'edit',
        allowNull: false,
        comment: 'Доступ к вкладке Врачи: edit / read / block'
      },
      tab2: {
        type: Sequelize.STRING(10),
        defaultValue: 'edit',
        allowNull: false,
        comment: 'Доступ к вкладке Выполненные услуги: edit / read / block'
      },
      tab3: {
        type: Sequelize.STRING(10),
        defaultValue: 'edit',
        allowNull: false,
        comment: 'Доступ к вкладке Бонусы за направления: edit / read / block'
      },
      tab4: {
        type: Sequelize.STRING(10),
        defaultValue: 'edit',
        allowNull: false,
        comment: 'Доступ к вкладке Отчёт: edit / read / block'
      },
      tabArchive: {
        type: Sequelize.STRING(10),
        defaultValue: 'edit',
        allowNull: false,
        comment: 'Доступ к вкладке Архив: edit / read / block'
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

    await queryInterface.addIndex('rb_user_permissions', ['userId'], {
      name: 'rb_user_permissions_user_id_idx',
      unique: true
    });

    console.log('Migration add-rb-user-permissions completed');
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('rb_user_permissions');
    console.log('Rollback add-rb-user-permissions completed');
  }
};
