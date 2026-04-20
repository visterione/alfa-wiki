# Глава 6. Frontend — React

Эта глава — детальный разбор frontend-части: как работает React, как организованы компоненты, как устроен роутинг, и как конкретно устроено это приложение.

---

## Как React-приложение загружается в браузере

Понимание этого процесса важно для диагностики проблем.

### В development

```bash
cd frontend
npm start
# Запускается React dev server на порту 9000
```

Что происходит при открытии `http://localhost:9000`:
1. Webpack dev server отдаёт `public/index.html` — файл с одним `<div id="root">`
2. В `index.html` подключён бандл JavaScript (`bundle.js`)
3. Браузер выполняет JavaScript
4. `ReactDOM.render(<App />, document.getElementById('root'))` — React "монтируется" в `div#root`
5. App рендерит Layout, Router, Context провайдеры
6. Браузер отображает страницу

При изменении исходного кода — webpack автоматически пересобирает модуль и обновляет страницу (hot reload). Это **не** перезагрузка страницы — только заменяется изменённый модуль.

### В production

```bash
npm run build
# Webpack собирает всё в frontend/build/
```

Создаётся оптимизированный бандл: весь JavaScript объединяется в несколько файлов, минифицируется, разбивается на чанки (code splitting). Express отдаёт `frontend/build/index.html` для любого запроса не начинающегося с `/api`.

---

## Точка входа: index.js и App.js

### index.js

```js
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`React.StrictMode` — режим разработки, который активирует дополнительные предупреждения и дважды вызывает рендер компонентов для обнаружения побочных эффектов. В production не влияет на поведение.

### App.js — корень приложения

App.js делает несколько вещей:
1. Оборачивает всё в провайдеры контекстов (BrowserRouter, AuthProvider, SocketProvider, ThemeProvider)
2. Определяет все маршруты приложения
3. Защищает маршруты через ProtectedRoute

```js
function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <ThemeProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              
              <Route path="/" element={
                <ProtectedRoute>
                  <Layout />    {/* Шаблон с сайдбаром и хедером */}
                </ProtectedRoute>
              }>
                {/* Вложенные маршруты рендерятся внутри Layout через <Outlet /> */}
                <Route index element={<Dashboard />} />
                <Route path="page/:slug" element={<PageView />} />
                <Route path="kanban" element={<BoardsList />} />
                
                <Route path="admin/users" element={
                  <ProtectedRoute requireAdminAccess="users">
                    <AdminUsers />
                  </ProtectedRoute>
                } />
              </Route>
            </Routes>
          </ThemeProvider>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
```

### ProtectedRoute — защита маршрутов

```js
function ProtectedRoute({ children, requireAdminAccess }) {
  const { user, loading, hasAdminAccess } = useContext(AuthContext);
  const location = useLocation();
  
  if (loading) return <LoadingSpinner />;
  
  if (!user) {
    // Не авторизован — перенаправить на логин
    // Сохраняем URL куда хотел попасть пользователь (чтобы вернуться после логина)
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  
  if (requireAdminAccess && !hasAdminAccess(requireAdminAccess)) {
    // Нет нужных прав — на главную
    return <Navigate to="/" replace />;
  }
  
  return children;
}
```

`useLocation()` — хук React Router, возвращает текущий объект location. `state={{ from: location }}` передаёт информацию о целевом URL через state навигации. После логина можно сделать `navigate(location.state?.from || '/')` — вернуться куда хотел.

---

## Контексты — глобальное состояние

### Что такое Context API

`Context` решает проблему "prop drilling" — передачи данных через много уровней компонентов. Без контекста:

```
App
  └── Layout
        └── Header
              └── UserMenu
                    └── UserAvatar  ← нужны данные user
```

Нужно было бы передавать `user` через каждый уровень: `<Layout user={user}>`, `<Header user={user}>`, `<UserMenu user={user}>`, `<UserAvatar user={user}>`. Это "prop drilling" — неудобно.

С Context:
```js
// Объявить контекст
const AuthContext = createContext(null);

// Провайдер оборачивает всё приложение
function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// Любой компонент в дереве может получить данные напрямую
function UserAvatar() {
  const { user } = useContext(AuthContext);  // Без prop drilling!
  return <img src={user?.avatar} />;
}
```

### AuthContext — разобранный

`AuthContext.js` — самый важный контекст. Хранит всё о текущем пользователе и методы работы с сессией.

**Состояние:**
```js
const [user, setUser] = useState(null);    // null если не залогинен
const [loading, setLoading] = useState(true); // true пока проверяем localStorage
```

**Инициализация при загрузке страницы:**
```js
useEffect(() => {
  const savedToken = localStorage.getItem('token');
  const savedUser = localStorage.getItem('user');
  
  if (savedToken && savedUser) {
    setUser(JSON.parse(savedUser));
    
    // Верифицировать токен и получить свежие данные
    api.auth.verify()
      .then(freshUser => setUser(freshUser))
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  } else {
    setLoading(false);
  }
}, []); // Один раз при монтировании
```

**Методы:**
```js
const login = async (username, password) => {
  const data = await api.auth.login({ username, password });
  if (!data.requiresTwoFactor) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
  }
  return data;
};

