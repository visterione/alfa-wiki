import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Menu, Search, User, LogOut, ChevronDown, Shield, FileText,
  Award, UserCircle, Briefcase, File, ExternalLink, Car, Settings,
  Layout, Users, Lock, Database, BookOpen, TestTube, Table2, GitBranch, Bot, Newspaper
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import WhatsNewMenu from './WhatsNewMenu';
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

const GROUP_ORDER = ['doctor', 'analysis', 'service', 'accreditation', 'vehicle', 'page', 'spreadsheet'];
const GROUP_LABELS = {
  doctor: 'Врачи',
  analysis: 'Анализы',
  service: 'Услуги',
  accreditation: 'Аккредитации',
  vehicle: 'Транспорт',
  page: 'Страницы Wiki',
  spreadsheet: 'Таблицы',
};

function groupResults(results) {
  const byType = {};
  results.forEach(r => {
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r);
  });
  const ordered = [];
  GROUP_ORDER.forEach(type => {
    if (byType[type]?.length) {
      ordered.push({ type, label: GROUP_LABELS[type] || type, items: byType[type] });
      delete byType[type];
    }
  });
  Object.keys(byType).forEach(type => {
    if (byType[type].length) ordered.push({ type, label: type, items: byType[type] });
  });
  return ordered;
}

const getResultIcon = (type) => {
  switch (type) {
    case 'page': return FileText;
    case 'spreadsheet': return Table2;
    case 'accreditation': return Award;
    case 'vehicle': return Car;
    case 'doctor': return UserCircle;
    case 'service': return Briefcase;
    case 'analysis': return TestTube;
    default: return File;
  }
};

const renderSearchIcon = (iconValue, type, size = 16) => {
  if (iconValue && /[^\x00-\x7F]/.test(iconValue)) {
    return <span className="search-result-emoji" style={{ fontSize: `${size + 2}px` }}>{iconValue}</span>;
  }
  const IconComponent = getResultIcon(type);
  return <IconComponent size={size} />;
};

const getTypeName = (type, displayType) => {
  if (displayType) return displayType;
  return GROUP_LABELS[type] || type;
};

function abbreviateName(name) {
  if (!name) return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const [last, first, middle] = parts;
  let result = last;
  if (first) result += ' ' + first[0].toUpperCase() + '.';
  if (middle) result += ' ' + middle[0].toUpperCase() + '.';
  return result;
}

const highlightText = (text, query) => {
  if (!text) return [{ text: '', highlight: false }];
  if (!query) return [{ text, highlight: false }];

  const parts = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let lastIndex = 0;
  let index = lowerText.indexOf(lowerQuery);

  if (index === -1) return [{ text, highlight: false }];

  while (index !== -1) {
    if (index > lastIndex) parts.push({ text: text.substring(lastIndex, index), highlight: false });
    parts.push({ text: text.substring(index, index + query.length), highlight: true });
    lastIndex = index + query.length;
    index = lowerText.indexOf(lowerQuery, lastIndex);
  }
  if (lastIndex < text.length) parts.push({ text: text.substring(lastIndex), highlight: false });
  return parts;
};

