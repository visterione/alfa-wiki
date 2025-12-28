const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const { sequelize } = require('./models');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const pageRoutes = require('./routes/pages');
const sidebarRoutes = require('./routes/sidebar');
const mediaRoutes = require('./routes/media');
const searchRoutes = require('./routes/search');
const settingsRoutes = require('./routes/settings');
const backupRoutes = require('./routes/backup');
const chatRoutes = require('./routes/chat');

const app = express();

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS configuration - разрешаем запросы с любого origin в development
app.use(cors({
  origin: (origin, callback) => {
    // Разрешаем запросы без origin (curl, Postman, мобильные приложения)
    if (!origin) return callback(null, true);
    
    // В production проверяем FRONTEND_URL
    if (process.env.NODE_ENV === 'production') {
      const allowedOrigins = process.env.FRONTEND_URL 
        ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
        : [];
      
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Также разрешаем если origin на том же хосте
      try {
        const originUrl = new URL(origin);
        const allowed = allowedOrigins.some(allowed => {
          try {
            const allowedUrl = new URL(allowed);
            return originUrl.hostname === allowedUrl.hostname;
          } catch { return false; }
        });
        if (allowed) return callback(null, true);
      } catch {}
      
      return callback(new Error('Not allowed by CORS'));
    }
    
    // В development разрешаем все origins
    callback(null, true);
  },
  credentials: true
}));

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/sidebar', sidebarRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/chat', chatRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

// Database sync and server start
async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');
    
    // Sync models (in dev mode, use alter; in prod, use migrations)
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: true });
      console.log('✅ Models synchronized');
    }
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
      console.log(`📁 Uploads available at http://0.0.0.0:${PORT}/uploads`);
    });
  } catch (error) {
    console.error('❌ Unable to start server:', error);
    process.exit(1);
  }
}

startServer();