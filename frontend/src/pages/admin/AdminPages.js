import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FolderPlus, FilePlus, Folder, FolderOpen, FileText, 
  ChevronRight, Home, Edit, Trash2, Eye, MoreVertical,
  ArrowLeft, Check, X
} from 'lucide-react';
import { folders, pages } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

export default function AdminPages() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [folderList, setFolderList] = useState([]);
  const [pageList, setPageList] = useState([]);
  
  // Modals
  const [folderModal, setFolderModal] = useState({ open: false, folder: null });
  const [pageModal, setPageModal] = useState({ open: false, page: null });
  const [deleteModal, setDeleteModal] = useState({ open: false, type: null, item: null });
  
  // Forms
  const [folderForm, setFolderForm] = useState({ title: '', icon: 'folder', description: '' });
  const [pageForm, setPageForm] = useState({ title: '', icon: 'file-text' });

  useEffect(() => {
    loadContent();
  }, [currentFolderId]);

  const loadContent = async () => {
    setLoading(true);
    try {
      const { data } = await folders.browse(currentFolderId);
      setFolderList(data.folders || []);
      setPageList(data.pages || []);
      setBreadcrumbs(data.breadcrumbs || []);
    } catch (error) {
      toast.error('Ошибка загрузки');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // Navigation
  const navigateToFolder = (folderId) => {
    setCurrentFolderId(folderId);
  };

  const navigateUp = () => {
    if (breadcrumbs.length > 0) {
      const parent = breadcrumbs[breadcrumbs.length - 1];
      // Переходим к родителю текущей папки
      const parentBreadcrumb = breadcrumbs[breadcrumbs.length - 2];
      setCurrentFolderId(parentBreadcrumb?.id || null);
    } else {
      setCurrentFolderId(null);
    }
  };

  // Folder CRUD
  const openFolderModal = (folder = null) => {
    if (folder) {
      setFolderForm({ title: folder.title, icon: folder.icon || 'folder', description: folder.description || '' });
    } else {
      setFolderForm({ title: '', icon: 'folder', description: '' });
    }
    setFolderModal({ open: true, folder });
  };

  const saveFolderHandler = async () => {
    if (!folderForm.title.trim()) {
      toast.error('Введите название папки');
      return;
    }

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

  // Page CRUD
  const openPageModal = (page = null) => {
    if (page) {
      setPageForm({ title: page.title, icon: page.icon || 'file-text' });
    } else {
      setPageForm({ title: '', icon: 'file-text' });
    }
    setPageModal({ open: true, page });
  };

  const savePageHandler = async () => {
    if (!pageForm.title.trim()) {
      toast.error('Введите название страницы');
      return;
    }

    try {
      if (pageModal.page) {
        await pages.update(pageModal.page.id, pageForm);
        toast.success('Страница обновлена');
        setPageModal({ open: false, page: null });
        loadContent();
      } else {
        const { data } = await pages.create({ 
          ...pageForm, 
          folderId: currentFolderId,
          contentType: 'wysiwyg',
          content: ''
        });
        toast.success('Страница создана');
        setPageModal({ open: false, page: null });
        // Открываем редактор для новой страницы
        navigate(`/page/${data.slug}/edit`);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка сохранения');
    }
  };

  // Delete
  const openDeleteModal = (type, item) => {
    setDeleteModal({ open: true, type, item });
  };

  const confirmDelete = async () => {
    const { type, item } = deleteModal;
    try {
      if (type === 'folder') {
        await folders.delete(item.id);
        toast.success('Папка удалена');
      } else {
        await pages.delete(item.id);
        toast.success('Страница удалена');
      }
      setDeleteModal({ open: false, type: null, item: null });
      loadContent();
    } catch (error) {
      toast.error('Ошибка удаления');
    }
  };

  // Check nesting level
  const canCreateSubfolder = breadcrumbs.length < 2;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Страницы и папки</h1>
        <div className="admin-header-actions">
          {canCreateSubfolder && (
            <button className="btn btn-secondary" onClick={() => openFolderModal()}>
              <FolderPlus size={18} /> Папка
            </button>
          )}
          <button className="btn btn-primary" onClick={() => openPageModal()}>
            <FilePlus size={18} /> Страница
          </button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="explorer-breadcrumbs">
        <button 
          className={`breadcrumb-item ${!currentFolderId ? 'active' : ''}`}
          onClick={() => navigateToFolder(null)}
        >
          <Home size={16} />
          <span>Корень</span>
        </button>
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={crumb.id}>
            <ChevronRight size={16} className="breadcrumb-separator" />
            <button 
              className={`breadcrumb-item ${idx === breadcrumbs.length - 1 ? 'active' : ''}`}
              onClick={() => navigateToFolder(crumb.id)}
            >
              <Folder size={16} />
              <span>{crumb.title}</span>
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Content */}
      <div className="card">
        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : (
          <div className="explorer-grid">
            {/* Back button if not in root */}
            {currentFolderId && (
              <div className="explorer-item explorer-back" onClick={navigateUp}>
                <div className="explorer-item-icon">
                  <ArrowLeft size={32} />
                </div>
                <div className="explorer-item-name">Назад</div>
              </div>
            )}

            {/* Folders */}
            {folderList.map(folder => (
              <div 
                key={folder.id} 
                className="explorer-item explorer-folder"
                onDoubleClick={() => navigateToFolder(folder.id)}
              >
                <div className="explorer-item-icon">
                  <Folder size={32} />
                </div>
                <div className="explorer-item-name">{folder.title}</div>
                <div className="explorer-item-actions">
                  <button onClick={(e) => { e.stopPropagation(); openFolderModal(folder); }} title="Редактировать">
                    <Edit size={14} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openDeleteModal('folder', folder); }} title="Удалить">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            {/* Pages */}
            {pageList.map(page => (
              <div 
                key={page.id} 
                className="explorer-item explorer-page"
                onDoubleClick={() => navigate(`/page/${page.slug}/edit`)}
              >
                <div className="explorer-item-icon">
                  <FileText size={32} />
                </div>
                <div className="explorer-item-name">{page.title}</div>
                <div className={`explorer-item-status ${page.isPublished ? 'published' : 'draft'}`}>
                  {page.isPublished ? 'Опубликовано' : 'Черновик'}
                </div>
                <div className="explorer-item-actions">
                  <button onClick={(e) => { e.stopPropagation(); window.open(`/page/${page.slug}`, '_blank'); }} title="Просмотр">
                    <Eye size={14} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); navigate(`/page/${page.slug}/edit`); }} title="Редактировать">
                    <Edit size={14} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openDeleteModal('page', page); }} title="Удалить">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}

            {/* Empty state */}
            {folderList.length === 0 && pageList.length === 0 && !currentFolderId && (
              <div className="explorer-empty">
                <Folder size={48} />
                <p>Папки и страницы отсутствуют</p>
                <p>Создайте первую папку или страницу</p>
              </div>
            )}
            {folderList.length === 0 && pageList.length === 0 && currentFolderId && (
              <div className="explorer-empty">
                <FolderOpen size={48} />
                <p>Папка пуста</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Folder Modal */}
      {folderModal.open && (
        <div className="modal-overlay" onClick={() => setFolderModal({ open: false, folder: null })}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{folderModal.folder ? 'Редактировать папку' : 'Новая папка'}</h2>
              <button className="modal-close" onClick={() => setFolderModal({ open: false, folder: null })}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Название *</label>
                <input
                  type="text"
                  className="input"
                  value={folderForm.title}
                  onChange={e => setFolderForm({ ...folderForm, title: e.target.value })}
                  placeholder="Название папки"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Описание</label>
                <textarea
                  className="input"
                  rows={3}
                  value={folderForm.description}
                  onChange={e => setFolderForm({ ...folderForm, description: e.target.value })}
                  placeholder="Описание (необязательно)"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setFolderModal({ open: false, folder: null })}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={saveFolderHandler}>
                {folderModal.folder ? 'Сохранить' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page Modal (quick create) */}
      {pageModal.open && !pageModal.page && (
        <div className="modal-overlay" onClick={() => setPageModal({ open: false, page: null })}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Новая страница</h2>
              <button className="modal-close" onClick={() => setPageModal({ open: false, page: null })}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Название *</label>
                <input
                  type="text"
                  className="input"
                  value={pageForm.title}
                  onChange={e => setPageForm({ ...pageForm, title: e.target.value })}
                  placeholder="Название страницы"
                  autoFocus
                />
              </div>
              <p className="form-hint">После создания откроется редактор страницы</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPageModal({ open: false, page: null })}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={savePageHandler}>
                Создать
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteModal.open && (
        <div className="modal-overlay" onClick={() => setDeleteModal({ open: false, type: null, item: null })}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Подтверждение удаления</h2>
            </div>
            <div className="modal-body">
              {deleteModal.type === 'folder' ? (
                <p>Удалить папку <strong>"{deleteModal.item?.title}"</strong> и всё её содержимое?</p>
              ) : (
                <p>Удалить страницу <strong>"{deleteModal.item?.title}"</strong>?</p>
              )}
              <p className="text-danger" style={{ marginTop: 8, fontSize: 13 }}>
                Это действие необратимо!
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDeleteModal({ open: false, type: null, item: null })}>
                Отмена
              </button>
              <button className="btn btn-danger" onClick={confirmDelete}>
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}