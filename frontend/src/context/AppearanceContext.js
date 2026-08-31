import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { auth as authApi } from '../services/api';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { accentVariables, DEFAULT_ACCENT } from '../theme/palette';
import { patternImage } from '../theme/chatBackgrounds';

/**
 * Персональное оформление: тема, акцент, фон переписки, размер текста в чате.
 *
 * Настройки общие с мобильным приложением и живут на сервере в
 * users.settings.appearance. localStorage тут — быстрый кэш, чтобы тема была
 * известна до ответа сервера и страница не моргала светлым; сервер остаётся
 * источником правды и побеждает, как только приезжает профиль.
 *
 * Правки уходят в общий эндпоинт /auth/preferences, а сервер тут же рассылает
 * их в личную комнату сокета — поэтому смена темы в браузере доезжает до
 * открытого на телефоне приложения без перезапуска, и наоборот.
 */

const STORAGE_KEY = 'appearance-v1';

// Варианта «как в системе» здесь намеренно нет. Портал много лет был только
// светлым, и в момент, когда тёмная тема появляется, следование за системой
// означало бы, что у половины сотрудников интерфейс сменится сам собой — без
// единого их действия. Тема меняется только руками; вернуть «как в системе»
// можно будет, когда тёмная перестанет быть новостью.
export const THEME_OPTIONS = [
  { key: 'light', label: 'Светлая' },
  { key: 'dark', label: 'Тёмная' }
];

// Множитель для текста в переписке. Отдельно от масштаба страницы: люди нередко
// не трогают системные настройки, но в чате им нужен текст крупнее.
export const FONT_SCALES = [
  { key: 'normal', label: 'Обычный', scale: 1 },
  { key: 'large', label: 'Крупный', scale: 1.15 },
  { key: 'huge', label: 'Очень крупный', scale: 1.3 }
];

const DEFAULTS = {
  theme: 'light',
  accent: DEFAULT_ACCENT,
  fontScale: 'normal',
  chatBackground: 'plain'
};

// Ключи, которые применяет веб. Звук уведомлений и видимость задач по умолчанию
// приезжают в том же объекте, но касаются только телефона — их мы храним как
// есть и отправляем обратно нетронутыми, чтобы не сбросить выбор на мобиле.
const WEB_KEYS = Object.keys(DEFAULTS);

function pick(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const picked = Object.fromEntries(
    WEB_KEYS.filter(key => value[key] !== undefined).map(key => [key, value[key]])
  );
  // Сохранённое 'system' приезжает с телефонов со сборками до 7.60 и из старого
  // кэша браузера. Читаем его как светлую — так же, как выглядел портал до того,
  // как тёмная тема вообще появилась
  if (picked.theme === 'system') picked.theme = 'light';
  return picked;
}

function readCache() {
  try {
    return pick(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return {};
  }
}

/**
 * Применяет оформление к документу.
 *
 * Значения выставляются на :root переменными, а не через классы: вся вёрстка
 * уже описана токенами, и подмена переменных перекрашивает интерфейс целиком,
 * не требуя от компонентов знать о теме.
 */
function applyAppearance(settings, scheme) {
  const root = document.documentElement;

  root.dataset.theme = scheme;
  const vars = {
    ...accentVariables(scheme, settings.accent),
    // Светлая копия акцента — для рабочей области страницы: она остаётся белым
    // листом при любой теме (см. блок .page-sheet в index.css)
    ...accentVariables('light', settings.accent, 'sheet-accent')
  };
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }

  const scale = (FONT_SCALES.find(f => f.key === settings.fontScale) || FONT_SCALES[0]).scale;
  root.style.setProperty('--chat-font-scale', String(scale));

  // Узор рисуется цветом основного текста темы. Значение берём вычисленным:
  // в data-URI подставить var() нельзя, туда нужен конкретный цвет.
  // Запасной вариант на случай, если браузер вернёт неразвёрнутое var() —
  // тогда узор просто нарисуется цветом текста по умолчанию, а не пропадёт
  const computedInk = getComputedStyle(root).getPropertyValue('--text-primary').trim();
  const ink = computedInk && !computedInk.startsWith('var(')
    ? computedInk
    : (scheme === 'dark' ? '#F2F2F7' : '#1D1D1F');
  root.style.setProperty('--chat-pattern', patternImage(settings.chatBackground, ink, scheme));

  // Цвет строки состояния мобильного браузера. Без него шапка Safari остаётся
  // светлой над тёмной страницей
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--header-gradient-start').trim());
}

const AppearanceContext = createContext(null);

export function AppearanceProvider({ children }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [settings, setSettings] = useState(() => ({ ...DEFAULTS, ...readCache() }));
  const syncedUserRef = useRef(null);
  // Состояние до последней правки — чтобы откатить его, если сервер не принял
  const previousRef = useRef(null);

  const scheme = settings.theme === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    applyAppearance(settings, scheme);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pick(settings)));
  }, [settings, scheme]);

  // Серверная копия побеждает при входе: человек мог сменить тему с телефона,
  // пока браузер был закрыт
  useEffect(() => {
    const id = user?.id ? String(user.id) : null;
    if (!id) {
      syncedUserRef.current = null;
      return;
    }
    if (syncedUserRef.current === id) return;
    syncedUserRef.current = id;

    const remote = pick(user?.settings?.appearance || user?.settings?.mobile);
    // Пустой ответ — у аккаунта ещё нет сохранённого выбора. Тогда за ним
    // остаётся то, что человек уже выбрал в этом браузере
    setSettings(prev => (Object.keys(remote).length ? { ...DEFAULTS, ...remote } : prev));
  }, [user]);

  useEffect(() => {
    if (!socket) return undefined;
    const onUpdate = incoming => setSettings(prev => ({ ...prev, ...pick(incoming) }));
    socket.on('preferences_updated', onUpdate);
    return () => socket.off('preferences_updated', onUpdate);
  }, [socket]);

  /**
   * Сохраняет выбор. Интерфейс перекрашивается сразу, не дожидаясь сети:
   * подбор цвета — это перебор, и задержка в полсекунды на каждый образец
   * делает его невыносимым. Неудача запроса откатывает состояние обратно.
   */
  const update = useCallback(patch => {
    // Запрос уходит рядом с setState, а не внутри него: в updater React вправе
    // вызвать функцию дважды, и настройка отправилась бы на сервер два раза
    setSettings(prev => {
      previousRef.current = prev;
      return { ...prev, ...patch };
    });
    if (user?.id) {
      authApi.updatePreferences(patch).catch(() => {
        toast.error('Не удалось сохранить оформление');
        setSettings(previousRef.current);
      });
    }
  }, [user?.id]);

  const value = useMemo(() => ({ ...settings, scheme, update }), [settings, scheme, update]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance используется вне AppearanceProvider');
  return ctx;
}
