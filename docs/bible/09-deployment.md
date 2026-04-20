# Глава 9. Деплой и инфраструктура

Эта глава — о том как проект живёт в production: как запускается, как обновляется, как мониторится, что делать при сбоях.

---

## Общая картина production-среды

```
Сервер: 192.168.22.39 (в локальной сети медцентра)
ОС: Linux (предположительно Ubuntu/Debian)

Что работает:
  ├── PostgreSQL :5432         — база данных
  ├── Node.js (через PM2) :9001 — backend + frontend статика
  └── (опционально) nginx      — если нужен SSL/прокси
  
Доступ:
  ├── Из локальной сети        — напрямую http://192.168.22.39:9001
  └── Извне                    — через VPN
```

Всё на одном сервере. Нет Kubernetes, нет Docker (по крайней мере по коду не видно), нет облака. Это намеренно: простота важнее масштабируемости для внутреннего инструмента.

---

## PM2 — управление Node.js процессом

PM2 (Process Manager 2) — де-факто стандарт для запуска Node.js в production. Его задачи:
- Держать процесс запущенным (перезапускать при падении)
- Запускать при старте системы (после перезагрузки сервера)
- Управлять логами
- Мониторить потребление ресурсов

### ecosystem.config.js — разобранный

```js
module.exports = {
  apps: [{
    name: 'alfa-wiki',          // Имя процесса (используется во всех командах)
    script: 'server.js',         // Что запускать
    cwd: './backend',            // В какой директории запускать
    
    // Важно: НЕ cluster!
    exec_mode: 'fork',           // Один процесс (не несколько)
    instances: 1,                // Одна копия
    
    // Перезапуск при падении
    autorestart: true,
    max_restarts: 10,            // Максимум 10 рестартов (защита от бесконечного цикла)
    min_uptime: '10s',           // Процесс должен прожить хотя бы 10 сек чтобы рестарт не считался
    restart_delay: 2000,         // Подождать 2 сек перед рестартом
    kill_timeout: 5000,          // Дать процессу 5 сек на graceful shutdown
    
    // Логи
    error_file: '../logs/pm2-error.log',
    out_file: '../logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    
    // Переменные окружения
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
```

**Почему `exec_mode: 'fork'` а не `'cluster'`?**

Режим `cluster` запускает несколько копий процесса для использования всех ядер CPU. Звучит хорошо, но с Socket.IO это проблема:

Socket.IO хранит состояние подключений в памяти Node.js-процесса. При cluster-режиме — несколько процессов с разными состояниями. Пользователь подключился к процессу #1, отправляет событие — оно идёт в процесс #2. Процесс #2 не знает о подключении пользователя к процессу #1.

Решение: Socket.IO Redis Adapter (синхронизация через Redis). Но это усложнение. При текущей нагрузке один процесс справляется, поэтому `fork`.

### Основные команды PM2

```bash
# Запустить по конфигу
pm2 start ecosystem.config.js --env production

# Состояние процессов
pm2 status
pm2 list

# Мониторинг в реальном времени (CPU, RAM, RPS)
pm2 monit

# Логи
pm2 logs alfa-wiki               # Последние логи
pm2 logs alfa-wiki --lines 200   # 200 последних строк
pm2 logs alfa-wiki --err         # Только ошибки

# Управление
pm2 restart alfa-wiki            # Рестарт (с нулевым даунтаймом если graceful)
pm2 stop alfa-wiki               # Остановить
pm2 delete alfa-wiki             # Удалить из PM2

# Сохранить список процессов (чтобы восстановить после reboot)
pm2 save

# Настроить автозапуск при старте системы
pm2 startup
# PM2 скажет что выполнить (копировать команду с sudo)
```

### Graceful shutdown

При `pm2 restart` или `pm2 stop` — PM2 посылает процессу сигнал `SIGINT`. Приложение должно корректно завершиться.

В `server.js` обработка сигнала:
```js
process.on('SIGINT', async () => {
  console.log('Получен SIGINT, завершаем...');
  
  // Закрыть HTTP-сервер (не принимать новые соединения)
  server.close(async () => {
    // Закрыть соединения с БД
    await sequelize.close();
    console.log('Сервер остановлен');
    process.exit(0);
  });
});
```

`kill_timeout: 5000` — если за 5 секунд процесс не завершился — PM2 убьёт его принудительно (`SIGKILL`).

---

## Переменные окружения — полный разбор

