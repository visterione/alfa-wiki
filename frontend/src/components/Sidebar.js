import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  // Общие
  Home, File, Folder, Star, Heart, Bell, Calendar, Mail, Phone, MapPin, Clock, Tag, Bookmark, Award,
  Settings, Database, Image, Shield, Layout, Users, Key, Layers, List, Grid, Hash, Filter,
  // Навигация
  ChevronRight, ChevronDown, ExternalLink,
  // Документы
  FileText, FilePlus, FileCheck, FileX, Files, Clipboard, ClipboardList, ClipboardCheck,
  BookOpen, Book, Newspaper, FileSpreadsheet, FileCode,
  // Коммуникации
  MessageCircle, MessageSquare, Send, Inbox, AtSign, PhoneCall, 
  Video, Mic, Volume2,
  // Медицина
  Activity, Stethoscope, Pill, Syringe, Thermometer, HeartPulse, Brain, Bone, Eye,
  Accessibility, Cross, Plus, Droplet, Droplets, TestTube, TestTubes,
  // Бизнес
  Briefcase, Building, Building2, Landmark, CreditCard, Wallet, Receipt, DollarSign,
  TrendingUp, BarChart, BarChart2, BarChart3, PieChart, LineChart,
  // Технологии
  Monitor, Laptop, Smartphone, Tablet, Cpu, HardDrive, Server, Wifi, Globe, Cloud, 
  Download, Upload, Link, Code, Terminal, QrCode,
  // Безопасность
  Lock, Unlock, ShieldCheck, ShieldAlert, Fingerprint, ScanFace, AlertTriangle, AlertCircle,
  // Люди
  User, UserPlus, UserCheck, UserCircle, Contact,
  // Время
  Timer, Hourglass, CalendarDays, CalendarCheck,
  // Природа
  Sun, Moon, Umbrella, Leaf,
  // Транспорт
  Car, Truck, Plane, Navigation,
  // Действия
  CheckCircle, XCircle, Pencil, Trash, Copy, Save, Share2, RefreshCw, Archive, Printer,
  // Интерфейс
  Type, Info, HelpCircle,
  // Разное
  Trophy, Medal, Target, Lightbulb, Zap, Sparkles, Flame, Gift, Package, Box, ShoppingCart,
  Coffee, ThumbsUp, Smile, Gauge, Compass, Map, Flag, Power,
  // Legacy support
  Percent, Speaker, Headphones, Camera, Rss, Search
} from 'lucide-react';
import { sidebar as sidebarApi, pages } from '../services/api';

// Расширенный маппинг иконок
const iconMap = {
  // Популярные
  'home': Home, 'file': File, 'file-text': FileText, 'folder': Folder,
  'users': Users, 'settings': Settings, 'star': Star, 'heart': Heart,
  'bookmark': Bookmark, 'bell': Bell, 'calendar': Calendar, 'clock': Clock,
  
  // Медицина
  'activity': Activity, 'stethoscope': Stethoscope, 'heart-pulse': HeartPulse,
  'pill': Pill, 'syringe': Syringe, 'thermometer': Thermometer, 'brain': Brain,
  'bone': Bone, 'eye': Eye, 'accessibility': Accessibility, 'cross': Cross,
  'droplet': Droplet, 'droplets': Droplets, 'test-tube': TestTube, 'test-tubes': TestTubes,
  
  // Документы
  'file-plus': FilePlus, 'file-check': FileCheck, 'file-x': FileX, 'files': Files,
  'clipboard': Clipboard, 'clipboard-list': ClipboardList, 'clipboard-check': ClipboardCheck,
  'book-open': BookOpen, 'book': Book, 'newspaper': Newspaper,
  'file-spreadsheet': FileSpreadsheet, 'file-code': FileCode,
  
  // Коммуникации
  'mail': Mail, 'phone': Phone, 'message-circle': MessageCircle, 'message-square': MessageSquare,
  'send': Send, 'inbox': Inbox, 'at-sign': AtSign,
  'phone-call': PhoneCall, 'video': Video, 'mic': Mic, 'volume-2': Volume2,
  
  // Люди
  'user': User, 'user-plus': UserPlus, 'user-check': UserCheck,
  'user-circle': UserCircle, 'contact': Contact,
  
  // Бизнес
  'briefcase': Briefcase, 'building': Building, 'building-2': Building2, 'landmark': Landmark,
  'credit-card': CreditCard, 'wallet': Wallet, 'receipt': Receipt, 'dollar-sign': DollarSign,
  'trending-up': TrendingUp, 'bar-chart': BarChart, 'bar-chart-2': BarChart2, 
  'bar-chart-3': BarChart3, 'pie-chart': PieChart, 'line-chart': LineChart,
  
  // Безопасность
  'shield': Shield, 'shield-check': ShieldCheck, 'shield-alert': ShieldAlert,
  'lock': Lock, 'unlock': Unlock, 'key': Key,
  'fingerprint': Fingerprint, 'scan-face': ScanFace, 'alert-triangle': AlertTriangle, 'alert-circle': AlertCircle,
  
  // Технологии
  'monitor': Monitor, 'laptop': Laptop, 'smartphone': Smartphone, 'tablet': Tablet,
  'cpu': Cpu, 'hard-drive': HardDrive, 'server': Server, 'database': Database,
  'wifi': Wifi, 'globe': Globe, 'cloud': Cloud, 'code': Code, 'terminal': Terminal, 'qr-code': QrCode,
  
  // Навигация
  'map-pin': MapPin, 'map': Map, 'compass': Compass,
  'navigation': Navigation, 'flag': Flag,
  
  // Действия
  'plus': Plus, 'check-circle': CheckCircle, 'x-circle': XCircle,
  'edit': Pencil, 'trash': Trash, 'copy': Copy, 'save': Save,
  'download': Download, 'upload': Upload, 'share': Share2, 'link': Link,
  'external-link': ExternalLink, 'refresh': RefreshCw, 'archive': Archive, 'printer': Printer,
  
  // Интерфейс
  'layout': Layout, 'grid': Grid, 'layers': Layers, 'list': List,
  'filter': Filter, 'tag': Tag, 'hash': Hash, 'image': Image,
  'camera': Camera, 'type': Type, 'info': Info, 'help-circle': HelpCircle, 'search': Search,
  
  // Время
  'timer': Timer, 'hourglass': Hourglass, 'calendar-days': CalendarDays, 'calendar-check': CalendarCheck,
  
  // Разное
  'award': Award, 'trophy': Trophy, 'medal': Medal, 'target': Target,
  'lightbulb': Lightbulb, 'zap': Zap, 'sparkles': Sparkles, 'flame': Flame,
  'gift': Gift, 'package': Package, 'box': Box, 'shopping-cart': ShoppingCart,
  'coffee': Coffee, 'sun': Sun, 'moon': Moon, 'thumbs-up': ThumbsUp,
  'smile': Smile, 'gauge': Gauge, 'rss': Rss, 'power': Power,
  'umbrella': Umbrella, 'leaf': Leaf, 'car': Car, 'truck': Truck, 'plane': Plane,
  'percent': Percent, 'speaker': Speaker, 'headphones': Headphones
};

