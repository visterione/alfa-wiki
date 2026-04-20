# Глава 10. Как добавить новый функционал

Это практическая глава — пошаговые инструкции как правильно добавить новые маршруты, модели, страницы. После прочтения ты сможешь самостоятельно расширять проект, следуя установленным паттернам.

---

## Общий принцип: что нужно добавить для нового раздела

Допустим, нужен новый раздел «Поставщики» (suppliers). Чтобы он работал полноценно, нужно:

```
Backend:
  1. Таблица в БД (миграция SQL)
  2. Sequelize-модель (в models/index.js)
  3. Route handler (routes/suppliers.js)
  4. Регистрация маршрута (server.js)

Frontend:
  5. API-методы (services/api.js)
  6. Страница-компонент (pages/Suppliers.js + .css)
  7. Маршрут в App.js
  8. Ссылка в сайдбаре (через AdminSidebar)
```

Разберём каждый шаг детально.

---

## Шаг 1. Миграция — создать таблицу

Создаём файл `backend/migrations/create-suppliers.sql`:

```sql
-- Соглашение по именованию: lowercase, snake_case, plural
CREATE TABLE IF NOT EXISTS suppliers (
  -- Всегда UUID первичный ключ
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Обязательные поля
  name VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  
  -- Произвольные данные в JSONB
  address JSONB,
  -- Пример: { "city": "Москва", "street": "...", "zip": "..." }
  
  -- Файлы (ссылки)
  contract_file VARCHAR(1000),
  
  -- Мягкий признак "активен"
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Кто создал
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Автоматические временные метки
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Индекс для поиска по имени (частая операция)
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

-- Индекс для фильтрации активных
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active ON suppliers(is_active);
```

Применяем:
```bash
psql -U postgres -d alfa_wiki -f "backend/migrations/create-suppliers.sql"
```

**Почему `gen_random_uuid()` а не `uuid_generate_v4()`?**

В разных местах проекта встречаются оба варианта. `gen_random_uuid()` — встроена в PostgreSQL 13+, не требует расширения. `uuid_generate_v4()` — из расширения `uuid-ossp`, которое нужно установить отдельно (`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`). В новых миграциях лучше использовать `gen_random_uuid()`.

---

## Шаг 2. Sequelize-модель — описать таблицу

Открываем `backend/models/index.js`. Все модели определены в одном файле. Добавляем в конец, перед блоком ассоциаций:

```js
// ===== Поставщики =====

const Supplier = sequelize.define('Supplier', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  contactPerson: {
    type: DataTypes.STRING(255)
    // allowNull: true по умолчанию если не указано
  },
  phone: {
    type: DataTypes.STRING(50)
  },
  email: {
    type: DataTypes.STRING(255)
  },
  address: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  contractFile: {
    type: DataTypes.STRING(1000)
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  createdBy: {
    type: DataTypes.UUID
  }
}, {
  tableName: 'suppliers',  // Явно указываем имя таблицы
  timestamps: true          // Автоматические createdAt, updatedAt
});
```

Обрати внимание: в Sequelize поля называются в **camelCase** (`contactPerson`), а в БД — в **snake_case** (`contact_person`). Sequelize автоматически конвертирует при запросах (это поведение по умолчанию через `underscored: true` в глобальных настройках или явно).

Добавляем ассоциацию (в блоке ассоциаций внизу файла):
```js
// Поставщик создан пользователем
Supplier.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
User.hasMany(Supplier, { foreignKey: 'createdBy' });
```

Добавляем в экспорт в конце файла:
```js
module.exports = {
  sequelize,
  // ... все существующие модели ...
  Supplier,  // Добавить сюда
};
```

---

## Шаг 3. Route handler — логика API

Создаём `backend/routes/suppliers.js`:

