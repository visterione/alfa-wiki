# Глава 12. Диагностика и устранение неполадок

Эта глава — справочник по типичным проблемам: что пошло не так, где смотреть, как починить.

---

## Инструменты диагностики

Прежде чем искать проблему — нужно знать где смотреть.

### PM2 логи — первое место

```bash
# Смотреть логи в реальном времени
pm2 logs alfa-wiki

# Последние N строк ошибок
pm2 logs alfa-wiki --err --lines 100

# Только вывод (console.log)
pm2 logs alfa-wiki --out --lines 50

# Логи в файлах
cat logs/pm2-error.log | tail -100
cat logs/pm2-out.log | tail -100
```

Что искать в логах:
- `Error:` или `TypeError:` — исключения в коде
- `SequelizeConnectionError` — проблемы с БД
- `EADDRINUSE` — порт занят
- `Cannot find module` — не установлена зависимость
- HTTP-запросы через morgan: метод, путь, код ответа, время

### Health check

```bash
curl http://192.168.22.39:9001/api/health
# Должен вернуть: {"status":"ok","uptime":...}

# Если недоступен — сервер не запущен или порт занят
```

### Браузерные DevTools

**Network вкладка** — видны все HTTP-запросы:
- Красные запросы — ошибки (4xx, 5xx)
- Время ответа — если > 3 сек, что-то медленно
- Headers — проверить Authorization заголовок
- Response — тело ответа с ошибкой

**Console вкладка** — JavaScript ошибки в браузере:
- `Uncaught TypeError` — ошибка в React коде
- `Failed to fetch` — проблемы с запросом к API
- `Warning: ...` — React предупреждения (не критичны, но сигнал)

**Application вкладка** → Local Storage:
- Проверить наличие `token` ключа
- `user` — текущий пользователь (JSON)

---

## Проблемы при запуске сервера

### Порт уже занят

```
Error: listen EADDRINUSE: address already in use :::9001
```

**Причина:** Другой процесс занял порт 9001. Обычно — предыдущая копия сервера.

**Решение:**
```bash
# Найти процесс на порту
lsof -i :9001
# или
netstat -tlpn | grep 9001

# Убить процесс (замени PID на реальный)
kill -9 <PID>

# Или через PM2
pm2 delete all
pm2 start ecosystem.config.js --env production
```

### Cannot find module

```
Error: Cannot find module 'some-package'
```

**Причина:** Пакет не установлен. Обычно появляется после `git pull` если кто-то добавил новую зависимость.

**Решение:**
```bash
cd backend && npm install
# или
cd frontend && npm install
```

Проверить что пакет добавлен в `package.json`:
```bash
cat backend/package.json | grep "some-package"
```

### Ошибка подключения к БД

```
SequelizeConnectionError: connect ECONNREFUSED 127.0.0.1:5432
```

**Причина:** PostgreSQL не запущен.

**Решение:**
```bash
# Проверить статус
systemctl status postgresql

# Запустить
systemctl start postgresql

# Включить автозапуск
systemctl enable postgresql
```

```
SequelizeAccessDeniedError: password authentication failed for user "postgres"
```

**Причина:** Неверный пароль в `.env`.

**Решение:** Проверить `DB_PASSWORD` в `backend/.env`. Попробовать подключиться вручную:
```bash
psql -U postgres -d alfa_wiki -c "SELECT 1"
```

### Sequelize ошибка при старте

```
SequelizeDatabaseError: column "some_column" does not exist
```

**Причина:** Код ожидает колонку, которой нет в БД. Забыли применить миграцию.

**Решение:**
```bash
# Посмотреть какие миграции есть
ls backend/migrations/ | sort

# Применить пропущенную
psql -U postgres -d alfa_wiki -f "backend/migrations/название-миграции.sql"
```

---

## Проблемы с API

### 401 Unauthorized

Запрос вернул 401. Три причины:

1. **Токен не передан** — проверить в DevTools → Network → Headers → Authorization
2. **Токен истёк** — прошло более 12 часов. Решение: перелогиниться
3. **Токен невалиден** — если изменился `JWT_SECRET` в `.env`. Все пользователи разлогинены.

```bash
# Проверить что JWT_SECRET задан
grep JWT_SECRET backend/.env
```

### 403 Forbidden

Пользователь авторизован, но нет прав.

Диагностика в DevTools:
```
Response: { "error": "Нет доступа к разделу: reviews" }
```

