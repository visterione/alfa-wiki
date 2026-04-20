# Глава 2. Стек технологий

Эта глава — подробный разбор каждой технологии, которая используется в проекте. Задача не просто перечислить, а объяснить: **что это такое, как работает, зачем нужно именно здесь**.

---

## Node.js — JavaScript на сервере

### Что такое Node.js

JavaScript изначально был языком только для браузера — код выполнялся внутри Chrome, Firefox, Safari. Node.js изменил это: он взял движок V8 (тот самый, что используется в Chrome) и сделал из него среду для запуска JavaScript вне браузера — на сервере, в терминале, где угодно.

Ключевая особенность Node.js — **однопоточная событийная модель**. Это звучит как ограничение, но на практике это преимущество для серверных приложений.

### Как работает событийная модель

В традиционных серверах (например, Java Tomcat или Apache PHP) каждый входящий запрос обрабатывается в отдельном потоке. Если сервер обрабатывает 1000 одновременных запросов — нужно 1000 потоков. Потоки потребляют память и время на переключение контекста.

Node.js работает иначе. Есть **один поток** и **Event Loop** (цикл событий). Когда приходит запрос:

```
1. Запрос принят
2. Начинается операция (например, запрос к БД)
3. Node.js НЕ ждёт ответа — он регистрирует "колбэк" и берётся за следующий запрос
4. Когда БД ответила — Event Loop вызывает колбэк и обрабатывает результат
```

Это называется **non-blocking I/O** (неблокирующий ввод-вывод). Node.js никогда не "стоит и ждёт" — он всегда обрабатывает что-то другое.

Для нашего приложения это идеально: большинство операций — это ожидание БД или внешних API. Пока один запрос ждёт Sequelize, Node.js обрабатывает десятки других.

### async/await — как это выглядит в коде

В старые времена неблокирующий код писался через колбэки, что порождало "callback hell". Сейчас используется `async/await`:

```js
// Старый стиль (колбэки) — сложно читать
db.query('SELECT * FROM users', function(err, users) {
  if (err) {
    handleError(err);
    return;
  }
  users.forEach(function(user) {
    db.query('SELECT * FROM roles WHERE id = ?', [user.roleId], function(err, roles) {
      // Ещё глубже...
    });
  });
});

// Современный стиль (async/await) — читается как синхронный код
async function getUsers() {
  const users = await db.query('SELECT * FROM users');  // Ждём, НО не блокируем Event Loop
  const roles = await db.query('SELECT * FROM roles WHERE id = ?', [users[0].roleId]);
  return { users, roles };
}
```

`await` говорит: "подожди результата этой операции, но пока жди — отдай управление Event Loop". Под капотом это те же колбэки и промисы, просто с красивым синтаксисом.

Везде в backend проекта ты видишь:
```js
router.get('/', authenticate, async (req, res) => {
  try {
    const data = await Model.findAll();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

`async` перед функцией означает: эта функция асинхронная, внутри можно использовать `await`. `try/catch` ловит ошибки — если в `await` что-то пойдёт не так, ошибка попадёт в `catch`.

---

## Express — HTTP-фреймворк

### Что делает Express

Express — это тонкая прослойка над встроенным в Node.js HTTP-сервером. Без Express нужно было бы самому разбирать URL, заголовки, тело запроса, формировать ответы. Express берёт это на себя.

По сути Express — это система маршрутизации + система middleware.

### Как Express обрабатывает запрос

```
Входящий запрос: GET /api/users
                    ↓
          [middleware 1: cors]        ← Добавляет CORS-заголовки
                    ↓
          [middleware 2: helmet]      ← Добавляет security-заголовки
                    ↓
          [middleware 3: json parser] ← Парсит тело запроса
                    ↓
          [middleware 4: morgan]      ← Логирует запрос
                    ↓
          [router: /api/users]        ← Находит обработчик
                    ↓
          [authenticate]              ← Проверяет JWT
                    ↓
          [route handler]             ← Бизнес-логика, ответ
