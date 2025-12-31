import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { 
  Plus, Edit, Trash2, GripVertical, FileText, Link as LinkIcon, Minus, 
  ChevronDown, ChevronRight, X, Folder, FolderOpen, Type as TypeIcon,
  ExternalLink, Check
} from 'lucide-react';
import { sidebar, folders, pages } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

// Компонент древовидного выбора страницы
function PageTreeSelect({ pages, folders, value, onChange }) {
  const [expandedFolders, setExpandedFolders] = useState({});
  const [search, setSearch] = useState('');

  // Группируем страницы по папкам
  const rootPages = pages.filter(p => !p.folderId);
  
  // Рекурсивно строим дерево папок с их страницами
  const buildFolderTree = (folderList, allPages, level = 0) => {
    return folderList.map(folder => {
      const folderPages = allPages.filter(p => p.folderId === folder.id);
      const children = folder.children ? buildFolderTree(folder.children, allPages, level + 1) : [];
      return {
        ...folder,
        level,
        pages: folderPages,
        children
      };
    });
  };

  const treeData = buildFolderTree(folders, pages);

  // Фильтрация по поиску
  const filterBySearch = (text) => {
    if (!search) return true;
    return text.toLowerCase().includes(search.toLowerCase());
  };

  const toggleFolder = (folderId, e) => {
    e.stopPropagation();
    setExpandedFolders(prev => ({
      ...prev,
      [folderId]: !prev[folderId]
    }));
  };

  // Рендер папки и её содержимого
  const renderFolder = (folder) => {
    const isExpanded = expandedFolders[folder.id];
    const hasContent = folder.pages.length > 0 || folder.children.length > 0;
    
    // Фильтруем страницы в папке
    const filteredPages = folder.pages.filter(p => filterBySearch(p.title));
    const hasMatchingPages = filteredPages.length > 0;
    
    // Проверяем, есть ли совпадения в дочерних папках
    const hasMatchingChildren = folder.children.some(child => {
      const childPages = child.pages.filter(p => filterBySearch(p.title));
      return childPages.length > 0 || filterBySearch(child.title);
    });

    // Если поиск активен и нет совпадений - скрываем папку
    if (search && !filterBySearch(folder.title) && !hasMatchingPages && !hasMatchingChildren) {
      return null;
    }

    return (
      <div key={folder.id} className="tree-folder">
        <div 
          className={`tree-select-item tree-folder-header level-${folder.level}`}
          onClick={(e) => hasContent && toggleFolder(folder.id, e)}
        >
          {hasContent ? (
            isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
          ) : (
            <span style={{ width: 16 }} />
          )}
          <Folder size={16} />
          <span>{folder.title}</span>
          <span className="tree-folder-count">{folder.pages.length}</span>
        </div>
        
        {isExpanded && (
          <div className="tree-folder-content">
            {/* Дочерние папки */}
            {folder.children.map(child => renderFolder(child))}
            
            {/* Страницы в папке */}
            {filteredPages.map(page => (
              <div 
                key={page.id}
                className={`tree-select-item tree-page level-${folder.level + 1} ${value === page.id ? 'selected' : ''}`}
                onClick={() => onChange(page.id)}
              >
                <FileText size={16} />
                <span>{page.title}</span>
                {value === page.id && <Check size={16} className="tree-check" />}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Фильтрованные корневые страницы
  const filteredRootPages = rootPages.filter(p => filterBySearch(p.title));

  const hasAnyContent = pages.length > 0 || folders.length > 0;

  return (
    <div className="tree-select-wrapper">
      <div className="tree-select-search">
        <input
          type="text"
          placeholder="Поиск страницы..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
        />
      </div>
      
      <div className="tree-select">
        {!hasAnyContent ? (
          <div className="tree-select-empty">Нет страниц. Создайте в разделе "Страницы"</div>
        ) : (
          <>
            {/* Папки с содержимым */}
            {treeData.map(folder => renderFolder(folder))}
            
            {/* Страницы без папки */}
            {filteredRootPages.length > 0 && (
              <>
                {treeData.length > 0 && <div className="tree-select-divider">Без папки</div>}
                {filteredRootPages.map(page => (
                  <div 
                    key={page.id}
                    className={`tree-select-item tree-page ${value === page.id ? 'selected' : ''}`}
                    onClick={() => onChange(page.id)}
                  >
                    <FileText size={16} />
                    <span>{page.title}</span>
                    {value === page.id && <Check size={16} className="tree-check" />}
                  </div>
                ))}
              </>
            )}
            
            {/* Если поиск не дал результатов */}
            {search && filteredRootPages.length === 0 && treeData.every(f => {
              const fp = f.pages.filter(p => filterBySearch(p.title));
              return fp.length === 0 && !filterBySearch(f.title);
            }) && (
              <div className="tree-select-empty">Ничего не найдено</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Компонент элемента списка
function SidebarListItem({ item, index, onEdit, onDelete, level = 0 }) {
  const [expanded, setExpanded] = useState(true);
  
  // Для папки из проводника показываем страницы из неё
  const folderPages = item.folder?.pages || item.folderPages || [];
  const hasChildren = item.children?.length > 0 || folderPages.length > 0;

  const getIcon = (type) => {
    if (type === 'divider') return Minus;
    if (type === 'link') return ExternalLink;
    if (type === 'folder') return expanded ? FolderOpen : Folder;
    if (type === 'header') return TypeIcon;
    return FileText;
  };

  const getTypeBadge = (type) => {
    const badges = {
      page: { label: 'Страница', class: 'badge-info' },
      folder: { label: 'Папка', class: 'badge-warning' },
      header: { label: 'Заголовок', class: 'badge-secondary' },
      link: { label: 'Ссылка', class: 'badge-primary' },
      divider: { label: 'Разделитель', class: 'badge-secondary' }
    };
    return badges[type] || { label: type, class: '' };
  };

  const getTitle = () => {
    if (item.type === 'divider') return '— Разделитель —';
    if (item.type === 'folder' && item.folder) return item.title || item.folder.title;
    if (item.type === 'page' && item.page) return item.title || item.page.title;
    return item.title || 'Без названия';
  };

  const getSubtitle = () => {
    if (item.type === 'folder' && item.folder) {
      return `${folderPages.length} стр.`;
    }
    if (item.type === 'page' && item.page) {
      return `→ ${item.page.slug}`;
    }
    if (item.type === 'link' && item.externalUrl) {
      return `→ ${item.externalUrl}`;
    }
    return null;
  };

  const IconComponent = getIcon(item.type);
  const typeBadge = getTypeBadge(item.type);

  return (
    <Draggable draggableId={item.id} index={index}>
      {(provided, snapshot) => (
        <div ref={provided.innerRef} {...provided.draggableProps}>
          <div
            className={`sidebar-list-item ${item.type} ${snapshot.isDragging ? 'dragging' : ''}`}
            style={{ paddingLeft: `${16 + level * 24}px` }}
          >
            <div className="sidebar-list-drag" {...provided.dragHandleProps}>
              <GripVertical size={16} />
            </div>
            
            {hasChildren && (
              <button className="sidebar-list-expand" onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            )}
            
            <div className="sidebar-list-icon">
              <IconComponent size={16} />
            </div>
            
            <div className="sidebar-list-content">
              <span className="sidebar-list-title">{getTitle()}</span>
              {getSubtitle() && (
                <span className="sidebar-list-page">{getSubtitle()}</span>
              )}
            </div>
            
            <span className={`badge ${typeBadge.class}`}>{typeBadge.label}</span>
            <span className={`badge ${item.isVisible ? 'badge-success' : 'badge-error'}`}>
              {item.isVisible ? 'Видим' : 'Скрыт'}
            </span>
            
            <div className="sidebar-list-actions">
              <button className="btn btn-icon" onClick={() => onEdit(item)} title="Редактировать">
                <Edit size={16} />
              </button>
              <button className="btn btn-icon btn-danger" onClick={() => onDelete(item)} title="Удалить">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
          
          {/* Страницы внутри папки */}
          {hasChildren && expanded && item.type === 'folder' && folderPages.length > 0 && (
            <div className="sidebar-list-children">
              {folderPages.map((page, idx) => (
                <div key={page.id} className="sidebar-list-item page" style={{ paddingLeft: `${40 + level * 24}px` }}>
                  <div className="sidebar-list-icon">
                    <FileText size={16} />
                  </div>
                  <div className="sidebar-list-content">
                    <span className="sidebar-list-title">{page.title}</span>
                    <span className="sidebar-list-page">→ {page.slug}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Вложенные элементы сайдбара */}
          {hasChildren && expanded && item.children?.length > 0 && (
            <div className="sidebar-list-children">
              {item.children.map((child, idx) => (
                <SidebarListItem
                  key={child.id}
                  item={child}
                  index={idx}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  level={level + 1}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Draggable>
  );
}

export default function AdminSidebar() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [folderTree, setFolderTree] = useState([]);
  const [pageList, setPageList] = useState([]);
  
  const [modal, setModal] = useState({ open: false, item: null });
  const [form, setForm] = useState({ 
    type: 'page', 
    title: '', 
    pageId: '', 
    folderId: '',
    externalUrl: '', 
    allowedRoles: [], 
    isVisible: true 
  });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [sidebarRes, foldersRes, pagesRes] = await Promise.all([
        sidebar.listAll(),
        folders.tree(),
        pages.list({ limit: 500 })
      ]);
      setItems(sidebarRes.data);
      setFolderTree(foldersRes.data);
      setPageList(pagesRes.data.rows || []);
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
        folderId: item.folderId || '',
        externalUrl: item.externalUrl || '', 
        allowedRoles: item.allowedRoles || [], 
        isVisible: item.isVisible 
      });
    } else {
      setForm({ 
        type: 'page', 
        title: '', 
        pageId: '', 
        folderId: '',
        externalUrl: '', 
        allowedRoles: [], 
        isVisible: true 
      });
    }
    setModal({ open: true, item });
  };

  const handleSave = async () => {
    // Validation
    if (form.type === 'page' && !form.pageId) {
      toast.error('Выберите страницу');
      return;
    }
    if (form.type === 'folder' && !form.folderId) {
      toast.error('Выберите папку');
      return;
    }
    if (form.type === 'link' && !form.externalUrl) {
      toast.error('Введите URL');
      return;
    }
    if (form.type === 'header' && !form.title) {
      toast.error('Введите заголовок');
      return;
    }

    try {
      const data = {
        type: form.type,
        title: ['header', 'link'].includes(form.type) ? form.title : null,
        pageId: form.type === 'page' ? form.pageId : null,
        folderId: form.type === 'folder' ? form.folderId : null,
        externalUrl: form.type === 'link' ? form.externalUrl : null,
        allowedRoles: form.allowedRoles,
        isVisible: form.isVisible
      };

      if (modal.item) {
        await sidebar.update(modal.item.id, data);
        toast.success('Обновлено');
      } else {
        await sidebar.create(data);
        toast.success('Добавлено');
      }
      setModal({ open: false, item: null });
      load();
    } catch (e) { 
      toast.error(e.response?.data?.error || 'Ошибка'); 
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Удалить элемент из меню?`)) return;
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
    
    const reordered = newItems.map((item, i) => ({ 
      id: item.id, 
      sortOrder: i,
      parentId: item.parentId 
    }));
    
    try {
      await sidebar.reorder({ items: reordered });
      toast.success('Порядок сохранён');
    } catch (e) { 
      toast.error('Ошибка сортировки'); 
      load();
    }
  };

  // Flatten folder tree for select
  const flattenTree = (tree, level = 0) => {
    let result = [];
    for (const folder of tree) {
      result.push({ ...folder, level });
      if (folder.children?.length > 0) {
        result = result.concat(flattenTree(folder.children, level + 1));
      }
    }
    return result;
  };
  const flatFolders = flattenTree(folderTree);

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
                  {items.map((item, index) => (
                    <SidebarListItem
                      key={item.id}
                      item={item}
                      index={index}
                      onEdit={openModal}
                      onDelete={handleDelete}
                    />
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        )}

        {!loading && items.length === 0 && (
          <div className="admin-empty">
            <p>Меню пусто. Добавьте элементы.</p>
          </div>
        )}
      </div>

      {/* Modal */}
      {modal.open && (
        <div className="modal-overlay" onClick={() => setModal({ open: false, item: null })}>
          <div className="modal modal-md" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{modal.item ? 'Редактировать' : 'Добавить в меню'}</h2>
              <button className="modal-close" onClick={() => setModal({ open: false, item: null })}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Тип элемента</label>
                <select 
                  value={form.type} 
                  onChange={e => setForm({ ...form, type: e.target.value })}
                  className="select"
                >
                  <option value="page">📄 Страница</option>
                  <option value="folder">📁 Папка (из проводника)</option>
                  <option value="header">📑 Заголовок секции</option>
                  <option value="link">🔗 Внешняя ссылка</option>
                  <option value="divider">➖ Разделитель</option>
                </select>
              </div>

              {/* Page selector - tree view */}
              {form.type === 'page' && (
                <div className="form-group">
                  <label className="form-label">Выберите страницу *</label>
                  <PageTreeSelect 
                    pages={pageList}
                    folders={folderTree}
                    value={form.pageId}
                    onChange={(pageId) => setForm({ ...form, pageId })}
                  />
                </div>
              )}

              {/* Folder selector */}
              {form.type === 'folder' && (
                <div className="form-group">
                  <label className="form-label">Выберите папку *</label>
                  <div className="tree-select">
                    {flatFolders.length === 0 ? (
                      <div className="tree-select-empty">Нет папок. Создайте в разделе "Страницы"</div>
                    ) : (
                      flatFolders.map(folder => (
                        <div 
                          key={folder.id}
                          className={`tree-select-item level-${folder.level} ${form.folderId === folder.id ? 'selected' : ''}`}
                          onClick={() => setForm({ ...form, folderId: folder.id })}
                        >
                          <Folder size={16} />
                          <span>{folder.title}</span>
                          {form.folderId === folder.id && <Check size={16} style={{ marginLeft: 'auto' }} />}
                        </div>
                      ))
                    )}
                  </div>
                  <small className="form-hint">Все страницы из папки автоматически появятся в меню</small>
                </div>
              )}

              {/* Header title */}
              {form.type === 'header' && (
                <div className="form-group">
                  <label className="form-label">Заголовок *</label>
                  <input
                    type="text"
                    className="input"
                    value={form.title}
                    onChange={e => setForm({ ...form, title: e.target.value })}
                    placeholder="НАЗВАНИЕ СЕКЦИИ"
                  />
                </div>
              )}

              {/* Link */}
              {form.type === 'link' && (
                <>
                  <div className="form-group">
                    <label className="form-label">Название *</label>
                    <input
                      type="text"
                      className="input"
                      value={form.title}
                      onChange={e => setForm({ ...form, title: e.target.value })}
                      placeholder="Название ссылки"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">URL *</label>
                    <input
                      type="url"
                      className="input"
                      value={form.externalUrl}
                      onChange={e => setForm({ ...form, externalUrl: e.target.value })}
                      placeholder="https://example.com"
                    />
                  </div>
                </>
              )}

              {/* Visibility */}
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