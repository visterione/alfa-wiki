import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Menu, Search, User, LogOut, ChevronDown, Shield, FileText,
  Award, UserCircle, Briefcase, File, ExternalLink, Car, Settings,
  Layout, Users, Lock, Image, Database, BookOpen, TestTube, Table2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { search as searchApi, BASE_URL } from '../services/api';
import {
  VehicleSearchResult,
  AccreditationSearchResult,
  AnalysisSearchResult,
  ServiceSearchResult,
  DoctorSearchResult,
  DefaultSearchResult,
  SpreadsheetSearchResult
} from './SearchResultComponents';
import './Header.css';

// Маппинг иконок для разных типов результатов
const getResultIcon = (type) => {
  switch (type) {
    case 'page':
      return FileText;
    case 'spreadsheet':
      return Table2;
    case 'accreditation':
      return Award;
    case 'vehicle':
      return Car;
    case 'doctor':
      return UserCircle;
    case 'service':
      return Briefcase;
    case 'analysis':
      return TestTube;
    default:
      return File;
  }
};

// Функция для рендеринга иконки/эмодзи в результатах поиска
const renderSearchIcon = (iconValue, type, size = 16) => {
  // Если есть эмодзи (1-4 символа Unicode)
  if (iconValue && iconValue.length <= 4) {
    return <span className="search-result-emoji" style={{ fontSize: `${size + 2}px` }}>{iconValue}</span>;
  }

  // Fallback на иконку по типу
  const IconComponent = getResultIcon(type);
  return <IconComponent size={size} />;
};

// Маппинг названий типов
const getTypeName = (type, displayType) => {
  if (displayType) return displayType;
  switch (type) {
    case 'page':
      return 'Страница';
    case 'spreadsheet':
      return 'Таблица';
    case 'accreditation':
      return 'Аккредитация';
    case 'vehicle':
      return 'Транспорт';
    case 'doctor':
      return 'Врач';
    case 'service':
      return 'Услуга';
    case 'analysis':
      return 'Анализ';
    default:
      return type;
  }
};

