import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
  Plus, Folder, FileText,
  ChevronRight, Home, Edit, Trash2, Eye, MoreVertical,
  ArrowLeft, Check, LayoutGrid, List, Search, X,
  ChevronDown, ArrowUp, ArrowDown,
  FileCode, Table, FolderPlus,
  Upload, Image, Film, Music, Archive, Package, File, Download,
  Scroll, BookOpen
} from 'lucide-react';

const getFileIconInfo = (mimeType) => {
  if (!mimeType) return { Icon: File, className: 'explorer-icon-file', title: 'Файл' };
  if (mimeType.startsWith('image/'))
    return { Icon: Image,   className: 'explorer-icon-file-image', title: 'Изображение' };
  if (mimeType.startsWith('video/'))
    return { Icon: Film,    className: 'explorer-icon-file-video', title: 'Видео' };
  if (mimeType.startsWith('audio/'))
    return { Icon: Music,   className: 'explorer-icon-file-audio', title: 'Аудио' };
  if (mimeType === 'application/pdf')
    return { Icon: Scroll, className: 'explorer-icon-file-pdf', title: 'PDF' };
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel'))
    return { Icon: Table,   className: 'explorer-icon-spreadsheet', title: 'Excel' };
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint'))
    return { Icon: File,    className: 'explorer-icon-file-ppt', title: 'PowerPoint' };
  if (mimeType.includes('word') || mimeType.includes('msword'))
    return { Icon: BookOpen, className: 'explorer-icon-file-doc', title: 'Word' };
  if (['application/zip','application/x-zip-compressed','application/x-rar-compressed',
       'application/vnd.rar','application/x-7z-compressed','application/x-tar','application/gzip']
      .includes(mimeType))
    return { Icon: Archive, className: 'explorer-icon-file-archive', title: 'Архив' };
  if (['application/x-msdownload','application/x-msi','application/octet-stream'].includes(mimeType))
    return { Icon: Package, className: 'explorer-icon-file-exe', title: 'Исполняемый файл' };
  if (mimeType.startsWith('text/') || mimeType === 'application/json')
    return { Icon: FileText, className: 'explorer-icon-file-text', title: 'Текст' };
  return { Icon: File, className: 'explorer-icon-file', title: 'Файл' };
};

const hasFilePreview = (mimeType) => {
  if (!mimeType) return false;
  if (mimeType.startsWith('image/')) return true;
  if (mimeType.startsWith('video/')) return true;
  if (mimeType.startsWith('audio/')) return true;
  if (mimeType === 'application/pdf') return true;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return true;
  if (mimeType.includes('word') || mimeType.includes('msword')) return true;
  return false;
};

const getPageIconInfo = (contentType, metadata) => {
  if (contentType === 'file') return getFileIconInfo(metadata?.mimeType);
  switch (contentType) {
    case 'spreadsheet':
      return { Icon: Table,    className: 'explorer-icon-spreadsheet', title: 'Таблица' };
    case 'html':
      return { Icon: FileCode, className: 'explorer-icon-html',        title: 'HTML-страница' };
    case 'wysiwyg':
    default:
      return { Icon: FileText, className: 'explorer-icon-wysiwyg',     title: 'Документ' };
  }
};

// Элементы единого дропдауна «Создать»
const CREATE_ITEMS = [
  { kind: 'folder',      Icon: FolderPlus, label: 'Папка',            iconColor: '#f59e0b' },
  { kind: 'wysiwyg',     Icon: FileText,   label: 'Документ',         iconColor: 'var(--primary, #2563eb)' },
  { kind: 'spreadsheet', Icon: Table,      label: 'Таблица',          iconColor: '#22c55e' },
  { kind: 'html',        Icon: FileCode,   label: 'HTML-страница',    iconColor: '#f97316' },
  { kind: 'file',        Icon: Upload,     label: 'Загрузить файл',   iconColor: '#8b5cf6' },
];

import { folders, pages, roles } from '../../services/api';
import { BASE_URL } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import PageView from '../PageView';
import '../Admin.css';

