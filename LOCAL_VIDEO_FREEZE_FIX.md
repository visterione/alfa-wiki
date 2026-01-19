# Исправление проблемы фризов браузера при работе с LocalVideo

## Проблема

При попытке открыть, редактировать или воспроизвести страницу с видео (компонент LocalVideo) в Editor и AdminCourseEditor возникали следующие проблемы:

1. **Сильный фриз браузера** - интерфейс полностью замирал
2. **Ошибка в консоли**: `Uncaught runtime errors: ERROR - The fetching process for the media resource was aborted by the user agent at the user's request`
3. **Ошибка MIME-типа** - браузер не распознавал видео файлы из-за неправильных Content-Type заголовков

## Причины

### 1. Автоматическая загрузка всех видео

Старый компонент использовал обычный HTML рендеринг с `preload: 'metadata'`, что приводило к:
- **Одновременной загрузке метаданных всех видео** на странице
- **Блокировке UI потока** из-за множественных HTTP-запросов
- **Превышению лимита одновременных соединений** браузера
- **Прерыванию загрузок** ("fetching process was aborted")

### 2. Неправильные MIME-типы на сервере

Express.js по умолчанию не всегда корректно определяет MIME-типы для видео файлов, что вызывало:
- Ошибки "Unsupported MIME type"
- Отказ браузера воспроизводить видео
- Дополнительные запросы для определения типа контента

## Решение

### Frontend: React NodeView с ленивой загрузкой

Полностью переписан [LocalVideo.js](frontend/src/components/LocalVideo.js) с использованием **React NodeView**:

#### Ключевые изменения:

1. **Placeholder с кнопкой Play**
   - Видео не загружается автоматически
   - Показывается превью (poster) или серый фон
   - Кликабельная иконка Play для загрузки

2. **Intersection Observer**
   - Отслеживает видимость видео в области просмотра
   - Подготавливает загрузку за 100px до появления на экране
   - Оптимизирует производительность при прокрутке

3. **Обработка ошибок**
   - Красивое отображение ошибок загрузки
   - Кнопка "Попробовать снова"
   - Информация о пути к файлу для отладки

4. **Состояния загрузки**
   - `isLoaded` - видео загружено и готово к воспроизведению
   - `hasError` - произошла ошибка при загрузке
   - `isInView` - видео появилось в области просмотра

#### Пример кода:

```javascript
const LazyVideoComponent = ({ node, updateAttributes }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Intersection Observer для оптимизации
  useEffect(() => {
    const observer = new IntersectionObserver(/* ... */);
    // ...
  }, []);

  // Загрузка только по клику
  const handleLoadVideo = () => {
    setIsLoaded(true);
  };

  return (
    <NodeViewWrapper>
      {!isLoaded && <PlaceholderWithPlayButton />}
      {hasError && <ErrorMessage />}
      {isLoaded && <video preload="metadata" />}
    </NodeViewWrapper>
  );
};
```

### Backend: Правильные MIME-типы и Range requests