export default function Header({ sidebarOpen, onToggleSidebar }) {
  const { user, logout, isAdmin } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
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
          const { data } = await searchApi.query(searchQuery);
          setSearchResults(data.results || []);
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
    
    // Для внешних ссылок или специальных URL
    if (result.url.startsWith('http')) {
      window.open(result.url, '_blank');
    } else {
      navigate(result.url);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getAvatarUrl = () => {
    if (!user?.avatar) return null;
    if (user.avatar.startsWith('http://localhost')) {
      const path = user.avatar.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (user.avatar.startsWith('http')) return user.avatar;
    return `${BASE_URL}/${user.avatar}`;
  };

  const getLogoUrl = () => {
    if (!theme?.logo) return null;
    if (theme.logo.startsWith('http://localhost')) {
      const path = theme.logo.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (theme.logo.startsWith('http')) return theme.logo;
    return `${BASE_URL}/${theme.logo}`;
  };

  // Получение роли пользователя
  const getUserRole = () => {
    if (user?.isAdmin) return 'Администратор';
    return user?.role?.name || 'Пользователь';
  };

  // Функция для подсветки поискового запроса в тексте
  const highlightText = (text, query) => {
    if (!text) return [{ text: '', highlight: false }];
    if (!query) return [{ text, highlight: false }];
    
    const parts = [];
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let lastIndex = 0;
    let index = lowerText.indexOf(lowerQuery);
    
    if (index === -1) {
      return [{ text, highlight: false }];
    }
    
    while (index !== -1) {
      if (index > lastIndex) {
        parts.push({
          text: text.substring(lastIndex, index),
          highlight: false
        });
      }
      
      parts.push({
        text: text.substring(index, index + query.length),
        highlight: true
      });
      
      lastIndex = index + query.length;
      index = lowerText.indexOf(lowerQuery, lastIndex);
    }
    
    if (lastIndex < text.length) {
      parts.push({
        text: text.substring(lastIndex),
        highlight: false
      });
    }
    
    return parts;
  };

  return (
    <header className="header">
      <div className="header-left">
        <button className="header-toggle" onClick={onToggleSidebar}>
          {getLogoUrl() ? (
            <img src={getLogoUrl()} alt="Logo" className="header-toggle-logo" />
          ) : (
            <Menu size={20} />
          )}
        </button>
        <Link to="/" className="header-site-name">
          {theme?.siteName || 'Alfa Wiki'}
        </Link>
      </div>

      <div className="header-center">
        <div className="header-search" ref={searchRef}>
          <Search size={18} />
          <input
            type="text"
            placeholder="Поиск..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {showResults && (
            <div className="search-dropdown">
              {searchResults.length > 0 ? (
                searchResults.map((result, idx) => {
                  const typeName = getTypeName(result.type, result.displayType);

                  // Определяем какой компонент использовать для отображения контента
                  const renderResultContent = () => {
                    switch (result.type) {
                      case 'spreadsheet':
                        return <SpreadsheetSearchResult result={result} searchQuery={searchQuery} />;
                      case 'vehicle':
                        return <VehicleSearchResult result={result} searchQuery={searchQuery} />;
                      case 'accreditation':
                        return <AccreditationSearchResult result={result} searchQuery={searchQuery} />;
                      case 'analysis':
                        return <AnalysisSearchResult result={result} searchQuery={searchQuery} />;
                      case 'service':
                        return <ServiceSearchResult result={result} searchQuery={searchQuery} />;
                      case 'doctor':
                        return <DoctorSearchResult result={result} searchQuery={searchQuery} />;
                      default:
                        return <DefaultSearchResult result={result} searchQuery={searchQuery} />;
                    }
                  };

                  return (
                    <div
                      key={`${result.type}-${result.id}-${idx}`}
                      className="search-result"
                      onClick={() => handleResultClick(result)}
                    >
                      <div className="search-result-icon">
                        {renderSearchIcon(result.icon, result.type, 16)}
                      </div>
                      <div className="search-result-content">
                        <div className="search-result-header">
                          <div className="search-result-title">
                            {highlightText(result.title, searchQuery).map((part, i) => (
                              part.highlight ? (
                                <mark key={i}>{part.text}</mark>
                              ) : (
                                <span key={i}>{part.text}</span>
                              )
                            ))}
                          </div>
                          <span className={`search-result-type search-result-type--${result.type}`}>
                            {typeName}
                          </span>
                        </div>
                        {renderResultContent()}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="search-no-results">
                  Ничего не найдено
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="header-right">
        {user && (
          <div className="header-user" ref={dropdownRef}>
            <button
              className={`header-user-btn ${showDropdown ? 'active' : ''}`}
              onClick={() => setShowDropdown(!showDropdown)}
            >
              {getAvatarUrl() ? (
                <img src={getAvatarUrl()} alt={user.displayName || user.username} className="header-avatar" />
              ) : (
                <div className="header-avatar-placeholder">
                  <User size={18} />
                </div>
              )}
              <span className="header-username">{user.displayName || user.username}</span>
              <ChevronDown size={16} className="header-chevron" />
            </button>
            
            {showDropdown && (
              <div className="header-dropdown">
                {/* Блок-миниатюра пользователя */}
                <div className="header-dropdown-user">
                  <div className="header-dropdown-avatar">
                    {getAvatarUrl() ? (
                      <img src={getAvatarUrl()} alt={user.displayName || user.username} />
                    ) : (
                      <div className="header-dropdown-avatar-placeholder">
                        <User size={24} />
                      </div>
                    )}
                  </div>
                  <div className="header-dropdown-user-info">
                    <div className="header-dropdown-user-name">{user.displayName || user.username}</div>
                    <div className="header-dropdown-user-role">{getUserRole()}</div>
                  </div>
                </div>
                
                <Link to="/profile" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                  <Settings size={16} />
                  Настройки
                </Link>

                {/* Админ-разделы - показываем только те, к которым есть доступ */}
                {(isAdmin || user?.adminAccess?.sidebar) && (
                  <Link to="/admin/sidebar" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <Layout size={16} />
                    Меню навигации
                  </Link>
                )}
                {(isAdmin || user?.adminAccess?.users) && (
                  <Link to="/admin/users" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <Users size={16} />
                    Пользователи
                  </Link>
                )}
                {(isAdmin || user?.adminAccess?.roles) && (
                  <Link to="/admin/roles" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <Lock size={16} />
                    Роли и права
                  </Link>
                )}
                {(isAdmin || user?.adminAccess?.media) && (
                  <Link to="/admin/media" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <Image size={16} />
                    Медиафайлы
                  </Link>
                )}
                {(isAdmin || user?.adminAccess?.backup) && (
                  <Link to="/admin/backup" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <Database size={16} />
                    Резервные копии
                  </Link>
                )}
                {(isAdmin || user?.adminAccess?.settings) && (
                  <Link to="/admin/settings" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <Settings size={16} />
                    Настройки системы
                  </Link>
                )}
                {(isAdmin || user?.adminAccess?.courses) && (
                  <Link to="/admin/courses" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <BookOpen size={16} />
                    Курсы
                  </Link>
                )}

                <div className="header-dropdown-divider" />
                <button className="header-dropdown-item" onClick={handleLogout}>
                  <LogOut size={16} />
                  Выйти
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}