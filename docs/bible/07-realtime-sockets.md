# Глава 7. Реальное время — Socket.IO

Эта глава разбирает как именно работает живой чат, уведомления и онлайн-статусы — от установки соединения до доставки сообщения конкретному пользователю.

---

## Почему HTTP недостаточно для реального времени

Прежде чем разбирать Socket.IO, важно понять какую проблему он решает.

HTTP работает по модели "запрос-ответ": клиент инициирует запрос, сервер отвечает, соединение закрывается. Сервер **не может** сам отправить данные клиенту без запроса.

Для чата это означало бы: "а нет ли новых сообщений?" нужно спрашивать у сервера постоянно. Это называется **polling**:

```js
// Polling — плохой подход
setInterval(async () => {
  const messages = await api.chat.getMessages(chatId);
  setMessages(messages);
}, 2000); // Каждые 2 секунды
```

Проблемы polling:
- **Задержка** до 2 секунд между отправкой и получением
- **Нагрузка**: 100 пользователей × 0.5 запросов в секунду = 50 лишних запросов/сек в покое
- **Неэффективность**: большинство ответов "нет новых сообщений" — пустые

**WebSocket** решает это иначе: устанавливается постоянное TCP-соединение, через которое можно слать данные в любую сторону в любой момент.

---

## WebSocket: как устроено соединение

Установка WebSocket начинается с обычного HTTP-запроса:

```
Клиент → Сервер:
GET /socket.io/?EIO=4&transport=websocket HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==

Сервер → Клиент:
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

Статус `101 Switching Protocols` — "переключаюсь на WebSocket". После этого HTTP-протокол больше не используется. Соединение остаётся открытым, по нему идут фреймы WebSocket — лёгкие пакеты данных.

Каждый WebSocket фрейм: несколько байт заголовка + данные. Overhead минимален по сравнению с полноценным HTTP-запросом (заголовки, cookies, TCP handshake).

---

## Socket.IO поверх WebSocket

Socket.IO — это не просто WebSocket. Это абстракция, которая добавляет:

### Автоматическое переподключение

```js
// Socket.IO сам обрабатывает разрывы соединения
socket.on('disconnect', (reason) => {
  console.log('Разорвано:', reason);
  // Socket.IO автоматически попробует переподключиться
});

socket.on('reconnect', (attemptNumber) => {
  console.log('Переподключено с попытки', attemptNumber);
  // Нужно заново войти в комнаты
  socket.emit('join', userId);
});
```

Это критично для мобильных соединений и нестабильного WiFi.

### Fallback на Long Polling

Если WebSocket недоступен (корпоративные прокси, старые браузеры), Socket.IO автоматически переключается на **long polling**:

```
Клиент → Сервер: GET /socket.io/?transport=polling
Сервер держит соединение открытым...
...пока не появятся данные или не истечёт таймаут
Сервер → Клиент: [данные или пустой ответ]
Клиент сразу делает следующий запрос: GET /socket.io/?transport=polling
```

Это не идеально, но работает везде. В нашем проекте WebSocket всегда доступен — long polling не используется.

### Комнаты (Rooms)

Это важнейшая абстракция Socket.IO. **Комната** — это именованная группа подключений. Сообщение можно отправить всем в комнате:

```js
// Сервер
io.to('room-name').emit('event', data);  // Всем в комнате
socket.to('room-name').emit('event', data);  // Всем кроме себя
socket.join('room-name');  // Войти в комнату
socket.leave('room-name');  // Выйти из комнаты
```

Без комнат пришлось бы вести список подключений вручную и итерировать по ним.

### События (Events)

Socket.IO работает на событиях — это не HTTP-глаголы (GET/POST), а произвольные строки:

```js
// Сервер слушает
socket.on('my_custom_event', (data) => { ... });

// Клиент отправляет
socket.emit('my_custom_event', { key: 'value' });

// И наоборот:
// Клиент слушает
socket.on('server_pushed_update', (data) => { ... });