`backend/.env` — файл никогда не должен попасть в git (он в `.gitignore`). `.env.example` — шаблон, который коммитируется.

### Как dotenv загружает переменные

```js
require('dotenv').config();
// Читает файл .env из текущей директории
// Добавляет каждую строку KEY=VALUE в process.env
```

После этого в коде:
```js
process.env.DB_NAME     // 'alfa_wiki'
process.env.JWT_SECRET  // 'длиннаясекретнаястрока'
process.env.PORT        // '9001' (всегда строка!)
```

Важно: `process.env` всегда содержит строки. `parseInt(process.env.PORT)` нужен чтобы получить число.

### Все переменные с пояснениями

**База данных:**
```
DB_HOST=localhost          Хост PostgreSQL (обычно localhost если на том же сервере)
DB_PORT=5432               Стандартный порт PostgreSQL
DB_NAME=alfa_wiki          Имя базы данных
DB_USER=postgres           Пользователь PostgreSQL
DB_PASSWORD=...            Пароль (держать в тайне!)
```

**Сервер:**
```
PORT=9001                  На каком порту слушать
NODE_ENV=production        Режим: production или development
```

**Безопасность:**
```
JWT_SECRET=...             Секрет для подписи JWT токенов
                           Минимум 32 символа, случайный
                           Изменение = разлогинивание всех пользователей
JWT_EXPIRES_IN=12h         Время жизни токена (12 часов)
```

Как сгенерировать надёжный JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Файлы:**
```
MAX_FILE_SIZE=52428800     Максимальный размер файла в байтах (50 MB)
UPLOAD_PATH=./uploads      Куда сохранять загружаемые файлы
BACKUP_PATH=./backups      Куда сохранять резервные копии
BACKUP_RETENTION_DAYS=30   Сколько дней хранить бэкапы
```

**Telegram:**
```
TELEGRAM_BOT_TOKEN=...     Токен основного Telegram-бота
                           Получается у @BotFather в Telegram
```

**Email (SMTP):**
```
SMTP_HOST=mail.medcentralfa.ru    Сервер входящей почты
SMTP_PORT=465                      Порт (465=SSL, 587=TLS)
SMTP_SECURE=true                   Использовать SSL
SMTP_USER=wiki@medcentralfa.ru    Логин
SMTP_PASSWORD=...                  Пароль
SMTP_FROM="Альфа Вики" <wiki@...> Отображаемый отправитель

SMTP_HOST_BROADCAST=...           Отдельный SMTP для рассылок (опционально)
SMTP_USER_BROADCAST=...
SMTP_PASSWORD_BROADCAST=...
```

**МИС Renovatio:**
```
MIS_API_KEY=c58544b...             Ключ API МИС
MIS_BASE_URL=https://rnova.medcentralfa.ru:3010/api/public
```

**АТС Nextcloud:**
```
MISSED_CALLS_NEXTCLOUD_URL=https://cloud.medcentralfa.ru/comfortel/receive.php
MISSED_CALLS_ROUTE_79001234567=<UUID чата>   Маршрут звонка с номера
MISSED_CALLS_ROUTE_79007654321=<UUID чата>
MISSED_CALLS_FALLBACK_CHAT_ID=<UUID>         Дефолтный чат
```

**Frontend (для Socket.IO CORS):**
```
FRONTEND_URL=http://192.168.22.39:9001,http://192.168.22.39:9000
```

---

## Процедура деплоя — шаг за шагом

### Обновление кода

```bash
# 1. Перейти в директорию проекта
cd /path/to/alfa-wiki

# 2. Сохранить незафиксированные изменения если есть
git stash

# 3. Получить новый код
git pull origin main

# 4. Проверить есть ли новые зависимости backend
cd backend
npm install

# 5. Вернуться и проверить frontend
cd ../frontend
npm install
```

### Сборка frontend

```bash
cd frontend
npm run build
# Создаёт frontend/build/ — оптимизированная статика
# Занимает 1-3 минуты
```

Что делает `npm run build`:
- Webpack собирает все JS файлы в бандлы
- TypeScript/JSX транспилируется в ES5
- CSS минифицируется
- Изображения оптимизируются
- Результат: `build/static/js/main.[hash].js` + `build/static/css/main.[hash].css`

Хэш в имени файла — это важно. Если контент изменился — имя файла изменится. Браузер знает что нужно перезагрузить файл (не из кэша).

### Применение миграций

