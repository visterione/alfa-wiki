import {io} from 'socket.io-client';
import {AppState} from 'react-native';
import * as Keychain from 'react-native-keychain';
import CONFIG from '../config';

let socket = null;
let _userId = null;
// Защита от гонки: initialize() и LoginScreen могут дёрнуть connect() почти
// одновременно. Проверки socket?.connected мало — она false, пока подключение
// ещё устанавливается, и второй вызов создал бы второй сокет, потеряв первый.
let _connecting = false;

// key → {event, callback}  — supports multiple listeners per event via unique keys
const pendingListeners = new Map();

// ── Присутствие ─────────────────────────────────────────────────────────────
// «В сети» раньше означало «есть коннект», а свёрнутое приложение держит сокет
// часами: токен на мобиле живёт год, реконнект бесконечный — человек вечно
// висел онлайном. Теперь пинг уходит, только пока AppState === 'active', а на
// уход в фон шлём presence:away, чтобы статус погас сразу.
const PRESENCE_PING_MS = 30 * 1000;
let presenceTimer = null;
let appStateSub = null;
// Колбэк «сессия мертва» — ставит AuthProvider, см. setSessionEndHandler
let _onSessionEnd = null;

function sendPresencePing() {
  if (socket?.connected && AppState.currentState === 'active') {
    socket.emit('presence:active');
  }
}

function startPresence() {
  if (presenceTimer) return;
  sendPresencePing();
  presenceTimer = setInterval(sendPresencePing, PRESENCE_PING_MS);
}

function stopPresence({notify} = {notify: true}) {
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
  if (notify && socket?.connected) {
    socket.emit('presence:away');
  }
}

function syncPresenceWithAppState(state) {
  if (state === 'active') {
    startPresence();
  } else {
    // 'background' и 'inactive' (шторка, звонок) — оба означают «не смотрит»
    stopPresence();
  }
}

const SocketService = {
  // token param lets callers pass an already-known token and skip Keychain read
  async connect(userId, token) {
    if (socket?.connected || _connecting) {
      return;
    }
    _connecting = true;

    _userId = userId;
    // Only read Keychain if token wasn't provided by the caller
    const actualToken = token ?? (await Keychain.getGenericPassword({service: 'alfa-wiki'}))?.password;

    socket = io(CONFIG.SOCKET_URL, {
      transports: ['websocket'],
      auth: {token: actualToken},
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected');
      _connecting = false;
      socket.emit('join', _userId);
      // Re-attach all listeners after (re)connect
      pendingListeners.forEach(({event, callback}) => {
        socket.off(event, callback);
        socket.on(event, callback);
      });
      syncPresenceWithAppState(AppState.currentState);
    });

    socket.on('disconnect', reason => {
      console.log('[Socket] Disconnected:', reason);
      // Пинговать в никуда бессмысленно; на реконнекте presence поднимется
      // заново из обработчика 'connect'.
      stopPresence({notify: false});
    });

    socket.on('connect_error', err => {
      _connecting = false;
      console.warn('[Socket] Connection error:', err.message);
      // Сервер теперь проверяет JWT в handshake. Протухший токен или снятая
      // сессия — не повод долбиться бесконечно: молча останавливаемся,
      // api-интерцептор всё равно выкинет на экран входа при первом запросе.
      if (['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED', 'AUTH_REVOKED'].includes(err.message)) {
        socket.disconnect();
        // AUTH_REQUIRED сюда не попадает: он значит «токен не доехал до
        // handshake» (не прочитался Keychain), а не «сессия мертва», — и
        // выкидывать из-за него человека на экран входа нельзя.
        if (err.message !== 'AUTH_REQUIRED') _onSessionEnd?.();
      }
    });

    // Сессию сняли с другого устройства («выйти везде», потерянный телефон)
    // или токен дожил до exp — токен больше не действует, нужен релогин.
    socket.on('session_revoked', () => _onSessionEnd?.());
    socket.on('session_expired', () => _onSessionEnd?.());

    if (!appStateSub) {
      appStateSub = AppState.addEventListener('change', syncPresenceWithAppState);
    }
  },

  /**
   * Кто уводит на экран входа, когда сервер сообщил, что сессия мертва.
   * Ставится один раз из AuthProvider.
   */
  setSessionEndHandler(fn) {
    _onSessionEnd = fn;
  },

  disconnect() {
    stopPresence();
    if (appStateSub) {
      appStateSub.remove();
      appStateSub = null;
    }
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    _userId = null;
    _connecting = false;
  },

  /**
   * Register a listener with a unique key.
   * Using a key allows multiple components to subscribe to the same event
   * without overwriting each other.
   *
   * @param {string} key    - unique identifier, e.g. 'chatlist:new_message'
   * @param {string} event  - socket event name
   * @param {function} callback
   */
  on(key, event, callback) {
    // Remove previous listener for this key (if any)
    this.off(key);

    pendingListeners.set(key, {event, callback});
    if (socket?.connected) {
      socket.on(event, callback);
    }
  },

  /**
   * Remove a listener by its unique key.
   * @param {string} key
   */
  off(key) {
    const entry = pendingListeners.get(key);
    if (entry) {
      if (socket) socket.off(entry.event, entry.callback);
      pendingListeners.delete(key);
    }
  },

  emit(event, data) {
    if (socket?.connected) {
      socket.emit(event, data);
    }
  },

  isConnected() {
    return socket?.connected ?? false;
  },
};

export default SocketService;
