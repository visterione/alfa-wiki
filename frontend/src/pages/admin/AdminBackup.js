import React, { useState, useEffect } from 'react';
import { Plus, Download, Trash2, Database, Clock, HardDrive } from 'lucide-react';
import { backup } from '../../services/api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import '../Admin.css';

export default function AdminBackup() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const { data } = await backup.list();
      setBackups(data);
    } catch (e) { toast.error('Ошибка'); }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      await backup.create();
      toast.success('Резервная копия создана');
      load();
    } catch (e) { toast.error('Ошибка создания'); }
    finally { setCreating(false); }
  };

  const handleDelete = async (filename) => {
    if (!window.confirm('Удалить резервную копию?')) return;
    try {
      await backup.delete(filename);
      toast.success('Удалено');
      load();
    } catch (e) { toast.error('Ошибка'); }
  };

  const handleCleanup = async () => {
    if (!window.confirm('Удалить старые резервные копии (старше 30 дней)?')) return;
    try {
      const { data } = await backup.cleanup();
      toast.success(data.message);
      load();
    } catch (e) { toast.error('Ошибка'); }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const totalSize = backups.reduce((sum, b) => sum + b.size, 0);

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Резервные копии</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" onClick={handleCleanup}>Очистить старые</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? <div className="loading-spinner" style={{width:18,height:18}} /> : <Plus size={18} />}
            Создать копию
          </button>
        </div>
      </div>

      <div className="backup-stats">
        <div className="stat-card">
          <Database size={24} />
          <div>
            <div className="stat-value">{backups.length}</div>
            <div className="stat-label">Резервных копий</div>
          </div>
        </div>
        <div className="stat-card">
          <HardDrive size={24} />
          <div>
            <div className="stat-value">{formatSize(totalSize)}</div>
            <div className="stat-label">Общий размер</div>
          </div>
        </div>
        <div className="stat-card">
          <Clock size={24} />
          <div>
            <div className="stat-value">{backups[0] ? format(new Date(backups[0].createdAt), 'd MMM', { locale: ru }) : '—'}</div>
            <div className="stat-label">Последняя копия</div>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="admin-loading"><div className="loading-spinner" /></div>
        ) : backups.length > 0 ? (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Файл</th>
                <th>Размер</th>
                <th>Дата создания</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {backups.map(b => (
                <tr key={b.filename}>
                  <td><code>{b.filename}</code></td>
                  <td>{formatSize(b.size)}</td>
                  <td>{format(new Date(b.createdAt), 'd MMMM yyyy, HH:mm', { locale: ru })}</td>
                  <td>
                    <div className="action-btns">
                      <a href={backup.download(b.filename)} className="btn btn-ghost btn-sm" download><Download size={16} /></a>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(b.filename)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <Database size={48} style={{ opacity: 0.3 }} />
            <p>Резервные копии отсутствуют</p>
            <button className="btn btn-primary" onClick={handleCreate}>Создать первую копию</button>
          </div>
        )}
      </div>

      <style>{`
        .backup-stats { display: flex; gap: 24px; margin-bottom: 24px; }
        .stat-card { display: flex; align-items: center; gap: 16px; background: var(--bg-primary); padding: 20px 24px; border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); flex: 1; }
        .stat-card svg { color: var(--primary); }
        .stat-value { font-size: 24px; font-weight: 600; }
        .stat-label { font-size: 13px; color: var(--text-secondary); }
      `}</style>
    </div>
  );
}