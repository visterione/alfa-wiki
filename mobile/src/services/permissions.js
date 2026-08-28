import {Platform, PermissionsAndroid, Alert, Linking} from 'react-native';
import {Camera} from 'react-native-vision-camera';

/**
 * Разрешения устройства — одно место на всё приложение.
 *
 * ── Почему через vision-camera ──────────────────────────────────────────────
 *
 * На Android разрешения спрашивает сам React Native (PermissionsAndroid), а на
 * iOS в нём такого нет вовсе: там каждая библиотека просит своё сама, когда
 * доберётся до железа. Это и оказалось источником двух одинаковых багов —
 * микрофона (ver. 7.55) и камеры (ver. 7.58): системное окно поднималось
 * посреди чужой работы, и до ответа человека дело не доходило.
 *
 * vision-camera уже есть в проекте ради сканера этикеток, и под капотом у неё
 * AVCaptureDevice.requestAccess — то же самое разрешение, но запрошенное
 * отдельно и с честным ожиданием ответа.
 *
 * ── Почему три состояния, а не «да/нет» ─────────────────────────────────────
 *
 * «Отказался сейчас» и «запретил навсегда» требуют разного: в первом случае
 * человеку сказать нечего — он только что сам нажал «Не разрешать». Во втором
 * системное окно больше не покажется никогда, и единственный выход — настройки
 * системы; не сказав об этом, мы оставляем человека нажимать кнопку, которая
 * молча ничего не делает.
 */

const ANDROID = {
  camera: {
    permission: PermissionsAndroid.PERMISSIONS.CAMERA,
    title: 'Доступ к камере',
    message: 'Нужен, чтобы снимать фото прямо в переписку',
  },
  microphone: {
    permission: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    title: 'Доступ к микрофону',
    message: 'Нужен, чтобы записывать голосовые сообщения',
  },
};

const IOS = {
  camera: {
    status: () => Camera.getCameraPermissionStatus(),
    request: () => Camera.requestCameraPermission(),
  },
  microphone: {
    status: () => Camera.getMicrophonePermissionStatus(),
    request: () => Camera.requestMicrophonePermission(),
  },
};

/**
 * Спросить разрешение и дождаться ответа.
 *
 * @param {'camera'|'microphone'} kind
 * @returns {Promise<'granted'|'denied'|'blocked'>}
 */
export async function ask(kind) {
  if (Platform.OS !== 'android') {
    const ios = IOS[kind];
    try {
      const status = ios.status();
      if (status === 'granted') return 'granted';
      // На iOS системное окно показывается один раз за установку: и отказ, и
      // запрет родительским контролем дальше снимаются только в настройках
      if (status === 'denied' || status === 'restricted') return 'blocked';
      return (await ios.request()) === 'granted' ? 'granted' : 'blocked';
    } catch {
      // Нативный модуль не поднялся — не повод запрещать работу: пусть
      // библиотека спросит сама, как было до появления этого модуля
      return 'granted';
    }
  }

  const android = ANDROID[kind];
  try {
    // Сначала check, и только потом request: если человек когда-то отказал
    // навсегда, повторный request молча возвращает NEVER_ASK_AGAIN без окна, и
    // по одному его результату двух этих случаев не различить
    if (await PermissionsAndroid.check(android.permission)) return 'granted';

    const granted = await PermissionsAndroid.request(android.permission, {
      title: android.title,
      message: android.message,
      buttonPositive: 'Разрешить',
      buttonNegative: 'Отмена',
    });
    if (granted === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
    return 'denied';
  } catch {
    return 'denied';
  }
}

const BLOCKED_TEXT = {
  camera: 'Разрешите приложению доступ к камере в настройках системы.',
  microphone: 'Разрешите приложению запись звука в настройках системы.',
};

const BLOCKED_TITLE = {
  camera: 'Нет доступа к камере',
  microphone: 'Нет доступа к микрофону',
};

/**
 * Спросить разрешение и, если путь остался только через настройки, предложить
 * туда уйти. Возвращает true, только когда доступ есть.
 *
 * Именно предложить, а не просто сообщить: человек, у которого разрешение
 * заблокировано, сам в настройках приложение не найдёт — а из-за отказа,
 * сделанного один раз по случайности, кнопка перестаёт работать навсегда.
 */
export async function ensure(kind) {
  const result = await ask(kind);
  if (result === 'granted') return true;

  if (result === 'blocked') {
    Alert.alert(BLOCKED_TITLE[kind], BLOCKED_TEXT[kind], [
      {text: 'Отмена', style: 'cancel'},
      {text: 'Открыть настройки', onPress: () => Linking.openSettings()},
    ]);
  }
  // 'denied' — человек только что отказал сам, и говорить ему об этом нечего
  return false;
}

export default {ask, ensure};