```

Каждый middleware — это функция `(req, res, next) => { ... }`. Она получает объект запроса (`req`), объект ответа (`res`) и функцию `next`. Если вызвать `next()` — обработка передаётся следующему middleware. Если не вызвать — цепочка прерывается (например, `authenticate` не вызывает `next()` если токен неверный, а сразу отвечает 401).

### Объекты req и res

```js
req.body          // Тело запроса (после json-parser)
req.params.id     // Параметр URL: /users/:id → req.params.id
req.query.search  // Query string: /users?search=иван → req.query.search
req.headers       // Заголовки запроса
req.user          // Добавляется в authenticate middleware (не встроено в Express)

res.json(data)        // Отправить JSON-ответ, Content-Type: application/json
res.status(404)       // Установить код ответа
res.status(404).json({ error: 'Not found' }) // Код + JSON
res.sendFile(path)    // Отправить файл
```

---

## PostgreSQL — база данных

### Почему реляционная БД, а не NoSQL

PostgreSQL — реляционная СУБД: данные хранятся в таблицах со строгой схемой, связи между таблицами выражаются через ключи. Альтернатива — NoSQL базы (MongoDB, Redis), где схема гибкая.

Для нашего приложения реляционная модель — правильный выбор:
- У нас много связей между сущностями: пользователь принадлежит ролям, роли имеют разрешения, страницы в папках, задачи назначены пользователям
- Нам важна целостность данных: если удаляем пользователя, все его сообщения должны быть связаны с реальными записями
- Нам нужны транзакции: изменения должны быть атомарными

### Чем PostgreSQL лучше MySQL

PostgreSQL — наиболее функционально богатый open source SQL-сервер:
- **JSONB** — хранение произвольного JSON с индексированием. В проекте активно используется: `attachments`, `workflowConfig`, `settings`, `adminAccess` — всё это JSONB поля.
- **Массивы** — поля типа `UUID[]` или `TEXT[]`. В проекте: `allowedRoles`, `keywords`.
- **Полнотекстовый поиск** — встроен в Postgres, не нужен отдельный Elasticsearch.
- **UUID** — родной тип данных с индексированием.
- **Параноидальные удаления** (soft delete) — поддерживаются через стандартный `IS NULL`.

### Как PostgreSQL работает с Node.js

Прямое соединение Node.js ↔ PostgreSQL — через драйвер `pg` (node-postgres). Но в проекте мы никогда не пишем `pg` напрямую — поверх него работает Sequelize.

---

## Sequelize — ORM

ORM (Object-Relational Mapping) — это слой, который позволяет работать с таблицами базы данных как с обычными JavaScript-объектами, не писать SQL вручную.

### Зачем нужен ORM

Без ORM работа с БД выглядит так:
```js
// Без ORM — сырой SQL
const result = await pool.query(
  `SELECT u.*, r.name as role_name 
   FROM users u 
   LEFT JOIN user_roles ur ON u.id = ur.user_id
   LEFT JOIN roles r ON ur.role_id = r.id
   WHERE u.id = $1 AND u.is_active = true`,
  [userId]
);
const user = result.rows[0];
```

С Sequelize:
```js
// С ORM — как работа с объектами
const user = await User.findByPk(userId, {
  include: [{ model: Role, through: { model: UserRole } }],
  where: { isActive: true }
});
```

Sequelize генерирует SQL автоматически. Кроме того:
- Защита от SQL-инъекций — все параметры автоматически экранируются
- Автоматические поля `createdAt`, `updatedAt` — не нужно ставить вручную
- Описание схемы в коде — не нужно отдельный SQL файл для создания таблиц
- Миграции и ассоциации

### Как описывается модель

```js
const User = sequelize.define('User', {
  // Первичный ключ — UUID, генерируется автоматически
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  
  // Строка с ограничением длины, обязательное, уникальное
  username: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  
  // Булево поле с дефолтным значением
  isAdmin: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  
  // JSONB — произвольная структура
  adminAccess: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
  
}, {
  tableName: 'users',      // Явное имя таблицы (иначе Sequelize сам придумает)
  timestamps: true,        // Автоматически добавить createdAt, updatedAt
  paranoid: false          // НЕ мягкое удаление (для Review будет true)
});
```

### Основные операции

```js
// Найти все записи
const users = await User.findAll();

