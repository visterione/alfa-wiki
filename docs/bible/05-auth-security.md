# Глава 5. Аутентификация и безопасность

Эта глава подробно разбирает всю систему безопасности: от хэширования паролей до проверки прав на конкретный ресурс.

---

## Полный процесс входа в систему

Начнём с конца — с того что видит пользователь — и разберём каждый шаг.

### Шаг 1. Ввод логина и пароля (frontend)

`Login.js` — простая форма. При submit:

```js
const handleSubmit = async (e) => {
  e.preventDefault();
  
  try {
    const result = await api.auth.login({ username, password });
    
    if (result.requiresTwoFactor) {
      // 2FA включена — показать форму для кода
      setShowTwoFactor(true);
      setUserId(result.userId);
    } else {
      // Вход успешен — сохранить токен
      login(result.token, result.user);
      navigate('/');
    }
  } catch (err) {
    setError('Неверный логин или пароль');
  }
};
```

`api.auth.login` отправляет `POST /api/auth/login` с телом `{ username, password }`.

### Шаг 2. Проверка пароля на сервере

В `routes/auth.js`:

```js
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Найти пользователя
  const user = await User.findOne({
    where: { username },
    include: [{ model: Role }, { model: MedCenter }]
  });
  
  // Пользователь не найден — НЕ говорим конкретно "нет такого пользователя"
  // Это защита от перебора имён пользователей (username enumeration)
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'Неверные учётные данные' });
  }
  
  // Проверка пароля через bcrypt
  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) {
    return res.status(401).json({ error: 'Неверные учётные данные' });
  }
  
  // Если включена 2FA — не возвращаем токен сразу
  if (user.twoFactorEnabled) {
    const code = emailService.generateCode();  // 6 цифр
    const expires = new Date(Date.now() + 10 * 60 * 1000);  // +10 минут
    
    await user.update({
      twoFactorCode: code,
      twoFactorCodeExpires: expires,
      twoFactorAttempts: 0
    });
    
    await emailService.send2FACode(user.email, code, user.displayName);
    
    return res.json({ requiresTwoFactor: true, userId: user.id });
  }
  
  // Обновить время последнего входа
  await user.update({ lastLogin: new Date() });
  
  // Создать JWT токен
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '12h'
  });
  
  // Вернуть токен и данные пользователя (без пароля)
  const userData = user.toJSON();
  delete userData.password;
  
  res.json({ token, user: userData });
});
```

Обрати внимание на важную деталь безопасности: при неверном логине или пароле мы возвращаем **одно и то же сообщение** — "Неверные учётные данные". Если бы мы писали "Пользователь не найден" или "Неверный пароль" — злоумышленник мог бы перебирать имена пользователей.

### Шаг 3. Сохранение токена на клиенте

В `AuthContext.js`:

```js
const login = (token, userData) => {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(userData));
  setUser(userData);
};
```

`localStorage` — хранилище браузера, персистентное (не очищается при закрытии вкладки). Данные хранятся как строки.

**Почему localStorage, а не cookie?**

Оба варианта имеют trade-offs. localStorage:
- Простой доступ из JavaScript
- Не отправляется автоматически с каждым запросом (нужно добавлять вручную через axios)
- Уязвим к XSS: если злоумышленник может выполнить JS на странице — он украдёт токен

HTTP-only cookie:
- Браузер автоматически отправляет с каждым запросом
- Недоступен из JavaScript (защита от XSS)
- Уязвим к CSRF (можно защититься CSRF-токеном)

В нашем проекте выбран localStorage. Проект — внутренний интранет с ограниченным кругом пользователей, XSS маловероятен.

### Шаг 4. Восстановление сессии при перезагрузке

При загрузке страницы `AuthContext` проверяет localStorage:

```js
useEffect(() => {
  const savedToken = localStorage.getItem('token');
  const savedUser = localStorage.getItem('user');
  
  if (savedToken && savedUser) {
    // Установить пользователя из кэша
    setUser(JSON.parse(savedUser));
    
    // Верифицировать токен на сервере (может быть просрочен)
    api.auth.verify()
      .then(data => setUser(data))  // Обновить свежими данными
      .catch(() => {
        // Токен невалиден — разлогинить
        localStorage.clear();
        setUser(null);
      });
  }
  
  setLoading(false);
}, []);
```

