const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
require('dotenv').config();

const { sequelize } = require('./models');
const { initBot } = require('./bot/telegramBot');
const { initDoctorReindexJob } = require('./jobs/doctorServicesReindex');
const notificationService = require('./services/notificationService');
const presence = require('./services/presence');
const sessions = require('./services/sessions');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const pageRoutes = require('./routes/pages');
const journalRoutes = require('./routes/journal');
const folderRoutes = require('./routes/folders');
const sidebarRoutes = require('./routes/sidebar');
const mediaRoutes = require('./routes/media');
const searchRoutes = require('./routes/search');
const settingsRoutes = require('./routes/settings');
const backupRoutes = require('./routes/backup');
const chatRoutes = require('./routes/chat');
const favoritesRoutes = require('./routes/favorites');
const accreditationsRoutes = require('./routes/accreditations');
const vehiclesRoutes = require('./routes/vehicles');
const mapRoutes = require('./routes/map');
const doctorCardsRoutes = require('./routes/doctor-cards');
const misProxyRoutes = require('./routes/mis-proxy');
const coursesRoutes = require('./routes/courses');
const analysesRoutes = require('./routes/analyses');
const servicesRoutes = require('./routes/services');
const calendarRoutes = require('./routes/calendar');
const kanbanRoutes = require('./routes/kanban');
const priceComparisonsRoutes = require('./routes/price-comparisons');
const parserProxyRoutes = require('./routes/parser-proxy');
const competitorMatchingRoutes = require('./routes/competitor-matching');
const reviewsRoutes = require('./routes/reviews');
const emailRoutes = require('./routes/email');
const hourNormsRoutes = require('./routes/hour-norms');
const roleNormsRoutes = require('./routes/role-norms');
const categoryNormsRoutes = require('./routes/category-norms');
const referralBonusesRoutes = require('./routes/referral-bonuses');
const referralReportsRoutes = require('./routes/referral-reports');
const executorSettingsRoutes = require('./routes/executor-settings');
const performedServiceBonusesRoutes = require('./routes/performed-service-bonuses');
const serviceConsumablesRoutes = require('./routes/service-consumables');
const telegramBotApiRoutes = require('./routes/telegram-bot-api');
const botManagementRoutes = require('./routes/bot-management');
const apiClientsRoutes = require('./routes/api-clients');
const notifyRoutes = require('./routes/notify');
const salaryRecordsRoutes = require('./routes/salary-records');
const cashPaymentsRoutes = require('./routes/cash-payments');
const rbExcelSourcesRoutes = require('./routes/rb-excel-sources');
const promotionsRoutes = require('./routes/promotions');
const partnerServicesRoutes = require('./routes/partner-services');
const doctorSchedulesRoutes      = require('./routes/doctor-schedules');
const rbScheduleDictsRoutes      = require('./routes/rb-schedule-dicts');
const tabelRecordsRoutes         = require('./routes/tabel-records');
const structuralDivisionsRoutes  = require('./routes/structural-divisions');
const rbHolidaysRoutes           = require('./routes/rb-holidays');
const rbDoctorHeadersRoutes      = require('./routes/rb-doctor-headers');
const rbActivityLogRoutes        = require('./routes/rb-activity-log');
const misAppointmentsRoutes      = require('./routes/mis-appointments');
const misPaymentsRoutes          = require('./routes/mis-payments');
const directoriesRoutes          = require('./routes/directories');
const ambulanceReportsRoutes     = require('./routes/ambulance-reports');
const certificateRegistryRoutes  = require('./routes/certificate-registry');
const doctorDayReportRoutes      = require('./routes/doctor-day-report');
const operationsReportsRoutes    = require('./routes/operations-reports');
const gynecologyReportsRoutes    = require('./routes/gynecology-reports');
const therapyReportsRoutes       = require('./routes/therapy-reports');
const surgeryReportsRoutes       = require('./routes/surgery-reports');
const discountReportsRoutes      = require('./routes/discount-reports');
const releaseNotesRoutes         = require('./routes/release-notes');

const app = express();

