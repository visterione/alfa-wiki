import React, { useState, useEffect, useRef, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, Edit, Trash2, GripVertical, FileText, Link as LinkIcon, Minus, ChevronDown, X, Search as SearchIcon,
  // Общие
  Home, File, Folder, Star, Heart, Bell, Calendar, Mail, Phone, MapPin, Clock, Tag, Bookmark, Award,
  Settings, Database, Image, Shield, Layout, Users, Key, Layers, List, Grid, Hash, Filter,
  // Навигация  
  ChevronRight, ExternalLink, RefreshCw,
  // Документы
  FilePlus, FileCheck, FileX, Files, Clipboard, ClipboardList, ClipboardCheck,
  BookOpen, Book, Newspaper, FileSpreadsheet, FileCode,
  // Коммуникации
  MessageCircle, MessageSquare, Send, Inbox, AtSign, PhoneCall, Video, Mic, Volume2,
  // Медицина
  Activity, Stethoscope, Pill, Syringe, Thermometer, HeartPulse, Brain, Bone, Eye,
  Accessibility, Cross, Droplet, Droplets, TestTube, TestTubes,
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
  CheckCircle, XCircle, Pencil, Trash, Copy, Save, Share2, Archive, Printer,
  // Интерфейс
  Type, Info, HelpCircle, Search,
  // Разное
  Trophy, Medal, Target, Lightbulb, Zap, Sparkles, Flame, Gift, Package, Box, ShoppingCart,
  Coffee, ThumbsUp, Smile, Gauge, Compass, Map, Flag, Power, Percent, Speaker, Headphones, Camera, Rss
} from 'lucide-react';
import { sidebar, pages, roles } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

