# Исправление ошибки с изображениями в ContentRenderer

## Дата: 2026-01-18

## Проблема

После внедрения `ContentRenderer` возникла ошибка при клике на изображения и любое другое место на странице:

```
Uncaught runtime errors:
ERROR
Node.removeChild: The node to be removed is not a child of this node
```

### Причины

1. **Неправильное управление lifecycle editor**
   - Editor создавался при каждом изменении `content` (зависимость `[content]` в `useEditor`)
   - Не было корректной очистки при размонтировании
   - React пытался удалить DOM-узлы, которые TipTap еще контролировал

2. **Двойное обновление контента**
   - `useEditor` получал `content` в initial config
   - `useEffect` снова вызывал `setContent` с тем же контентом
   - Это создавало конфликты в Virtual DOM

3. **Конфликт обработчиков событий**
   - В первой версии были отключены все обработчики (`handleClick: () => false`)
   - Это блокировало корректную работу изображений и видео

## Решение

Обновлен [ContentRenderer.js](frontend/src/components/ContentRenderer.js):

### 1. Убрана зависимость от content в useEditor

**Было:**
```javascript
const editor = useEditor({
  extensions: [...],
  content: content || '<p>Контент не загружен</p>',
  editable: false,
}, [content]); // ← Проблема: пересоздавался при каждом изменении
```

**Стало:**
```javascript
const editor = useEditor({
  extensions: [...],
  content: content || '<p>Контент не загружен</p>',
  editable: false,
}); // Без зависимостей - создается один раз
```

### 2. Улучшен useEffect для обновления контента

**Было:**
```javascript
useEffect(() => {
  if (editor && content) {
    editor.commands.setContent(content);
  }
}, [editor, content]);
```

**Стало:**
```javascript
useEffect(() => {
  if (!editor || editor.isDestroyed || !content) return;

  // Избегаем бесконечного цикла проверяя текущий контент
  const currentContent = editor.getHTML();
  if (currentContent !== content) {
    // emitUpdate: false предотвращает лишние события
    editor.commands.setContent(content, false);
  }
}, [editor, content]);
```

**Улучшения:**
- ✅ Проверка `editor.isDestroyed` перед использованием
- ✅ Сравнение текущего контента с новым (избегаем лишних обновлений)
- ✅ `emitUpdate: false` предотвращает cascade updates

### 3. Добавлена проверка isDestroyed при cleanup

**Было:**
```javascript
useEffect(() => {
  return () => {
    if (editor) {
      editor.destroy();
    }
  };
}, [editor]);
```

**Стало:**
```javascript
useEffect(() => {
  return () => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  };
}, [editor]);
```

**Улучшение:** Не пытаемся уничтожить уже уничтоженный editor.

### 4. Настроен Image extension

**Было:**
```javascript
Image, // Дефолтная конфигурация
```

**Стало:**
```javascript
Image.configure({
  inline: true,
  allowBase64: true,
}),
```

**Зачем:**
- `inline: true` - позволяет вставлять изображения инлайн в текст
- `allowBase64: true` - поддержка Base64 изображений (если используются)

### 5. Отключен resizable для Table в режиме просмотра

**Было:**
```javascript
Table.configure({
  resizable: true,
}),
```

**Стало:**
```javascript
Table.configure({
  resizable: false, // Отключаем в режиме просмотра
}),
```

**Зачем:** Нет смысла разрешать изменение размеров в read-only режиме.

### 6. Убраны блокировки обработчиков событий

**Было (в одной из версий):**
```javascript
editorProps: {
  attributes: {...},
  handleClick: () => false,      // ← Блокировало работу
  handleDoubleClick: () => false,
  handleKeyDown: () => false,
},
```

**Стало:**
```javascript
editorProps: {
  attributes: {
    class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-xl mx-auto focus:outline-none',
  },
}, // Нет блокировки событий
```

**Зачем:** В режиме просмотра `editable: false` уже отключает редактирование, но события для видео и ссылок должны работать.

## Полный код ContentRenderer.js

```javascript
// ContentRenderer.js - Компонент для рендеринга TipTap контента
import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Youtube from '@tiptap/extension-youtube';
import { LocalVideo } from './LocalVideo';
import './Editor.css';
import './ContentRenderer.css';

export default function ContentRenderer({ content }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: true,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      Table.configure({
        resizable: false,
      }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Underline,
      Youtube.configure({
        controls: true,
        nocookie: true,
      }),
      LocalVideo,
    ],
    content: content || '<p>Контент не загружен</p>',
    editable: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-xl mx-auto focus:outline-none',
      },
    },
  });

  // Обновляем контент только при изменении
  useEffect(() => {
    if (!editor || editor.isDestroyed || !content) return;

    const currentContent = editor.getHTML();
    if (currentContent !== content) {
      editor.commands.setContent(content, false);
    }
  }, [editor, content]);

  // Очищаем editor при размонтировании
  useEffect(() => {
    return () => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    };
  }, [editor]);

  if (!editor) {
    return null;
  }

  return (
    <div className="content-renderer">
      <EditorContent editor={editor} />
    </div>
  );
}
```

## Результат

### До:
```
❌ Ошибка при клике на изображение
❌ Ошибка при клике на любое место страницы
❌ Node.removeChild runtime errors
❌ Конфликты с Virtual DOM
```

### После:
```
✅ Изображения отображаются корректно
✅ Клики работают без ошибок
✅ Видео работают
✅ Корректная очистка при размонтировании
✅ Нет лишних пересозданий editor
```

## Тестирование

1. Откройте страницу с изображениями в режиме просмотра (CourseView/PageView)
2. Кликните на изображение - не должно быть ошибок
3. Кликните на текст - не должно быть ошибок
4. Воспроизведите видео - должно работать
5. Переключитесь между уроками - не должно быть ошибок
6. Откройте DevTools Console - не должно быть runtime errors

## Объяснение проблемы React + TipTap

TipTap использует ProseMirror, который управляет своим собственным DOM. Когда React пытается обновить или удалить компоненты, может возникнуть конфликт:

1. **React Virtual DOM** думает, что должен удалить узел
2. **ProseMirror DOM** уже контролирует этот узел
3. **Результат:** "Node to be removed is not a child"

**Решение:** Корректный lifecycle management:
- Создаем editor один раз (`useEditor` без зависимостей)
- Обновляем контент через `setContent` при изменениях
- Уничтожаем editor явно перед размонтированием
- Проверяем `isDestroyed` перед операциями

---

**Версия**: 0.82+
**Статус**: Исправлено
