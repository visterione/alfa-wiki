import React, { useState, useEffect, useRef } from 'react';
import { Save, RefreshCw, Upload, X, ShieldOff, AlertTriangle } from 'lucide-react';
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
    logo: '',
    defaultRole: '',
    allowRegistration: false
  });
  const [roleList, setRoleList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  // Рубильник 2FA живёт отдельно от form: он применяется сразу по клику, а не
  // по кнопке «Сохранить» — это аварийная мера, и лишний шаг тут только вредит.
  const [twoFactorDisabled, setTwoFactorDisabled] = useState(false);
  const [togglingTwoFactor, setTogglingTwoFactor] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [s, r] = await Promise.all([settings.list(), roles.list()]);
      setForm({
        siteName: s.data.siteName || 'Alfa Wiki',
        siteDescription: s.data.siteDescription || '',
        logo: s.data.logo || '',
        defaultRole: s.data.defaultRole || '',
        allowRegistration: s.data.allowRegistration || false
      });
      setTwoFactorDisabled(s.data.twoFactorDisabled === true);
      setRoleList(r.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleToggleTwoFactor = async () => {
    const next = !twoFactorDisabled;
    setTogglingTwoFactor(true);
    try {
      await settings.update('twoFactorDisabled', next);
      setTwoFactorDisabled(next);
      toast.success(next
        ? 'Двухфакторная аутентификация отключена для всех'
        : 'Двухфакторная аутентификация возвращена');
    } catch (e) { toast.error('Не удалось изменить настройку'); }
    finally { setTogglingTwoFactor(false); }
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

        <div className="card">
          <div className="card-header"><h3>Безопасность</h3></div>
          <div className="card-body">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Двухфакторная аутентификация</label>
              <div className="twofa-switch">
                <div className="twofa-switch-text">
                  <strong>{twoFactorDisabled ? 'Отключена для всех' : 'Работает в обычном режиме'}</strong>
                  <small className="text-muted">
                    Аварийное отключение на время сбоя почты: пользователи с 2FA войдут
                    по логину и паролю. Персональные настройки не сбрасываются — снимите
                    отключение, и второй фактор снова заработает у всех, у кого он был включён.
                  </small>
                </div>
                <button
                  className={`btn ${twoFactorDisabled ? 'btn-secondary' : 'btn-danger'}`}
                  onClick={handleToggleTwoFactor}
                  disabled={togglingTwoFactor}
                  style={{ flexShrink: 0 }}
                >
                  {togglingTwoFactor
                    ? <div className="loading-spinner" style={{ width: 18, height: 18 }} />
                    : <ShieldOff size={18} />}
                  {twoFactorDisabled ? 'Включить обратно' : 'Отключить для всех'}
                </button>
              </div>
              {twoFactorDisabled && (
                <div className="twofa-warning">
                  <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                  <span>Вход защищён только паролем. Не забудьте вернуть 2FA, когда почта заработает.</span>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

      <style>{`
        .settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 24px; }
        .twofa-switch { display: flex; align-items: flex-start; gap: 16px; justify-content: space-between; }
        .twofa-switch-text { display: flex; flex-direction: column; gap: 4px; }
        .twofa-warning {
          display: flex; align-items: center; gap: 10px; margin-top: 16px;
          padding: 12px; border-radius: var(--radius-md);
          background: rgba(239, 68, 68, 0.1); color: var(--error);
          font-size: 13px;
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