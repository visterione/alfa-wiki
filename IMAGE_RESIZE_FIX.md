# Исправление изменения размера изображений в Editor

## Дата: 2026-01-18

## Проблема

После исправления ошибки "Node.removeChild" с BubbleMenu, перестала работать функция изменения размера изображений:
- Изображение нельзя переместить в другую часть страницы
- Модальное окошко (BubbleMenu) появляется через раз
- Нет настройки для изменения размера

### Причина

При исправлении BubbleMenu были случайно удалены CSS стили для:
- `.resizable-image-container` - контейнер изображения
- `.resize-handle` - ручки для изменения размера
- `.selected` - выделенное состояние

Без этих стилей:
- Resize handles не отображались (opacity: 0 по умолчанию)
- Не было визуальной обратной связи при выделении
- Курсоры не менялись при наведении на handles

## Решение

Добавлены CSS стили в [Editor.css](frontend/src/components/Editor.css) (строки 884-957):

```css
/* Resizable Image styles */
.resizable-image-container {
  display: inline-block;
  position: relative;
  margin: 1rem 0;
  cursor: default;
}

.resizable-image-container.selected {
  outline: 2px solid var(--primary-color, #3b82f6);
  outline-offset: 2px;
}

.resizable-image-container img {
  max-width: 100%;
  height: auto;
  display: block;
}

/* Resize handles */
.resize-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--primary-color, #3b82f6);
  border: 2px solid white;
  border-radius: 50%;
  cursor: pointer;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.2s;
}

.resizable-image-container.selected .resize-handle {
  opacity: 1;
}

.resize-handle.nw {
  top: -6px;
  left: -6px;
  cursor: nw-resize;
}

.resize-handle.ne {
  top: -6px;
  right: -6px;
  cursor: ne-resize;
}

.resize-handle.sw {
  bottom: -6px;
  left: -6px;
  cursor: sw-resize;
}

.resize-handle.se {
  bottom: -6px;
  right: -6px;
  cursor: se-resize;
}

.resize-handle:hover {
  transform: scale(1.2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.resizable-image-container.resizing {
  outline: 2px dashed var(--primary-color, #3b82f6);
}

.resizable-image-container.resizing img {
  pointer-events: none;
  user-select: none;
}
```

## Как работает изменение размера

### 1. Выделение изображения
- Кликните на изображение в редакторе
- Появится синяя рамка (outline)
- Появятся 4 круглые ручки в углах

### 2. Изменение размера
- Наведите на любую из 4 ручек
- Курсор изменится на resize курсор (↖ ↗ ↙ ↘)
- Зажмите левую кнопку мыши и тяните
- Размер меняется с сохранением пропорций

### 3. BubbleMenu для настроек
- При выделении изображения появляется BubbleMenu
- Настройки:
  - **Режим:** Строка (inline) / Блок (block)
  - **Обтекание:** (для inline) Нет / Слева / Справа
  - **Выравнивание:** (для block) Слева / По центру / Справа
  - **Сброс размера** - восстановить оригинальный размер
  - **Удалить** - удалить изображение

### 4. Перемещение изображения
- Изображение можно перетащить (drag & drop) в другое место
- Атрибут `draggable: true` в ResizableImage extension
- Просто зажмите изображение и перетащите

## Технические детали

### ResizableImage Extension
```javascript
const ResizableImage = Node.create({
  name: 'resizableImage',
  group: 'block',
  draggable: true,  // Позволяет перетаскивать

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      height: { default: null },
      display: { default: 'inline' },  // inline или block
      float: { default: 'none' },       // none, left, right
      align: { default: 'left' }        // left, center, right
    };
  },
  // ...
});
```