function SidebarItemComponent({ item, level = 0 }) {
  const [expanded, setExpanded] = useState(item.isExpanded);
  const hasChildren = item.children && item.children.length > 0;
  const Icon = iconMap[item.icon] || FileText;
  const location = useLocation();

  if (item.type === 'divider') {
    return <div className="sidebar-divider">{item.title}</div>;
  }

  if (item.type === 'header') {
    return <div className="sidebar-divider">{item.title}</div>;
  }

  // Пропускаем элементы с неопубликованными страницами
  if (item.page && item.page.isPublished === false) {
    return null;
  }

  const url = item.type === 'link' 
    ? item.externalUrl 
    : item.page 
      ? `/page/${item.page.slug}` 
      : '#';

  const isActive = location.pathname === url;

  if (item.type === 'link') {
    return (
      <a 
        href={item.externalUrl} 
        target="_blank" 
        rel="noopener noreferrer"
        className="sidebar-item"
        style={{ paddingLeft: `${14 + level * 16}px` }}
      >
        <Icon className="sidebar-item-icon" size={18} />
        <span style={{ flex: 1 }}>{item.title}</span>
        <ExternalLink size={14} style={{ opacity: 0.5 }} />
      </a>
    );
  }

  if (hasChildren) {
    // Фильтруем дочерние элементы
    const filteredChildren = item.children.filter(child => 
      !child.page || child.page.isPublished !== false
    );

    // Если нет видимых детей, не показываем родителя
    if (filteredChildren.length === 0 && !item.page) {
      return null;
    }

    return (
      <div className="sidebar-section">
        <div 
          className="sidebar-section-header"
          onClick={() => setExpanded(!expanded)}
          style={{ paddingLeft: `${14 + level * 16}px` }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Icon className="sidebar-item-icon" size={18} />
            <span>{item.title}</span>
          </div>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
        {expanded && (
          <div className="sidebar-section-children">
            {filteredChildren.map(child => (
              <SidebarItemComponent key={child.id} item={child} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={url}
      className={`sidebar-item ${isActive ? 'active' : ''}`}
      style={{ paddingLeft: `${14 + level * 16}px` }}
    >
      <Icon className="sidebar-item-icon" size={18} />
      <span>{item.title}</span>
    </NavLink>
  );
}

export default function Sidebar({ open }) {
  const [items, setItems] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const location = useLocation();

  useEffect(() => {
    loadSidebar();
    loadFavorites();
  }, []);

  const loadSidebar = async () => {
    try {
      const { data } = await sidebarApi.list();
      setItems(data);
    } catch (error) {
      console.error('Failed to load sidebar:', error);
    }
  };

  const loadFavorites = async () => {
    try {
      const { data } = await pages.list({ limit: 50 });
      const favs = (data.rows || []).filter(p => p.isFavorite);
      setFavorites(favs);
    } catch (error) {
      console.error('Failed to load favorites:', error);
    }
  };

  return (
    <aside className={`sidebar ${open ? '' : 'closed'}`}>
      <div className="sidebar-content">
        {favorites.length > 0 && (
          <>
            <div className="sidebar-divider">Избранное</div>
            {favorites.map(page => (
              <NavLink
                key={page.id}
                to={`/page/${page.slug}`}
                className={`sidebar-item ${location.pathname === `/page/${page.slug}` ? 'active' : ''}`}
              >
                <Star className="sidebar-item-icon" size={18} style={{ color: 'var(--warning)' }} />
                <span>{page.title}</span>
              </NavLink>
            ))}
          </>
        )}

        {items.length > 0 && (
          <>
            {favorites.length > 0 && <div className="sidebar-divider">Навигация</div>}
            {items.map(item => (
              <SidebarItemComponent key={item.id} item={item} />
            ))}
          </>
        )}

        {items.length === 0 && favorites.length === 0 && (
          <div className="sidebar-empty">
            <p>Меню пусто</p>
          </div>
        )}
      </div>
    </aside>
  );
}