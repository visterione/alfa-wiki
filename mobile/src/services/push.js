import {Platform} from 'react-native';
import {
  getMessaging,
  getToken,
  deleteToken,
  onTokenRefresh,
  requestPermission,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import DeviceInfoLite from './deviceInfoLite';
import {chat as chatApi} from './api';

/**
 * Регистрация устройства для push-уведомлений.
 *
 * Сейчас работает только Android — на iOS FCM без APNs-ключа токен не выдаёт
 * (Apple Developer Program не оплачен). iOS сознательно не регистрируется:
 * мёртвые токены в таблице user_devices никому не нужны, а уведомления там
 * приходят по сокету, пока приложение открыто.
 *
 * Когда APNs подключат: снять ограничение по платформе и передавать
 * provider:'apns'. Бэкенд к этому уже готов — колонка provider есть,
 * рассылка фильтрует по ней.
 */

const PUSH_SUPPORTED = Platform.OS === 'android';

let currentToken = null;
let unsubscribeRefresh = null;

async function sendTokenToServer(token) {
  try {
    await chatApi.registerDevice({
      token,
      platform: Platform.OS,
      provider: 'fcm',
      appVersion: DeviceInfoLite.appVersion,
      deviceName: DeviceInfoLite.deviceName,
    });
    currentToken = token;
    console.log('[Push] Токен зарегистрирован на сервере');
  } catch (e) {
    // Не критично: при следующем запуске попробуем снова
    console.warn('[Push] Не удалось зарегистрировать токен:', e?.message);
  }
}

const PushService = {
  isSupported: () => PUSH_SUPPORTED,

  /**
   * Вызывается после успешного входа. Идемпотентна.
   */
  async register() {
    if (!PUSH_SUPPORTED) {
      console.log('[Push] Платформа без FCM — уведомления только через сокет');
      return null;
    }

    try {
      const messaging = getMessaging();

      const status = await requestPermission(messaging);
      const granted =
        status === AuthorizationStatus.AUTHORIZED ||
        status === AuthorizationStatus.PROVISIONAL;
      if (!granted) {
        console.warn('[Push] Пользователь отказал в уведомлениях');
        return null;
      }

      const token = await getToken(messaging);
      if (!token) return null;

      await sendTokenToServer(token);

      // FCM может перевыпустить токен в любой момент (переустановка, очистка
      // данных, ротация). Без этой подписки пуши тихо перестанут приходить.
      if (unsubscribeRefresh) unsubscribeRefresh();
      unsubscribeRefresh = onTokenRefresh(messaging, newToken => {
        console.log('[Push] Токен обновлён');
        sendTokenToServer(newToken);
      });

      return token;
    } catch (e) {
      console.warn('[Push] Ошибка регистрации:', e?.message);
      return null;
    }
  },

  /**
   * Вызывается при выходе из аккаунта: гасим токен на сервере и удаляем
   * локально, иначе следующий владелец телефона получит чужие уведомления.
   */
  async unregister() {
    if (unsubscribeRefresh) {
      unsubscribeRefresh();
      unsubscribeRefresh = null;
    }
    if (!PUSH_SUPPORTED || !currentToken) return;

    try {
      await chatApi.unregisterDevice(currentToken);
    } catch (e) {
      console.warn('[Push] Не удалось отозвать токен на сервере:', e?.message);
    }

    try {
      await deleteToken(getMessaging());
    } catch (e) {
      console.warn('[Push] Не удалось удалить токен локально:', e?.message);
    }
    currentToken = null;
  },
};

export default PushService;