`GET /api/auth/verify` — маршрут который возвращает актуальные данные пользователя по токену. Это нужно чтобы обновить права и данные без повторного входа.

---

## Двухфакторная аутентификация (2FA)

### Как работает

После успешной проверки пароля при включённой 2FA:

```
1. Сервер генерирует 6-значный код: Math.floor(100000 + Math.random() * 900000).toString()
2. Хэшировать? Нет — код хранится в открытом виде в user.twoFactorCode
   (Это нормально: код краткосрочный, 10 минут, одноразовый)
3. Устанавливается время истечения: now + 10 минут
4. Код отправляется на email пользователя
5. Клиент получает: { requiresTwoFactor: true, userId }
6. Показывается форма ввода кода
7. POST /api/auth/verify-2fa { userId, code }
8. Сервер проверяет: код совпадает И не истёк И попыток не более 5
9. Если верно — возвращается JWT токен
10. Поля сбрасываются: twoFactorCode = null, twoFactorCodeExpires = null
```

### Защита от перебора кода

```js
router.post('/verify-2fa', async (req, res) => {
  const { userId, code } = req.body;
  
  const user = await User.findByPk(userId);
  
  // Проверяем количество попыток
  if (user.twoFactorAttempts >= 5) {
    // Сбрасываем код — нужно снова запросить
    await user.update({ twoFactorCode: null, twoFactorCodeExpires: null });
    return res.status(429).json({ error: 'Слишком много попыток. Войдите снова.' });
  }
  
  // Проверяем не истёк ли код
  if (!user.twoFactorCode || new Date() > user.twoFactorCodeExpires) {
    return res.status(400).json({ error: 'Код истёк. Войдите снова.' });
  }
  
  // Проверяем код
  if (user.twoFactorCode !== code) {
    await user.increment('twoFactorAttempts');  // +1 попытка
    return res.status(400).json({ error: 'Неверный код' });
  }
  
  // Всё верно
  await user.update({
    twoFactorCode: null,
    twoFactorCodeExpires: null,
    twoFactorAttempts: 0,
    lastLogin: new Date()
  });
  
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: userWithoutPassword });
});
```

---

## JWT — устройство и безопасность

### Структура токена

JWT состоит из трёх Base64-закодированных частей:

```
HEADER.PAYLOAD.SIGNATURE
```

**Заголовок (Header):**
```json
{ "alg": "HS256", "typ": "JWT" }
```

`HS256` — HMAC-SHA256. HMAC (Hash-based Message Authentication Code) — функция которая создаёт подпись с секретным ключом.

**Данные (Payload):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "iat": 1713523200,  // issued at — когда создан (Unix timestamp)
  "exp": 1713566400   // expires — когда истекает
}
```

**Подпись (Signature):**
```
HMAC-SHA256(
  Base64(header) + "." + Base64(payload),
  JWT_SECRET
)
```

### Как сервер верифицирует токен

```js
const decoded = jwt.verify(token, process.env.JWT_SECRET);
```

`jwt.verify` делает:
1. Разбивает токен на 3 части
2. Пересчитывает подпись из header+payload с нашим `JWT_SECRET`
3. Сравнивает с подписью из токена — должны совпасть
4. Проверяет `exp` — токен не должен быть просрочен
5. Если всё ОК — возвращает декодированный payload

Если `JWT_SECRET` изменится — все существующие токены станут невалидными (подписи не совпадут). Это инструмент принудительного разлогинивания всех пользователей.

### Что хранится в токене

В нашем случае в payload — только `{ id: user.id }`. Можно было добавить больше данных (роли, права), тогда не нужен запрос к БД при каждом запросе. Но тогда при смене прав пользователя — нужно ждать истечения токена.

Выбранный подход: минимум в токене, загрузка из БД при каждом запросе. Минус — лишний SQL-запрос, плюс — всегда актуальные данные.

---

## Система прав — многоуровневая

В проекте четыре уровня проверки прав. Понимание их поможет правильно диагностировать проблемы доступа.

### Уровень 1: isActive — базовая проверка

```js
if (!user.isActive) {
  return res.status(401).json({ error: 'Аккаунт деактивирован' });
}
```

Деактивированный пользователь не может войти в систему, даже если его токен ещё действителен. `authenticate` middleware перечитывает пользователя из БД при каждом запросе — поэтому деактивация работает мгновенно.

### Уровень 2: isAdmin — полный доступ

```js
if (req.user.isAdmin) {
  next(); // Пропустить все дальнейшие проверки
  return;
}
```

Полный администратор (`isAdmin: true`) проходит через любую проверку прав. Это "суперпользователь".

### Уровень 3: adminAccess — гранулярный доступ к разделам

```js
// В middleware/auth.js
const requireAdminAccess = (section) => (req, res, next) => {
  if (req.user.isAdmin) return next();
  if (req.user.adminAccess?.[section]) return next();
  return res.status(403).json({ error: 'Нет доступа' });
};