// Сервер отправляет
io.to(roomName).emit('server_pushed_update', data);
```

---

## Инициализация Socket.IO в проекте

### Сервер (server.js)

```js
const io = new Server(server, {
  cors: {
    // В production — только с разрешённых URL
    // В development — с любого
    origin: process.env.NODE_ENV === 'production'
      ? process.env.FRONTEND_URL?.split(',')
      : true,
    methods: ['GET', 'POST'],
    credentials: true
  }
});
```

`process.env.FRONTEND_URL` в production — это строка через запятую: `http://192.168.22.39:9001,http://192.168.22.39:9000`. Массив Origin разрешённых источников для WebSocket CORS.

### Аутентификация Socket.IO

Socket.IO имеет свой middleware (аналог Express middleware, но для WebSocket):

```js
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    
    if (!token) {
      return next(new Error('Токен не предоставлен'));
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.id);
    
    if (!user || !user.isActive) {
      return next(new Error('Пользователь не найден'));
    }
    
    socket.userId = decoded.id;  // Сохраняем userId в объекте сокета
    next();  // Разрешаем подключение
    
  } catch (err) {
    next(new Error('Невалидный токен'));
  }
});
```

Это middleware выполняется один раз — при установке соединения. Если токен невалиден — соединение отклоняется.

### Клиент (SocketContext.js)

```js
const socket = io(SOCKET_URL, {
  auth: {
    token: localStorage.getItem('token')  // Токен передаётся при handshake
  },
  reconnection: true,           // Автоматическое переподключение
  reconnectionAttempts: 10,     // Максимум попыток
  reconnectionDelay: 1000,      // Начальная задержка 1 сек
  reconnectionDelayMax: 5000    // Максимальная задержка 5 сек
});
```

Токен передаётся в `handshake.auth` — это специальный объект Socket.IO для данных аутентификации. Он доступен на сервере через `socket.handshake.auth.token`.

---

## Система комнат — полный разбор

В проекте используются три типа комнат:

### Личная комната пользователя

```js
// При подключении клиент "представляется"
socket.on('join', (userId) => {
  socket.join(`user_${userId}`);
  // Теперь socket находится в комнате 'user_550e8400-...'
});
```

Используется для доставки персональных уведомлений:
```js
// Из notificationService.js или route handler
io.to(`user_${targetUserId}`).emit('new_notification', {
  type: 'review_assigned',
  message: 'Вам назначен новый отзыв',
  data: { reviewId: 'abc-123' }
});
```

У каждого пользователя одна личная комната, но в ней может быть несколько сокетов (открытые вкладки).

### Комнаты чатов

```js
socket.on('join_chat', (chatId) => {
  socket.join(`chat_${chatId}`);
  // Теперь получает события из этого чата
});

socket.on('leave_chat', (chatId) => {
  socket.leave(`chat_${chatId}`);
});
```

Когда пользователь открывает чат — фронтенд вызывает `emit('join_chat', chatId)`. При закрытии — `emit('leave_chat', chatId)`.

Это важно: пользователь получает события только из тех чатов, которые сейчас открыты. Если чат закрыт (leave_chat) — новые сообщения не придут через WebSocket (придут при следующем открытии через HTTP-запрос с `unread count`).

### "Комната" для глобальных событий

Некоторые события рассылаются всем подключённым пользователям:
```js
io.emit('user_status_changed', { userId, status: 'offline' });
// io.emit (без .to()) — отправить ВСЕМ
```

Это используется для обновления онлайн-статусов в интерфейсе.

---

## Отслеживание онлайн-пользователей

Это один из самых интересных механизмов. Проблема: у одного пользователя может быть несколько вкладок/устройств — несколько сокетов.

```js
// В памяти сервера: userId → Set<socketId>
const onlineUsers = new Map();
```

`Map` — JavaScript структура данных "словарь". В отличие от обычного объекта, ключи могут быть любого типа. `Map<userId, Set<socketId>>` — для каждого userId хранится множество (Set) активных socketId.