// Организованный список иконок по категориям
const iconCategories = [
  {
    name: 'Популярные',
    icons: [
      { name: 'home', icon: Home, label: 'Дом' },
      { name: 'file', icon: File, label: 'Файл' },
      { name: 'file-text', icon: FileText, label: 'Документ' },
      { name: 'folder', icon: Folder, label: 'Папка' },
      { name: 'users', icon: Users, label: 'Пользователи' },
      { name: 'settings', icon: Settings, label: 'Настройки' },
      { name: 'star', icon: Star, label: 'Звезда' },
      { name: 'heart', icon: Heart, label: 'Сердце' },
      { name: 'bookmark', icon: Bookmark, label: 'Закладка' },
      { name: 'bell', icon: Bell, label: 'Уведомление' },
      { name: 'calendar', icon: Calendar, label: 'Календарь' },
      { name: 'clock', icon: Clock, label: 'Время' },
    ]
  },
  {
    name: 'Медицина',
    icons: [
      { name: 'activity', icon: Activity, label: 'Активность' },
      { name: 'stethoscope', icon: Stethoscope, label: 'Стетоскоп' },
      { name: 'heart-pulse', icon: HeartPulse, label: 'Пульс' },
      { name: 'pill', icon: Pill, label: 'Таблетка' },
      { name: 'syringe', icon: Syringe, label: 'Шприц' },
      { name: 'thermometer', icon: Thermometer, label: 'Термометр' },
      { name: 'brain', icon: Brain, label: 'Мозг' },
      { name: 'bone', icon: Bone, label: 'Кость' },
      { name: 'eye', icon: Eye, label: 'Глаз' },
      { name: 'accessibility', icon: Accessibility, label: 'Доступность' },
      { name: 'cross', icon: Cross, label: 'Крест' },
      { name: 'droplet', icon: Droplet, label: 'Капля' },
      { name: 'droplets', icon: Droplets, label: 'Капли' },
      { name: 'test-tube', icon: TestTube, label: 'Пробирка' },
      { name: 'test-tubes', icon: TestTubes, label: 'Пробирки' },
    ]
  },
  {
    name: 'Документы',
    icons: [
      { name: 'file-plus', icon: FilePlus, label: 'Новый файл' },
      { name: 'file-check', icon: FileCheck, label: 'Файл ок' },
      { name: 'file-x', icon: FileX, label: 'Файл х' },
      { name: 'files', icon: Files, label: 'Файлы' },
      { name: 'clipboard', icon: Clipboard, label: 'Буфер' },
      { name: 'clipboard-list', icon: ClipboardList, label: 'Список задач' },
      { name: 'clipboard-check', icon: ClipboardCheck, label: 'Чек-лист' },
      { name: 'book-open', icon: BookOpen, label: 'Книга' },
      { name: 'book', icon: Book, label: 'Книга закр.' },
      { name: 'newspaper', icon: Newspaper, label: 'Новости' },
      { name: 'file-spreadsheet', icon: FileSpreadsheet, label: 'Таблица' },
      { name: 'file-code', icon: FileCode, label: 'Код' },
    ]
  },
  {
    name: 'Коммуникации',
    icons: [
      { name: 'mail', icon: Mail, label: 'Почта' },
      { name: 'phone', icon: Phone, label: 'Телефон' },
      { name: 'message-circle', icon: MessageCircle, label: 'Сообщение' },
      { name: 'message-square', icon: MessageSquare, label: 'Чат' },
      { name: 'send', icon: Send, label: 'Отправить' },
      { name: 'inbox', icon: Inbox, label: 'Входящие' },
      { name: 'at-sign', icon: AtSign, label: 'Email' },
      { name: 'phone-call', icon: PhoneCall, label: 'Звонок' },
      { name: 'video', icon: Video, label: 'Видео' },
      { name: 'mic', icon: Mic, label: 'Микрофон' },
      { name: 'volume-2', icon: Volume2, label: 'Громкость' },
    ]
  },
  {
    name: 'Люди',
    icons: [
      { name: 'user', icon: User, label: 'Пользователь' },
      { name: 'user-plus', icon: UserPlus, label: 'Добавить' },
      { name: 'user-check', icon: UserCheck, label: 'Проверен' },
      { name: 'user-circle', icon: UserCircle, label: 'Аватар' },
      { name: 'contact', icon: Contact, label: 'Контакт' },
    ]
  },
  {
    name: 'Бизнес',
    icons: [
      { name: 'briefcase', icon: Briefcase, label: 'Портфель' },
      { name: 'building', icon: Building, label: 'Здание' },
      { name: 'building-2', icon: Building2, label: 'Офис' },
      { name: 'landmark', icon: Landmark, label: 'Банк' },
      { name: 'credit-card', icon: CreditCard, label: 'Карта' },
      { name: 'wallet', icon: Wallet, label: 'Кошелек' },
      { name: 'receipt', icon: Receipt, label: 'Чек' },
      { name: 'dollar-sign', icon: DollarSign, label: 'Доллар' },
      { name: 'trending-up', icon: TrendingUp, label: 'Рост' },
      { name: 'bar-chart', icon: BarChart, label: 'Диаграмма' },
      { name: 'pie-chart', icon: PieChart, label: 'Круговая' },
      { name: 'line-chart', icon: LineChart, label: 'График' },
    ]
  },
  {
    name: 'Безопасность',
    icons: [
      { name: 'shield', icon: Shield, label: 'Щит' },
      { name: 'shield-check', icon: ShieldCheck, label: 'Защищено' },
      { name: 'shield-alert', icon: ShieldAlert, label: 'Внимание' },
      { name: 'lock', icon: Lock, label: 'Замок' },
      { name: 'unlock', icon: Unlock, label: 'Открыто' },
      { name: 'key', icon: Key, label: 'Ключ' },
      { name: 'fingerprint', icon: Fingerprint, label: 'Отпечаток' },
      { name: 'scan-face', icon: ScanFace, label: 'FaceID' },
      { name: 'alert-triangle', icon: AlertTriangle, label: 'Предупр.' },
      { name: 'alert-circle', icon: AlertCircle, label: 'Ошибка' },
    ]
  },
  {
    name: 'Технологии',
    icons: [
      { name: 'monitor', icon: Monitor, label: 'Монитор' },
      { name: 'laptop', icon: Laptop, label: 'Ноутбук' },
      { name: 'smartphone', icon: Smartphone, label: 'Телефон' },
      { name: 'tablet', icon: Tablet, label: 'Планшет' },
      { name: 'cpu', icon: Cpu, label: 'Процессор' },
      { name: 'hard-drive', icon: HardDrive, label: 'Диск' },
      { name: 'server', icon: Server, label: 'Сервер' },
      { name: 'database', icon: Database, label: 'База данных' },
      { name: 'wifi', icon: Wifi, label: 'WiFi' },
      { name: 'globe', icon: Globe, label: 'Интернет' },
      { name: 'cloud', icon: Cloud, label: 'Облако' },
      { name: 'code', icon: Code, label: 'Код' },
      { name: 'terminal', icon: Terminal, label: 'Терминал' },
      { name: 'qr-code', icon: QrCode, label: 'QR-код' },
    ]
  },
  {
    name: 'Навигация',
    icons: [
      { name: 'map-pin', icon: MapPin, label: 'Метка' },
      { name: 'map', icon: Map, label: 'Карта' },
      { name: 'compass', icon: Compass, label: 'Компас' },
      { name: 'navigation', icon: Navigation, label: 'Навигация' },
      { name: 'flag', icon: Flag, label: 'Флаг' },
    ]
  },
  {
    name: 'Действия',
    icons: [
      { name: 'plus', icon: Plus, label: 'Добавить' },
      { name: 'check-circle', icon: CheckCircle, label: 'Готово' },
      { name: 'x-circle', icon: XCircle, label: 'Отмена' },
      { name: 'edit', icon: Pencil, label: 'Редактировать' },
      { name: 'trash', icon: Trash, label: 'Удалить' },
      { name: 'copy', icon: Copy, label: 'Копировать' },
      { name: 'save', icon: Save, label: 'Сохранить' },
      { name: 'download', icon: Download, label: 'Скачать' },
      { name: 'upload', icon: Upload, label: 'Загрузить' },
      { name: 'share', icon: Share2, label: 'Поделиться' },
      { name: 'link', icon: Link, label: 'Ссылка' },
      { name: 'external-link', icon: ExternalLink, label: 'Внешняя' },
      { name: 'refresh', icon: RefreshCw, label: 'Обновить' },
      { name: 'archive', icon: Archive, label: 'Архив' },
      { name: 'printer', icon: Printer, label: 'Печать' },
    ]
  },
  {
    name: 'Интерфейс',
    icons: [
      { name: 'layout', icon: Layout, label: 'Макет' },
      { name: 'grid', icon: Grid, label: 'Сетка' },
      { name: 'layers', icon: Layers, label: 'Слои' },
      { name: 'list', icon: List, label: 'Список' },
      { name: 'filter', icon: Filter, label: 'Фильтр' },
      { name: 'tag', icon: Tag, label: 'Тег' },
      { name: 'hash', icon: Hash, label: 'Хэштег' },
      { name: 'image', icon: Image, label: 'Изображение' },
      { name: 'camera', icon: Camera, label: 'Камера' },
      { name: 'type', icon: Type, label: 'Текст' },
      { name: 'info', icon: Info, label: 'Инфо' },
      { name: 'help-circle', icon: HelpCircle, label: 'Помощь' },
      { name: 'search', icon: Search, label: 'Поиск' },
    ]
  },
  {
    name: 'Разное',
    icons: [
      { name: 'award', icon: Award, label: 'Награда' },
      { name: 'trophy', icon: Trophy, label: 'Трофей' },
      { name: 'medal', icon: Medal, label: 'Медаль' },
      { name: 'target', icon: Target, label: 'Цель' },
      { name: 'lightbulb', icon: Lightbulb, label: 'Идея' },
      { name: 'zap', icon: Zap, label: 'Молния' },
      { name: 'sparkles', icon: Sparkles, label: 'Блеск' },
      { name: 'flame', icon: Flame, label: 'Огонь' },
      { name: 'gift', icon: Gift, label: 'Подарок' },
      { name: 'package', icon: Package, label: 'Посылка' },
      { name: 'box', icon: Box, label: 'Коробка' },
      { name: 'shopping-cart', icon: ShoppingCart, label: 'Корзина' },
      { name: 'coffee', icon: Coffee, label: 'Кофе' },
      { name: 'sun', icon: Sun, label: 'Солнце' },
      { name: 'moon', icon: Moon, label: 'Луна' },
      { name: 'thumbs-up', icon: ThumbsUp, label: 'Лайк' },
      { name: 'smile', icon: Smile, label: 'Улыбка' },
      { name: 'gauge', icon: Gauge, label: 'Спидометр' },
      { name: 'rss', icon: Rss, label: 'RSS' },
      { name: 'power', icon: Power, label: 'Питание' },
    ]
  }
];

