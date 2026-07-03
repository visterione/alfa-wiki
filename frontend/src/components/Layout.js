import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import ChatNotification from './ChatNotification';
import ReleaseNoteModal from './ReleaseNoteModal';
import { useSocket } from '../context/SocketContext';
import { releaseNotes as releaseNotesApi } from '../services/api';
import './Layout.css';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const {
    notifications, removeNotification, pendingChatNavigation, clearPendingNavigation,
    latestReleaseNote, setLatestReleaseNote, setReleaseUnreadCount
  } = useSocket();
  const [importantNotes, setImportantNotes] = useState([]);
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

  // Автоматически закрываем sidebar при открытии страницы с таблицей
  useEffect(() => {
    const handler = (e) => {
      if (isMobile) return;
      if (e.detail.active) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };
    window.addEventListener('spreadsheet-page', handler);
    return () => window.removeEventListener('spreadsheet-page', handler);
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

  // Проверяем важные непрочитанные нововведения при входе и при получении нового важного
  useEffect(() => {
    let cancelled = false;
    releaseNotesApi.importantUnread()
      .then(({ data }) => {
        if (cancelled) return;
        setImportantNotes(data || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [latestReleaseNote]);

  const handleCloseReleaseModal = (ids) => {
    setImportantNotes([]);
    if (latestReleaseNote) setLatestReleaseNote(null);
    Promise.all((ids || []).map(id => releaseNotesApi.markRead(id).catch(() => {})))
      .then(() => releaseNotesApi.unreadCount())
      .then(({ data }) => setReleaseUnreadCount(data.count || 0))
      .catch(() => {});
  };

  // Filter notifications: don't show if we're already on dashboard
  const shouldShowNotifications = location.pathname !== '/';

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

      {/* Модалка «Что нового» для важных нововведений */}
      {importantNotes.length > 0 && (
        <ReleaseNoteModal notes={importantNotes} onClose={handleCloseReleaseModal} />
      )}
    </div>
  );
}
