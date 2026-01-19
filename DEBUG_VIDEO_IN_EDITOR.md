# Отладка: Видео не отображается в редакторе

## Проблема

Видео отображается на обычных страницах и в CourseView, но в режиме редактирования (Editor) видно только пустое пространство.

## Что было исправлено

### 1. Увеличена минимальная высота
```javascript
minHeight: '300px'  // Было: '200px'
```

### 2. Добавлены стили для NodeViewWrapper
```javascript
<NodeViewWrapper style={{ display: 'block', margin: 0, padding: 0 }}>
```

### 3. Увеличен z-index для placeholder
```javascript
zIndex: 10  // Было: 1
```

### 4. Добавлена видимая рамка для отладки
```javascript
border: '2px solid #ddd'
```

### 5. Добавлены console.log для отладки
```javascript
console.log('LocalVideo mounted:', { src, poster, isLoaded, hasError });
console.log('Render state:', { isLoaded, hasError, src });
```

## Как проверить

### 1. Откройте редактор курса

```
http://localhost:3000/admin/courses/{id}/edit
```

### 2. Откройте консоль браузера (F12)

Вы должны увидеть логи:
```
LocalVideo mounted: {src: "/uploads/...", poster: null, isLoaded: false, hasError: false}
Render state: {isLoaded: false, hasError: false, src: "/uploads/..."}
```

### 3. Что должно быть видно

✅ **Серый блок** с рамкой размером минимум 300px
✅ **Иконка Play** ▶️ в центре (белый круг на темном фоне)
✅ **Текст** "Нажмите для загрузки видео"
✅ **Курсор pointer** при наведении

### 4. При клике на Play

В консоли должно появиться:
```
Loading video: /uploads/...
```

И видео должно загрузиться и начать воспроизводиться.

## Если проблема осталась

### Проверка 1: Компонент рендерится?

Откройте консоль и проверьте, есть ли логи `LocalVideo mounted`. Если **НЕТ**:
- Компонент не монтируется
- Проверьте, что LocalVideo добавлен в extensions редактора

### Проверка 2: Есть ли серый блок с рамкой?

Если блок **ЕСТЬ**, но не видно содержимого:
- Откройте DevTools → Elements
- Найдите `.local-video-wrapper`
- Проверьте computed styles
- Возможно, родительский элемент скрывает содержимое

Если блока **НЕТ**:
- Проверьте, что `display: 'block'` применяется
- Проверьте CSS в Editor.css на конфликты

### Проверка 3: Placeholder скрыт?

Если в логах `isLoaded: true` или `hasError: true`:
- Компонент думает, что видео уже загружено или есть ошибка
- Перезагрузите страницу с Ctrl+Shift+R
- Очистите localStorage

### Проверка 4: Проблема с z-index?

Откройте DevTools → Elements → найдите placeholder div:
```html
<div style="...z-index: 10...">
```

Проверьте, что другие элементы не перекрывают его.

## Временный workaround

Если ничего не помогает, добавьте в начало `LazyVideoComponent`:

```javascript
// ВРЕМЕННО: принудительно показываем placeholder
if (!isLoaded && !hasError) {
  console.warn('SHOWING PLACEHOLDER');
}
```

## Удаление debug логов

После того как все заработает, удалите debug логи:

```javascript
// Удалить эти строки:
console.log('LocalVideo mounted:', { src, poster, isLoaded, hasError });
console.log('Render state:', { isLoaded, hasError, src });
console.log('Loading video:', src);

// И убрать рамку:
border: '2px solid #ddd'  // <- удалить эту строку
```

## Скриншоты для сравнения

### Правильное отображение:
```
┌─────────────────────────────────┐
│                                 │
│         ⚫ (иконка Play)        │
│   Нажмите для загрузки видео    │
│                                 │
└─────────────────────────────────┘
      Серый фон #e0e0e0
```

### Неправильное (невидимое):
```
┌─────────────────────────────────┐
│                                 │
│    (ничего не видно)            │
│                                 │
└─────────────────────────────────┘
      Пустое пространство
```

---

**Дата**: 2026-01-18
**Версия**: 0.82+
