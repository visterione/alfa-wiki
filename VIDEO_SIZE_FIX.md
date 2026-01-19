# Исправление размера видео в редакторе

## Дата: 2026-01-18

## Проблема

Видео в режиме Editor отображалось маленьким, не на всю ширину контейнера, в то время как в режиме просмотра (CourseView) видео занимало всю ширину.

## Решение

Добавлены CSS стили для видео в [Editor.css](frontend/src/components/Editor.css) строки 856-876:

```css
/* Local Video styles - full width in editor */
.editor-content .ProseMirror video {
  width: 100%;
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1rem 0;
  border-radius: var(--radius-md);
  background-color: #000;
}

/* LocalVideo wrapper */
.editor-content .ProseMirror .local-video-wrapper {
  width: 100%;
  display: block;
}

.editor-content .ProseMirror .local-video-wrapper video {
  width: 100%;
  max-width: 100%;
}
```

## Что изменилось

### До:
- Видео в редакторе отображалось маленьким (возможно использовался размер по умолчанию)
- В режиме просмотра видео было на всю ширину

### После:
- **Видео на всю ширину везде** - и в редакторе, и при просмотре
- Единообразное отображение
- Сохранено соотношение сторон (height: auto)

## Детали реализации

### 1. Стили для video элемента
```css
.editor-content .ProseMirror video {
  width: 100%;           /* Растягиваем на всю ширину */
  max-width: 100%;       /* Не превышаем контейнер */
  height: auto;          /* Сохраняем пропорции */
  display: block;        /* Блочный элемент */
  margin: 1rem 0;        /* Отступы сверху/снизу */
  border-radius: 8px;    /* Скругление */
  background-color: #000; /* Черный фон при загрузке */
}
```

### 2. Стили для wrapper
```css
.editor-content .ProseMirror .local-video-wrapper {
  width: 100%;
  display: block;
}
```

Это гарантирует что wrapper (NodeViewWrapper) также занимает всю ширину.

### 3. Вложенное video
```css
.editor-content .ProseMirror .local-video-wrapper video {
  width: 100%;
  max-width: 100%;
}
```

Дополнительная гарантия для видео внутри wrapper.

## Удалены файлы

- `frontend/src/components/LocalVideo.css` - больше не нужен, стили перенесены в Editor.css

## Преимущества

✅ **Единообразие** - видео одинаково отображается в редакторе и просмотре
✅ **Responsive** - видео адаптируется под ширину контейнера
✅ **Сохранение пропорций** - height: auto гарантирует корректное соотношение сторон
✅ **Централизация стилей** - все стили редактора в одном файле (Editor.css)

## Тестирование

1. Откройте редактор курса с видео
2. Проверьте что видео занимает всю ширину редактора
3. Откройте режим просмотра (CourseView)
4. Проверьте что видео также на всю ширину

**Ожидаемый результат:** Видео одинакового размера (на всю ширину) в обоих режимах.

---

**Версия**: 0.82+
**Статус**: Готово
