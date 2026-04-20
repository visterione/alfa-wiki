# Глава 8. Ключевые модули проекта

Эта глава — детальный разбор каждого крупного функционального модуля: что делает, из каких частей состоит, как части взаимодействуют.

---

## Модуль Вики-страниц

Это исходный и центральный модуль всего проекта.

### Жизненный цикл страницы

**Создание:**
```
1. Пользователь открывает /new-page
2. PageEditor.js рендерит пустой редактор
3. После заполнения — POST /api/pages { title, slug, content, contentType, folderId }
4. Backend: Page.create(data) + SearchIndex.upsert(indexData) + PageHistory.create(historyEntry)
5. Редирект на /page/:slug
```

**Редактирование:**
```
1. /page/:slug/edit → PageEditor.js с загруженными данными
2. При сохранении — PUT /api/pages/:id { content, title, ... }
3. Backend обновляет Page + обновляет SearchIndex + создаёт новую запись PageHistory
```

**Просмотр:**
```
1. /page/:slug → PageView.js
2. GET /api/pages/:identifier (по slug или UUID)
3. ContentRenderer.js рендерит в зависимости от contentType
```

### Типы страниц в деталях

**wysiwyg** — самый распространённый тип. Контент хранится как HTML-строка, сгенерированная TipTap:
```html
<h1>Заголовок</h1>
<p>Текст <strong>жирный</strong> и <em>курсив</em></p>
<table><tr><td>Ячейка</td></tr></table>
```

При просмотре — `dangerouslySetInnerHTML`. При редактировании — TipTap загружает HTML обратно в редактор.

**html** — страница с кастомным HTML/CSS/JS. Используется для сложных интерактивных справочников. Контент хранится как HTML, дополнительно — `customCss` и `customJs`. При просмотре — рендерится в `<iframe srcDoc="...">`. Изоляция важна: скрипт в iframe не может получить доступ к localStorage/cookies основного приложения.

**spreadsheet** — таблица. Контент — JSON структура Univer или LuckySheet. При просмотре — рендерится через SpreadsheetViewer (read-only). При редактировании — SpreadsheetEditor. Файлы таблиц могут быть очень большими (сотни KB JSON).

**file** — страница-ссылка на файл из медиатеки. `mediaId` указывает на запись в `media`. При просмотре — предпросмотр файла (PDF, изображение) или кнопка скачать.

### Иерархия папок и сайдбара

Важно понимать: **структура папок** и **структура сайдбара** — это **разные вещи**.

**Папки (Folder)** — физическая организация страниц. Страница принадлежит папке через `page.folderId`. Папки образуют дерево (папка в папке через `parentId`). Используется в `/explorer` — файловом менеджере.

**Сайдбар (SidebarItem)** — навигационная структура. Это то что видит пользователь в левой панели. Администратор вручную настраивает что показывать и в каком порядке. Элемент сайдбара может ссылаться на страницу, папку, внешний URL или быть просто заголовком/разделителем.

Таким образом: одна страница может быть в папке "Врачи" (физически), но отображаться в сайдбаре в разделе "Онкология" (навигационно).

### Поиск по страницам

`SearchIndex` — денормализованная таблица для поиска. При создании/обновлении страницы:

```js
await SearchIndex.upsert({
  entityType: 'page',
  entityId: page.id,
  title: page.title,
  content: page.searchContent || stripHtml(page.content),
  keywords: page.keywords,
  url: `/page/${page.slug}`,
  metadata: { contentType: page.contentType, folderId: page.folderId }
}, { conflictFields: ['entityType', 'entityId'] });
```

`stripHtml()` — убирает HTML-теги из контента, оставляя только текст для индексации.

Поиск:
```js
// Полнотекстовый поиск через PostgreSQL
const results = await SearchIndex.findAll({
  where: {
    [Op.or]: [
      { title: { [Op.iLike]: `%${query}%` } },
      { content: { [Op.iLike]: `%${query}%` } },
      Sequelize.literal(`keywords @> ARRAY['${query}']::text[]`)
    ]
  }
});
```

`Op.iLike` — case-insensitive LIKE. `@>` — PostgreSQL-оператор "содержит" для массивов.

### История изменений (PageHistory)

Каждое сохранение создаёт запись:

```js
// В routes/pages.js при PUT /:id
const diff = createDiff(page.content, newContent);

await PageHistory.create({
  pageId: page.id,
  userId: req.user.id,
  action: 'updated',
  changesSummary: diff,
  metadata: { previousTitle: page.title }
});
```

Функция `createDiff` из пакета `diff` создаёт текстовый diff (как в git):
```
- Старый текст
+ Новый текст
```

Просматривается в `PageHistoryModal.js` — модальное окно со списком версий и diff.