const logout = () => {
  localStorage.clear();
  setUser(null);
  // Socket.IO автоматически закроется
};

const updateUser = (newData) => {
  const updated = { ...user, ...newData };
  localStorage.setItem('user', JSON.stringify(updated));
  setUser(updated);
};

const hasAdminAccess = (section) => {
  if (!user) return false;
  if (user.isAdmin) return true;
  return user.adminAccess?.[section] === true;
};

const hasPermission = (resource, action) => {
  if (!user) return false;
  if (user.isAdmin) return true;
  return user.Roles?.some(role => role.permissions?.[resource]?.[action]);
};
```

**Экспорт (что доступно всем компонентам):**
```js
const value = {
  user,
  loading,
  login,
  logout,
  updateUser,
  refreshUser: async () => { /* перезагрузить из API */ },
  hasPermission,
  hasAdminAccess,
  isAdmin: user?.isAdmin ?? false
};

return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
```

### SocketContext — разобранный

```js
function SocketProvider({ children }) {
  const { user } = useContext(AuthContext);
  const [socket, setSocket] = useState(null);
  
  useEffect(() => {
    if (!user) {
      // Не залогинен — отключить сокет если был
      if (socket) { socket.disconnect(); setSocket(null); }
      return;
    }
    
    // Создать Socket.IO соединение
    const newSocket = io(BASE_URL, {
      auth: { token: localStorage.getItem('token') }
    });
    
    // Войти в личную комнату
    newSocket.emit('join', user.id);
    
    // Слушать уведомления
    newSocket.on('new_notification', handleNotification);
    newSocket.on('user_status_changed', handleStatusChange);
    newSocket.on('bring_to_front', handleBringToFront);
    
    setSocket(newSocket);
    
    return () => {
      newSocket.disconnect();  // Очистка при размонтировании
    };
  }, [user?.id]); // Переподключиться если изменился пользователь
  
  return (
    <SocketContext.Provider value={{ socket }}>
      {children}
    </SocketContext.Provider>
  );
}
```

**Обработка уведомлений:**
```js
const handleNotification = async (notification) => {
  // Показать desktop-уведомление (если Tauri)
  if (isTauri && 'sendNotification' in tauriNotification) {
    await tauriNotification.sendNotification({
      title: notification.title || 'Альфа Вики',
      body: notification.message
    });
  }
  
  // Обновить счётчик непрочитанных
  setUnreadCount(prev => prev + 1);
  
  // Обновить иконку приложения в трее
  updateBadge(unreadCount + 1);
  
  // Проиграть звук
  new Audio('/sounds/notification.mp3').play().catch(() => {});
};
```

---

## Роутинг — React Router v6

React Router v6 — это способ создать "иллюзию страниц" в SPA. URL меняется, но HTML-страница не перезагружается — меняется только рендеримый компонент.

### Как это работает технически

Браузер имеет History API: `history.pushState()` изменяет URL без перезагрузки страницы. React Router использует это.

```js
// При нажатии на Link
import { Link } from 'react-router-dom';
<Link to="/kanban">Канбан</Link>

