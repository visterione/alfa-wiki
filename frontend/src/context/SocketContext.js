import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { BASE_URL } from '../services/api';

// Tauri detection
const isTauri = () => typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';

// Send native desktop notification (Tauri only), returns numeric id or null
async function sendDesktopNotification(title, body, id) {
  if (!isTauri()) return;
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === 'granted';
    }
    if (granted) {
      sendNotification({ title, body, id });
    }
  } catch (e) {}
}

// Play notification sound from file (falls back silently if file not found)
function playNotificationSound() {
  try {
    const audio = new Audio('/sounds/notification.mp3');
    audio.volume = 0.5;
    audio.play().catch(() => {});
  } catch (e) {}
}

// Генерируем сырые RGBA байты красного кружка с цифрой через Canvas
function createBadgeRgba(count) {
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e53e3e';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = `bold ${count > 9 ? 8 : 10}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(count > 99 ? '99' : String(count), size / 2, size / 2);
  const imageData = ctx.getImageData(0, 0, size, size);
  // Uint8ClampedArray → Uint8Array (совместим с Image.new в Tauri v2)
  return { rgba: new Uint8Array(imageData.data.buffer), width: size, height: size };
}

// Разворачивает и фокусирует Tauri-окно через Rust-команду (надёжнее JS-API)
async function bringWindowToFront() {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('bring_to_front');
    console.log('[Tauri] bring_to_front OK');
  } catch (e) {
    console.error('[Tauri] bring_to_front FAILED', e);
  }
}

// Update taskbar attention (Tauri only)
// UserAttentionType.Critical = мигает до тех пор пока пользователь не откроет окно
async function updateBadge(count) {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow, UserAttentionType } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    if (count > 0) {
      await win.requestUserAttention(UserAttentionType.Critical);
    } else {
      await win.requestUserAttention(null);
    }
  } catch (e) {
    console.error('[Tauri badge error]', e);
  }
}

const SocketContext = createContext(null);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return context;
};

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const socketRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  // userId → { isOnline, lastSeen }
  const [userStatuses, setUserStatuses] = useState({});
  const unreadBadgeCount = useRef(0);
  // Pending chat navigation: set when native notification is clicked
  const [pendingChatNavigation, setPendingChatNavigation] = useState(null);
  const lastNotifChatRef = useRef(null);
  // Map notifId → { chat, message } для onAction
  const notifIdCounter = useRef(1);
  const notifChatMapRef = useRef({});

  // Title notification refs
  const originalTitleRef = useRef(document.title);
  const blinkIntervalRef = useRef(null);
  const isBlinkingRef = useRef(false);

  // Start title blinking
  const startTitleBlink = useCallback(() => {
    if (isBlinkingRef.current) return;
    isBlinkingRef.current = true;

    let showNotification = true;
    blinkIntervalRef.current = setInterval(() => {
      document.title = showNotification ? '● Новое сообщение' : originalTitleRef.current;
      showNotification = !showNotification;
    }, 1000);
  }, []);

  // Stop title blinking
  const stopTitleBlink = useCallback(() => {
    if (blinkIntervalRef.current) {
      clearInterval(blinkIntervalRef.current);
      blinkIntervalRef.current = null;
    }
    isBlinkingRef.current = false;
    document.title = originalTitleRef.current;
  }, []);

  // Handle visibility change - stop blinking when user returns to tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        stopTitleBlink();
      }
    };

    const handleFocus = () => {
      stopTitleBlink();
      unreadBadgeCount.current = 0;
      updateBadge(0);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      stopTitleBlink();
    };
  }, [stopTitleBlink]);

  // Stop blinking when all notifications are cleared
  useEffect(() => {
    if (notifications.length === 0) {
      stopTitleBlink();
    }
  }, [notifications.length, stopTitleBlink]);

  // Слушаем нативный фокус окна через Rust-событие (срабатывает при клике на Windows уведомление)
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('window-native-focus', async () => {
          console.log('[Tauri] window-native-focus received, lastNotif=', lastNotifChatRef.current);
          await bringWindowToFront();
          stopTitleBlink();
          unreadBadgeCount.current = 0;
          updateBadge(0);
          if (lastNotifChatRef.current) {
            setPendingChatNavigation(lastNotifChatRef.current);
            lastNotifChatRef.current = null;
          }
        });
      } catch (e) {
        console.error('[Tauri] window-native-focus setup error', e);
      }
    })();
    return () => { if (unlisten) unlisten(); };
  }, [stopTitleBlink]);


  useEffect(() => {
    if (!user?.id) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    // Connect to Socket.IO server
    const socket = io(BASE_URL.replace('/api', ''), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket.IO connected');
      setIsConnected(true);
      socket.emit('join', user.id);
    });

    socket.on('disconnect', () => {
      console.log('Socket.IO disconnected');
      setIsConnected(false);
    });

    socket.on('user_status_changed', (data) => {
      setUserStatuses(prev => ({
        ...prev,
        [data.userId]: { isOnline: data.isOnline, lastSeen: data.lastSeen || null }
      }));
    });

    socket.on('new_message', (data) => {
      console.log('New message received:', data);

      // Add notification
      const notificationId = Date.now();
      const notification = {
        id: notificationId,
        chat: data.chat,
        message: data.message,
        timestamp: new Date()
      };

      setNotifications(prev => [...prev, notification]);

      // Start title blinking for new message
      startTitleBlink();

      // Native desktop notification + taskbar badge (Tauri only, only when window not focused)
      if (!document.hasFocus()) {
        const chatName = data.chat?.displayName || data.chat?.name || 'Сообщение';
        const senderName = data.message?.sender?.displayName || data.message?.sender?.username;
        const messageText = data.message?.content || (data.message?.attachments?.length ? '📎 Вложение' : '');
        const notifTitle = senderName && data.chat?.type === 'group' ? `${chatName} — ${senderName}` : (senderName || chatName);
        const notifBody = messageText.length > 100 ? messageText.slice(0, 100) + '…' : messageText;
        const notifId = notifIdCounter.current++;
        notifChatMapRef.current[notifId] = { chat: data.chat, message: data.message };
        lastNotifChatRef.current = { chat: data.chat, message: data.message }; // fallback для focus-события
        sendDesktopNotification(notifTitle, notifBody, notifId);

        unreadBadgeCount.current += 1;
        updateBadge(unreadBadgeCount.current);
      }

      // Play notification sound
      playNotificationSound();
    });

    return () => {
      socket.disconnect();
      setIsConnected(false);
    };
  }, [user?.id, startTitleBlink]);

  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
  };

  const clearPendingNavigation = useCallback(() => {
    setPendingChatNavigation(null);
  }, []);

  const value = {
    socket: socketRef.current,
    isConnected,
    notifications,
    removeNotification,
    clearAllNotifications,
    userStatuses,
    pendingChatNavigation,
    clearPendingNavigation
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}
