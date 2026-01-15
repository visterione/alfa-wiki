# Система гранулярного доступа к админ-разделам

## Описание

Вместо единой роли "Администратор" с доступом ко всем разделам, теперь можно выдавать пользователям доступ к конкретным админским функциям.

## Разделы админки

1. **Страницы** (`pages`) - управление wiki-страницами
2. **Меню навигации** (`sidebar`) - настройка бокового меню
3. **Пользователи** (`users`) - управление пользователями
4. **Роли и права** (`roles`) - управление ролями и разрешениями
5. **Медиафайлы** (`media`) - загрузка и управление файлами
6. **Резервные копии** (`backup`) - бэкапы системы
7. **Настройки** (`settings`) - общие параметры системы
8. **Курсы** (`courses`) - учебные курсы

## Как это работает

### Backend

1. **Модель User** - добавлено поле `adminAccess` типа JSONB:
```javascript
adminAccess: {
  pages: false,
  sidebar: false,
  users: false,
  roles: false,
  media: false,
  backup: false,
  settings: false,
  courses: false
}
```

2. **Middleware** - новая функция `requireAdminAccess(section)`:
```javascript
const { requireAdminAccess } = require('../middleware/auth');

router.get('/admin/all', authenticate, requireAdminAccess('sidebar'), async (req, res) => {
  // Доступ только для админов или пользователей с adminAccess.sidebar
});
```

3. **Обновлённые routes:**
   - `backend/routes/sidebar.js` - использует `requireAdminAccess('sidebar')`
   - `backend/routes/roles.js` - использует `requireAdminAccess('roles')`
   - `backend/routes/settings.js` - использует `requireAdminAccess('settings')`
   - `backend/routes/backup.js` - использует `requireAdminAccess('backup')`
   - `backend/routes/courses.js` - использует `requireAdminAccess('courses')`

### Frontend

1. **AuthContext** - добавлена функция `hasAdminAccess(section)`:
```javascript
const { hasAdminAccess } = useAuth();

if (hasAdminAccess('users')) {
  // Показываем кнопку управления пользователями
}
```

2. **Header.js** - теперь показывает отдельные пункты меню для каждого раздела:
```javascript
{(isAdmin || user?.adminAccess?.pages) && (
  <Link to="/admin/pages">Страницы</Link>
)}
```

3. **App.js** - защита маршрутов через `requireAdminAccess`:
```javascript
<Route path="admin/users" element={
  <ProtectedRoute requireAdminAccess="users">
    <AdminUsers />
  </ProtectedRoute>
} />
```

4. **AdminUsers.js** - форма с чекбоксами для выбора доступов.

## Использование

### Настройка доступа пользователю

1. Откройте **Пользователи** в админке
2. Отредактируйте пользователя
3. Если пользователь НЕ является полным администратором, появится секция "Доступ к админ-разделам"
4. Отметьте нужные разделы
5. Сохраните

### Проверка доступа в коде

**Backend:**
```javascript
// В middleware
const { requireAdminAccess } = require('../middleware/auth');
router.post('/api/something', authenticate, requireAdminAccess('pages'), handler);
```

**Frontend:**
```javascript
// В компонентах
const { hasAdminAccess } = useAuth();

{hasAdminAccess('media') && (
  <button>Загрузить медиа</button>
)}
```

## Миграция

Запустите миграцию для добавления поля в БД:
```bash
psql -U your_user -d your_database -f backend/migrations/add-admin-access.sql
```

## Важные замечания

- Полные администраторы (`isAdmin: true`) имеют доступ ко всем разделам автоматически
- Гранулярные права не влияют на обычные разрешения страниц (`hasPermission`)
- Страница `/admin` (главный дашборд) доступна только полным администраторам
- Для обычных пользователей в header показываются только те ссылки, к которым есть доступ
