'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('rb_user_permissions', 'tabSummary', {
      type: Sequelize.STRING(10),
      defaultValue: 'edit',
      allowNull: false,
      comment: 'Доступ к вкладке Сводка: edit / read / block'
    });
    console.log('Migration add-rb-tab-summary completed');
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('rb_user_permissions', 'tabSummary');
    console.log('Rollback add-rb-tab-summary completed');
  }
};
