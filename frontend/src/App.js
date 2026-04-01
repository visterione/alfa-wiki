import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { SocketProvider } from './context/SocketContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import PageView from './pages/PageView';
import PageEditor from './pages/PageEditor';
import Profile from './pages/Profile';
import Favorites from './pages/Favorites';
import AdminUsers from './pages/admin/AdminUsers';
import AdminBots from './pages/admin/AdminBots';
import AdminRoles from './pages/admin/AdminRoles';
import AdminSidebar from './pages/admin/AdminSidebar';
import AdminPages from './pages/admin/AdminPages';
import AdminSettings from './pages/admin/AdminSettings';
import AdminBackup from './pages/admin/AdminBackup';
import Courses from './pages/Courses';
import CourseView from './pages/CourseView';
import AdminCourses from './pages/admin/AdminCourses';
import AdminCourseEditor from './pages/admin/AdminCourseEditor';
import AdminJournal from './pages/admin/AdminJournal';
import AdminRbAccess from './pages/admin/AdminRbAccess';
import Calendar from './pages/Calendar';
import Kanban from './pages/Kanban';
import KanbanArchive from './pages/KanbanArchive';
import BoardsList from './pages/BoardsList';
import BoardSettings from './pages/BoardSettings';
// Referral Bonuses module
import ReferralBonusesPage from './pages/ReferralBonuses';
// Reviews module
import ReviewBoardsList from './pages/ReviewBoardsList';
import ReviewBoard from './pages/ReviewBoard';
import ReviewBoardSettings from './pages/ReviewBoardSettings';
import ReviewArchive from './pages/ReviewArchive';
import ReviewStatistics from './pages/ReviewStatistics';
import Dashboard from './pages/Dashboard';
import './index.css';

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
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      
      <Route path="/" element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<Home />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="page/:slug" element={<PageView />} />
        <Route path="page/:slug/edit" element={<PageEditor />} />
        <Route path="new-page" element={<PageEditor />} />
        <Route path="profile" element={<Profile />} />
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
        <Route path="explorer" element={
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

        {/* МОДУЛЬ: БОНУСЫ ЗА НАПРАВЛЕНИЯ */}
        <Route path="referral-bonuses" element={
          <ProtectedRoute><ReferralBonusesPage /></ProtectedRoute>
        } />

        {/* ДОСТУП К БОНУСАМ ЗА НАПРАВЛЕНИЯ */}
        <Route path="admin/referral-bonuses-access" element={
          <ProtectedRoute adminOnly><AdminRbAccess /></ProtectedRoute>
        } />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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