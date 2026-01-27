# Журнал изменений страниц (Page History)

## Описание

Система журнализации изменений страниц позволяет отслеживать все модификации страниц wiki, включая информацию о том, кто и когда вносил изменения.

## Функциональность

### Отслеживаемые действия:
- **Создание** (`created`) - когда страница впервые создана
- **Редактирование** (`updated`) - когда страница отредактирована
- **Публикация** (`published`) - когда страница опубликована
- **Снятие публикации** (`unpublished`) - когда публикация отменена

### Отслеживаемые изменения:
- Заголовок страницы
- Содержимое (контент)
- Slug (URL)
- Описание
- Иконка
- Custom CSS/JavaScript
- Папка (перемещение)
- Статус публикации

## Установка

### 1. Запуск миграции базы данных

```bash
cd backend
node scripts/run-migration-page-history.js
```

Миграция создаст:
- Таблицу `page_history` с полями:
  - `id` - UUID записи
  - `pageId` - ID страницы
  - `userId` - ID пользователя, внесшего изменения
  - `action` - тип действия (created/updated/published/unpublished)
  - `changesSummary` - краткое описание изменений
  - `metadata` - дополнительные данные в формате JSON
  - `createdAt` - дата и время изменения

- Индексы для оптимизации:
  - `idx_page_history_page_id`
  - `idx_page_history_user_id`
  - `idx_page_history_created_at`
  - `idx_page_history_action`

### 2. Перезапуск сервера

После выполнения миграции перезапустите backend:

```bash
npm start
# или
node server.js
```

## Использование

### Frontend

#### Просмотр истории изменений

1. Откройте редактор страницы: `/page/{slug}/edit`
2. В шапке редактора нажмите кнопку **"Журнал изменений"** (иконка часов)
3. Откроется модальное окно с историей изменений страницы

В окне истории отображается:
- Аватар и имя пользователя, внесшего изменения
- Тип действия (создание, редактирование, публикация)
- Описание изменений (какие поля были изменены)
- Дата и время изменения

### API

#### Получить историю страницы

```http
GET /api/pages/:id/history
Authorization: Bearer {token}
```

**Ответ:**
```json
[
  {
    "id": "uuid",
    "pageId": "uuid",
    "userId": "uuid",
    "action": "updated",
    "changesSummary": "Изменено: заголовок, содержимое",
    "metadata": {
      "changedFields": ["заголовок", "содержимое"],
      "isPublished": true
    },
    "createdAt": "2024-01-27T12:00:00.000Z",
    "user": {
      "id": "uuid",
      "displayName": "Иван Иванов",
      "username": "ivanov",
      "avatar": "/uploads/avatars/user.jpg"
    }
  }
]
```

### Автоматическая запись

История автоматически записывается при:

1. **Создании страницы** (POST `/api/pages`)
   - Записывает action: `created`
   - Сохраняет информацию о начальных параметрах

2. **Редактировании страницы** (PUT `/api/pages/:id`)
   - Записывает action: `updated`, `published` или `unpublished`
   - Определяет, какие поля были изменены
   - Генерирует описание изменений

## Структура базы данных

### Таблица page_history

```sql
CREATE TABLE page_history (
  id UUID PRIMARY KEY,
  "pageId" UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL,
  "changesSummary" TEXT,
  metadata JSONB DEFAULT '{}',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL
);
```

### Связи

- `page_history.pageId` → `pages.id` (CASCADE DELETE)
- `page_history.userId` → `users.id` (CASCADE DELETE)

При удалении страницы вся история также удаляется.

## Модели Sequelize

### PageHistory Model

```javascript
const PageHistory = sequelize.define('PageHistory', {
  id: { type: DataTypes.UUID, primaryKey: true },
  pageId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  action: {
    type: DataTypes.ENUM('created', 'updated', 'published', 'unpublished'),
    allowNull: false
  },
  changesSummary: { type: DataTypes.TEXT },
  metadata: { type: DataTypes.JSONB, defaultValue: {} }
}, {
  tableName: 'page_history',
  timestamps: true,
  updatedAt: false
});
```

### Связи