// Найти с условием
const admins = await User.findAll({ where: { isAdmin: true } });

// Найти одну запись по первичному ключу
const user = await User.findByPk('some-uuid');

// Найти одну запись по условию
const user = await User.findOne({ where: { username: 'ivan' } });

// Создать запись
const newUser = await User.create({ username: 'petr', password: hashedPwd });

// Обновить запись
await user.update({ displayName: 'Пётр Петров' });

// Удалить запись
await user.destroy();

// Создать или найти (findOrCreate)
const [member, wasCreated] = await ChatMember.findOrCreate({
  where: { chatId, userId },
  defaults: { role: 'member' }  // Если создаётся — с этими полями
});
```

### Ассоциации — связи между моделями

Sequelize умеет описывать отношения между таблицами:

```js
// Один-ко-многим: у одного Chat много Messages
Chat.hasMany(Message, { foreignKey: 'chatId' });
Message.belongsTo(Chat, { foreignKey: 'chatId' });

// Многие-ко-многим: User ↔ Role через таблицу user_roles
User.belongsToMany(Role, { through: 'user_roles', foreignKey: 'userId' });
Role.belongsToMany(User, { through: 'user_roles', foreignKey: 'roleId' });
```

После этого можно делать запросы с `include` (JOIN):
```js
const user = await User.findByPk(id, {
  include: [
    { model: Role },      // Присоединит роли
    { model: MedCenter }  // И медцентры
  ]
});
// user.Roles — массив ролей
// user.MedCenters — массив медцентров
```

### Paranoid (мягкое удаление)

Для модели `Review` включён режим `paranoid: true`. Это значит что при `review.destroy()` запись физически не удаляется — Sequelize просто ставит `deletedAt = текущее_время`.

При последующих `findAll` Sequelize автоматически добавляет условие `WHERE deletedAt IS NULL`, поэтому "удалённые" записи не видны.

Зачем: если отзыв случайно удалили — можно восстановить. Для критичных данных это важно.

---

## JWT — аутентификация

### Проблема, которую решает JWT

HTTP — протокол без состояния (stateless). Каждый запрос с точки зрения сервера — новый, сервер не "помнит" предыдущие. Как тогда понять, что запрос от авторизованного пользователя?

Традиционное решение — **сессии**: сервер хранит в памяти (или в БД/Redis) информацию о залогиненных пользователях, браузер хранит идентификатор сессии в cookie. При каждом запросе — поиск по идентификатору.

**JWT (JSON Web Token)** — другой подход: всё нужное хранится в самом токене, серверу не нужно ничего хранить.

### Как устроен JWT

JWT — это строка из трёх частей, разделённых точкой:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjEyMzQ1IiwiaWF0IjoxNjE3ODU1MjAwfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c

ЗАГОЛОВОК.ДАННЫЕ.ПОДПИСЬ
```

- **Заголовок** — метаданные: алгоритм подписи (HS256)
- **Данные (payload)** — сама информация: `{ id: 'uuid', iat: timestamp, exp: timestamp }`
- **Подпись** — HMAC от заголовка+данных с секретным ключом (`JWT_SECRET`)

Важно понять: JWT **не шифруется** — его можно декодировать (Base64). Но нельзя **подделать**: без знания `JWT_SECRET` нельзя создать корректную подпись. Если кто-то изменит `id` в payload — подпись не совпадёт, сервер отклонит токен.

### Жизненный цикл токена

```
1. Логин: POST /api/auth/login { username, password }
2. Сервер проверяет пароль через bcrypt.compare()
3. Создаётся токен: jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '12h' })
4. Токен возвращается клиенту
5. Клиент сохраняет токен в localStorage
6. Каждый запрос: заголовок Authorization: Bearer <токен>
7. authenticate middleware: jwt.verify(token, JWT_SECRET) → получает { id: user.id }
8. Загружает User из БД по id → req.user
9. Если токен истёк (12 часов) — ошибка, клиент перенаправляется на /login
```

---

## bcrypt — хэширование паролей

Пароли нельзя хранить в открытом виде. Даже хэш MD5/SHA1 небезопасен — злоумышленник с rainbow tables или GPU может подобрать исходный пароль за считанные секунды.

