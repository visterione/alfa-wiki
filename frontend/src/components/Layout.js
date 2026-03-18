import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import ChatNotification from './ChatNotification';
import { useSocket } from '../context/SocketContext';
import './Layout.css';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const { notifications, removeNotification, pendingChatNavigation, clearPendingNavigation } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();

  // Определяем, является ли устройство мобильным
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Закрываем sidebar по умолчанию на мобильных при первой загрузке
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile]);

  const handleCloseSidebar = () => {
    setSidebarOpen(false);
  };

  const handleNotificationClick = (notification) => {
    removeNotification(notification.id);
    navigate('/', { state: { openChatId: notification.chat?.id } });
  };

  // Handle native desktop notification click (Tauri): window focused → navigate to chat
  useEffect(() => {
    if (!pendingChatNavigation) return;
    const chatId = pendingChatNavigation.chat?.id;
    clearPendingNavigation();
    navigate('/', { state: { openChatId: chatId } });
  }, [pendingChatNavigation]);

  // Filter notifications: don't show if we're already on dashboard
  const shouldShowNotifications = location.pathname !== '/dashboard';

  return (
    <div className="layout">
      <Header 
        sidebarOpen={sidebarOpen} 
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} 
      />
      <div className="layout-body">
        {/* Overlay для затемнения фона на мобильных */}
        {isMobile && (
          <div 
            className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
            onClick={handleCloseSidebar}
          />
        )}
        
        <Sidebar open={sidebarOpen} onClose={handleCloseSidebar} />
        
        <main className={`main-content ${sidebarOpen ? '' : 'sidebar-closed'}`}>
          <div className="content-wrapper">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Chat Notifications - Show only when not on dashboard */}
      {shouldShowNotifications && (
        <div className="chat-notifications-container">
          {notifications.map(notification => (
            <ChatNotification
              key={notification.id}
              notification={notification}
              onClose={() => removeNotification(notification.id)}
              onClick={() => handleNotificationClick(notification)}
            />
          ))}
        </div>
      )}
    </div>
  );
}