---

## Модуль Чата

### Архитектура чата

Чат состоит из двух слоёв:
- **HTTP API** — загрузка истории, создание/редактирование/удаление сообщений
- **Socket.IO** — real-time доставка новых сообщений и событий

Это важное разделение: при открытии чата загружается история через HTTP (последние N сообщений). Затем подписываемся на Socket.IO события чтобы получать новые сообщения в реальном времени.

### Загрузка истории сообщений

```js
// GET /api/chat/:chatId/messages?limit=50&before=messageId
router.get('/:chatId/messages', authenticate, async (req, res) => {
  const { limit = 50, before } = req.query;
  
  // Пагинация "в прошлое": загружаем сообщения старше заданного ID
  const where = { chatId: req.params.chatId };
  if (before) {
    const pivotMessage = await Message.findByPk(before);
    if (pivotMessage) {
      where.createdAt = { [Op.lt]: pivotMessage.createdAt };
    }
  }
  
  const messages = await Message.findAll({
    where,
    include: [
      { model: User, as: 'sender', attributes: ['id', 'displayName', 'avatar'] },
      { model: Message, as: 'replyTo', include: [...] }
    ],
    order: [['createdAt', 'DESC']],
    limit: parseInt(limit)
  });
  
  // Вернуть в хронологическом порядке
  res.json(messages.reverse());
});
```

**Пагинация "в прошлое"** — при скролле вверх загружаются более старые сообщения. Вместо offset-пагинации (которая нестабильна при добавлении новых записей) используется cursor-пагинация по `createdAt`.

### Типы сообщений

- `text` — обычное текстовое сообщение
- `image` — изображение (content = null, attachments = [{ url, thumbnail }])
- `file` — файл
- `system` — системное (от бота, о добавлении участника и т.д.)

### Группы: управление участниками

```js
// Добавить участника
router.post('/:chatId/members', authenticate, async (req, res) => {
  const { userId } = req.body;
  
  // Проверить что добавляющий — администратор группы
  const myMembership = await ChatMember.findOne({
    where: { chatId: req.params.chatId, userId: req.user.id, role: 'admin' }
  });
  if (!myMembership) return res.status(403).json({ error: 'Нет прав' });
  
  const [member, created] = await ChatMember.findOrCreate({
    where: { chatId: req.params.chatId, userId },
    defaults: { role: 'member' }
  });
  
  if (!created) return res.status(400).json({ error: 'Уже участник' });
  
  // Системное сообщение о добавлении
  const user = await User.findByPk(userId);
  await Message.create({
    chatId: req.params.chatId,
    senderId: req.user.id,
    content: `${req.user.displayName} добавил ${user.displayName}`,
    type: 'system'
  });
  
  // Уведомить группу через Socket.IO
  req.io.to(`chat_${req.params.chatId}`).emit('member_added', { userId, user });
  
  res.json(member);
});
```

### Реакции на сообщения

`MessageReaction` — отдельная таблица (в отдельном файле `models/messageReaction.js`):

```js
MessageReaction = sequelize.define('MessageReaction', {
  id: UUID,
  messageId: UUID,
  userId: UUID,
  emoji: STRING(10)   // '👍', '❤️', '😂'
}, { unique: [['messageId', 'userId', 'emoji']] });
// Один пользователь — одна реакция одним эмодзи на одно сообщение
```

При добавлении реакции через POST — Socket.IO уведомляет всех в чате. Реакции агрегируются на фронтенде:
```js
// Группировка реакций: { '👍': [user1, user2], '❤️': [user3] }
const groupedReactions = reactions.reduce((acc, r) => {
  if (!acc[r.emoji]) acc[r.emoji] = [];
  acc[r.emoji].push(r.user);
  return acc;
}, {});
```

---

## Модуль Канбан

### Концепция досок и задач

Канбан — метод управления задачами через визуальную доску с колонками. Каждая колонка — статус задачи. Задачи перетаскиваются между колонками.

Гибкость в проекте: названия статусов — произвольные строки. Администратор доски решает сколько колонок и как они называются. Это отличается от модуля Отзывов (там статусы фиксированные).

### Drag and Drop — как работает

Библиотека `@hello-pangea/dnd` реализует drag-and-drop:

```jsx
<DragDropContext onDragEnd={handleDragEnd}>
  {columns.map(column => (
    <Droppable droppableId={column.status} key={column.status}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`column ${snapshot.isDraggingOver ? 'drag-over' : ''}`}
        >
          {column.tasks.map((task, index) => (
            <Draggable draggableId={task.id} index={index} key={task.id}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.draggableProps}
                  {...provided.dragHandleProps}
                  className={`task-card ${snapshot.isDragging ? 'dragging' : ''}`}
                >
                  {task.title}
                </div>
              )}
            </Draggable>
          ))}
          {provided.placeholder}  {/* Резервирует место для перетаскиваемой карточки */}
        </div>
      )}
    </Droppable>
  ))}
</DragDropContext>
```

