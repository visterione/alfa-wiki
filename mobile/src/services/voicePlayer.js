import {useEffect, useState} from 'react';
import Sound from './soundInstance';

/**
 * Глобальный плеер голосовых сообщений.
 *
 * Состояние живёт в модуле, а не в компоненте: иначе воспроизведение
 * обрывалось бы при выходе из чата вместе с размонтированием пузырька.
 * Голосовое продолжает играть, пока пользователь ходит по приложению, а любой
 * экран может показать, что звучит, и остановить.
 *
 * ВАЖНО про прогресс. Библиотека умеет присылать позицию через
 * addPlayBackListener, но на Android эти события до JS не доходят: нативный
 * таймер дёргает колбэк через handler.post, то есть с главного потока, и на
 * новой архитектуре RN они теряются. Проверено — подписка до и после старта,
 * общий экземпляр движка, разные setSubscriptionDuration: не пришло ни одного.
 *
 * Поэтому позицию считаем сами, от момента старта, с поправкой на скорость.
 * Точность нативных событий полосе прогресса не нужна, а так оно работает
 * предсказуемо. Родной слушатель оставлен: если события всё же приходят
 * (iOS, будущие версии), они уточняют длительность.
 */

const SPEEDS = [1, 1.5, 2];
const TICK_MS = 200;

// Предохранитель на случай неизвестной длительности. У сообщений, записанных
// до того, как клиент начал присылать свой замер, в базе лежит duration: null —
// остановиться по достижению конца тогда невозможно, и отсчёт шёл бы вечно.
// Совпадает с максимальной длиной записи на сервере.
const MAX_PLAYBACK_SEC = 300;

let state = {
  uri: null,
  messageId: null,
  // Подпись для мини-плеера: из какого чата играет сообщение
  title: null,
  chatId: null,
  position: 0,
  duration: 0,
  playing: false,
  speed: 1,
};

const listeners = new Set();

// Отсчёт позиции: сколько проиграно до текущего отрезка и когда он начался
let ticker = null;
let playedBefore = 0;
let segmentStartedAt = 0;

function setState(patch) {
  state = {...state, ...patch};
  listeners.forEach(fn => fn(state));
}

function currentPosition() {
  if (!state.playing) return playedBefore;
  const elapsed = (Date.now() - segmentStartedAt) / 1000;
  return playedBefore + elapsed * state.speed;
}

function stopTicker() {
  if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function startTicker() {
  stopTicker();
  segmentStartedAt = Date.now();
  ticker = setInterval(() => {
    const position = currentPosition();
    // Длительность известна с сервера; дойдя до конца, останавливаемся сами —
    // события окончания от библиотеки может не быть
    const limit = state.duration > 0 ? state.duration : MAX_PLAYBACK_SEC;
    if (position >= limit) {
      VoicePlayer.stop();
      return;
    }
    setState({position});
  }, TICK_MS);
}

function reset() {
  stopTicker();
  playedBefore = 0;
  segmentStartedAt = 0;
  setState({
    uri: null, messageId: null, title: null, chatId: null,
    position: 0, duration: 0, playing: false,
  });
}

const VoicePlayer = {
  SPEEDS,

  getState: () => state,

  subscribe(fn) {
    listeners.add(fn);
    fn(state);
    return () => listeners.delete(fn);
  },

  /**
   * Начать воспроизведение сообщения.
   * @param {object} p
   * @param {string} p.uri — полный URL файла
   * @param {number} [p.duration] — длительность с сервера, в секундах
   */
  async play({uri, messageId, title, chatId, duration}) {
    // Нативный движок один: гасим предыдущее
    if (state.uri) {
      await this.stop();
    }

    try {
      playedBefore = 0;
      setState({
        uri, messageId, title, chatId,
        playing: true,
        position: 0,
        duration: duration || 0,
      });

      // Родные события — уточняющие: если приходят, берём длительность от них
      Sound.addPlayBackListener(e => {
        const nativeDuration = (e.duration || 0) / 1000;
        if (nativeDuration > 0 && Math.abs(nativeDuration - state.duration) > 0.5) {
          setState({duration: nativeDuration});
        }
      });

      await Sound.startPlayer(uri);
      startTicker();
      if (state.speed !== 1) {
        await Sound.setPlaybackSpeed(state.speed).catch(() => {});
      }
      return true;
    } catch (e) {
      console.warn('[VoicePlayer] Не удалось начать воспроизведение:', e?.message);
      reset();
      return false;
    }
  },

  async pause() {
    if (!state.playing) return;
    playedBefore = currentPosition();
    stopTicker();
    setState({playing: false, position: playedBefore});
    try { await Sound.pausePlayer(); } catch {}
  },

  async resume() {
    if (!state.uri || state.playing) return;
    try { await Sound.resumePlayer(); } catch {}
    setState({playing: true});
    startTicker();
  },

  async toggle() {
    if (state.playing) return this.pause();
    return this.resume();
  },

  async seek(seconds) {
    if (!state.uri) return;
    const target = Math.max(0, Math.min(seconds, state.duration || seconds));
    playedBefore = target;
    segmentStartedAt = Date.now();
    setState({position: target});
    try { await Sound.seekToPlayer(target * 1000); } catch {}
  },

  /**
   * Следующая скорость по кругу: 1 → 1.5 → 2 → 1.
   */
  async cycleSpeed() {
    // Фиксируем пройденное на старой скорости, иначе отсчёт скакнёт
    playedBefore = currentPosition();
    segmentStartedAt = Date.now();

    const next = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
    setState({speed: next});
    if (state.uri) {
      try { await Sound.setPlaybackSpeed(next); } catch {}
    }
    return next;
  },

  async stop() {
    if (!state.uri) return;
    try {
      await Sound.stopPlayer();
      Sound.removePlayBackListener();
    } catch {}
    reset();
  },

  isPlayingMessage: messageId => state.playing && String(state.messageId) === String(messageId),
  isCurrentMessage: messageId => String(state.messageId) === String(messageId),
};

/**
 * Подписка на состояние плеера из React-компонента.
 */
export function useVoicePlayer() {
  const [value, setValue] = useState(VoicePlayer.getState());
  useEffect(() => VoicePlayer.subscribe(setValue), []);
  return value;
}

export default VoicePlayer;
