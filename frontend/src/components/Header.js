import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Menu, Search, User, Settings, LogOut, ChevronDown, Shield, Users, 
  FileText, Layout, Image, Database, ChevronRight 
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { search } from '../services/api';
import './Header.css';

export default function Header({ sidebarOpen, onToggleSidebar }) {
  const { user, logout, isAdmin } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAdminSubmenu, setShowAdminSubmenu] = useState(false);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);
  const submenuTimeoutRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowResults(false);
      }
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
        setShowAdminSubmenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        try {
          const { data } = await search.query(searchQuery);
          setSearchResults(data.results);
          setShowResults(true);
        } catch (error) {
          console.error('Search error:', error);
        }
      } else {
        setSearchResults([]);
        setShowResults(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleResultClick = (result) => {
    setShowResults(false);
    setSearchQuery('');
    navigate(result.url);
  };

  const handleLogout = () => {
    setShowDropdown(false);
    logout();
    navigate('/login');
  };

  const handleNavigate = (path) => {
    setShowDropdown(false);
    setShowAdminSubmenu(false);
    navigate(path);
  };

  // Обработчики для подменю с задержкой
  const handleAdminEnter = () => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current);
    }
    setShowAdminSubmenu(true);
  };

  const handleAdminLeave = () => {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowAdminSubmenu(false);
    }, 150);
  };

  const adminMenuItems = [
    { path: '/admin/pages', icon: FileText, label: 'Страницы' },
    { path: '/admin/sidebar', icon: Layout, label: 'Меню навигации' },
    { path: '/admin/users', icon: Users, label: 'Пользователи' },
    { path: '/admin/roles', icon: Shield, label: 'Роли и права' },
    { path: '/admin/media', icon: Image, label: 'Медиафайлы' },
    { path: '/admin/settings', icon: Settings, label: 'Настройки системы' },
    { path: '/admin/backup', icon: Database, label: 'Резервные копии' }
  ];

  return (
    <header className="header">
      <div className="header-left">
        <button className="header-toggle" onClick={onToggleSidebar}>
          <Menu size={20} />
        </button>
        <Link to="/" className="header-logo">
          {theme.logo ? (
            <img src={theme.logo} alt={theme.siteName} />
          ) : (
            <span>{theme.siteName || 'Alfa Wiki'}</span>
          )}
        </Link>
      </div>

      <div className="header-search" ref={searchRef}>
        <Search size={18} />
        <input
          type="text"
          placeholder="Поиск по базе знаний..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => searchResults.length > 0 && setShowResults(true)}
        />
        {showResults && searchResults.length > 0 && (
          <div className="search-dropdown">
            {searchResults.map((result, idx) => (
              <div
                key={idx}
                className="search-result"
                onClick={() => handleResultClick(result)}
              >
                <FileText size={16} />
                <div className="search-result-content">
                  <div className="search-result-title">{result.title}</div>
                  {result.excerpt && (
                    <div className="search-result-excerpt">{result.excerpt}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="header-right" ref={dropdownRef}>
        <button className="header-user" onClick={() => setShowDropdown(!showDropdown)}>
          <div className="header-avatar">
            {user?.avatar ? (
              <img src={user.avatar} alt={user.displayName} />
            ) : (
              <User size={18} />
            )}
          </div>
          <span className="header-username">{user?.displayName || user?.username}</span>
          <ChevronDown size={16} className="header-chevron" />
        </button>

        {showDropdown && (
          <div className="header-dropdown">
            <div className="dropdown-header">
              <div className="dropdown-avatar">
                {user?.avatar ? (
                  <img src={user.avatar} alt="" />
                ) : (
                  <User size={24} />
                )}
              </div>
              <div className="dropdown-info">
                <div className="dropdown-name">{user?.displayName || user?.username}</div>
                <div className="dropdown-role">{user?.role?.name || (user?.isAdmin ? 'Администратор' : 'Пользователь')}</div>
              </div>
            </div>
            
            <div className="dropdown-divider" />
            
            <button className="dropdown-item" onClick={() => handleNavigate('/profile')}>
              <Settings size={18} />
              <span>Настройки профиля</span>
            </button>
            
            {isAdmin && (
              <>
                <div className="dropdown-divider" />
                <div 
                  className="dropdown-item dropdown-submenu-trigger"
                  onMouseEnter={handleAdminEnter}
                  onMouseLeave={handleAdminLeave}
                >
                  <Shield size={18} />
                  <span>Администрирование</span>
                  <ChevronRight size={16} className="submenu-arrow" />
                  
                  {showAdminSubmenu && (
                    <div 
                      className="dropdown-submenu"
                      onMouseEnter={handleAdminEnter}
                      onMouseLeave={handleAdminLeave}
                    >
                      {adminMenuItems.map(({ path, icon: Icon, label }) => (
                        <button
                          key={path}
                          className="dropdown-submenu-item"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNavigate(path);
                          }}
                        >
                          <Icon size={16} />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            
            <div className="dropdown-divider" />
            
            <button className="dropdown-item dropdown-logout" onClick={handleLogout}>
              <LogOut size={18} />
              <span>Выйти</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}