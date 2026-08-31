import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import {Platform, Settings} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {getPalette, fontScales} from '../theme';
import {auth as authApi} from '../services/api';
import SocketService from '../services/socket';
import {useAuth} from './authStore';

/**
 * Персональные настройки приложения.
 *
 * AsyncStorage служит быстрым локальным кэшем, чтобы оформление было известно
 * ещё до авторизации и не мигало при запуске. После входа серверная копия из
 * user.settings.appearance синхронизирует выбор между устройствами и переживает
 * удаление приложения.
 *
 * С ver. 7.60 те же настройки применяет веб-версия, поэтому namespace на сервере
 * переименован из `mobile` в `appearance`, а изменения приезжают по сокету:
 * смена темы в браузере должна доехать сюда без перезапуска приложения.
 */

const STORAGE_KEY = 'app-settings-v1';
const STORAGE_USER_KEY = 'app-settings-user-v1';
const STORAGE_DIRTY_KEY = 'app-settings-dirty-v1';
const IOS_LAUNCH_COLOR_KEY = 'AlfaWikiLaunchBackgroundColor';
const SYNC_DELAY = 350;

// Варианта «как в системе» здесь намеренно нет. Настройка общая с веб-версией,
// а портал много лет был только светлым: следование за системой означало бы,
// что в момент появления тёмной темы интерфейс сменится сам собой у половины
// сотрудников. Тема меняется только руками.
export const THEME_OPTIONS = [
  {key: 'light', label: 'Светлая'},
  {key: 'dark', label: 'Тёмная'},
];

/**
 * Звуки уведомлений.
 *
 * `resource` — имя файла в android/app/src/main/res/raw без расширения.
 * `channelId` свой у каждого звука не случайно: на Android звук намертво
 * привязан к каналу и после его создания не меняется. Единственный способ
 * дать выбор — завести канал под каждый вариант и переключаться между ними.
 */
// Версия в идентификаторе канала — единственный способ поменять звук уже
// созданного канала: Android этого не позволяет, приходится заводить новый.
// Поднимайте число, если меняете сами файлы звуков или их набор.
export const CHANNEL_VERSION = 2;

// resource — имя ресурса Android (res/raw, без расширения).
// iosSound — имя файла в бандле iOS, обязательно с расширением.
//
// Форматы у платформ разные не по прихоти: iOS проигрывает в уведомлениях
// только wav/aiff/caf, причём линейный PCM. Исходники были во Float32-wav и
// mp3 — оба iOS молча игнорирует, подставляя системный звук. Поэтому для него
// лежат отдельные .caf в ios/AlfaWikiMobile/sounds.
export const SOUND_OPTIONS = [
  {key: 'default', label: 'Системный', resource: 'default', iosSound: 'default'},
  {key: 'sol', label: 'Sol', resource: 'notify_sol', iosSound: 'notify_sol.caf'},
  {key: 'luna', label: 'Luna', resource: 'notify_luna', iosSound: 'notify_luna.caf'},
  {key: 'terra', label: 'Terra', resource: 'notify_terra', iosSound: 'notify_terra.caf'},
].map(s => ({...s, channelId: `messages_${s.key}_v${CHANNEL_VERSION}`}));

export function soundOption(key) {
  return SOUND_OPTIONS.find(s => s.key === key) ?? SOUND_OPTIONS[0];
}

const DEFAULTS = {
  theme: 'light',
  accent: 'blue',
  fontScale: 'normal',
  chatBackground: 'plain',
  notificationSound: 'default',
  taskDefaultVisibility: 'private',
};

const PREFERENCE_KEYS = Object.keys(DEFAULTS);
const REMOVED_CHAT_BACKGROUNDS = new Set(['grid', 'icons', 'dna', 'atoms']);

function pickPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const picked = Object.fromEntries(
    PREFERENCE_KEYS
      .filter(key => value[key] !== undefined)
      .map(key => [key, value[key]]),
  );
  if (REMOVED_CHAT_BACKGROUNDS.has(picked.chatBackground)) {
    picked.chatBackground = DEFAULTS.chatBackground;
  }
  // 'system' было значением по умолчанию до 7.60, поэтому хранится у всех, кто
  // тему не трогал. Читаем как светлую — именно её эти люди и видели
  if (picked.theme === 'system') {
    picked.theme = DEFAULTS.theme;
  }
  return picked;
}

/**
 * iOS показывает LaunchScreen до запуска JavaScript, поэтому AsyncStorage там
 * прочитать невозможно. Дублируем только стартовый цвет в UserDefaults через
 * стандартный RN Settings API — AppDelegate сможет взять его при следующем
 * запуске. Остальные настройки по-прежнему живут только в AsyncStorage.
 */
function persistNativeLaunchColor(settings) {
  if (Platform.OS !== 'ios') return;

  const palette = getPalette(settings.theme === 'dark' ? 'dark' : 'light', settings.accent);

  Settings.set({[IOS_LAUNCH_COLOR_KEY]: palette.headerGradientStart});
}

/**
 * Настройки вне дерева React.
 *
 * Нужны фоновому обработчику push: он поднимается без интерфейса, когда
 * приложение выгружено, и до контекста дотянуться не может — а знать,
 * каким каналом показывать уведомление, обязан.
 */
export async function readSettings() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? {...DEFAULTS, ...pickPreferences(JSON.parse(raw))} : {...DEFAULTS};
  } catch {
    return {...DEFAULTS};
  }
}

const SettingsContext = createContext(null);