// --- HTTPS / TLS ---------------------------------------------------------
// Если заданы пути к сертификату и ключу и файлы существуют — поднимаем HTTPS,
// иначе (например, локальная разработка без сертификатов) — обычный HTTP.
const SSL_KEY_PATH  = process.env.SSL_KEY_PATH  || path.join(__dirname, '..', 'certs', 'certificate.key');
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || path.join(__dirname, '..', 'certs', 'certificate.crt');
const SSL_CA_PATH   = process.env.SSL_CA_PATH   || path.join(__dirname, '..', 'certs', 'certificate_ca.crt');

let server;
if (fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
  const httpsOptions = {
    key: fs.readFileSync(SSL_KEY_PATH),
    cert: fs.readFileSync(SSL_CERT_PATH),
  };
  if (fs.existsSync(SSL_CA_PATH)) {
    httpsOptions.ca = fs.readFileSync(SSL_CA_PATH);
  }
  server = https.createServer(httpsOptions, app);
  console.log('🔒 HTTPS enabled (TLS termination in Node)');
} else {
  server = http.createServer(app);
  console.log('⚠️  HTTPS certificates not found — starting in plain HTTP mode');
}

// Initialize Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? (process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : ['http://localhost:3000'])
      : '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Make io accessible to routes
app.set('io', io);

// Онлайн-статусы. Раньше здесь жила карта userId → Set<socketId>, и «в сети»
// означало «есть коннект» — из-за чего свёрнутое мобильное приложение висело
// онлайном часами. Теперь статус считает presence по heartbeat активности,
// а карта сокетов нужна только для принудительного разрыва отозванных сессий.
presence.init(io);

// sid → Set<socket>: чтобы снятая сессия отваливалась сразу, а не доживала до exp
const socketsBySession = new Map();

sessions.setRevocationListener((sids) => {
  for (const sid of sids) {
    const set = socketsBySession.get(sid);
    if (!set) continue;
    for (const socket of set) {
      socket.emit('session_revoked');
      socket.disconnect(true);
    }
    socketsBySession.delete(sid);
  }
});

// Socket.IO authentication.
// Раньше клиент сам присылал userId в событии `join`, и сервер ему верил — любой,
// кто дотянулся до порта, мог подписаться на чужую комнату и читать чужие сообщения.
// Теперь личность берётся исключительно из JWT в handshake.
io.use(async (socket, next) => {
  const { token } = socket.handshake.auth || {};
  const headerToken = socket.handshake.headers?.authorization?.startsWith('Bearer ')
    ? socket.handshake.headers.authorization.slice(7)
    : null;
  const raw = token || headerToken || socket.handshake.query?.token;

  if (!raw) {
    return next(new Error('AUTH_REQUIRED'));
  }

  try {
    const decoded = jwt.verify(raw, process.env.JWT_SECRET);

    // Сессия могла быть снята («выйти со всех устройств», потерянный телефон).
    // Токены без sid — легаси до ver. 6.49, живут до естественного истечения.
    if (decoded.sid) {
      const session = await sessions.getActiveSession(decoded.sid);
      if (!session || session.userId !== decoded.userId) {
        return next(new Error('AUTH_REVOKED'));
      }
      socket.sessionId = decoded.sid;
    }

    socket.userId = decoded.userId;
    // Момент, когда токен перестаёт быть валидным: сокет живёт неделями и
    // проверки в handshake недостаточно — иначе он переживёт свой токен.
    socket.tokenExpiresAt = decoded.exp ? decoded.exp * 1000 : null;
    next();
  } catch (err) {
    // TokenExpiredError сообщаем отдельно: клиенту нужно обновить токен, а не ретраить вечно
    next(new Error(err.name === 'TokenExpiredError' ? 'AUTH_EXPIRED' : 'AUTH_INVALID'));
  }
});

