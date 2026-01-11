const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const { sequelize } = require('./models');
const { initBot } = require('./bot/telegramBot');
const { initDoctorReindexJob } = require('./jobs/doctorServicesReindex');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const pageRoutes = require('./routes/pages');
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
const calendarRoutes = require('./routes/calendar');

const app = express();

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
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    if (process.env.NODE_ENV === 'production') {
      const allowedOrigins = process.env.FRONTEND_URL 
        ? process.env.FRONTEND_URL.split(',') 
        : ['http://localhost:3000'];
      
      if (allowedOrigins.some(allowed => origin.startsWith(allowed))) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    }
    
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads/map', express.static(path.join(__dirname, 'uploads/map')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/pages', pageRoutes);
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
app.use('/api/calendar', calendarRoutes);

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

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

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
    require('./cron/analysesCron'); // <-- ДОБАВЛЕНО

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;