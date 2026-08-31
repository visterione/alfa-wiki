import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { SocketProvider } from './context/SocketContext';
import { AppearanceProvider } from './context/AppearanceContext';
import { MedCentersProvider } from './context/MedCentersContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import './index.css';

const PageView = lazy(() => import('./pages/PageView'));
const PageEditor = lazy(() => import('./pages/PageEditor'));
const Profile = lazy(() => import('./pages/Profile'));
const UserProfile = lazy(() => import('./pages/UserProfile'));
const Favorites = lazy(() => import('./pages/Favorites'));
const ChatJoin = lazy(() => import('./pages/ChatJoin'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
// Публичные страницы анкеты: их открывает врач, у которого нет и не будет
// аккаунта в портале.
const AnketaStart = lazy(() => import('./pages/Anketa/AnketaStart'));
const AnketaForm = lazy(() => import('./pages/Anketa/AnketaForm'));
const AnketaServices = lazy(() => import('./pages/Anketa/AnketaServices'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminBots = lazy(() => import('./pages/admin/AdminBots'));
const AdminIntegrations = lazy(() => import('./pages/admin/AdminIntegrations'));
const AdminRoles = lazy(() => import('./pages/admin/AdminRoles'));
const AdminMedCenters = lazy(() => import('./pages/admin/AdminMedCenters'));
const AdminSidebar = lazy(() => import('./pages/admin/AdminSidebar'));
const AdminPages = lazy(() => import('./pages/admin/AdminPages'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));
const AdminBackup = lazy(() => import('./pages/admin/AdminBackup'));
const Courses = lazy(() => import('./pages/Courses'));
const CourseView = lazy(() => import('./pages/CourseView'));
const AdminCourses = lazy(() => import('./pages/admin/AdminCourses'));
const AdminCourseEditor = lazy(() => import('./pages/admin/AdminCourseEditor'));
const AdminLessonEditor = lazy(() => import('./pages/admin/AdminLessonEditor'));
const AdminJournal = lazy(() => import('./pages/admin/AdminJournal'));
const AdminRbAccess = lazy(() => import('./pages/admin/AdminRbAccess'));
const AdminParser = lazy(() => import('./pages/admin/AdminParser'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Tasks = lazy(() => import('./pages/Tasks'));
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
const Warehouse = lazy(() => import('./pages/warehouse/Warehouse'));
// Публичные карточки по QR грузятся отдельным чанком: их открывают с телефона по
// одной ссылке, и тянуть ради этого весь бандл портала незачем.
const PublicAssetCard = lazy(() => import('./pages/PublicAssetCard'));

function PageLoader() {
  return (
    <div style={{ minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="loading-spinner" />
    </div>
  );
}


function ProtectedRoute({ children, adminOnly = false, requireAdminAccess = null }) {
  const { user, loading, isAdmin, hasAdminAccess } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  // Запоминаем, куда человек шёл: после входа вернём его именно туда, а не на
  // домашнюю. Это не мелочь удобства — по QR-коду с двери кабинета приходят с
  // телефона, на котором сессия давно истекла, и без этого вход всегда уводил
  // на стартовый экран, а кабинет приходилось искать руками.
  if (!user) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

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
        background: 'linear-gradient(135deg, var(--accent-900) 0%, var(--accent-900) 50%, var(--violet-800) 100%)'
      }}>
        <div className="loading-spinner" style={{ width: 48, height: 48 }} />
      </div>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />

      {/* Цифровой паспорт оборудования по QR-коду.
          Вне ProtectedRoute по замыслу: QR наклеен на прибор, и подходят к нему с
          телефона, где портал не залогинен. Набор полей узкий — см. комментарий в
          backend/services/warehouse/qr.js.
          Кабинеты сюда не входят: их код висит на двери в общем коридоре и ведёт
          на /warehouse?room=<id>, то есть внутрь портала, за авторизацию. */}
      <Route path="/p/a/:token" element={<PublicAssetCard kind="asset" />} />

      {/* Анкета врача. Вне ProtectedRoute по замыслу: ссылка одна и постоянная,
          её рассылают кандидатам и вешают в вакансию, а заполняют с телефона,
          на котором портал не залогинен. Право на конкретную заявку
          предъявляется её токеном, а не сессией. */}
      <Route path="/anketa" element={<AnketaStart />} />
      <Route path="/anketa/:token" element={<AnketaForm />} />
      <Route path="/anketa/:token/services" element={<AnketaServices />} />
      
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

        {/* Вступление в группу по пригласительной ссылке (ver. 7.58).
            Внутри ProtectedRoute намеренно: ссылка для сотрудников, и
            незалогиненного отсюда уводит на вход, а после входа возвращает
            обратно — этим же занимается сам ProtectedRoute. */}
        <Route path="chat/join/:token" element={<ChatJoin />} />
        <Route path="calendar" element={<Calendar />} />
        {/* Складской учёт (ver. 6.68). Право warehouse — то же гранулярное, что у
            «Отзывов»: уровень внутри модуля считает бэкенд. */}
        <Route path="warehouse" element={
          <ProtectedRoute requireAdminAccess="warehouse"><Warehouse /></ProtectedRoute>
        } />


        {/* Модуль «Задачи» (ver. 6.75), пришёл на смену канбану. Один
            маршрут: разделы переключаются параметром ?screen=, чтобы ссылка на
            конкретный экран оставалась рабочей, а состояние периода не
            терялось при переходе между ними. */}
        <Route path="tasks" element={
          <ProtectedRoute requireAdminAccess="tasks"><Tasks /></ProtectedRoute>
        } />

        {/* Онбординг врача (ver. 7.30). Флаг тот же гранулярный, что у склада и
            «Задач»: он решает только видимость раздела. Кто какой шаг выполняет
            и чьи заявки ему видны — считают назначения на бэкенде, отдельных
            ролей под этот процесс намеренно не заводили. */}
        <Route path="onboarding" element={
          <ProtectedRoute requireAdminAccess="onboarding"><Onboarding /></ProtectedRoute>
        } />

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
        <Route path="admin/med-centers" element={
          <ProtectedRoute requireAdminAccess="medCenters"><AdminMedCenters /></ProtectedRoute>
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
        <Route path="admin/courses/:courseId/lessons/:lessonId/edit" element={
          <ProtectedRoute requireAdminAccess="courses"><AdminLessonEditor /></ProtectedRoute>
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
        <AppearanceProvider>
          <ThemeProvider>
            <MedCentersProvider>
              <AppRoutes />
              <Toaster
                position="top-right"
                toastOptions={{
                  duration: 3000,
                  style: {
                    borderRadius: '10px',
                    background: 'var(--surface-inverse)',
                    color: 'var(--text-on-inverse)',
                    padding: '12px 20px',
                    fontSize: '14px'
                  }
                }}
              />
            </MedCentersProvider>
          </ThemeProvider>
        </AppearanceProvider>
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
