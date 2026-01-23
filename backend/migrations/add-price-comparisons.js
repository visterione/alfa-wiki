'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Создаем таблицу price_comparisons
    await queryInterface.createTable('price_comparisons', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Название сравнения'
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Описание сравнения'
      },
      createdBy: {
        type: Sequelize.UUID,
        allowNull: true,
        comment: 'ID пользователя-создателя',
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      competitors: {
        type: Sequelize.JSONB,
        defaultValue: [],
        allowNull: false,
        comment: 'Массив названий конкурентов'
      },
      ownMedCenters: {
        type: Sequelize.JSONB,
        defaultValue: [],
        allowNull: false,
        comment: 'Массив своих медцентров'
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

    // Создаем таблицу price_comparison_items
    await queryInterface.createTable('price_comparison_items', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      comparisonId: {
        type: Sequelize.UUID,
        allowNull: false,
        comment: 'ID сравнения',
        references: {
          model: 'price_comparisons',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      serviceCode: {
        type: Sequelize.STRING(100),
        allowNull: false,
        comment: 'Артикул услуги'
      },
      serviceName: {
        type: Sequelize.STRING(500),
        allowNull: false,
        comment: 'Название услуги'
      },
      misServiceId: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'ID услуги в МИС'
      },
      prices: {
        type: Sequelize.JSONB,
        defaultValue: {},
        allowNull: false,
        comment: 'Объект с ценами по медцентрам'
      },
      sortOrder: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
        allowNull: false,
        comment: 'Порядок сортировки'
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

    // Создаем индексы для быстрого поиска
    await queryInterface.addIndex('price_comparisons', ['createdBy'], {
      name: 'price_comparisons_created_by_idx'
    });

    await queryInterface.addIndex('price_comparison_items', ['comparisonId'], {
      name: 'price_comparison_items_comparison_id_idx'
    });

    await queryInterface.addIndex('price_comparison_items', ['serviceCode'], {
      name: 'price_comparison_items_service_code_idx'
    });

    console.log('✅ Миграция add-price-comparisons выполнена успешно');
  },

  down: async (queryInterface, Sequelize) => {
    // Удаляем таблицы в обратном порядке (сначала зависимую)
    await queryInterface.dropTable('price_comparison_items');
    await queryInterface.dropTable('price_comparisons');

    console.log('✅ Откат миграции add-price-comparisons выполнен успешно');
  }
};
