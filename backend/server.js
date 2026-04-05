const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const { sequelize, User } = require('./models');
const { initBot } = require('./bot/telegramBot');
const { initDoctorReindexJob } = require('./jobs/doctorServicesReindex');
const notificationService = require('./services/notificationService');

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
const reviewsRoutes = require('./routes/reviews');
const emailRoutes = require('./routes/email');
const hourNormsRoutes = require('./routes/hour-norms');
const roleNormsRoutes = require('./routes/role-norms');
const referralBonusesRoutes = require('./routes/referral-bonuses');
const referralReportsRoutes = require('./routes/referral-reports');
const executorSettingsRoutes = require('./routes/executor-settings');
const performedServiceBonusesRoutes = require('./routes/performed-service-bonuses');
const serviceConsumablesRoutes = require('./routes/service-consumables');
const telegramBotApiRoutes = require('./routes/telegram-bot-api');
const botManagementRoutes = require('./routes/bot-management');
const notifyRoutes = require('./routes/notify');
const salaryRecordsRoutes = require('./routes/salary-records');
const cashPaymentsRoutes = require('./routes/cash-payments');
const promotionsRoutes = require('./routes/promotions');

const app = express();
const server = http.createServer(app);

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

// Online users: userId → Set<socketId>
const onlineUsers = new Map();
app.set('onlineUsers', onlineUsers);

// Socket.IO connection handling
io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    socket.join(`user:${userId}`);
    socket.userId = userId;

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    const wasOffline = onlineUsers.get(userId).size === 0;
    onlineUsers.get(userId).add(socket.id);

    if (wasOffline) {
      // Broadcast to all connected clients that this user is now online
      socket.broadcast.emit('user_status_changed', { userId, isOnline: true });
    }
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

  socket.on('disconnect', async () => {
    const userId = socket.userId;
    if (!userId) return;

    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(userId);
        const lastSeen = new Date();
        // Persist lastSeen to DB (fire-and-forget)
        User.update({ lastSeen }, { where: { id: userId } }).catch(() => {});
        // Notify all clients this user went offline
        io.emit('user_status_changed', { userId, isOnline: false, lastSeen: lastSeen.toISOString() });
      }
    }
  });
});

// Security middleware with CSP configuration for PDF preview
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "*"],
      fontSrc: ["'self'", "data:"],
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
  allowedHeaders: ['Content-Type', 'Authorization']
}));

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
app.use('/api/reviews', reviewsRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/hour-norms', hourNormsRoutes);
app.use('/api/role-norms', roleNormsRoutes);
app.use('/api/referral-bonuses', referralBonusesRoutes);
app.use('/api/referral-reports', referralReportsRoutes);
app.use('/api/executor-settings', executorSettingsRoutes);
app.use('/api/performed-service-bonuses', performedServiceBonusesRoutes);
app.use('/api/service-consumables', serviceConsumablesRoutes);
app.use('/api/bots', botManagementRoutes);
app.use('/api/notify', notifyRoutes);
app.use('/api/salary-records', salaryRecordsRoutes);
app.use('/api/cash-payments', cashPaymentsRoutes);
app.use('/api/promotions', promotionsRoutes);

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

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
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

module.exports = app;