```js
const express = require('express');
const router = express.Router();
const { Supplier, User } = require('../models');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const { Op } = require('sequelize');

// GET /api/suppliers — список всех поставщиков
// Параметры: ?search=текст&active=true&page=1&limit=20
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, active, page = 1, limit = 20 } = req.query;
    
    // Строим условие WHERE динамически
    const where = {};
    
    if (search) {
      where.name = { [Op.iLike]: `%${search}%` };
      // Op.iLike — case-insensitive LIKE
    }
    
    if (active !== undefined) {
      where.isActive = active === 'true';
    }
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const { count, rows } = await Supplier.findAndCountAll({
      where,
      include: [
        // Присоединяем создателя (только нужные поля, не пароль)
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'displayName', 'avatar']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset
    });
    
    res.json({
      suppliers: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / parseInt(limit))
    });
    
  } catch (error) {
    console.error('GET /suppliers error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/suppliers/:id — один поставщик
router.get('/:id', authenticate, async (req, res) => {
  try {
    const supplier = await Supplier.findByPk(req.params.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'displayName'] }]
    });
    
    if (!supplier) {
      return res.status(404).json({ error: 'Поставщик не найден' });
    }
    
    res.json(supplier);
    
  } catch (error) {
    console.error('GET /suppliers/:id error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/suppliers — создать поставщика
// Только администраторы могут создавать
router.post('/', authenticate, requireAdminAccess('settings'), async (req, res) => {
  try {
    const { name, contactPerson, phone, email, address } = req.body;
    
    // Базовая валидация
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Название обязательно' });
    }
    
    const supplier = await Supplier.create({
      name: name.trim(),
      contactPerson,
      phone,
      email,
      address,
      createdBy: req.user.id
    });
    
    // Загружаем с ассоциациями для ответа
    const full = await Supplier.findByPk(supplier.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'displayName'] }]
    });
    
    res.status(201).json(full);
    
  } catch (error) {
    console.error('POST /suppliers error:', error);
    res.status(500).json({ error: 'Ошибка создания' });
  }
});

// PUT /api/suppliers/:id — обновить поставщика
router.put('/:id', authenticate, requireAdminAccess('settings'), async (req, res) => {
  try {
    const supplier = await Supplier.findByPk(req.params.id);
    
    if (!supplier) {
      return res.status(404).json({ error: 'Поставщик не найден' });
    }
    
    // Обновляем только переданные поля (не перезаписываем всё)
    const { name, contactPerson, phone, email, address, isActive } = req.body;
    
    await supplier.update({
      ...(name !== undefined && { name }),
      ...(contactPerson !== undefined && { contactPerson }),
      ...(phone !== undefined && { phone }),
      ...(email !== undefined && { email }),
      ...(address !== undefined && { address }),
      ...(isActive !== undefined && { isActive })
    });
    
    res.json(supplier);
    
  } catch (error) {
    console.error('PUT /suppliers/:id error:', error);
    res.status(500).json({ error: 'Ошибка обновления' });
  }
});

// DELETE /api/suppliers/:id — удалить поставщика
router.delete('/:id', authenticate, requireAdminAccess('settings'), async (req, res) => {
  try {
    const supplier = await Supplier.findByPk(req.params.id);
    
    if (!supplier) {
      return res.status(404).json({ error: 'Поставщик не найден' });
    }
    
    await supplier.destroy();
    
    res.status(204).send();  // 204 No Content — успех без тела ответа
    
  } catch (error) {
    console.error('DELETE /suppliers/:id error:', error);
    res.status(500).json({ error: 'Ошибка удаления' });
  }
});

module.exports = router;
```

Паттерн `...(field !== undefined && { field })` — обновляем только переданные поля. Если клиент не передал `phone` — существующее значение не перезаписывается `undefined`.

---

## Шаг 4. Зарегистрировать маршрут в server.js

Открываем `backend/server.js`. Находим блок где подключаются все роуты (после строк `const usersRouter = require('./routes/users')` и т.д.):

```js
// Добавить импорт
const suppliersRouter = require('./routes/suppliers');

// Найти блок монтирования роутов и добавить
app.use('/api/suppliers', suppliersRouter);
```

После перезапуска сервера API готов: `GET /api/suppliers`, `POST /api/suppliers` и т.д.

**Проверка без frontend** (через curl или Postman):
```bash
# Получить токен
curl -X POST http://localhost:9001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'

# Использовать токен
curl http://localhost:9001/api/suppliers \
  -H "Authorization: Bearer <токен из предыдущего ответа>"
```

---

## Шаг 5. API-методы на фронтенде

Открываем `frontend/src/services/api.js`. Находим конец файла, добавляем новое пространство имён:

```js
export const suppliers = {
  getAll: (params) => apiClient.get('/api/suppliers', { params }),
  // params: { search, active, page, limit }
  // Пример: api.suppliers.getAll({ search: 'Альфа', active: true })
  
  getById: (id) => apiClient.get(`/api/suppliers/${id}`),
  
  create: (data) => apiClient.post('/api/suppliers', data),
  
  update: (id, data) => apiClient.put(`/api/suppliers/${id}`, data),
  
  delete: (id) => apiClient.delete(`/api/suppliers/${id}`),
};
```

Теперь в любом компоненте:
```js
import { suppliers as suppliersApi } from '../services/api';
const list = await suppliersApi.getAll({ active: true });
```

---

## Шаг 6. Страница-компонент

Создаём `frontend/src/pages/Suppliers.js`:

```jsx
import React, { useState, useEffect } from 'react';
import { suppliers as suppliersApi } from '../services/api';
import toast from 'react-hot-toast';
import { Plus, Search, Edit2, Trash2 } from 'lucide-react';
import './Suppliers.css';

// SupplierModal — компонент для создания/редактирования
function SupplierModal({ supplier, onSave, onClose }) {
  const [formData, setFormData] = useState({
    name: supplier?.name || '',
    contactPerson: supplier?.contactPerson || '',
    phone: supplier?.phone || '',
    email: supplier?.email || ''
  });
  const [saving, setSaving] = useState(false);
  
  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Введите название');
      return;
    }
    
    setSaving(true);
    try {
      if (supplier) {
        await suppliersApi.update(supplier.id, formData);
        toast.success('Поставщик обновлён');
      } else {
        await suppliersApi.create(formData);
        toast.success('Поставщик создан');
      }
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h2>{supplier ? 'Редактировать поставщика' : 'Новый поставщик'}</h2>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Название *</label>
            <input
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="ООО Ромашка"
              autoFocus
            />
          </div>
          
          <div className="form-group">
            <label>Контактное лицо</label>
            <input
              name="contactPerson"
              value={formData.contactPerson}
              onChange={handleChange}
              placeholder="Иванов Иван Иванович"
            />
          </div>
          
          <div className="form-row">
            <div className="form-group">
              <label>Телефон</label>
              <input name="phone" value={formData.phone} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input name="email" type="email" value={formData.email} onChange={handleChange} />
            </div>
          </div>
          
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Основной компонент страницы
function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  
  // Загрузка данных при монтировании и при изменении поиска
  useEffect(() => {
    loadSuppliers();
  }, [search]);
  
  const loadSuppliers = async () => {
    setLoading(true);
    try {
      const data = await suppliersApi.getAll({ search: search || undefined });
      setSuppliers(data.suppliers);
    } catch (err) {
      toast.error('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };
  
  const handleDelete = async (supplier) => {
    if (!window.confirm(`Удалить поставщика "${supplier.name}"?`)) return;
    
    try {
      await suppliersApi.delete(supplier.id);
      toast.success('Удалено');
      loadSuppliers();
    } catch (err) {
      toast.error('Ошибка удаления');
    }
  };
  
  const handleSave = () => {
    setModalOpen(false);
    setEditingSupplier(null);
    loadSuppliers();
  };
  
  return (
    <div className="suppliers-page">
      <div className="page-header">
        <h1>Поставщики</h1>
        <button
          className="btn-primary"
          onClick={() => { setEditingSupplier(null); setModalOpen(true); }}
        >
          <Plus size={16} /> Добавить
        </button>
      </div>
      
      <div className="search-bar">
        <Search size={16} className="search-icon" />
        <input
          placeholder="Поиск по названию..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      
      {loading ? (
        <div className="loading">Загрузка...</div>
      ) : suppliers.length === 0 ? (
        <div className="empty-state">
          {search ? 'Ничего не найдено' : 'Поставщики не добавлены'}
        </div>
      ) : (
        <div className="suppliers-table">
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Контакт</th>
                <th>Телефон</th>
                <th>Email</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map(supplier => (
                <tr key={supplier.id}>
                  <td>{supplier.name}</td>
                  <td>{supplier.contactPerson || '—'}</td>
                  <td>{supplier.phone || '—'}</td>
                  <td>{supplier.email || '—'}</td>
                  <td className="actions-cell">
                    <button
                      className="btn-icon"
                      onClick={() => { setEditingSupplier(supplier); setModalOpen(true); }}
                      title="Редактировать"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      className="btn-icon btn-danger"
                      onClick={() => handleDelete(supplier)}
                      title="Удалить"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {modalOpen && (
        <SupplierModal
          supplier={editingSupplier}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditingSupplier(null); }}
        />
      )}
    </div>
  );
}

export default Suppliers;
```

