import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Download, X, FileText, Table as TableIcon, FileCode, Calendar, User, Folder, Search, History, Activity } from 'lucide-react';
import { journal, pages, folders } from '../../services/api';
import { BASE_URL } from '../../services/api';
import toast from 'react-hot-toast';
import PageHistoryModal from '../../components/PageHistoryModal';
import '../Admin.css';

const MONTHS_RU = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

function formatDate(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
}

export default function AdminJournal() {
  const [activeTab, setActiveTab] = useState('pages');

  // === PAGES TAB STATE ===
  const [pageList, setPageList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    contentType: '', dateFrom: '', dateTo: '', folderId: '', createdBy: '', isPublished: ''
  });
  const [authorList, setAuthorList] = useState([]);
  const [folderList, setFolderList] = useState([]);
  const [historyPage, setHistoryPage] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);

  // === ACTIVITIES TAB STATE ===
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesTotalCount, setActivitiesTotalCount] = useState(0);
  const [activityModules, setActivityModules] = useState([]);
  const [activityFilters, setActivityFilters] = useState({
    pageSlug: '', userId: '', dateFrom: '', dateTo: ''
  });
  const [activityPage, setActivityPage] = useState(1);
  const [activityItemsPerPage] = useState(100);

  // === INITIAL LOAD ===
  useEffect(() => {
    loadPageAuthors();
    loadFolders();
    loadActivityModules();
  }, []);

  useEffect(() => {
    if (activeTab === 'pages') loadJournal();
  }, [filters, currentPage, searchQuery, activeTab]);

  useEffect(() => {
    if (activeTab === 'activities') loadActivities();
  }, [activityFilters, activityPage, activeTab]);

  const loadPageAuthors = async () => {
    try {
      const { data } = await journal.pageAuthors();
      setAuthorList(data);
    } catch (error) {
      console.error('Error loading page authors:', error);
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

  const loadActivityModules = async () => {
    try {
      const { data } = await journal.activityModules();
      setActivityModules(data);
    } catch (error) {
      console.error('Error loading activity modules:', error);
    }
  };

  const loadJournal = async () => {
    setLoading(true);
    try {
      const params = { search: searchQuery, ...filters, limit: itemsPerPage, offset: (currentPage - 1) * itemsPerPage };
      Object.keys(params).forEach(key => { if (params[key] === '') delete params[key]; });
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

  const loadActivities = async () => {
    setActivitiesLoading(true);
    try {
      const params = { ...activityFilters, limit: activityItemsPerPage, offset: (activityPage - 1) * activityItemsPerPage };
      Object.keys(params).forEach(key => { if (params[key] === '') delete params[key]; });
      const { data } = await journal.activities(params);
      setActivities(data.rows);
      setActivitiesTotalCount(data.count);
    } catch (error) {
      toast.error('Ошибка загрузки активности');
      console.error(error);
    } finally {
      setActivitiesLoading(false);
    }
  };

  // === HANDLERS ===
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setFilters({ contentType: '', dateFrom: '', dateTo: '', folderId: '', createdBy: '', isPublished: '' });
    setCurrentPage(1);
  };

  const handleActivityFilterChange = (key, value) => {
    setActivityFilters(prev => ({ ...prev, [key]: value }));
    setActivityPage(1);
  };

  const handleClearActivityFilters = () => {
    setActivityFilters({ pageSlug: '', userId: '', dateFrom: '', dateTo: '' });
    setActivityPage(1);
  };

  const handleDownloadPdf = async (pageId, pageTitle) => {
    try {
      const response = await pages.exportHistoryPdf(pageId);
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

  // === HELPERS ===
  const getPageTypeIcon = (contentType) => {
    switch (contentType) {
      case 'spreadsheet': return <TableIcon size={16} style={{ color: '#16a34a' }} />;
      case 'html': return <FileCode size={16} style={{ color: '#f97316' }} />;
      default: return <FileText size={16} style={{ color: '#3b82f6' }} />;
    }
  };

  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const activityTotalPages = Math.ceil(activitiesTotalCount / activityItemsPerPage);

  // === RENDER ===
  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>Журнал изменений</h1>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-color, #e5e7eb)' }}>
        <button
          onClick={() => setActiveTab('pages')}
          style={{
            padding: '8px 18px', border: 'none', cursor: 'pointer', background: 'none', fontWeight: 500,
            fontSize: 14, color: activeTab === 'pages' ? '#2563eb' : '#6b7280',
            borderBottom: activeTab === 'pages' ? '2px solid #2563eb' : '2px solid transparent',
            marginBottom: -1
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileText size={15} />Страницы Wiki
          </span>
        </button>
        <button
          onClick={() => setActiveTab('activities')}
          style={{
            padding: '8px 18px', border: 'none', cursor: 'pointer', background: 'none', fontWeight: 500,
            fontSize: 14, color: activeTab === 'activities' ? '#2563eb' : '#6b7280',
            borderBottom: activeTab === 'activities' ? '2px solid #2563eb' : '2px solid transparent',
            marginBottom: -1
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={15} />Активность модулей
          </span>
        </button>
      </div>

      {activeTab === 'pages' && (
        <>
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

          <div className="admin-filters-panel">
            <div className="admin-filters-row">
              <div className="form-group">
                <label className="form-label"><FileText size={14} />Тип страницы</label>
                <select className="form-control" value={filters.contentType} onChange={(e) => handleFilterChange('contentType', e.target.value)}>
                  <option value="">Все типы</option>
                  <option value="wysiwyg">Документ</option>
                  <option value="html">HTML</option>
                  <option value="spreadsheet">Таблица</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><Folder size={14} />Папка</label>
                <select className="form-control" value={filters.folderId} onChange={(e) => handleFilterChange('folderId', e.target.value)}>
                  <option value="">Все папки</option>
                  <option value="null">Корневая папка</option>
                  {folderList.map(folder => (
                    <option key={folder.id} value={folder.id}>{folder.title}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><Calendar size={14} />Изменено с</label>
                <input type="date" className="form-control" value={filters.dateFrom} onChange={(e) => handleFilterChange('dateFrom', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label"><Calendar size={14} />Изменено до</label>
                <input type="date" className="form-control" value={filters.dateTo} onChange={(e) => handleFilterChange('dateTo', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label"><User size={14} />Автор</label>
                <select className="form-control" value={filters.createdBy} onChange={(e) => handleFilterChange('createdBy', e.target.value)}>
                  <option value="">Все авторы</option>
                  {authorList.map(user => (
                    <option key={user.id} value={user.id}>{user.displayName || user.username}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Статус</label>
                <select className="form-control" value={filters.isPublished} onChange={(e) => handleFilterChange('isPublished', e.target.value)}>
                  <option value="">Все статусы</option>
                  <option value="true">Опубликовано</option>
                  <option value="false">Черновик</option>
                </select>
              </div>
              <button className="btn btn-secondary filter-reset-btn" onClick={handleClearFilters}>
                <X size={16} />Сбросить
              </button>
            </div>
          </div>

          <div className="admin-table-container">
            {loading ? (
              <div className="admin-loading"><div className="loading-spinner" /><p>Загрузка журнала...</p></div>
            ) : pageList.length === 0 ? (
              <div className="admin-empty-state"><FileText size={48} /><p>Страницы не найдены</p></div>
            ) : (
              <>
                <table className="admin-table">
                  <thead>
                    <tr>
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {getPageTypeIcon(page.contentType)}
                            <a href={`/page/${page.slug}`} target="_blank" rel="noopener noreferrer" className="page-title-link">
                              {page.title}
                            </a>
                          </div>
                        </td>
                        <td><span className="folder-path">{page.folderPath || '(Корневая папка)'}</span></td>
                        <td>{page.author?.id ? <Link to={`/users/${page.author.id}`} className="user-profile-link">{page.author.displayName || page.author.username}</Link> : (page.author?.displayName || page.author?.username || '—')}</td>
                        <td>
                          <div className="date-cell"><Calendar size={14} />{formatDate(page.updatedAt)}</div>
                        </td>
                        <td>
                          <span className={`status-badge ${page.isPublished ? 'published' : 'draft'}`}>
                            {page.isPublished ? 'Опубликовано' : 'Черновик'}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-icon" onClick={() => setHistoryPage({ id: page.id, title: page.title })} title="Просмотреть историю изменений">
                            <History size={16} />
                          </button>
                          <button className="btn btn-icon" onClick={() => handleDownloadPdf(page.id, page.title)} title="Скачать PDF отчет">
                            <Download size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="admin-pagination">
                    <div className="admin-pagination-info">Показано {pageList.length} из {totalCount}</div>
                    <div className="admin-pagination-controls">
                      <button className="btn btn-secondary" disabled={currentPage === 1} onClick={() => setCurrentPage(prev => prev - 1)}>Назад</button>
                      <span className="pagination-page">Страница {currentPage} из {totalPages}</span>
                      <button className="btn btn-secondary" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(prev => prev + 1)}>Вперед</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {activeTab === 'activities' && (
        <>
          <div className="admin-filters-panel">
            <div className="admin-filters-row">
              <div className="form-group">
                <label className="form-label"><Activity size={14} />Раздел</label>
                <select className="form-control" value={activityFilters.pageSlug} onChange={e => handleActivityFilterChange('pageSlug', e.target.value)}>
                  <option value="">Все разделы</option>
                  {activityModules.map(m => (
                    <option key={m.slug} value={m.slug}>{m.label} ({m.count})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><Calendar size={14} />С даты</label>
                <input type="date" className="form-control" value={activityFilters.dateFrom} onChange={e => handleActivityFilterChange('dateFrom', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label"><Calendar size={14} />По дату</label>
                <input type="date" className="form-control" value={activityFilters.dateTo} onChange={e => handleActivityFilterChange('dateTo', e.target.value)} />
              </div>
              <button className="btn btn-secondary filter-reset-btn" onClick={handleClearActivityFilters}>
                <X size={16} />Сбросить
              </button>
            </div>
          </div>

          <div className="admin-table-container">
            {activitiesLoading ? (
              <div className="admin-loading"><div className="loading-spinner" /><p>Загрузка активности...</p></div>
            ) : activities.length === 0 ? (
              <div className="admin-empty-state"><Activity size={48} /><p>Записей не найдено</p></div>
            ) : (
              <>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Дата и время</th>
                      <th>Пользователь</th>
                      <th>Раздел</th>
                      <th>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map(entry => (
                      <tr key={entry.id}>
                        <td>
                          <div className="date-cell"><Calendar size={14} />{formatDate(entry.createdAt)}</div>
                        </td>
                        <td>
                          {entry.user?.id
                            ? <Link to={`/users/${entry.user.id}`} className="user-profile-link">{entry.user.displayName || entry.user.username}</Link>
                            : '—'}
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                            background: '#eff6ff', color: '#1d4ed8'
                          }}>
                            {entry.moduleLabel}
                          </span>
                        </td>
                        <td style={{ maxWidth: 480 }}>{entry.changesSummary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {activityTotalPages > 1 && (
                  <div className="admin-pagination">
                    <div className="admin-pagination-info">Показано {activities.length} из {activitiesTotalCount}</div>
                    <div className="admin-pagination-controls">
                      <button className="btn btn-secondary" disabled={activityPage === 1} onClick={() => setActivityPage(prev => prev - 1)}>Назад</button>
                      <span className="pagination-page">Страница {activityPage} из {activityTotalPages}</span>
                      <button className="btn btn-secondary" disabled={activityPage >= activityTotalPages} onClick={() => setActivityPage(prev => prev + 1)}>Вперед</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {historyPage && (
        <PageHistoryModal
          pageId={historyPage.id}
          onClose={() => setHistoryPage(null)}
        />
      )}
    </div>
  );
}
