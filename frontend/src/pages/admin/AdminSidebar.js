import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Plus, Edit, Trash2, GripVertical, FileText, Link as LinkIcon, Minus, ChevronRight,
  Home, Users, Settings, Database, Image, Shield, Layout, File, Folder, Star, Heart,
  Bell, Calendar, Mail, Phone, MapPin, Clock, Search, Tag, Bookmark, Award,
  Briefcase, Building, Camera, Coffee, Globe, Headphones, Key, Layers, List,
  MessageCircle, Monitor, Package, Percent, PieChart, Printer, Server, ShoppingCart,
  Smartphone, Speaker, Target, ThumbsUp, Truck, Umbrella, Video, Wifi, Zap
} from 'lucide-react';
import { sidebar, pages, roles } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

const availableIcons = [
  { name: 'home', icon: Home }, { name: 'file', icon: File }, { name: 'file-text', icon: FileText },
  { name: 'folder', icon: Folder }, { name: 'users', icon: Users }, { name: 'settings', icon: Settings },
  { name: 'database', icon: Database }, { name: 'image', icon: Image }, { name: 'shield', icon: Shield },
  { name: 'layout', icon: Layout }, { name: 'star', icon: Star }, { name: 'heart', icon: Heart },
  { name: 'bell', icon: Bell }, { name: 'calendar', icon: Calendar }, { name: 'mail', icon: Mail },
  { name: 'phone', icon: Phone }, { name: 'map-pin', icon: MapPin }, { name: 'clock', icon: Clock },
  { name: 'search', icon: Search }, { name: 'tag', icon: Tag }, { name: 'bookmark', icon: Bookmark },
  { name: 'award', icon: Award }, { name: 'briefcase', icon: Briefcase }, { name: 'building', icon: Building },
  { name: 'camera', icon: Camera }, { name: 'coffee', icon: Coffee }, { name: 'globe', icon: Globe },
  { name: 'headphones', icon: Headphones }, { name: 'key', icon: Key }, { name: 'layers', icon: Layers },
  { name: 'list', icon: List }, { name: 'message-circle', icon: MessageCircle }, { name: 'monitor', icon: Monitor },
  { name: 'package', icon: Package }, { name: 'percent', icon: Percent }, { name: 'pie-chart', icon: PieChart },
  { name: 'printer', icon: Printer }, { name: 'server', icon: Server }, { name: 'shopping-cart', icon: ShoppingCart },
  { name: 'smartphone', icon: Smartphone }, { name: 'speaker', icon: Speaker }, { name: 'target', icon: Target },
  { name: 'thumbs-up', icon: ThumbsUp }, { name: 'truck', icon: Truck }, { name: 'umbrella', icon: Umbrella },
  { name: 'video', icon: Video }, { name: 'wifi', icon: Wifi }, { name: 'zap', icon: Zap }
];

function IconPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const CurrentIcon = availableIcons.find(i => i.name === value)?.icon || FileText;

  return (
    <div className="icon-picker">
      <button type="button" className="icon-picker-btn" onClick={() => setOpen(!open)}>
        <CurrentIcon size={20} />
        <span>{value}</span>
        <ChevronRight size={16} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: '0.2s' }} />
      </button>
      {open && (
        <div className="icon-picker-dropdown">
          <div className="icon-picker-grid">
            {availableIcons.map(({ name, icon: Icon }) => (
              <button
                key={name}
                type="button"
                className={`icon-picker-item ${value === name ? 'active' : ''}`}
                onClick={() => { onChange(name); setOpen(false); }}
                title={name}
              >
                <Icon size={20} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const iconComponentMap = Object.fromEntries(availableIcons.map(i => [i.name, i.icon]));

export default function AdminSidebar() {
  const [items, setItems] = useState([]);
  const [pageList, setPageList] = useState([]);
  const [roleList, setRoleList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [form, setForm] = useState({ type: 'page', title: '', pageId: '', externalUrl: '', icon: 'file', allowedRoles: [], isVisible: true });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [s, p, r] = await Promise.all([sidebar.listAll(), pages.list({ limit: 200 }), roles.list()]);
      setItems(s.data);
      setPageList(p.data.rows || []);
      setRoleList(r.data);
    } catch (e) { toast.error('Ошибка'); }
    finally { setLoading(false); }
  };

  const openModal = (item = null) => {
    if (item) {
      setForm({ type: item.type, title: item.title || '', pageId: item.pageId || '', externalUrl: item.externalUrl || '', icon: item.icon || 'file', allowedRoles: item.allowedRoles || [], isVisible: item.isVisible });
    } else {
      setForm({ type: 'page', title: '', pageId: '', externalUrl: '', icon: 'file', allowedRoles: [], isVisible: true });
    }
    setModal({ open: true, item });
  };

  const handleSave = async () => {
    if (form.type !== 'divider' && !form.title) { toast.error('Введите заголовок'); return; }
    if (form.type === 'page' && !form.pageId) { toast.error('Выберите страницу'); return; }
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
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка'); }
  };

  const handleDelete = async (item) => {
    if (!window.confirm('Удалить элемент?')) return;
    try {
      await sidebar.delete(item.id);
      toast.success('Удалено');
      load();
    } catch (e) { toast.error('Ошибка'); }
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
        <button className="btn btn-primary" onClick={() => openModal()}><Plus size={18} /> Добавить</button>
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
                            <div className="sidebar-list-icon"><IconComponent size={16} /></div>
                            <div className="sidebar-list-content">
                              <span className="sidebar-list-title">{item.title || '— Разделитель —'}</span>
                              {item.page && <span className="sidebar-list-page">→ {item.page.title}</span>}
                              {item.externalUrl && <span className="sidebar-list-page">→ {item.externalUrl}</span>}
                            </div>
                            <span className={`badge ${item.isVisible ? 'badge-success' : ''}`}>
                              {item.isVisible ? 'Видим' : 'Скрыт'}
                            </span>
                            <div className="action-btns">
                              <button className="btn btn-ghost btn-sm" onClick={() => openModal(item)}><Edit size={16} /></button>
                              <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(item)}><Trash2 size={16} /></button>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {provided.placeholder}
                  {items.length === 0 && <div className="empty-state">Меню пусто. Добавьте первый элемент.</div>}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}
      </div>

      {modal.open && (
        <div className="modal-overlay" onClick={() => setModal({ open: false, item: null })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>{modal.item ? 'Редактировать' : 'Добавить элемент'}</h3></div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Тип</label>
                <select className="select" value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                  <option value="page">Страница</option>
                  <option value="link">Внешняя ссылка</option>
                  <option value="divider">Разделитель</option>
                  <option value="header">Заголовок секции</option>
                </select>
              </div>
              {form.type !== 'divider' && (
                <>
                  <div className="form-group">
                    <label className="form-label">Заголовок</label>
                    <input className="input" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Иконка</label>
                    <IconPicker value={form.icon} onChange={icon => setForm({...form, icon})} />
                  </div>
                </>
              )}
              {form.type === 'page' && (
                <div className="form-group">
                  <label className="form-label">Страница</label>
                  <select className="select" value={form.pageId} onChange={e => setForm({...form, pageId: e.target.value})}>
                    <option value="">Выберите...</option>
                    {pageList.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </div>
              )}
              {form.type === 'link' && (
                <div className="form-group">
                  <label className="form-label">URL</label>
                  <input className="input" placeholder="https://..." value={form.externalUrl} onChange={e => setForm({...form, externalUrl: e.target.value})} />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Ограничить по ролям</label>
                <div className="checkbox-list">
                  {roleList.map(r => (
                    <label key={r.id} className="checkbox-item">
                      <input type="checkbox" checked={form.allowedRoles.includes(r.id)} onChange={e => {
                        const newRoles = e.target.checked 
                          ? [...form.allowedRoles, r.id] 
                          : form.allowedRoles.filter(id => id !== r.id);
                        setForm({...form, allowedRoles: newRoles});
                      }} />
                      <span>{r.name}</span>
                    </label>
                  ))}
                </div>
                <small className="form-hint">Если не выбрано — видно всем</small>
              </div>
              <div className="form-group">
                <label className="checkbox-item">
                  <input type="checkbox" checked={form.isVisible} onChange={e => setForm({...form, isVisible: e.target.checked})} />
                  <span>Показывать в меню</span>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setModal({ open: false, item: null })}>Отмена</button>
              <button className="btn btn-primary" onClick={handleSave}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}