Решение:
- `/admin/users` → найти пользователя → проверить `adminAccess.reviews`
- Или пользователь не имеет нужной роли

### 404 Not Found

```
Response: { "error": "Запись не найдена" }
```

Запись удалена или ID неверный. Проверить URL запроса.

### 500 Internal Server Error

Ошибка на сервере. Смотреть логи:
```bash
pm2 logs alfa-wiki --err --lines 20
```

Типичные причины в логах:
- `SequelizeUniqueConstraintError` — попытка создать дубликат уникального поля
- `SequelizeValidationError` — невалидные данные (например, NULL в NOT NULL поле)
- `TypeError: Cannot read property 'X' of undefined` — код обратился к undefined

### CORS ошибка в браузере

```
Access to XMLHttpRequest at 'http://...' from origin 'http://...' has been blocked by CORS policy
```

**Причина:** Backend не разрешает запросы с этого origin.

В `server.js` проверить:
```js
app.use(cors({
  origin: true,  // Разрешить все (или список доменов)
  credentials: true
}));
```

Убедиться что `cors()` зарегистрирован **до** маршрутов.

---

## Проблемы с базой данных

### Медленные запросы

Симптом: API отвечает > 2-3 секунд.

Диагностика:
```sql
-- Включить логирование медленных запросов PostgreSQL
ALTER SYSTEM SET log_min_duration_statement = 500;  -- > 500ms
SELECT pg_reload_conf();

-- Посмотреть медленные запросы
SELECT query, calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

Решение — добавить индекс на часто запрашиваемое поле:
```sql
-- Найти поле по которому часто фильтруем
-- Пример: часто запрашиваем reviews по board_id + status
CREATE INDEX CONCURRENTLY idx_reviews_board_status 
ON reviews(board_id, status) 
WHERE deleted_at IS NULL;  -- Partial index — только для не удалённых
```

### Таблица выросла слишком сильно

```sql
-- Посмотреть размер таблиц
SELECT
  relname AS table,
  pg_size_pretty(pg_relation_size(oid)) AS size,
  n_live_tup AS rows
FROM pg_class
JOIN pg_stat_user_tables ON relname = relname
WHERE relkind = 'r'
ORDER BY pg_relation_size(oid) DESC;
```

Кандидаты на очистку:
- `messages` — старые сообщения
- `page_history` — давние версии страниц
- `bot_updates` — обработанные обновления ботов
- `email_logs` — история рассылок

```sql
-- Удалить старые обработанные bot_updates
DELETE FROM bot_updates
WHERE processed = true AND created_at < NOW() - INTERVAL '30 days';

-- Удалить историю страниц старше года (осторожно!)
DELETE FROM page_history
WHERE created_at < NOW() - INTERVAL '1 year';
```

### Lock / блокировки таблиц

Симптом: запросы "зависают" и не отвечают.

```sql
-- Посмотреть активные блокировки
SELECT pid, query, state, wait_event_type, wait_event
FROM pg_stat_activity
WHERE state != 'idle';

-- Убить зависший запрос
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND query_start < NOW() - INTERVAL '5 minutes';
```

---

## Проблемы с Frontend

### Белый экран после деплоя

Причина: Браузер загрузил старый JavaScript бандл из кэша, но API вернуло данные в новом формате.

```bash
# В браузере: Ctrl+Shift+R (hard refresh)
# Или: F12 → Network → Disable cache → Обновить
```

Для Tauri-приложения: Файл → Перезапустить приложение.

### "Cannot read property of undefined" в консоли

Компонент пытается отрендерить данные до их загрузки.

Типичный код с ошибкой:
```jsx
function UserProfile({ userId }) {
  const [user, setUser] = useState(null);  // null изначально
  
  useEffect(() => {
    api.users.getById(userId).then(setUser);
  }, [userId]);
  
  // ОШИБКА: user === null, user.displayName → Cannot read property
  return <h1>{user.displayName}</h1>;
}
```

Решение — проверять наличие данных:
```jsx
if (!user) return <div>Загрузка...</div>;
return <h1>{user.displayName}</h1>;

