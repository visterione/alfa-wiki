# Глава 3. Архитектура Backend

Эта глава разбирает устройство серверной части: как работает `server.js`, что такое middleware в деталях, как устроены маршруты, почему всё именно так написано.

---

## server.js — анатомия точки входа

`server.js` — это единственный файл, который запускает весь сервер. Он читается сверху вниз, и каждая строка важна. Разберём структуру по частям.

### Импорты и инициализация

В самом начале файла загружаются все зависимости и настройки:

```js
require('dotenv').config();  // Загружает .env файл в process.env
```

`dotenv` — первое что должно случиться, потому что дальше весь код использует `process.env.DB_HOST`, `process.env.JWT_SECRET` и т.д. Если `dotenv` не загружен — эти значения будут `undefined`.

После этого импортируются все внешние модули (express, socket.io, cors и т.д.) и внутренние — модели из `models/index.js`, роуты из `routes/`, сервисы из `services/`.

### Создание Express-приложения и HTTP-сервера

```js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();          // Express-приложение
const server = http.createServer(app);  // HTTP-сервер обёртывает Express
const io = new Server(server, { /* настройки CORS */ });
```

Важно понять иерархию:

```
http.Server (Node.js встроенный HTTP-сервер)
    └── express app (Express middleware chain)
    └── Socket.IO (навешивается на тот же HTTP-сервер)
```

Если бы мы написали просто `app.listen(9001)` — Express создал бы HTTP-сервер автоматически. Но тогда нельзя было бы навесить Socket.IO на тот же сервер. Поэтому мы создаём HTTP-сервер вручную.

### Почему один порт для всего

Может показаться странным что и REST API, и WebSocket, и статические файлы — всё на одном порту 9001. Но это возможно и удобно:

- Socket.IO использует `/socket.io/` путь для своего handshake
- Статика `/uploads/` отдаётся через `express.static`
- API-запросы идут на `/api/*`
- Telegram Bot API эмуляция — на `/bot{token}/*`
- Всё остальное (в production) — `index.html` React-приложения

Один порт = один процесс = простое управление через PM2.

---

## Middleware — детальный разбор

### Что такое middleware на самом деле

Middleware — это функция с сигнатурой `(req, res, next)`. В Express все обработчики — это middleware, даже финальный route handler. Разница только в том, вызывает ли функция `next()` или отвечает клиенту.

```js
// Это middleware
function logTime(req, res, next) {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next(); // Передать управление следующему
}

// Это тоже middleware (финальный обработчик маршрута)
function getUserById(req, res) {
  // next не нужен — мы отвечаем сами
  const user = await User.findByPk(req.params.id);
  res.json(user);
}
```

`app.use(fn)` — зарегистрировать middleware для ВСЕХ запросов.
`app.use('/api', fn)` — только для запросов начинающихся с `/api`.
`router.get('/', fn1, fn2, fn3)` — цепочка middleware для конкретного маршрута.

### Стек middleware в проекте (порядок имеет значение!)

```
app.use(helmet(...))           — 1-й
app.use(cors(...))             — 2-й
app.use(express.json(...))     — 3-й
app.use(express.urlencoded())  — 4-й
app.use(morgan('dev'))         — 5-й
app.use(express.static(...))   — 6-й (файлы из uploads/)

app.use('/api/auth', authRouter)    — маршруты регистрируются после
app.use('/api/users', usersRouter)
// ... и т.д.
```

**Порядок критичен**. Если поставить `express.json()` после роутов — `req.body` будет `undefined` в обработчиках. Если `cors()` после роутов — браузер не получит нужные заголовки и заблокирует ответ.

### helmet — защита заголовками

`helmet()` добавляет ряд HTTP-заголовков безопасности. Самый важный — `Content-Security-Policy` (CSP).

CSP говорит браузеру: "загружай ресурсы только с одобренных источников". Это защищает от XSS-атак, когда злоумышленник пытается вставить в страницу вредоносный скрипт.

В нашем проекте CSP настроен нестандартно — нужны `unsafe-inline` и `unsafe-eval`. Это компромисс: полная безопасность невозможна потому что:
- LuckySheet (табличный редактор) использует `eval()` внутри себя
- Динамические стили в редакторах требуют `inline styles`
- PDF-предпросмотр использует `blob:` URL

### cors — политика кросс-доменных запросов

Браузер блокирует запросы с одного домена к другому (Same-Origin Policy). Это защита: скрипт на `evil.com` не должен читать данные с `your-bank.com`.

CORS (Cross-Origin Resource Sharing) — механизм чтобы явно разрешить такие запросы.

В нашем проекте: `origin: true` означает "разрешить с любого домена". Это безопасно, потому что проверка происходит через JWT-токен, а не через origin.

