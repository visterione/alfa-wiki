# Инструкция по установке функции прикрепления файлов к аккредитациям

## Описание

Добавлена функциональность прикрепления файлов (документов) к записям об аккредитациях. Теперь можно:

- Прикреплять несколько файлов к каждой записи аккредитации
- Просматривать список прикрепленных файлов
- Скачивать файлы
- Удалять файлы
- Загружать файлы через drag-and-drop или выбор файлов

## Установка

### 1. Применить миграцию базы данных

**Простой способ (рекомендуется):**

```bash
node scripts/migrateAccreditationFiles.js
```

**Альтернативный способ через psql:**

```bash
psql -U postgres -d alfa_wiki -f migrations/add-accreditation-files.sql
```

Или выполните команду напрямую:

```sql
psql -U postgres -d alfa_wiki
```

Затем скопируйте и выполните содержимое файла `migrations/add-accreditation-files.sql`

### 2. Проверить зависимости

Пакет `multer` уже установлен в проекте. Если нет, установите:

```bash
npm install multer
```

### 3. Перезапустить сервер

```bash
npm run dev
# или
node server.js
```

### 4. Проверить работу

1. Откройте страницу аккредитаций в браузере
2. В столбце "Действия" появилась новая кнопка "Файлы" (желтая)
3. Нажмите на кнопку "Файлы" у любой записи
4. Откроется модальное окно для управления файлами
5. Загрузите файлы через drag-and-drop или кнопку выбора
6. Попробуйте скачать и удалить файлы

## Поддерживаемые типы файлов

- Изображения: JPEG, PNG, GIF, WebP
- Документы: PDF, Word (.doc, .docx), Excel (.xls, .xlsx)
- Текстовые файлы: .txt

Максимальный размер файла: 50MB (настраивается в `.env` через `MAX_FILE_SIZE`)

## API Endpoints

### Получить список файлов аккредитации
```
GET /api/accreditations/:id/files
```

### Загрузить файл(ы)
```
POST /api/accreditations/:id/files
Content-Type: multipart/form-data
Body: files[] (до 10 файлов)
```

### Скачать файл
```
GET /api/accreditations/:id/files/:fileId/download
```

### Удалить файл
```
DELETE /api/accreditations/:id/files/:fileId
```

## Структура папок

Файлы сохраняются в:
```
backend/uploads/accreditations/
```

Имена файлов генерируются автоматически в формате:
```
accred-{timestamp}-{random}.{ext}
```

## Безопасность

- Все эндпоинты защищены аутентификацией (требуется Bearer token)
- Проверка типов файлов на стороне сервера
- Ограничение размера файлов
- Автоматическое удаление файлов при удалении записи аккредитации

## Изменения в файлах

### Новые файлы:
- `backend/migrations/add-accreditation-files.sql` - SQL миграция
- `backend/ACCREDITATION_FILES_SETUP.md` - эта инструкция

### Изменённые файлы:
- `backend/models/index.js` - добавлена модель AccreditationFile
- `backend/routes/accreditations.js` - добавлены роуты для работы с файлами
- `backend/bot/accreditations.html` - обновлён UI и JS для работы с файлами

## Troubleshooting

### Ошибка "File too large"
Увеличьте `MAX_FILE_SIZE` в файле `.env`:
```
MAX_FILE_SIZE=104857600  # 100MB
```

### Файлы не загружаются
Проверьте права доступа к папке:
```bash
chmod 755 backend/uploads/accreditations
```

### Таблица не создалась
Убедитесь, что вы подключены к правильной базе данных и выполняете миграцию от имени пользователя с правами CREATE TABLE.
