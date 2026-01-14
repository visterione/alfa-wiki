import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
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
  }, [user?.id]);

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
    clearAllNotifications
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
}
