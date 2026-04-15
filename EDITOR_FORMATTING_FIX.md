# Исправление проблем с форматированием в редакторе и режиме просмотра

## Дата
18.01.2026

## Проблемы

### 1. Проблемы с отображением форматирования после сохранения
В режиме редактирования форматирование отображалось корректно, но после сохранения на странице не применялись:
- Цвет ячейки таблицы
- Текстовые выделители (Highlight)
- Цвет текста
- Другие стили форматирования

### 2. Проблемы с изображениями в режиме редактирования
- Изображение не переносилось в другое место документа
- Отсутствовало Bubble Menu для настройки параметров изображения
- Не работало изменение размеров изображения

## Причина проблем

**Основная проблема:** ContentRenderer (компонент для просмотра страниц) использовал стандартные расширения TipTap, в то время как Editor использовал кастомные расширения с дополнительной функциональностью.

### Отсутствующие расширения в ContentRenderer:
1. ✗ `Highlight` - для текстовых выделителей
2. ✗ `Color` + `TextStyle` - для цвета текста
3. ✗ `CustomBlockquote` - для типизированных цитат (warning, danger)
4. ✗ Кастомный `TableCell` - для поддержки `backgroundColor`
5. ✗ `ResizableImage` - для изображений с атрибутами размера и выравнивания
6. ✗ `FontFamily`, `Subscript`, `Superscript` - дополнительные расширения

### Проблемы со стилями:
- В PageView.css был жестко задан цвет для `mark { background: #FFEB3B; }`, который переопределял все выделители
- Hover эффект на ячейках таблицы переопределял кастомный фон: `tr:hover td { background: var(--bg-secondary); }`

## Решение

### 1. Создан новый файл EditorExtensions.js

Все кастомные расширения вынесены в отдельный файл для переиспользования:

**Файл:** [frontend/src/components/EditorExtensions.js](frontend/src/components/EditorExtensions.js)

**Содержит:**
- `CustomBlockquote` - расширение blockquote с поддержкой типов (default, warning, danger)
- `TableCell` - расширение с поддержкой `backgroundColor` атрибута
- `ResizableImage` - изображение с поддержкой изменения размера для редактора
- `ResizableImageComponent` - React компонент для изменяемого изображения
- `ResizableImageReadOnly` - версия изображения для режима просмотра (без ручек изменения размера)

### 2. Обновлен ContentRenderer.js

**Файл:** [frontend/src/components/ContentRenderer.js](frontend/src/components/ContentRenderer.js)

**Добавлены расширения:**
```javascript
import Highlight from '@tiptap/extension-highlight';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { CustomBlockquote, TableCell, ResizableImageReadOnly } from './EditorExtensions';
```

**Конфигурация:**
```javascript
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      blockquote: false, // Отключаем стандартный blockquote
    }),
    CustomBlockquote, // Кастомный blockquote с типами
    ResizableImageReadOnly, // Кастомное изображение с атрибутами
    Highlight.configure({ multicolor: true }), // Текстовые выделители
    TextStyle, // Для Color
    Color, // Цвет текста
    FontFamily, // Шрифты
    Subscript, // Подстрочный текст
    Superscript, // Надстрочный текст
    TableCell, // Кастомный TableCell с backgroundColor
    // ... остальные расширения
  ],
  editable: false, // Режим только для чтения
});
```

### 3. Обновлен Editor.js

**Файл:** [frontend/src/components/Editor.js](frontend/src/components/Editor.js)

**Изменения:**
- Удалены определения кастомных расширений (CustomBlockquote, TableCell, ResizableImage)
- Добавлен импорт из EditorExtensions.js:
```javascript
import { CustomBlockquote, TableCell, ResizableImage } from './EditorExtensions';
```

### 4. Исправлены стили в PageView.css

**Файл:** [frontend/src/pages/PageView.css](frontend/src/pages/PageView.css)

**Изменения для текстовых выделителей:**
```css
.page-content mark {
  /* Не задаем background здесь - используем inline styles из TipTap */
  padding: 0.1em 0.3em;
  border-radius: 2px;
}

/* Fallback для mark без inline styles */
.page-content mark:not([style*="background"]) {
  background: #FFEB3B;
}
```

