# Глава 11. Паттерны кода и типичные ловушки

Эта глава — о том как написан проект изнутри: повторяющиеся паттерны, которые встречаются повсюду, и ошибки которые легко совершить если не знать как здесь всё устроено.

---

## Backend паттерны

### Паттерн: деструктуризация из req

В каждом route handler данные извлекаются из `req.body`, `req.params`, `req.query` через деструктуризацию:

```js
// Хорошо — явно указываем что берём
const { title, content, folderId, allowedRoles } = req.body;
const { id } = req.params;
const { search, page = 1, limit = 20 } = req.query;

// Плохо — непонятно откуда берутся данные
router.put('/:id', async (req, res) => {
  await Model.update(req.body, { where: { id: req.params.id } }); // Опасно!
  // Передача req.body напрямую в update — открывает возможность для Mass Assignment атаки:
  // клиент может передать { isAdmin: true } и обновить любое поле
});
```

**Mass Assignment** — уязвимость когда клиент передаёт в запросе поля которые не должен мочь изменять. Защита: явно указывать какие поля принимать.

```js
// Безопасно — только разрешённые поля
await user.update({
  displayName: req.body.displayName,
  email: req.body.email
  // isAdmin — намеренно не включаем, даже если клиент передал
});
```

### Паттерн: Sequelize Op (операторы запросов)

`Op` — импортируется из Sequelize и позволяет строить сложные WHERE условия:

```js
const { Op } = require('sequelize');

// Op.iLike — LIKE без учёта регистра
{ name: { [Op.iLike]: `%${search}%` } }
// → WHERE name ILIKE '%иванов%'

// Op.in — значение входит в список
{ status: { [Op.in]: ['new', 'in_progress'] } }
// → WHERE status IN ('new', 'in_progress')

// Op.between — диапазон
{ createdAt: { [Op.between]: [dateFrom, dateTo] } }
// → WHERE created_at BETWEEN '2026-01-01' AND '2026-04-01'

// Op.gt, Op.gte, Op.lt, Op.lte — больше/меньше
{ rating: { [Op.gte]: 4 } }
// → WHERE rating >= 4

// Op.ne — не равно
{ status: { [Op.ne]: 'archived' } }
// → WHERE status != 'archived'

// Op.is — IS NULL / IS NOT NULL
{ deletedAt: { [Op.is]: null } }
// → WHERE deleted_at IS NULL

// Op.or — ИЛИ
{ [Op.or]: [{ status: 'new' }, { status: 'in_progress' }] }
// → WHERE (status = 'new' OR status = 'in_progress')

// Op.and — И (по умолчанию, но можно явно)
{ [Op.and]: [{ isActive: true }, { rating: { [Op.gte]: 3 } }] }

// Op.contains — массив содержит элемент (для ARRAY полей)
{ allowedRoles: { [Op.contains]: [roleId] } }
// → WHERE allowed_roles @> ARRAY['uuid']::uuid[]

// Вложенные JSONB поля — через Sequelize.literal
const { Sequelize } = require('sequelize');
{ [Sequelize.literal("admin_access->>'reviews' = 'true'")] }
```

### Паттерн: findOrCreate

Часто нужно "найти запись или создать если нет":

```js
// Неэффективный способ
const existing = await Model.findOne({ where: { chatId, userId } });
if (existing) return existing;
return await Model.create({ chatId, userId });
// Проблема: race condition — два запроса могут одновременно пройти проверку

// Правильный способ
const [instance, wasCreated] = await Model.findOrCreate({
  where: { chatId, userId },        // Условие поиска
  defaults: { role: 'member' }      // Поля при создании (дополнительно к where)
});
// wasCreated === true если была создана, false если найдена
// findOrCreate атомарна — использует PostgreSQL INSERT ... ON CONFLICT DO NOTHING
```

### Паттерн: bulk операции

Для создания/обновления нескольких записей сразу:

```js
// Создать много записей одним запросом
await KanbanTask.bulkCreate([
  { title: 'Задача 1', boardId, status: 'backlog' },
  { title: 'Задача 2', boardId, status: 'backlog' }
], {
  // Обновить если уже существует (по уникальному ключу)
  updateOnDuplicate: ['title', 'status']
});

// Обновить несколько записей одним запросом
await KanbanTask.update(
  { status: 'archived', archivedAt: new Date() },  // Что обновить
  { where: { boardId, status: 'done', completedAt: { [Op.lt]: cutoffDate } } }  // Где
);
```

### Паттерн: транзакции

Когда нужно выполнить несколько операций атомарно (все или ни одной):

