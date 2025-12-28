import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, Search, User, Settings, LogOut, ChevronDown, Shield, Users, FileText, Layout, Image, Database } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { search } from '../services/api';

export default function Header({ sidebarOpen, onToggleSidebar }) {
  const { user, logout, isAdmin } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowResults(false);
      }
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
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
    logout();
    navigate('/login');
  };

  const adminMenuItems = [
    { to: '/admin/pages', icon: FileText, label: 'Страницы' },
    { to: '/admin/sidebar', icon: Layout, label: 'Меню навигации' },
    { to: '/admin/users', icon: Users, label: 'Пользователи' },
    { to: '/admin/roles', icon: Shield, label: 'Роли и права' },
    { to: '/admin/media', icon: Image, label: 'Медиафайлы' },
    { to: '/admin/settings', icon: Settings, label: 'Настройки' },
    { to: '/admin/backup', icon: Database, label: 'Резервные копии' }
  ];

  return (
    <header className="header">
      <div className="header-left">
        <button className="header-toggle" onClick={onToggleSidebar}>
          <Menu size={20} />
        </button>
        <Link to="/" className="header-logo">
          {theme.logo ? <img src={theme.logo} alt={theme.siteName} /> : null}
          <span>{theme.siteName}</span>
        </Link>
      </div>

      <div className="header-search" ref={searchRef}>
        <div className="search-container">
          <Search className="search-icon" size={18} />
          <input
            type="text"
            className="search-input"
            placeholder="Поиск..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
          />
          {showResults && (
            <div className="search-results">
              {searchResults.length > 0 ? (
                searchResults.map((result, idx) => (
                  <div
                    key={idx}
                    className="search-result-item"
                    onClick={() => handleResultClick(result)}
                  >
                    <div className="search-result-title">{result.title}</div>
                    <div className="search-result-type">{result.type}</div>
                  </div>
                ))
              ) : (
                <div className="search-no-results">Ничего не найдено</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="header-right">
        <div className="header-user" ref={dropdownRef}>
          <button 
            className="header-user-btn"
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <div className="header-avatar">
              <User size={18} />
            </div>
            <span>{user?.displayName || user?.username}</span>
            <ChevronDown size={16} />
          </button>

          {showDropdown && (
            <div className="header-dropdown">
              <div className="header-dropdown-user">
                <div className="header-dropdown-name">{user?.displayName || user?.username}</div>
                <div className="header-dropdown-role">{user?.role?.name || 'Пользователь'}</div>
              </div>
              
              {isAdmin && (
                <>
                  <div className="header-dropdown-divider" />
                  <div className="header-dropdown-section">
                    <div className="header-dropdown-section-title">Администрирование</div>
                    {adminMenuItems.map(({ to, icon: Icon, label }) => (
                      <Link 
                        key={to}
                        to={to} 
                        className="header-dropdown-item"
                        onClick={() => setShowDropdown(false)}
                      >
                        <Icon size={16} />
                        {label}
                      </Link>
                    ))}
                  </div>
                </>
              )}
              
              <div className="header-dropdown-divider" />
              <button className="header-dropdown-item danger" onClick={handleLogout}>
                <LogOut size={16} />
                Выйти
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}