import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FolderPlus, FilePlus, Folder, FolderOpen, FileText, 
  ChevronRight, Home, Edit, Trash2, Eye, MoreVertical,
  ArrowLeft, Check, X, AlertCircle
} from 'lucide-react';
import { folders, pages } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import '../Admin.css';

export default function AdminPages() {
  const navigate = useNavigate();
  const { isAdmin, hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [currentFolderId, setCurrentFolderId] = useState(null);
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [folderList, setFolderList] = useState([]);
  const [pageList, setPageList] = useState([]);
  const [openMenuId, setOpenMenuId] = useState(null); // Для отслеживания открытого меню
  
  // Modals
  const [folderModal, setFolderModal] = useState({ open: false, folder: null });
  const [pageModal, setPageModal] = useState({ open: false, page: null });
  const [deleteModal, setDeleteModal] = useState({ open: false, type: null, item: null });
  
  // Forms
  const [folderForm, setFolderForm] = useState({ title: '', icon: 'folder', description: '' });
  const [pageForm, setPageForm] = useState({ title: '', icon: 'file-text' });

  // Проверка прав
  const canEdit = isAdmin || hasPermission('pages', 'write');
  const canDelete = isAdmin || hasPermission('pages', 'delete');

  useEffect(() => {
    loadContent();
  }, [currentFolderId]);

  // Закрытие меню при клике вне его
  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);

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
      const parent = breadcrumbs[breadcrumbs.length - 2];
      setCurrentFolderId(parent ? parent.id : null);
    }
  };

  // Modals
  const openFolderModal = (folder = null) => {
    if (!canEdit) {
      toast.error('У вас нет прав на создание/редактирование папок');
      return;
    }
    setFolderForm(folder || { title: '', icon: 'folder', description: '' });
    setFolderModal({ open: true, folder });
  };

  const openPageModal = (page = null) => {
    if (!canEdit) {
      toast.error('У вас нет прав на создание/редактирование страниц');
      return;
    }
    setPageForm(page || { title: '', icon: 'file-text' });
    setPageModal({ open: true, page });
  };

  // Save handlers
  const handleSaveFolder = async () => {
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

  const handleSavePage = async () => {
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
    if (!canDelete) {
      toast.error('У вас нет прав на удаление');
      return;
    }
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

  // Меню действий
  const toggleMenu = (itemId, e) => {
    e.stopPropagation();
    setOpenMenuId(openMenuId === itemId ? null : itemId);
  };

  // Check nesting level
  const canCreateSubfolder = breadcrumbs.length < 2;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Проводник страниц</h1>
        {canEdit && (
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
        )}
      </div>

      {/* Информационное сообщение для пользователей без прав */}
      {!canEdit && (
        <div className="info-banner">
          <AlertCircle size={20} />
          <div>
            <strong>Режим просмотра</strong>
            <p>У вас нет прав на создание и редактирование страниц. Вы можете только просматривать существующий контент.</p>
          </div>
        </div>
      )}

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
                  <ArrowLeft size={48} />
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
                  <Folder size={48} />
                </div>
                <div className="explorer-item-name">{folder.title}</div>
                {canEdit && (
                  <div className="explorer-item-actions">
                    <button 
                      className="actions-menu-btn"
                      onClick={(e) => toggleMenu(`folder-${folder.id}`, e)}
                    >
                      <MoreVertical size={18} />
                    </button>
                    {openMenuId === `folder-${folder.id}` && (
                      <div className="actions-menu" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { openFolderModal(folder); setOpenMenuId(null); }}>
                          <Edit size={16} />
                          Редактировать
                        </button>
                        {canDelete && (
                          <button onClick={() => { openDeleteModal('folder', folder); setOpenMenuId(null); }} className="danger">
                            <Trash2 size={16} />
                            Удалить
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Pages */}
            {pageList.map(page => (
              <div 
                key={page.id} 
                className="explorer-item explorer-page"
                onDoubleClick={() => navigate(canEdit ? `/page/${page.slug}/edit` : `/page/${page.slug}`)}
              >
                <div className="explorer-item-icon">
                  <FileText size={48} />
                </div>
                <div className="explorer-item-name">{page.title}</div>
                <div className={`explorer-item-status ${page.isPublished ? 'published' : 'draft'}`}>
                  {page.isPublished ? 'Опубликовано' : 'Черновик'}
                </div>
                <div className="explorer-item-actions">
                  <button 
                    className="actions-menu-btn"
                    onClick={(e) => toggleMenu(`page-${page.id}`, e)}
                  >
                    <MoreVertical size={18} />
                  </button>
                  {openMenuId === `page-${page.id}` && (
                    <div className="actions-menu" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { navigate(`/page/${page.slug}`); setOpenMenuId(null); }}>
                        <Eye size={16} />
                        Просмотр
                      </button>
                      {canEdit && (
                        <button onClick={() => { navigate(`/page/${page.slug}/edit`); setOpenMenuId(null); }}>
                          <Edit size={16} />
                          Редактировать
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => { openDeleteModal('page', page); setOpenMenuId(null); }} className="danger">
                          <Trash2 size={16} />
                          Удалить
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Empty state */}
            {folderList.length === 0 && pageList.length === 0 && !currentFolderId && (
              <div className="empty-state">
                <Folder size={48} />
                <p>Папки и страницы отсутствуют</p>
                {canEdit && <p>Создайте первую папку или страницу</p>}
              </div>
            )}
            {folderList.length === 0 && pageList.length === 0 && currentFolderId && (
              <div className="empty-state">
                <Folder size={48} />
                <p>Папка пуста</p>
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
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setFolderModal({ open: false, folder: null })}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={handleSaveFolder}>
                <Check size={18} />
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page Modal */}
      {pageModal.open && (
        <div className="modal-overlay" onClick={() => setPageModal({ open: false, page: null })}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{pageModal.page ? 'Редактировать страницу' : 'Новая страница'}</h3>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Название</label>
                <input
                  className="input"
                  value={pageForm.title}
                  onChange={e => setPageForm({ ...pageForm, title: e.target.value })}
                  placeholder="Введите название страницы"
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPageModal({ open: false, page: null })}>
                Отмена
              </button>
              <button className="btn btn-primary" onClick={handleSavePage}>
                <Check size={18} />
                {pageModal.page ? 'Сохранить' : 'Создать'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteModal.open && (
        <div className="modal-overlay" onClick={() => setDeleteModal({ open: false, type: null, item: null })}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Подтверждение удаления</h3>
            </div>
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
                <Trash2 size={18} />
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}