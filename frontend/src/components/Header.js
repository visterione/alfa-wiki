import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { 
  Menu, Search, User, LogOut, ChevronDown, Shield, FileText,
  Award, UserCircle, Briefcase, File, ExternalLink, Car
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { search as searchApi, BASE_URL } from '../services/api';
import './Header.css';

// Маппинг иконок для разных типов результатов
const getResultIcon = (type) => {
  switch (type) {
    case 'page':
      return FileText;
    case 'accreditation':
      return Award;
    case 'vehicle':
      return Car;
    case 'doctor':
      return UserCircle;
    case 'service':
      return Briefcase;
    default:
      return File;
  }
};

// Маппинг названий типов
const getTypeName = (type, displayType) => {
  if (displayType) return displayType;
  switch (type) {
    case 'page':
      return 'Страница';
    case 'accreditation':
      return 'Аккредитация';
    case 'vehicle':
      return 'Транспорт';
    case 'doctor':
      return 'Врач';
    case 'service':
      return 'Услуга';
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
          <Menu size={20} />
        </button>
        <Link to="/" className="header-logo">
          {getLogoUrl() ? (
            <img src={getLogoUrl()} alt={theme?.siteName || 'Wiki'} />
          ) : (
            theme?.siteName || 'Alfa Wiki'
          )}
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
                  const IconComponent = getResultIcon(result.type);
                  const typeName = getTypeName(result.type, result.displayType);
                  
                  return (
                    <div
                      key={`${result.type}-${result.id}-${idx}`}
                      className="search-result"
                      onClick={() => handleResultClick(result)}
                    >
                      <div className="search-result-icon">
                        <IconComponent size={16} />
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
                        {(result.excerpt || result.description) && (
                          <div className="search-result-excerpt">
                            {highlightText(result.excerpt || result.description || '', searchQuery).map((part, i) => (
                              part.highlight ? (
                                <mark key={i}>{part.text}</mark>
                              ) : (
                                <span key={i}>{part.text}</span>
                              )
                            ))}
                          </div>
                        )}
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
              className="header-user-btn"
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
              <ChevronDown size={16} />
            </button>
            
            {showDropdown && (
              <div className="header-dropdown">
                <Link to="/profile" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                  <User size={16} />
                  Профиль
                </Link>
                {isAdmin && (
                  <Link to="/admin" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <Shield size={16} />
                    Админ-панель
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