`onDragEnd` — вызывается когда пользователь отпускает карточку:

```js
const handleDragEnd = async (result) => {
  const { source, destination, draggableId } = result;
  
  if (!destination) return;  // Отпустили вне доски
  if (source.droppableId === destination.droppableId && source.index === destination.index) return;  // На то же место
  
  // Оптимистично обновить состояние
  const updatedTasks = reorderTasks(tasks, source, destination);
  setTasks(updatedTasks);
  
  // Сохранить на сервере
  try {
    await api.kanban.moveTask(draggableId, {
      newStatus: destination.droppableId,
      newIndex: destination.index
    });
  } catch (err) {
    setTasks(tasks);  // Откатить при ошибке
    toast.error('Ошибка перемещения');
  }
};
```

### sortOrder — порядок карточек

В каждой колонке карточки имеют порядок. При перемещении нужно обновить `sortOrder` для перемещённой карточки (и потенциально соседних).

Стратегия в проекте: при перемещении пересчитываются `sortOrder` для задач в затронутых колонках:

```js
// PUT /api/kanban/tasks/:id/move
router.post('/tasks/:id/move', authenticate, async (req, res) => {
  const { newStatus, newIndex } = req.body;
  const task = await KanbanTask.findByPk(req.params.id);
  
  // Получить все задачи в целевой колонке
  const tasksInColumn = await KanbanTask.findAll({
    where: { boardId: task.boardId, status: newStatus, archived: false },
    order: [['sortOrder', 'ASC']]
  });
  
  // Пересчитать sortOrder
  const updates = tasksInColumn.map((t, i) => ({
    id: t.id,
    sortOrder: i >= newIndex ? (i + 1) * 1000 : i * 1000
  }));
  
  // Обновить перемещённую задачу
  await task.update({ status: newStatus, sortOrder: newIndex * 1000 });
  
  res.json(task);
});
```

### Права доступа к доскам

```js
// BoardPermission роли:
// 'owner'  — полный контроль: удаление доски, управление участниками
// 'editor' — создание/редактирование/удаление задач
// 'viewer' — только просмотр

// Проверка в route handler
const checkBoardAccess = async (boardId, userId, requiredRole) => {
  const isAdmin = (await User.findByPk(userId)).isAdmin;
  if (isAdmin) return true;
  
  const permission = await BoardPermission.findOne({ where: { boardId, userId } });
  if (!permission) return false;
  
  const roleHierarchy = { viewer: 0, editor: 1, owner: 2 };
  return roleHierarchy[permission.role] >= roleHierarchy[requiredRole];
};
```

### Архивирование задач

Cron `kanbanArchiveCron.js` ежедневно в 03:00 архивирует выполненные задачи:

```js
// Задачи с status='done' (или другим финальным) старше N дней
const daysToArchive = settings.kanbanArchiveDays || 7;

await KanbanTask.update(
  { archived: true, archivedAt: new Date() },
  {
    where: {
      boardId: { [Op.in]: boardIds },
      status: { [Op.in]: finalStatuses },
      completedAt: { [Op.lt]: new Date(Date.now() - daysToArchive * 86400000) },
      archived: false
    }
  }
);
```

---

## Модуль Отзывов (Reviews)

Самый сложный модуль. Сочетает Kanban-подход с бизнес-процессом обработки отзывов.

### Поток обработки отзыва

```
Новый отзыв (вручную или авто-импорт)
  ↓ status: 'new'
  
Назначить исполнителя → status: 'in_progress'
  ↓
Если нужна доп. информация → status: 'request_info'
  ↓ (после получения информации)
  ↓
Подготовить ответ → status: 'verification_done'
  ↓
Опубликовать ответ → status: 'final' + заполнить decisionCategory + decisionDescription
  ↓
Автоархивирование через N дней
```

### Workflow Engine

Это "автоматический пилот" для рутинных действий. Настраивается через визуальный редактор в настройках доски.

Граф сохраняется в `ReviewBoard.workflowConfig`:
```json
{
  "scenarios": [{
    "id": "auto-assign-negative",
    "name": "Авто-назначение негативных",
    "nodes": [
      {
        "id": "t1",
        "type": "triggerNewReview",
        "data": { "condition": "negative" }
      },
      {
        "id": "a1",
        "type": "actionAssign",
        "data": { "userIds": ["user-uuid-обработчика"] }
      }
    ],
    "edges": [{ "source": "t1", "target": "a1" }]
  }]
}
```

