import React, { useState, useEffect, useCallback } from 'react';
import { Download, X, FileText, Table as TableIcon, FileCode, Calendar, User, Folder, Search, History, Activity, Clock } from 'lucide-react';
import { journal, pages, users, folders } from '../../services/api';
import { BASE_URL } from '../../services/api';
import toast from 'react-hot-toast';
import PageHistoryModal from '../../components/PageHistoryModal';
import '../Admin.css';

export default function AdminJournal() {
  const [activeTab, setActiveTab] = useState('pages'); // 'pages' | 'modules'

  // === PAGES TAB STATE ===
  const [pageList, setPageList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    contentType: '', dateFrom: '', dateTo: '', folderId: '', createdBy: '', isPublished: ''
  });
  const [userList, setUserList] = useState([]);
  const [folderList, setFolderList] = useState([]);
  const [historyPage, setHistoryPage] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);

  // === MODULES TAB STATE ===
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesTotalCount, setActivitiesTotalCount] = useState(0);
  const [moduleList, setModuleList] = useState([]);
  const [activityFilters, setActivityFilters] = useState({
    pageSlug: '', userId: '', dateFrom: '', dateTo: ''
  });
  const [activitiesPage, setActivitiesPage] = useState(1);
  const [activitiesPerPage] = useState(50);
  const [expandedDiffs, setExpandedDiffs] = useState({});

  // === INITIAL LOAD ===
  useEffect(() => {
    loadUsers();
    loadFolders();
    loadModules();
  }, []);

  useEffect(() => {
    if (activeTab === 'pages') loadJournal();
  }, [filters, currentPage, searchQuery, activeTab]);

  useEffect(() => {
    if (activeTab === 'modules') loadActivities();
  }, [activityFilters, activitiesPage, activeTab]);

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

  const loadModules = async () => {
    try {
      const { data } = await journal.activityModules();
      setModuleList(data);
    } catch (error) {
      console.error('Error loading modules:', error);
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
      const params = {
        ...activityFilters,
        limit: activitiesPerPage,
        offset: (activitiesPage - 1) * activitiesPerPage
      };
      Object.keys(params).forEach(key => { if (params[key] === '') delete params[key]; });
      const { data } = await journal.activities(params);
      setActivities(data.rows);
      setActivitiesTotalCount(data.count);
    } catch (error) {
      toast.error('Ошибка загрузки активности модулей');
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
    setActivitiesPage(1);
  };

  const handleClearActivityFilters = () => {
    setActivityFilters({ pageSlug: '', userId: '', dateFrom: '', dateTo: '' });
    setActivitiesPage(1);
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
      case 'spreadsheet': return <TableIcon size={16} />;
      case 'html': return <FileCode size={16} />;
      default: return <FileText size={16} />;
    }
  };

  const getPageTypeLabel = (contentType) => {
    switch (contentType) {
      case 'spreadsheet': return 'Таблица';
      case 'html': return 'HTML';
      case 'wysiwyg': return 'Документ';
      default: return contentType;
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).format(date);
  };

  const getAvatarUrl = (user) => {
    if (!user?.avatar) return null;
    if (user.avatar.startsWith('http://localhost')) {
      const path = user.avatar.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (user.avatar.startsWith('http')) return user.avatar;
    return `${BASE_URL}/${user.avatar}`;
  };

  const getActionLabel = (action) => {
    switch (action) {
      case 'created': return 'Создание';
      case 'updated': return 'Изменение';
      case 'published': return 'Публикация';
      case 'unpublished': return 'Снятие публикации';
      default: return action;
    }
  };

  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const activitiesTotalPages = Math.ceil(activitiesTotalCount / activitiesPerPage);

  const getDiffTokens = (oldText, newText) => {
    const tok = s => (s.match(/\S+|\s+/g) || []);
    const A = tok(oldText), B = tok(newText);
    if (A.length > 600 || B.length > 600) return null;
    const m = A.length, n = B.length;
    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = A[i-1] === B[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && A[i-1] === B[j-1]) { result.unshift({ v: A[i-1], t: 0 }); i--; j--; }
      else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) { result.unshift({ v: B[j-1], t: 1 }); j--; }
      else { result.unshift({ v: A[i-1], t: -1 }); i--; }
    }
    return result;
  };

  // Рендер детальных изменений для вкладки Модули (аналогично PageHistoryModal)
  const renderActivityChanges = (changes, entryId) => {
    if (!changes?.length) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
        {changes.map((c, i) => {
          // Контекст (врач, услуга, сравнение)
          if (c.field === 'serviceContext' && c.to !== undefined) {
            return (
              <div key={i} style={{ fontSize: '11px', color: '#6b7280', background: '#f3f4f6', borderRadius: '4px', padding: '1px 6px', display: 'inline-block', alignSelf: 'flex-start' }}>
                {c.label}: <strong>{String(c.to).slice(0, 80)}</strong>
              </div>
            );
          }
          // Diff строк (описание врача) — свернуть/развернуть + подсветка различий
          if (c.addedLines || c.removedLines) {
            const key = `${entryId}-${i}`;
            const isOpen = !!expandedDiffs[key];
            const rCount = c.removedLines?.length || 0;
            const aCount = c.addedLines?.length || 0;
            const inlineTokens = (rCount === 1 && aCount === 1)
              ? getDiffTokens(c.removedLines[0], c.addedLines[0])
              : null;
            return (
              <div key={i}>
                <button
                  onClick={() => setExpandedDiffs(prev => ({ ...prev, [key]: !prev[key] }))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
                >
                  <span style={{ fontWeight: 600, color: '#374151' }}>{c.label}</span>
                  <span style={{ display: 'flex', gap: '3px', fontSize: '11px', alignItems: 'center' }}>
                    {rCount > 0 && <span style={{ color: '#dc2626' }}>−{rCount}</span>}
                    {aCount > 0 && <span style={{ color: '#16a34a' }}>+{aCount}</span>}
                    <span style={{ color: '#9ca3af' }}>{isOpen ? '▲' : '▼'}</span>
                  </span>
                </button>
                {isOpen && (
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: '4px', overflow: 'hidden', marginTop: '2px' }}>
                    {c.removedLines?.map((line, j) => (
                      <div key={`r${j}`} style={{ background: '#fef2f2', color: '#991b1b', padding: '2px 8px', fontSize: '12px' }}>
                        <span style={{ fontWeight: 700, opacity: 0.7, marginRight: '4px' }}>−</span>
                        {inlineTokens
                          ? <span>{inlineTokens.filter(t => t.t !== 1).map((tok, k) =>
                              tok.t === 0
                                ? <span key={k}>{tok.v}</span>
                                : <mark key={k} style={{ background: 'rgba(220,38,38,0.22)', fontWeight: 700, padding: '0 2px', borderRadius: '2px', textDecoration: 'line-through' }}>{tok.v}</mark>
                            )}</span>
                          : line}
                      </div>
                    ))}
                    {c.addedLines?.map((line, j) => (
                      <div key={`a${j}`} style={{ background: '#f0fdf4', color: '#166534', padding: '2px 8px', fontSize: '12px' }}>
                        <span style={{ fontWeight: 700, opacity: 0.7, marginRight: '4px' }}>+</span>
                        {inlineTokens
                          ? <span>{inlineTokens.filter(t => t.t !== -1).map((tok, k) =>
                              tok.t === 0
                                ? <span key={k}>{tok.v}</span>
                                : <mark key={k} style={{ background: 'rgba(22,163,74,0.22)', fontWeight: 700, padding: '0 2px', borderRadius: '2px' }}>{tok.v}</mark>
                            )}</span>
                          : line}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          // Скалярное поле: было → стало
          if (c.from !== undefined && c.to !== undefined) {
            return (
              <div key={i} style={{ fontSize: '12px', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600, color: '#374151' }}>{c.label}:</span>
                <span style={{ color: '#dc2626', textDecoration: 'line-through', opacity: 0.9 }}>«{String(c.from).slice(0, 60)}»</span>
                <span style={{ color: '#9ca3af' }}>→</span>
                <span style={{ color: '#16a34a', fontWeight: 500 }}>«{String(c.to).slice(0, 60)}»</span>
              </div>
            );
          }
          // Только to (добавлено)
          if (c.from === undefined && c.to !== undefined) {
            return (
              <div key={i} style={{ fontSize: '12px', display: 'flex', gap: '4px', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600, color: '#374151' }}>{c.label}:</span>
                <span style={{ color: '#16a34a', fontWeight: 500 }}>«{String(c.to).slice(0, 60)}»</span>
              </div>
            );
          }
          // Только from (удалено)
          if (c.to === undefined && c.from !== undefined) {
            return (
              <div key={i} style={{ fontSize: '12px', display: 'flex', gap: '4px', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600, color: '#374151' }}>{c.label}:</span>
                <span style={{ color: '#dc2626', textDecoration: 'line-through', opacity: 0.9 }}>«{String(c.from).slice(0, 60)}»</span>
              </div>
            );
          }
          // Просто метка
          return (
            <div key={i} style={{ fontSize: '12px', color: '#6b7280', fontStyle: 'italic' }}>{c.label}</div>
          );
        })}
      </div>
    );
  };

  // === RENDER ===
  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>Журнал изменений</h1>
      </div>

      {/* TABS */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'pages' ? 'active' : ''}`}
          onClick={() => setActiveTab('pages')}
        >
          <FileText size={16} />
          Страницы Wiki
        </button>
        <button
          className={`admin-tab ${activeTab === 'modules' ? 'active' : ''}`}
          onClick={() => { setActiveTab('modules'); if (moduleList.length === 0) loadModules(); }}
        >
          <Activity size={16} />
          Модули
          {activitiesTotalCount > 0 && <span className="admin-tab-badge">{activitiesTotalCount}</span>}
        </button>
      </div>

      {/* === PAGES TAB === */}
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
                  {userList.map(user => (
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
                          <a href={`/page/${page.slug}`} target="_blank" rel="noopener noreferrer" className="page-title-link">
                            {page.title}
                          </a>
                        </td>
                        <td><span className="folder-path">{page.folderPath || '(Корневая папка)'}</span></td>
                        <td>{page.author?.displayName || page.author?.username || '—'}</td>
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

      {/* === MODULES TAB === */}
      {activeTab === 'modules' && (
        <>
          <div className="admin-filters-panel">
            <div className="admin-filters-row">
              <div className="form-group">
                <label className="form-label"><Activity size={14} />Модуль</label>
                <select className="form-control" value={activityFilters.pageSlug} onChange={(e) => handleActivityFilterChange('pageSlug', e.target.value)}>
                  <option value="">Все модули</option>
                  {moduleList.map(m => (
                    <option key={m.slug} value={m.slug}>{m.label} ({m.count})</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><User size={14} />Пользователь</label>
                <select className="form-control" value={activityFilters.userId} onChange={(e) => handleActivityFilterChange('userId', e.target.value)}>
                  <option value="">Все пользователи</option>
                  {userList.map(user => (
                    <option key={user.id} value={user.id}>{user.displayName || user.username}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label"><Calendar size={14} />С</label>
                <input type="date" className="form-control" value={activityFilters.dateFrom} onChange={(e) => handleActivityFilterChange('dateFrom', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label"><Calendar size={14} />По</label>
                <input type="date" className="form-control" value={activityFilters.dateTo} onChange={(e) => handleActivityFilterChange('dateTo', e.target.value)} />
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
              <div className="admin-empty-state">
                <Activity size={48} />
                <p>Нет записей о действиях в модулях</p>
                <p style={{ fontSize: '13px', color: '#9ca3af', marginTop: '8px' }}>
                  Активность появится после добавления, изменения или удаления записей в модулях
                </p>
              </div>
            ) : (
              <>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Пользователь</th>
                      <th>Модуль</th>
                      <th>Действие</th>
                      <th>Описание</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activities.map(entry => (
                      <tr key={entry.id}>
                        <td>
                          <div className="date-cell"><Clock size={14} />{formatDate(entry.createdAt)}</div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {getAvatarUrl(entry.user) ? (
                              <img src={getAvatarUrl(entry.user)} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
                            ) : (
                              <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <User size={12} />
                              </div>
                            )}
                            <span>{entry.user?.displayName || entry.user?.username || '—'}</span>
                          </div>
                        </td>
                        <td>
                          <span className="page-type-badge">
                            <Activity size={14} />
                            {entry.moduleLabel}
                          </span>
                        </td>
                        <td>
                          <span className={`status-badge ${entry.action === 'created' ? 'published' : entry.action === 'updated' ? 'draft' : ''}`}>
                            {getActionLabel(entry.action)}
                          </span>
                        </td>
                        <td style={{ maxWidth: '460px' }}>
                          {entry.metadata?.changes?.length > 0
                            ? renderActivityChanges(entry.metadata.changes, entry.id)
                            : <span style={{ fontSize: '13px', color: '#374151' }}>{entry.changesSummary || '—'}</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {activitiesTotalPages > 1 && (
                  <div className="admin-pagination">
                    <div className="admin-pagination-info">Показано {activities.length} из {activitiesTotalCount}</div>
                    <div className="admin-pagination-controls">
                      <button className="btn btn-secondary" disabled={activitiesPage === 1} onClick={() => setActivitiesPage(prev => prev - 1)}>Назад</button>
                      <span className="pagination-page">Страница {activitiesPage} из {activitiesTotalPages}</span>
                      <button className="btn btn-secondary" disabled={activitiesPage >= activitiesTotalPages} onClick={() => setActivitiesPage(prev => prev + 1)}>Вперед</button>
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