// Регистрирует сокет в личной комнате пользователя.
// Идемпотентно: вызывается и при подключении, и на legacy-событие `join`.
function registerSocket(socket) {
  const userId = socket.userId;
  if (!userId) return;

  socket.join(`user:${userId}`);

  if (socket.sessionId) {
    if (!socketsBySession.has(socket.sessionId)) {
      socketsBySession.set(socket.sessionId, new Set());
    }
    socketsBySession.get(socket.sessionId).add(socket);
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  // Личность уже известна из токена — комнату занимаем сразу, не дожидаясь `join`
  registerSocket(socket);

  // Legacy-событие: старые клиенты присылают сюда userId. Аргумент игнорируем —
  // доверяем только токену. Оставлено, чтобы не ломать уже собранный фронт.
  socket.on('join', () => registerSocket(socket));

  // Heartbeat активности: клиент шлёт его, пока реально на переднем плане
  // (AppState=active / visibilityState=visible), а не просто пока жив коннект.
  socket.on('presence:active', () => {
    if (socket.userId) presence.touch(socket.userId);
  });
  // Ушёл в фон / спрятал вкладку — гасим сразу, не дожидаясь протухания пинга
  socket.on('presence:away', () => {
    if (socket.userId) presence.away(socket.userId);
  });

  // Chat room join/leave (for typing indicators)
  socket.on('join_chat', ({chatId}) => {
    if (chatId) socket.join(`chat:${chatId}`);
  });
  socket.on('leave_chat', ({chatId}) => {
    if (chatId) socket.leave(`chat:${chatId}`);
  });
  socket.on('typing_start', ({chatId}) => {
    if (chatId && socket.userId) {
      socket.to(`chat:${chatId}`).emit('user_typing', {userId: socket.userId, chatId, isTyping: true});
    }
  });
  socket.on('typing_stop', ({chatId}) => {
    if (chatId && socket.userId) {
      socket.to(`chat:${chatId}`).emit('user_typing', {userId: socket.userId, chatId, isTyping: false});
    }
  });

  socket.on('disconnect', () => {
    if (socket.sessionId) {
      const set = socketsBySession.get(socket.sessionId);
      if (set) {
        set.delete(socket);
        if (set.size === 0) socketsBySession.delete(socket.sessionId);
      }
    }
    // Статус здесь намеренно не гасим: обрыв сокета на переключении сети или
    // при reload вкладки — не уход человека. Если он действительно ушёл,
    // пинги прекратятся и presence погасит его сам через ONLINE_TTL.
    // Явный уход клиент сообщает событием presence:away.
  });
});

// Сокет живёт неделями, а токен когда-нибудь протухает — проверки в handshake
// мало. Это подстраховка: отзыв сессии рвёт сокеты сразу через
// setRevocationListener, а сюда попадает то, что случилось в обход процесса
// (правка в БД руками). Отсюда и редкий интервал — чаще незачем.
setInterval(async () => {
  const now = Date.now();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.tokenExpiresAt && socket.tokenExpiresAt <= now) {
      socket.emit('session_expired');
      socket.disconnect(true);
      continue;
    }
    if (socket.sessionId) {
      const session = await sessions.getActiveSession(socket.sessionId);
      if (!session) {
        socket.emit('session_revoked');
        socket.disconnect(true);
      }
    }
  }
}, 5 * 60 * 1000).unref();

// Security middleware with CSP configuration for PDF preview
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "*"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "*"],
      frameSrc: ["'self'", "blob:"], // Разрешаем iframe для blob URLs (PDF preview)
      mediaSrc: ["'self'", "blob:", "*"],
      objectSrc: ["'self'", "blob:"],
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"]
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: true, // Allow all origins (API is protected by JWT auth)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  // X-Api-Key нужен публичному контуру /api/public: без него браузер не пропустит
  // preflight, и форма с сайта не уйдёт (curl это не воспроизводит — он preflight не шлёт)
  // X-Client-Type/X-Device-Name читает реестр сессий: по ним определяются срок
  // токена и подпись устройства в списке «мои устройства». Мобильное приложение
  // preflight не шлёт, но десктопная сборка и веб — да.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'Idempotency-Key', 'X-Client-Type', 'X-Device-Name']
}));

// Публичный API для внешних интеграций (сайт клиники и т.д.).
// Монтируется ДО express.json(), чтобы действовал собственный лимит размера тела
// в 100 КБ, а не общий 10gb. Аутентификация здесь своя — по ключу api_clients.
app.use('/api/public', require('./routes/public'));

