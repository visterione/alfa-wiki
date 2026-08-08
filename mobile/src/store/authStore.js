import React, {createContext, useContext, useState, useCallback, useEffect} from 'react';
import * as Keychain from 'react-native-keychain';
import {auth as authApi, setCachedToken, clearCachedToken} from '../services/api';
import SocketService from '../services/socket';
import PushService from '../services/push';

const KEYCHAIN_OPTIONS = {service: 'alfa-wiki'};
const AuthContext = createContext(null);

export function AuthProvider({children}) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Called once on app start — checks for stored token
  const initialize = useCallback(async () => {
    setIsLoading(true);
    try {
      const credentials = await Keychain.getGenericPassword(KEYCHAIN_OPTIONS);
      if (credentials) {
        // Cache token immediately — all subsequent API calls use memory, not Keychain
        setCachedToken(credentials.password);
        const response = await authApi.me();
        const userData = response.data.user ?? response.data;
        setUser(userData);
        // Connect socket in background — don't block showing the UI
        SocketService.connect(userData.id, credentials.password).catch(() => {});
      }
    } catch {
      // Token invalid or server unreachable — clear it
      clearCachedToken();
      await Keychain.resetGenericPassword(KEYCHAIN_OPTIONS);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Called after successful login (instead of re-calling initialize).
  // Сокет здесь не поднимаем: LoginScreen.finishLogin уже вызывает
  // SocketService.connect с токеном на руках, второй вызов только плодит
  // параллельное подключение.
  const loginComplete = useCallback((userData) => {
    setUser(userData);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const response = await authApi.me();
      setUser(response.data.user ?? response.data);
    } catch {}
  }, []);

  // Локальная часть выхода. Отдельно от logout, потому что вызывается ещё и
  // когда сессию сняли с другого устройства: ходить на сервер там уже незачем
  // (токен недействителен), а ключи почистить и уйти на экран входа надо.
  const clearSession = useCallback(async () => {
    SocketService.disconnect();
    clearCachedToken();
    await Keychain.resetGenericPassword(KEYCHAIN_OPTIONS);
    setUser(null);
  }, []);

  const logout = useCallback(async () => {
    // Токен устройства отзываем ДО сброса ключей: запрос ещё должен пройти
    // авторизацию, иначе следующий владелец телефона получит чужие уведомления
    await PushService.unregister();
    // Снимаем сессию на сервере. Если не вышло (нет сети) — всё равно выходим
    // локально: держать человека в приложении из-за упавшего запроса нельзя.
    try {
      await authApi.logout();
    } catch {}
    await clearSession();
  }, [clearSession]);

  // Сервер сообщает по сокету, что сессия мертва («выйти везде» с другого
  // устройства, снятая админом сессия, истёкший токен) — выходим сами, не
  // дожидаясь, пока на это наткнётся первый HTTP-запрос.
  useEffect(() => {
    SocketService.setSessionEndHandler(() => {
      clearSession();
    });
    return () => SocketService.setSessionEndHandler(null);
  }, [clearSession]);

  return (
    <AuthContext.Provider value={{user, isLoading, initialize, loginComplete, refreshUser, logout}}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
