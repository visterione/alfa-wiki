import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, Download, Trash2, Database, Clock, HardDrive, 
  Upload, RotateCcw, AlertTriangle, CheckCircle, FileArchive,
  X, Server, FolderOpen, AlertCircle
} from 'lucide-react';
import { backup } from '../../services/api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import '../Admin.css';

export default function AdminBackup() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [showRestoreModal, setShowRestoreModal] = useState(null);
  const [restoreOptions, setRestoreOptions] = useState({ restoreDb: true, restoreFiles: true });
  const fileInputRef = useRef(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const { data } = await backup.list();
      setBackups(data);
    } catch (e) { 
      toast.error('Ошибка загрузки'); 
    }
    finally { setLoading(false); }
  };

  const handleCreate = async () => {
    setCreating(true);
    const loadingToast = toast.loading('Создание резервной копии...');
    
    try {
      await backup.create();
      toast.success('Резервная копия создана', { id: loadingToast });
      load();
    } catch (e) { 
      toast.error('Ошибка создания: ' + (e.response?.data?.error || e.message), { id: loadingToast }); 
    }
    finally { setCreating(false); }
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.zip')) {
      toast.error('Только ZIP файлы');
      return;
    }

    setUploading(true);
    const loadingToast = toast.loading('Загрузка бэкапа...');
    
    try {
      await backup.upload(file);
      toast.success('Бэкап загружен', { id: loadingToast });
      load();
    } catch (e) { 
      toast.error(e.response?.data?.error || 'Ошибка загрузки', { id: loadingToast }); 
    }
    finally { 
      setUploading(false); 
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRestore = async () => {
    if (!showRestoreModal) return;
    
    const filename = showRestoreModal.filename;
    setRestoring(filename);
    setShowRestoreModal(null);
    
    const loadingToast = toast.loading('Восстановление из бэкапа...', { duration: Infinity });
    
    try {
      const { data } = await backup.restore(filename, restoreOptions);
      
      const dbOk = data.results?.database === 'success';
      const filesOk = data.results?.files === 'success' || 
                      data.results?.files?.includes('cleaned') ||
                      data.results?.files?.includes('skipped');
      
      if (dbOk && filesOk) {
        toast.success('✅ Восстановление завершено успешно! Перезагрузите страницу.', { 
          id: loadingToast,
          duration: 10000 
        });
        
        // Предлагаем перезагрузить страницу
        setTimeout(() => {
          if (window.confirm('Восстановление завершено. Перезагрузить страницу?')) {
            window.location.reload();
          }
        }, 2000);
      } else if (dbOk || filesOk) {
        toast.success('⚠️ Восстановление частично завершено. Проверьте результаты.', { 
          id: loadingToast,
          duration: 8000 
        });
        console.log('Restore results:', data.results);
      } else {
        toast.error('❌ Ошибка восстановления', { id: loadingToast });
      }
      
      load();
    } catch (e) { 
      toast.error('❌ ' + (e.response?.data?.error || 'Ошибка восстановления'), { 
        id: loadingToast,
        duration: 8000 
      });
    }
    finally { setRestoring(null); }
  };

  const handleDownload = async (filename) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `${process.env.REACT_APP_API_URL || 'http://localhost:9001'}/api/backup/download/${filename}`, 
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      
      if (!response.ok) throw new Error('Download failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      toast.error('Ошибка скачивания');
    }
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
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  };

  const totalSize = backups.reduce((sum, b) => sum + b.size, 0);

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Резервные копии</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" onClick={handleCleanup}>
            Очистить старые
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={handleUpload}
            style={{ display: 'none' }}
          />
          <button 
            className="btn btn-secondary" 
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <div className="loading-spinner" style={{width:18,height:18}} /> : <Upload size={18} />}
            Загрузить
          </button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? <div className="loading-spinner" style={{width:18,height:18}} /> : <Plus size={18} />}
            Создать копию
          </button>
        </div>
      </div>

      {/* Предупреждение о важности бэкапов */}
      <div className="backup-warning-panel">
        <AlertCircle size={20} />
        <div>
          <strong>Важно о восстановлении:</strong>
          <p>При восстановлении все текущие данные и файлы будут ПОЛНОСТЬЮ ЗАМЕНЕНЫ на данные из бэкапа. 
          Перед восстановлением рекомендуется создать текущую резервную копию.</p>
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
            <div className="stat-value">
              {backups[0] ? format(new Date(backups[0].createdAt), 'd MMM HH:mm', { locale: ru }) : '—'}
            </div>
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
                <th>Тип</th>
                <th>Размер</th>
                <th>Дата создания</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {backups.map(b => (
                <tr key={b.filename} className={restoring === b.filename ? 'restoring' : ''}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FileArchive size={18} style={{ color: 'var(--primary)' }} />
                      <code>{b.filename}</code>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${b.isUploaded ? 'badge-warning' : 'badge-success'}`}>
                      {b.isUploaded ? 'Загружен' : 'Создан'}
                    </span>
                  </td>
                  <td>{formatSize(b.size)}</td>
                  <td>{format(new Date(b.createdAt), 'd MMMM yyyy, HH:mm', { locale: ru })}</td>
                  <td>
                    <div className="action-btns">
                      <button 
                        className="btn btn-ghost btn-sm" 
                        onClick={() => {
                          setRestoreOptions({ restoreDb: true, restoreFiles: true });
                          setShowRestoreModal(b);
                        }}
                        disabled={restoring === b.filename}
                        title="Восстановить"
                      >
                        {restoring === b.filename 
                          ? <div className="loading-spinner" style={{width:16,height:16}} />
                          : <RotateCcw size={16} />
                        }
                      </button>
                      <button 
                        className="btn btn-ghost btn-sm" 
                        onClick={() => handleDownload(b.filename)}
                        title="Скачать"
                      >
                        <Download size={16} />
                      </button>
                      <button 
                        className="btn btn-ghost btn-sm" 
                        onClick={() => handleDelete(b.filename)}
                        title="Удалить"
                      >
                        <Trash2 size={16} />
                      </button>
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

      {/* Restore Modal */}
      {showRestoreModal && (
        <div className="modal-overlay" onClick={() => setShowRestoreModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h2>Восстановление из бэкапа</h2>
              <button className="modal-close" onClick={() => setShowRestoreModal(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="restore-file-info">
                <FileArchive size={32} />
                <div>
                  <div className="restore-filename">{showRestoreModal.filename}</div>
                  <div className="restore-meta">
                    {formatSize(showRestoreModal.size)} • {format(new Date(showRestoreModal.createdAt), 'd MMM yyyy, HH:mm', { locale: ru })}
                  </div>
                </div>
              </div>

              <div className="restore-warning">
                <AlertTriangle size={20} />
                <div>
                  <strong>Внимание! Полное восстановление:</strong>
                  <p>Все текущие данные будут ПОЛНОСТЬЮ УДАЛЕНЫ и заменены данными из бэкапа. 
                  Файлы в папке uploads будут полностью очищены перед восстановлением. 
                  Эта операция необратима!</p>
                </div>
              </div>

              <div className="restore-options">
                <label className="restore-option">
                  <input 
                    type="checkbox" 
                    checked={restoreOptions.restoreDb}
                    onChange={e => setRestoreOptions(prev => ({ ...prev, restoreDb: e.target.checked }))}
                  />
                  <Server size={18} />
                  <div>
                    <div className="restore-option-title">База данных</div>
                    <div className="restore-option-desc">Все таблицы будут удалены и восстановлены из бэкапа</div>
                  </div>
                </label>
                <label className="restore-option">
                  <input 
                    type="checkbox" 
                    checked={restoreOptions.restoreFiles}
                    onChange={e => setRestoreOptions(prev => ({ ...prev, restoreFiles: e.target.checked }))}
                  />
                  <FolderOpen size={18} />
                  <div>
                    <div className="restore-option-title">Файлы</div>
                    <div className="restore-option-desc">Папка uploads будет полностью очищена и восстановлена из бэкапа</div>
                  </div>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowRestoreModal(null)}>
                Отмена
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleRestore}
                disabled={!restoreOptions.restoreDb && !restoreOptions.restoreFiles}
              >
                <RotateCcw size={18} />
                Восстановить
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .backup-stats { display: flex; gap: 24px; margin-bottom: 24px; }
        .stat-card { display: flex; align-items: center; gap: 16px; background: var(--bg-primary); padding: 20px 24px; border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); flex: 1; }
        .stat-card svg { color: var(--primary); }
        .stat-value { font-size: 24px; font-weight: 600; }
        .stat-label { font-size: 13px; color: var(--text-secondary); }
        
        .backup-warning-panel { 
          display: flex; 
          gap: 12px; 
          padding: 16px 20px; 
          background: linear-gradient(135deg, rgba(255, 152, 0, 0.1), rgba(255, 152, 0, 0.05)); 
          border: 1px solid rgba(255, 152, 0, 0.3); 
          border-radius: var(--radius-md); 
          margin-bottom: 24px;
        }
        .backup-warning-panel svg { color: var(--warning); flex-shrink: 0; margin-top: 2px; }
        .backup-warning-panel strong { display: block; color: var(--warning); margin-bottom: 4px; }
        .backup-warning-panel p { font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.5; }
        
        tr.restoring { opacity: 0.6; pointer-events: none; }
        
        .restore-file-info { display: flex; align-items: center; gap: 16px; padding: 16px; background: var(--bg-secondary); border-radius: var(--radius-md); margin-bottom: 16px; }
        .restore-file-info svg { color: var(--primary); flex-shrink: 0; }
        .restore-filename { font-weight: 600; font-size: 14px; word-break: break-all; }
        .restore-meta { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
        
        .restore-warning { display: flex; gap: 12px; padding: 14px 16px; background: rgba(255, 59, 48, 0.1); border: 1px solid rgba(255, 59, 48, 0.3); border-radius: var(--radius-md); margin-bottom: 20px; }
        .restore-warning svg { color: var(--error); flex-shrink: 0; margin-top: 2px; }
        .restore-warning strong { display: block; color: var(--error); margin-bottom: 4px; }
        .restore-warning p { font-size: 13px; color: var(--text-secondary); margin: 0; }
        
        .restore-options { display: flex; flex-direction: column; gap: 12px; }
        .restore-option { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; background: var(--bg-secondary); border-radius: var(--radius-md); cursor: pointer; transition: all 0.15s; border: 2px solid transparent; }
        .restore-option:hover { background: var(--bg-tertiary); }
        .restore-option:has(input:checked) { border-color: var(--primary); background: var(--primary-light); }
        .restore-option input { margin-top: 2px; }
        .restore-option svg { color: var(--primary); flex-shrink: 0; margin-top: 2px; }
        .restore-option-title { font-weight: 500; font-size: 14px; }
        .restore-option-desc { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
        
        .modal-footer { display: flex; justify-content: flex-end; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--border-light); }
        
        @media (max-width: 768px) {
          .backup-stats { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}