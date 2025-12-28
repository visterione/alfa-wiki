import React from 'react';
import { Link } from 'react-router-dom';
import { 
  FileText, 
  Layout, 
  Users, 
  Shield, 
  Image, 
  Database,
  ChevronRight
} from 'lucide-react';
import '../Admin.css';

const adminSections = [
  {
    to: '/admin/pages',
    icon: FileText,
    title: 'Страницы',
    description: 'Управление страницами и контентом wiki'
  },
  {
    to: '/admin/sidebar',
    icon: Layout,
    title: 'Меню навигации',
    description: 'Настройка бокового меню и структуры'
  },
  {
    to: '/admin/users',
    icon: Users,
    title: 'Пользователи',
    description: 'Управление пользователями системы'
  },
  {
    to: '/admin/roles',
    icon: Shield,
    title: 'Роли и права',
    description: 'Настройка ролей и разрешений'
  },
  {
    to: '/admin/media',
    icon: Image,
    title: 'Медиафайлы',
    description: 'Загрузка и управление файлами'
  },
  {
    to: '/admin/backup',
    icon: Database,
    title: 'Резервные копии',
    description: 'Создание и восстановление бэкапов'
  }
];

export default function AdminDashboard() {
  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Администрирование</h1>
      </div>

      <div className="admin-dashboard-grid">
        {adminSections.map(({ to, icon: Icon, title, description }) => (
          <Link key={to} to={to} className="admin-dashboard-card">
            <div className="admin-dashboard-card-icon">
              <Icon size={24} />
            </div>
            <div className="admin-dashboard-card-content">
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
            <ChevronRight size={20} className="admin-dashboard-card-arrow" />
          </Link>
        ))}
      </div>
    </div>
  );
}