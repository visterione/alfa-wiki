const jwt = require('jsonwebtoken');
const { User, Role, MedCenter } = require('../models');
const sessions = require('../services/sessions');

// Токены без `sid` выданы до ver. 6.49, когда реестра сессий ещё не было.
// Принимаем их до естественного истечения — иначе выкат разлогинил бы разом
// всех, включая мобильных с годовым токеном. Когда старые токены вымрут
// (веб — неделя, мобилки — по мере перезахода), флаг можно снять, и тогда
// каждый запрос будет обязан предъявить живую сессию.
const LEGACY_TOKENS_OK = process.env.ALLOW_LEGACY_TOKENS !== 'false';

// Verify JWT token
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.sid) {
      const session = await sessions.getActiveSession(decoded.sid);
      if (!session || session.userId !== decoded.userId) {
        // Отдельный код, чтобы клиент понял: релогин, а не «сервер прилёг»
        return res.status(401).json({ error: 'Session revoked', code: 'SESSION_REVOKED' });
      }
      sessions.touchActivity(decoded.sid);
      req.sessionId = decoded.sid;
    } else if (!LEGACY_TOKENS_OK) {
      return res.status(401).json({ error: 'Session revoked', code: 'SESSION_REVOKED' });
    }

    const user = await User.findByPk(decoded.userId, {
      include: [
        { model: Role, as: 'role' },
        { model: Role, as: 'roles', through: { attributes: [] } },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] } }
      ],
      attributes: { exclude: ['password'] }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError' || error.name === 'NotBeforeError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    // Всё остальное — отказ на нашей стороне, а не проблема с токеном. Раньше
    // сюда же сваливалась любая ошибка запроса к БД (например, невыкаченная
    // миграция: модель просит колонку, которой в базе нет), и клиент честно
    // делал то, что положено делать при 401 — стирал токен. Со стороны это
    // выглядело как «вход прошёл и тут же выбросило на форму входа», причём
    // в логах не было ничего. Пусть такие случаи будут 500 и с записью.
    console.error('authenticate failed:', error);
    return res.status(500).json({ error: 'Ошибка проверки авторизации' });
  }
};

// Check if user is admin (полный админ доступ)
const requireAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Check if user has access to specific admin section
const requireAdminAccess = (section) => {
  return (req, res, next) => {
    // Полные админы имеют доступ ко всему
    if (req.user.isAdmin) {
      return next();
    }

    // Проверяем гранулярный доступ
    const adminAccess = req.user.adminAccess || {};
    if (!adminAccess[section]) {
      return res.status(403).json({
        error: `Access denied to admin section: ${section}`
      });
    }

    next();
  };
};

// Check specific permission - проверяет во всех ролях пользователя
const requirePermission = (resource, action) => {
  return (req, res, next) => {
    if (req.user.isAdmin) return next();

    // Проверяем права во всех ролях пользователя
    if (req.user.roles && Array.isArray(req.user.roles)) {
      for (const role of req.user.roles) {
        const permissions = role.permissions || {};
        const resourcePerms = permissions[resource] || {};
        if (resourcePerms[action]) {
          return next();
        }
      }
    }

    // Проверяем старую систему для обратной совместимости
    const permissions = req.user.role?.permissions || {};
    const resourcePerms = permissions[resource] || {};

    if (!resourcePerms[action]) {
      return res.status(403).json({
        error: `Permission denied: ${resource}.${action}`
      });
    }
    next();
  };
};

// Check page access by role
const checkPageAccess = async (req, res, next) => {
  try {
    const { Page } = require('../models');
    const pageId = req.params.id || req.params.pageId;
    
    if (!pageId) return next();
    
    const page = await Page.findByPk(pageId);
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    // Admin has access to everything
    if (req.user.isAdmin) {
      req.page = page;
      return next();
    }

    // Check if page has role restrictions
    if (page.allowedRoles && page.allowedRoles.length > 0) {
      const userRoleIds = req.user.roles?.map(r => r.id) || [];
      const hasAccess = userRoleIds.some(roleId => page.allowedRoles.includes(roleId));
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied to this page' });
      }
    }

    req.page = page;
    next();
  } catch (error) {
    next(error);
  }
};

// Optional authentication (for public pages)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findByPk(decoded.userId, {
      include: [
        { model: Role, as: 'role' },
        { model: Role, as: 'roles', through: { attributes: [] } },
        { model: MedCenter, as: 'medCenters', through: { attributes: [] } }
      ],
      attributes: { exclude: ['password'] }
    });

    if (user && user.isActive) {
      req.user = user;
    }
    next();
  } catch (error) {
    next();
  }
};

// Check course access by roles AND med centers (intersection rule)
const checkCourseAccess = async (req, res, next) => {
  try {
    const { Course } = require('../models');
    const courseId = req.params.id || req.params.courseId;

    if (!courseId) return next();

    const course = await Course.findByPk(courseId, {
      include: [
        { model: require('../models').Role, as: 'allowedRoles', through: { attributes: [] } },
        { model: require('../models').MedCenter, as: 'allowedMedCenters', through: { attributes: [] } }
      ]
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Admin has access to everything
    if (req.user.isAdmin) {
      req.course = course;
      return next();
    }

    // Check if course is published (only applies to non-admins)
    if (!course.isPublished) {
      return res.status(403).json({ error: 'Course not published' });
    }

    const hasRoleRestrictions = course.allowedRoles && course.allowedRoles.length > 0;
    const hasMedCenterRestrictions = course.allowedMedCenters && course.allowedMedCenters.length > 0;

    // If no restrictions at all, course is public
    if (!hasRoleRestrictions && !hasMedCenterRestrictions) {
      req.course = course;
      return next();
    }

    // Get user's role IDs and med center IDs
    const userRoleIds = req.user.roles?.map(r => r.id) || [];
    const userMedCenterIds = req.user.medCenters?.map(m => m.id) || [];

    // Check role access (if role restrictions exist)
    let hasRoleAccess = !hasRoleRestrictions; // If no role restrictions, pass
    if (hasRoleRestrictions) {
      const allowedRoleIds = course.allowedRoles.map(r => r.id);
      hasRoleAccess = userRoleIds.some(roleId => allowedRoleIds.includes(roleId));
    }

    // Check med center access (if med center restrictions exist)
    let hasMedCenterAccess = !hasMedCenterRestrictions; // If no med center restrictions, pass
    if (hasMedCenterRestrictions) {
      const allowedMedCenterIds = course.allowedMedCenters.map(m => m.id);
      hasMedCenterAccess = userMedCenterIds.some(mcId => allowedMedCenterIds.includes(mcId));
    }

    // Both conditions must be true (AND logic)
    if (!hasRoleAccess || !hasMedCenterAccess) {
      return res.status(403).json({ error: 'Access denied to this course' });
    }

    req.course = course;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  authenticate,
  requireAdmin,
  requireAdminAccess,
  requirePermission,
  checkPageAccess,
  checkCourseAccess,
  optionalAuth
};