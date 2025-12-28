import React, { useState, useEffect } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import { settings, roles } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';
import toast from 'react-hot-toast';
import '../Admin.css';

export default function AdminSettings() {
  const { reloadTheme } = useTheme();
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
              <label className="form-label">URL логотипа</label>
              <input className="input" placeholder="https://..." value={form.logo} onChange={e => setForm({...form, logo: e.target.value})} />
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
      `}</style>
    </div>
  );
}