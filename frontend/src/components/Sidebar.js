import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  Home, FileText, ChevronRight, ChevronDown, ExternalLink, Folder, File, Star, Heart,
  Bell, Calendar, Mail, Phone, MapPin, Clock, Search, Tag, Bookmark, Award, Users, Settings,
  Database, Image, Shield, Layout, Briefcase, Building, Camera, Coffee, Globe, Headphones, 
  Key, Layers, List, MessageCircle, Monitor, Package, Percent, PieChart, Printer, Server, 
  ShoppingCart, Smartphone, Speaker, Target, ThumbsUp, Truck, Umbrella, Video, Wifi, Zap
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { sidebar as sidebarApi, pages } from '../services/api';

const iconMap = {
  home: Home, file: File, 'file-text': FileText, folder: Folder, users: Users,
  settings: Settings, database: Database, image: Image, shield: Shield, layout: Layout,
  star: Star, heart: Heart, bell: Bell, calendar: Calendar, mail: Mail, phone: Phone,
  'map-pin': MapPin, clock: Clock, search: Search, tag: Tag, bookmark: Bookmark, award: Award,
  briefcase: Briefcase, building: Building, camera: Camera, coffee: Coffee, globe: Globe,
  headphones: Headphones, key: Key, layers: Layers, list: List, 'message-circle': MessageCircle,
  monitor: Monitor, package: Package, percent: Percent, 'pie-chart': PieChart, printer: Printer,
  server: Server, 'shopping-cart': ShoppingCart, smartphone: Smartphone, speaker: Speaker,
  target: Target, 'thumbs-up': ThumbsUp, truck: Truck, umbrella: Umbrella, video: Video,
  wifi: Wifi, zap: Zap
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
            {item.children.map(child => (
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
        <NavLink
          to="/"
          className={`sidebar-item ${location.pathname === '/' ? 'active' : ''}`}
        >
          <Home className="sidebar-item-icon" size={18} />
          <span>Главная</span>
        </NavLink>

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
      </div>
    </aside>
  );
}