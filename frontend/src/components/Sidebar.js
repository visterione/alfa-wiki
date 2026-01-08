import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, ChevronLeft, ExternalLink,
  Home, File, FileText, Folder, FolderOpen, Users, Settings, Star, Heart, Bell, Calendar, Mail, Phone, MapPin, Clock, Tag, Bookmark, Award,
  Database, Image, Shield, Layout, Key, Layers, List, Grid, Hash, Filter,
  RefreshCw, Archive, Printer, Plus,
  Type, Info, HelpCircle,
  Trophy, Medal, Target, Lightbulb, Zap, Sparkles, Flame, Gift, Package, Box, ShoppingCart,
  Coffee, ThumbsUp, Smile, Gauge, Compass, Map, Flag, Power,
  Percent, Speaker, Headphones, Camera, Rss, Search,
  Activity, Stethoscope, Pill, Syringe, Thermometer, HeartPulse, Brain, Bone, Eye,
  Accessibility, Cross, Droplet, Droplets, TestTube, TestTubes,
  FilePlus, FileCheck, FileX, Files, Clipboard, ClipboardList, ClipboardCheck,
  BookOpen, Book, Newspaper, FileSpreadsheet, FileCode,
  MessageCircle, MessageSquare, Send, Inbox, AtSign, PhoneCall, Video, Mic, Volume2,
  Briefcase, Building, Building2, Landmark, CreditCard, Wallet, Receipt, DollarSign,
  TrendingUp, BarChart, BarChart2, BarChart3, PieChart, LineChart,
  Monitor, Laptop, Smartphone, Tablet, Cpu, HardDrive, Server, Wifi, Globe, Cloud,
  Download, Upload, Link, Code, Terminal, QrCode,
  Lock, Unlock, ShieldCheck, ShieldAlert, Fingerprint, ScanFace, AlertTriangle, AlertCircle,
  User, UserPlus, UserCheck, UserCircle, Contact,
  Timer, Hourglass, CalendarDays, CalendarCheck,
  Sun, Moon, Umbrella, Leaf, Car, Truck, Plane, Navigation, CheckCircle, XCircle, Pencil, Trash, Copy, Save, Share2,
  Minus, GraduationCap, Map as MapIcon
} from 'lucide-react';
import { sidebar as sidebarApi, chat } from '../services/api';
import { useAuth } from '../context/AuthContext';

// Маппинг иконок
const iconMap = {
  'home': Home, 'file': File, 'file-text': FileText, 'folder': Folder,
  'users': Users, 'settings': Settings, 'star': Star, 'heart': Heart, 'bell': Bell,
  'calendar': Calendar, 'mail': Mail, 'phone': Phone, 'map-pin': MapPin, 'clock': Clock,
  'tag': Tag, 'bookmark': Bookmark, 'award': Award,
  'database': Database, 'image': Image, 'shield': Shield, 'layout': Layout,
  'key': Key, 'layers': Layers, 'list': List, 'grid': Grid, 'hash': Hash, 'filter': Filter,
  'file-plus': FilePlus, 'file-check': FileCheck, 'file-x': FileX, 'files': Files,
  'clipboard': Clipboard, 'clipboard-list': ClipboardList, 'clipboard-check': ClipboardCheck,
  'book-open': BookOpen, 'book': Book, 'newspaper': Newspaper,
  'file-spreadsheet': FileSpreadsheet, 'file-code': FileCode,
  'message-circle': MessageCircle, 'message-square': MessageSquare,
  'send': Send, 'inbox': Inbox, 'at-sign': AtSign, 'phone-call': PhoneCall,
  'video': Video, 'mic': Mic, 'volume-2': Volume2,
  'activity': Activity, 'stethoscope': Stethoscope, 'pill': Pill, 'syringe': Syringe,
  'thermometer': Thermometer, 'heart-pulse': HeartPulse, 'brain': Brain, 'bone': Bone, 'eye': Eye,
  'accessibility': Accessibility, 'cross': Cross, 'droplet': Droplet, 'droplets': Droplets,
  'test-tube': TestTube, 'test-tubes': TestTubes,
  'briefcase': Briefcase, 'building': Building, 'building-2': Building2, 'landmark': Landmark,
  'credit-card': CreditCard, 'wallet': Wallet, 'receipt': Receipt, 'dollar-sign': DollarSign,
  'trending-up': TrendingUp, 'bar-chart': BarChart, 'bar-chart-2': BarChart2,
  'bar-chart-3': BarChart3, 'pie-chart': PieChart, 'line-chart': LineChart,
  'monitor': Monitor, 'laptop': Laptop, 'smartphone': Smartphone, 'tablet': Tablet,
  'cpu': Cpu, 'hard-drive': HardDrive, 'server': Server, 'database': Database,
  'wifi': Wifi, 'globe': Globe, 'cloud': Cloud, 'code': Code, 'terminal': Terminal, 'qr-code': QrCode,
  'map-pin': MapPin, 'map': Map, 'compass': Compass, 'navigation': Navigation, 'flag': Flag,
  'plus': Plus, 'check-circle': CheckCircle, 'x-circle': XCircle, 'pencil': Pencil, 'trash': Trash, 'copy': Copy, 'save': Save,
  'download': Download, 'upload': Upload, 'link': Link, 'external-link': ExternalLink,
  'share': Share2, 'refresh': RefreshCw, 'archive': Archive, 'printer': Printer,
  'lock': Lock, 'unlock': Unlock, 'shield-check': ShieldCheck, 'shield-alert': ShieldAlert,
  'fingerprint': Fingerprint, 'scan-face': ScanFace, 'alert-triangle': AlertTriangle, 'alert-circle': AlertCircle,
  'user': User, 'user-plus': UserPlus, 'user-check': UserCheck, 'user-circle': UserCircle, 'contact': Contact,
  'timer': Timer, 'hourglass': Hourglass, 'calendar-days': CalendarDays, 'calendar-check': CalendarCheck,
  'sun': Sun, 'moon': Moon, 'umbrella': Umbrella, 'leaf': Leaf,
  'car': Car, 'truck': Truck, 'plane': Plane,
  'type': Type, 'info': Info, 'help-circle': HelpCircle, 'search': Search,
  'trophy': Trophy, 'medal': Medal, 'target': Target, 'lightbulb': Lightbulb,
  'zap': Zap, 'sparkles': Sparkles, 'flame': Flame, 'gift': Gift,
  'package': Package, 'box': Box, 'shopping-cart': ShoppingCart,
  'coffee': Coffee, 'thumbs-up': ThumbsUp, 'smile': Smile, 'gauge': Gauge,
  'power': Power, 'percent': Percent, 'speaker': Speaker, 'headphones': Headphones, 'camera': Camera, 'rss': Rss
};

