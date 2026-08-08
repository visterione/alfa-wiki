/**
 * Заглушки нативных модулей для jest.
 *
 * Firebase, notifee и Keychain — нативные: в node-окружении их бинарной части
 * нет, и без моков падает уже импорт, до всякой проверки логики.
 */

// Жесты тоже нативные, но свой набор заглушек библиотека поставляет сама —
// без него падает импорт App.tsx, где GestureHandlerRootView оборачивает всё
// приложение
require('react-native-gesture-handler/jestSetup');

jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(() => Promise.resolve('test-fcm-token')),
  deleteToken: jest.fn(() => Promise.resolve()),
  onTokenRefresh: jest.fn(() => () => {}),
  onMessage: jest.fn(() => () => {}),
  onNotificationOpenedApp: jest.fn(() => () => {}),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
  setBackgroundMessageHandler: jest.fn(),
  requestPermission: jest.fn(() => Promise.resolve(1)),
  AuthorizationStatus: {NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2},
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn(() => Promise.resolve('messages')),
    requestPermission: jest.fn(() => Promise.resolve({authorizationStatus: 1})),
    displayNotification: jest.fn(() => Promise.resolve()),
    onForegroundEvent: jest.fn(() => () => {}),
    onBackgroundEvent: jest.fn(),
  },
  AndroidImportance: {HIGH: 4, LOW: 2},
  AndroidVisibility: {PUBLIC: 1, SECRET: -1},
  EventType: {PRESS: 1},
}));

// Настройки приложения хранятся в AsyncStorage — в тестах он тоже нативный
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  setGenericPassword: jest.fn(() => Promise.resolve()),
  resetGenericPassword: jest.fn(() => Promise.resolve()),
}));

// Пикеры дёргают TurboModuleRegistry.getEnforcing прямо на импорте —
// без мока падает сам require, до рендера
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(() => Promise.resolve([])),
}));

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
  launchCamera: jest.fn(),
}));

jest.mock('react-native-nitro-sound', () => {
  const stub = {
    setSubscriptionDuration: jest.fn(),
    addPlayBackListener: jest.fn(),
    removePlayBackListener: jest.fn(),
    addRecordBackListener: jest.fn(),
    removeRecordBackListener: jest.fn(),
    startPlayer: jest.fn(() => Promise.resolve('ok')),
    stopPlayer: jest.fn(() => Promise.resolve('ok')),
    pausePlayer: jest.fn(() => Promise.resolve('ok')),
    resumePlayer: jest.fn(() => Promise.resolve('ok')),
    seekToPlayer: jest.fn(() => Promise.resolve('ok')),
    setPlaybackSpeed: jest.fn(() => Promise.resolve('ok')),
    startRecorder: jest.fn(() => Promise.resolve('file:///voice.m4a')),
    stopRecorder: jest.fn(() => Promise.resolve('file:///voice.m4a')),
  };
  return {
    __esModule: true,
    default: stub,
    // soundInstance.js создаёт экземпляр явно через createSound()
    createSound: () => stub,
    AudioSourceAndroidType: {MIC: 1},
    OutputFormatAndroidType: {MPEG_4: 2},
    AudioEncoderAndroidType: {AAC: 3},
    AVEncoderAudioQualityIOSType: {high: 96},
  };
});

// Скачивание вложений: модуль поднимает NativeEventEmitter прямо на импорте
jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    config: jest.fn(() => ({fetch: jest.fn(() => Promise.resolve({path: () => '/tmp/file'}))})),
    fs: {dirs: {DocumentDir: '/tmp', DownloadDir: '/tmp'}},
    ios: {previewDocument: jest.fn(), openDocument: jest.fn()},
    android: {actionViewIntent: jest.fn()},
  },
}));

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    connected: false,
  })),
}));