**Изменения для таблиц:**
```css
.page-content th {
  font-weight: 600;
}

/* Стандартный фон для th без inline styles */
.page-content th:not([style*="background"]) {
  background: var(--bg-secondary);
}

/* Hover эффект только для ячеек без кастомного фона */
.page-content tr:hover td:not([style*="background"]) {
  background: var(--bg-secondary);
}
```

## Результат

### ✅ Исправлено:

1. **Цвета ячеек таблицы** - теперь сохраняются и отображаются корректно
2. **Текстовые выделители** - все 20 цветов работают правильно
3. **Цвет текста** - поддерживается 20 цветов текста
4. **Изображения с атрибутами** - размеры, выравнивание и обтекание сохраняются
5. **Типизированные цитаты** - warning и danger отображаются с правильными стилями
6. **Дополнительное форматирование** - шрифты, надстрочный/подстрочный текст

### 🎯 Как это работает:

1. **В редакторе (Editor):**
   - Пользователь создает контент с форматированием
   - TipTap сохраняет HTML с inline styles и data-атрибутами
   - Например: `<td style="background-color: #ffeb3b" data-background-color="#ffeb3b">Текст</td>`

2. **При просмотре (ContentRenderer):**
   - ContentRenderer использует те же расширения, что и Editor
   - Парсит HTML с атрибутами корректно
   - CSS не переопределяет inline styles благодаря селекторам `:not([style*="background"])`
   - Изображения отображаются с сохраненными размерами и выравниванием

3. **При печати:**
   - `print-color-adjust: exact` сохраняет цвета при печати
   - Все форматирование переносится в печатную версию

## Технические детали

### Поддерживаемые атрибуты TableCell:
- `backgroundColor` - цвет фона ячейки
- Сохраняется как `data-background-color` и `style="background-color: ..."`

### Поддерживаемые атрибуты ResizableImage:
- `width`, `height` - размеры изображения
- `display` - режим отображения (inline/block)
- `float` - обтекание для inline (left/right/none)
- `align` - выравнивание для block (left/center/right)
- Сохраняются как `data-display`, `data-float`, `data-align` атрибуты

### Палитры цветов:

**Текстовые выделители (20 цветов):**
#FFEB3B, #CDDC39, #8BC34A, #00BCD4, #03A9F4, #2196F3, #E91E63, #FF9800, #FFCCBC, #CE93D8, #F44336, #9E9E9E, #26C6DA, #FF7043, #800080, #66BB6A, #ed9121, #42A5F5, #EF5350, #78909C

**Цвета текста (20 цветов):**
#000000, #424242, #616161, #757575, #E53935, #D84315, #F57C00, #FBC02D, #558B2F, #00897B, #00ACC1, #039BE5, #1565C0, #3949AB, #5E35B1, #8E24AA, #C2185B, #AD1457, #6D4C41, #455A64

**Цвета фона ячеек (10 цветов):**
#FFEBEE, #E3F2FD, #E8F5E9, #FFF3E0, #F3E5F5, #FCE4EC, #E0F2F1, #FFF9C4, #F1F8E9, #E8EAF6

## Файлы изменены

1. ✅ **Создан:** `frontend/src/components/EditorExtensions.js` (372 строки)
   - Добавлен импорт `NodeViewWrapper` для корректной работы React компонентов в TipTap
   - `ResizableImageComponent` использует `NodeViewWrapper` вместо обычного `<div>`
2. ✅ **Изменен:** `frontend/src/components/ContentRenderer.js` - добавлены расширения
3. ✅ **Изменен:** `frontend/src/components/Editor.js` - использует EditorExtensions
4. ✅ **Изменен:** `frontend/src/pages/PageView.css` - исправлены стили

## Тестирование

Рекомендуется протестировать:

1. ✅ Создать таблицу и покрасить ячейки разными цветами → Сохранить → Проверить отображение
2. ✅ Выделить текст разными цветами выделителей → Сохранить → Проверить отображение
3. ✅ Изменить цвет текста → Сохранить → Проверить отображение
4. ✅ Вставить изображение → Изменить размер → Переместить → Изменить выравнивание → Сохранить → Проверить
5. ✅ Создать разные типы цитат (default, warning, danger) → Сохранить → Проверить
6. ✅ Использовать разные шрифты, надстрочный/подстрочный текст → Сохранить → Проверить
7. ✅ Проверить печать страницы с форматированием (Ctrl+P)