```javascript
PageHistory.belongsTo(Page, { foreignKey: 'pageId', as: 'page' });
PageHistory.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Page.hasMany(PageHistory, { foreignKey: 'pageId', as: 'history' });
User.hasMany(PageHistory, { foreignKey: 'userId', as: 'pageHistory' });
```

## Компоненты

### Backend

- **Модель:** `backend/models/index.js` - модель `PageHistory`
- **Роуты:** `backend/routes/pages.js` - endpoint GET `/api/pages/:id/history`
- **Автоматическое отслеживание:** встроено в POST и PUT обработчики `/api/pages`

### Frontend

- **Модальное окно:** `frontend/src/components/PageHistoryModal.js`
- **Стили:** `frontend/src/components/PageHistoryModal.css`
- **Интеграция:** `frontend/src/pages/PageEditor.js` - кнопка "Журнал изменений"
- **API клиент:** `frontend/src/services/api.js` - метод `pages.getHistory(id)`

## Примеры использования

### Программное получение истории

```javascript
import { pages } from './services/api';

// Получить историю страницы
const { data: history } = await pages.getHistory(pageId);

history.forEach(entry => {
  console.log(`${entry.user.displayName} ${entry.action} страницу`);
  console.log(`Изменения: ${entry.changesSummary}`);
  console.log(`Дата: ${new Date(entry.createdAt).toLocaleString()}`);
});
```

### Ручное добавление записи в историю

```javascript
const { PageHistory } = require('./models');

await PageHistory.create({
  pageId: 'uuid-страницы',
  userId: 'uuid-пользователя',
  action: 'updated',
  changesSummary: 'Исправлены опечатки',
  metadata: {
    changedFields: ['содержимое'],
    manual: true
  }
});
```

## Ограничения

1. **Нет версионирования контента** - система НЕ хранит полные версии контента, только информацию о том, что было изменено
2. **Нет отката** - невозможно откатить изменения к предыдущей версии
3. **Простое логирование** - сохраняется только информация "кто, когда и что изменил"

Для полноценного версионирования с возможностью отката потребуется расширение системы.

## Производительность

### Оптимизация запросов

Созданные индексы обеспечивают быструю выборку:
- По ID страницы (основной запрос)
- По ID пользователя (фильтрация по автору)
- По дате (сортировка)
- По типу действия (фильтрация)

### Рекомендации

- История автоматически удаляется при удалении страницы (CASCADE DELETE)
- Для страниц с большим количеством правок можно добавить пагинацию в API
- Рекомендуется периодически архивировать старые записи (> 1 года)

## Безопасность

- Доступ к истории страницы имеют:
  - Администраторы
  - Создатель страницы
  - Пользователи с правами `pages.write`

- История доступна только для аутентифицированных пользователей
- Невозможно редактировать или удалять записи истории (только чтение)

## Troubleshooting

### Таблица не создается

Убедитесь, что:
1. Пользователь БД имеет права CREATE TABLE
2. Таблица `pages` и `users` существуют
3. Нет конфликтующих индексов

### История не записывается

Проверьте:
1. Модель `PageHistory` экспортирована в `backend/models/index.js`
2. Импорт модели в `backend/routes/pages.js`
3. Логи backend на наличие ошибок

### Модальное окно не открывается

Убедитесь, что:
1. Компонент `PageHistoryModal` импортирован в `PageEditor.js`
2. Метод `pages.getHistory()` добавлен в `api.js`
3. Страница имеет `id` (для новых страниц кнопка скрыта)

## Дальнейшее развитие

Возможные улучшения:

1. **Сравнение версий** - показывать diff между версиями
2. **Откат изменений** - возможность восстановить предыдущую версию
3. **Уведомления** - оповещать о важных изменениях
4. **Экспорт истории** - выгрузка в CSV/PDF
5. **Фильтрация** - по пользователю, типу действия, датам
6. **Статистика** - кто чаще всего редактирует страницы

## Поддержка

При возникновении проблем проверьте:
- Логи backend (console)
- Логи frontend (браузерная консоль)
- Наличие миграции в БД: `SELECT * FROM page_history LIMIT 1;`
