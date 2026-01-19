# Функциональность Архива Транспортных Средств

## Описание

Добавлена возможность перемещать записи о транспортных средствах в архив без их удаления. Архивные записи скрыты из основной таблицы, но доступны для просмотра на отдельной странице. Также добавлена возможность прикреплять файлы к записям ТС (фото, документы, акты ТО и т.д.).

## Реализованный функционал

### 1. База данных

#### Новое поле в таблице vehicles
- **Новое поле**: `isArchived` (BOOLEAN, по умолчанию `false`)
- **Миграция**: `backend/migrations/add-vehicle-archived.sql`
- **Индекс**: Добавлен индекс на поле `isArchived` для быстрой фильтрации

#### Новая таблица vehicle_files
- **Таблица**: `vehicle_files`
- **Миграция**: `backend/migrations/add-vehicle-files.sql`
- **Поля**:
  - `id` - UUID, первичный ключ
  - `vehicleId` - UUID, внешний ключ на vehicles
  - `filename` - имя файла на сервере
  - `originalName` - оригинальное имя файла
  - `mimeType` - MIME тип файла
  - `size` - размер файла в байтах
  - `path` - путь к файлу на сервере
  - `uploadedBy` - ID пользователя, загрузившего файл
  - `createdAt`, `updatedAt` - временные метки
- **Индексы**: На полях `vehicleId` и `uploadedBy`

### 2. Backend API

#### Новый роут: Архивирование записи
```
PATCH /api/vehicles/:id/archive
```
**Body:**
```json
{
  "isArchived": true  // или false для разархивирования
}
```

#### Обновленный роут: Получение записей
```
GET /api/vehicles?archived=true|false
```
- `archived=false` (по умолчанию) - только активные записи
- `archived=true` - только архивные записи

#### Новые роуты: Управление файлами
```
GET    /api/vehicles/:id/files              - Получить список файлов
POST   /api/vehicles/:id/files              - Загрузить файлы (multipart/form-data)
GET    /api/vehicles/:id/files/:fileId/download - Скачать файл
DELETE /api/vehicles/:id/files/:fileId      - Удалить файл
```

### 3. Frontend

#### Основная страница (`/page/vehicles`)
- **Новая кнопка**: "Файлы" (желтая) в столбце Действия
- **Новая кнопка**: "В архив" (фиолетовая) в столбце Действия
- **Ссылка**: "Архив" в правом верхнем углу для перехода к архиву
- **Фильтрация**: Автоматически показывает только неархивные записи
- **Функции**:
  - Просмотр записей
  - Редактирование
  - Прикрепление/удаление файлов
  - Перемещение в архив
  - Удаление

#### Страница архива (`/page/archive-vehicles`)
- **Новая страница**: `backend/bot/archive-vehicles.html`
- **Режим**: Только чтение (read-only)
- **Фильтрация**: Показывает только архивные записи
- **Кнопки действий**:
  - "Файлы" (просмотр и скачивание, без загрузки новых)
  - "Восстановить из архива" (зеленая кнопка)
  - "Удалить"
- **Ссылка**: "Назад к ТС" для возврата

### 4. Особенности файлов

#### В активных записях
- Можно загружать новые файлы (drag & drop или выбор)
- Можно просматривать и скачивать файлы
- Можно удалять файлы

#### В архиве
- Файлы можно только просматривать и скачивать
- Нельзя загружать новые файлы
- Нельзя удалять существующие файлы
- При восстановлении записи все файлы остаются на месте

#### Поддерживаемые типы файлов
- Изображения: JPEG, PNG, GIF, WebP
- Документы: PDF
- Office: Word (DOC, DOCX), Excel (XLS, XLSX)
- Текстовые файлы: TXT
- Максимальный размер: 50 МБ

#### Кодировка имен файлов
- Правильная обработка русских имен файлов (UTF-8)
- Автоматическая конвертация из latin1 в utf8 при загрузке
- Корректное отображение и скачивание файлов с кириллическими именами

## Использование

### Прикрепление файлов к ТС
1. На странице `/page/vehicles` найдите нужную запись
2. Нажмите кнопку "Файлы" (желтая иконка документа)
3. В открывшемся окне перетащите файлы или нажмите для выбора
4. Файлы автоматически загрузятся и отобразятся в списке
5. Для скачивания нажмите кнопку "Скачать" у нужного файла
6. Для удаления нажмите кнопку "Удалить" и подтвердите

### Перемещение записи в архив
1. На странице `/page/vehicles` найдите нужную запись
2. Нажмите кнопку "В архив" (фиолетовая иконка архива)
3. Подтвердите действие
4. Запись исчезнет из основной таблицы