```js
io.on('connection', (socket) => {
  const userId = socket.userId;  // Установлен в middleware аутентификации
  
  // Добавляем новое соединение
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socket.id);
  
  // Если это первое соединение этого пользователя — он стал онлайн
  if (onlineUsers.get(userId).size === 1) {
    io.emit('user_status_changed', { userId, status: 'online' });
  }
  
  socket.on('disconnect', async () => {
    const userSockets = onlineUsers.get(userId);
    
    if (userSockets) {
      userSockets.delete(socket.id);
      
      // Если ВСЕ вкладки закрыты — пользователь офлайн
      if (userSockets.size === 0) {
        onlineUsers.delete(userId);
        
        // Обновить lastSeen в БД
        await User.update(
          { lastSeen: new Date() },
          { where: { id: userId } }
        );
        
        io.emit('user_status_changed', {
          userId,
          status: 'offline',
          lastSeen: new Date()
        });
      }
    }
  });
});
```

**Важное ограничение**: `onlineUsers` — это обычный JavaScript объект в памяти. Он существует только в рамках одного Node.js-процесса. Именно поэтому в `ecosystem.config.js` указан `exec_mode: 'fork'` и `instances: 1`. Если запустить несколько процессов — у каждого будет своя копия `onlineUsers`, они не будут синхронизированы.

При перезапуске сервера `onlineUsers` сбрасывается — все "офлайн". Это нормально.

---

## Полный цикл: отправка и получение сообщения в чате

Разберём полный путь сообщения от нажатия "Отправить" до появления в чате получателя.

### 1. Пользователь нажимает "Отправить"

```js
// В компоненте чата (упрощённо)
const handleSend = async () => {
  if (!messageText.trim()) return;
  
  const optimisticMessage = {
    id: 'temp-' + Date.now(),  // Временный ID
    content: messageText,
    senderId: user.id,
    createdAt: new Date(),
    sender: user,
    isPending: true  // Пометить как "отправляется"
  };
  
  // Добавить в UI сразу (оптимистично)
  setMessages(prev => [...prev, optimisticMessage]);
  setMessageText('');
  
  try {
    // HTTP-запрос к API
    const saved = await api.chat.sendMessage(chatId, {
      content: messageText,
      type: 'text',
      replyToId: replyTo?.id || null
    });
    
    // Заменить временное сообщение реальным
    setMessages(prev => prev.map(m =>
      m.id === optimisticMessage.id ? { ...saved, isPending: false } : m
    ));
  } catch (err) {
    // Показать ошибку, убрать сообщение
    setMessages(prev => prev.filter(m => m.id !== optimisticMessage.id));
    toast.error('Ошибка отправки');
  }
};
```

**Оптимистичное обновление** — сообщение появляется в UI мгновенно, не дожидаясь ответа сервера. Пользователь видит свои сообщения без задержки. Если сервер вернёт ошибку — сообщение убирается.

### 2. HTTP POST на сервер

```js
// POST /api/chat/:chatId/messages
router.post('/:chatId/messages', authenticate, async (req, res) => {
  const { chatId } = req.params;
  const { content, type, replyToId, attachments } = req.body;
  
  // Проверить что пользователь — участник чата
  const membership = await ChatMember.findOne({
    where: { chatId, userId: req.user.id }
  });
  if (!membership) return res.status(403).json({ error: 'Нет доступа к чату' });
  if (membership.isReadOnly) return res.status(403).json({ error: 'Только чтение' });
  
  // Создать сообщение
  const message = await Message.create({
    chatId,
    senderId: req.user.id,
    content,
    type: type || 'text',
    replyToId,
    attachments: attachments || []
  });
  
  // Обновить lastMessage в Chat для превью
  await Chat.update(
    { lastMessage: content, lastMessageAt: new Date() },
    { where: { id: chatId } }
  );
  
  // Загрузить с данными отправителя (для рендера на клиенте)
  const fullMessage = await Message.findByPk(message.id, {
    include: [
      { model: User, as: 'sender', attributes: ['id', 'displayName', 'avatar'] },
      { model: Message, as: 'replyTo', include: [...] }
    ]
  });
  
  // PUSH через Socket.IO всем в комнате чата
  req.io.to(`chat_${chatId}`).emit('new_message', fullMessage);
  
  // Уведомить участников чата которые НЕ онлайн
  const members = await ChatMember.findAll({
    where: { chatId, isNotificationMuted: false }
  });
  
  for (const member of members) {
    if (member.userId === req.user.id) continue;  // Себе не шлём
    
    // Отправить через личную комнату
    req.io.to(`user_${member.userId}`).emit('new_notification', {
      type: 'new_message',
      chatId,
      message: content.substring(0, 100),
      senderName: req.user.displayName
    });
  }
  
  res.status(201).json(fullMessage);
});
```

