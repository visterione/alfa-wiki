const jwt = require('jsonwebtoken');
const { User, Role, MedCenter } = require('../models');

// Verify JWT token
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access token required' });
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

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Check if user is admin
const requireAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
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

module.exports = {
  authenticate,
  requireAdmin,
  requirePermission,
  checkPageAccess,
  optionalAuth
};