// В routes/reviews.js
router.get('/boards', authenticate, requireAdminAccess('reviews'), handler);
```

`adminAccess` — JSONB поле на пользователе. Позволяет назначить кому-то "администратора раздела отзывов" без полных прав.

Разделы `adminAccess`:
- `pages` — управление вики-страницами
- `sidebar` — редактор боковой панели
- `users` — управление пользователями
- `roles` — управление ролями
- `media` — медиатека
- `backup` — резервные копии
- `settings` — настройки приложения
- `courses` — управление курсами
- `kanban` — администрирование Kanban-досок
- `journal` — журнал изменений
- `reviews` — модуль отзывов

### Уровень 4: Роли и permissions — права на операции

```js
const requirePermission = (resource, action) => (req, res, next) => {
  if (req.user.isAdmin) return next();
  
  const hasPermission = req.user.Roles?.some(role => 
    role.permissions?.[resource]?.[action] === true
  );
  
  if (!hasPermission) return res.status(403).json({ error: 'Недостаточно прав' });
  next();
};

// Пример: нужно право на удаление страниц
router.delete('/:id', authenticate, requirePermission('pages', 'delete'), handler);
```

Роли — более гибкий механизм. Пользователь может иметь несколько ролей. Достаточно чтобы хотя бы одна роль имела нужное право.

### Уровень 5: Проверка доступа к конкретной записи

Некоторые проверки происходят прямо в route handler:

```js
// Доступ к Kanban-доске — проверяем BoardPermission
const permission = await BoardPermission.findOne({
  where: { boardId, userId: req.user.id }
});
if (!permission && !req.user.isAdmin) {
  return res.status(403).json({ error: 'Нет доступа к этой доске' });
}
```

Это Row-level security — права на конкретную запись, а не на весь ресурс. Пользователь может видеть одни доски Kanban но не другие.

### Схема принятия решения об доступе

```
Запрос приходит
        ↓
    authenticate
  (проверка JWT + загрузка user)
        ↓
    user.isActive?
    Нет → 401
        ↓
  requireAdminAccess('reviews')?
    user.isAdmin? → Пропустить всё
    user.adminAccess.reviews? → Ок
    Нет → 403
        ↓
  В route handler:
    Это твоя доска? BoardPermission существует?
    Нет → 403
        ↓
  Выполнить операцию
```

---

## Специфические флаги на пользователях

Помимо `adminAccess` и ролей, у пользователей есть индивидуальные boolean флаги:

```js
canEditDoctorCards: BOOLEAN   // Редактировать карточки врачей на вики-страницах
canEditAnalyses: BOOLEAN      // Редактировать справочник анализов
canEditServices: BOOLEAN      // Редактировать справочник услуг
canAccessSalary: BOOLEAN      // Доступ к зарплатному модулю (/referral-bonuses)
isBot: BOOLEAN                // Системный пользователь-бот
canManagePromotions: BOOLEAN  // Управление акциями медцентра
```

Эти флаги проверяются в route handlers или прямо на frontend:
```js
// В компоненте
{user.canEditDoctorCards && <button>Редактировать карточку</button>}

