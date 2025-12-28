import React, { useState, useEffect, useRef } from 'react';
import { Upload, Trash2, Copy, Image, Film, FileText, File } from 'lucide-react';
import { media, BASE_URL } from '../../services/api';
import toast from 'react-hot-toast';
import '../Admin.css';

export default function AdminMedia() {
  const [mediaList, setMediaList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState('all');
  const fileInput = useRef(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const { data } = await media.list({ limit: 200 });
      setMediaList(data.rows || []);
    } catch (e) { toast.error('Ошибка'); }
    finally { setLoading(false); }
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        await media.upload(file);
      }
      toast.success(`Загружено ${files.length} файл(ов)`);
      load();
    } catch (e) { toast.error('Ошибка загрузки'); }
    finally { setUploading(false); fileInput.current.value = ''; }
  };

  const handleDelete = async (item) => {
    if (!window.confirm('Удалить файл?')) return;
    try {
      await media.delete(item.id);
      toast.success('Удалено');
      load();
    } catch (e) { toast.error('Ошибка'); }
  };

  const copyUrl = (item) => {
    const url = `${BASE_URL}/${item.path}`;
    navigator.clipboard.writeText(url);
    toast.success('URL скопирован');
  };

  const getIcon = (mime) => {
    if (mime?.startsWith('image/')) return <Image size={24} />;
    if (mime?.startsWith('video/')) return <Film size={24} />;
    if (mime?.includes('pdf')) return <FileText size={24} />;
    return <File size={24} />;
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const filtered = mediaList.filter(m => {
    if (filter === 'all') return true;
    return m.mimeType?.startsWith(filter);
  });

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Медиафайлы</h1>
        <button className="btn btn-primary" onClick={() => fileInput.current?.click()} disabled={uploading}>
          {uploading ? <div className="loading-spinner" style={{width:18,height:18}} /> : <Upload size={18} />}
          Загрузить
        </button>
        <input ref={fileInput} type="file" multiple hidden onChange={handleUpload} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" />
      </div>

      <div className="admin-toolbar">
        <div className="filter-tabs">
          <button className={`filter-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>Все</button>
          <button className={`filter-tab ${filter === 'image' ? 'active' : ''}`} onClick={() => setFilter('image')}>Изображения</button>
          <button className={`filter-tab ${filter === 'video' ? 'active' : ''}`} onClick={() => setFilter('video')}>Видео</button>
          <button className={`filter-tab ${filter === 'application' ? 'active' : ''}`} onClick={() => setFilter('application')}>Документы</button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : filtered.length > 0 ? (
          <div className="media-grid">
            {filtered.map(item => (
              <div key={item.id} className="media-card">
                <div className="media-preview">
                  {item.mimeType?.startsWith('image/') ? (
                    <img src={`${BASE_URL}/${item.thumbnailPath || item.path}`} alt={item.originalName} />
                  ) : (
                    <div className="media-icon">{getIcon(item.mimeType)}</div>
                  )}
                </div>
                <div className="media-info">
                  <div className="media-name" title={item.originalName}>{item.originalName}</div>
                  <div className="media-meta">{formatSize(item.size)}</div>
                </div>
                <div className="media-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => copyUrl(item)} title="Копировать URL"><Copy size={14} /></button>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(item)} title="Удалить"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">Файлы не найдены</div>
        )}
      </div>
    </div>
  );
}