```js
const t = await sequelize.transaction();

try {
  // Все операции в рамках транзакции
  const board = await KanbanBoard.create({ name, ownerId }, { transaction: t });
  
  await BoardPermission.create({
    boardId: board.id,
    userId: ownerId,
    role: 'owner'
  }, { transaction: t });
  
  // Если всё ок — фиксируем
  await t.commit();
  res.status(201).json(board);
  
} catch (error) {
  // При любой ошибке — откатываем ВСЁ
  await t.rollback();
  res.status(500).json({ error: 'Ошибка создания доски' });
}
```

Без транзакции: если `board` создалась, но `BoardPermission` упала с ошибкой — в БД будет доска без владельца.

### Паттерн: include с условиями

Sequelize позволяет фильтровать JOIN:

```js
// Все курсы с количеством прошедших
const courses = await Course.findAll({
  attributes: {
    include: [
      // Подзапрос-агрегация
      [
        sequelize.fn('COUNT', sequelize.col('CourseProgresses.id')),
        'progressCount'
      ]
    ]
  },
  include: [{
    model: CourseProgress,
    attributes: [],  // Не включать поля, только для агрегации
    required: false  // LEFT JOIN (не INNER JOIN)
  }],
  group: ['Course.id']
});

// Найти пользователей с конкретной ролью
const reviewManagers = await User.findAll({
  include: [{
    model: Role,
    through: { attributes: [] },  // Не включать поля junction-таблицы
    where: { name: 'Менеджер отзывов' },  // Условие на роль
    required: true  // INNER JOIN — только у кого есть такая роль
  }],
  where: { isActive: true }
});
```

---

## Frontend паттерны

### Паттерн: useEffect с cleanup

```js
useEffect(() => {
  let cancelled = false;  // Флаг для предотвращения обновления после размонтирования
  
  const load = async () => {
    const data = await api.reviews.getBoard(boardId);
    
    // Компонент мог размонтироваться пока шёл запрос
    if (!cancelled) {
      setBoard(data);
    }
  };
  
  load();
  
  // Cleanup: устанавливаем флаг
  return () => { cancelled = true; };
}, [boardId]);
```

**Проблема без cleanup**: пользователь открыл страницу → запрос пошёл → пользователь ушёл на другую страницу (компонент размонтирован) → запрос вернулся → `setBoard(data)` вызывается на размонтированном компоненте → React предупреждение или ошибка.

### Паттерн: debounce для поиска

Не отправлять запрос на каждое нажатие клавиши:

```js
import { useState, useEffect, useRef } from 'react';

function SearchComponent() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const debounceTimer = useRef(null);
  
  useEffect(() => {
    // Отменить предыдущий таймер
    clearTimeout(debounceTimer.current);
    
    if (!query.trim()) {
      setResults([]);
      return;
    }
    
    // Подождать 300ms после последнего нажатия
    debounceTimer.current = setTimeout(async () => {
      const data = await api.search.search(query);
      setResults(data);
    }, 300);
    
    return () => clearTimeout(debounceTimer.current);
  }, [query]);
  
  return (
    <input
      value={query}
      onChange={e => setQuery(e.target.value)}
      placeholder="Поиск..."
    />
  );
}
```

Без debounce: при наборе "отзывы" (6 символов) было бы 6 HTTP-запросов вместо одного.

### Паттерн: условный рендер

Распространённые способы условного рендеринга в JSX:

```jsx
// Способ 1: тернарный оператор
{isLoading ? <Spinner /> : <Content data={data} />}

// Способ 2: логическое И (&&) — рендерит только если true
{user.isAdmin && <AdminPanel />}
// ВНИМАНИЕ: если user.canManageSuppliers равно 0 (число), рендерится "0"!
// Безопасный вариант:
{user.isAdmin === true && <AdminPanel />}
{Boolean(user.canManageSuppliers) && <AdminPanel />}

// Способ 3: ранний return
if (loading) return <Spinner />;
if (error) return <ErrorMessage text={error} />;
if (!data) return null;
return <Content data={data} />;

// Способ 4: switch для сложных случаев
const renderContent = () => {
  switch (page.contentType) {
    case 'wysiwyg': return <WysiwygRenderer content={page.content} />;
    case 'html': return <HtmlRenderer content={page.content} />;
    case 'spreadsheet': return <SpreadsheetViewer content={page.content} />;
    default: return null;
  }
};
return <div>{renderContent()}</div>;
```

### Паттерн: передача колбэков через props

В проекте компоненты часто получают колбэки для уведомления родителя:

```jsx
// Родительский компонент
function KanbanBoard() {
  const [tasks, setTasks] = useState([]);
  
  const handleTaskCreated = (newTask) => {
    setTasks(prev => [...prev, newTask]);
  };
  
  const handleTaskDeleted = (taskId) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };
  
  return (
    <div>
      {tasks.map(task => (
        <TaskCard
          key={task.id}
          task={task}
          onDelete={handleTaskDeleted}  // Передаём колбэк
        />
      ))}
      <CreateTaskButton onCreated={handleTaskCreated} />
    </div>
  );
}

// Дочерний компонент не знает как устроен родитель
// Он просто вызывает колбэк
function TaskCard({ task, onDelete }) {
  return (
    <div>
      <span>{task.title}</span>
      <button onClick={() => onDelete(task.id)}>Удалить</button>
    </div>
  );
}
```

### Паттерн: key prop в списках

```jsx
// ПЛОХО — индекс массива как ключ
{tasks.map((task, index) => (
  <TaskCard key={index} task={task} />
))}
// При изменении порядка/удалении элементов React запутается

// ХОРОШО — уникальный ID как ключ
{tasks.map(task => (
  <TaskCard key={task.id} task={task} />
))}
```

`key` — подсказка React какой DOM-элемент соответствует какому объекту данных. При изменении списка React сравнивает ключи и делает минимальные изменения DOM.

---

## Типичные ловушки

### Ловушка 1: Изменение объектов состояния напрямую

```js
// ПЛОХО — прямое изменение объекта состояния
const handleToggle = (taskId) => {
  tasks.find(t => t.id === taskId).completed = true;  // Мутация!
  setTasks(tasks);  // React не заметит изменения — тот же объект
};

// ХОРОШО — создать новый массив/объект
const handleToggle = (taskId) => {
  setTasks(prev => prev.map(t =>
    t.id === taskId ? { ...t, completed: true } : t
  ));
};
```

React отслеживает изменения через сравнение ссылок (`===`). Если передать тот же объект — React думает что ничего не изменилось и не перерисовывает.

Оператор spread (`...t`) создаёт поверхностную копию объекта: `{ ...t, completed: true }` — новый объект со всеми полями из `t`, где `completed` перезаписан.

### Ловушка 2: Закрытие над устаревшим состоянием (stale closure)

```js
// ПЛОХО
useEffect(() => {
  const timer = setInterval(() => {
    // messages здесь — значение на момент создания эффекта!
    console.log('Сообщений:', messages.length);
  }, 1000);
  return () => clearInterval(timer);
}, []); // Пустой массив — эффект не пересоздаётся

// ХОРОШО — использовать функциональный updater
const [count, setCount] = useState(0);

setInterval(() => {
  setCount(prev => prev + 1);  // prev — всегда актуальное значение
}, 1000);

// Или добавить зависимость
useEffect(() => {
  console.log('Сообщений:', messages.length);
}, [messages]); // Пересоздаётся при каждом изменении messages
```

### Ловушка 3: async в useEffect

```js
// ПЛОХО — useEffect не может быть async напрямую
useEffect(async () => {  // Это создаёт проблему!
  const data = await fetchData();
  setData(data);
}, []);

// ХОРОШО — обернуть в внутреннюю функцию
useEffect(() => {
  const load = async () => {
    const data = await fetchData();
    setData(data);
  };
  load();
}, []);
```

`useEffect` ожидает что функция вернёт либо `undefined`, либо функцию cleanup. `async` функция всегда возвращает промис — это не то что ожидает React.

### Ловушка 4: Потеря this в callback

В Node.js route handlers — не актуально (функции, не классы). Но в сервисах:

```js
// ПЛОХО
class NotificationService {
  init(io) {
    this.io = io;
  }
  sendMessage(userId, text) {
    this.io.to(`user_${userId}`).emit('notification', text);
  }
}

const service = new NotificationService();
setTimeout(service.sendMessage, 1000, userId, 'текст');
// Ошибка: this будет undefined при вызове через setTimeout
```

В проекте сервисы написаны как обычные объекты/модули (не классы с `this`), поэтому эта проблема не возникает.

### Ловушка 5: N+1 запросов к БД

```js
// ПЛОХО — N+1: 1 запрос за задачи + N запросов за пользователей
const tasks = await KanbanTask.findAll({ where: { boardId } });

for (const task of tasks) {
  // Для каждой задачи — отдельный запрос!
  task.assignees = await User.findAll({
    where: { id: { [Op.in]: task.assigneeIds } }
  });
}

// ХОРОШО — один запрос с JOIN
const tasks = await KanbanTask.findAll({
  where: { boardId },
  include: [{ model: User, as: 'assignees' }]  // JOIN
});
```