// В route handler
if (!req.user.canEditAnalyses && !req.user.isAdmin) {
  return res.status(403).json({ error: 'Нет прав' });
}
```

---

## Защита от основных уязвимостей

### SQL-инъекции

Sequelize автоматически экранирует все параметры:
```js
// Это БЕЗОПАСНО — Sequelize использует параметризованные запросы
await User.findOne({ where: { username: req.body.username } });
// Генерирует: SELECT * FROM users WHERE username = $1 (параметр передаётся отдельно)

// Так тоже БЕЗОПАСНО
await sequelize.query('SELECT * FROM users WHERE username = :name', {
  replacements: { name: req.body.username }
});

// ЭТО ОПАСНО — строковая конкатенация (в проекте не используется)
await sequelize.query(`SELECT * FROM users WHERE username = '${req.body.username}'`);
```

### XSS (Cross-Site Scripting)

При рендере пользовательского HTML-контента используется `sanitize-html`:
```js
const clean = sanitizeHtml(userContent, {
  allowedTags: ['p', 'b', 'i', 'a', 'ul', 'li'],
  allowedAttributes: { 'a': ['href'] }
});
```

Для страниц типа `html` — содержимое рендерится как есть (это намеренно для продвинутых пользователей с кастомным CSS/JS).

### CSRF (Cross-Site Request Forgery)

CSRF менее критичен при использовании JWT из localStorage (в отличие от cookie-сессий). Сторонний сайт не может получить токен из localStorage другого домена.

Тем не менее, заголовок CORS настроен через `cors()` middleware.

### Brute-force паролей

Нет explicit rate limiting, но bcrypt с 10 раундами делает каждую проверку пароля медленной (~100ms). При 10 попытках в секунду — это 360 000 в час. При 8-значном пароле из буквенно-цифровых символов — это ещё несколько лет при полном переборе.

Для 2FA — есть лимит в 5 попыток (после чего код сбрасывается).

### Безопасность файлов

Загруженные файлы сохраняются с генерированным именем (не сохраняется оригинальное имя как путь):
```js
filename: (req, file, cb) => {
  const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  const ext = path.extname(file.originalname);
  cb(null, uniqueName + ext);
}
```

Это предотвращает path traversal атаки: нельзя загрузить файл с именем `../../etc/passwd`.

---

## Управление сессиями через Socket.IO

Socket.IO-соединение тоже требует аутентификации. В `server.js`:

```js
io.use((socket, next) => {
  const token = socket.handshake.auth.token;  // Токен передаётся при подключении
  
  if (!token) return next(new Error('Требуется токен'));
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error('Неверный токен'));
  }
});
```

На клиенте токен передаётся при создании соединения:
```js
const socket = io(SOCKET_URL, {
  auth: { token: localStorage.getItem('token') }
});
```

### Отслеживание онлайн-пользователей

```js
const onlineUsers = new Map();  // userId → Set<socketId>

io.on('connection', (socket) => {
  const userId = socket.userId;
  
  // Добавить соединение (у одного пользователя может быть несколько вкладок)
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);
  
  // Оповестить всех что пользователь онлайн
  io.emit('user_status_changed', { userId, status: 'online' });
  
  socket.on('disconnect', async () => {
    const userSockets = onlineUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      
      // Только если ВСЕ вкладки закрыты — пользователь офлайн
      if (userSockets.size === 0) {
        onlineUsers.delete(userId);
        await User.update({ lastSeen: new Date() }, { where: { id: userId } });
        io.emit('user_status_changed', { userId, status: 'offline', lastSeen: new Date() });
      }
    }
  });
});
```

`Map<userId, Set<socketId>>` — это в памяти процесса. При перезапуске сервера — сбрасывается. После перезапуска все пользователи "офлайн", пока не откроют страницу снова.

---

## Токены ботов

Помимо пользовательских JWT, в системе есть токены ботов (`BotToken.token`). Это не JWT — это случайные строки, хранящиеся в БД.

Проверка токена бота:
```js
// В middleware для /bot:token/* маршрутов
const bot = await BotToken.findOne({ 
  where: { token: req.params.token, isActive: true } 
});
if (!bot) return res.status(401).json({ error: 'Неверный токен бота' });
```

Это упрощённая аутентификация: токен есть в БД — доступ разрешён. Для внутренних ботов этого достаточно.
