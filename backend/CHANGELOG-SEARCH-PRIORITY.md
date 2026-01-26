# Изменения в приоритете отображения результатов поиска

**Дата:** 2026-01-25
**Файл:** `backend/routes/search.js`

## Проблема

При поиске обычные страницы и специализированные сущности (анализы, аккредитации, транспорт, врачи) отображались без учета их типа. Страницы могли показываться выше более релевантных специализированных результатов.

## Решение

Изменена логика сортировки во всех поисковых endpoints для приоритизации специализированных сущностей.

## Изменения в коде

### 1. Основной поиск (`GET /api/search`)

**Было:**
```javascript
// Sort by relevance
results.sort((a, b) => {
  const aTitle = a.title?.toLowerCase() || '';
  const bTitle = b.title?.toLowerCase() || '';
  const aTitleMatch = aTitle.includes(searchTerm);
  const bTitleMatch = bTitle.includes(searchTerm);

  if (aTitleMatch && !bTitleMatch) return -1;
  if (!aTitleMatch && bTitleMatch) return 1;

  if (aTitleMatch && bTitleMatch) {
    const aStartsWith = aTitle.startsWith(searchTerm);
    const bStartsWith = bTitle.startsWith(searchTerm);
    if (aStartsWith && !bStartsWith) return -1;
    if (!aStartsWith && bStartsWith) return 1;
  }

  return 0;
});
```

**Стало:**
```javascript
// Sort by relevance
results.sort((a, b) => {
  // Приоритет 1: Специализированные сущности (НЕ страницы) показываем выше
  const aIsSpecialized = a.type !== 'page';
  const bIsSpecialized = b.type !== 'page';

  if (aIsSpecialized && !bIsSpecialized) return -1;
  if (!aIsSpecialized && bIsSpecialized) return 1;

  // Приоритет 2: Совпадение в заголовке
  const aTitle = a.title?.toLowerCase() || '';
  const bTitle = b.title?.toLowerCase() || '';
  const aTitleMatch = aTitle.includes(searchTerm);
  const bTitleMatch = bTitle.includes(searchTerm);

  if (aTitleMatch && !bTitleMatch) return -1;
  if (!aTitleMatch && bTitleMatch) return 1;

  // Приоритет 3: Начинается ли заголовок с поискового запроса
  if (aTitleMatch && bTitleMatch) {
    const aStartsWith = aTitle.startsWith(searchTerm);
    const bStartsWith = bTitle.startsWith(searchTerm);
    if (aStartsWith && !bStartsWith) return -1;
    if (!aStartsWith && bStartsWith) return 1;
  }

  return 0;
});
```

### 2. Полнотекстовый поиск (`GET /api/search/fulltext`)

**Было:**
```javascript
results.sort((a, b) => {
  const aTitle = a.title?.toLowerCase() || '';
  const bTitle = b.title?.toLowerCase() || '';
  const aTitleMatch = aTitle.includes(searchTermLower);
  const bTitleMatch = bTitle.includes(searchTermLower);

  if (aTitleMatch && !bTitleMatch) return -1;
  if (!aTitleMatch && bTitleMatch) return 1;

  return (b.rank || 0) - (a.rank || 0);
});
```

**Стало:**
```javascript
results.sort((a, b) => {
  // Приоритет 1: Специализированные сущности (НЕ страницы) показываем выше
  const aIsSpecialized = a.type !== 'page';
  const bIsSpecialized = b.type !== 'page';

  if (aIsSpecialized && !bIsSpecialized) return -1;
  if (!aIsSpecialized && bIsSpecialized) return 1;

  // Приоритет 2: Совпадение в заголовке
  const aTitle = a.title?.toLowerCase() || '';
  const bTitle = b.title?.toLowerCase() || '';
  const aTitleMatch = aTitle.includes(searchTermLower);
  const bTitleMatch = bTitle.includes(searchTermLower);

  if (aTitleMatch && !bTitleMatch) return -1;
  if (!aTitleMatch && bTitleMatch) return 1;

  // Приоритет 3: Rank (для страниц)
  return (b.rank || 0) - (a.rank || 0);
});
```

### 3. Автодополнение (`GET /api/search/suggest`)

**Было:**
```javascript
const suggestions = [
  ...filteredPages.map(p => ({
    title: p.title,
    url: `/page/${p.slug}`,
    type: 'page'
  })),
  ...filteredIndexed.map(i => ({
    title: i.title,
    url: i.url,
    type: i.entityType
  }))
];
```

**Стало:**
```javascript
const suggestions = [
  // Сначала специализированные сущности (анализы, аккредитации, транспорт, врачи)
  ...filteredIndexed.map(i => ({
    title: i.title,
    url: i.url,
    type: i.entityType
  })),
  // Потом обычные страницы
  ...filteredPages.map(p => ({
    title: p.title,
    url: `/page/${p.slug}`,
    type: 'page'
  }))
];
```

## Новая логика приоритетов

### Порядок отображения результатов (от высшего к низшему):

1. **Специализированные сущности с совпадением в начале заголовка**
   - Анализы, аккредитации, транспорт, врачи, услуги
   - Заголовок начинается с поискового запроса

2. **Специализированные сущности с совпадением в заголовке**
   - Анализы, аккредитации, транспорт, врачи, услуги
   - Поисковый запрос есть где-то в заголовке

3. **Специализированные сущности с совпадением в контенте**
   - Поисковый запрос найден в содержимом, но не в заголовке

4. **Страницы с совпадением в начале заголовка**
   - Обычные wiki-страницы
   - Заголовок начинается с поискового запроса

5. **Страницы с совпадением в заголовке**
   - Обычные wiki-страницы
   - Поисковый запрос есть где-то в заголовке

6. **Страницы с совпадением в контенте**
   - Поисковый запрос найден в содержимом страницы

## Типы специализированных сущностей

- `analysis` - Анализы
- `accreditation` - Аккредитации
- `vehicle` - Транспорт
- `doctor` - Врачи
- `service` - Услуги

## Пример

**Поисковый запрос:** "альфа"

**Порядок результатов (было):**
1. Страница: "Внутренние телефоны - Альфа"
2. Анализ: "Альфа-Амилаза"
3. Анализ: "Альфа-фетопротеин"
4. Врач: "Иванов (работает в Альфа)"

**Порядок результатов (стало):**
1. Анализ: "Альфа-Амилаза" ⭐
2. Анализ: "Альфа-фетопротеин" ⭐
3. Врач: "Иванов (работает в Альфа)" ⭐
4. Страница: "Внутренние телефоны - Альфа"

## Преимущества

✅ Более релевантные результаты поиска
✅ Специализированные данные (анализы, врачи) приоритетнее общих страниц
✅ Улучшенный UX для регистраторов и сотрудников колл-центра
✅ Быстрый доступ к часто используемым сущностям

## Совместимость

- ✅ Обратная совместимость сохранена
- ✅ API endpoints не изменились
- ✅ Frontend не требует изменений
- ✅ Работает для всех ролей (Администратор, Регистратор, Сотрудник колл-центра, Читатель)
