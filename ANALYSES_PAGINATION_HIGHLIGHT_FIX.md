# Исправление подсветки анализов на всех страницах пагинации

## Проблема
При поиске анализа через Header.js пользователь перенаправлялся на страницу analyses.html с параметром `?highlight=ID`, но подсветка и прокрутка работали только для анализов на первой странице. Если искомый анализ находился на 2+ странице, страница просто открывалась без перемещения к нужной записи.

## Решение
Обновлена функция `scrollToRecord()` в [analyses.html](backend/bot/analyses.html) для автоматического определения нужной страницы пагинации и переключения на неё перед прокруткой.

## Изменения

### 1. Улучшена функция `scrollToRecord(id)`
**Файл:** `backend/bot/analyses.html` (строки 761-798)

**Что изменилось:**
- Добавлен поиск индекса записи в массиве `analyses`
- Автоматический расчёт номера страницы: `Math.floor(index / pageSize) + 1`
- Переключение на нужную страницу перед прокруткой
- Перерисовка таблицы и пагинации
- Автоматический сброс подсветки через 3 секунды после анимации

```javascript
function scrollToRecord(id) {
  // Найти индекс записи в массиве
  var index = -1;
  for (var i = 0; i < analyses.length; i++) {
    if (analyses[i].id === id) {
      index = i;
      break;
    }
  }

  if (index === -1) return false;

  highlightId = id;
  currentPage = Math.floor(index / pageSize) + 1;

  renderTable();
  renderPagination();

  setTimeout(function() {
    var row = document.querySelector('tr[data-id="' + id + '"]');
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);

  setTimeout(function() {
    highlightId = null;
  }, 3000);

  return true;
}
```

### 2. Улучшена функция `goToPage(p)`
**Файл:** `backend/bot/analyses.html` (строки 920-929)

**Что изменилось:**
- Добавлен сброс `highlightId` при ручной навигации по страницам
- Добавлена прокрутка к началу таблицы при смене страницы

```javascript
function goToPage(p) {
  var totalPages = Math.ceil(analyses.length / pageSize) || 1;
  if (p < 1 || p > totalPages) return;
  currentPage = p;
  highlightId = null; // Сбросить подсветку при ручной навигации
  renderTable();
  renderPagination();
  document.querySelector('.ana-table-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
```

## Как это работает

1. Пользователь ищет анализ через поисковую строку в Header.js
2. Система перенаправляет на `/page/analyses?highlight=ID_ЗАПИСИ`
3. Страница загружается, и в инициализации проверяется параметр `highlight`
4. Вызывается `scrollToRecord(highlightParam)`, которая:
   - Находит запись в массиве `analyses`
   - Вычисляет номер нужной страницы пагинации
   - Переключается на эту страницу
   - Перерисовывает таблицу с подсветкой нужной строки
   - Прокручивает к строке с плавной анимацией
5. Через 3 секунды подсветка автоматически исчезает

## Визуальная индикация

Подсвеченная строка использует жёлтый фон (`#fef3c7`) с плавным исчезанием через CSS-анимацию:

```css
.ana-table tr[data-highlighted="true"] {
  background: #fef3c7 !important;
  animation: highlight-fade 2s ease-out 1s forwards;
}

@keyframes highlight-fade {
  to { background: transparent !important; }
}
```

## Результат
✅ Теперь поиск работает корректно для анализов на любой странице пагинации
✅ Автоматическое переключение на нужную страницу
✅ Плавная прокрутка к найденной записи
✅ Цветовая индикация (жёлтая подсветка) найденной строки
✅ Автоматическое исчезание подсветки через 3 секунды

## Дополнительные улучшения

### 3. Увеличен размер страницы пагинации
**Файл:** `backend/bot/analyses.html` (строка 722)

Изменено количество записей на одной странице с 20 до 50 для более удобного просмотра больших списков анализов.

```javascript
var pageSize = 50;
```

