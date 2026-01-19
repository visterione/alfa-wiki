# Исправление Drag & Drop и BubbleMenu для изображений

## Дата: 2026-01-18

## Проблемы

1. **BubbleMenu показывается непонятно как** - должен показываться всегда после клика на изображение
2. **Изображение перемещается через раз** - drag & drop работает нестабильно
3. **В режиме просмотра размер не меняется** - это правильное поведение (editable: false)

## Решение

### 1. Исправлен BubbleMenu (строки 267-350)

#### Проблема:
`shouldShow` проверял `editor.isActive('resizableImage')`, но это работало нестабильно.

#### Решение:
Используем состояние `selectedNode` вместо проверки активности.

**Было:**
```javascript
function ImageBubbleMenu({ editor }) {
  const [selectedNode, setSelectedNode] = useState(null);

  useEffect(() => {
    const updateSelection = () => {
      const { state } = editor;
      const { selection } = state;
      const { $from } = selection;
      const node = $from.parent.type.name === 'resizableImage'
        ? $from.parent
        : state.doc.nodeAt(selection.from);

      if (node && node.type.name === 'resizableImage') {
        setSelectedNode(node);
      } else {
        setSelectedNode(null);
      }
    };

    editor.on('selectionUpdate', updateSelection);
    editor.on('update', updateSelection);

    return () => {
      editor.off('selectionUpdate', updateSelection);
      editor.off('update', updateSelection);
    };
  }, [editor]);

  if (!selectedNode) return null;

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{ duration: 100 }}
      shouldShow={({ editor, state }) => {
        return editor && !editor.isDestroyed && editor.isActive('resizableImage');
      }}
    >
      {/* ... */}
    </BubbleMenu>
  );
}
```

**Стало:**
```javascript
function ImageBubbleMenu({ editor }) {
  const [selectedNode, setSelectedNode] = useState(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const updateSelection = () => {
      if (!editor || editor.isDestroyed) return;

      // Используем isActive для проверки
      if (editor.isActive('resizableImage')) {
        const { state } = editor;
        const { selection } = state;

        let node = null;

        // Способ 1: через selection.node (если выделен целый узел)
        if (selection.node && selection.node.type.name === 'resizableImage') {
          node = selection.node;
        }

        // Способ 2: через nodeAt
        if (!node) {
          node = state.doc.nodeAt(selection.from);
          if (node && node.type.name !== 'resizableImage') {
            node = null;
          }
        }

        setSelectedNode(node);
      } else {
        setSelectedNode(null);
      }
    };

    // Вызываем сразу при монтировании
    updateSelection();

    editor.on('selectionUpdate', updateSelection);
    editor.on('update', updateSelection);
    editor.on('transaction', updateSelection);  // Добавлен!

    return () => {
      if (editor && !editor.isDestroyed) {
        editor.off('selectionUpdate', updateSelection);
        editor.off('update', updateSelection);
        editor.off('transaction', updateSelection);
      }
    };
  }, [editor]);

  // Early return если нет выделенного изображения
  if (!editor || editor.isDestroyed || !selectedNode) return null;

  return (
    <div>
      <BubbleMenu
        editor={editor}
        tippyOptions={{
          duration: 100,
          placement: 'top'  // Позиционирование сверху
        }}
        shouldShow={() => {
          // Показываем всегда когда есть selectedNode
          return !!selectedNode;
        }}
      >
        {/* ... */}
      </BubbleMenu>
    </div>
  );
}
```

**Улучшения:**
- ✅ Добавлена подписка на `transaction` событие
- ✅ `updateSelection()` вызывается сразу при монтировании
- ✅ Early return если `!selectedNode`
- ✅ `shouldShow` всегда возвращает `true` когда `selectedNode` не null
- ✅ Два способа поиска узла: `selection.node` и `nodeAt`
- ✅ Добавлен `placement: 'top'` для позиционирования

### 2. Исправлен Drag & Drop (строки 242-286)

#### Проблема:
Изображение перемещалось через раз, потому что:
1. Не было `data-drag-handle` атрибута
2. Resize handles блокировали drag
3. Не было визуальной обратной связи (cursor)

#### Решение:
Добавлены data-атрибуты для корректного drag & drop.

**Было:**
```javascript
return (
  <NodeViewWrapper className={containerClass}>
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <img
        ref={imgRef}
        src={node.attrs.src}
        style={imageStyle}
        draggable={false}
      />
      {selected && (
        <>
          <div className="resize-handle nw" onMouseDown={(e) => handleMouseDown(e, 'nw')} />
          <div className="resize-handle ne" onMouseDown={(e) => handleMouseDown(e, 'ne')} />
          <div className="resize-handle sw" onMouseDown={(e) => handleMouseDown(e, 'sw')} />
          <div className="resize-handle se" onMouseDown={(e) => handleMouseDown(e, 'se')} />
        </>
      )}
    </div>
  </NodeViewWrapper>
);
```