Обрати внимание: `req.io` — это Socket.IO инстанс, прокинутый в `req`. В `server.js` это делается через middleware:
```js
app.use((req, res, next) => {
  req.io = io;  // Делаем io доступным в route handlers
  next();
});
```

### 3. Получение у адресата

У Василия открыта вкладка с этим чатом → его сокет находится в комнате `chat_${chatId}`.

```js
// В чате (фронтенд), при монтировании компонента
useEffect(() => {
  socket.emit('join_chat', chatId);  // Входим в комнату чата
  
  socket.on('new_message', (message) => {
    setMessages(prev => {
      // Если это наше оптимистичное сообщение — оно уже добавлено
      // Проверяем по senderId и времени чтобы избежать дублирования
      const isDuplicate = prev.some(m =>
        m.senderId === message.senderId &&
        Math.abs(new Date(m.createdAt) - new Date(message.createdAt)) < 2000
      );
      if (isDuplicate) return prev.map(m =>
        m.isPending && m.senderId === message.senderId ? message : m
      );
      return [...prev, message];
    });
    
    // Прокрутить к новому сообщению
    scrollToBottom();
    
    // Отметить как прочитанное (если чат открыт)
    markAsRead(chatId);
  });
  
  return () => {
    socket.emit('leave_chat', chatId);
    socket.off('new_message');
  };
}, [chatId, socket]);
```

`socket.off('new_message')` в cleanup функции `useEffect` — отписаться от события при размонтировании компонента. Если не отписаться — при следующем монтировании появится дублирующийся обработчик.

### 4. Индикатор набора текста

Отдельный механизм — индикатор "Василий печатает...":

```js
// При изменении текста в поле ввода
const handleTyping = useCallback(() => {
  socket.emit('typing_start', { chatId });
  
  // Через 3 секунды без изменений — остановка набора
  clearTimeout(typingTimer.current);
  typingTimer.current = setTimeout(() => {
    socket.emit('typing_stop', { chatId });
  }, 3000);
}, [chatId, socket]);

// На сервере
socket.on('typing_start', ({ chatId }) => {
  socket.to(`chat_${chatId}`).emit('user_typing', {
    userId: socket.userId,
    chatId,
    isTyping: true
  });
});

socket.on('typing_stop', ({ chatId }) => {
  socket.to(`chat_${chatId}`).emit('user_typing', {
    userId: socket.userId,
    chatId,
    isTyping: false
  });
});

// На клиенте у получателя
socket.on('user_typing', ({ userId, chatId, isTyping }) => {
  setTypingUsers(prev => {
    if (isTyping) return { ...prev, [userId]: true };
    const next = { ...prev };
    delete next[userId];
    return next;
  });
});
```

`socket.to('room').emit(...)` — отправить всем в комнате **кроме** отправителя. Это отличие от `io.to('room').emit(...)` (всем включая отправителя).

---

## Система уведомлений

### notificationService.js — центральный сервис

Этот сервис используется из route handlers, cron-задач, workflow engine — везде где нужно доставить уведомление пользователю.