```bash
# Проверить есть ли новые файлы миграций
ls backend/migrations/ | tail -20

# Применить SQL-миграцию
psql -U postgres -d alfa_wiki -f "backend/migrations/ver. 3.26 add-missing-indexes.sql"

# Применить JS-миграцию (если есть)
cd backend
node migrations/some-migration.js
```

**Как понять что миграции нужны?** В changelog или commit message. Если в новых файлах появились изменения в `models/index.js` — скорее всего есть и миграция.

### Перезапуск сервера

```bash
pm2 restart alfa-wiki
# Сервер перезапустится с новым кодом
# Небольшой даунтайм (~1-2 сек)
```

Для zero-downtime reload (без разрыва соединений):
```bash
pm2 reload alfa-wiki
# PM2 запускает новый процесс, ждёт пока он готов, потом убивает старый
# Но с Socket.IO это может вызвать временные проблемы
```

### Быстрая процедура целиком

```bash
cd /path/to/alfa-wiki
git pull origin main
cd backend && npm install && cd ..
cd frontend && npm install && npm run build && cd ..
# Применить миграции если есть
pm2 restart alfa-wiki
pm2 logs alfa-wiki --lines 20  # Проверить что всё ок
```

---

## Логи и диагностика

### Где смотреть логи

```
logs/
├── pm2-out.log     — Вывод console.log из приложения
├── pm2-error.log   — Вывод console.error + необработанные ошибки
├── backend-out.log — (если есть отдельный конфиг)
└── backend-error.log
```

### Мониторинг в реальном времени

```bash
# Смотреть логи в реальном времени
pm2 logs alfa-wiki --lines 0

# Полный мониторинг: CPU, RAM, логи, перезапуски
pm2 monit

# Только статус
pm2 status
```

Вывод `pm2 status`:
```
┌─────┬──────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┐
│ id  │ name         │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │
├─────┼──────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┤
│ 0   │ alfa-wiki    │ default     │ 3.26.0  │ fork    │ 12345    │ 2D     │ 0    │ online    │
└─────┴──────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┘
```

- `uptime: 2D` — работает 2 дня без рестарта
- `↺ 0` — 0 незапланированных рестартов (хорошо)
- `status: online` — работает

### Типичные ошибки и диагностика

**Сервер не запускается:**
```bash
pm2 logs alfa-wiki --lines 50 --err
# Смотрим последние 50 строк ошибок
```

Частые причины:
- Неверные данные в `.env` (БД не запущена, неверный пароль)
- Порт 9001 занят другим процессом: `lsof -i :9001`
- Синтаксическая ошибка в новом коде

**Сервер запустился, но API не отвечает:**
```bash
curl http://localhost:9001/api/health
# Должен вернуть { status: 'ok' }
```

**Ошибки БД:**
```
SequelizeConnectionError: connection refused
```
→ PostgreSQL не запущен. `systemctl status postgresql`

```
SequelizeUniqueConstraintError
```
→ Попытка создать дубликат уникального поля. Смотреть что именно.

**Frontend не обновился после деплоя:**

Браузер закэшировал старую версию. Решения:
1. Hard reload: `Ctrl+Shift+R`
2. Открыть DevTools → Network → Disable cache → Перезагрузить
3. Или очистить кэш браузера

Это особенно актуально для Tauri-приложения: оно кэширует страницы агрессивно. После обновления нужно перезапустить приложение.

---

## PostgreSQL — управление

### Основные команды

```bash
# Подключиться к БД
psql -U postgres -d alfa_wiki

# Внутри psql:
\dt                    # Список таблиц
\d users               # Структура таблицы users
\du                    # Список пользователей БД
SELECT COUNT(*) FROM users;  # SQL запрос
\q                     # Выйти

# Создать резервную копию вручную
pg_dump -U postgres alfa_wiki > backup_manual.sql

# Восстановить
psql -U postgres alfa_wiki < backup_manual.sql
```

### Пространство на диске

PostgreSQL хранит данные в `/var/lib/postgresql/`. Таблицы с большими JSONB-полями или TEXT могут занимать значительное место.