```js
app.use(cors({
  origin: true,       // Разрешить любой origin
  credentials: true,  // Разрешить куки (нам нужно для сессий если будут)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
}));
```

`OPTIONS` в методах — это для preflight-запросов: перед сложными CORS-запросами браузер посылает OPTIONS чтобы проверить что сервер разрешает.

### express.json() — парсинг тела запроса

HTTP-запрос имеет тело (body) — это просто поток байт. `express.json()` читает этот поток и если `Content-Type: application/json` — разбирает JSON и помещает результат в `req.body`.

```js
// POST /api/users с телом: {"username": "ivan", "password": "secret"}
app.use(express.json({ limit: '10gb' }));

router.post('/', (req, res) => {
  console.log(req.body);  // { username: 'ivan', password: 'secret' }
});
```

Лимит `10gb` — намеренно огромный. Это нужно для загрузки больших файлов через base64 или больших JSON-структур (данные spreadsheet могут быть очень большими).

### morgan — HTTP-логирование

Morgan — middleware-логгер. В режиме `'dev'` выводит:
```
GET /api/users 200 45 ms - 1234
POST /api/pages 422 12 ms - 56
DELETE /api/tasks/abc 204 8 ms - -
```

Формат: `метод путь статус время размер-ответа`

Полезно при разработке: видишь все запросы, статусы, время ответа. В production можно настроить другой формат (например, JSON для централизованного логирования).

### express.static — раздача статических файлов

```js
app.use(express.static('./uploads', {
  setHeaders: (res, path) => {
    if (path.match(/\.(mp4|webm|ogg|avi|mov|mkv)$/i)) {
      res.setHeader('Accept-Ranges', 'bytes');
    }
  }
}));
```

`express.static` ищет файл по пути запроса в указанной папке. Запрос `GET /avatars/user123.jpg` → ищет `./uploads/avatars/user123.jpg`.

Особенность: для видеофайлов добавляется заголовок `Accept-Ranges: bytes`. Это нужно для `<video>` элемента в браузере — он должен уметь запрашивать куски видео (перемотка).

---

## Маршруты (Routes) — как устроены route handlers

### Структура файла маршрутов

Каждый файл в `routes/` выглядит примерно так:

```js
const express = require('express');
const router = express.Router();  // Мини-приложение для группы маршрутов
const { authenticate, requireAdmin } = require('../middleware/auth');
const { User } = require('../models');  // Sequelize-модель

// GET /api/users (когда /api/users смонтировано в server.js)
router.get('/', authenticate, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password'] },  // Не возвращать пароли!
      order: [['displayName', 'ASC']]
    });
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, {
      attributes: { exclude: ['password'] }
    });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashedPassword, displayName });
    res.status(201).json(user);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
```

Несколько важных вещей:

**`express.Router()`** — это мини-приложение, имеет те же методы что и `app` (get, post, put, delete, use). Когда он монтируется через `app.use('/api/users', usersRouter)` — все пути в router относительны: `router.get('/:id')` становится `/api/users/:id`.

**`try/catch` в каждом handler** — обязательно. `async` функция при ошибке выбрасывает промис который будет отклонён. Без `try/catch` Express не поймает эту ошибку (в старых версиях) или приложение упадёт. Современный Express 5 ловит это автоматически, но в проекте Express 4 — нужно явно.

**HTTP-статус коды** — важны:
- `200` — OK (по умолчанию)
- `201` — Created (при создании ресурса)
- `204` — No Content (при удалении — ответ без тела)
- `400` — Bad Request (неверные данные от клиента)
- `401` — Unauthorized (нет токена или токен невалиден)
- `403` — Forbidden (токен есть, но прав нет)
- `404` — Not Found
- `500` — Internal Server Error

### Типичные паттерны в route handlers

**Паттерн "найди или верни 404":**
```js
const item = await Model.findByPk(req.params.id);
if (!item) return res.status(404).json({ error: 'Not found' });
// Дальше работаем с item
```

**Паттерн "обнови и верни":**
```js
const item = await Model.findByPk(req.params.id);
if (!item) return res.status(404).json({ error: 'Not found' });
await item.update(req.body);  // Sequelize обновит только переданные поля
res.json(item);
```

**Паттерн "удали и верни пустой ответ":**
```js
const item = await Model.findByPk(req.params.id);
if (!item) return res.status(404).json({ error: 'Not found' });
await item.destroy();
res.status(204).send();  // Пустой ответ
```

