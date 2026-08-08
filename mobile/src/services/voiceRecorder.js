import {Platform, PermissionsAndroid} from 'react-native';
import {
  AudioSourceAndroidType,
  OutputFormatAndroidType,
  AudioEncoderAndroidType,
  AVEncoderAudioQualityIOSType,
} from 'react-native-nitro-sound';
import Sound from './soundInstance';
import VoicePlayer from './voicePlayer';

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

// Имена полей отличаются от старой библиотеки: параметры качества переехали
// из Android-специфичных (AudioSamplingRateAndroid и подобных) в общую секцию
// без суффикса. Старые имена нативная сторона молча игнорировала.
const AUDIO_SET = {
  // Android
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
  // iOS: aac в контейнере m4a
  AVFormatIDKeyIOS: 'aac',
  AVNumberOfChannelsKeyIOS: 1,
  AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
  // Общие для обеих платформ
  AudioChannels: 1,
  AudioSamplingRate: 44100,
  AudioEncodingBitRate: 64000,
};

let recording = false;

const VoiceRecorder = {
  /**
   * Разрешение на микрофон. На Android 13+ спрашивается в рантайме,
   * на iOS его выдаёт системный диалог при первой записи.
   */
  async ensurePermission() {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: 'Доступ к микрофону',
          message: 'Нужен, чтобы записывать голосовые сообщения',
          buttonPositive: 'Разрешить',
          buttonNegative: 'Отмена',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  },

  isRecording: () => recording,

  /**
   * Начать запись.
   * @param {(seconds:number) => void} onTick — вызывается примерно раз в секунду
   * @returns {Promise<boolean>} удалось ли начать
   */
  async start(onTick) {
    if (recording) return false;
    const allowed = await this.ensurePermission();
    if (!allowed) return false;

    // Нативный движок один: пока играет голосовое, писать нельзя
    await VoicePlayer.stop();

    try {
      Sound.setSubscriptionDuration(0.25);
      Sound.addRecordBackListener(e => {
        const sec = Math.floor((e.currentPosition || 0) / 1000);
        onTick?.(sec);
        if (sec >= MAX_DURATION_SEC) {
          // Не даём записи расти бесконечно, если пользователь забыл остановить
          this.stop().catch(() => {});
        }
      });
      // Путь не задаём — библиотека сама положит файл во временный каталог
      // с правильным для платформы расширением
      await Sound.startRecorder(undefined, AUDIO_SET);
      recording = true;
      return true;
    } catch (e) {
      console.warn('[Voice] Не удалось начать запись:', e?.message);
      Sound.removeRecordBackListener();
      recording = false;
      return false;
    }
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
