import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const startTime = Date.now();
    const token = localStorage.getItem('token');

    if (!token) {
      // Минимальная задержка для плавного отображения
      const elapsed = Date.now() - startTime;
      const minDelay = 300;
      if (elapsed < minDelay) {
        await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
      }
      setLoading(false);
      return;
    }

    try {
      const { data } = await auth.me();
      setUser(data);
    } catch (error) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } finally {
      // Минимальная задержка для плавного отображения
      const elapsed = Date.now() - startTime;
      const minDelay = 300;
      if (elapsed < minDelay) {
        await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
      }
      setLoading(false);
    }
  };

  const login = async (username, password) => {
    const { data } = await auth.login(username, password);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const updateUser = (userData) => {
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  // Функция для обновления данных пользователя с сервера
  const refreshUser = async () => {
    try {
      const { data } = await auth.me();
      setUser(data);
      localStorage.setItem('user', JSON.stringify(data));
      return data;
    } catch (error) {
      console.error('Failed to refresh user:', error);
      return null;
    }
  };

  const hasPermission = (resource, action) => {
    if (!user) return false;
    if (user.isAdmin) return true;

    // Проверяем права в множественных ролях
    if (user.roles && Array.isArray(user.roles)) {
      for (const role of user.roles) {
        if (role.permissions?.[resource]?.[action]) {
          return true;
        }
      }
    }

    // Проверяем старую систему (одна роль)
    return user.role?.permissions?.[resource]?.[action] || false;
  };

  const canAccessPage = (page) => {
    if (!user) return false;
    if (user.isAdmin) return true;
    if (!page.allowedRoles || page.allowedRoles.length === 0) return true;

    // Проверяем множественные роли
    if (user.roles && Array.isArray(user.roles)) {
      for (const role of user.roles) {
        if (page.allowedRoles.includes(role.id)) {
          return true;
        }
      }
    }

    // Проверяем старую систему (одна роль)
    return page.allowedRoles.includes(user.roleId);
  };

  // Проверка доступа к админ-разделу
  const hasAdminAccess = (section) => {
    if (!user) return false;
    if (user.isAdmin) return true; // Полные админы имеют доступ ко всему
    return user.adminAccess?.[section] || false;
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      updateUser,
      refreshUser,
      hasPermission,
      canAccessPage,
      hasAdminAccess,
      isAdmin: user?.isAdmin || false
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};