### 4. Добавлены стили для печати в PDF
**Файл:** `backend/bot/analyses.html` (строки 581-653 и 892-912)

Настроена корректная печать таблицы анализов:
- **Альбомная ориентация** (`landscape`)
- **Печать всех записей:** при печати отображаются ВСЕ анализы, независимо от пагинации
- **Скрыты элементы управления:** заголовки страницы, фильтры, пагинация, модальные окна, столбец "Действия"
- **Статус СТОП отображается текстом:** иконки заменяются на текст ("СТОП" или "Да") с сохранением цветовой индикации
- **Оптимизированы границы:** чёрные границы для всех ячеек таблицы
- **Сохранены цвета:** цветовая индикация медцентров и статусов сохраняется при печати благодаря `print-color-adjust: exact`
- **Компактный шрифт:** 9pt для лучшего размещения данных на странице

**CSS стили для печати:**
```css
@media print {
  @page {
    size: landscape;
    margin: 10mm;
  }

  h1, h2, h3, h4, h5, h6 {
    display: none !important;
  }

  .ana-header,
  .ana-pagination,
  .ana-modal,
  .ana-toast,
  .ana-table th:last-child,
  .ana-table td:last-child {
    display: none !important;
  }

  .ana-table-container {
    box-shadow: none;
    border: none;
  }

  /* Отображаем все строки таблицы при печати (отключаем пагинацию) */
  .ana-table-row {
    display: table-row !important;
  }

  .ana-table th,
  .ana-table td {
    border: 1px solid #000;
    padding: 6px;
    font-size: 9pt;
  }

  .ana-table {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .ana-medcenter {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Отображаем статус СТОП текстом при печати */
  .ana-stop-btn {
    width: auto !important;
    height: auto !important;
    background: transparent !important;
    border: none !important;
    font-size: 9pt;
    font-weight: 600;
    padding: 2px 6px;
  }

  .ana-stop-btn svg {
    display: none !important;
  }

  .ana-stop-btn.stopped::after {
    content: "СТОП";
    color: #dc2626;
  }

  .ana-stop-btn.active::after {
    content: "Да";
    color: #16a34a;
  }
}
```

**JavaScript логика для печати всех записей:**
```javascript
function renderTable() {
  // ... код проверки данных ...

  var start = (currentPage - 1) * pageSize;
  var end = Math.min(start + pageSize, analyses.length);

  // Рендерим ВСЕ записи, но скрываем те, что не на текущей странице
  // При печати CSS отобразит все строки с классом .ana-table-row
  tb.innerHTML = analyses.map(function(a, index) {
    var isHighlighted = highlightId && a.id === highlightId;
    var isOnCurrentPage = index >= start && index < end;
    var displayStyle = isOnCurrentPage ? '' : ' style="display:none"';

    return '<tr data-id="' + a.id + '"' +
           (isHighlighted ? ' data-highlighted="true"' : '') +
           displayStyle +
           ' class="ana-table-row">' +
      // ... содержимое строки ...
      '</tr>';
  }).join('');
}
```

Теперь при печати:
1. Браузер рендерит все строки таблицы в DOM (но скрытые через `display:none`)
2. CSS правило `@media print` делает все строки с классом `.ana-table-row` видимыми
3. SVG-иконки в кнопках СТОП скрываются, а вместо них отображается текст через псевдоэлемент `::after`:
   - `.ana-stop-btn.stopped::after` → "СТОП" (красный цвет)
   - `.ana-stop-btn.active::after` → "Да" (зелёный цвет)
4. В результате печатается полный список всех анализов с читаемыми статусами

## Аналогичная реализация
Данная функциональность работает идентично:
- Навигация с пагинацией: [archive-accreditations.html](backend/bot/archive-accreditations.html)
- Стили печати: [accreditations.html](backend/bot/accreditations.html) и [vehicles.html](backend/bot/vehicles.html)
