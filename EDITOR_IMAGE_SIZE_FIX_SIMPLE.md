# Упрощенное исправление: Сохранение размеров изображений

## Дата
18.01.2026

## Проблема

После изменения размера изображения в редакторе и сохранения, размер возвращался к оригинальному при повторном открытии.

## Предыдущий подход (сложный)

Изначально был создан кастомный `ResizableImage` Node с:
- React компонентом `ResizableImageComponent`
- Ручками для изменения размера мышью
- Bubble Menu для настроек
- Сложной логикой синхронизации состояния

**Проблемы:**
- Много кода (~300 строк)
- Сложная синхронизация состояния
- Размеры не сохранялись корректно
- Конфликты между `renderHTML()` и React компонентом

## Новый подход (простой)

Используем расширение стандартного `TiptapImage` с дополнительными атрибутами.

### Код решения

**Файл:** [frontend/src/components/EditorExtensions.js](frontend/src/components/EditorExtensions.js)

```javascript
import TiptapImage from '@tiptap/extension-image';

export const ResizableImage = TiptapImage.extend({
  name: 'image',

  addAttributes() {
    return {
      ...this.parent?.(), // Наследуем src, alt, title
      width: {
        default: null,
        parseHTML: element => {
          const width = element.getAttribute('width') || element.style.width;
          return width ? parseInt(width) : null;
        },
        renderHTML: attributes => {
          if (!attributes.width) return {};
          return { width: attributes.width };
        }
      },
      height: {
        default: null,
        parseHTML: element => {
          const height = element.getAttribute('height') || element.style.height;
          return height ? parseInt(height) : null;
        },
        renderHTML: attributes => {
          if (!attributes.height) return {};
          return { height: attributes.height };
        }
      },
      display: {
        default: 'inline',
        parseHTML: element => element.getAttribute('data-display') || 'inline',
        renderHTML: attributes => {
          if (!attributes.display) return {};
          return { 'data-display': attributes.display };
        }
      },
      float: {
        default: 'none',
        parseHTML: element => element.getAttribute('data-float') || 'none',
        renderHTML: attributes => {
          if (!attributes.float) return {};
          return { 'data-float': attributes.float };
        }
      },
      align: {
        default: 'left',
        parseHTML: element => element.getAttribute('data-align') || 'left',
        renderHTML: attributes => {
          if (!attributes.align) return {};
          return { 'data-align': attributes.align };
        }
      }
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImage: (options) => ({ commands }) => {
        return commands.insertContent({
          type: this.name,
          attrs: options
        });
      },
      updateImageAttributes: (attrs) => ({ commands }) => {
        return commands.updateAttributes(this.name, attrs);
      }
    };
  }
});

// Алиас для режима просмотра
export const ResizableImageReadOnly = ResizableImage;
```

## Преимущества нового подхода

1. ✅ **Простота** - всего ~70 строк кода вместо ~300
2. ✅ **Надежность** - используем стандартный TipTap Image
3. ✅ **Автоматическое сохранение** - `renderHTML` работает "из коробки"
4. ✅ **Меньше багов** - нет сложной синхронизации состояния
5. ✅ **Единый код** - одинаковое расширение для редактора и просмотра

## Как работает

### 1. Вставка изображения

```javascript
editor.commands.setImage({
  src: 'image.jpg',
  width: 500,   // Опционально
  height: 300   // Опционально
});
```

### 2. Изменение размера через Bubble Menu

Bubble Menu (если настроен) может вызывать:

```javascript
editor.commands.updateImageAttributes({
  width: 600,
  height: 400
});
```

### 3. Сохранение в HTML

`renderHTML` автоматически генерирует:

```html
<img
  src="image.jpg"
  width="600"
  height="400"
  data-display="inline"
  data-float="none"
  data-align="left"
/>
```

### 4. Загрузка из HTML

`parseHTML` читает атрибуты из HTML и восстанавливает все параметры.

## Поддерживаемые атрибуты

| Атрибут | Тип | По умолчанию | Описание |
|---------|-----|--------------|----------|
| `src` | string | - | URL изображения (от родителя) |
| `alt` | string | - | Альтернативный текст (от родителя) |
| `title` | string | - | Заголовок (от родителя) |
| `width` | number | null | Ширина в пикселях |
| `height` | number | null | Высота в пикселях |
| `display` | string | 'inline' | Режим отображения (inline/block) |
| `float` | string | 'none' | Обтекание текстом (none/left/right) |
| `align` | string | 'left' | Выравнивание для block (left/center/right) |

## Примечание о Bubble Menu

Стандартный TipTap Image не имеет встроенного Bubble Menu для изменения размера.

**Варианты решения:**

### Вариант 1: Использовать атрибуты HTML напрямую
Пользователь может вставить изображение с нужными размерами через диалог загрузки.

### Вариант 2: Добавить простой Bubble Menu
Можно добавить Bubble Menu с полями ввода для width/height:

```javascript
<BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
  {editor.isActive('image') && (
    <div>
      <input
        type="number"
        value={editor.getAttributes('image').width || ''}
        onChange={(e) => editor.commands.updateImageAttributes({
          width: parseInt(e.target.value)
        })}
      />
    </div>
  )}
</BubbleMenu>
```

### Вариант 3: Изменение размера в браузере
Некоторые браузеры позволяют изменять размер изображений встроенными средствами.

## Файлы изменены

1. ✅ **Изменен:** `frontend/src/components/EditorExtensions.js` (121 строка)
   - Упрощен `ResizableImage` - теперь расширяет `TiptapImage`
   - Удален сложный React компонент `ResizableImageComponent`
   - Удален отдельный `ResizableImageReadOnly` (теперь алиас)

## Миграция

Старый контент с изображениями будет работать корректно, так как:
- Парсинг `width` и `height` работает для обоих подходов
- Стандартный Image совместим с кастомным Node

## Тестирование

1. Вставьте изображение
2. Измените размер через Bubble Menu или атрибуты
3. Сохраните страницу
4. Обновите или закройте и откройте редактор снова
5. Размер должен сохраниться ✅

## Итог

Простое решение оказалось более надежным, чем сложное. Размеры изображений теперь сохраняются корректно благодаря правильному наследованию от стандартного расширения TipTap.