export default function AdminPages() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { isAdmin, hasPermission, hasAdminAccess } = useAuth();
  const [loading, setLoading] = useState(true);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  // Если путь указывает на страницу (а не папку) — показываем её через PageView
  const [pageViewSlug, setPageViewSlug] = useState(null);

  // Текущий путь папки из URL: /explorer/marketing/reports -> "marketing/reports".
  // URL — источник истины: переход = navigate, загрузка идёт по slug-пути.
  const folderPath = location.pathname.replace(/^\/explorer\/?/, '').replace(/\/+$/, '');
  const pathSegments = folderPath ? folderPath.split('/') : [];
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [folderList, setFolderList] = useState([]);
  const [pageList, setPageList] = useState([]);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [allRoles, setAllRoles] = useState([]);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('alfa-wiki-explorer-view') || 'grid');

  // Единый дропдаун «Создать»
  const [showCreateDropdown, setShowCreateDropdown] = useState(false);
  const createDropdownRef = useRef(null);

  // Поиск
  const [folderSearch, setFolderSearch] = useState('');

  // Сортировка (список)
  const [sortConfig, setSortConfig] = useState({ key: 'name', dir: 'asc' });

  // Выделение
  const [selectedId, setSelectedId] = useState(null);

  // Drag & drop
  const [draggedItem, setDraggedItem] = useState(null); // { id, type: 'folder'|'page' }
  const [dragOverId, setDragOverId] = useState(null);   // id строки при наведении (для ребилда порядка)
  const [dragOverFolderId, setDragOverFolderId] = useState(null); // папка-цель (move into)
  const [dragOverBack, setDragOverBack] = useState(false); // наведение на кнопку «Назад»

  // Modals
  const [folderModal, setFolderModal] = useState({ open: false, folder: null });
  const [deleteModal, setDeleteModal] = useState({ open: false, type: null, item: null });
  const [fileUploadModal, setFileUploadModal] = useState({ open: false });
  const [fileUploadForm, setFileUploadForm] = useState({ title: '', description: '', isPublished: false, allowedRoles: [] });
  const [fileUploadFile, setFileUploadFile] = useState(null);
  const [fileUploadProgress, setFileUploadProgress] = useState(0);
  const [fileUploadLoading, setFileUploadLoading] = useState(false);
  const fileInputRef = useRef(null);

  // Form
  const [folderForm, setFolderForm] = useState({ title: '', icon: 'folder', description: '', allowedRoles: [] });

  const canEdit   = isAdmin || hasAdminAccess('pages') || hasPermission('pages', 'write');
  const canDelete = isAdmin || hasAdminAccess('pages') || hasPermission('pages', 'delete');

  const downloadFile = (page) => {
    const mediaId = page.mediaId || page.mediaFile?.id;
    if (!mediaId) { toast.error('Файл не найден'); return; }
    window.location.href = `${BASE_URL}/api/media/${mediaId}/download`;
  };

  useEffect(() => { loadRoles(); }, []);

  // Обратная совместимость со старыми ссылками вида /explorer?folderId=<uuid>:
  // разворачиваем id в slug-путь и переходим на него.
  useEffect(() => {
    const legacyId = searchParams.get('folderId');
    if (!legacyId || pathSegments.length) return;
    folders.browse(legacyId)
      .then(({ data }) => {
        const path = (data.breadcrumbs || []).map(c => c.slug).filter(Boolean).join('/');
        navigate(path ? `/explorer/${path}` : '/explorer', { replace: true });
      })
      .catch(() => navigate('/explorer', { replace: true }));
  }, []);

  // Загрузка содержимого при изменении пути в URL (включая кнопки «назад/вперёд»)
  useEffect(() => {
    if (searchParams.get('folderId') && !pathSegments.length) return; // ждём редирект выше
    loadContent();
    setFolderSearch('');
    setSelectedId(null);
  }, [folderPath]);

  // Закрытие дропдауна «Создать» при клике вне
  useEffect(() => {
    if (!showCreateDropdown) return;
    const handler = (e) => {
      if (createDropdownRef.current && !createDropdownRef.current.contains(e.target)) {
        setShowCreateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCreateDropdown]);

  // Закрытие контекстного меню
  useEffect(() => {
    const handler = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener('click', handler);
      return () => document.removeEventListener('click', handler);
    }
  }, [openMenuId]);

  const loadRoles = async () => {
    try {
      const { data } = await roles.list();
      setAllRoles(data);
    } catch (e) { console.error(e); }
  };

  const loadContent = async () => {
    setLoading(true);
    try {
      const { data } = pathSegments.length
        ? await folders.resolve(folderPath)
        : await folders.browse(null);
      if (data.type === 'page') {
        // Последний сегмент пути — страница: показываем её, а не проводник
        setPageViewSlug(data.pageSlug);
        return;
      }
      setPageViewSlug(null);
      setCurrentFolderId(data.folderId || null);
      setFolderList(data.folders || []);
      setPageList(data.pages || []);
      setBreadcrumbs(data.breadcrumbs || []);
    } catch (error) {
      if (error.response?.status === 404) {
        toast.error('Папка не найдена');
        navigate('/explorer', { replace: true });
      } else {
        toast.error('Ошибка загрузки');
      }
    } finally {
      setLoading(false);
    }
  };

  // Переходы по папкам = смена URL (ссылки на папки становятся постоянными)
  const goToFolderPath = (path) => navigate(path ? `/explorer/${path}` : '/explorer');

  // Открыть подпапку текущего уровня (folder.slug добавляется к текущему пути)
  const openFolder = (folder) => goToFolderPath([...pathSegments, folder.slug].join('/'));

  // Открыть страницу по каноническому пути /explorer/папка/слаг
  const openPage = (page) => goToFolderPath([...pathSegments, page.slug].join('/'));

  // Перейти к крошке по индексу (slug-цепочка до неё включительно)
  const navigateToCrumb = (idx) =>
    goToFolderPath(breadcrumbs.slice(0, idx + 1).map(c => c.slug).join('/'));

  const navigateToRoot = () => goToFolderPath('');

  const navigateUp = () => goToFolderPath(pathSegments.slice(0, -1).join('/'));

  // Обработчик выбора пункта из «Создать»
  const handleCreateItem = (kind) => {
    setShowCreateDropdown(false);
    if (kind === 'folder') {
      setFolderForm({ title: '', icon: 'folder', description: '', allowedRoles: [] });
      setFolderModal({ open: true, folder: null });
    } else if (kind === 'file') {
      setFileUploadForm({ title: '', description: '', isPublished: false, allowedRoles: [] });
      setFileUploadFile(null);
      setFileUploadProgress(0);
      setFileUploadModal({ open: true });
    } else {
      navigate(`/page/new/edit?type=${kind}&folderId=${currentFolderId || ''}`);
    }
  };

  const handleFileSelect = (file) => {
    if (!file) return;
    setFileUploadFile(file);
    setFileUploadForm(prev => ({ ...prev, title: prev.title || file.name.replace(/\.[^.]+$/, '') }));
  };

  const handleFileUploadSave = async () => {
    if (!fileUploadFile) { toast.error('Выберите файл'); return; }
    if (!fileUploadForm.title.trim()) { toast.error('Введите название'); return; }
    setFileUploadLoading(true);
    setFileUploadProgress(0);
    try {
      await pages.createFile({
        file: fileUploadFile,
        title: fileUploadForm.title.trim(),
        description: fileUploadForm.description,
        isPublished: fileUploadForm.isPublished,
        allowedRoles: fileUploadForm.allowedRoles,
        folderId: currentFolderId,
        onProgress: setFileUploadProgress,
      });
      toast.success('Файл загружен');
      setFileUploadModal({ open: false });
      loadContent();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка загрузки');
    } finally {
      setFileUploadLoading(false);
    }
  };

  const handleSaveFolder = async () => {
    if (!folderForm.title.trim()) { toast.error('Введите название папки'); return; }
    try {
      if (folderModal.folder) {
        await folders.update(folderModal.folder.id, folderForm);
        toast.success('Папка обновлена');
      } else {
        await folders.create({ ...folderForm, parentId: currentFolderId });
        toast.success('Папка создана');
      }
      setFolderModal({ open: false, folder: null });
      loadContent();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка сохранения');
    }
  };

  const openDeleteModal = (type, item) => {
    if (!canDelete) { toast.error('У вас нет прав на удаление'); return; }
    setDeleteModal({ open: true, type, item });
  };

  const confirmDelete = async () => {
    const { type, item } = deleteModal;
    try {
      if (type === 'folder') { await folders.delete(item.id); toast.success('Папка удалена'); }
      else                   { await pages.delete(item.id);   toast.success('Страница удалена'); }
      setDeleteModal({ open: false, type: null, item: null });
      loadContent();
    } catch { toast.error('Ошибка удаления'); }
  };

  const toggleMenu = (itemId, e) => {
    e.stopPropagation();
    setOpenMenuId(openMenuId === itemId ? null : itemId);
  };

  const canCreateSubfolder = breadcrumbs.length < 2;

  const toggleViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('alfa-wiki-explorer-view', mode);
  };

  // Сортировка
  const handleSort = (key) => {
    setSortConfig(prev =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  };

  const SortIcon = ({ colKey }) => {
    if (sortConfig.key !== colKey) return null;
    return sortConfig.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
  };

  const filterAndSort = (list, isFolder) => {
    const term = folderSearch.trim().toLowerCase();
    let filtered = term ? list.filter(item => item.title.toLowerCase().includes(term)) : list;
    if (viewMode === 'list') {
      filtered = [...filtered].sort((a, b) => {
        let aVal, bVal;
        switch (sortConfig.key) {
          case 'type':
            aVal = isFolder ? 'папка' : getPageIconInfo(a.contentType).title.toLowerCase();
            bVal = isFolder ? 'папка' : getPageIconInfo(b.contentType).title.toLowerCase();
            break;
          case 'status':
            aVal = isFolder ? 0 : (a.isPublished ? 1 : 0);
            bVal = isFolder ? 0 : (b.isPublished ? 1 : 0);
            break;
          default:
            aVal = (a.title || '').toLowerCase();
            bVal = (b.title || '').toLowerCase();
        }
        if (aVal < bVal) return sortConfig.dir === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.dir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return filtered;
  };

  const displayedFolders = filterAndSort(folderList, true);
  const displayedPages   = filterAndSort(pageList, false);
  const totalDisplayed   = displayedFolders.length + displayedPages.length;

  // ── Drag & Drop ──────────────────────────────────────────
  const handleDragStart = (e, type, id) => {
    setDraggedItem({ type, id });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${type}:${id}`);
  };

  const handleDragOver = (e, targetId, isFolder) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (isFolder) {
      setDragOverFolderId(targetId);
      setDragOverId(null);
    } else {
      setDragOverId(targetId);
      setDragOverFolderId(null);
    }
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverId(null);
    setDragOverFolderId(null);
    setDragOverBack(false);
  };

  // Сбросить в родительскую папку (кнопка «Назад»)
  const handleDropOnBack = async (e) => {
    e.preventDefault();
    if (!draggedItem) { handleDragEnd(); return; }
    const parentFolderId = breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].id : null;
    try {
      await folders.move([{ id: draggedItem.id, type: draggedItem.type, targetFolderId: parentFolderId }]);
      toast.success('Перемещено');
      loadContent();
    } catch { toast.error('Ошибка перемещения'); }
    handleDragEnd();
  };

  const handleDrop = async (e, targetId, targetType) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.id === targetId) { handleDragEnd(); return; }

    // Переместить в папку
    if (targetType === 'folder') {
      try {
        await folders.move([{ id: draggedItem.id, type: draggedItem.type, targetFolderId: targetId }]);
        toast.success('Перемещено');
        loadContent();
      } catch { toast.error('Ошибка перемещения'); }
      handleDragEnd();
      return;
    }

    // Изменить порядок внутри одного типа
    if (draggedItem.type === targetType) {
      const isFolderType = targetType === 'folder';
      const list = isFolderType ? [...displayedFolders] : [...displayedPages];
      const fromIdx = list.findIndex(i => i.id === draggedItem.id);
      const toIdx   = list.findIndex(i => i.id === targetId);
      if (fromIdx === -1 || toIdx === -1) { handleDragEnd(); return; }
      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);
      const items = list.map((item, idx) => ({ id: item.id, sortOrder: idx + 1 }));
      try {
        await folders.reorder(isFolderType ? { folders: items } : { pages: items });
        loadContent();
      } catch { toast.error('Ошибка сортировки'); }
    }

    handleDragEnd();
  };

  // ─────────────────────────────────────────────────────────


  // Путь ведёт на страницу — рендерим её обычным просмотром
  if (pageViewSlug) {
    return <PageView slugOverride={pageViewSlug} />;
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Проводник страниц</h1>
        <div className="admin-header-actions">
          <div className="explorer-view-toggle">
            <button
              className={`btn-icon ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => toggleViewMode('grid')}
              title="Галерея"
            >
              <LayoutGrid size={18} />
            </button>
            <button
              className={`btn-icon ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => toggleViewMode('list')}
              title="Список"
            >
              <List size={18} />
            </button>
          </div>

          {canEdit && (
            <div className="explorer-page-create" ref={createDropdownRef}>
              <button
                className="btn btn-primary"
                onClick={(e) => { e.stopPropagation(); setShowCreateDropdown(v => !v); }}
              >
                Создать
              </button>
              {showCreateDropdown && (
                <div className="explorer-type-dropdown">
                  {CREATE_ITEMS.map(({ kind, Icon, label, iconColor }) => {
                    if (kind === 'folder' && !canCreateSubfolder) return null;
                    return (
                      <button
                        key={kind}
                        className="explorer-type-option"
                        onClick={() => handleCreateItem(kind)}
                      >
                        <Icon size={18} style={{ color: iconColor, flexShrink: 0 }} />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Breadcrumbs + поиск в одной строке */}
      <div className="explorer-breadcrumbs-row">
        <div className="explorer-breadcrumbs">
          <button
            className={`breadcrumb-item ${!currentFolderId ? 'active' : ''}`}
            onClick={navigateToRoot}
          >
            <Home size={16} />
            <span>Корень</span>
          </button>
          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb.id}>
              <ChevronRight size={16} className="breadcrumb-separator" />
              <button
                className={`breadcrumb-item ${idx === breadcrumbs.length - 1 ? 'active' : ''}`}
                onClick={() => navigateToCrumb(idx)}
              >
                <Folder size={16} />
                <span>{crumb.title}</span>
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="explorer-search-wrap">
          <Search size={13} className="explorer-search-icon" />
          <input
            className="explorer-search-input"
            placeholder="Поиск..."
            value={folderSearch}
            onChange={e => { setFolderSearch(e.target.value); setSelectedId(null); }}
          />
          {folderSearch && (
            <button className="explorer-search-clear" onClick={() => { setFolderSearch(''); setSelectedId(null); }}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="card">
        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : viewMode === 'list' ? (
          /* ── LIST VIEW ── */
          <div className="explorer-list">
            <div className="explorer-list-header">
              <span className="explorer-list-icon-col" />
              <button className={`explorer-list-col-btn ${sortConfig.key === 'name' ? 'active' : ''}`} onClick={() => handleSort('name')}>
                Название <SortIcon colKey="name" />
              </button>
              <button className={`explorer-list-col-btn explorer-list-type-col ${sortConfig.key === 'type' ? 'active' : ''}`} onClick={() => handleSort('type')}>
                Тип <SortIcon colKey="type" />
              </button>
              <button className={`explorer-list-col-btn explorer-list-status-col ${sortConfig.key === 'status' ? 'active' : ''}`} onClick={() => handleSort('status')}>
                Статус <SortIcon colKey="status" />
              </button>
            </div>

            {currentFolderId && (
              <div
                className={`explorer-list-item explorer-list-back${dragOverBack ? ' drag-over-target' : ''}`}
                onClick={navigateUp}
                onDragOver={draggedItem ? (e) => { e.preventDefault(); setDragOverBack(true); } : undefined}
                onDragLeave={() => setDragOverBack(false)}
                onDrop={draggedItem ? handleDropOnBack : undefined}
              >
                <ArrowLeft size={16} className="explorer-list-icon" />
                <span className="explorer-list-name">Назад</span>
              </div>
            )}

            {displayedFolders.map(folder => (
              <div
                key={folder.id}
                draggable={canEdit}
                className={[
                  'explorer-list-item explorer-list-folder',
                  selectedId === `folder-${folder.id}` ? 'selected' : '',
                  dragOverFolderId === folder.id ? 'drag-over-target' : '',
                  draggedItem?.id === folder.id ? 'dragging' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setSelectedId(`folder-${folder.id}`)}
                onDoubleClick={() => openFolder(folder)}
                onDragStart={canEdit ? (e) => handleDragStart(e, 'folder', folder.id) : undefined}
                onDragOver={(e) => handleDragOver(e, folder.id, true)}
                onDragLeave={() => setDragOverFolderId(null)}
                onDrop={(e) => handleDrop(e, folder.id, 'folder')}
                onDragEnd={handleDragEnd}
              >
                <Folder size={16} className="explorer-list-icon folder" />
                <span className="explorer-list-name">{folder.title}</span>
                <span className="explorer-list-type">Папка</span>
                <div className="explorer-list-status-cell">
                  <div className="explorer-list-actions">
                    {canEdit && (
                      <button title="Редактировать" onClick={(e) => { e.stopPropagation(); setFolderForm(folder); setFolderModal({ open: true, folder }); }}>
                        <Edit size={14} />
                      </button>
                    )}
                    {canDelete && (
                      <button title="Удалить" className="danger" onClick={(e) => { e.stopPropagation(); openDeleteModal('folder', folder); }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {displayedPages.map(page => {
              const iconInfo = getPageIconInfo(page.contentType, page.metadata);
              const IconComponent = iconInfo.Icon;
              return (
                <div
                  key={page.id}
                  draggable={canEdit}
                  className={[
                    'explorer-list-item explorer-list-page',
                    selectedId === `page-${page.id}` ? 'selected' : '',
                    dragOverId === page.id ? 'drag-over-row' : '',
                    draggedItem?.id === page.id ? 'dragging' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setSelectedId(`page-${page.id}`)}
                  onDoubleClick={() => {
                    if (page.contentType === 'file' && !hasFilePreview(page.metadata?.mimeType || page.mediaFile?.mimeType)) {
                      downloadFile(page);
                    } else {
                      openPage(page);
                    }
                  }}
                  onDragStart={canEdit ? (e) => handleDragStart(e, 'page', page.id) : undefined}
                  onDragOver={(e) => handleDragOver(e, page.id, false)}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={(e) => handleDrop(e, page.id, 'page')}
                  onDragEnd={handleDragEnd}
                >
                  <IconComponent size={16} className={`explorer-list-icon ${iconInfo.className}`} />
                  <span className="explorer-list-name">{page.title}</span>
                  <span className="explorer-list-type">{iconInfo.title}</span>
                  <div className="explorer-list-status-cell">
                    <span className={`explorer-item-status ${page.isPublished ? 'published' : 'draft'}`}>
                      {page.isPublished ? 'Опубликовано' : 'Черновик'}
                    </span>
                    <div className="explorer-list-actions">
                      {page.contentType === 'file' ? (
                        <button title="Скачать" onClick={(e) => { e.stopPropagation(); downloadFile(page); }}>
                          <Download size={14} />
                        </button>
                      ) : (
                        <button title="Просмотр" onClick={(e) => { e.stopPropagation(); openPage(page); }}>
                          <Eye size={14} />
                        </button>
                      )}
                      {page.contentType !== 'file' && canEdit && (
                        <button title="Редактировать" onClick={(e) => { e.stopPropagation(); navigate(`/page/${page.slug}/edit`); }}>
                          <Edit size={14} />
                        </button>
                      )}
                      {canEdit && page.contentType === 'file' && hasFilePreview(page.metadata?.mimeType || page.mediaFile?.mimeType) && (
                        <button title="Просмотр" onClick={(e) => { e.stopPropagation(); openPage(page); }}>
                          <Eye size={14} />
                        </button>
                      )}
                      {canDelete && (
                        <button title="Удалить" className="danger" onClick={(e) => { e.stopPropagation(); openDeleteModal('page', page); }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {totalDisplayed === 0 && (
              <div className="empty-state">
                <Folder size={48} />
                <p>{folderSearch ? 'Ничего не найдено' : currentFolderId ? 'Папка пуста' : 'Папки и страницы отсутствуют'}</p>
                {!folderSearch && !currentFolderId && canEdit && <p>Нажмите «Создать», чтобы начать</p>}
              </div>
            )}
          </div>
        ) : (
          /* ── GRID VIEW ── */
          <div className="explorer-grid">
            {currentFolderId && (
              <div
                className={`explorer-item explorer-back${dragOverBack ? ' drag-over-target' : ''}`}
                onClick={navigateUp}
                onDragOver={draggedItem ? (e) => { e.preventDefault(); setDragOverBack(true); } : undefined}
                onDragLeave={() => setDragOverBack(false)}
                onDrop={draggedItem ? handleDropOnBack : undefined}
              >
                <div className="explorer-item-icon"><ArrowLeft size={48} /></div>
                <div className="explorer-item-name">Назад</div>
              </div>
            )}

            {displayedFolders.map(folder => (
              <div
                key={folder.id}
                draggable={canEdit}
                className={[
                  'explorer-item explorer-folder',
                  selectedId === `folder-${folder.id}` ? 'selected' : '',
                  dragOverFolderId === folder.id ? 'drag-over-target' : '',
                  draggedItem?.id === folder.id ? 'dragging' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setSelectedId(`folder-${folder.id}`)}
                onDoubleClick={() => openFolder(folder)}
                onDragStart={canEdit ? (e) => handleDragStart(e, 'folder', folder.id) : undefined}
                onDragOver={(e) => handleDragOver(e, folder.id, true)}
                onDragLeave={() => setDragOverFolderId(null)}
                onDrop={(e) => handleDrop(e, folder.id, 'folder')}
                onDragEnd={handleDragEnd}
              >
                <div className="explorer-item-icon"><Folder size={48} /></div>
                <div className="explorer-item-name">{folder.title}</div>
                {canEdit && (
                  <div className="explorer-item-actions">
                    <button className="actions-menu-btn" onClick={(e) => toggleMenu(`folder-${folder.id}`, e)}>
                      <MoreVertical size={18} />
                    </button>
                    {openMenuId === `folder-${folder.id}` && (
                      <div className="actions-menu" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { setFolderForm(folder); setFolderModal({ open: true, folder }); setOpenMenuId(null); }}>
                          <Edit size={16} /> Редактировать
                        </button>
                        {canDelete && (
                          <button onClick={() => { openDeleteModal('folder', folder); setOpenMenuId(null); }} className="danger">
                            <Trash2 size={16} /> Удалить
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {displayedPages.map(page => {
              const iconInfo = getPageIconInfo(page.contentType, page.metadata);
              const IconComponent = iconInfo.Icon;
              return (
                <div
                  key={page.id}
                  draggable={canEdit}
                  className={[
                    'explorer-item explorer-page',
                    selectedId === `page-${page.id}` ? 'selected' : '',
                    draggedItem?.id === page.id ? 'dragging' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setSelectedId(`page-${page.id}`)}
                  onDoubleClick={() => {
                    if (page.contentType === 'file' && !hasFilePreview(page.metadata?.mimeType || page.mediaFile?.mimeType)) {
                      downloadFile(page);
                    } else {
                      openPage(page);
                    }
                  }}
                  onDragStart={canEdit ? (e) => handleDragStart(e, 'page', page.id) : undefined}
                  onDragOver={(e) => handleDragOver(e, page.id, false)}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={(e) => handleDrop(e, page.id, 'page')}
                  onDragEnd={handleDragEnd}
                  title={iconInfo.title}
                >
                  <div className={`explorer-item-icon ${iconInfo.className}`}>
                    <IconComponent size={48} />
                  </div>
                  <div className="explorer-item-name">{page.title}</div>
                  <div className={`explorer-item-status ${page.isPublished ? 'published' : 'draft'}`}>
                    {page.isPublished ? 'Опубликовано' : 'Черновик'}
                  </div>
                  <div className="explorer-item-actions">
                    <button className="actions-menu-btn" onClick={(e) => toggleMenu(`page-${page.id}`, e)}>
                      <MoreVertical size={18} />
                    </button>
                    {openMenuId === `page-${page.id}` && (
                      <div className="actions-menu" onClick={(e) => e.stopPropagation()}>
                        {page.contentType !== 'file' && (
                          <button onClick={() => { openPage(page); setOpenMenuId(null); }}>
                            <Eye size={16} /> Просмотр
                          </button>
                        )}
                        {page.contentType === 'file' && hasFilePreview(page.metadata?.mimeType || page.mediaFile?.mimeType) && (
                          <button onClick={() => { openPage(page); setOpenMenuId(null); }}>
                            <Eye size={16} /> Просмотр
                          </button>
                        )}
                        {page.contentType === 'file' && (
                          <button onClick={() => { downloadFile(page); setOpenMenuId(null); }}>
                            <Download size={16} /> Скачать
                          </button>
                        )}
                        {canEdit && page.contentType !== 'file' && (
                          <button onClick={() => { navigate(`/page/${page.slug}/edit`); setOpenMenuId(null); }}>
                            <Edit size={16} /> Редактировать
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => { openDeleteModal('page', page); setOpenMenuId(null); }} className="danger">
                            <Trash2 size={16} /> Удалить
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {totalDisplayed === 0 && (
              <div className="empty-state">
                <Folder size={48} />
                <p>{folderSearch ? 'Ничего не найдено' : currentFolderId ? 'Папка пуста' : 'Папки и страницы отсутствуют'}</p>
                {!folderSearch && !currentFolderId && canEdit && <p>Нажмите «Создать», чтобы начать</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Folder Modal */}
      {folderModal.open && (
        <div className="modal-overlay" onClick={() => setFolderModal({ open: false, folder: null })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{folderModal.folder ? 'Редактировать папку' : 'Новая папка'}</h3>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Название</label>
                <input
                  className="input"
                  value={folderForm.title}
                  onChange={e => setFolderForm({ ...folderForm, title: e.target.value })}
                  placeholder="Введите название папки"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Описание</label>
                <textarea
                  className="textarea"
                  value={folderForm.description || ''}
                  onChange={e => setFolderForm({ ...folderForm, description: e.target.value })}
                  placeholder="Необязательное описание"
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Доступ по ролям</label>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  Если не выбрано ни одной роли, папка будет доступна всем. Администраторы видят всё.
                </div>
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.5rem' }}>
                  {allRoles.map(role => {
                    const isChecked = folderForm.allowedRoles?.includes(role.id) || false;
                    return (
                      <label key={role.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => {
                            const newRoles = e.target.checked
                              ? [...(folderForm.allowedRoles || []), role.id]
                              : (folderForm.allowedRoles || []).filter(id => id !== role.id);
                            setFolderForm({ ...folderForm, allowedRoles: newRoles });
                          }}
                          style={{ margin: 0, width: 'auto', height: 'auto', flex: 'none' }}
                        />
                        <span style={{ flex: 'none' }}>{role.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setFolderModal({ open: false, folder: null })}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={handleSaveFolder}>
                <Check size={18} /> Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Upload Modal */}
      {fileUploadModal.open && (
        <div className="modal-overlay" onClick={() => !fileUploadLoading && setFileUploadModal({ open: false })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Загрузить файл</h3>
            </div>
            <div className="modal-body">
              {/* Drop zone */}
              <div
                className={`file-upload-dropzone${fileUploadFile ? ' has-file' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
                onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
                onDrop={e => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('drag-over');
                  const f = e.dataTransfer.files[0];
                  if (f) handleFileSelect(f);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={e => { if (e.target.files[0]) handleFileSelect(e.target.files[0]); }}
                />
                {fileUploadFile ? (
                  <div className="file-upload-selected">
                    <Upload size={24} />
                    <span className="file-upload-name">{fileUploadFile.name}</span>
                    <span className="file-upload-size">{(fileUploadFile.size / 1024 / 1024).toFixed(2)} МБ</span>
                  </div>
                ) : (
                  <div className="file-upload-placeholder">
                    <Upload size={32} />
                    <span>Перетащите файл или нажмите для выбора</span>
                  </div>
                )}
              </div>

              {fileUploadLoading && (
                <div className="file-upload-progress">
                  <div className="file-upload-progress-bar" style={{ width: `${fileUploadProgress}%` }} />
                  <span>{fileUploadProgress}%</span>
                </div>
              )}

              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label className="form-label">Название</label>
                <input
                  className="input"
                  value={fileUploadForm.title}
                  onChange={e => setFileUploadForm({ ...fileUploadForm, title: e.target.value })}
                  placeholder="Название файла в проводнике"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Описание</label>
                <textarea
                  className="textarea"
                  value={fileUploadForm.description}
                  onChange={e => setFileUploadForm({ ...fileUploadForm, description: e.target.value })}
                  placeholder="Необязательное описание"
                  rows={2}
                />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={fileUploadForm.isPublished}
                    onChange={e => setFileUploadForm({ ...fileUploadForm, isPublished: e.target.checked })}
                    style={{ margin: 0, width: 'auto', height: 'auto', flex: 'none' }}
                  />
                  <span>Опубликовать сразу</span>
                </label>
              </div>
              <div className="form-group">
                <label className="form-label">Доступ по ролям</label>
                <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.5rem' }}>
                  {allRoles.map(role => {
                    const isChecked = fileUploadForm.allowedRoles?.includes(role.id) || false;
                    return (
                      <label key={role.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => {
                            const newRoles = e.target.checked
                              ? [...(fileUploadForm.allowedRoles || []), role.id]
                              : (fileUploadForm.allowedRoles || []).filter(id => id !== role.id);
                            setFileUploadForm({ ...fileUploadForm, allowedRoles: newRoles });
                          }}
                          style={{ margin: 0, width: 'auto', height: 'auto', flex: 'none' }}
                        />
                        <span>{role.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setFileUploadModal({ open: false })} disabled={fileUploadLoading}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={handleFileUploadSave} disabled={fileUploadLoading}>
                {fileUploadLoading ? <div className="loading-spinner" style={{ width: 16, height: 16 }} /> : <Upload size={16} />}
                {fileUploadLoading ? 'Загрузка...' : 'Загрузить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteModal.open && (
        <div className="modal-overlay" onClick={() => setDeleteModal({ open: false, type: null, item: null })}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3>Подтверждение удаления</h3></div>
            <div className="modal-body">
              <p>
                Вы уверены, что хотите удалить {deleteModal.type === 'folder' ? 'папку' : 'страницу'}
                <strong> "{deleteModal.item?.title}"</strong>?
              </p>
              {deleteModal.type === 'folder' && (
                <p className="text-warning">Все вложенные папки и страницы также будут удалены!</p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteModal({ open: false, type: null, item: null })}>
                Отмена
              </button>
              <button className="btn btn-error" onClick={confirmDelete}>
                <Trash2 size={18} /> Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