```js
// Инициализация с io (вызывается один раз в server.js)
let _io = null;

const init = (io) => {
  _io = io;
};

// Отправить сообщение в чат от бота
const sendBotMessage = async (userId, botUserId, content, metadata = {}) => {
  // Найти или создать личный чат с ботом
  const chat = await getOrCreateBotChat(userId, botUserId);
  
  // Создать сообщение от имени бота
  const message = await Message.create({
    chatId: chat.id,
    senderId: botUserId,
    content,
    type: 'system',
    attachments: metadata.attachments || []
  });
  
  // Обновить prevью чата
  await Chat.update(
    { lastMessage: content, lastMessageAt: new Date() },
    { where: { id: chat.id } }
  );
  
  // Push через Socket.IO
  if (_io) {
    _io.to(`chat_${chat.id}`).emit('new_message', {
      ...message.toJSON(),
      sender: { id: botUserId, displayName: 'Ассистент', isBot: true }
    });
    
    // Личное уведомление
    _io.to(`user_${userId}`).emit('new_notification', {
      type: 'bot_message',
      chatId: chat.id,
      message: content.substring(0, 100)
    });
  }
};
```

### Три системных бота

У каждого бота — фиксированный UUID, заданный в коде:

```js
const ASSISTANT_BOT_ID = '00000000-0000-0000-0000-000000000001';
const REVIEWS_BOT_ID   = '00000000-0000-0000-0000-000000000002';
const ATS_BOT_ID       = '00000000-0000-0000-0000-000000000003';
```

Почему UUID с нулями? Это "зарезервированные" ID — они никогда не сгенерируются случайно (`UUIDV4` никогда не даст такой результат). Это гарантирует что эти боты всегда имеют одни и те же ID в любой установке.

Пример использования:
```js
// Из cron-задачи аккредитаций — уведомить всех менеджеров
const managers = await User.findAll({
  include: [{ model: Role, where: { name: 'Менеджер' } }]
});

for (const manager of managers) {
  await notificationService.sendBotMessage(
    manager.id,
    ASSISTANT_BOT_ID,
    `⚠️ Истекает аккредитация: ${accreditation.fullName} (${daysLeft} дней)`
  );
}
```

---

## Уведомления в Desktop-приложении (Tauri)

Когда пользователь работает в Tauri Desktop-приложении (Windows), уведомления системные:

```js
// В SocketContext.js
import * as tauriNotification from '@tauri-apps/plugin-notification';
import { invoke } from '@tauri-apps/api/core';

const handleNotification = async (data) => {
  // Проиграть звук
  notificationSound.play().catch(() => {});
  
  if (isTauri) {
    // Системное уведомление Windows
    await tauriNotification.sendNotification({
      title: 'Альфа Вики',
      body: data.message,
      icon: '/logo.png'
    });
    
    // Обновить счётчик на иконке в трее
    updateTrayBadge(unreadCount);
    
    // При клике на уведомление — вывести окно
    tauriNotification.onNotificationReceived(() => {
      invoke('bring_to_front');  // Tauri команда написанная на Rust
    });
  } else {
    // В браузере — Notification API
    if (Notification.permission === 'granted') {
      new Notification('Альфа Вики', { body: data.message });
    }
  }
};
```

`invoke('bring_to_front')` — это вызов Rust-кода из JavaScript. В `src-tauri/src/main.rs` есть Tauri-команда, которая переводит окно приложения на передний план.

### Рисование бейджа на иконке

```js
const updateTrayBadge = (count) => {
  if (!isTauri || count === 0) return;
  
  // Создать canvas, нарисовать красный кружок с цифрой
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  
  // Загрузить основную иконку
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, 32, 32);
    
    // Красный кружок
    ctx.fillStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(24, 8, 9, 0, 2 * Math.PI);
    ctx.fill();
    
    // Цифра
    ctx.fillStyle = 'white';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(count > 99 ? '99+' : count.toString(), 24, 12);
    
    // Передать в Tauri как base64
    const dataUrl = canvas.toDataURL();
    invoke('set_tray_icon', { icon: dataUrl });
  };
  img.src = '/logo.png';
};
```