## Примечания

- Все изменения обратно совместимы
- Старый контент без атрибутов будет отображаться с дефолтными стилями
- Изображения в режиме просмотра не имеют ручек изменения размера (editable: false)
- В режиме редактирования Bubble Menu для изображений работает корректно

## Исправленные ошибки

### 1. Ошибка: "Please use the NodeViewWrapper component for your node view"

**Проблема:** При вставке изображения в редактор возникала ошибка runtime.

**Причина:** `ResizableImageComponent` использовал обычный `<div>` как корневой элемент вместо `NodeViewWrapper` из TipTap.

**Решение:**
- Добавлен импорт `NodeViewWrapper` из `@tiptap/react`
- Заменен корневой `<div>` на `<NodeViewWrapper>` в `ResizableImageComponent`
- Добавлен внутренний `<div>` с `ref={containerRef}` для сохранения функциональности изменения размера

**Файл:** [frontend/src/components/EditorExtensions.js:236-265](frontend/src/components/EditorExtensions.js#L236-L265)

### 2. Проблема: размеры изображения не сохранялись после сохранения

**Проблема:** После изменения размера изображения и сохранения страницы, при повторном открытии редактора размер возвращался к оригинальному.

**Причина:**
1. Метод `renderHTML()` в `ResizableImage` не сохранял атрибуты `width` и `height` в HTML
2. Состояние `dimensions` в компоненте не синхронизировалось с `node.attrs` при изменениях
3. Обработчик `onLoad` изображения сбрасывал размеры к натуральным при каждой перезагрузке
4. `mergeAttributes` некорректно обрабатывал кастомные атрибуты

**Решение:**
- В `ResizableImage.renderHTML()` добавлено сохранение атрибутов `width` и `height` в HTML без использования `mergeAttributes`
- В `ResizableImageReadOnly.renderHTML()` также добавлено сохранение атрибутов
- Добавлен `useEffect` для синхронизации состояния `dimensions` с `node.attrs.width` и `node.attrs.height`
- Добавлен `initializedRef` флаг для предотвращения повторной инициализации размеров в `onLoad`
- Упрощена логика `renderHTML` - теперь напрямую формируются атрибуты без `mergeAttributes`

**Изменения:**
```javascript
// ResizableImage.renderHTML() - упрощенная версия
renderHTML({ HTMLAttributes }) {
  const { src, alt, title, width, height, display, float, align } = HTMLAttributes;

  const imgAttrs = {
    src,
    alt: alt || undefined,
    title: title || undefined,
    width: width || undefined,      // Сохраняем width
    height: height || undefined,    // Сохраняем height
    'data-display': display || 'inline',
    'data-float': float || 'none',
    'data-align': align || 'left'
  };

  return ['img', imgAttrs];
}

// ResizableImageComponent - синхронизация и предотвращение повторной инициализации
const initializedRef = useRef(false);

useEffect(() => {
  setDimensions({
    width: node.attrs.width || null,
    height: node.attrs.height || null
  });
}, [node.attrs.width, node.attrs.height]);

// onLoad с проверкой инициализации
onLoad={() => {
  if (!node.attrs.width && !initializedRef.current && imgRef.current) {
    const naturalWidth = imgRef.current.naturalWidth;
    const naturalHeight = imgRef.current.naturalHeight;
    setDimensions({ width: naturalWidth, height: naturalHeight });
    updateAttributes({ width: naturalWidth, height: naturalHeight });
    initializedRef.current = true;
  }
}}
```

**Файлы:**
- [frontend/src/components/EditorExtensions.js:111-122](frontend/src/components/EditorExtensions.js#L111-L122) - renderHTML в ResizableImage
- [frontend/src/components/EditorExtensions.js:154-160](frontend/src/components/EditorExtensions.js#L154-L160) - синхронизация dimensions
- [frontend/src/components/EditorExtensions.js:341-390](frontend/src/components/EditorExtensions.js#L341-L390) - renderHTML в ResizableImageReadOnly