`workflowEngine.js` выполняет граф:

```js
const runWorkflow = async (event, review, board, extraData, notificationService) => {
  if (!board.workflowConfig?.scenarios) return;
  
  for (const scenario of board.workflowConfig.scenarios) {
    // Найти триггерные узлы
    const triggers = scenario.nodes.filter(n => n.type.startsWith('trigger'));
    
    for (const trigger of triggers) {
      // Проверить совпадает ли триггер с событием
      if (!matchesTrigger(trigger, event, review)) continue;
      
      // Пройти по рёбрам графа от триггера
      const actionsToRun = getConnectedActions(trigger, scenario);
      
      for (const action of actionsToRun) {
        await executeAction(action, review, board, notificationService);
      }
    }
  }
};

const matchesTrigger = (trigger, event, review) => {
  if (trigger.type === 'triggerNewReview' && event === 'review_created') {
    const condition = trigger.data?.condition;
    if (condition === 'any') return true;
    if (condition === 'negative') return review.rating <= 2;
    if (condition === 'positive') return review.rating >= 4;
  }
  if (trigger.type === 'triggerStatusChange' && event === 'status_changed') {
    return trigger.data?.toStatus === review.status;
  }
  return false;
};

const executeAction = async (action, review, board, notificationService) => {
  if (action.type === 'actionAssign') {
    const userIds = action.data?.userIds || [];
    
    await review.update({
      assigneeIds: [...new Set([...(review.assigneeIds || []), ...userIds])]
    });
    
    // Уведомить назначенных
    for (const userId of userIds) {
      await notificationService.sendReviewNotification(userId, 'assigned', review, board);
    }
  }
};
```

### Синхронизация с агрегаторами

`reviewSync/index.js` + `reviewSync/adapters/getloyalty.js` — поддерживается синхронизация отзывов с внешними платформами.

GetLoyalty — агрегатор, через который можно получить отзывы с нескольких платформ через один API:

```js
// reviewSync/adapters/getloyalty.js
const syncFromGetloyalty = async (config) => {
  const { credentials, boardId } = config;
  
  const response = await axios.get('https://panel.getloyalty.io/api/reviews', {
    headers: { Authorization: `Bearer ${credentials.apiKey}` },
    params: { dateFrom: config.lastSyncAt || '2020-01-01' }
  });
  
  const reviews = response.data.reviews;
  let importedCount = 0;
  
  for (const review of reviews) {
    // Найти или создать платформу
    const [platform] = await ReviewPlatform.findOrCreate({
      where: { name: review.source },
      defaults: { isActive: true }
    });
    
    // Дедупликация: не импортировать повторно
    const existing = await Review.findOne({
      where: { externalId: review.id, boardId },
      paranoid: false  // Включая мягко-удалённые
    });
    
    if (existing) continue;
    
    await Review.create({
      boardId,
      platformId: platform.id,
      patientName: review.authorName || 'Аноним',
      reviewDate: review.date,
      rating: review.rating,
      reviewText: review.text,
      externalId: review.id,
      externalUrl: review.url,
      isAutoImported: true,
      importSource: 'getloyalty',
      syncedAt: new Date(),
      status: 'new'
    });
    
    importedCount++;
  }
  
  // Обновить статус синхронизации
  await config.update({
    lastSyncAt: new Date(),
    lastSyncStatus: 'success',
    lastSyncCount: importedCount
  });
};
```

### PDF-отчёт по отзыву

```js
// pdfService.js (упрощённо)
const generateReviewPdf = async (review, board, history) => {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
  
  // Кириллица требует явной регистрации шрифта
  doc.registerFont('DejaVu', path.join(__dirname, '../fonts/DejaVuSans.ttf'));
  doc.registerFont('DejaVu-Bold', path.join(__dirname, '../fonts/DejaVuSans-Bold.ttf'));
  doc.font('DejaVu');
  
  // Заголовок
  doc.font('DejaVu-Bold').fontSize(16).text(`Отчёт по отзыву #${review.id.substring(0,8)}`, { align: 'center' });
  doc.moveDown();
  
  // Основные данные
  doc.font('DejaVu').fontSize(11);
  doc.text(`Пациент: ${review.patientName}`);
  doc.text(`Дата отзыва: ${format(review.reviewDate, 'dd.MM.yyyy')}`);
  doc.text(`Рейтинг: ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}`);
  doc.moveDown();
  
  // Текст отзыва
  doc.font('DejaVu-Bold').text('Текст отзыва:');
  doc.font('DejaVu').text(review.reviewText);
  doc.moveDown();
  
  // История обработки
  if (history.length > 0) {
    doc.font('DejaVu-Bold').text('История обработки:');
    for (const entry of history) {
      doc.font('DejaVu').fontSize(10).text(
        `${format(entry.createdAt, 'dd.MM.yyyy HH:mm')} — ${entry.action}: ${entry.comment || ''}`
      );
    }
  }
  
  // Сохранить файл
  const dir = path.join(__dirname, `../uploads/reviews/${format(new Date(), 'yyyy-MM')}`);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `review-${review.id}.pdf`);
  
  doc.pipe(fs.createWriteStream(filePath));
  doc.end();
  
  // Ждём завершения записи файла
  await new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);
  });
  
  // Сохранить путь в БД
  await review.update({ reportPdfPath: filePath });
  
  return filePath;
};
```

---

## Модуль Курсов

### Структура данных

```
Course (курс)
  ├── Lesson 1 (урок)
  ├── Lesson 2
  ├── ...
  ├── TestQuestion 1 (вопрос теста)
  ├── TestQuestion 2
  └── ...
  
