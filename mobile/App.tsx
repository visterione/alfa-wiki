import React, {useEffect, useRef} from 'react';
import {StatusBar, AppState, Platform} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {
  getMessaging,
  onMessage,
  getInitialNotification,
  onNotificationOpenedApp,
} from '@react-native-firebase/messaging';
import {AuthProvider, useAuth} from './src/store/authStore';
import {SettingsProvider, useSettings} from './src/store/settingsStore';
import AppNavigator, {navigationRef} from './src/navigation/AppNavigator';
import NotificationService, {takePendingChat, takePendingCalendar} from './src/services/notifications';
import PushService from './src/services/push';
import {setForeground} from './src/services/activeChat';
import {syncCalendarReminders} from './src/services/calendarReminders';

function AppInner() {
  const {user, initialize} = useAuth();
  const {colors} = useSettings();
  const openChatRef = useRef<(chatId: string) => void>(() => {});

  // Переход в чат по тапу на уведомление. Навигатор к этому моменту может быть
  // ещё не смонтирован (холодный старт из уведомления), поэтому пробуем, а при
  // неудаче цель остаётся в очереди до следующей попытки.
  openChatRef.current = (chatId: string) => {
    if (!chatId || !navigationRef.isReady()) return;
    // Навигатор описан в .js без типов маршрутов, поэтому RootParamList пуст и
    // navigate() формально принимает never. Приводим точечно здесь, а не
    // засоряем вызов двойными `as never`.
    (navigationRef.navigate as (name: string, params?: object) => void)('ChatsTab', {
      screen: 'Chat',
      params: {chatId},
      initial: false,
    });
  };

  // Тап по напоминанию календаря — открываем вкладку календаря
  const openCalendarRef = useRef<() => void>(() => {});
  openCalendarRef.current = () => {
    if (!navigationRef.isReady()) return;
    (navigationRef.navigate as (name: string, params?: object) => void)('CalendarTab');
  };

  useEffect(() => {
    NotificationService.setup();
    initialize();
  }, [initialize]);

  // Только id: объект user пересоздаётся при каждом refreshUser, и подписки
  // пересобирались бы на ровном месте
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

    // Android: пуши через FCM, работают и когда приложение выгружено.
    // iOS: FCM пока недоступен (нет APNs), уведомления идут по сокету —
    // только пока приложение открыто.
    PushService.register();
    NotificationService.attachSocketListeners(userId);

    const unsubscribeForegroundEvents = NotificationService.registerForegroundEvents();

    // Push, пришедший пока приложение на экране
    let unsubscribeOnMessage = () => {};
    let unsubscribeOpened = () => {};
    if (Platform.OS === 'android') {
      const messaging = getMessaging();
      unsubscribeOnMessage = onMessage(messaging, async remoteMessage => {
        await NotificationService.handleRemoteMessage(remoteMessage);
      });
      // Тап по уведомлению, поднявший приложение из фона
      unsubscribeOpened = onNotificationOpenedApp(messaging, remoteMessage => {
        const chatId = remoteMessage?.data?.chatId;
        if (chatId) openChatRef.current(String(chatId));
      });
      // Холодный старт из уведомления
      getInitialNotification(messaging).then(remoteMessage => {
        const chatId = remoteMessage?.data?.chatId;
        if (chatId) openChatRef.current(String(chatId));
      });
    }

    // Локальные напоминания о событиях календаря. Раскладываются заново при
    // каждом входе: событие могли перенести или удалить с другого устройства.
    syncCalendarReminders();

    const subscription = AppState.addEventListener('change', state => {
      const active = state === 'active';
      setForeground(active);
      if (active) {
        // Отложенный тап по уведомлению — забираем, когда навигатор точно готов
        const chatId = takePendingChat();
        if (chatId) openChatRef.current(chatId);
        if (takePendingCalendar()) openCalendarRef.current();
        // Возврат в приложение — хороший момент подтянуть изменения календаря:
        // расписание уведомлений могло устареть, пока приложение было свёрнуто
        syncCalendarReminders();
      }
    });

    return () => {
      subscription.remove();
      unsubscribeForegroundEvents();
      unsubscribeOnMessage();
      unsubscribeOpened();
      NotificationService.detachSocketListeners();
    };
  }, [userId]);

  return (
    <>
      <StatusBar
        barStyle="light-content"
        backgroundColor={colors.headerGradientStart}
        translucent={false}
      />
      <AppNavigator />
    </>
  );
}

export default function App() {
  return (
    // Корень для жестов: без него зум фотографий и свайпы не получают событий
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaProvider>
        <AuthProvider>
          <SettingsProvider>
            <AppInner />
          </SettingsProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