Создаём `frontend/src/pages/Suppliers.css` — базовые стили:

```css
.suppliers-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.search-bar {
  position: relative;
  margin-bottom: 16px;
}

.search-bar .search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-secondary);
}

.search-bar input {
  width: 100%;
  padding: 8px 12px 8px 36px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.suppliers-table table {
  width: 100%;
  border-collapse: collapse;
}

.suppliers-table th,
.suppliers-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.suppliers-table th {
  font-weight: 600;
  color: var(--text-secondary);
  font-size: 13px;
}

.actions-cell {
  display: flex;
  gap: 4px;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--bg-primary);
  border-radius: 8px;
  padding: 24px;
  width: 500px;
  max-width: 90vw;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  color: var(--text-secondary);
}

.form-group input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
```

---

## Шаг 7. Маршрут в App.js

Открываем `frontend/src/App.js`. Добавляем импорт и маршрут:

```js
// Импорт в начале файла (в алфавитном порядке для читаемости)
import Suppliers from './pages/Suppliers';

// В блоке <Routes>, в нужном месте
<Route path="suppliers" element={
  <ProtectedRoute>
    <Suppliers />
  </ProtectedRoute>
} />
```

Страница теперь доступна по `/suppliers`.

---

## Шаг 8. Добавить ссылку в сайдбар

Это делается через интерфейс: `/admin/sidebar` → "Добавить элемент" → Тип "Ссылка" → URL `/suppliers` → Иконка. Не нужно менять код.

Если хочется захардкодить (для постоянных ссылок которые всегда должны быть), то в `Sidebar.js` среди фиксированных элементов навигации.

---

## Как добавить поле к существующей модели

Допустим, нужно добавить поле `website` к поставщикам.

**1. Миграция:**
```sql
-- backend/migrations/add-supplier-website.sql
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website VARCHAR(1000);
```

```bash
psql -U postgres -d alfa_wiki -f "backend/migrations/add-supplier-website.sql"
```

**2. Модель в models/index.js:**
```js
// Добавить поле в определение модели Supplier
website: {
  type: DataTypes.STRING(1000)
}
```

**3. Route handler — ничего менять не нужно** если используем `req.body` целиком. Но лучше явно добавить в destructuring:
```js
const { name, contactPerson, phone, email, address, website } = req.body;
```

**4. Frontend — добавить поле в форму:**
```jsx
<div className="form-group">
  <label>Сайт</label>
  <input name="website" value={formData.website || ''} onChange={handleChange} />
</div>
```

И в начальное состояние формы:
```js
const [formData, setFormData] = useState({
  name: supplier?.name || '',
  website: supplier?.website || '',
  // ...
});
```

---

## Как добавить связанные файлы (как AccreditationFile)

Если поставщикам нужны прикреплённые файлы (договоры, сертификаты):

**1. Новая таблица:**
```sql
CREATE TABLE supplier_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size BIGINT,
  path VARCHAR(1000) NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_supplier_files_supplier_id ON supplier_files(supplier_id);
```

`ON DELETE CASCADE` — при удалении поставщика все его файлы тоже удаляются в БД. Файлы на диске нужно удалять отдельно.