// Компонент календаря
const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function SidebarCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstDayOfWeek = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const daysInMonth = lastDay.getDate();
    const days = [];

    // Дни предыдущего месяца
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null);
    }
    
    // Дни текущего месяца
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    
    // Дни следующего месяца для заполнения недель
    const remainingCells = 7 - (days.length % 7);
    if (remainingCells < 7) {
      for (let i = 1; i <= remainingCells; i++) {
        days.push(new Date(year, month + 1, i));
      }
    }
    
    return days;
  };

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const isToday = (date) => {
    if (!date) return false;
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  };

  const isSelected = (date) => {
    if (!date) return false;
    return date.getDate() === selectedDate.getDate() &&
           date.getMonth() === selectedDate.getMonth() &&
           date.getFullYear() === selectedDate.getFullYear();
  };

  const isOtherMonth = (date) => {
    if (!date) return false;
    return date.getMonth() !== currentDate.getMonth();
  };

  const days = getDaysInMonth(currentDate);

  return (
    <div className="sidebar-calendar">
      <div className="sidebar-calendar-header">
        <button className="sidebar-calendar-nav" onClick={goToPreviousMonth} title="Предыдущий месяц">
          <ChevronLeft size={16} />
        </button>
        <div className="sidebar-calendar-title">
          {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
        </div>
        <button className="sidebar-calendar-nav" onClick={goToNextMonth} title="Следующий месяц">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="sidebar-calendar-grid">
        {weekDays.map((day, index) => (
          <div 
            key={day} 
            className={`sidebar-calendar-weekday ${index >= 5 ? 'weekend' : ''}`}
          >
            {day}
          </div>
        ))}
        {days.map((date, index) => {
          const isWeekend = date && (date.getDay() === 0 || date.getDay() === 6);
          const otherMonth = isOtherMonth(date);
          return (
            <div 
              key={index}
              className={`sidebar-calendar-day ${!date ? 'empty' : ''} ${isToday(date) ? 'today' : ''} ${isSelected(date) ? 'selected' : ''} ${isWeekend ? 'weekend' : ''} ${otherMonth ? 'other-month' : ''}`}
              onClick={() => date && !otherMonth && setSelectedDate(date)}
            >
              {date ? date.getDate() : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Компонент кнопок быстрого доступа
function QuickAccessButtons({ onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, hasPermission } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  // Загружаем количество непрочитанных сообщений
  useEffect(() => {
    loadUnreadCount();
    const interval = setInterval(loadUnreadCount, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadUnreadCount = async () => {
    try {
      const { data } = await chat.getUnreadCount();
      setUnreadCount(data.unreadCount || 0);
    } catch (error) {
      console.error('Failed to load unread count:', error);
    }
  };

  const isOnChat = location.pathname === '/';
  const isOnFavorites = location.pathname === '/favorites';
  const isOnAdminPages = location.pathname === '/admin/pages';
  const isOnCourses = location.pathname.startsWith('/courses');
  const isOnMap = location.pathname.startsWith('/map');
  const isOnDoctors = location.pathname.startsWith('/doctors');

  const handleClick = (path) => {
    navigate(path);
    if (window.innerWidth <= 768) {
      onClose();
    }
  };

  return (
    <div className="sidebar-quick-access">
      {/* Первый ряд */}
      <button 
        className={`quick-access-btn messages ${isOnChat ? 'active' : ''}`}
        onClick={() => handleClick('/')}
        title="Сообщения"
      >
        <MessageCircle size={20} />
        {unreadCount > 0 && (
          <span className="quick-access-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <button 
        className={`quick-access-btn favorites ${isOnFavorites ? 'active' : ''}`}
        onClick={() => handleClick('/favorites')}
        title="Избранное"
      >
        <Star size={20} />
      </button>

      <button 
        className={`quick-access-btn explorer ${isOnAdminPages ? 'active' : ''}`}
        onClick={() => handleClick('/admin/pages')}
        title="Проводник"
      >
        <Folder size={20} />
      </button>

      {/* Второй ряд */}
      <button 
        className={`quick-access-btn courses ${isOnCourses ? 'active' : ''}`}
        onClick={() => handleClick('/courses')}
        title="Курсы и обучение"
      >
        <GraduationCap size={20} />
      </button>

      <button 
        className={`quick-access-btn map ${isOnMap ? 'active' : ''}`}
        onClick={() => handleClick('/map')}
        title="Карта"
      >
        <MapIcon size={20} />
      </button>

      <button 
        className={`quick-access-btn doctors ${isOnDoctors ? 'active' : ''}`}
        onClick={() => handleClick('/doctors')}
        title="Врачи"
      >
        <Stethoscope size={20} />
      </button>
    </div>
  );
}

// Ключ для localStorage
const SIDEBAR_EXPANDED_KEY = 'alfa-wiki-sidebar-expanded';

// Загрузка состояния раскрытия из localStorage
const loadExpandedState = () => {
  try {
    const saved = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
};

// Сохранение состояния раскрытия в localStorage
const saveExpandedState = (state) => {
  try {
    localStorage.setItem(SIDEBAR_EXPANDED_KEY, JSON.stringify(state));
  } catch {
    // Ignore localStorage errors
  }
};

// Компонент элемента сайдбара
function SidebarItemComponent({ item, level = 0, onClose, expandedState, onToggleExpand }) {
  const location = useLocation();
  const Icon = iconMap[item.icon] || FileText;
  
  const isExpanded = expandedState[item.id] ?? true;

  const handleToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleExpand(item.id);
  };

  const handleMobileClick = () => {
    if (window.innerWidth <= 768) {
      onClose();
    }
  };

  // Folder
  if (item.type === 'folder') {
    const FolderIcon = isExpanded ? FolderOpen : Folder;
    const DisplayIcon = item.icon && iconMap[item.icon] ? iconMap[item.icon] : 
                        (item.folder?.icon && iconMap[item.folder.icon] ? iconMap[item.folder.icon] : FolderIcon);
    
    // Страницы из папки проводника
    const folderPages = item.folderPages || item.folder?.pages || [];
    const hasFolderPages = folderPages.length > 0;
    
    // Вложенные элементы sidebar
    const hasChildren = item.children && item.children.length > 0;
    
    // Проверяем есть ли активная страница внутри папки
    const hasActiveFolderPage = folderPages.some(p => 
      location.pathname === `/page/${p.slug}`
    );
    
    const folderTitle = item.title || item.folder?.title || 'Папка';
    
    return (
      <div className="sidebar-folder">
        <div 
          className={`sidebar-item sidebar-folder-toggle ${hasActiveFolderPage ? 'has-active-child' : ''}`}
          style={{ paddingLeft: `${14 + level * 16}px` }}
          onClick={handleToggle}
        >
          <DisplayIcon className="sidebar-item-icon" size={18} />
          <span>{folderTitle}</span>
          <span className="sidebar-folder-chevron">
            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
        </div>
        
        {isExpanded && hasFolderPages && (
          <div className="sidebar-folder-children">
            {folderPages.map(page => {
              const PageIcon = page.icon && iconMap[page.icon] ? iconMap[page.icon] : FileText;
              const isPageActive = location.pathname === `/page/${page.slug}`;
              
              return (
                <NavLink
                  key={page.id}
                  to={`/page/${page.slug}`}
                  className={`sidebar-item ${isPageActive ? 'active' : ''}`}
                  style={{ paddingLeft: `${14 + (level + 1) * 16}px` }}
                  onClick={handleMobileClick}
                >
                  <PageIcon className="sidebar-item-icon" size={18} />
                  <span>{page.title}</span>
                </NavLink>
              );
            })}
          </div>
        )}
        
        {/* Также показываем вложенные SidebarItem если есть */}
        {isExpanded && hasChildren && (
          <div className="sidebar-folder-children">
            {item.children
              .filter(c => c.type === 'divider' || c.page || c.type === 'link')
              .map(child => (
                <SidebarItemComponent 
                  key={child.id} 
                  item={child} 
                  level={level + 1} 
                  onClose={onClose}
                  expandedState={expandedState}
                  onToggleExpand={onToggleExpand}
                />
              ))}
          </div>
        )}
      </div>
    );
  }

  // Divider
  if (item.type === 'divider') {
    return <div className="sidebar-divider" style={{ marginLeft: `${14 + level * 16}px` }} />;
  }

  // Page
  if (item.type === 'page') {
    // Получаем данные страницы
    const pageSlug = item.page?.slug;
    const pageTitle = item.title || item.page?.title || 'Без названия';
    const pageIcon = item.icon || item.page?.icon;
    
    // Если нет slug - не отображаем элемент
    if (!pageSlug) {
      console.warn('Sidebar page item without slug:', item);
      return null;
    }
    
    const Icon = pageIcon && iconMap[pageIcon] ? iconMap[pageIcon] : FileText;
    const pageUrl = `/page/${pageSlug}`;
    
    return (
      <NavLink
        to={pageUrl}
        className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${14 + level * 16}px` }}
        onClick={handleMobileClick}
      >
        <Icon className="sidebar-item-icon" size={18} />
        <span>{pageTitle}</span>
      </NavLink>
    );
  }

  // Link
  if (item.type === 'link') {
    const linkTitle = item.title || 'Ссылка';
    const linkUrl = item.externalUrl || '#';
    const Icon = item.icon && iconMap[item.icon] ? iconMap[item.icon] : ExternalLink;
    
    return (
      <a
        href={linkUrl}
        target={item.openInNewTab ? '_blank' : undefined}
        rel={item.openInNewTab ? 'noopener noreferrer' : undefined}
        className="sidebar-item"
        style={{ paddingLeft: `${14 + level * 16}px` }}
        onClick={handleMobileClick}
      >
        <Icon className="sidebar-item-icon" size={18} />
        <span>{linkTitle}</span>
        {item.openInNewTab && <ExternalLink className="sidebar-item-external" size={14} />}
      </a>
    );
  }

  // Fallback для неизвестных типов
  return null;
}

export default function Sidebar({ open, onClose }) {
  const [items, setItems] = useState([]);
  const [expandedState, setExpandedState] = useState(loadExpandedState);

  useEffect(() => {
    loadSidebar();
  }, []);

  const loadSidebar = async () => {
    try {
      const { data } = await sidebarApi.list();
      setItems(data);
    } catch (error) {
      console.error('Failed to load sidebar:', error);
    }
  };

  // Переключение раскрытия папки
  const handleToggleExpand = useCallback((itemId) => {
    setExpandedState(prev => {
      const newState = {
        ...prev,
        [itemId]: !(prev[itemId] ?? true) // Инвертируем, по умолчанию true
      };
      saveExpandedState(newState);
      return newState;
    });
  }, []);

  return (
    <aside className={`sidebar ${open ? 'open' : 'closed'}`}>
      {/* Календарь с фиксированной позицией */}
      <div className="sidebar-calendar-wrapper">
        <SidebarCalendar />
        <QuickAccessButtons onClose={onClose} />
      </div>
      
      {/* Прокручиваемый контент навигации */}
      <div className="sidebar-content">
        {items.length > 0 ? (
          items.map(item => (
            <SidebarItemComponent 
              key={item.id} 
              item={item} 
              onClose={onClose}
              expandedState={expandedState}
              onToggleExpand={handleToggleExpand}
            />
          ))
        ) : (
          <div className="sidebar-empty">
            <p>Меню пусто</p>
          </div>
        )}
      </div>
    </aside>
  );
}