N+1 — классическая проблема ORM. При 100 задачах первый вариант делает 101 запрос, второй — 1 запрос с JOIN.

Для случаев где JOIN не подходит (assigneeIds хранится как JSONB массив) — нужен другой подход: собрать все уникальные ID и сделать один запрос:

```js
const tasks = await KanbanTask.findAll({ where: { boardId } });

// Собрать все уникальные UUID исполнителей
const allAssigneeIds = [...new Set(tasks.flatMap(t => t.assigneeIds || []))];

// Один запрос за всех пользователей
const users = await User.findAll({
  where: { id: { [Op.in]: allAssigneeIds } }
});
const usersById = Object.fromEntries(users.map(u => [u.id, u]));

// Обогатить задачи данными пользователей (без БД!)
const tasksWithAssignees = tasks.map(task => ({
  ...task.toJSON(),
  assignees: (task.assigneeIds || []).map(id => usersById[id]).filter(Boolean)
}));
```

### Ловушка 6: Не обработанные промисы

```js
// ПЛОХО — если fetchData упадёт, ошибка "проглотится"
fetchData().then(data => setData(data));

// ХОРОШО
fetchData()
  .then(data => setData(data))
  .catch(err => {
    console.error(err);
    toast.error('Ошибка загрузки');
  });

// Или через async/await с try/catch (предпочтительно)
try {
  const data = await fetchData();
  setData(data);
} catch (err) {
  console.error(err);
  toast.error('Ошибка загрузки');
}
```

В Node.js необработанные rejection промисов раньше молча "глотались". Сейчас Node.js завершает процесс с ошибкой при unhandledRejection — PM2 перезапустит, но это плохо.

### Ловушка 7: Утечки памяти в Socket.IO

```js
// ПЛОХО — обработчик добавляется при каждом рендере
function ChatComponent({ chatId }) {
  useEffect(() => {
    socket.on('new_message', handleMessage);  // Добавили
    // Но не убрали при размонтировании!
  }, [chatId]);
}
// После 10 открытий/закрытий чата — 10 обработчиков на одно событие

// ХОРОШО
useEffect(() => {
  socket.on('new_message', handleMessage);
  
  return () => {
    socket.off('new_message', handleMessage);  // Убираем при размонтировании
  };
}, [chatId]);
```

`socket.off(event, handler)` — удаляет конкретный обработчик. Если передать только `socket.off('new_message')` без второго аргумента — удалятся ВСЕ обработчики этого события.

### Ловушка 8: Синхронный код в async route handler

```js
// ПЛОХО — parseInt может вернуть NaN
router.get('/:id/tasks', async (req, res) => {
  const limit = parseInt(req.query.limit);  // NaN если не передали
  
  await KanbanTask.findAll({ limit });  // Sequelize с NaN — проблема
});

// ХОРОШО — дефолтные значения и валидация
router.get('/:id/tasks', async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;  // Дефолт 20
  const page = Math.max(1, parseInt(req.query.page) || 1);  // Минимум 1
  const offset = (page - 1) * limit;
  
  await KanbanTask.findAll({ limit, offset });
});
```

---

## JavaScript особенности которые часто путают

### Разница между == и ===

В проекте везде используется `===` (строгое равенство):

```js
// == — нестрогое сравнение (с приведением типов)
'1' == 1    // true!
null == undefined  // true!
0 == false  // true!

// === — строгое (без приведения типов)
'1' === 1   // false
null === undefined  // false
0 === false  // false
```

Почти всегда нужен `===`. Единственное исключение — проверка на `null/undefined` одновременно: `value == null` (нестрогое) ловит и `null` и `undefined`.

### Spread оператор

```js
// Spread для массивов
const arr1 = [1, 2, 3];
const arr2 = [...arr1, 4, 5];  // [1, 2, 3, 4, 5]

// Spread для объектов (поверхностное копирование)
const obj1 = { a: 1, b: 2 };
const obj2 = { ...obj1, c: 3 };      // { a: 1, b: 2, c: 3 }
const obj3 = { ...obj1, b: 'new' };  // { a: 1, b: 'new' } — перезаписали b

// В React: обновление одного поля в состоянии
setFormData(prev => ({ ...prev, email: newEmail }));
// Копируем все поля из prev, заменяем только email
```

### Optional chaining (?.) и Nullish coalescing (??)