**2. Маршруты для файлов (в suppliers.js):**
```js
// GET /api/suppliers/:id/files
router.get('/:id/files', authenticate, async (req, res) => {
  const files = await SupplierFile.findAll({
    where: { supplierId: req.params.id },
    order: [['createdAt', 'DESC']]
  });
  res.json(files);
});

// POST /api/suppliers/:id/files
router.post('/:id/files', authenticate, upload.single('file'), async (req, res) => {
  const file = await SupplierFile.create({
    supplierId: req.params.id,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    path: req.file.path,
    uploadedBy: req.user.id
  });
  res.status(201).json(file);
});

// DELETE /api/suppliers/:id/files/:fileId
router.delete('/:id/files/:fileId', authenticate, async (req, res) => {
  const file = await SupplierFile.findByPk(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'Файл не найден' });
  
  // Удалить файл с диска
  fs.unlink(file.path, (err) => { if (err) console.error(err); });
  
  await file.destroy();
  res.status(204).send();
});
```

---

## Как добавить новый adminAccess раздел

Если новый раздел должен быть доступен только определённым пользователям через `adminAccess`:

**1. Backend — добавить проверку в маршруты:**
```js
// В suppliers.js
router.post('/', authenticate, requireAdminAccess('suppliers'), handler);
```

**2. Backend — обновить дефолтное значение в модели:**
```js
// В models/index.js, в модели User
adminAccess: {
  type: DataTypes.JSONB,
  defaultValue: {
    pages: false,
    sidebar: false,
    users: false,
    // ... существующие ...
    suppliers: false  // Добавить новый раздел
  }
}
```

**3. Миграция — добавить поле существующим пользователям:**
```sql
-- Добавить ключ 'suppliers: false' тем у кого его нет
UPDATE users 
SET admin_access = admin_access || '{"suppliers": false}'::jsonb
WHERE admin_access -> 'suppliers' IS NULL;
```

**4. Frontend — добавить в интерфейс управления пользователем:**

В `AdminUsers.js` в блоке где рендерятся чекбоксы adminAccess:
```jsx
<label>
  <input
    type="checkbox"
    checked={formData.adminAccess?.suppliers || false}
    onChange={e => setFormData(prev => ({
      ...prev,
      adminAccess: { ...prev.adminAccess, suppliers: e.target.checked }
    }))}
  />
  Поставщики
</label>
```

---

## Как добавить cron-задачу

Допустим, нужно проверять истекающие договоры поставщиков.

Создаём `backend/cron/suppliersCron.js`:

```js
const cron = require('node-cron');
const { Supplier } = require('../models');
const { Op } = require('sequelize');
const notificationService = require('../services/notificationService');

let io;

const start = (socketIo) => {
  io = socketIo;
  
  // Каждый день в 08:00
  cron.schedule('0 8 * * *', async () => {
    console.log('[suppliersCron] Проверка договоров...');
    
    try {
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
      
      const expiring = await Supplier.findAll({
        where: {
          contractExpiry: {
            [Op.lte]: thirtyDaysFromNow,   // До конца через 30 дней
            [Op.gte]: new Date()            // Но ещё не истёк
          },
          isActive: true
        }
      });
      
      for (const supplier of expiring) {
        // Уведомить администраторов
        // ... (аналогично accreditationsCron)
      }
      
      console.log(`[suppliersCron] Проверено, найдено ${expiring.length} истекающих`);
      
    } catch (err) {
      console.error('[suppliersCron] Ошибка:', err);
    }
  });
  
  console.log('[suppliersCron] Запущен');
};

module.exports = { start };
```

Регистрируем в `server.js`:
```js
const suppliersCron = require('./cron/suppliersCron');

// В разделе инициализации cron
suppliersCron.start(io);
```

---

## Чеклист при добавлении нового раздела

```
Backend:
[ ] SQL-миграция создана в backend/migrations/
[ ] Миграция применена на сервере
[ ] Sequelize-модель добавлена в models/index.js
[ ] Добавлена в module.exports в конце models/index.js
[ ] Ассоциации добавлены (если нужны)
[ ] Route handler создан в routes/
[ ] Маршрут зарегистрирован в server.js
[ ] Защита через authenticate + нужные проверки прав

Frontend:
[ ] API-методы добавлены в services/api.js
[ ] Компонент страницы создан в pages/
[ ] CSS файл создан рядом
[ ] Маршрут добавлен в App.js
[ ] Ссылка в сайдбар (через UI или код)

Проверка:
[ ] Сервер перезапущен, нет ошибок в логах
[ ] API отвечает через curl/Postman
[ ] Страница открывается в браузере
[ ] CRUD операции работают
[ ] Права доступа работают правильно
```