```sql
-- Размер всех таблиц
SELECT schemaname, tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

Обычно самые большие таблицы: `messages` (история чатов), `page_history` (история правок), `search_index`, `email_logs`.

### VACUUM — обслуживание БД

PostgreSQL не удаляет строки физически сразу — они помечаются как "мёртвые" и удаляются при VACUUM. Это происходит автоматически (autovacuum), но иногда нужно вручную:

```sql
VACUUM ANALYZE;          -- Очистить и обновить статистику
VACUUM FULL tablename;   -- Полная очистка (блокирует таблицу!)
```

---

## Файловая система — управление файлами

### Структура uploads/

```
uploads/
├── YYYY-MM/           — Файлы по месяцам
│   ├── image-abc.jpg
│   └── doc-xyz.pdf
├── avatars/           — Аватары пользователей
│   └── user-uuid.jpg
├── chat-avatars/      — Аватары групп
├── reviews/           — PDF отчёты
│   └── YYYY-MM/
│       └── review-uuid.pdf
└── map/               — Файлы карт
```

### Очистка старых файлов

Файлы в uploads/ не удаляются автоматически при удалении записей из БД. Это "сиротские" файлы. Периодически нужно чистить:

```bash
# Найти файлы старше 6 месяцев
find uploads/ -type f -mtime +180 -name "*.jpg" -name "*.png"

# ОСТОРОЖНО: перед удалением — убедиться что файлы не используются!
```

Лучший подход — написать скрипт который сравнивает файлы в uploads/ с записями в таблице `media` и удаляет только те которых нет в БД.

### Disk space мониторинг

```bash
df -h          # Свободное место на дисках
du -sh uploads/ # Размер папки uploads
du -sh logs/    # Размер логов
```

Логи PM2 тоже нужно периодически ротировать:
```bash
pm2 install pm2-logrotate  # Установить модуль ротации логов
pm2 set pm2-logrotate:max_size 10M  # Ротация при 10MB
pm2 set pm2-logrotate:retain 7      # Хранить 7 файлов
```

---

## Tauri Desktop App — сборка и дистрибуция

### Как собирается

```bash
cd frontend
npm run tauri:build
# Создаёт frontend/src-tauri/target/release/bundle/nsis/
# АльфаВики_1.85.0_x64-setup.exe — Windows NSIS installer
```

### Конфигурация

```json
// frontend/src-tauri/tauri.conf.json (ключевые части)
{
  "productName": "Альфа Вики",
  "version": "1.85.0",
  "identifier": "ru.alfa.wiki",
  
  "app": {
    "windows": [{
      "title": "Альфа Вики",
      "width": 1280,
      "height": 800,
      "minWidth": 1024,
      "minHeight": 600
    }]
  },
  
  "bundle": {
    "targets": ["nsis"],
    "icon": ["icons/icon.png"]
  },
  
  "build": {
    "frontendDist": "http://192.168.22.39:9001",  // В production — URL сервера
    "devUrl": "http://localhost:9000"               // В development — dev server
  }
}
```

Важный момент: `frontendDist: "http://192.168.22.39:9001"` — приложение грузит контент с сервера. Это не локальное приложение в классическом смысле. При отсутствии VPN/сети — приложение не откроется.

Это архитектурный выбор: не нужно раздельно обновлять Desktop-клиент при изменениях в проекте. Обновил сервер — все клиенты сразу получают новую версию.

### Версионирование

`version: "1.85.0"` в `tauri.conf.json` обновляется вручную при каждом релизе installer. Текущее состояние кода версионируется через git (коммиты `ver. 3.26`).

---

## Мобильное приложение (React Native)

`mobile/` — в начальной стадии разработки. Основные файлы:

```
mobile/
├── src/
│   ├── navigation/AppNavigator.js  — React Navigation setup
│   ├── screens/
│   │   ├── Auth/LoginScreen.js     — Экран входа
│   │   └── Chat/ChatScreen.js      — Экран чата
│   ├── services/
│   │   ├── api.js                  — HTTP клиент
│   │   ├── socket.js               — Socket.IO
│   │   ├── notifications.js        — Push-уведомления
│   │   └── vpn.js                  — VPN управление
│   └── store/
│       └── authStore.js            — Состояние авторизации
└── src/config.js                   — API_URL: http://192.168.22.39:9001
```

Мобильное приложение работает с тем же backend — просто другой клиент.

VPN-интеграция (`vpn.js`) — нужна потому что сервер в локальной сети. С телефона вне сети нужен VPN для доступа.

---

## Разработка: как запустить локально

### Предварительные требования

```bash
node --version    # v18 или выше
npm --version     # 9 или выше
psql --version    # PostgreSQL 14+
```

### Первый запуск

```bash
# 1. Клонировать репозиторий
git clone <repo-url>
cd alfa-wiki