// React Router перехватывает клик
// Вызывает history.pushState('/kanban')
// URL в браузере меняется
// React Router находит matching Route и рендерит нужный компонент
// Страница НЕ перезагружается
```

### Типы маршрутов в приложении

**Публичные маршруты** — доступны без авторизации:
```js
<Route path="/login" element={<Login />} />
```

**Защищённые маршруты** — требуют авторизации:
```js
<Route path="/kanban" element={
  <ProtectedRoute>
    <BoardsList />
  </ProtectedRoute>
} />
```

**Защищённые с правами** — требуют конкретные `adminAccess`:
```js
<Route path="/admin/users" element={
  <ProtectedRoute requireAdminAccess="users">
    <AdminUsers />
  </ProtectedRoute>
} />
```

**Вложенные маршруты** — все основные страницы вложены в Layout:
```js
<Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
  <Route index element={<Dashboard />} />          {/* / */}
  <Route path="page/:slug" element={<PageView />} />  {/* /page/doctor-abc */}
</Route>
```

В `Layout.js` есть компонент `<Outlet />` от React Router — это "дырка" куда рендерится вложенный маршрут.

### Параметры маршрутов

```js
// Маршрут с параметром
<Route path="/page/:slug" element={<PageView />} />
<Route path="/kanban/board/:id" element={<Kanban />} />

// В компоненте
import { useParams } from 'react-router-dom';

function PageView() {
  const { slug } = useParams();
  // slug === 'doctor-oncology' для URL /page/doctor-oncology
  
  useEffect(() => {
    api.pages.getBySlug(slug).then(setPage);
  }, [slug]);
}
```

### Навигация из кода

```js
import { useNavigate } from 'react-router-dom';