bcrypt — специальный алгоритм для хэширования паролей. Его особенности:
- **Медленный** — намеренно. Одна операция хэширования занимает ~100ms при `saltRounds=10`. Это делает brute-force неэффективным: перебор миллиона паролей займёт 100 000 секунд.
- **Соль** — к каждому паролю добавляется уникальная случайная строка перед хэшированием. Одинаковые пароли дают разные хэши.
- **Необратим** — из хэша нельзя получить исходный пароль.

```js
// Создание хэша при регистрации/смене пароля
const hashedPassword = await bcrypt.hash(plainPassword, 10); // 10 — saltRounds

// Проверка при входе
const isValid = await bcrypt.compare(plainPassword, hashedPassword);
// Возвращает true если пароль верный
```

---

## Socket.IO — реальное время

### Проблема с HTTP для чата

HTTP работает по модели "запрос-ответ": клиент спрашивает, сервер отвечает. Для чата это не подходит: сервер не может сам по себе отправить сообщение клиенту.

Старые решения — **polling** (клиент спрашивает сервер каждые N секунд: "есть новые сообщения?"). Неэффективно: много ненужных запросов, задержка до N секунд.

### WebSocket — постоянное соединение

WebSocket — другой протокол. После начального HTTP handshake устанавливается постоянное двустороннее TCP-соединение. Теперь:
- Клиент может отправить данные серверу без HTTP-запроса
- **Сервер может отправить данные клиенту в любой момент** без запроса от клиента

Для чата это идеально: когда Иван отправляет сообщение, сервер сразу пушит его всем участникам беседы — без polling, без задержек.

### Почему Socket.IO, а не чистый WebSocket

Socket.IO — библиотека поверх WebSocket. Добавляет:
- **Автоматическое переподключение** при разрыве соединения
- **Комнаты (rooms)** — логические группы подключений (например, все участники одного чата)
- **Namespace** — изоляция событий
- **Fallback** — если WebSocket недоступен, автоматически переключается на long polling
- **Гарантию доставки** событий

### Как Socket.IO используется в проекте

```js
// СЕРВЕР: server.js
const io = new Server(server);

// Когда пользователь подключается
io.on('connection', (socket) => {
  
  // Пользователь "представляется" — входит в свою личную комнату
  socket.on('join', (userId) => {
    socket.join(`user_${userId}`);
  });
  
  // Пользователь открывает беседу
  socket.on('join_chat', (chatId) => {
    socket.join(`chat_${chatId}`);
  });
  
  // Пользователь начинает набирать
  socket.on('typing_start', ({ chatId }) => {
    // Сообщаем ВСЕМ в комнате чата КРОМЕ отправителя
    socket.to(`chat_${chatId}`).emit('user_typing', { userId, chatId });
  });
  
  // Пользователь отключился
  socket.on('disconnect', async () => {
    await User.update({ lastSeen: new Date() }, { where: { id: userId } });
    io.emit('user_status_changed', { userId, status: 'offline' });
  });
});

// Из route handler — отправить событие в комнату
io.to(`chat_${chatId}`).emit('new_message', messageObject);
io.to(`user_${userId}`).emit('new_notification', notificationData);
```

```js
// КЛИЕНТ: SocketContext.js
import { io } from 'socket.io-client';

const socket = io('http://192.168.22.39:9001');

socket.emit('join', user.id);  // Входим в личную комнату

socket.on('new_message', (message) => {
  // Обновляем UI — новое сообщение пришло
  addMessageToChat(message);
  playNotificationSound();
});

socket.on('new_notification', (notification) => {
  showDesktopNotification(notification);
});
```

Ключевое понимание: Socket.IO события — это не HTTP-запросы. Это лёгкие сообщения через постоянное TCP-соединение. Задержка — миллисекунды.

---

## React — интерфейс

### Зачем нужен фреймворк для UI

До фреймворков (или с jQuery) работа с DOM выглядела так:
```js
// Получили новые данные — нужно вручную обновить DOM
const users = await fetchUsers();
const container = document.getElementById('users-list');
container.innerHTML = '';  // Очистить
users.forEach(user => {
  const div = document.createElement('div');
  div.textContent = user.displayName;
  container.appendChild(div);
});
```