CourseProgress (прогресс пользователя)
  ├── completedLessons: ['lesson-1-id', 'lesson-2-id']
  ├── currentLessonId: 'lesson-3-id'
  ├── testScore: 85
  └── completedAt: null (или дата)
```

### Прохождение курса

```js
// Пользователь переходит к уроку
router.post('/:courseId/current-lesson', authenticate, async (req, res) => {
  const { lessonId } = req.body;
  
  // Найти или создать прогресс
  const [progress] = await CourseProgress.findOrCreate({
    where: { userId: req.user.id, courseId: req.params.courseId },
    defaults: { completedLessons: [], testAttempts: 0 }
  });
  
  await progress.update({ currentLessonId: lessonId });
  res.json(progress);
});

// Пользователь завершил урок
router.post('/:courseId/lessons/:lessonId/complete', authenticate, async (req, res) => {
  const progress = await CourseProgress.findOne({
    where: { userId: req.user.id, courseId: req.params.courseId }
  });
  
  const completed = new Set(progress.completedLessons || []);
  completed.add(req.params.lessonId);
  
  await progress.update({ completedLessons: Array.from(completed) });
  
  // Проверить прошёл ли все уроки
  const totalLessons = await Lesson.count({ where: { courseId: req.params.courseId } });
  const allCompleted = completed.size >= totalLessons;
  
  res.json({ progress, canTakeTest: allCompleted });
});
```

### Тест

```js
// Отправить ответы
router.post('/:courseId/test/submit', authenticate, async (req, res) => {
  const { answers } = req.body;  // [{ questionId, answerIndex }]
  
  const questions = await TestQuestion.findAll({
    where: { courseId: req.params.courseId },
    order: [['sortOrder', 'ASC']]
  });
  
  // Подсчитать правильные ответы
  let correct = 0;
  for (const answer of answers) {
    const question = questions.find(q => q.id === answer.questionId);
    if (question && question.correctAnswer === answer.answerIndex) {
      correct++;
    }
  }
  
  const score = Math.round((correct / questions.length) * 100);
  const passed = score >= (course.passingScore || 80);  // 80% по умолчанию
  
  const progress = await CourseProgress.findOne({
    where: { userId: req.user.id, courseId: req.params.courseId }
  });
  
  await progress.update({
    testScore: score,
    testAttempts: (progress.testAttempts || 0) + 1,
    completedAt: passed ? new Date() : null
  });
  
  res.json({ score, passed, correct, total: questions.length });
});
```

### Ограничение доступа

Курс может быть ограничен по **ролям** И по **медцентрам** (обе проверки, не ИЛИ):

```js
// middleware/auth.js
const checkCourseAccess = async (req, res, next) => {
  const course = await Course.findByPk(req.params.courseId, {
    include: [{ model: Role, as: 'allowedRoles' }, { model: MedCenter, as: 'allowedMedCenters' }]
  });
  
  if (req.user.isAdmin) return next();
  
  // Проверка ролей (если заданы)
  if (course.allowedRoles.length > 0) {
    const userRoleIds = req.user.Roles.map(r => r.id);
    const courseRoleIds = course.allowedRoles.map(r => r.id);
    const hasRole = userRoleIds.some(id => courseRoleIds.includes(id));
    if (!hasRole) return res.status(403).json({ error: 'Нет доступа' });
  }
  
  // Проверка медцентров (если заданы)
  if (course.allowedMedCenters.length > 0) {
    const userMedCenterIds = req.user.MedCenters.map(m => m.id);
    const courseMedCenterIds = course.allowedMedCenters.map(m => m.id);
    const hasMedCenter = userMedCenterIds.some(id => courseMedCenterIds.includes(id));
    if (!hasMedCenter) return res.status(403).json({ error: 'Нет доступа' });
  }
  
  next();
};
```

---

## Зарплатный модуль

Это наиболее предметно-специфичный модуль — нужно понимать логику бизнеса.

### Из чего складывается зарплата

```
Зарплата врача за период
  = Базовая часть (из МИС: сумма выполненных услуг × ставка)
  + Реферальные бонусы (если направил пациента к другому врачу)
  + Бонусы за выполненные услуги (за конкретные процедуры)
  − Расходники (стоимость материалов для процедуры)
  − (другие вычеты по настройкам ExecutorSettings)
