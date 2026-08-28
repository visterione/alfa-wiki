import {
  AudioSourceAndroidType,
  OutputFormatAndroidType,
  AudioEncoderAndroidType,
} from 'react-native-nitro-sound';
import Sound from './soundInstance';
import VoicePlayer from './voicePlayer';
import {ask as askPermission} from './permissions';

/**
 * Запись голосовых сообщений.
 *
 * Тонкая обёртка над react-native-nitro-sound: экраны не должны
 * знать имени библиотеки. Воспроизведение живёт отдельно, в voicePlayer.js —
 * оно глобальное и переживает уход с экрана, тогда как запись всегда привязана
 * к конкретному чату. Библиотека при этом одна на оба: одновременно можно
 * либо писать, либо слушать.
 *
 * Формат записи задаётся явно — AAC в контейнере m4a, моно. Это тот же
 * формат, к которому сервер приводит записи из браузера, поэтому такие файлы
 * проходят перекодирование без изменений и играют на всех платформах.
 */

// Совпадает с MAX_DURATION_SEC в backend/services/voiceService.js: сервер всё
// равно обрежет длиннее, но лучше остановиться самим и не гонять лишнее по сети
const MAX_DURATION_SEC = 300;

/**
 * Настройки записи. Числами частоту, каналы и битрейт здесь задавать нельзя —
 * и это не стилистика, а причина, по которой запись не начиналась вовсе.
 *
 * У NitroModules есть известная беда с передачей необязательных чисел
 * (std::optional<double>, swiftlang/swift#85735): до нативной стороны вместо
 * значения может доехать мусор. Библиотека про неё знает — в iOS-коде каждое
 * такое поле пропущено через safeInt/safeDouble с комментарием про этот баг.
 * А в Android-коде защиты нет: AudioSamplingRate уходит прямо в
 * MediaRecorder.setAudioSamplingRate(), и от испорченного значения падает
 * prepare(). Наружу это выглядело как «микрофон недоступен», хотя разрешение
 * выдано и микрофон свободен.
 *
 * Раньше беда не проявлялась: поля назывались по-старому
 * (AudioSamplingRateAndroid и подобные), нативная сторона их не узнавала и
 * молча игнорировала. Как только имена исправили, значения начали доезжать —
 * и запись сломалась.
 *
 * Поэтому те же параметры задаются строковым AudioQuality: 'medium' — на обеих
 * платформах это 44100 Гц, моно, 128 кбит/с. Контейнер и кодек остаются
 * заданными явно (это перечисления, а не числа, их баг не касается), так что
 * формат прежний — AAC в m4a, тот самый, который сервер принимает без
 * перекодирования.
 */
const AUDIO_SET = {
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
  // iOS: aac в контейнере m4a
  AVFormatIDKeyIOS: 'aac',
  AudioQuality: 'medium',
};

// Запасной вариант — вообще без настроек: библиотека возьмёт свои (тот же
// AAC в MPEG-4, только 48 кГц стерео). Нужен на случай, если конкретный
// аппарат не поднимет кодек с нашими параметрами: голосовое важнее того,
// в каком качестве оно записано, тем более что сервер всё равно приводит
// записи к общему формату (backend/services/voiceService.js).
const AUDIO_SET_FALLBACK = undefined;

let recording = false;

// Признаки того, что нативная сторона отказала именно из-за разрешения, а не
// из-за занятого микрофона или сломанного кодека. iOS отдаёт свой текст
// («Recording permission denied…»), у Android внятного кода нет вовсе —
// поэтому там мы полагаемся на собственную проверку до старта.
function looksLikePermissionError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('permission') || text.includes('denied');
}

