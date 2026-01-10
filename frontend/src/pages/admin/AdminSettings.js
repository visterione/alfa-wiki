import React, { useState, useEffect, useRef } from 'react';
import { Save, RefreshCw, Upload, X } from 'lucide-react';
import { settings, roles, media, BASE_URL } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';
import toast from 'react-hot-toast';
import '../Admin.css';

export default function AdminSettings() {
  const { reloadTheme } = useTheme();
  const logoInputRef = useRef(null);
  const [form, setForm] = useState({
    siteName: 'Alfa Wiki',
    siteDescription: '',
    primaryColor: '#007AFF',
    logo: '',
    defaultRole: '',
    allowRegistration: false
  });
  const [roleList, setRoleList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [s, r] = await Promise.all([settings.list(), roles.list()]);
      setForm({
        siteName: s.data.siteName || 'Alfa Wiki',
        siteDescription: s.data.siteDescription || '',
        primaryColor: s.data.primaryColor || '#007AFF',
        logo: s.data.logo || '',
        defaultRole: s.data.defaultRole || '',
        allowRegistration: s.data.allowRegistration || false
      });
      setRoleList(r.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settings.bulkUpdate(form);
      await reloadTheme(); // Применяем новую тему
      toast.success('Настройки сохранены');
    } catch (e) { toast.error('Ошибка'); }
    finally { setSaving(false); }
  };

  const handleInit = async () => {
    try {
      await settings.init();
      toast.success('Настройки по умолчанию восстановлены');
      load();
      reloadTheme();
    } catch (e) { toast.error('Ошибка'); }
  };

  const previewColor = (color) => {
    document.documentElement.style.setProperty('--primary', color);
    setForm({...form, primaryColor: color});
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Выберите изображение');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Максимальный размер файла 2MB');
      return;
    }

    setUploadingLogo(true);
    try {
      const { data } = await media.upload(file);
      setForm({ ...form, logo: data.path });
      toast.success('Логотип загружен');
    } catch (e) {
      toast.error('Ошибка загрузки логотипа');
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) {
        logoInputRef.current.value = '';
      }
    }
  };

  const handleRemoveLogo = () => {
    setForm({ ...form, logo: '' });
    toast.success('Логотип удален');
  };

  const getLogoPreview = () => {
    if (!form.logo) return null;
    if (form.logo.startsWith('http://localhost')) {
      const path = form.logo.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${path}`;
    }
    if (form.logo.startsWith('http')) return form.logo;
    return `${BASE_URL}/${form.logo}`;
  };

  if (loading) {
    return <div className="admin-page"><div className="admin-loading"><div className="loading-spinner" /></div></div>;
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Настройки системы</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-secondary" onClick={handleInit}><RefreshCw size={18} /> Сбросить</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <div className="loading-spinner" style={{width:18,height:18}} /> : <Save size={18} />}
            Сохранить
          </button>
        </div>
      </div>

      <div className="settings-grid">
        <div className="card">
          <div className="card-header"><h3>Основные</h3></div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Название сайта</label>
              <input className="input" value={form.siteName} onChange={e => setForm({...form, siteName: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Описание</label>
              <textarea className="textarea" value={form.siteDescription} onChange={e => setForm({...form, siteDescription: e.target.value})} rows={3} />
            </div>
            <div className="form-group">
              <label className="form-label">Логотип</label>
              
              {/* Предпросмотр логотипа */}
              {form.logo && (
                <div className="logo-preview-container" style={{ marginBottom: 12 }}>
                  <div className="logo-preview">
                    <img src={getLogoPreview()} alt="Логотип" />
                  </div>
                  <button 
                    className="btn btn-ghost btn-sm"
                    onClick={handleRemoveLogo}
                    type="button"
                  >
                    <X size={16} />
                    Удалить
                  </button>
                </div>
              )}
              
              {/* Кнопка загрузки */}
              <button 
                className="btn btn-secondary"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
                type="button"
                style={{ width: '100%' }}
              >
                {uploadingLogo ? (
                  <>
                    <div className="loading-spinner" style={{width:16,height:16}} />
                    Загрузка...
                  </>
                ) : (
                  <>
                    <Upload size={16} />
                    {form.logo ? 'Изменить логотип' : 'Загрузить логотип'}
                  </>
                )}
              </button>
              <input 
                ref={logoInputRef}
                type="file" 
                accept="image/*" 
                hidden 
                onChange={handleLogoUpload}
              />
              <small className="form-hint">Рекомендуемый размер: 32x32px, максимум 2MB</small>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Внешний вид</h3></div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Основной цвет</label>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <input 
                  type="color" 
                  value={form.primaryColor} 
                  onChange={e => previewColor(e.target.value)} 
                  style={{ width: 50, height: 40, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 8 }} 
                />
                <input 
                  className="input" 
                  value={form.primaryColor} 
                  onChange={e => previewColor(e.target.value)} 
                  style={{ width: 120 }} 
                />
              </div>
            </div>
            <div className="form-group">
              <span className="form-label" style={{ marginBottom: 12, display: 'block' }}>Готовые темы:</span>
              <div className="color-presets">
                {[
                  { name: 'Синий', color: '#007AFF' },
                  { name: 'Фиолетовый', color: '#5856D6' },
                  { name: 'Зелёный', color: '#34C759' },
                  { name: 'Оранжевый', color: '#FF9500' },
                  { name: 'Красный', color: '#FF3B30' },
                  { name: 'Розовый', color: '#AF52DE' },
                  { name: 'Тёмно-синий', color: '#1a5fb4' },
                  { name: 'Бирюзовый', color: '#00BCD4' },
                ].map(({ name, color }) => (
                  <button 
                    key={color} 
                    className={`color-preset ${form.primaryColor === color ? 'active' : ''}`}
                    style={{ background: color }} 
                    onClick={() => previewColor(color)}
                    title={name}
                  />
                ))}
              </div>
            </div>
            <div className="theme-preview">
              <div className="theme-preview-label">Предпросмотр:</div>
              <div className="theme-preview-box">
                <button className="btn btn-primary btn-sm">Кнопка</button>
                <span className="badge badge-primary">Метка</span>
                <a href="#preview" style={{ color: form.primaryColor }}>Ссылка</a>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3>Пользователи</h3></div>
          <div className="card-body">
            <div className="form-group">
              <label className="form-label">Роль по умолчанию</label>
              <select className="select" value={form.defaultRole} onChange={e => setForm({...form, defaultRole: e.target.value})}>
                <option value="">Без роли</option>
                {roleList.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <small className="text-muted">Назначается новым пользователям</small>
            </div>
            <div className="form-group">
              <label className="checkbox-item">
                <input type="checkbox" checked={form.allowRegistration} onChange={e => setForm({...form, allowRegistration: e.target.checked})} />
                Разрешить самостоятельную регистрацию
              </label>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 24px; }
        .color-presets { display: flex; gap: 10px; flex-wrap: wrap; }
        .color-preset { 
          width: 40px; height: 40px; border-radius: 10px; 
          border: 3px solid transparent; 
          box-shadow: 0 2px 8px rgba(0,0,0,0.15); 
          cursor: pointer; transition: all 0.2s; 
        }
        .color-preset:hover { transform: scale(1.1); }
        .color-preset.active { border-color: var(--text-primary); transform: scale(1.1); }
        .theme-preview { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-light); }
        .theme-preview-label { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
        .theme-preview-box { 
          display: flex; align-items: center; gap: 16px; 
          padding: 16px; background: var(--bg-secondary); border-radius: var(--radius-md); 
        }
        
        .logo-preview-container {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
        }

        .logo-preview {
          width: 60px;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: white;
          border-radius: var(--radius-sm);
          overflow: hidden;
          flex-shrink: 0;
        }

        .logo-preview img {
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
        }
      `}</style>
    </div>
  );
}