// Body parsing
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ extended: true, limit: '10gb' }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Static files with proper MIME types
const serveStatic = express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res, filePath) => {
    // Устанавливаем правильные MIME-типы для видео
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.mp4') {
      res.setHeader('Content-Type', 'video/mp4');
    } else if (ext === '.webm') {
      res.setHeader('Content-Type', 'video/webm');
    } else if (ext === '.ogg') {
      res.setHeader('Content-Type', 'video/ogg');
    } else if (ext === '.avi') {
      res.setHeader('Content-Type', 'video/x-msvideo');
    } else if (ext === '.mov') {
      res.setHeader('Content-Type', 'video/quicktime');
    } else if (ext === '.mkv') {
      res.setHeader('Content-Type', 'video/x-matroska');
    }
    // Разрешаем частичную загрузку (Range requests) для видео
    res.setHeader('Accept-Ranges', 'bytes');
  }
});

app.use('/uploads', serveStatic);
app.use('/uploads/map', express.static(path.join(__dirname, 'uploads/map')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/sidebar', sidebarRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/accreditations', accreditationsRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api/map', mapRoutes);
app.use('/api/doctor-cards', doctorCardsRoutes);
app.use('/api/mis', misProxyRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/analyses', analysesRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/kanban', kanbanRoutes);
app.use('/api/price-comparisons', priceComparisonsRoutes);
app.use('/api/parser', parserProxyRoutes);
app.use('/api/competitor-matching', competitorMatchingRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/hour-norms', hourNormsRoutes);
app.use('/api/role-norms', roleNormsRoutes);
app.use('/api/category-norms', categoryNormsRoutes);
app.use('/api/referral-bonuses', referralBonusesRoutes);
app.use('/api/referral-reports', referralReportsRoutes);
app.use('/api/executor-settings', executorSettingsRoutes);
app.use('/api/performed-service-bonuses', performedServiceBonusesRoutes);
app.use('/api/service-consumables', serviceConsumablesRoutes);
app.use('/api/bots', botManagementRoutes);
app.use('/api/api-clients', apiClientsRoutes);
app.use('/api/bot-subscribers', require('./routes/bot-subscribers'));
app.use('/api/notify', notifyRoutes);
app.use('/api/salary-records', salaryRecordsRoutes);
app.use('/api/cash-payments', cashPaymentsRoutes);
app.use('/api/promotions', promotionsRoutes);
app.use('/api/partner-services', partnerServicesRoutes);
app.use('/api/doctor-schedules',     doctorSchedulesRoutes);
app.use('/api/rb-schedule-dicts',    rbScheduleDictsRoutes);
app.use('/api/tabel-records',        tabelRecordsRoutes);
app.use('/api/structural-divisions', structuralDivisionsRoutes);
app.use('/api/rb-holidays',         rbHolidaysRoutes);
app.use('/api/rb-doctor-headers',   rbDoctorHeadersRoutes);
app.use('/api/rb-activity-log',     rbActivityLogRoutes);
app.use('/api/rb-excel-sources',    rbExcelSourcesRoutes);
app.use('/api/mis-appointments',    misAppointmentsRoutes);
app.use('/api/mis-payments',        misPaymentsRoutes);
app.use('/api/directories',         directoriesRoutes);
app.use('/api/ambulance-reports',   ambulanceReportsRoutes);
app.use('/api/certificate-registry', certificateRegistryRoutes);
app.use('/api/doctor-day-report',   doctorDayReportRoutes);
app.use('/api/operations-reports',  operationsReportsRoutes);
app.use('/api/gynecology-reports',  gynecologyReportsRoutes);
app.use('/api/therapy-reports',     therapyReportsRoutes);
app.use('/api/surgery-reports',     surgeryReportsRoutes);
app.use('/api/discount-reports',    discountReportsRoutes);
app.use('/api/release-notes',       releaseNotesRoutes);

// Telegram Bot API compatibility layer — must come AFTER body parsing middleware
// URL format: /bot{token}/{method}  (matches api.telegram.org/bot{token}/{method})
app.use('/bot:token', telegramBotApiRoutes);

// Telegram Bot API file download endpoint
// URL: /file/bot{token}/{file_path}  (matches api.telegram.org/file/bot{token}/{file_path})
app.use('/file/bot:token', async (req, res, next) => {
  const { BotToken } = require('./models');
  const bot = await BotToken.findOne({ where: { token: req.params.token, isActive: true } }).catch(() => null);
  if (!bot) return res.status(401).json({ ok: false, error_code: 401, description: 'Unauthorized' });
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler — catches errors passed via next(err) in any route
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[ERROR] ${req.method} ${req.originalUrl} → ${status}:`, err.message);
  if (status === 500) console.error(err.stack);
  if (res.headersSent) return next(err);
  res.status(status).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message
  });
});

// Serve frontend static files in production
if (process.env.NODE_ENV === 'production') {
  const frontendBuildPath = path.join(__dirname, '..', 'frontend', 'build');

  // Serve static files from frontend build
  app.use(express.static(frontendBuildPath));

  // Handle React Router - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendBuildPath, 'index.html'));
  });
} else {
  // 404 handler for development (API only)
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
}

const PORT = process.env.PORT || 9001;

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    // Sync models (in development)
    // if (process.env.NODE_ENV === 'development') {
    //   await sequelize.sync({ alter: false });
    //   console.log('✅ Models synchronized');
    // }

    // Initialize Telegram bot
    initBot();

    // Initialize doctor services reindex cron job
    initDoctorReindexJob();

    // Initialize analyses price update cron job
    require('./cron/analysesCron');

    // Initialize services price update cron job
    require('./cron/servicesCron');

    // Initialize RB employee registry archive cron job (14-day stale → archived)
    require('./cron/rbEmployeeArchiveCron');

    // Initialize notification service with Socket.IO
    notificationService.init(io);

    // Initialize calendar reminders cron job
    require('./cron/calendarRemindersCron');

    // Initialize accreditations/vehicles reminders cron job (sends to chat)
    require('./cron/accreditationsVehiclesCron');

    // Initialize review sync cron job (twice a day: 08:00 and 20:00 MSK)
    require('./cron/reviewSyncCron');

    // Initialize review auto-archive cron job (daily at 04:00 MSK)
    require('./cron/reviewArchiveCron');

    // Initialize missed calls polling cron job (every minute, polls Nextcloud for ATC data)
    require('./cron/missedCallsCron');

    // Кэш услуг партнёров синхронизирует отдельный воркер scripts/syncWorker.js
    // (кросс-платформенно, через день, не зависит от веб-сервера). Здесь расписание не регистрируем.

    // Initialize MIS schedule auto-import cron job (14th and 28th at 03:00 MSK)
    require('./cron/misScheduleAutoImportCron');

    // Initialize MIS appointments daily sync cron job (00:05 MSK)
    require('./cron/misAppointmentsSyncCron');

    // Initialize MIS payments (списания/возвраты) daily sync cron job (00:10 MSK)
    require('./cron/misPaymentsSyncCron');

    // Повторная доставка заявок публичного API в чат (ежеминутно)
    require('./cron/submissionsRetryCron');

    // Забор прайсов конкурентов из alfa-parser (03:30 МСК)
    require('./cron/competitorPricesCron');

    // Ensure АТС bot user exists
    const { initMissedCallsBot } = require('./services/notificationService');
    await initMissedCallsBot();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`✅ Socket.IO initialized`);
      console.log(`✅ Notification service initialized`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Корректный останов. `pm2 reload` шлёт SIGINT/SIGTERM — до этой обработки
// онлайн-карта просто исчезала вместе с процессом, никому не записав lastSeen,
// и после рестарта все, кто был в сети, показывались «был(а) давно».
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} — сохраняем онлайн-статусы`);
  try {
    await presence.shutdown();
  } catch (e) {
    console.error('[shutdown] presence error:', e.message);
  }
  server.close(() => process.exit(0));
  // pm2 всё равно добьёт через kill_timeout (5с) — не висим дольше
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled promise rejections (async errors not caught by try/catch)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
  // Log but don't exit — PM2 will restart if things get truly broken
});

// Catch synchronous uncaught exceptions (should not happen in normal flow)
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.message, err.stack);
  // Give server 1s to finish in-flight requests, then exit so PM2 can restart
  setTimeout(() => process.exit(1), 1000);
});

module.exports = app;