**Паттерн с пагинацией:**
```js
const { page = 1, limit = 20, search } = req.query;
const offset = (page - 1) * limit;

const where = {};
if (search) where.title = { [Op.iLike]: `%${search}%` };

const { count, rows } = await Model.findAndCountAll({
  where,
  limit: parseInt(limit),
  offset: parseInt(offset),
  order: [['createdAt', 'DESC']]
});

res.json({
  items: rows,
  total: count,
  page: parseInt(page),
  totalPages: Math.ceil(count / limit)
});
```

**Паттерн с Socket.IO уведомлением:**
```js
// После сохранения отзыва — уведомить нужных людей
const review = await Review.create(data);

// Эмитим событие через Socket.IO
io.to(`user_${assigneeId}`).emit('new_notification', {
  type: 'review_assigned',
  message: `Вам назначен отзыв от ${review.patientName}`,
  reviewId: review.id
});
```

---

## Middleware аутентификации — auth.js

Это самый важный middleware файл. Разберём каждую функцию детально.

### authenticate — основная проверка

```js
const authenticate = async (req, res, next) => {
  // 1. Извлечь токен из заголовка
  const authHeader = req.headers.authorization;
  // authHeader: "Bearer eyJhbGci..."
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Токен не предоставлен' });
  }
  
  const token = authHeader.split(' ')[1];  // Берём всё после "Bearer "
  
  try {
    // 2. Верифицировать токен
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // decoded: { id: 'user-uuid', iat: ..., exp: ... }
    
    // 3. Загрузить пользователя из БД
    const user = await User.findByPk(decoded.id, {
      include: [
        { model: Role },      // Роли пользователя
        { model: MedCenter }  // Медцентры пользователя
      ]
    });
    
    // 4. Проверить что пользователь существует и активен
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Пользователь не найден или деактивирован' });
    }
    
    // 5. Добавить пользователя в req — дальше он доступен в route handlers
    req.user = user;
    next();
    
  } catch (error) {
    // jwt.verify выбрасывает исключение если токен невалидный или просроченный
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Токен истёк' });
    }
    return res.status(401).json({ error: 'Невалидный токен' });
  }
};
```

Каждый защищённый маршрут начинается с `authenticate`. После его выполнения все route handlers имеют доступ к `req.user` — полному объекту пользователя с ролями и медцентрами.

Важно: `authenticate` делает запрос к БД при каждом API-вызове. Это небольшая нагрузка, но это гарантирует актуальность данных (если пользователь деактивирован — он сразу потеряет доступ, не ждя истечения токена).

### requireAdmin

```js
const requireAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Требуются права администратора' });
  }
  next();
};
```

Простейшая проверка. Используется только для маршрутов, требующих полных прав (управление всеми ботами, настройка RB-доступа).

### requireAdminAccess(section)

```js
const requireAdminAccess = (section) => {
  return (req, res, next) => {
    // Полный администратор имеет доступ ко всему
    if (req.user.isAdmin) return next();
    
    // Проверяем конкретный раздел в adminAccess
    if (!req.user.adminAccess || !req.user.adminAccess[section]) {
      return res.status(403).json({ error: `Нет доступа к разделу: ${section}` });
    }
    
    next();
  };
};

// Использование:
router.get('/', authenticate, requireAdminAccess('reviews'), async (req, res) => { ... });
```

Обрати внимание на форму: `requireAdminAccess` возвращает middleware-функцию. Это "фабрика middleware" — она принимает параметр и создаёт кастомный middleware. Это паттерн "higher-order function" (функция высшего порядка).

### requirePermission(resource, action)

```js
const requirePermission = (resource, action) => {
  return (req, res, next) => {
    if (req.user.isAdmin) return next();
    
    // Проверяем через массив ролей пользователя
    const hasPermission = req.user.Roles?.some(role => {
      return role.permissions?.[resource]?.[action] === true;
    });
    
    // Также проверяем устаревшую одиночную роль
    const legacyRole = req.user.role;
    const hasLegacyPermission = legacyRole?.permissions?.[resource]?.[action] === true;
    
    if (!hasPermission && !hasLegacyPermission) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    
    next();
  };
};
```

Здесь `?.` — это **optional chaining** (опциональная цепочка). `role.permissions?.pages?.read` — если `permissions` или `pages` — `null/undefined`, вернёт `undefined` вместо выброса ошибки.

---

## Обработка ошибок

В конце `server.js` зарегистрирован глобальный обработчик ошибок:

```js
// ВАЖНО: 4 параметра — Express понимает это как error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});
```

Error handler с 4 параметрами срабатывает когда:
1. Вызван `next(error)` — передача ошибки явно
2. В синхронном middleware выброшено исключение

Для `async` route handlers нужен `try/catch` (в Express 4) — иначе ошибка станет "unhandled promise rejection".

---

## Специальный маршрут: Telegram Bot API эмуляция

В `server.js` есть нестандартный обработчик:

