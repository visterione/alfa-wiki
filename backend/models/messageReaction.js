module.exports = (sequelize, DataTypes) => {
  const MessageReaction = sequelize.define('MessageReaction', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    messageId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'messageId',
      references: {
        model: 'messages',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'userId',
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    emoji: {
      type: DataTypes.STRING(10),
      allowNull: false,
      validate: {
        isIn: {
          args: [['👍', '👎', '❤️', '😂', '😮', '🎉', '🔥']],
          msg: 'Недопустимая реакция. Разрешены только: 👍 👎 ❤️ 😂 😮 🎉 🔥'
        }
      }
    }
  }, {
    tableName: 'message_reactions',
    timestamps: true,
    indexes: [
      {
        fields: ['messageId']
      },
      {
        fields: ['userId']
      },
      {
        unique: true,
        fields: ['messageId', 'userId'],
        name: 'unique_user_message_reaction'
      }
    ]
  });

  MessageReaction.associate = (models) => {
    MessageReaction.belongsTo(models.Message, {
      foreignKey: 'messageId',
      as: 'message'
    });

    MessageReaction.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user'
    });
  };

  return MessageReaction;
};