export function SettingsProvider({children}) {
  const {user} = useAuth();
  const [settings, setSettings] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const syncedUserRef = useRef(null);
  const cachedUserRef = useRef(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef(null);
  const saveVersionRef = useRef(0);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(STORAGE_USER_KEY),
      AsyncStorage.getItem(STORAGE_DIRTY_KEY),
    ])
      .then(([raw, cachedUser, dirty]) => {
        cachedUserRef.current = cachedUser;
        dirtyRef.current = dirty === '1';
        if (raw) {
          // Мержим с DEFAULTS: после обновления приложения в сохранённом
          // объекте может не быть новых ключей
          setSettings({...DEFAULTS, ...pickPreferences(JSON.parse(raw))});
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const saveToAccount = useCallback((next, delay = SYNC_DELAY) => {
    const userId = user?.id ? String(user.id) : null;
    if (!userId) return;

    const version = ++saveVersionRef.current;
    dirtyRef.current = true;
    cachedUserRef.current = userId;
    AsyncStorage.multiSet([
      [STORAGE_USER_KEY, userId],
      [STORAGE_DIRTY_KEY, '1'],
    ]).catch(() => {});

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      authApi.updatePreferences(pickPreferences(next))
        .then(() => {
          // Более новая правка могла появиться, пока запрос был в сети.
          if (saveVersionRef.current !== version) return;
          dirtyRef.current = false;
          AsyncStorage.removeItem(STORAGE_DIRTY_KEY).catch(() => {});
        })
        .catch(() => {
          // Локальная копия остаётся помеченной: повторим синхронизацию при
          // следующем входе или запуске с доступной сетью.
        });
    }, delay);
  }, [user?.id]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  const userId = user?.id ? String(user.id) : null;
  useEffect(() => {
    // Не даём отложенному запросу предыдущего аккаунта уйти уже с токеном
    // следующего пользователя.
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveVersionRef.current += 1;
  }, [userId]);

  // Серверная копия побеждает на новом устройстве. Если локальная настройка
  // не успела отправиться из-за офлайна, dirty-флаг делает обратное: сначала
  // отправляем локальную копию и не откатываем видимый пользователю выбор.
  useEffect(() => {
    if (!loaded || !userId || syncedUserRef.current === userId) return;
    syncedUserRef.current = userId;

    // Старый ключ читается запасным: аккаунты, не заходившие в веб после
    // переезда, хранят выбор только в нём
    const rawRemote = user?.settings?.appearance ?? user?.settings?.mobile;
    const remote = pickPreferences(rawRemote);
    const hasRemote = Object.keys(remote).length > 0;
    const needsCleanup = REMOVED_CHAT_BACKGROUNDS.has(rawRemote?.chatBackground);
    const ownsDirtyCache = dirtyRef.current && cachedUserRef.current === userId;

    if (ownsDirtyCache) {
      saveToAccount(settings, 0);
      return;
    }

    const next = hasRemote
      ? {...DEFAULTS, ...remote}
      : cachedUserRef.current && cachedUserRef.current !== userId
        ? {...DEFAULTS}
        : {...settings};

    setSettings(next);
    cachedUserRef.current = userId;
    AsyncStorage.multiSet([
      [STORAGE_KEY, JSON.stringify(next)],
      [STORAGE_USER_KEY, userId],
    ]).catch(() => {});

    // Миграция существующего локального выбора: если на сервере раздела
    // mobile ещё нет, создаём его при первом входе.
    if (!hasRemote || needsCleanup) saveToAccount(next, 0);
  }, [loaded, saveToAccount, settings, user, userId]);

  useEffect(() => {
    if (!user?.id) syncedUserRef.current = null;
  }, [user?.id]);

  // Обновляем нативный цвет после чтения настроек и при выборе новой темы
  // или акцента.
  useEffect(() => {
    if (loaded) persistNativeLaunchColor(settings);
  }, [loaded, settings]);

  // Изменения с другого устройства. Обновляем только состояние и кэш: обратно
  // отправлять нечего — сервер уже сохранил то, что прислал.
  useEffect(() => {
    if (!userId) return undefined;
    SocketService.on('settings:preferences', 'preferences_updated', incoming => {
      const remote = pickPreferences(incoming);
      if (!Object.keys(remote).length) return;
      setSettings(prev => {
        const next = {...prev, ...remote};
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
        return next;
      });
    });
    return () => SocketService.off('settings:preferences');
  }, [userId]);

  const update = useCallback(patch => {
    setSettings(prev => {
      const next = {...prev, ...patch};
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      saveToAccount(next);
      return next;
    });
  }, [saveToAccount]);

  const value = useMemo(() => {
    const scheme = settings.theme === 'dark' ? 'dark' : 'light';

    return {
      ...settings,
      loaded,
      scheme,
      colors: getPalette(scheme, settings.accent),
      scale: (fontScales[settings.fontScale] ?? fontScales.normal).scale,
      update,
    };
  }, [settings, loaded, update]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return ctx;
}

/**
 * Активная палитра. Короткая форма для мест, где нужны только цвета.
 */
export function useTheme() {
  return useSettings().colors;
}

/**
 * Стили, пересобираемые при смене темы.
 *
 * StyleSheet.create вычисляется один раз при загрузке модуля и на смену
 * палитры не реагирует — поэтому стили описываются функцией от палитры,
 * а хук пересоздаёт их, когда тема меняется.
 *
 *   const makeStyles = c => StyleSheet.create({box: {backgroundColor: c.bgPrimary}});
 *   const styles = useThemedStyles(makeStyles);
 */
export function useThemedStyles(factory) {
  const {colors} = useSettings();
  return useMemo(() => factory(colors), [factory, colors]);
}