При сложном UI это превращается в кошмар: нужно следить за состоянием, вручную обновлять нужные части страницы, синхронизировать данные между компонентами.

React решает это декларативным подходом: **ты описываешь как должен выглядеть UI для заданного состояния**, React сам решает что нужно изменить в DOM.

```js
// React-подход
function UsersList({ users }) {
  return (
    <div id="users-list">
      {users.map(user => (
        <div key={user.id}>{user.displayName}</div>
      ))}
    </div>
  );
}
// Изменились users → React автоматически обновит DOM
```

### Компонент как строительный блок

Всё в React — это компоненты. Компонент — это функция (или класс), которая принимает `props` и возвращает JSX.

```js
// Маленький компонент — иконка статуса
function StatusBadge({ status }) {
  const colors = {
    new: '#gray',
    in_progress: '#blue',
    final: '#green'
  };
  
  return (
    <span style={{ backgroundColor: colors[status] }}>
      {status}
    </span>
  );
}

// Больший компонент использует меньший
function ReviewCard({ review }) {
  return (
    <div className="review-card">
      <h3>{review.patientName}</h3>
      <p>{review.reviewText}</p>
      <StatusBadge status={review.status} />  {/* Вставка компонента */}
    </div>
  );
}
```

Компоненты можно вкладывать друг в друга, создавая иерархию. Это позволяет разбивать сложный UI на управляемые части.

### Хуки — управление состоянием и эффектами

Хуки — функции, начинающиеся с `use`, которые добавляют компоненту дополнительные возможности.

**useState** — локальное состояние компонента:
```js
function Counter() {
  const [count, setCount] = useState(0);  // Начальное значение = 0
  
  return (
    <button onClick={() => setCount(count + 1)}>
      Нажали: {count}
    </button>
  );
}
// Каждый setCount вызывает перерисовку компонента с новым count
```

**useEffect** — побочные эффекты (загрузка данных, подписки, таймеры):
```js
function UserProfile({ userId }) {
  const [user, setUser] = useState(null);
  
  useEffect(() => {
    // Этот код выполнится после рендера
    api.users.getById(userId).then(data => setUser(data));
    
    // Возвращаемая функция — "cleanup", выполняется при размонтировании
    return () => {
      // Отписаться от подписок, очистить таймеры
    };
  }, [userId]); // Зависимости: повторяется при изменении userId
  
  if (!user) return <div>Загрузка...</div>;
  return <div>{user.displayName}</div>;
}
```

Массив зависимостей в `useEffect`:
- `[]` — выполнить только при монтировании компонента (один раз)
- `[userId]` — выполнить при монтировании и каждый раз когда меняется `userId`
- *(без массива)* — выполнять после каждого рендера (редко нужно)

**useContext** — получить данные из контекста (глобального хранилища):
```js
function SomeComponent() {
  const { user, logout } = useContext(AuthContext);
  return <button onClick={logout}>Выйти, {user.displayName}</button>;
}
```

**useRef** — ссылка на DOM-элемент или мутабельное значение:
```js
const inputRef = useRef(null);

// Позже: inputRef.current.focus(); — фокус на input
return <input ref={inputRef} />;
```

---

## Axios — HTTP-клиент

Axios — библиотека для HTTP-запросов в браузере (и Node.js). Альтернатива встроенному `fetch`.

### Почему не fetch

`fetch` — встроенный в браузер, работает, но менее удобен:
- Не выбрасывает ошибку при статусах 4xx/5xx (нужно проверять `response.ok`)
- Нет автоматического парсинга JSON (нужно вызывать `response.json()`)
- Нет встроенных интерцепторов
- Менее удобная отмена запросов

Axios автоматически:
- Преобразует тело запроса в JSON (и ответ обратно)
- Выбрасывает ошибку при 4xx/5xx статусах
- Позволяет добавлять интерцепторы (middleware для HTTP-запросов)

### Интерцепторы — как в проекте добавляется токен