Исправлен [server.js:121-139](backend/server.js#L121-L139) для корректной отдачи видео:

```javascript
const serveStatic = express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();

    // Устанавливаем правильные MIME-типы
    if (ext === '.mp4') {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (ext === '.webm') {
      res.setHeader('Content-Type', 'video/webm');
    } else if (ext === '.ogg') {
      res.setHeader('Content-Type', 'video/ogg');
    }

    // Разрешаем частичную загрузку для seek в видео
    res.setHeader('Accept-Ranges', 'bytes');
  }
});
```

**Что это дает:**
- ✅ Браузер правильно распознает видео файлы
- ✅ Поддержка перемотки (Range requests)
- ✅ Нет ошибок "Unsupported MIME type"
- ✅ Корректная потоковая передача видео

## Преимущества решения

### 🚀 Производительность
- ✅ **Мгновенная загрузка редактора** - видео не загружаются до взаимодействия
- ✅ **Нет фризов** - браузер не перегружается HTTP-запросами
- ✅ **Плавная прокрутка** - видео загружаются только в области просмотра

### 💾 Экономия ресурсов
- ✅ **Экономия трафика** - загружаются только просматриваемые видео
- ✅ **Меньше нагрузка на сервер** - не все видео запрашиваются одновременно
- ✅ **Экономия памяти** - видео выгружаются при скролле

### 🎨 Пользовательский опыт
- ✅ **Визуальная обратная связь** - пользователь видит placeholder с иконкой Play
- ✅ **Понятные ошибки** - красивое отображение проблем с загрузкой
- ✅ **Контроль загрузки** - пользователь сам решает, когда загружать видео

### 🛠 Надежность
- ✅ **Обработка ошибок** - graceful degradation при проблемах
- ✅ **Повторная попытка** - можно перезагрузить видео при ошибке
- ✅ **Отладка** - показывается путь к файлу при ошибках

## Затронутые файлы

### Frontend
- [frontend/src/components/LocalVideo.js](frontend/src/components/LocalVideo.js) - полностью переписан с React NodeView
- Использование в:
  - [frontend/src/components/Editor.js](frontend/src/components/Editor.js) - визуальный редактор
  - [frontend/src/pages/admin/AdminCourseEditor.js](frontend/src/pages/admin/AdminCourseEditor.js) - редактор курсов
  - [frontend/src/pages/PageEditor.js](frontend/src/pages/PageEditor.js) - редактор страниц
  - [frontend/src/pages/CourseView.js](frontend/src/pages/CourseView.js) - просмотр курса

### Backend
- [backend/server.js](backend/server.js) - добавлены правильные MIME-типы и Range requests

## Тестирование

### Проверка в редакторе

1. Откройте **AdminCourseEditor** и создайте урок с 5-10 видео
2. Убедитесь:
   - ✅ Редактор открывается мгновенно (нет зависаний)
   - ✅ Видео показывают placeholder с иконкой Play
   - ✅ При клике на Play видео загружается и воспроизводится
   - ✅ Нет ошибок в консоли браузера

### Проверка просмотра

1. Откройте **CourseView** с уроком, содержащим видео
2. Проверьте:
   - ✅ Страница загружается быстро
   - ✅ Видео показывают poster (если задан) или placeholder
   - ✅ Видео загружаются по клику
   - ✅ Работает перемотка (seek) в видео
   - ✅ При ошибке показывается понятное сообщение

### Проверка MIME-типов

Откройте DevTools → Network и проверьте заголовки ответа для видео файлов:
```
Content-Type: video/mp4
Accept-Ranges: bytes
```

## Техническая документация

### Состояния компонента LazyVideoComponent

| Состояние | Описание | UI |
|-----------|----------|-----|
| `!isLoaded && !hasError` | Начальное состояние | Placeholder с Play кнопкой |
| `isLoaded && !hasError` | Видео загружено | `<video>` элемент с controls |
| `hasError` | Ошибка загрузки | Красное сообщение об ошибке |

### Параметры Intersection Observer

```javascript
{
  rootMargin: '100px',  // Загружать за 100px до появления
  threshold: 0.1        // Триггер при 10% видимости
}
```

### Атрибуты видео при загрузке

```javascript
{
  controls: true,       // Показывать controls
  preload: 'metadata',  // Загружать метаданные (после клика)
  poster: node.attrs.poster  // Превью изображение
}
```

## Миграция существующего контента

Старые видео в базе данных будут **автоматически** работать с новым компонентом:
- Парсер HTML распознает `div[data-local-video]`
- Атрибуты `src` и `poster` сохраняются
- Видео будут отображаться с новым UI placeholder

**Не требуется миграция данных!**

## Возможные проблемы и решения

### Видео не загружается

1. Проверьте путь к файлу в консоли (показывается в ошибке)
2. Убедитесь, что файл существует в `/uploads/`
3. Проверьте MIME-type в Network tab

### Placeholder не показывает poster

- Убедитесь, что атрибут `poster` задан при вставке видео
- Проверьте путь к poster изображению

### Видео не воспроизводится после загрузки

- Проверьте формат видео (поддерживаются: mp4, webm, ogg)
- Убедитесь, что браузер поддерживает кодек
- Проверьте консоль на ошибки декодирования

---

**Дата исправления**: 2026-01-18
**Версия**: 0.82+
**Авторы**: Claude Code
