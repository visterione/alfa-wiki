import React, { useState, useEffect } from 'react';
import { Download, X, FileText, Table as TableIcon, FileCode, Calendar, User, Folder, Search } from 'lucide-react';
import { journal, pages, users, folders } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

export default function AdminJournal() {
  // === STATE ===
  const [pageList, setPageList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  // Фильтры
  const [filters, setFilters] = useState({
    contentType: '',
    dateFrom: '',
    dateTo: '',
    folderId: '',
    createdBy: '',
    isPublished: ''
  });

  // Данные для фильтров
  const [userList, setUserList] = useState([]);
  const [folderList, setFolderList] = useState([]);

  // Пагинация
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);

  // === ЗАГРУЗКА ДАННЫХ ===
  useEffect(() => {
    loadUsers();
    loadFolders();
  }, []);

  useEffect(() => {
    loadJournal();
  }, [filters, currentPage, searchQuery]);

  const loadUsers = async () => {
    try {
      const { data } = await users.list();
      setUserList(data.rows || data);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadFolders = async () => {
    try {
      const { data } = await folders.tree();
      setFolderList(data);
    } catch (error) {
      console.error('Error loading folders:', error);
    }
  };

  const loadJournal = async () => {
    setLoading(true);
    try {
      const params = {
        search: searchQuery,
        ...filters,
        limit: itemsPerPage,
        offset: (currentPage - 1) * itemsPerPage
      };

      // Очищаем пустые фильтры
      Object.keys(params).forEach(key => {
        if (params[key] === '') delete params[key];
      });

      const { data } = await journal.list(params);
      setPageList(data.rows);
      setTotalCount(data.count);
    } catch (error) {
      toast.error('Ошибка загрузки журнала');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  // === ОБРАБОТЧИКИ ===
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1); // Сброс на первую страницу при изменении фильтров
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setFilters({
      contentType: '',
      dateFrom: '',
      dateTo: '',
      folderId: '',
      createdBy: '',
      isPublished: ''
    });
    setCurrentPage(1);
  };

  const handleDownloadPdf = async (pageId, pageTitle) => {
    try {
      const response = await pages.exportHistoryPdf(pageId);

      // Создаем ссылку для скачивания
      const url = `${process.env.REACT_APP_API_URL || 'http://localhost:9001'}/${response.data.filePath}`;
      const link = document.createElement('a');
      link.href = url;
      link.download = `История изменений - ${pageTitle}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('PDF отчет создан');
    } catch (error) {
      toast.error('Ошибка создания PDF');
      console.error(error);
    }
  };

  // === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
  const getPageTypeIcon = (contentType) => {
    switch (contentType) {
      case 'spreadsheet': return <TableIcon size={16} />;
      case 'html': return <FileCode size={16} />;
      default: return <FileText size={16} />;
    }
  };

  const getPageTypeLabel = (contentType) => {
    switch (contentType) {
      case 'spreadsheet': return 'Таблица';
      case 'html': return 'HTML';
      case 'wysiwyg': return 'WYSIWYG';
      default: return contentType;
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const totalPages = Math.ceil(totalCount / itemsPerPage);

  // === RENDER ===
  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>Журнал страниц</h1>
      </div>

      {/* ПОИСКОВАЯ СТРОКА */}
      <div className="admin-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Поиск по названию..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* ФИЛЬТРЫ */}
      <div className="admin-filters-panel">
        <div className="admin-filters-row">
          {/* Фильтр по типу страницы */}
          <div className="form-group">
            <label className="form-label">
              <FileText size={14} />
              Тип страницы
            </label>
            <select
              className="form-control"
              value={filters.contentType}
              onChange={(e) => handleFilterChange('contentType', e.target.value)}
            >
              <option value="">Все типы</option>
              <option value="wysiwyg">WYSIWYG</option>
              <option value="html">HTML</option>
              <option value="spreadsheet">Таблица</option>
            </select>
          </div>

          {/* Фильтр по папке */}
          <div className="form-group">
            <label className="form-label">
              <Folder size={14} />
              Папка
            </label>
            <select
              className="form-control"
              value={filters.folderId}
              onChange={(e) => handleFilterChange('folderId', e.target.value)}
            >
              <option value="">Все папки</option>
              <option value="null">Корневая папка</option>
              {folderList.map(folder => (
                <option key={folder.id} value={folder.id}>
                  {folder.title}
                </option>
              ))}
            </select>
          </div>

          {/* Фильтр по дате С */}
          <div className="form-group">
            <label className="form-label">
              <Calendar size={14} />
              Изменено с
            </label>
            <input
              type="date"
              className="form-control"
              value={filters.dateFrom}
              onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
            />
          </div>

          {/* Фильтр по дате ПО */}
          <div className="form-group">
            <label className="form-label">
              <Calendar size={14} />
              Изменено до
            </label>
            <input
              type="date"
              className="form-control"
              value={filters.dateTo}
              onChange={(e) => handleFilterChange('dateTo', e.target.value)}
            />
          </div>

          {/* Фильтр по автору */}
          <div className="form-group">
            <label className="form-label">
              <User size={14} />
              Автор
            </label>
            <select
              className="form-control"
              value={filters.createdBy}
              onChange={(e) => handleFilterChange('createdBy', e.target.value)}
            >
              <option value="">Все авторы</option>
              {userList.map(user => (
                <option key={user.id} value={user.id}>
                  {user.displayName || user.username}
                </option>
              ))}
            </select>
          </div>

          {/* Фильтр по статусу публикации */}
          <div className="form-group">
            <label className="form-label">Статус</label>
            <select
              className="form-control"
              value={filters.isPublished}
              onChange={(e) => handleFilterChange('isPublished', e.target.value)}
            >
              <option value="">Все статусы</option>
              <option value="true">Опубликовано</option>
              <option value="false">Черновик</option>
            </select>
          </div>

          {/* Кнопка очистки фильтров */}
          <button
            className="btn btn-secondary filter-reset-btn"
            onClick={handleClearFilters}
          >
            <X size={16} />
            Сбросить
          </button>
        </div>
      </div>

      {/* ТАБЛИЦА */}
      <div className="admin-table-container">
        {loading ? (
          <div className="admin-loading">
            <div className="loading-spinner" />
            <p>Загрузка журнала...</p>
          </div>
        ) : pageList.length === 0 ? (
          <div className="admin-empty-state">
            <FileText size={48} />
            <p>Страницы не найдены</p>
          </div>
        ) : (
          <>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Название</th>
                  <th>Путь (папка)</th>
                  <th>Автор</th>
                  <th>Последнее изменение</th>
                  <th>Статус</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {pageList.map(page => (
                  <tr key={page.id}>
                    <td>
                      <div className="page-type-badge">
                        {getPageTypeIcon(page.contentType)}
                        <span>{getPageTypeLabel(page.contentType)}</span>
                      </div>
                    </td>
                    <td>
                      <a
                        href={`/page/${page.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="page-title-link"
                      >
                        {page.title}
                      </a>
                    </td>
                    <td>
                      <span className="folder-path">
                        {page.folderPath || '(Корневая папка)'}
                      </span>
                    </td>
                    <td>
                      {page.author?.displayName || page.author?.username || '—'}
                    </td>
                    <td>
                      <div className="date-cell">
                        <Calendar size={14} />
                        {formatDate(page.updatedAt)}
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${page.isPublished ? 'published' : 'draft'}`}>
                        {page.isPublished ? 'Опубликовано' : 'Черновик'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-icon"
                        onClick={() => handleDownloadPdf(page.id, page.title)}
                        title="Скачать PDF отчет"
                      >
                        <Download size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ПАГИНАЦИЯ */}
            {totalPages > 1 && (
              <div className="admin-pagination">
                <div className="admin-pagination-info">
                  Показано {pageList.length} из {totalCount}
                </div>
                <div className="admin-pagination-controls">
                  <button
                    className="btn btn-secondary"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => prev - 1)}
                  >
                    Назад
                  </button>
                  <span className="pagination-page">
                    Страница {currentPage} из {totalPages}
                  </span>
                  <button
                    className="btn btn-secondary"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(prev => prev + 1)}
                  >
                    Вперед
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