# 2. Настроить backend
cd backend
cp .env.example .env
# Отредактировать .env: DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET

# 3. Создать БД
psql -U postgres -c "CREATE DATABASE alfa_wiki;"

# 4. Установить зависимости
npm install

# 5. Применить все миграции
for file in migrations/*.sql; do
  psql -U postgres -d alfa_wiki -f "$file"
done

# 6. Запустить сервер
node server.js
# Или с автоперезагрузкой при изменениях:
npx nodemon server.js
```

```bash
# 7. В новом терминале — запустить frontend
cd frontend
npm install

# Настроить URL backend (если не localhost:9001)
# REACT_APP_API_URL=http://localhost:9001 в .env

npm start
# Открывает http://localhost:9000
```

### Переменные окружения для development

В `backend/.env` минимальный набор для разработки:
```
PORT=9001
NODE_ENV=development
DB_HOST=localhost
DB_PORT=5432
DB_NAME=alfa_wiki
DB_USER=postgres
DB_PASSWORD=your_password
JWT_SECRET=any_long_random_string_here_32_chars_minimum
JWT_EXPIRES_IN=12h
UPLOAD_PATH=./uploads
```

Все интеграции (Telegram, SMTP, МИС) можно не настраивать для базовой разработки — они просто не будут работать, но остальные функции будут.

---

## Мониторинг и алерты

В текущем виде проект не имеет автоматических алертов. Для production это стоит добавить.

### Health check endpoint

```js
app.get('/api/health', async (req, res) => {
  try {
    await sequelize.authenticate();  // Проверить соединение с БД
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date()
    });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});
```

Можно настроить внешний мониторинг (UptimeRobot, Zabbix) который проверяет этот endpoint каждую минуту и присылает алерт при недоступности.

### Что мониторить

- **Доступность** — `GET /api/health` → 200
- **Диск** — свободное место в uploads/ и логах
- **БД** — размер таблиц, медленные запросы
- **PM2** — количество рестартов (`pm2 status`, поле `↺`)
- **Логи** — ошибки в pm2-error.log

### Что делать при проблемах

**Сервер не отвечает:**
```bash
pm2 status             # Статус процесса
pm2 logs alfa-wiki --err --lines 50  # Последние ошибки
pm2 restart alfa-wiki  # Перезапустить
```

**Медленные запросы:**
```sql
-- PostgreSQL: включить логирование медленных запросов
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- запросы > 1 сек
SELECT pg_reload_conf();
```

**Память растёт без остановки (memory leak):**
```bash
pm2 monit  # Следить за RSS memory
# Если растёт постоянно — есть утечка памяти
# Временное решение: настроить автоперезапуск при превышении лимита
pm2 restart alfa-wiki --max-memory-restart 512M
```

---

## Безопасность инфраструктуры

### Чего не делать

- Не открывать порт 9001 в интернет без VPN/фаервола
- Не хранить `.env` в git
- Не использовать `postgres` суперпользователя для приложения (создать отдельного)
- Не делать бэкапы только на том же сервере (внешнее хранилище)

### Создание отдельного PostgreSQL пользователя

```sql
-- Создать пользователя только для приложения
CREATE USER alfa_wiki_user WITH PASSWORD 'strong_password_here';

-- Дать права только на нужную БД
GRANT CONNECT ON DATABASE alfa_wiki TO alfa_wiki_user;
GRANT USAGE ON SCHEMA public TO alfa_wiki_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO alfa_wiki_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO alfa_wiki_user;
```

Тогда в `.env`:
```
DB_USER=alfa_wiki_user
DB_PASSWORD=strong_password_here
```

### Фаервол

```bash
# Разрешить только из локальной сети
ufw allow from 192.168.22.0/24 to any port 9001

# Или через iptables
iptables -A INPUT -p tcp --dport 9001 -s 192.168.22.0/24 -j ACCEPT
iptables -A INPUT -p tcp --dport 9001 -j DROP
```

---

## Чеклист при каждом деплое

```
[ ] git pull — получить код
[ ] npm install в backend (если изменился package.json)
[ ] npm install в frontend (если изменился package.json)
[ ] npm run build в frontend
[ ] Применить новые SQL миграции
[ ] Применить новые JS миграции
[ ] pm2 restart alfa-wiki
[ ] pm2 logs — проверить что нет ошибок при старте
[ ] Открыть /api/health — проверить статус
[ ] Открыть приложение в браузере — функциональная проверка
```
