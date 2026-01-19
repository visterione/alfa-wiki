# Отключение пагинации при печати для всех таблиц

## Обзор изменений

Обновлены страницы **accreditations.html** и **vehicles.html** для печати всех записей без ограничений пагинации, аналогично реализации в **analyses.html**.

## Проблема

При печати таблиц на страницах аккредитаций и транспорта печатались только записи текущей страницы пагинации (50 записей). Если в таблице было больше записей, они не попадали в печатную версию.

## Решение

Реализована та же логика, что и в analyses.html:
1. **JavaScript:** Все записи рендерятся в DOM, но записи не на текущей странице скрыты через `display:none`
2. **CSS:** При печати все строки с классом `.table-row` отображаются через `display: table-row !important`

---

## 1. Изменения в accreditations.html

### JavaScript изменения
**Файл:** `backend/bot/accreditations.html` (строки 1011-1026)

**Было:**
```javascript
function renderTable() {
  var tb = document.getElementById('acc-table-body');
  if (!accreditations.length) {
    tb.innerHTML = '<tr><td colspan="6" class="acc-empty">Нет данных</td></tr>';
    return;
  }
  var start = (currentPage - 1) * pageSize;
  var end = start + pageSize;
  var pageData = accreditations.slice(start, end);

  tb.innerHTML = pageData.map(function(a) {
    var isHighlighted = highlightId && a.id === highlightId;
    return '<tr data-id="' + a.id + '"' + (isHighlighted ? ' class="acc-highlight"' : '') + '>' +
    // ...
  }).join('');
}
```

**Стало:**
```javascript
function renderTable() {
  var tb = document.getElementById('acc-table-body');
  if (!accreditations.length) {
    tb.innerHTML = '<tr><td colspan="6" class="acc-empty">Нет данных</td></tr>';
    return;
  }
  var start = (currentPage - 1) * pageSize;
  var end = start + pageSize;

  // Для печати: рендерим все записи, но скрываем те, что не на текущей странице
  tb.innerHTML = accreditations.map(function(a, index) {
    var isHighlighted = highlightId && a.id === highlightId;
    var isOnCurrentPage = index >= start && index < end;
    var displayStyle = isOnCurrentPage ? '' : ' style="display:none"';

    return '<tr data-id="' + a.id + '"' + (isHighlighted ? ' class="acc-highlight"' : '') + displayStyle + ' class="acc-table-row">' +
    // ...
  }).join('');
}
```

### CSS изменения
**Файл:** `backend/bot/accreditations.html` (строки 652-655)

Добавлено в секцию `@media print`:
```css
/* Отображаем все строки таблицы при печати (отключаем пагинацию) */
.acc-table-row {
  display: table-row !important;
}
```

---

## 2. Изменения в vehicles.html

### JavaScript изменения
**Файл:** `backend/bot/vehicles.html` (строки 1114-1132)

**Было:**
```javascript
function renderTable() {
  var tb = document.getElementById('veh-table-body');
  if (!vehicles.length) {
    tb.innerHTML = '<tr><td colspan="8" class="veh-empty">Нет данных</td></tr>';
    return;
  }
  var start = (currentPage - 1) * pageSize;
  var end = Math.min(start + pageSize, vehicles.length);
  var pageData = vehicles.slice(start, end);

  tb.innerHTML = pageData.map(function(v) {
    var isHighlighted = highlightId && v.id === highlightId;
    var dateClass = getDateClass(v.insuranceDate);
    var mileageClass = getMileageClass(v.mileage, v.nextTO);
    var condClass = getConditionClass(v.condition);

    return '<tr data-id="' + v.id + '"' + (isHighlighted ? ' class="veh-highlight"' : '') + '>' +
    // ...
  }).join('');
}
```

**Стало:**
```javascript
function renderTable() {
  var tb = document.getElementById('veh-table-body');
  if (!vehicles.length) {
    tb.innerHTML = '<tr><td colspan="8" class="veh-empty">Нет данных</td></tr>';
    return;
  }
  var start = (currentPage - 1) * pageSize;
  var end = Math.min(start + pageSize, vehicles.length);

  // Для печати: рендерим все записи, но скрываем те, что не на текущей странице
  tb.innerHTML = vehicles.map(function(v, index) {
    var isHighlighted = highlightId && v.id === highlightId;
    var isOnCurrentPage = index >= start && index < end;
    var displayStyle = isOnCurrentPage ? '' : ' style="display:none"';
    var dateClass = getDateClass(v.insuranceDate);
    var mileageClass = getMileageClass(v.mileage, v.nextTO);
    var condClass = getConditionClass(v.condition);

    return '<tr data-id="' + v.id + '"' + (isHighlighted ? ' class="veh-highlight"' : '') + displayStyle + ' class="veh-table-row">' +
    // ...
  }).join('');
}
```

### CSS изменения
**Файл:** `backend/bot/vehicles.html` (строки 736-739)

Добавлено в секцию `@media print`:
```css
/* Отображаем все строки таблицы при печати (отключаем пагинацию) */
.veh-table-row {
  display: table-row !important;
}
```

---

## Как это работает

### В браузере (обычный режим):
1. Все записи рендерятся в DOM
2. Записи текущей страницы: `style=""` (видимы)
3. Записи других страниц: `style="display:none"` (скрыты)
4. Отображается 50 записей на странице

### При печати (Ctrl+P / Cmd+P):
1. Активируется `@media print`
2. CSS правило `.acc-table-row { display: table-row !important; }` переопределяет inline-стиль
3. ВСЕ строки становятся видимыми
4. Печатается полный список всех записей

## Преимущества

✅ **Полная печать** - все записи в одном документе
✅ **Без дополнительных запросов** - данные уже в DOM
✅ **Работает с фильтрами** - печатается отфильтрованный список
✅ **Единый подход** - одинаковая реализация на всех страницах
✅ **Минимальные изменения** - элегантное решение через CSS

## Затронутые файлы

1. `backend/bot/accreditations.html`
   - Строки 652-655 (CSS)
   - Строки 1011-1026 (JavaScript)

2. `backend/bot/vehicles.html`
   - Строки 736-739 (CSS)
   - Строки 1114-1132 (JavaScript)

3. `backend/bot/analyses.html`
   - Уже была реализована ранее (эталонная реализация)

## Результат

Теперь при печати всех трёх страниц (аккредитации, транспорт, анализы) выводится **полный список** всех записей, независимо от настроек пагинации.