### Просмотр архива
1. На странице `/page/vehicles` нажмите кнопку "Архив" в верхнем правом углу
2. Откроется страница `/page/archive-vehicles` со всеми архивными записями
3. Доступна фильтрация по состоянию и поиск

### Восстановление записи из архива
1. На странице `/page/archive-vehicles` найдите нужную запись
2. Нажмите кнопку "Восстановить из архива" (зеленая иконка)
3. Подтвердите действие
4. Запись вернется в основную таблицу со всеми файлами

### Удаление записи из архива
1. На странице `/page/archive-vehicles` найдите нужную запись
2. Нажмите кнопку "Удалить" (красная иконка корзины)
3. Подтвердите действие
4. Запись будет удалена навсегда вместе со всеми файлами

## Установка

1. Запустите скрипт миграции базы данных:
```bash
cd backend
node scripts/addVehicleArchivedAndFiles.js
```

2. Перезапустите сервер:
```bash
npm run dev
```

3. Обновите страницы в браузере (Ctrl+F5)

## Технические детали

### Модель Vehicle (backend/models/index.js)
```javascript
isArchived: {
  type: DataTypes.BOOLEAN,
  defaultValue: false,
  comment: 'Запись перенесена в архив'
}
```

### Модель VehicleFile (backend/models/index.js)
```javascript
const VehicleFile = sequelize.define('VehicleFile', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  vehicleId: { type: DataTypes.UUID, allowNull: false },
  filename: { type: DataTypes.STRING(255), allowNull: false },
  originalName: { type: DataTypes.STRING(255), allowNull: false },
  mimeType: { type: DataTypes.STRING(100) },
  size: { type: DataTypes.INTEGER },
  path: { type: DataTypes.STRING(1000), allowNull: false },
  uploadedBy: { type: DataTypes.UUID }
}, {
  tableName: 'vehicle_files',
  timestamps: true
});
```

### API роут архивации (backend/routes/vehicles.js)
```javascript
router.patch('/:id/archive', authenticate, async (req, res) => {
  const isArchived = req.body.isArchived !== undefined
    ? req.body.isArchived
    : !vehicle.isArchived;
  await vehicle.update({ isArchived });
  res.json(vehicle);
});
```

### Frontend функция архивации (vehicles.html)
```javascript
function archiveVehicle(id) {
  if (!confirm('Переместить запись в архив?')) return;
  fetchAPI(API_URL + '/' + id + '/archive', {
    method: 'PATCH',
    body: JSON.stringify({ isArchived: true })
  }).then(() => {
    showToast('Перенесено в архив', 'success');
    loadData();
  });
}
```

### Frontend функция восстановления (archive-vehicles.html)
```javascript
function restoreVehicle(id) {
  if (!confirm('Восстановить запись из архива?')) return;
  fetchAPI(API_URL + '/' + id + '/archive', {
    method: 'PATCH',
    body: JSON.stringify({ isArchived: false })
  }).then(() => {
    showToast('Восстановлено из архива', 'success');
    loadData();
  });
}
```

### Загрузка файлов (vehicles.html)
```javascript
function uploadFiles(event) {
  var files = event.target.files;
  var formData = new FormData();
  for (var i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  fetch(API_URL + '/' + vehicleId + '/files', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + getToken() },
    body: formData
  }).then(/* ... */);
}
```

## Цветовая схема кнопок

- **Файлы** (желтая): `#fef3c7` / `#d97706`
- **Редактировать** (синяя): `#dbeafe` / `#2563eb`
- **В архив** (фиолетовая): `#e0e7ff` / `#6366f1`
- **Восстановить** (зеленая): `#d1fae5` / `#059669`
- **Удалить** (красная): `#fee2e2` / `#dc2626`

## Структура файлов

```
backend/
├── bot/
│   ├── vehicles.html              # Основная страница ТС (с файлами и архивом)
│   └── archive-vehicles.html      # Страница архива (read-only)
├── migrations/
│   ├── add-vehicle-archived.sql   # Добавление поля isArchived
│   └── add-vehicle-files.sql      # Создание таблицы vehicle_files
├── models/
│   └── index.js                   # Модели Vehicle и VehicleFile
├── routes/
│   └── vehicles.js                # API endpoints (архив + файлы)
├── scripts/
│   └── addVehicleArchivedAndFiles.js  # Скрипт миграции
└── uploads/
    └── vehicles/                  # Директория для загруженных файлов
```

## Примечания

- Архивные записи не участвуют в напоминаниях о истечении страховки и ТО
- Поисковый индекс сохраняется для архивных записей
- При восстановлении запись сохраняет все свои данные и файлы
- Статистика на основной странице не учитывает архивные записи
- Файлы хранятся в директории `uploads/vehicles/`
- При удалении записи все связанные файлы удаляются автоматически (CASCADE)
- Файлы физически удаляются с диска при удалении записи или файла
