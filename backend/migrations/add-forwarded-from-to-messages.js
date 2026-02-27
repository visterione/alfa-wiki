'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('messages', 'forwardedFrom', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: null,
      comment: 'Данные о пересланном сообщении: { senderId, senderName, originalChatId }'
    });

    console.log('✅ Миграция add-forwarded-from-to-messages выполнена успешно');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('messages', 'forwardedFrom');
    console.log('✅ Откат миграции add-forwarded-from-to-messages выполнен успешно');
  }
};