```

### Источники данных

Данные о фактически выполненных услугах — из МИС Renovatio. Запрос через `/api/mis/*`:

```js
// В фронтенде зарплатного модуля
const fetchDoctorServices = async (misUserId, dateFrom, dateTo) => {
  const data = await api.mis.getServices({
    doctorId: misUserId,
    dateFrom,
    dateTo
  });
  // data.services = [{ serviceCode, serviceName, amount, price, clinicId }]
};
```

Backend просто проксирует запрос в МИС с API-ключом.

### ReferralBonus — структура бонусов

```
Например:
Терапевт Иванов (misUserId: 42) направил пациента к онкологу.
За это Иванову полагается 10% от стоимости услуг онколога.

В таблице referral_bonuses:
- misUserId: '42' (Иванов)
- serviceCode: 'ONCO001' (услуга онколога)
- bonusPercent: 10.00
- clinicId: '1' (в какой клинике)
```

### ExecutorSettings — индивидуальные настройки исполнителя

Некоторые врачи имеют нестандартные условия расчёта. `ExecutorSettings.settings` (JSONB) хранит эти настройки.

Например: "врач Петров работает по схеме 50% от прибыли, а не 40%".

### SalaryRecord — сохранённый расчёт

После расчёта зарплаты результат сохраняется в `SalaryRecord`:

```js
await SalaryRecord.create({
  misUserId,
  doctorName,
  dateFrom,
  dateTo,
  periodLabel: 'Март 2026',
  reportData: fullCalculationObject,  // JSON со всеми деталями
  excelData: base64ExcelFile,          // Excel для скачивания
  createdBy: req.user.id
});
```

Excel генерируется при расчёте и сохраняется в base64, чтобы при каждом нажатии "Скачать" не пересчитывать.

### CashPayment — выплаты наличными

Отдельная таблица для учёта выплат наличными:

```js
CashPayment {
  salaryRecordId: UUID,     // К какому расчёту относится
  misUserId: STRING,
  amount: DECIMAL,
  issuedAt: DATE,
  issuedByUserId: UUID,     // Кто выплатил (финансист)
  financistName: STRING,
  note: TEXT,
  editHistory: JSONB        // История изменений суммы
}
```

`editHistory` — JSONB массив, хранит кто когда и как изменял запись. Это ручной аудит-лог.

---

## Модуль Аккредитаций и Автопарка

Эти два модуля структурно идентичны — разберём один, второй аналогичен.

### Логика напоминаний

```js
// accreditationsVehiclesCron.js (09:00 каждый день)
cron.schedule('0 9 * * *', async () => {
  const today = new Date();
  const checkpoints = [90, 60, 30, 14, 7]; // За сколько дней предупреждать
  
  for (const days of checkpoints) {
    const targetDate = new Date(today.getTime() + days * 86400000);
    const flagField = `reminded${days}`;
    
    // Найти аккредитации которые:
    // 1. Истекают через ~days дней
    // 2. Уведомление за N дней ещё не отправлено
    const expiring = await Accreditation.findAll({
      where: {
        expirationDate: {
          [Op.gte]: targetDate,
          [Op.lt]: new Date(targetDate.getTime() + 86400000) // Диапазон ±1 день
        },
        isArchived: false,
        [flagField]: false  // Ещё не напоминали за этот срок
      }
    });
    
    for (const acc of expiring) {
      // Найти подписчиков Telegram
      const subscribers = await TelegramSubscriber.findAll({
        where: { isActive: true, subscribedToAccreditations: true }
      });
      
      // Отправить через Telegram
      for (const sub of subscribers) {
        await telegramBot.sendMessage(
          sub.chatId,
          `⚠️ Аккредитация истекает через ${days} дней!\n` +
          `Врач: ${acc.fullName}\n` +
          `Специальность: ${acc.specialty}\n` +
          `МедЦентр: ${acc.medCenter}\n` +
          `Дата истечения: ${format(acc.expirationDate, 'dd.MM.yyyy')}`
        );
      }
      
      // Также через внутренние уведомления
      const admins = await User.findAll({ where: { isAdmin: true } });
      for (const admin of admins) {
        await notificationService.sendBotMessage(admin.id, ASSISTANT_BOT_ID, `...`);
      }
      
      // Поставить флаг — больше не напоминать за этот срок
      await acc.update({ [flagField]: true });
    }
  }
});
```

`[flagField]: false` — вычисляемое имя свойства. `flagField` содержит строку `'reminded90'`, значит это `where: { reminded90: false }`.

---

## Модуль Почты (Email)

### Два транспортера

```js
// emailService.js
const createTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
});

const createBroadcastTransporter = () => {
  // Если задан отдельный SMTP для рассылок — использовать его
  if (process.env.SMTP_HOST_BROADCAST) {
    return nodemailer.createTransport({ host: process.env.SMTP_HOST_BROADCAST, ... });
  }
  return createTransporter();  // Иначе использовать основной
};
```

Разделение нужно по репутационным причинам: массовые рассылки могут попасть в спам и испортить репутацию домена. Отдельный SMTP для рассылок позволяет защитить основной адрес (используемый для 2FA).

### Отправка через API

```js
// POST /api/email/send
router.post('/send', authenticate, async (req, res) => {
  const { subject, htmlContent, recipients, attachments } = req.body;
  
  // recipients: [{ email, userId, displayName }]
  
  const transporter = createBroadcastTransporter();
  
  const results = await Promise.allSettled(
    recipients.map(recipient =>
      transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: recipient.email,
        subject,
        html: htmlContent,
        attachments: attachments?.map(a => ({
          filename: a.filename,
          path: a.path
        }))
      })
    )
  );
  
  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  
  // Логировать отправку
  await EmailLog.create({
    subject,
    htmlContent,
    recipients,
    sentBy: req.user.id,
    status: failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial',
    errorDetails: results.filter(r => r.status === 'rejected').map(r => r.reason?.message).join('; ')
  });
  
  res.json({ sent, failed, total: recipients.length });
});
```

`Promise.allSettled` — в отличие от `Promise.all` не прерывается при первой ошибке. Возвращает массив результатов для каждого промиса (fulfilled или rejected). Это нужно чтобы отправить письмо остальным получателям даже если один адрес вернул ошибку.

---

## Телеграм-бот и Bot API эмуляция

### Основной Telegram-бот

Инициализируется в `bot/index.js`:

```js
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  // Сохранить подписчика
  await TelegramSubscriber.findOrCreate({
    where: { chatId: chatId.toString() },
    defaults: {
      username: msg.from.username,
      firstName: msg.from.first_name,
      isActive: true
    }
  });
  
  await bot.sendMessage(chatId, 'Добро пожаловать! Вы подписаны на уведомления.');
});

// Команда /subscribe_accreditations
bot.onText(/\/subscribe_accreditations/, async (msg) => {
  await TelegramSubscriber.update(
    { subscribedToAccreditations: true },
    { where: { chatId: msg.chat.id.toString() } }
  );
  bot.sendMessage(msg.chat.id, 'Подписка на уведомления об аккредитациях активирована.');
});
```

### Эмуляция Telegram Bot API

Это нетривиальная возможность. Telegram Bot API использует целочисленные ID, REST-подобные методы и webhook-доставку.

Наш эмулятор реализует совместимый интерфейс:

```js
// telegram-bot-api.js (упрощённо)

// GET /bot{token}/getMe
app.get('/bot:token/getMe', async (req, res) => {
  const bot = await BotToken.findOne({ where: { token: req.params.token } });
  if (!bot) return res.status(401).json({ ok: false });
  
  res.json({
    ok: true,
    result: {
      id: await getIntId(bot.userId, 'user'),  // UUID → целое число
      username: bot.username,
      first_name: bot.name,
      is_bot: true
    }
  });
});

// POST /bot{token}/sendMessage
app.post('/bot:token/sendMessage', async (req, res) => {
  const { chat_id, text, parse_mode } = req.body;
  const bot = await BotToken.findOne({ where: { token: req.params.token } });
  
  // Преобразовать целочисленный chat_id → UUID
  const chatUuid = await uuidFromIntId(chat_id);
  
  // Создать сообщение в нашем чате
  const message = await Message.create({
    chatId: chatUuid,
    senderId: bot.userId,
    content: text,
    type: 'text'
  });
  
  // Push через Socket.IO
  io.to(`chat_${chatUuid}`).emit('new_message', message);
  
  // Ответить в формате Telegram API
  res.json({
    ok: true,
    result: {
      message_id: await getIntId(message.id, 'message'),
      chat: { id: chat_id },
      text
    }
  });
});
```

### Маппинг UUID ↔ Integer (IntIdMap)

```js
// botWebhookService.js
const getIntId = async (uuid, entityType) => {
  // Проверить кэш
  const cached = _intIdCache.get(uuid);
  if (cached) return cached;
  
  // Найти или создать маппинг
  const [mapping] = await IntIdMap.findOrCreate({
    where: { uuid, entityType },
    defaults: { uuid, entityType }
    // id (BIGINT autoincrement) назначается автоматически
  });
  
  _intIdCache.set(uuid, mapping.id);
  return mapping.id;
};

const uuidFromIntId = async (intId) => {
  const mapping = await IntIdMap.findByPk(intId);
  return mapping?.uuid;
};
```

`IntIdMap` с `BIGINT autoincrement` — PostgreSQL сам генерирует уникальные целые числа. Это гарантирует что UUID `550e8400-...` всегда получит один и тот же integer ID (например, `42`).

---

## Интеграция с МИС (Renovatio)

МИС — медицинская информационная система, где хранятся данные о врачах, пациентах, услугах, расписании.

`routes/mis-proxy.js` — простой прокси:

```js
router.post('/doctors', authenticate, async (req, res) => {
  const response = await axios.post(
    `${process.env.MIS_BASE_URL}/doctors`,
    req.body,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.MIS_API_KEY
      }
    }
  );
  res.json(response.data);
});
```

Фронтенд не делает запросы к МИС напрямую — только через наш backend. Это нужно:
1. МИС API-ключ не попадает в браузер
2. CORS — браузер не может делать запросы на `rnova.medcentralfa.ru` с нашего домена
3. Кэширование — можно добавить кэш на уровне backend

### PartnerServiceCache

`partner_service_cache` — кэшированная копия каталога услуг из МИС. Обновляется в 02:00 через `partnerServicesCacheCron.js`:

```js
cron.schedule('0 2 * * *', async () => {
  // Запросить все услуги по всем клиникам из МИС
  const services = await fetchAllServicesFromMIS();
  
  // Пересоздать кэш (bulk upsert)
  await PartnerServiceCache.bulkCreate(services, {
    updateOnDuplicate: ['title', 'price', 'isHidden', 'isDeleted', 'syncedAt']
  });
});
```

Это позволяет делать быстрые запросы к каталогу услуг (из кэша в нашей БД) вместо медленных запросов к МИС API при каждом открытии страницы.

---

## Карта (Map module)

Простой модуль для интерактивной карты с маркерами.

Маркеры хранятся в `map_markers`:
```js
MapMarker {
  lat: DOUBLE,       // 55.7558 (широта)
  lng: DOUBLE,       // 37.6173 (долгота)
  title: STRING,
  description: TEXT,
  color: STRING,     // '#ff4444' — цвет маркера
  media: JSONB,      // Прикреплённые фото
  category: STRING,  // 'clinic', 'pharmacy', 'parking'
  createdBy: UUID
}
```

Карта — видеофайл или тайловый слой. В `map.js`:
```js
// POST /api/map/upload — загрузить изображение карты
// GET /api/map/stream/:filename — стриминг видео-карты с Range requests
```

Маркеры рендерятся поверх изображения карты через позиционирование CSS (`position: absolute`, `left: %`, `top: %`).

---

## Резервное копирование (Backup)

```js
// POST /api/backup — создать резервную копию
router.post('/', authenticate, requireAdminAccess('backup'), async (req, res) => {
  const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
  const backupDir = process.env.BACKUP_PATH || './backups';
  const backupPath = path.join(backupDir, `backup_${timestamp}`);
  
  // 1. Дамп PostgreSQL
  const sqlPath = `${backupPath}.sql`;
  await execAsync(`pg_dump -U ${DB_USER} -d ${DB_NAME} -f "${sqlPath}"`);
  
  // 2. Архив файлов uploads
  const archive = archiver('zip');
  archive.directory('./uploads', 'uploads');
  archive.finalize();
  
  // 3. Объединить в один .zip
  const finalZip = `${backupPath}.zip`;
  // ... archiver добавляет SQL + uploads в один файл
  
  res.json({ filename: `backup_${timestamp}.zip`, size: stats.size });
});
```

`execAsync` — это `util.promisify(exec)` — промисифицированная версия `child_process.exec`. Позволяет запускать shell-команды (`pg_dump`) из Node.js.

### Очистка старых бэкапов

```js
// Автоматически удалять бэкапы старше N дней
const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;
const cutoffDate = new Date(Date.now() - retentionDays * 86400000);

const files = fs.readdirSync(backupDir);
for (const file of files) {
  const filePath = path.join(backupDir, file);
  const stats = fs.statSync(filePath);
  if (stats.mtime < cutoffDate) {
    fs.unlinkSync(filePath);
  }
}
```
