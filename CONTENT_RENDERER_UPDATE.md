# Переход с dangerouslySetInnerHTML на React рендеринг

## Дата: 2026-01-18

## Проблема

В режиме просмотра (CourseView, PageView) контент рендерился через `dangerouslySetInnerHTML`, что приводило к:
- Статическому HTML без React компонентов
- LocalVideo не работал (показывался баннер "Видео загрузится при клике" без функциональности)
- Невозможность использовать React компоненты в контенте

## Решение

Создан новый компонент **ContentRenderer** для рендеринга TipTap контента в режиме просмотра.

### Новые файлы

#### 1. `frontend/src/components/ContentRenderer.js`

React компонент использующий TipTap Editor в режиме `editable: false`:

```javascript
import { useEditor, EditorContent } from '@tiptap/react';
import { LocalVideo } from './LocalVideo';

export default function ContentRenderer({ content }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
      Link,
      Table,
      Youtube,
      LocalVideo, // Наш компонент для локального видео
    ],
    content: content,
    editable: false, // Только для чтения
  }, [content]);

  return (
    <div className="content-renderer">
      <EditorContent editor={editor} />
    </div>
  );
}
```

**Ключевые особенности:**
- Те же расширения что и в Editor
- `editable: false` - только для чтения
- Зависимость от `content` - пересоздает editor при изменении контента
- Использует React NodeView для LocalVideo

#### 2. `frontend/src/components/ContentRenderer.css`

Минимальные стили для корректного отображения:

```css
.content-renderer .ProseMirror {
  outline: none;
  padding: 0;
}

.content-renderer video {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1rem 0;
}
```

### Измененные файлы

#### 1. `frontend/src/pages/CourseView.js`

**Было:**
```javascript
<div
  className="lesson-content"
  dangerouslySetInnerHTML={{ __html: lessonContent }}
/>
```

**Стало:**
```javascript
import ContentRenderer from '../components/ContentRenderer';

<div className="lesson-content">
  <ContentRenderer content={lessonContent} />
</div>
```

#### 2. `frontend/src/pages/PageView.js`

**Было:**
```javascript
<div
  className="page-content"
  dangerouslySetInnerHTML={{ __html: getContentWithoutScripts() }}
/>
```

**Стало:**
```javascript
import ContentRenderer from '../components/ContentRenderer';

<div className="page-content">
  {page.contentType === 'wysiwyg' ? (
    <ContentRenderer content={page.content} />
  ) : (
    <div dangerouslySetInnerHTML={{ __html: getContentWithoutScripts() }} />
  )}
</div>
```

**Важно:** Для HTML-страниц (`contentType === 'html'`) оставлен `dangerouslySetInnerHTML`, так как там может быть произвольный HTML с JavaScript.

#### 3. `frontend/src/components/LocalVideo.js`

Обновлен `renderHTML()` для корректного статического рендеринга:

**Было:**
```javascript
renderHTML() {
  return [
    'div',
    { 'data-local-video': '', ... },
    ['div', {}, 'Видео загрузится при клике']
  ];
}
```

**Стало:**
```javascript
renderHTML() {
  return [
    'video',
    {
      src,
      poster: poster || undefined,
      controls: '',
      preload: 'none',
      style: '...'
    }
  ];
}
```

Теперь `renderHTML()` возвращает настоящий `<video>` элемент вместо div с текстом.

## Преимущества

### ✅ Единообразие
- Один и тот же рендеринг в редакторе и просмотре
- React компоненты работают везде
- LocalVideo корректно отображается и функционирует

### ✅ Функциональность
- Видео загружаются по клику (preload="none")
- Работает стандартный HTML5 плеер
- Корректная обработка всех TipTap расширений

### ✅ Производительность
- Нет фризов при загрузке страниц
- Видео не загружаются автоматически
- React эффективно управляет компонентами

### ✅ Простота
- Всего 66 строк кода в ContentRenderer
- Минимум зависимостей
- Легко добавлять новые расширения

## Тестирование

### 1. CourseView
```
http://localhost:3000/courses/{id}
```

Проверьте:
- ✅ Видео отображается как HTML5 плеер
- ✅ Видео не загружается автоматически
- ✅ При клике на Play видео загружается и воспроизводится
- ✅ Редактор открывается без зависаний

### 2. PageView (WYSIWYG)
```
http://localhost:3000/page/{slug}
```

Проверьте:
- ✅ Видео работает как в CourseView
- ✅ Все TipTap элементы отображаются корректно
- ✅ Изображения, таблицы, YouTube видео работают

### 3. PageView (HTML)
```
http://localhost:3000/page/{slug}
```

Для страниц с `contentType: 'html'`:
- ✅ HTML страницы отображаются как раньше
- ✅ JavaScript на странице выполняется
- ✅ Custom CSS/JS работают

## Миграция существующего контента

**Миграция не требуется!**

- Старые уроки с видео автоматически работают
- TipTap парсит `<video>` элементы через `parseHTML()`
- Атрибуты `src` и `poster` извлекаются корректно

## Откат (если нужен)

Если возникнут проблемы, можно откатиться:

1. В CourseView:
```javascript
<div
  className="lesson-content"
  dangerouslySetInnerHTML={{ __html: lessonContent }}
/>
```

2. В PageView:
```javascript
<div
  className="page-content"
  dangerouslySetInnerHTML={{ __html: getContentWithoutScripts() }}
/>
```

3. Удалить файлы:
   - `frontend/src/components/ContentRenderer.js`
   - `frontend/src/components/ContentRenderer.css`

---

**Версия**: 0.82+
**Статус**: Готово к тестированию
