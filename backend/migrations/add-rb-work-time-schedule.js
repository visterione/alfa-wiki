'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const cols = [
      ['tabWorkTime',       'Учёт рабочего времени'],
      ['tabSchedule',       'Расписание'],
      ['tabArchiveHistory', 'Архив (под-вкладка)'],
      ['tabArchiveKassa',   'Касса'],
      ['tabArchiveTabel',   'Табели'],
    ];
    for (const [name, comment] of cols) {
      await queryInterface.addColumn('rb_user_permissions', name, {
        type: Sequelize.STRING(10),
        defaultValue: 'edit',
        allowNull: false,
        comment: `Доступ: ${comment} — edit / read / block`,
      });
    }
    console.log('Migration add-rb-work-time-schedule completed');
  },

  down: async (queryInterface) => {
    for (const name of ['tabWorkTime', 'tabSchedule', 'tabArchiveHistory', 'tabArchiveKassa', 'tabArchiveTabel']) {
      await queryInterface.removeColumn('rb_user_permissions', name);
    }
    console.log('Rollback add-rb-work-time-schedule completed');
  }
};