### ResizableImageComponent
```javascript
const ResizableImageComponent = ({ node, updateAttributes, selected, editor }) => {
  // useState для dimensions и resizing
  // useRef для containerRef, imgRef, startRef
  // useEffect для aspectRatio

  const handleMouseDown = (e, corner) => {
    // Начало resize
    // Вычисление новых размеров с сохранением пропорций
    // mousemove и mouseup listeners
  };

  return (
    <NodeViewWrapper className={containerClass}>
      <div ref={containerRef}>
        <img src={node.attrs.src} style={imageStyle} draggable={false} />
        {selected && (
          <>
            <div className="resize-handle nw" onMouseDown={...} />
            <div className="resize-handle ne" onMouseDown={...} />
            <div className="resize-handle sw" onMouseDown={...} />
            <div className="resize-handle se" onMouseDown={...} />
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
};
```

### ImageBubbleMenu
```javascript
function ImageBubbleMenu({ editor }) {
  const [selectedNode, setSelectedNode] = useState(null);

  useEffect(() => {
    // Проверка editor.isDestroyed
    const updateSelection = () => {
      // Получение выделенного узла resizableImage
    };

    editor.on('selectionUpdate', updateSelection);
    editor.on('update', updateSelection);

    return () => {
      // Безопасная очистка с проверкой !editor.isDestroyed
    };
  }, [editor]);

  return (
    <div>
      <BubbleMenu editor={editor} shouldShow={...}>
        {/* Кнопки настроек */}
      </BubbleMenu>
    </div>
  );
}
```

## Результат

### До исправления:
```
❌ Изображение нельзя переместить
❌ BubbleMenu появляется через раз
❌ Нет видимых ручек для resize
❌ Нет визуальной обратной связи
```

### После исправления:
```
✅ Изображение можно выделить кликом
✅ Появляются 4 ручки для resize в углах
✅ BubbleMenu появляется стабильно
✅ Изображение можно перетащить drag & drop
✅ Размер меняется с сохранением пропорций
✅ Есть настройки display, float, align
✅ Можно сбросить размер и удалить
```

## Тестирование

1. **Добавьте изображение в редактор**
   - Нажмите кнопку "Изображение" в тулбаре
   - Выберите файл

2. **Выделите изображение**
   - Кликните на изображение
   - Должна появиться синяя рамка
   - Должны появиться 4 круглые ручки в углах
   - Должен появиться BubbleMenu с настройками

3. **Измените размер**
   - Наведите на любую ручку
   - Курсор должен измениться на resize
   - Зажмите и тяните
   - Размер должен меняться плавно с сохранением пропорций

4. **Переместите изображение**
   - Зажмите изображение и перетащите в другое место
   - Должно работать drag & drop

5. **Используйте BubbleMenu**
   - Переключите между "Строка" и "Блок"
   - Попробуйте настройки обтекания и выравнивания
   - Нажмите "Сброс размера" - размер должен вернуться к оригиналу
   - Удалите изображение кнопкой с корзиной

## Возможные проблемы

### BubbleMenu не появляется
**Причина:** Изображение не выделено или editor уничтожен

**Решение:**
- Убедитесь что изображение выделено (синяя рамка)
- Проверьте консоль на ошибки
- Проверьте что `shouldShow` возвращает `true`

### Ручки не видны
**Причина:** CSS стили не загрузились или переопределены

**Решение:**
- Проверьте DevTools > Elements > Styles
- Убедитесь что `.resize-handle` имеет `opacity: 1` при selected
- Проверьте что нет конфликтующих CSS

### Изображение не перетаскивается
**Причина:** `draggable: true` не установлен или конфликт с другими расширениями

**Решение:**
- Проверьте что в ResizableImage есть `draggable: true`
- Убедитесь что нет конфликтов с DragHandle extension

### Размер не меняется
**Причина:** JavaScript события не работают или updateAttributes не вызывается

**Решение:**
- Проверьте консоль на ошибки
- Убедитесь что handleMouseDown срабатывает
- Проверьте что updateAttributes вызывается при mouseup

## Дополнительные ресурсы

- [Image extension | Tiptap Docs](https://tiptap.dev/docs/editor/extensions/nodes/image)
- [Resizable Node Views | Tiptap Docs](https://tiptap.dev/docs/editor/api/resizable-nodeviews)
- [Drag Handle React | Tiptap Docs](https://tiptap.dev/docs/editor/extensions/functionality/drag-handle-react)

---

**Версия**: 0.82+
**Статус**: Исправлено