```js
// Один раз настроили — и для ВСЕХ запросов автоматически
axiosInstance.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

Без интерцепторов пришлось бы в каждом вызове вручную добавлять токен:
```js
// Без интерцептора — повторение в каждом месте
await axios.get('/api/users', {
  headers: { Authorization: `Bearer ${localStorage.token}` }
});
```

---

## Библиотеки редакторов

### TipTap — WYSIWYG редактор

TipTap — основной редактор для вики-страниц. Построен поверх ProseMirror (мощный, но низкоуровневый движок редактирования).

TipTap предоставляет готовые расширения для: заголовков, списков, таблиц, ссылок, изображений, блоков кода, выделения цветом и т.д. Контент хранится как JSON (называется "document") или HTML.

В проекте контент страниц хранится как HTML в поле `pages.content`.

### Univer + LuckySheet — табличные редакторы

Для страниц типа `spreadsheet` используется два движка:
- **Univer** — современный, основной (как онлайн-Excel)
- **LuckySheet** — старый, сохранён для обратной совместимости со старыми страницами

Оба движка работают в браузере, данные сохраняются как JSON в поле `pages.content`.

LuckySheet требует jQuery — вот почему в `craco.config.js` есть:
```js
// Делает jQuery доступным глобально (window.$)
new webpack.ProvidePlugin({ $: 'jquery', jQuery: 'jquery' })
```

### React Flow — редактор графов

Используется только в модуле отзывов для редактора workflow. React Flow позволяет создавать интерактивные диаграммы с узлами (nodes) и связями (edges). Пользователь перетаскивает блоки, соединяет их — получается граф автоматизации.

Граф сохраняется как JSON в `ReviewBoard.workflowConfig` и исполняется на сервере через `workflowEngine.js`.

---

## Recharts — графики

Recharts — библиотека графиков для React (обёртка над D3.js). Используется в модуле статистики отзывов (`ReviewStatistics.js`): круговые диаграммы, столбчатые графики, линии трендов.

Пример использования:
```jsx
<BarChart data={stats}>
  <XAxis dataKey="month" />
  <YAxis />
  <Bar dataKey="count" fill="#8884d8" />
</BarChart>
```

---

## Lucide React — иконки

Lucide — современная библиотека SVG-иконок. Каждая иконка — это React-компонент:

```jsx
import { Users, Settings, Bell } from 'lucide-react';

<Users size={20} color="#666" />
<Settings size={24} />
<Bell size={16} />
```

Иконки — векторные (SVG), масштабируются без потери качества, стили меняются через props.

---

## @hello-pangea/dnd — Drag and Drop

Библиотека для перетаскивания элементов. Используется в Канбане для перетаскивания карточек между колонками.

Оригинальная библиотека `react-beautiful-dnd` была заброшена Atlassian, `@hello-pangea/dnd` — её форк с поддержкой React 18.

```jsx
<DragDropContext onDragEnd={handleDragEnd}>
  <Droppable droppableId="column-1">
    {(provided) => (
      <div ref={provided.innerRef} {...provided.droppableProps}>
        {tasks.map((task, index) => (
          <Draggable key={task.id} draggableId={task.id} index={index}>
            {(provided) => (
              <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps}>
                {task.title}
              </div>
            )}
          </Draggable>
        ))}
        {provided.placeholder}
      </div>
    )}
  </Droppable>
</DragDropContext>
```

---

## Tauri — Desktop приложение

Tauri — фреймворк для создания desktop-приложений на основе веб-технологий. Альтернатива Electron.

Разница с Electron:
- Electron включает в себя полный Chromium (~150MB), Tauri использует системный WebView (~5MB)
- Tauri значительно легче по размеру и потреблению памяти
- Tauri написан на Rust — backend для десктопного приложения

В нашем проекте Tauri-приложение в production просто открывает URL сервера (`http://192.168.22.39:9001`) в WebView. Это значит: не нужно отдельно собирать frontend для десктопа — тот же React-код, что в браузере.

Дополнительные возможности которые даёт Tauri (и которые используются):
- `@tauri-apps/plugin-notification` — системные desktop-уведомления
- Управление иконкой в трее
- `bring_to_front` — вывести окно на передний план
- Определение, что мы внутри Tauri: `window.__TAURI_INTERNALS__`