// Или optional chaining
return <h1>{user?.displayName}</h1>;
```

### Socket.IO не подключается

Симптом: уведомления и чат не работают в реальном времени.

Проверки:
1. **DevTools → Network → WS** — есть ли WebSocket соединение?
2. **Console** — ошибки Socket.IO?

```js
// Добавить временно для диагностики в браузере
socket.on('connect', () => console.log('Socket connected:', socket.id));
socket.on('connect_error', (err) => console.error('Socket error:', err));
socket.on('disconnect', (reason) => console.log('Socket disconnected:', reason));
```

Типичные причины:
- **Неверный URL** — проверить `SOCKET_URL` в SocketContext
- **Токен не передан** — проверить `auth: { token }` при создании соединения
- **CORS на сервере** — для WebSocket тоже нужен CORS
- **Nginx блокирует** — если стоит nginx как прокси, нужна специальная конфигурация для WebSocket

### Страница не реагирует на действия (кнопки не работают)

Проверить Console в DevTools — скорее всего ошибка в обработчике.

Частая причина: отправка формы перезагружает страницу из-за отсутствия `e.preventDefault()`:

```jsx
// ПЛОХО — при submit страница перезагружается
const handleSubmit = async () => {
  await api.create(data);
};

<form onSubmit={handleSubmit}>

// ХОРОШО
const handleSubmit = async (e) => {
  e.preventDefault();  // Предотвратить стандартное поведение формы
  await api.create(data);
};
```

---

## Проблемы с файлами

### Файл не загружается (413 Request Entity Too Large)

```bash
# Проверить лимит в .env
grep MAX_FILE_SIZE backend/.env
# Должно быть: MAX_FILE_SIZE=52428800 (50 MB)

# В server.js проверить:
app.use(express.json({ limit: '10gb' }));
```

Если стоит nginx перед Node.js:
```nginx
client_max_body_size 100m;
```

### Файлы недоступны по URL

Путь в БД: `2026-04/image-abc.jpg`
URL должен быть: `http://192.168.22.39:9001/2026-04/image-abc.jpg`

Проверить что `express.static('./uploads')` зарегистрирован в `server.js`.

Проверить что файл физически существует:
```bash
ls backend/uploads/2026-04/image-abc.jpg
```

### Права доступа к папке uploads

```bash
# Если Node.js не может записать в uploads
ls -la backend/uploads/
# Должна быть запись для пользователя который запускает Node.js

# Исправить права
chown -R www-data:www-data backend/uploads/
chmod -R 755 backend/uploads/
```

---

## Проблемы с Telegram

### Бот не отвечает на команды

```bash
# Проверить что токен задан
grep TELEGRAM_BOT_TOKEN backend/.env

# Проверить логи на ошибки инициализации
pm2 logs alfa-wiki | grep -i telegram
pm2 logs alfa-wiki | grep -i bot
```

Частая ошибка: `ETELEGRAM: 401 Unauthorized` — неверный токен.

### Уведомления не приходят в Telegram

Проверить что пользователь подписан:
```sql
SELECT * FROM telegram_subscribers WHERE chat_id = 'ваш_chat_id';
-- is_active должен быть true
-- subscribed_to_accreditations / subscribed_to_vehicles — нужный флаг
```

---

## Проблемы с Email (2FA)

### Код 2FA не приходит

```bash
# Проверить настройки SMTP
grep SMTP backend/.env

# Проверить логи на ошибки
pm2 logs alfa-wiki | grep -i smtp
pm2 logs alfa-wiki | grep -i email
pm2 logs alfa-wiki | grep -i nodemailer
```

Типичная ошибка: `ECONNREFUSED mail.medcentralfa.ru:465` — почтовый сервер недоступен.

Тест SMTP из терминала:
```bash
# Проверить доступность почтового сервера
telnet mail.medcentralfa.ru 465
# Должно установить соединение
```

### Письма попадают в спам

- Проверить SPF/DKIM/DMARC записи для домена
- Убедиться что `SMTP_FROM` совпадает с аутентифицированным аккаунтом

---

## Резервное восстановление

### Восстановление из бэкапа

```bash
# 1. Остановить сервер
pm2 stop alfa-wiki

# 2. Распаковать бэкап
cd /tmp
unzip /path/to/backup_2026-04-15.zip

# 3. Восстановить БД
# ВНИМАНИЕ: удалит все текущие данные!
psql -U postgres -c "DROP DATABASE alfa_wiki;"
psql -U postgres -c "CREATE DATABASE alfa_wiki;"
psql -U postgres -d alfa_wiki -f /tmp/alfa_wiki.sql

# 4. Восстановить файлы
cp -r /tmp/uploads/* backend/uploads/

# 5. Запустить сервер
pm2 start alfa-wiki
```

### Экстренный сброс пароля администратора

Если потерян пароль и нет другого администратора:

```bash
# Сгенерировать новый хэш для пароля 'newpassword'
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('newpassword', 10).then(console.log)"

# Обновить в БД
psql -U postgres -d alfa_wiki -c "
UPDATE users 
SET password = '\$2a\$10\$...' 
WHERE username = 'admin';
"
```

---

## Диагностика производительности

### Почему страница грузится медленно

**Метод 1: DevTools Network**

F12 → Network → перезагрузить страницу. Посмотреть:
- Waterfall — порядок загрузки ресурсов
- Самый долгий запрос — что именно тормозит
- Response preview — что сервер возвращает

**Метод 2: Логирование на сервере**

Временно включить логирование времени SQL-запросов:
```js
// В models/index.js, в Sequelize config
logging: (sql, timing) => {
  if (timing > 200) {  // Логировать запросы > 200ms
    console.log(`SLOW QUERY (${timing}ms):`, sql);
  }
}
```

**Метод 3: EXPLAIN ANALYZE**

```sql
EXPLAIN ANALYZE
SELECT * FROM reviews
WHERE board_id = 'uuid'
  AND status = 'new'
  AND deleted_at IS NULL
ORDER BY sort_order;
```

Смотреть на `Seq Scan` (последовательный просмотр всей таблицы) — признак отсутствия индекса. `Index Scan` — хорошо.

### Memory usage растёт

```bash
pm2 monit  # Смотреть RSS memory column
```

Если память растёт постоянно без падения — утечка памяти. Быстрое решение: перезапуск по расписанию.

```js
// В ecosystem.config.js
cron_restart: '0 4 * * *'  // Перезапускать каждую ночь в 4:00
```

Правильное решение: найти источник утечки через Node.js профилировщик (более сложная задача).

---

## Полезные SQL запросы для диагностики

```sql
-- Кто последний раз заходил
SELECT username, display_name, last_login, last_seen
FROM users
WHERE is_active = true
ORDER BY last_login DESC NULLS LAST
LIMIT 20;

-- Самые активные пользователи чата (по количеству сообщений)
SELECT u.display_name, COUNT(m.id) as message_count
FROM messages m
JOIN users u ON m.sender_id = u.id
WHERE m.created_at > NOW() - INTERVAL '30 days'
GROUP BY u.id, u.display_name
ORDER BY message_count DESC
LIMIT 10;

-- Размер каждой таблицы
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size('public.'||tablename)) AS total_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('public.'||tablename) DESC;

-- Незакрытые соединения с БД
SELECT pid, usename, application_name, state, query_start
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY query_start;

-- Последние ошибки из email_logs
SELECT subject, status, error_details, sent_at
FROM email_logs
WHERE status IN ('failed', 'partial')
ORDER BY sent_at DESC
LIMIT 20;

-- Сколько отзывов по каждому статусу
SELECT board_id, status, COUNT(*) as count
FROM reviews
WHERE deleted_at IS NULL AND archived = false
GROUP BY board_id, status
ORDER BY board_id, status;
```

---

## Быстрые исправления (Quick Fixes)

### Пользователь не может войти

```sql
-- Проверить статус
SELECT is_active, two_factor_enabled, two_factor_attempts FROM users WHERE username = 'имя';

-- Разблокировать 2FA (слишком много попыток)
UPDATE users SET two_factor_attempts = 0, two_factor_code = NULL WHERE username = 'имя';

-- Активировать пользователя
UPDATE users SET is_active = true WHERE username = 'имя';
```

### Сбросить незакрытую транзакцию в БД

```sql
-- Найти зависшие транзакции
SELECT pid, query, state, query_start
FROM pg_stat_activity
WHERE state = 'idle in transaction';

-- Завершить
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
WHERE state = 'idle in transaction';
```

### Принудительно переиндексировать поиск

```bash
# Через API (нужен токен администратора)
curl -X POST http://localhost:9001/api/search/index \
  -H "Authorization: Bearer <токен>"
```

### Очистить старые cron-флаги аккредитаций

Если нужно повторно отправить напоминания (например, после сбоя):

```sql
-- Сбросить флаги напоминаний для конкретной аккредитации
UPDATE accreditations
SET reminded90 = false, reminded60 = false, reminded30 = false,
    reminded14 = false, reminded7 = false
WHERE id = 'uuid-аккредитации';

-- Или для всех (cron отправит снова при следующем запуске)
UPDATE accreditations
SET reminded7 = false
WHERE expiration_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'
  AND reminded7 = true;
```