```js
// ?. — безопасный доступ к вложенным свойствам
const city = user?.address?.city;
// Если user или address — null/undefined, вернёт undefined (не ошибку)

// ?? — значение по умолчанию (только для null/undefined)
const name = user.displayName ?? 'Аноним';
// Вернёт 'Аноним' только если displayName === null или === undefined
// В отличие от ||, не сработает для '' (пустая строка) или 0

// || — значение по умолчанию (для любого falsy)
const name = user.displayName || 'Аноним';
// Вернёт 'Аноним' если displayName === '' (пустая строка) тоже!
```

В проекте оба варианта встречаются. `??` более точный для случаев когда 0 или '' — валидные значения.

### Деструктуризация с переименованием и дефолтами

```js
// Переименование
const { displayName: name, email: userEmail } = user;
// name === user.displayName, userEmail === user.email

// Дефолтные значения при деструктуризации
const { page = 1, limit = 20, search = '' } = req.query;

// Вложенная деструктуризация
const { address: { city, street = 'Не указана' } = {} } = user;
// = {} — если address === undefined, не упадём с ошибкой

// В параметрах функции
function Component({ title, items = [], onSave }) {
  // title — обязательный, items — с дефолтом, onSave — может быть undefined
}
```

### Promise.all vs Promise.allSettled

```js
// Promise.all — останавливается при первой ошибке
try {
  const [users, roles, medCenters] = await Promise.all([
    User.findAll(),
    Role.findAll(),
    MedCenter.findAll()
  ]);
  // Если хотя бы один упал — ошибка
} catch (err) { ... }

// Promise.allSettled — выполняет все, возвращает статус каждого
const results = await Promise.allSettled([
  sendEmail(recipient1),
  sendEmail(recipient2),
  sendEmail(recipient3)
]);

results.forEach(result => {
  if (result.status === 'fulfilled') {
    console.log('Отправлено:', result.value);
  } else {
    console.error('Ошибка:', result.reason);
  }
});
// Используется в email рассылках: отправить всем, даже если некоторые упадут
```

---

## Соглашения по именованию в проекте

Понимание соглашений помогает ориентироваться в коде быстрее.

### Backend

```
routes/analyses.js      → lowercase, plural, kebab-case
models/index.js         → Все модели в одном файле (нестандартно, но так исторически)
services/emailService.js → camelCase + Service суффикс
cron/analysesCron.js    → camelCase + Cron суффикс
middleware/auth.js      → Описательное имя

Переменные:    camelCase (userId, displayName)
Константы:     UPPER_SNAKE_CASE (JWT_SECRET, MAX_FILE_SIZE)
Модели:        PascalCase (User, ReviewBoard, KanbanTask)
Экземпляры:    camelCase (user, reviewBoard, task)
```

### Frontend

```
pages/AdminUsers.js     → PascalCase, описательное (Admin + Сущность)
components/Editor.js    → PascalCase, описательное
services/api.js         → lowercase

Компоненты:    PascalCase (ReviewCard, UserModal)
Хуки:          camelCase, префикс use (useAuth, useSocket)
Обработчики:   camelCase, префикс handle (handleSubmit, handleDelete)
State:         camelCase (isLoading, selectedUser, formData)
```

### База данных

```
Таблицы:       lowercase, snake_case, plural (review_boards, kanban_tasks)
Колонки:       lowercase, snake_case (created_by, is_active)
Индексы:       idx_tablename_column (idx_messages_chat_id)
Внешние ключи: ссылаемая_таблица_id (board_id, user_id)
```

---

## Как читать незнакомый код в проекте

Когда нужно разобраться в незнакомой части:

**1. Начни с маршрута.** Найди в `server.js` куда смонтирован роутер. Открой файл роутера, найди нужный endpoint.

**2. Проследи цепочку middleware.** Какие `authenticate`, `requireAdmin`, `requireAdminAccess` вызываются до handler?

**3. Найди модели.** Какие `Model.findAll()`, `Model.create()` вызываются? Посмотри определение в `models/index.js`.

**4. Найди frontend вызов.** Поищи в `services/api.js` метод который вызывает этот endpoint. Потом `grep` по проекту где этот метод используется.

**5. Найди компонент.** Открой страницу которая использует эти данные, проследи как они рендерятся.

Инструменты:
```bash
# Найти все файлы где используется ReviewBoard
grep -r "ReviewBoard" frontend/src/ --include="*.js" -l

# Найти конкретный маршрут
grep -r "\/api\/reviews\/boards" backend/routes/ --include="*.js"

# Найти где вызывается метод API
grep -r "api\.reviews\.getBoard" frontend/src/ --include="*.js"
```
