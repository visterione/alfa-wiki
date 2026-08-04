import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { SocketProvider } from './context/SocketContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import './index.css';

const PageView = lazy(() => import('./pages/PageView'));
const PageEditor = lazy(() => import('./pages/PageEditor'));
const Profile = lazy(() => import('./pages/Profile'));
const UserProfile = lazy(() => import('./pages/UserProfile'));
const Favorites = lazy(() => import('./pages/Favorites'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminBots = lazy(() => import('./pages/admin/AdminBots'));
const AdminIntegrations = lazy(() => import('./pages/admin/AdminIntegrations'));
const AdminRoles = lazy(() => import('./pages/admin/AdminRoles'));
const AdminSidebar = lazy(() => import('./pages/admin/AdminSidebar'));
const AdminPages = lazy(() => import('./pages/admin/AdminPages'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));
const AdminBackup = lazy(() => import('./pages/admin/AdminBackup'));
const Courses = lazy(() => import('./pages/Courses'));
const CourseView = lazy(() => import('./pages/CourseView'));
const AdminCourses = lazy(() => import('./pages/admin/AdminCourses'));
const AdminCourseEditor = lazy(() => import('./pages/admin/AdminCourseEditor'));
const AdminJournal = lazy(() => import('./pages/admin/AdminJournal'));
const AdminRbAccess = lazy(() => import('./pages/admin/AdminRbAccess'));
const AdminParser = lazy(() => import('./pages/admin/AdminParser'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Kanban = lazy(() => import('./pages/Kanban'));
const KanbanArchive = lazy(() => import('./pages/KanbanArchive'));
const BoardsList = lazy(() => import('./pages/BoardsList'));
const BoardSettings = lazy(() => import('./pages/BoardSettings'));
const ReferralBonusesPage = lazy(() => import('./pages/ReferralBonuses'));
const StatisticsPage = lazy(() => import('./pages/Statistics'));
const ReviewBoardsList = lazy(() => import('./pages/ReviewBoardsList'));
const ReviewBoard = lazy(() => import('./pages/ReviewBoard'));
const ReviewBoardSettings = lazy(() => import('./pages/ReviewBoardSettings'));
const ReviewArchive = lazy(() => import('./pages/ReviewArchive'));
const ReviewStatistics = lazy(() => import('./pages/ReviewStatistics'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const WhatsNew = lazy(() => import('./pages/WhatsNew'));
const AdminReleaseNotes = lazy(() => import('./pages/admin/AdminReleaseNotes'));

function PageLoader() {
  return (
    <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="loading-spinner" />
    </div>
  );
}


function ProtectedRoute({ children, adminOnly = false, requireAdminAccess = null }) {
  const { user, loading, isAdmin, hasAdminAccess } = useAuth();

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Проверка полного админ-доступа
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;

  // Проверка гранулярного доступа к админ-разделу
  if (requireAdminAccess && !hasAdminAccess(requireAdminAccess)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  // Показываем загрузку во время проверки авторизации
  if (loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0a3d62 0%, #1e3799 50%, #4a148c 100%)'
      }}>
        <div className="loading-spinner" style={{ width: 48, height: 48 }} />
      </div>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      
      <Route path="/" element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<Dashboard />} />
        <Route path="page/:slug" element={<PageView />} />
        <Route path="page/:slug/edit" element={<PageEditor />} />
        <Route path="new-page" element={<PageEditor />} />
        <Route path="profile" element={<Profile />} />
        <Route path="whats-new" element={<WhatsNew />} />
        <Route path="users/:id" element={<UserProfile />} />
        <Route path="favorites" element={<Favorites />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="kanban" element={<BoardsList />} />
        <Route path="kanban/board/:id" element={<Kanban />} />
        <Route path="kanban/board/:id/settings" element={<BoardSettings />} />
        <Route path="kanban/board/:id/archive" element={<KanbanArchive />} />

        {/* Reviews module */}
        <Route path="reviews" element={
          <ProtectedRoute requireAdminAccess="reviews"><ReviewBoardsList /></ProtectedRoute>
        } />
        <Route path="reviews/board/:id" element={
          <ProtectedRoute requireAdminAccess="reviews"><ReviewBoard /></ProtectedRoute>
        } />
        <Route path="reviews/board/:id/settings" element={
          <ProtectedRoute requireAdminAccess="reviews"><ReviewBoardSettings /></ProtectedRoute>
        } />
        <Route path="reviews/board/:id/stats" element={
          <ProtectedRoute requireAdminAccess="reviews"><ReviewStatistics /></ProtectedRoute>
        } />
        <Route path="reviews/archive" element={
          <ProtectedRoute requireAdminAccess="reviews"><ReviewArchive /></ProtectedRoute>
        } />

        {/* КУРСЫ - добавьте эти строки */}
        <Route path="courses" element={<Courses />} />
        <Route path="courses/:id" element={<CourseView />} />
        
        {/* Admin routes */}
        <Route path="admin/users" element={
          <ProtectedRoute requireAdminAccess="users"><AdminUsers /></ProtectedRoute>
        } />
        <Route path="admin/roles" element={
          <ProtectedRoute requireAdminAccess="roles"><AdminRoles /></ProtectedRoute>
        } />
        <Route path="admin/sidebar" element={
          <ProtectedRoute requireAdminAccess="sidebar"><AdminSidebar /></ProtectedRoute>
        } />
        <Route path="explorer/*" element={
          <ProtectedRoute><AdminPages /></ProtectedRoute>
        } />
        <Route path="admin/settings" element={
          <ProtectedRoute requireAdminAccess="settings"><AdminSettings /></ProtectedRoute>
        } />
        <Route path="admin/backup" element={
          <ProtectedRoute requireAdminAccess="backup"><AdminBackup /></ProtectedRoute>
        } />

        {/* АДМИНКА КУРСОВ - добавьте эти строки */}
        <Route path="admin/courses" element={
          <ProtectedRoute requireAdminAccess="courses"><AdminCourses /></ProtectedRoute>
        } />
        <Route path="admin/courses/:id/edit" element={
          <ProtectedRoute requireAdminAccess="courses"><AdminCourseEditor /></ProtectedRoute>
        } />

        {/* АДМИНКА ЖУРНАЛ СТРАНИЦ */}
        <Route path="admin/journal" element={
          <ProtectedRoute requireAdminAccess="journal"><AdminJournal /></ProtectedRoute>
        } />

        <Route path="admin/bots" element={
          <ProtectedRoute adminOnly><AdminBots /></ProtectedRoute>
        } />

        {/* КЛЮЧИ ПУБЛИЧНОГО API И МАРШРУТЫ ДОСТАВКИ ЗАЯВОК */}
        <Route path="admin/integrations" element={
          <ProtectedRoute adminOnly><AdminIntegrations /></ProtectedRoute>
        } />

        {/* ПАРСЕР ЦЕН КОНКУРЕНТОВ */}
        <Route path="admin/parser" element={
          <ProtectedRoute requireAdminAccess="parser"><AdminParser /></ProtectedRoute>
        } />

        {/* ЦЕНТР ОБНОВЛЕНИЙ - админка нововведений */}
        <Route path="admin/release-notes" element={
          <ProtectedRoute requireAdminAccess="releaseNotes"><AdminReleaseNotes /></ProtectedRoute>
        } />

        {/* МОДУЛЬ: БОНУСЫ ЗА НАПРАВЛЕНИЯ */}
        <Route path="referral-bonuses" element={
          <ProtectedRoute><ReferralBonusesPage /></ProtectedRoute>
        } />

        {/* СТАТИСТИКА */}
        <Route path="statistics" element={
          <ProtectedRoute><StatisticsPage /></ProtectedRoute>
        } />

        {/* ДОСТУП К БОНУСАМ ЗА НАПРАВЛЕНИЯ */}
        <Route path="admin/referral-bonuses-access" element={
          <ProtectedRoute adminOnly><AdminRbAccess /></ProtectedRoute>
        } />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function AppContent() {
  return (
    <AuthProvider>
      <SocketProvider>
        <ThemeProvider>
          <AppRoutes />
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 3000,
              style: {
                borderRadius: '10px',
                background: '#1D1D1F',
                color: '#fff',
                padding: '12px 20px',
                fontSize: '14px'
              }
            }}
          />
        </ThemeProvider>
      </SocketProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