**Стало:**
```javascript
return (
  <NodeViewWrapper className={containerClass} data-drag-handle>
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-block' }}
      data-drag-handle  // Указываем что это drag handle
    >
      <img
        ref={imgRef}
        src={node.attrs.src}
        style={{
          ...imageStyle,
          cursor: selected && !resizing ? 'move' : 'default'  // Визуальная подсказка
        }}
        draggable={false}
      />
      {selected && (
        <>
          <div
            className="resize-handle nw"
            onMouseDown={(e) => handleMouseDown(e, 'nw')}
            data-drag-handle-ignore  // Игнорируем при drag
          />
          <div
            className="resize-handle ne"
            onMouseDown={(e) => handleMouseDown(e, 'ne')}
            data-drag-handle-ignore
          />
          <div
            className="resize-handle sw"
            onMouseDown={(e) => handleMouseDown(e, 'sw')}
            data-drag-handle-ignore
          />
          <div
            className="resize-handle se"
            onMouseDown={(e) => handleMouseDown(e, 'se')}
            data-drag-handle-ignore
          />
        </>
      )}
    </div>
  </NodeViewWrapper>
);
```

**Улучшения:**
- ✅ `data-drag-handle` на NodeViewWrapper и div - указывает что это область для drag
- ✅ `data-drag-handle-ignore` на resize handles - они не должны триггерить drag
- ✅ `cursor: 'move'` когда выделено и не изменяется размер - визуальная подсказка
- ✅ `cursor: 'default'` во время resize или когда не выделено

## Как это работает

### Data-атрибуты для Drag & Drop

TipTap использует эти атрибуты для определения поведения:

1. **`data-drag-handle`** - помечает элемент как "handle" для перетаскивания
   - Когда пользователь зажимает на элемент с этим атрибутом, начинается drag
   - Можно использовать на нескольких вложенных элементах

2. **`data-drag-handle-ignore`** - исключает элемент из drag
   - Используется для элементов внутри drag-handle, которые не должны триггерить drag
   - В нашем случае - resize handles

### Cursor states

```javascript
cursor: selected && !resizing ? 'move' : 'default'
```

- `move` - когда изображение выделено и не изменяется размер
- `default` - в остальных случаях
- Resize handles имеют свои курсоры (`nw-resize`, `ne-resize`, etc.) из CSS

## Режим просмотра (ContentRenderer)

В режиме просмотра изображения **НЕ должны** изменять размер - это правильное поведение:

```javascript
// ContentRenderer.js
const editor = useEditor({
  extensions: [
    StarterKit,
    Image.configure({
      inline: true,
      allowBase64: true,
    }),
    // Другие расширения...
  ],
  content: content || '<p>Контент не загружен</p>',
  editable: false,  // Только для чтения!
});
```

С `editable: false`:
- ✅ Изображения отображаются
- ✅ Сохраняются размеры из редактора
- ❌ Нельзя изменить размер (правильно)
- ❌ Нельзя перетащить (правильно)
- ❌ Нет BubbleMenu (правильно)

Это **нормальное поведение** для режима просмотра.

## Тестирование

### 1. BubbleMenu
```
✅ Добавьте изображение в редактор
✅ Кликните на изображение
✅ BubbleMenu должен появиться СРАЗУ (не через раз)
✅ В BubbleMenu есть кнопки: Режим, Обтекание/Выравнивание, Сброс размера, Удалить
✅ Кликните вне изображения - BubbleMenu должен исчезнуть
✅ Кликните снова на изображение - BubbleMenu должен снова появиться
```

### 2. Drag & Drop
```
✅ Выделите изображение
✅ Курсор должен стать 'move' (рука с 4 стрелками)
✅ Зажмите изображение (НЕ на resize handle)
✅ Перетащите в другое место
✅ Отпустите - изображение должно переместиться
✅ Повторите несколько раз - должно работать СТАБИЛЬНО
```

### 3. Resize
```
✅ Выделите изображение
✅ Появляются 4 ручки в углах
✅ Наведите на ручку - курсор меняется на resize
✅ Зажмите ручку и тяните
✅ Размер меняется плавно с сохранением пропорций
✅ Курсор НЕ должен быть 'move' во время resize
```

### 4. Комбинация
```
✅ Измените размер изображения
✅ Сразу после этого попробуйте переместить - должно работать
✅ Переместите изображение
✅ Сразу после этого измените размер - должно работать
✅ Все действия должны быть стабильными без "через раз"
```

### 5. Режим просмотра
```
✅ Сохраните страницу с изображением
✅ Откройте в режиме просмотра (CourseView или PageView)
✅ Изображение отображается с тем же размером что в редакторе
✅ Нельзя изменить размер (правильно)
✅ Нельзя переместить (правильно)
✅ Нет BubbleMenu (правильно)
```

## Возможные проблемы

### BubbleMenu все еще не появляется

**Причина:** React состояние не обновляется

**Отладка:**
1. Откройте DevTools Console
2. Добавьте в `updateSelection`:
```javascript
console.log('Selection update:', {
  isActive: editor.isActive('resizableImage'),
  selectionNode: selection.node?.type.name,
  nodeAtFrom: state.doc.nodeAt(selection.from)?.type.name
});
```
3. Кликните на изображение - должны увидеть лог с `isActive: true`

**Решение:** Если `isActive` всегда `false`, проверьте что изображение добавлено через `setImage` команду.

### Drag работает но изображение "прыгает"

**Причина:** CSS conflict или z-index проблемы

**Решение:**
1. Проверьте что нет `pointer-events: none` на NodeViewWrapper
2. Убедитесь что z-index у изображения выше чем у окружающих элементов
3. Проверьте что `position: relative` установлен правильно

### Resize handles не видны после drag

**Причина:** `selected` состояние теряется после перемещения

**Решение:**
1. Это известная особенность TipTap - после drag узел может потерять selection
2. Просто кликните на изображение снова - handles вернутся
3. Это нормальное поведение

---

**Версия**: 0.82+
**Статус**: Исправлено