function SomeComponent() {
  const navigate = useNavigate();
  
  const handleSave = async () => {
    await api.pages.create(data);
    navigate('/');                         // На главную
    navigate(`/page/${newPage.slug}`);    // На конкретную страницу
    navigate(-1);                          // Назад
  };
}
```

---

## Паттерны React — как написан этот проект

### Паттерн: загрузка данных при монтировании

Это самый распространённый паттерн в проекте. Встречается в каждой странице:

```js
function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  useEffect(() => {
    loadUsers();
  }, []); // Загрузить один раз при открытии страницы
  
  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await api.users.getAll();
      setUsers(data);
    } catch (err) {
      setError('Ошибка загрузки');
      toast.error('Ошибка загрузки пользователей');
    } finally {
      setLoading(false);
    }
  };
  
  if (loading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="error">{error}</div>;
  
  return (
    <div>
      {users.map(user => <UserRow key={user.id} user={user} onDelete={handleDelete} onRefresh={loadUsers} />)}
    </div>
  );
}
```

`finally` в try/catch/finally — выполняется всегда, независимо от того была ошибка или нет. Идеально для `setLoading(false)`.

### Паттерн: оптимистичное обновление

Иногда обновляем UI сразу, не дожидаясь ответа сервера:

```js
const handleToggleFavorite = async (pageId, isCurrentlyFavorite) => {
  // Сразу обновить UI (оптимистично)
  setPages(prev => prev.map(p =>
    p.id === pageId ? { ...p, isFavorite: !isCurrentlyFavorite } : p
  ));
  
  try {
    await api.favorites.toggle(pageId);
  } catch (err) {
    // Если ошибка — откатить изменение
    setPages(prev => prev.map(p =>
      p.id === pageId ? { ...p, isFavorite: isCurrentlyFavorite } : p
    ));
    toast.error('Ошибка');
  }
};
```

### Паттерн: контролируемые формы

```js
function EditUserModal({ user, onSave, onClose }) {
  // Состояние формы инициализируется данными пользователя
  const [formData, setFormData] = useState({
    displayName: user.displayName || '',
    email: user.email || '',
    isAdmin: user.isAdmin || false
  });
  
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();  // Предотвратить перезагрузку страницы
    await api.users.update(user.id, formData);
    onSave();  // Уведомить родительский компонент
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input
        name="displayName"
        value={formData.displayName}
        onChange={handleChange}
      />
      <input
        type="checkbox"
        name="isAdmin"
        checked={formData.isAdmin}
        onChange={handleChange}
      />
      <button type="submit">Сохранить</button>
      <button type="button" onClick={onClose}>Отмена</button>
    </form>
  );
}
```

`[name]: value` — вычисляемое имя свойства (computed property name). Вместо `formData.displayName = value` или отдельного обработчика для каждого поля — один универсальный `handleChange`.

### Паттерн: поднятие состояния (lifting state up)

Когда два компонента должны разделять состояние — оно хранится в их ближайшем общем родителе:

```js
// Родитель хранит состояние
function ReviewBoard() {
  const [selectedReview, setSelectedReview] = useState(null);
  
  return (
    <div>
      {/* Колонки получают данные и колбэк */}
      <BoardColumn 
        reviews={newReviews} 
        onReviewClick={setSelectedReview}  // Колбэк меняет состояние родителя
      />
      
      {/* Детальная панель получает выбранный отзыв */}
      {selectedReview && (
        <ReviewDetail 
          review={selectedReview}
          onClose={() => setSelectedReview(null)}
        />
      )}
    </div>
  );
}
```

### Паттерн: мемоизация (useCallback, useMemo)

Для оптимизации производительности — предотвратить пересоздание функций и значений при каждом рендере:

```js
// useCallback — мемоизировать функцию
const handleDelete = useCallback(async (taskId) => {
  await api.kanban.deleteTask(taskId);
  setTasks(prev => prev.filter(t => t.id !== taskId));
}, []); // Пересоздаётся только если изменились зависимости

