import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Edit, Trash2, Search, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { pages } from '../../services/api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import '../Admin.css';

export default function AdminPages() {
  const [pageList, setPageList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const { data } = await pages.list({ limit: 200 });
      setPageList(data.rows || []);
    } catch (e) { toast.error('Ошибка'); }
    finally { setLoading(false); }
  };

  const handleDelete = async (page) => {
    if (!window.confirm(`Удалить "${page.title}"?`)) return;
    try {
      await pages.delete(page.id);
      toast.success('Удалено');
      load();
    } catch (e) { toast.error('Ошибка'); }
  };

  const togglePublish = async (page) => {
    try {
      await pages.update(page.id, { isPublished: !page.isPublished });
      toast.success(page.isPublished ? 'Снято с публикации' : 'Опубликовано');
      load();
    } catch (e) { toast.error('Ошибка'); }
  };

  const filtered = pageList.filter(p => {
    const matchSearch = p.title.toLowerCase().includes(search.toLowerCase()) || p.slug.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === 'all' || (filter === 'published' && p.isPublished) || (filter === 'draft' && !p.isPublished);
    return matchSearch && matchFilter;
  });

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Страницы</h1>
        <Link to="/new-page" className="btn btn-primary"><Plus size={18} /> Создать</Link>
      </div>

      <div className="admin-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input type="text" placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="filter-tabs">
          <button className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Все ({pageList.length})</button>
          <button className={`filter-tab ${filter === 'published' ? 'active' : ''}`} onClick={() => setFilter('published')}>Опубликованы ({pageList.filter(p => p.isPublished).length})</button>
          <button className={`filter-tab ${filter === 'draft' ? 'active' : ''}`} onClick={() => setFilter('draft')}>Черновики ({pageList.filter(p => !p.isPublished).length})</button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : filtered.length > 0 ? (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Страница</th>
                <th>URL</th>
                <th>Статус</th>
                <th>Обновлено</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(page => (
                <tr key={page.id}>
                  <td>
                    <div className="page-cell">
                      <div className="page-title">{page.title}</div>
                      {page.description && <div className="page-desc">{page.description.substring(0, 60)}...</div>}
                    </div>
                  </td>
                  <td><code className="slug">/{page.slug}</code></td>
                  <td>
                    <button className={`badge ${page.isPublished ? 'badge-success' : ''}`} onClick={() => togglePublish(page)} style={{ cursor: 'pointer' }}>
                      {page.isPublished ? <><Eye size={12} /> Опубликовано</> : <><EyeOff size={12} /> Черновик</>}
                    </button>
                  </td>
                  <td className="text-muted text-small">{format(new Date(page.updatedAt), 'd MMM yyyy, HH:mm', { locale: ru })}</td>
                  <td>
                    <div className="action-btns">
                      <Link to={`/page/${page.slug}`} className="btn btn-ghost btn-sm" target="_blank"><ExternalLink size={16} /></Link>
                      <Link to={`/page/${page.slug}/edit`} className="btn btn-ghost btn-sm"><Edit size={16} /></Link>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(page)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">Страницы не найдены</div>
        )}
      </div>
    </div>
  );
}