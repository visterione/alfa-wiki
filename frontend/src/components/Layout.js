import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import ChatNotification from './ChatNotification';
import TaskNotification from './TaskNotification';
import OpenLineNotification from './openline/OpenLineNotification';
import ReleaseNoteModal from './ReleaseNoteModal';
import { useSocket } from '../context/SocketContext';
import { releaseNotes as releaseNotesApi } from '../services/api';
import './Layout.css';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const {
    notifications, removeNotification, pendingChatNavigation, clearPendingNavigation,
    latestReleaseNote, setLatestReleaseNote, setReleaseUnreadCount,
    taskNotifications, removeTaskNotification,
    openLineNotifications, removeOpenLineNotification
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

  // Нажатие по уведомлению задачи открывает саму задачу, а не раздел: человек
  // прочитал «требует решения» — решать он идёт в карточку.
  const handleTaskNotificationClick = (notification) => {
    removeTaskNotification(notification.id);
    navigate(notification.taskId ? `/tasks?task=${notification.taskId}` : '/tasks');
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

  // Карточки открытой линии (ver. 9.23) скрываются в самом разделе — там то же
  // самое стоит строкой в списке, — а при входе в него убираются совсем:
  // вышедший обратно оператор всё это уже видел, и возвращаться им незачем.
  const isOnOpenLine = location.pathname.startsWith('/open-line');
  useEffect(() => {
    if (isOnOpenLine) openLineNotifications.forEach(n => removeOpenLineNotification(n.id));
  }, [isOnOpenLine, openLineNotifications, removeOpenLineNotification]);

  // Щелчок открывает сам чат, а не раздел вообще. Вкладку страница выберет по
  // состоянию обращения: ничьё — в «Очереди», своё — в «Моих».
  const handleOpenLineClick = (notification) => {
    removeOpenLineNotification(notification.id);
    navigate('/open-line', {
      state: {
        openConversationId: notification.conversationId,
        scope: notification.assigneeUserId ? 'mine' : 'queue',
        lineId: notification.lineId
      }
    });
  };

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

      {/* Карточки мессенджера — не на главной (там сам мессенджер); карточки
          открытой линии — не в её разделе. Стопка общая: событие одно и то
          же — тебе написали. */}
      {(shouldShowNotifications || (!isOnOpenLine && openLineNotifications.length > 0)) && (
        <div className="chat-notifications-container">
          {shouldShowNotifications && notifications.map(notification => (
            <ChatNotification
              key={notification.id}
              notification={notification}
              onClose={() => removeNotification(notification.id)}
              onClick={() => handleNotificationClick(notification)}
            />
          ))}
          {!isOnOpenLine && openLineNotifications.map(notification => (
            <OpenLineNotification
              key={notification.id}
              notification={notification}
              onClose={() => removeOpenLineNotification(notification.id)}
              onClick={() => handleOpenLineClick(notification)}
            />
          ))}
        </div>
      )}

      {/* Уведомления модуля «Задачи» — своей стопкой над чатовыми */}
      {taskNotifications.length > 0 && (
        <div className="task-notifications-container">
          {taskNotifications.map(notification => (
            <TaskNotification
              key={notification.id}
              notification={notification}
              onClose={() => removeTaskNotification(notification.id)}
              onClick={() => handleTaskNotificationClick(notification)}
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
