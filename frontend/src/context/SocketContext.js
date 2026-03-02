import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { BASE_URL } from '../services/api';

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

      // Play notification sound
      try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGGe77eafTRALUKfj8LZjHAY4ktjyzXksBSR3x/DdkUAKFF607OunVRQKRZ/f8r5sIQUsgc7y2Ik2CBhnu+3mnk0QC1Cn4/C2YhwGOJLY8s15LAUkd8fw3ZFAChRet'
        );
        audio.volume = 0.3;
        audio.play().catch(() => {});
      } catch (e) {}
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

  const value = {
    socket: socketRef.current,
    isConnected,
    notifications,
    removeNotification,
    clearAllNotifications,
    userStatuses
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}