// Плоский список всех иконок для поиска
const allIcons = iconCategories.flatMap(cat => cat.icons);
const iconComponentMap = Object.fromEntries(allIcons.map(i => [i.name, i.icon]));

// Компонент выбора иконки
function IconPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Популярные');
  const pickerRef = useRef(null);
  const searchInputRef = useRef(null);
  
  const CurrentIcon = iconComponentMap[value] || FileText;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [open]);

  const filteredIcons = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return allIcons.filter(icon => 
      icon.name.toLowerCase().includes(q) || 
      icon.label.toLowerCase().includes(q)
    );
  }, [search]);

  const displayIcons = filteredIcons || iconCategories.find(c => c.name === activeCategory)?.icons || [];

  const selectIcon = (name) => {
    onChange(name);
    setOpen(false);
    setSearch('');
  };

  return (
    <div className="icon-picker-wrapper" ref={pickerRef}>
      <button type="button" className="icon-picker-trigger" onClick={() => setOpen(!open)}>
        <div className="icon-picker-preview">
          <CurrentIcon size={20} />
        </div>
        <span className="icon-picker-value">{value}</span>
        <ChevronDown size={16} className={`icon-picker-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="icon-picker-popup">
          <div className="icon-picker-search">
            <SearchIcon size={16} />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Поиск иконки..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="icon-picker-clear">
                <X size={14} />
              </button>
            )}
          </div>

          {!search && (
            <div className="icon-picker-categories">
              {iconCategories.map(cat => (
                <button
                  key={cat.name}
                  type="button"
                  className={`icon-picker-category ${activeCategory === cat.name ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat.name)}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          <div className="icon-picker-content">
            {search && (
              <div className="icon-picker-results-header">
                Найдено: {filteredIcons?.length || 0}
              </div>
            )}
            
            <div className="icon-picker-grid">
              {displayIcons.map(({ name, icon: Icon, label }) => (
                <button
                  key={name}
                  type="button"
                  className={`icon-picker-item ${value === name ? 'selected' : ''}`}
                  onClick={() => selectIcon(name)}
                  title={label}
                >
                  <Icon size={20} />
                  <span className="icon-picker-item-label">{label}</span>
                </button>
              ))}
            </div>

            {search && filteredIcons?.length === 0 && (
              <div className="icon-picker-empty">Иконки не найдены</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminSidebar() {
  const [items, setItems] = useState([]);
  const [pageList, setPageList] = useState([]);
  const [roleList, setRoleList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [form, setForm] = useState({ 
    type: 'page', title: '', pageId: '', externalUrl: '', 
    icon: 'file', allowedRoles: [], isVisible: true 
  });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [s, p, r] = await Promise.all([
        sidebar.listAll(), 
        pages.list({ limit: 200 }), 
        roles.list()
      ]);
      setItems(s.data);
      setPageList(p.data.rows || []);
      setRoleList(r.data);
    } catch (e) { 
      toast.error('Ошибка загрузки'); 
    } finally { 
      setLoading(false); 
    }
  };

  const openModal = (item = null) => {
    if (item) {
      setForm({ 
        type: item.type, 
        title: item.title || '', 
        pageId: item.pageId || '', 
        externalUrl: item.externalUrl || '', 
        icon: item.icon || 'file', 
        allowedRoles: item.allowedRoles || [], 
        isVisible: item.isVisible 
      });
    } else {
      setForm({ 
        type: 'page', title: '', pageId: '', externalUrl: '', 
        icon: 'file', allowedRoles: [], isVisible: true 
      });
    }
    setModal({ open: true, item });
  };

  const handleSave = async () => {
    if (form.type !== 'divider' && !form.title) { 
      toast.error('Введите заголовок'); 
      return; 
    }
    if (form.type === 'page' && !form.pageId) { 
      toast.error('Выберите страницу'); 
      return; 
    }
    try {
      if (modal.item) {
        await sidebar.update(modal.item.id, form);
        toast.success('Обновлено');
      } else {
        await sidebar.create(form);
        toast.success('Добавлено');
      }
      setModal({ open: false, item: null });
      load();
    } catch (e) { 
      toast.error(e.response?.data?.error || 'Ошибка'); 
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm('Удалить элемент?')) return;
    try {
      await sidebar.delete(item.id);
      toast.success('Удалено');
      load();
    } catch (e) { 
      toast.error('Ошибка'); 
    }
  };

  const handleDragEnd = async (result) => {
    if (!result.destination) return;
    
    const newItems = Array.from(items);
    const [reorderedItem] = newItems.splice(result.source.index, 1);
    newItems.splice(result.destination.index, 0, reorderedItem);
    
    setItems(newItems);
    
    const reordered = newItems.map((item, i) => ({ id: item.id, sortOrder: i }));
    try {
      await sidebar.reorder(reordered);
      toast.success('Порядок сохранён');
    } catch (e) { 
      toast.error('Ошибка сортировки'); 
      load();
    }
  };

  const getIcon = (type, iconName) => {
    if (type === 'divider') return Minus;
    if (type === 'link') return LinkIcon;
    return iconComponentMap[iconName] || FileText;
  };

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Меню навигации</h1>
        <button className="btn btn-primary" onClick={() => openModal()}>
          <Plus size={18} /> Добавить
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="sidebar-items">
              {(provided, snapshot) => (
                <div 
                  className={`sidebar-list ${snapshot.isDraggingOver ? 'dragging-over' : ''}`}
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                >
                  {items.map((item, index) => {
                    const IconComponent = getIcon(item.type, item.icon);
                    return (
                      <Draggable key={item.id} draggableId={item.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`sidebar-list-item ${item.type} ${snapshot.isDragging ? 'dragging' : ''}`}
                          >
                            <div className="sidebar-list-drag" {...provided.dragHandleProps}>
                              <GripVertical size={16} />
                            </div>
                            <div className="sidebar-list-icon">
                              <IconComponent size={16} />
                            </div>
                            <div className="sidebar-list-content">
                              <span className="sidebar-list-title">
                                {item.title || '— Разделитель —'}
                              </span>
                              {item.page && (
                                <span className="sidebar-list-page">→ {item.page.title}</span>
                              )}
                              {item.externalUrl && (
                                <span className="sidebar-list-page">→ {item.externalUrl}</span>
                              )}
                            </div>
                            <span className={`badge ${item.isVisible ? 'badge-success' : 'badge-secondary'}`}>
                              {item.isVisible ? 'Видим' : 'Скрыт'}
                            </span>
                            <div className="sidebar-list-actions">
                              <button className="btn btn-icon" onClick={() => openModal(item)} title="Редактировать">
                                <Edit size={16} />
                              </button>
                              <button className="btn btn-icon btn-danger" onClick={() => handleDelete(item)} title="Удалить">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}

        {!loading && items.length === 0 && (
          <div className="admin-empty">
            <p>Меню пусто. Добавьте первый элемент.</p>
          </div>
        )}
      </div>

      {modal.open && (
        <div className="modal-overlay" onClick={() => setModal({ open: false, item: null })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal.item ? 'Редактировать' : 'Добавить элемент'}</h2>
              <button className="modal-close" onClick={() => setModal({ open: false, item: null })}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Тип элемента</label>
                <select 
                  value={form.type} 
                  onChange={e => setForm({ ...form, type: e.target.value })}
                  className="form-select"
                >
                  <option value="page">Страница</option>
                  <option value="link">Внешняя ссылка</option>
                  <option value="divider">Разделитель</option>
                </select>
              </div>

              {form.type !== 'divider' && (
                <>
                  <div className="form-group">
                    <label>Заголовок</label>
                    <input
                      type="text"
                      value={form.title}
                      onChange={e => setForm({ ...form, title: e.target.value })}
                      placeholder="Название пункта меню"
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label>Иконка</label>
                    <IconPicker 
                      value={form.icon} 
                      onChange={(icon) => setForm({ ...form, icon })} 
                    />
                  </div>
                </>
              )}

              {form.type === 'page' && (
                <div className="form-group">
                  <label>Страница</label>
                  <select 
                    value={form.pageId} 
                    onChange={e => setForm({ ...form, pageId: e.target.value })}
                    className="form-select"
                  >
                    <option value="">— Выберите страницу —</option>
                    {pageList.map(p => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                </div>
              )}

              {form.type === 'link' && (
                <div className="form-group">
                  <label>URL ссылки</label>
                  <input
                    type="url"
                    value={form.externalUrl}
                    onChange={e => setForm({ ...form, externalUrl: e.target.value })}
                    placeholder="https://example.com"
                    className="form-input"
                  />
                </div>
              )}

              {form.type !== 'divider' && roleList.length > 0 && (
                <div className="form-group">
                  <label>Доступ для ролей</label>
                  <div className="checkbox-group">
                    {roleList.map(role => (
                      <label key={role.id} className="checkbox-item">
                        <input
                          type="checkbox"
                          checked={form.allowedRoles.includes(role.id)}
                          onChange={e => {
                            const roles = e.target.checked
                              ? [...form.allowedRoles, role.id]
                              : form.allowedRoles.filter(r => r !== role.id);
                            setForm({ ...form, allowedRoles: roles });
                          }}
                        />
                        {role.name}
                      </label>
                    ))}
                  </div>
                  <small className="form-hint">Пусто = доступно всем</small>
                </div>
              )}

              <div className="form-group">
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={form.isVisible}
                    onChange={e => setForm({ ...form, isVisible: e.target.checked })}
                  />
                  Отображать в меню
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setModal({ open: false, item: null })}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={handleSave}>
                {modal.item ? 'Сохранить' : 'Добавить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}