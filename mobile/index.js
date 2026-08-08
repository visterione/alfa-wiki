/**
 * @format
 */

// Обязательно первым импортом: библиотека жестов подменяет обработку касаний
// на нативном уровне и должна успеть до того, как поднимется приложение
import 'react-native-gesture-handler';
import { AppRegistry, Platform } from 'react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';
import NotificationService from './src/services/notifications';

// Обработчики фоновых событий обязаны регистрироваться вне дерева React:
// когда приложение выгружено из памяти, компонентов ещё нет, а показать
// сообщение уже нужно.

// Тап по уведомлению, пока приложение в фоне
NotificationService.registerBackgroundHandler();

// Входящий push, пока приложение свёрнуто или выгружено.
// Сервер шлёт data-only сообщения — систему уведомление не рисует, это делаем
// мы сами через notifee. Без этого обработчика push просто не будет виден.
if (Platform.OS === 'android') {
  setBackgroundMessageHandler(getMessaging(), async remoteMessage => {
    await NotificationService.handleRemoteMessage(remoteMessage);
  });
}

AppRegistry.registerComponent(appName, () => App);