```js
// /bot{token}/getUpdates, /bot{token}/sendMessage и т.д.
app.all('/bot:token/*', botApiHandler);

// Скачивание файлов через бот
app.get('/file/bot:token/:fileId', botFileHandler);
```

Telegram Bot API стандартно доступен на `https://api.telegram.org/bot{token}/method`. Эмулятор принимает такие же запросы, но на нашем сервере. Это позволяет Telegram-бот клиентам работать с внутренними ботами, указав `baseUrl: http://192.168.22.39:9001` вместо `api.telegram.org`.

Маршрут `:token` — динамический параметр. Express принимает `/botABC123/sendMessage` и ставит `req.params.token = 'ABC123'`.

---

## Production vs Development — одно приложение, разное поведение

В production:
```js
if (process.env.NODE_ENV === 'production') {
  // Отдавать React build как статику
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  
  // Все неизвестные маршруты → index.html (React Router)
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
  });
}
```

Это называется **"catch-all"** или **"fallback" маршрут**. React Router управляет переходами на клиенте — `/kanban/board/123` не существует на сервере, но Express отдаёт `index.html`, React загружается и React Router рендерит нужный компонент.

В development: frontend запускается отдельно через `npm start` (React dev server на порту 9000) с hot-reload. Backend не отдаёт статику.

---

## Разбор одного маршрута от начала до конца

Возьмём реальный пример: `GET /api/reviews/boards/:boardId/settings`

**В `server.js`:**
```js
app.use('/api/reviews', reviewsRouter);
```

**В `routes/reviews.js`:**
```js
router.get('/boards/:boardId/settings', 
  authenticate,                           // 1. Проверяем JWT
  requireAdminAccess('reviews'),          // 2. Проверяем доступ к reviews
  async (req, res) => {
    try {
      const board = await ReviewBoard.findByPk(req.params.boardId);
      if (!board) return res.status(404).json({ error: 'Доска не найдена' });
      
      // Проверяем права на конкретную доску (owner, editor или viewer)
      const permission = await ReviewBoardPermission.findOne({
        where: { boardId: board.id, userId: req.user.id }
      });
      if (!permission && !req.user.isAdmin) {
        return res.status(403).json({ error: 'Нет доступа к этой доске' });
      }
      
      res.json({
        notificationSettings: board.notificationSettings,
        workflowConfig: board.workflowConfig,
        columnNames: board.columnNames
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }
);
```

**Полный путь запроса:**
```
GET /api/reviews/boards/abc-123/settings
    ↓
app.use('/api/reviews', reviewsRouter)  — маршрутизация
    ↓
router.get('/boards/:boardId/settings')  — совпадение, req.params.boardId = 'abc-123'
    ↓
authenticate  — jwt.verify → User.findByPk → req.user
    ↓
requireAdminAccess('reviews')  — req.user.adminAccess.reviews === true?
    ↓
route handler  — ReviewBoard.findByPk('abc-123') → SQL: SELECT * FROM review_boards WHERE id = 'abc-123'
    ↓
res.json({...})  — JSON-ответ клиенту
```

---

## Инициализация сервисов при старте

В конце `server.js`, перед `server.listen()`, инициализируются все сервисы:

```js
// Telegram-бот
initBot();

// Передаём io в notificationService — он сможет слать Socket.IO события
notificationService.init(io);

// Создаём системного пользователя для ATS-бота если его нет
notificationService.initMissedCallsBot();

// Запускаем все cron-задачи
analysesCron.start();
servicesCron.start();
calendarRemindersCron.start();
// ... остальные cron
```

Порядок важен: Socket.IO должен быть инициализирован до `notificationService.init(io)`.

Если в инициализации ошибка (например, БД недоступна) — процесс падает и PM2 перезапускает его. Это нормальное поведение: лучше "упасть и перезапуститься" чем работать в неопределённом состоянии.

---

## Почему всё в одном процессе (монолит)

В проекте всё: HTTP-сервер, Socket.IO, cron-задачи, Telegram-бот, интеграции — работают в одном Node.js-процессе.

**Преимущества:**
- Простота: один `pm2 restart` — и всё перезапустилось
- Нет сетевых задержек между частями
- Общая память: Socket.IO, cron, route handlers могут обращаться к одним и тем же объектам
- Простой деплой: один репозиторий, один процесс

**Недостатки:**
- Нет горизонтального масштабирования: нельзя запустить несколько копий (Socket.IO не поддерживает cluster без Redis-адаптера)
- Если падает одна часть — потенциально падает всё
- При росте нагрузки — нужен рефакторинг в микросервисы

Для текущего масштаба (внутреннее приложение медцентра) — монолит абсолютно оправдан. Преимущества простоты значительно перевешивают недостатки масштабирования.