const VoiceRecorder = {
  /**
   * Разрешение на микрофон — спрашивается до того, как трогать аудиосессию.
   *
   * На iOS раньше здесь стоял безусловный 'granted': считалось, что системное
   * окно покажет сама библиотека при первой записи. Она и показывает, но
   * слишком поздно — в её startRecorder сначала идёт setActive(true) на
   * категории playAndRecord и только потом requestRecordPermission
   * (node_modules/react-native-nitro-sound/ios/Sound.swift). Пока разрешения
   * нет, активация сессии не проходит, до запроса дело не доходит вовсе, и
   * первое нажатие на микрофон заканчивалось ничем.
   *
   * Сам запрос живёт в services/permissions.js — там же, где запрос камеры,
   * сломавшийся ровно тем же образом (ver. 7.58).
   *
   * @returns {Promise<'granted'|'denied'|'blocked'>}
   */
  checkPermission() {
    return askPermission('microphone');
  },

  isRecording: () => recording,

  /**
   * Начать запись.
   *
   * Возвращает не «получилось/нет», а причину отказа: раньше на любую неудачу
   * экран показывал «разрешите доступ к микрофону», и когда запись не шла по
   * другой причине — микрофон занят звонком, кодек не поднялся — человек
   * уходил в настройки, видел там выданное разрешение и оставался ни с чем.
   *
   * @param {(seconds:number) => void} onTick — вызывается примерно раз в секунду
   * @returns {Promise<{ok: boolean, reason?: 'busy'|'permission'|'blocked'|'error', message?: string}>}
   */
  async start(onTick) {
    if (recording) return {ok: false, reason: 'busy'};

    const permission = await this.checkPermission();
    if (permission !== 'granted') {
      return {ok: false, reason: permission === 'blocked' ? 'blocked' : 'permission'};
    }

    // Нативный движок один: пока играет голосовое, писать нельзя
    await VoicePlayer.stop();

    // Подстраховка от повисшего с прошлого раза MediaRecorder: если приложение
    // свернули прямо во время записи, объект остаётся живым и держит микрофон,
    // а следующий startRecorder падает. Когда останавливать нечего, вызов
    // отказывает, но при этом сам же освобождает объект — поэтому ошибку тут
    // и глотаем.
    try { await Sound.stopRecorder(); } catch {}

    Sound.setSubscriptionDuration(0.25);
    Sound.addRecordBackListener(e => {
      const sec = Math.floor((e.currentPosition || 0) / 1000);
      onTick?.(sec);
      if (sec >= MAX_DURATION_SEC) {
        // Не даём записи расти бесконечно, если пользователь забыл остановить
        this.stop().catch(() => {});
      }
    });

    let lastError = null;
    for (const audioSet of [AUDIO_SET, AUDIO_SET_FALLBACK]) {
      try {
        // Путь не задаём — библиотека сама положит файл во временный каталог
        // с правильным для платформы расширением. Замер громкости выключаем
        // явно: незаполненные необязательные аргументы едут через то же
        // проблемное место nitro, что и числа в настройках.
        await Sound.startRecorder(undefined, audioSet, false);
        recording = true;
        return {ok: true};
      } catch (e) {
        lastError = e;
        console.warn('[Voice] Не удалось начать запись:', e?.message);
        // Неудачный старт оставляет наполовину настроенный MediaRecorder,
        // который держит микрофон. Освобождаем перед следующей попыткой,
        // иначе она упадёт уже из-за занятого устройства
        try { await Sound.stopRecorder(); } catch {}
      }
    }

    Sound.removeRecordBackListener();
    recording = false;
    return {
      ok: false,
      reason: looksLikePermissionError(lastError?.message) ? 'blocked' : 'error',
      message: lastError?.message,
    };
  },

  /**
   * Остановить запись.
   * @returns {Promise<string|null>} file:// путь к записи
   */
  async stop() {
    if (!recording) return null;
    recording = false;
    try {
      const uri = await Sound.stopRecorder();
      Sound.removeRecordBackListener();
      return uri || null;
    } catch (e) {
      console.warn('[Voice] Ошибка остановки записи:', e?.message);
      Sound.removeRecordBackListener();
      return null;
    }
  },

  MAX_DURATION_SEC,
};

export default VoiceRecorder;