---

## Счётчик непрочитанных сообщений

Счётчик непрочитанных — ещё один механизм требующий понимания.

### В базе данных

```sql
-- Сколько непрочитанных в конкретном чате
SELECT COUNT(*) 
FROM messages m
JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = :userId
WHERE m.chat_id = :chatId
  AND m.sender_id != :userId        -- Не считать свои сообщения
  AND m.created_at > cm.last_read_at  -- Новее чем последнее прочитанное
```

`ChatMember.lastReadAt` обновляется когда пользователь читает сообщения:
```js
// При открытии чата или получении нового сообщения при открытом чате
router.post('/:chatId/read', authenticate, async (req, res) => {
  await ChatMember.update(
    { lastReadAt: new Date() },
    { where: { chatId: req.params.chatId, userId: req.user.id } }
  );
  res.json({ success: true });
});
```

### На фронтенде

Общий счётчик всех непрочитанных:
```js
// GET /api/chat/unread/count → { total: 5, byChat: { 'chat-uuid': 3, 'chat-uuid-2': 2 } }
```

При получении нового сообщения через Socket.IO — счётчик инкрементируется. При открытии чата — сбрасывается через API `/read`.

---

## Пропущенные звонки — ATS интеграция

`missedCallsCron.js` — один из интереснейших cron-файлов. Каждую минуту он опрашивает Nextcloud ATS:

```js
cron.schedule('* * * * *', async () => {
  try {
    const response = await axios.get(process.env.MISSED_CALLS_NEXTCLOUD_URL);
    const calls = response.data;
    
    for (const call of calls) {
      // Определить куда направить уведомление
      const chatId = process.env[`MISSED_CALLS_ROUTE_${call.phone}`]
        || process.env.MISSED_CALLS_FALLBACK_CHAT_ID;
      
      if (!chatId) continue;
      
      // Отправить сообщение в нужный чат
      const message = await Message.create({
        chatId,
        senderId: ATS_BOT_ID,
        content: `📞 Пропущенный звонок с номера ${call.phone} в ${call.time}`,
        type: 'system'
      });
      
      // Push через Socket.IO
      io.to(`chat_${chatId}`).emit('new_message', message);
    }
  } catch (err) {
    console.error('ATS cron error:', err);
  }
});
```

Маршрутизация звонков: `.env` файл содержит переменные вида:
```
MISSED_CALLS_ROUTE_79001234567=<UUID чата регистратуры>
MISSED_CALLS_ROUTE_79007654321=<UUID чата колл-центра>
MISSED_CALLS_FALLBACK_CHAT_ID=<UUID общего чата>
```

Это простое, но эффективное решение: без БД, без сложной логики — просто mapping номеров на чаты через переменные окружения.

---

## Отладка Socket.IO

### Увидеть все события в браузере

```js
// В DevTools Console:
socket.onAny((event, ...args) => {
  console.log('Socket event:', event, args);
});
```

### Проверить подключение

```js
console.log('Connected:', socket.connected);
console.log('Socket ID:', socket.id);
```

### На сервере — посмотреть комнаты

```js
// Все комнаты
const rooms = io.sockets.adapter.rooms;
console.log(rooms);

// Сокеты в конкретной комнате
const socketsInRoom = await io.in(`chat_${chatId}`).fetchSockets();
console.log('Users in chat:', socketsInRoom.length);
```

### Типичные проблемы

**Сообщения приходят дважды** — не отписались от события при размонтировании компонента (`socket.off`).

**Не приходят уведомления** — пользователь не в нужной комнате (не вызвал `join`), или сокет потерял соединение.

**"Transport closed" при каждом запросе** — конфликт HTTP/WebSocket. Убедиться что `/socket.io/` маршрут не перехватывается другими middleware.

**Разные пользователи видят чужие уведомления** — неправильно именованные комнаты (например, используется числовой ID вместо UUID).