export default function Header({ sidebarOpen, onToggleSidebar }) {
  const { user, logout, isAdmin } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [totalResults, setTotalResults] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showDropdown, setShowDropdown] = useState(false);

  const searchRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowResults(false);
        setActiveIndex(-1);
      }
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search — 400ms
  useEffect(() => {
    if (searchQuery.length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const { data } = await searchApi.query(searchQuery);
        setSearchResults(data.results || []);
        setTotalResults(data.total || 0);
      } catch (error) {
        console.error('Search error:', error);
        setSearchResults([]);
        setTotalResults(0);
      } finally {
        setIsLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    setActiveIndex(-1);
    if (val.length >= 2) {
      setIsLoading(true);
      setShowResults(true);
    } else {
      setIsLoading(false);
      setSearchResults([]);
      setTotalResults(0);
      setShowResults(false);
    }
  };

  // Keyboard navigation
  const groups = groupResults(searchResults);
  const flatResults = groups.flatMap(g => g.items);

  const handleKeyDown = (e) => {
    if (!showResults) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => Math.min(prev + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && flatResults[activeIndex]) {
        handleResultClick(flatResults[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowResults(false);
      setActiveIndex(-1);
    }
  };

  const handleResultClick = (result) => {
    setShowResults(false);
    setSearchQuery('');
    setSearchResults([]);
    setActiveIndex(-1);
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

  const getUserRole = () => {
    if (user?.isAdmin) return 'Администратор';
    return user?.role?.name || 'Пользователь';
  };

  // Pre-compute flat offset for each group so we can map to activeIndex
  let flatOffset = 0;
  const groupsWithOffset = groups.map(group => {
    const start = flatOffset;
    flatOffset += group.items.length;
    return { ...group, flatStart: start };
  });

  const hiddenCount = totalResults > flatResults.length ? totalResults - flatResults.length : 0;

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
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
          />
          {showResults && (
            <div className="search-dropdown">
              {isLoading ? (
                // Skeleton loading
                [1, 2, 3].map(i => (
                  <div key={i} className="search-skeleton-item">
                    <div className="search-skeleton-icon skeleton-pulse" />
                    <div className="search-skeleton-content">
                      <div className="search-skeleton-title skeleton-pulse" />
                      <div className="search-skeleton-excerpt skeleton-pulse" />
                    </div>
                  </div>
                ))
              ) : groupsWithOffset.length > 0 ? (
                <>
                  {groupsWithOffset.map(group => (
                    <div key={group.type} className="search-group">
                      <div className="search-group-header">
                        <span className="search-group-label">{group.label}</span>
                        <span className="search-group-count">{group.items.length}</span>
                      </div>
                      {group.items.map((result, itemIdx) => {
                        const currentFlatIndex = group.flatStart + itemIdx;
                        const isActive = currentFlatIndex === activeIndex;

                        const renderResultContent = () => {
                          switch (result.type) {
                            case 'spreadsheet': return <SpreadsheetSearchResult result={result} searchQuery={searchQuery} />;
                            case 'vehicle': return <VehicleSearchResult result={result} searchQuery={searchQuery} />;
                            case 'accreditation': return <AccreditationSearchResult result={result} searchQuery={searchQuery} />;
                            case 'analysis': return <AnalysisSearchResult result={result} searchQuery={searchQuery} />;
                            case 'service': return <ServiceSearchResult result={result} searchQuery={searchQuery} />;
                            case 'doctor': return <DoctorSearchResult result={result} searchQuery={searchQuery} />;
                            default: return <DefaultSearchResult result={result} searchQuery={searchQuery} />;
                          }
                        };

                        return (
                          <div
                            key={`${result.type}-${result.id}-${currentFlatIndex}`}
                            className={`search-result${isActive ? ' search-result--active' : ''}`}
                            ref={isActive ? el => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                            onClick={() => handleResultClick(result)}
                            onMouseEnter={() => setActiveIndex(currentFlatIndex)}
                          >
                            <div className="search-result-icon">
                              {renderSearchIcon(result.icon, result.type, 16)}
                            </div>
                            <div className="search-result-content">
                              <div className="search-result-title">
                                {highlightText(result.title, searchQuery).map((part, i) => (
                                  part.highlight
                                    ? <mark key={i}>{part.text}</mark>
                                    : <span key={i}>{part.text}</span>
                                ))}
                              </div>
                              {renderResultContent()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {hiddenCount > 0 && (
                    <div className="search-more-results">
                      Ещё {hiddenCount} результатов — уточните запрос
                    </div>
                  )}
                </>
              ) : (
                <div className="search-no-results">Ничего не найдено</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="header-right">
        {user && <WhatsNewMenu />}
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
              <span className="header-username">{abbreviateName(user.displayName) || user.username}</span>
              <ChevronDown size={16} className="header-chevron" />
            </button>

            {showDropdown && (
              <div className="header-dropdown">
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
                {(isAdmin || user?.adminAccess?.journal) && (
                  <Link to="/admin/journal" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <FileText size={16} />
                    Журнал страниц
                  </Link>
                )}
                {isAdmin && (
                  <Link to="/admin/bots" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <Bot size={16} />
                    Боты
                  </Link>
                )}
                {(isAdmin || user?.adminAccess?.releaseNotes) && (
                  <Link to="/admin/release-notes" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <Newspaper size={16} />
                    Нововведения
                  </Link>
                )}
                {isAdmin && (
                  <Link to="/admin/referral-bonuses-access" className="header-dropdown-item" onClick={() => setShowDropdown(false)}>
                    <GitBranch size={16} />
                    Финансы: заработная плата
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
