import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, ChevronLeft, Plus, ExternalLink,
  Home, File, FileText, Folder, Users, Settings, Star, Heart, Bell, Calendar, Mail, Phone, MapPin, Clock, Tag, Bookmark, Award,
  Database, Image, Shield, Layout, Key, Layers, List, Grid, Hash, Filter,
  RefreshCw, Archive, Printer,
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
  Sun, Moon, Umbrella, Leaf, Car, Truck, Plane, Navigation, CheckCircle, XCircle, Pencil, Trash, Copy, Save, Share2
} from 'lucide-react';
import { sidebar as sidebarApi } from '../services/api';

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
  'plus': Plus, 'check-circle': CheckCircle, 'x-circle': XCircle,
  'edit': Pencil, 'trash': Trash, 'copy': Copy, 'save': Save,
  'download': Download, 'upload': Upload, 'share': Share2, 'link': Link,
  'external-link': ExternalLink, 'refresh': RefreshCw, 'archive': Archive, 'printer': Printer,
  'layout': Layout, 'grid': Grid, 'layers': Layers, 'list': List, 'filter': Filter,
  'tag': Tag, 'hash': Hash, 'image': Image, 'camera': Camera, 'type': Type,
  'info': Info, 'help-circle': HelpCircle, 'search': Search,
  'trophy': Trophy, 'medal': Medal, 'award': Award, 'target': Target, 'lightbulb': Lightbulb,
  'zap': Zap, 'sparkles': Sparkles, 'flame': Flame, 'gift': Gift, 'package': Package,
  'box': Box, 'shopping-cart': ShoppingCart, 'coffee': Coffee, 'thumbs-up': ThumbsUp, 'smile': Smile,
  'gauge': Gauge, 'sun': Sun, 'moon': Moon, 'power': Power, 'percent': Percent,
  'speaker': Speaker, 'headphones': Headphones, 'rss': Rss,
  'timer': Timer, 'hourglass': Hourglass, 'calendar-days': CalendarDays, 'calendar-check': CalendarCheck,
  'umbrella': Umbrella, 'leaf': Leaf, 'car': Car, 'truck': Truck, 'plane': Plane
};

// Компонент календаря
function SidebarCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const monthNames = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    
    // Получаем день недели первого дня месяца (0 - воскресенье, 1 - понедельник...)
    let firstDayOfWeek = firstDay.getDay();
    // Преобразуем в формат 0 - понедельник, 6 - воскресенье
    firstDayOfWeek = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
    
    const daysInMonth = lastDay.getDate();
    const days = [];

    // Добавляем пустые ячейки для дней предыдущего месяца
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null);
    }

    // Добавляем дни текущего месяца
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
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

  const days = getDaysInMonth(currentDate);

  return (
    <div className="sidebar-calendar">
      <div className="sidebar-calendar-header">
        <button 
          className="sidebar-calendar-nav" 
          onClick={goToPreviousMonth}
          title="Предыдущий месяц"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="sidebar-calendar-title">
          {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
        </div>
        <button 
          className="sidebar-calendar-nav" 
          onClick={goToNextMonth}
          title="Следующий месяц"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      
      <div className="sidebar-calendar-grid">
        {weekDays.map(day => (
          <div key={day} className="sidebar-calendar-weekday">
            {day}
          </div>
        ))}
        
        {days.map((date, index) => (
          <div 
            key={index}
            className={`sidebar-calendar-day ${!date ? 'empty' : ''} ${isToday(date) ? 'today' : ''} ${isSelected(date) ? 'selected' : ''}`}
            onClick={() => date && setSelectedDate(date)}
          >
            {date ? date.getDate() : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

function SidebarItemComponent({ item, level = 0, onClose }) {
  const location = useLocation();
  const [expanded, setExpanded] = useState(item.isExpanded);
  const Icon = iconMap[item.icon] || FileText;

  // Функция для закрытия на мобильных
  const handleClick = () => {
    if (window.innerWidth <= 768 && onClose) {
      onClose();
    }
  };

  if (item.type === 'divider') {
    return <div className="sidebar-divider">{item.title}</div>;
  }

  const url = item.type === 'link' 
    ? item.externalUrl 
    : item.page ? `/page/${item.page.slug}` : '#';
  
  const isActive = item.page && location.pathname === `/page/${item.page.slug}`;
  const hasChildren = item.children && item.children.length > 0;

  const filteredChildren = hasChildren 
    ? item.children.filter(c => c.type === 'divider' || c.page) 
    : [];

  if (hasChildren && filteredChildren.length > 0) {
    return (
      <div className="sidebar-group">
        <div 
          className={`sidebar-item ${isActive ? 'active' : ''}`}
          style={{ paddingLeft: `${14 + level * 16}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <Icon className="sidebar-item-icon" size={18} />
          <span>{item.title}</span>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
        {expanded && (
          <div className="sidebar-section-children">
            {filteredChildren.map(child => (
              <SidebarItemComponent key={child.id} item={child} level={level + 1} onClose={onClose} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (item.type === 'link') {
    return (
      <a
        href={url}
        className="sidebar-item"
        style={{ paddingLeft: `${14 + level * 16}px` }}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
      >
        <Icon className="sidebar-item-icon" size={18} />
        <span>{item.title}</span>
        <ExternalLink size={14} className="sidebar-external" />
      </a>
    );
  }

  return (
    <NavLink
      to={url}
      className={`sidebar-item ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: `${14 + level * 16}px` }}
      onClick={handleClick}
    >
      <Icon className="sidebar-item-icon" size={18} />
      <span>{item.title}</span>
    </NavLink>
  );
}

export default function Sidebar({ open, onClose }) {
  const [items, setItems] = useState([]);

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

  return (
    <aside className={`sidebar ${open ? 'open' : 'closed'}`}>
      {/* Календарь с фиксированной позицией */}
      <div className="sidebar-calendar-wrapper">
        <SidebarCalendar />
      </div>
      
      {/* Прокручиваемый контент навигации */}
      <div className="sidebar-content">
        {items.length > 0 ? (
          items.map(item => (
            <SidebarItemComponent key={item.id} item={item} onClose={onClose} />
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