---

## date-fns — работа с датами

JavaScript имеет встроенный `Date`, но он неудобен для форматирования и операций. `date-fns` — библиотека утилит:

```js
import { format, addDays, differenceInDays, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

format(new Date(), 'dd MMMM yyyy', { locale: ru }) // "19 апреля 2026"
addDays(new Date(), 30) // Дата через 30 дней
differenceInDays(expirationDate, today) // Сколько дней до истечения
```

Используется в аккредитациях (сколько дней до истечения), календаре, отображении дат по всему приложению.

---

## node-cron — планировщик задач

`node-cron` — реализация cron-синтаксиса внутри Node.js. Позволяет запускать функции по расписанию.

```js
const cron = require('node-cron');

// Каждый день в 02:00
cron.schedule('0 2 * * *', async () => {
  await updateAnalysisPrices();
});

// Каждую минуту
cron.schedule('* * * * *', async () => {
  await checkMissedCalls();
});
```

Синтаксис cron: `минуты часы день_месяца месяц день_недели`
- `*` — каждое значение
- `0 2 * * *` — в 2 часа 0 минут каждый день
- `0 9,12,15,18 * * *` — в 9, 12, 15, 18 часов каждый день

Важно: cron-задачи запускаются внутри того же Node.js-процесса что и HTTP-сервер. Если сервер упал — задачи тоже остановлены. PM2 перезапускает процесс при падении.

---

## multer — загрузка файлов

HTTP multipart/form-data — формат для отправки файлов. multer — middleware для Express, который обрабатывает этот формат.

```js
const multer = require('multer');

// Настройка: куда сохранять и как именовать
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads/media/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Использование в маршруте
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  // req.file — информация о загруженном файле
  // req.file.path — путь на диске
  // req.file.originalname — оригинальное имя
  // req.file.size — размер в байтах
});
```

После сохранения multer'ом, sharp создаёт превью для изображений:
```js
await sharp(req.file.path)
  .resize(400, 400, { fit: 'inside' })
  .jpeg({ quality: 80 })
  .toFile(thumbnailPath);
```

---

## Helm и безопасность

**helmet** — набор middleware для установки заголовков безопасности:

- `Content-Security-Policy` — какие ресурсы браузер может загружать (защита от XSS)
- `X-Frame-Options` — нельзя встроить сайт в iframe (защита от clickjacking)
- `X-Content-Type-Options: nosniff` — браузер должен доверять объявленному Content-Type
- `Referrer-Policy` — какой Referer отправлять

В проекте helmet настроен с нестандартным CSP, потому что:
- Нужен `unsafe-inline` для динамических стилей в редакторах
- Нужен `unsafe-eval` для LuckySheet (он использует `eval`)
- Нужен `blob:` для предпросмотра PDF

---

## morgan — логирование HTTP

morgan — middleware для логирования входящих HTTP-запросов. В dev режиме печатает в консоль:

```
GET /api/users 200 45ms
POST /api/pages 201 123ms
GET /api/analyses?lab=invitro 200 67ms
DELETE /api/kanban/tasks/abc-123 204 12ms
```

Это очень полезно при отладке: видишь все запросы в реальном времени.

---

## pdfkit — генерация PDF

pdfkit — библиотека для программного создания PDF-документов. В проекте используется только для отчётов по отзывам.

```js
const doc = new PDFDocument({ size: 'A4' });

// Нужен кириллический шрифт — встроенные шрифты pdfkit его не поддерживают
doc.registerFont('DejaVu', 'backend/fonts/DejaVuSans.ttf');
doc.font('DejaVu');

doc.fontSize(16).text('Отчёт по отзыву', { align: 'center' });
doc.moveDown();
doc.fontSize(12).text(`Пациент: ${review.patientName}`);

// Сохранить в файл
doc.pipe(fs.createWriteStream(outputPath));
doc.end();
```

Шрифт DejaVuSans хранится в `backend/fonts/` именно потому что pdfkit по умолчанию поддерживает только латинские шрифты — для кириллицы нужно регистрировать шрифт явно.