// useMemo — мемоизировать вычисляемое значение
const sortedTasks = useMemo(() => {
  return [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
}, [tasks]); // Пересчитывается только если tasks изменился
```

В этом проекте `useCallback/useMemo` используются умеренно — только где это действительно нужно.

---

## Компоненты — разбор ключевых

### Layout.js — оболочка приложения

Layout — "скелет" интерфейса после логина. Рендерит:
- Левую панель (Sidebar)
- Верхнюю панель (Header)
- Область контента — `<Outlet />` из React Router

```js
function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  return (
    <div className={`layout ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      <Sidebar onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="main-content">
        <Header sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        <main>
          <Outlet />  {/* Здесь рендерится текущая страница */}
        </main>
      </div>
    </div>
  );
}
```

`<Outlet />` — это "точка вставки" для вложенных маршрутов в React Router v6. Когда URL `/kanban` — здесь рендерится `<BoardsList />`. Когда `/admin/users` — `<AdminUsers />`.

### Editor.js — TipTap редактор

TipTap — основной редактор для вики-страниц. Конфигурируется с расширениями:

```js
function Editor({ content, onChange, editable }) {
  const editor = useEditor({
    extensions: [
      StarterKit,               // Базовые: заголовки, жирный, курсив, списки
      Image,                    // Вставка изображений
      Table.configure({...}),   // Таблицы
      Link.configure({...}),    // Ссылки
      Highlight,                // Подсветка текста
      TextAlign,                // Выравнивание
      // ... и другие из EditorExtensions.js
    ],
    content,                    // Начальное содержимое (HTML)
    editable,                   // Режим редактирования
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());  // При каждом изменении — сохранить HTML
    }
  });
  
  return (
    <div className="editor">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
```

TipTap работает с двумя форматами:
- `editor.getHTML()` — получить как HTML строку (хранится в БД)
- `editor.getJSON()` — получить как JSON (для сложных операций)

### ContentRenderer.js — рендер содержимого страниц

При просмотре страницы (не редактировании) используется ContentRenderer:

```js
function ContentRenderer({ page }) {
  switch (page.contentType) {
    case 'wysiwyg':
      // Рендер TipTap HTML
      return (
        <div
          className="page-content tiptap-content"
          dangerouslySetInnerHTML={{ __html: page.content }}
        />
      );
    
    case 'html':
      // Кастомный HTML с CSS/JS — в iframe для изоляции
      return (
        <iframe
          srcDoc={`
            <style>${page.customCss}</style>
            ${page.content}
            <script>${page.customJs}</script>
          `}
          className="html-page-frame"
        />
      );
    
    case 'spreadsheet':
      return <SpreadsheetViewer content={page.content} />;
    
    case 'file':
      return <FilePreview mediaId={page.mediaId} />;
    
    default:
      return null;
  }
}
```

`dangerouslySetInnerHTML` — намеренно "опасное" название чтобы разработчик думал о XSS. Здесь это безопасно потому что:
- TipTap санитизирует входные данные
- Только администраторы могут редактировать страницы

Для `html`-страниц используется `<iframe>` — полная изоляция: скрипты и стили не влияют на основное приложение.

---

## api.js — централизованный HTTP-клиент

`frontend/src/services/api.js` — единственное место где делаются HTTP-запросы. Все компоненты импортируют из него.

### Создание axios-инстанса

```js
import axios from 'axios';

// Определить BASE_URL
const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;
const BASE_URL = process.env.REACT_APP_API_URL
  || (isTauri ? 'http://192.168.22.39:9001' : `${window.location.protocol}//${window.location.hostname}:9001`);

// Создать инстанс с базовым URL
const api = axios.create({
  baseURL: BASE_URL
});
```

**Зачем не использовать `axios` напрямую?** Создание инстанса позволяет настроить общие параметры (baseURL, заголовки, таймауты) один раз. Все запросы через инстанс автоматически получают эти настройки.

### Интерцепторы

```js
// Request interceptor — добавляет токен к каждому запросу
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — обрабатывает глобальные ошибки
api.interceptors.response.use(
  (response) => response.data,  // Автоматически извлекать .data из ответа
  (error) => {
    if (error.response?.status === 401) {
      // Токен истёк или невалиден
      localStorage.clear();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

Обрати внимание: response interceptor возвращает `response.data`. Это означает что в компонентах не нужно писать `.data`:

```js
// Без interceptor: const result = await axios.get('/api/users'); const users = result.data;
// С interceptor:
const users = await api.get('/users');  // Сразу массив пользователей
```

### Организация методов

```js
export const auth = {
  login: (data) => api.post('/api/auth/login', data),
  logout: () => api.post('/api/auth/logout'),
  me: () => api.get('/api/auth/me'),
  verify: () => api.get('/api/auth/verify'),
  changePassword: (data) => api.post('/api/auth/change-password', data),
};

export const users = {
  getAll: (params) => api.get('/api/users', { params }),
  getById: (id) => api.get(`/api/users/${id}`),
  create: (data) => api.post('/api/users', data),
  update: (id, data) => api.put(`/api/users/${id}`, data),
  delete: (id) => api.delete(`/api/users/${id}`),
};

// И так для всех 32 пространств имён...
```

Использование в компонентах:
```js
import * as api from '../services/api';

// Загрузить всех пользователей
const users = await api.users.getAll();

// Создать пользователя
const newUser = await api.users.create({ username: 'ivan', password: 'secret' });

// Обновить
await api.users.update(userId, { displayName: 'Иван Иванов' });

// Удалить
await api.users.delete(userId);
```

---

## Управление файлами и загрузка

### Загрузка файла из компонента

```js
const handleFileUpload = async (file) => {
  const formData = new FormData();
  formData.append('file', file);  // Имя поля должно совпадать с multer на сервере
  
  try {
    const uploaded = await api.post('/api/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event) => {
        const percent = Math.round((event.loaded * 100) / event.total);
        setUploadProgress(percent);
      }
    });
    
    setMedia(prev => [...prev, uploaded]);
    toast.success('Файл загружен');
  } catch (err) {
    toast.error('Ошибка загрузки');
  }
};
```

`FormData` — специальный объект для отправки файлов. При `append('file', file)` — добавляется файл под именем `file`. На сервере `multer.single('file')` — принимает файл с этим именем.

### Отображение файлов

Файлы отдаются как статика через Express. URL формируется из пути в БД:
```js
// В таблице media: path = '2026-04/image-abc123.jpg'
// Доступно по URL: http://192.168.22.39:9001/2026-04/image-abc123.jpg

function MediaImage({ media }) {
  return <img src={`${BASE_URL}/${media.path}`} alt={media.alt} />;
}
```

---

## Уведомления (react-hot-toast)

`react-hot-toast` — библиотека всплывающих уведомлений. Использование очень простое:

```js
import toast from 'react-hot-toast';

toast.success('Сохранено!');
toast.error('Ошибка сохранения');
toast.loading('Загрузка...');
toast('Обычное уведомление');

// С кастомными настройками
toast.success('Удалено', { duration: 2000, position: 'bottom-right' });

// Promise toast — автоматически меняет состояние
toast.promise(
  api.users.delete(id),
  {
    loading: 'Удаление...',
    success: 'Пользователь удалён',
    error: 'Ошибка удаления'
  }
);
```

Чтобы тосты работали, нужен `<Toaster />` где-то в дереве компонентов (в `App.js` или `Layout.js`):
```js
import { Toaster } from 'react-hot-toast';

function App() {
  return (
    <>
      <Routes>...</Routes>
      <Toaster position="top-right" />
    </>
  );
}
```

---

## CSS в проекте

Проект не использует CSS-in-JS (styled-components, Emotion). Используется классический подход: каждый компонент/страница имеет свой `.css` файл.

```
PageView.js
PageView.css
```

```js
// В PageView.js
import './PageView.css';

function PageView() {
  return <div className="page-view">...</div>;
}
```

Стили глобальные: `import './PageView.css'` добавляет стили в глобальную область видимости. При больших проектах это может привести к конфликтам имён классов. Здесь это не проблема — именование достаточно уникальное.

### Тёмная/светлая тема

`ThemeContext.js` управляет темой. Реализация через CSS переменные и класс на `body`:

```js
function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(
    localStorage.getItem('theme') || 'light'
  );
  
  useEffect(() => {
    document.body.className = `theme-${theme}`;  // Класс на body
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

В CSS:
```css
.theme-light { --bg-color: #ffffff; --text-color: #333333; }
.theme-dark  { --bg-color: #1a1a2e; --text-color: #e0e0e0; }

.some-component {
  background: var(--bg-color);
  color: var(--text-color);
}
```

---

## craco.config.js — настройка Webpack

CRA (Create React App) не даёт напрямую изменять webpack-конфиг. `craco` (`Create React App Configuration Override`) позволяет это.

В проекте `craco.config.js` делает одно важное дело:

```js
module.exports = {
  webpack: {
    plugins: {
      add: [
        new webpack.ProvidePlugin({
          $: 'jquery',
          jQuery: 'jquery',
          'window.jQuery': 'jquery'
        })
      ]
    }
  }
};
```

`ProvidePlugin` делает jQuery глобально доступным как `$`, `jQuery` и `window.jQuery`. Это нужно потому что LuckySheet написан с расчётом на то, что jQuery — глобальная переменная (как в старые времена).

Без этого LuckySheet падал бы с ошибкой `$ is not defined`.
