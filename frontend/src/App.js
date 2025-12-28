import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PageView from './pages/PageView';
import PageEditor from './pages/PageEditor';
import AdminUsers from './pages/admin/AdminUsers';
import AdminRoles from './pages/admin/AdminRoles';
import AdminSidebar from './pages/admin/AdminSidebar';
import AdminPages from './pages/admin/AdminPages';
import AdminSettings from './pages/admin/AdminSettings';
import AdminBackup from './pages/admin/AdminBackup';
import AdminMedia from './pages/admin/AdminMedia';
import './index.css';

// Protected Route component
function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div style={{ 
        height: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center' 
      }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;

  return children;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
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
        
        {/* Admin routes */}
        <Route path="admin/users" element={
          <ProtectedRoute adminOnly><AdminUsers /></ProtectedRoute>
        } />
        <Route path="admin/roles" element={
          <ProtectedRoute adminOnly><AdminRoles /></ProtectedRoute>
        } />
        <Route path="admin/sidebar" element={
          <ProtectedRoute adminOnly><AdminSidebar /></ProtectedRoute>
        } />
        <Route path="admin/pages" element={
          <ProtectedRoute adminOnly><AdminPages /></ProtectedRoute>
        } />
        <Route path="admin/media" element={
          <ProtectedRoute adminOnly><AdminMedia /></ProtectedRoute>
        } />
        <Route path="admin/settings" element={
          <ProtectedRoute adminOnly><AdminSettings /></ProtectedRoute>
        } />
        <Route path="admin/backup" element={
          <ProtectedRoute adminOnly><AdminBackup /></ProtectedRoute>
        } />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AppContent() {
  return (
    <AuthProvider>
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