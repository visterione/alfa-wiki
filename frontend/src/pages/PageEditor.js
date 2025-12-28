import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Save, ArrowLeft, Eye, Code, FileText, Settings } from 'lucide-react';
import { pages, roles } from '../services/api';
import Editor from '../components/Editor';
import toast from 'react-hot-toast';
import './PageEditor.css';

export default function PageEditor() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const isNew = !slug || slug === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [allRoles, setAllRoles] = useState([]);
  
  const [form, setForm] = useState({
    title: '',
    slug: '',
    content: '',
    contentType: 'wysiwyg',
    description: '',
    keywords: '',
    isPublished: false,
    allowedRoles: [],
    customCss: '',
    customJs: ''
  });

  useEffect(() => {
    loadRoles();
    if (!isNew) loadPage();
  }, [slug]);

  const loadRoles = async () => {
    try {
      const { data } = await roles.list();
      setAllRoles(data);
    } catch (e) { console.error(e); }
  };

  const loadPage = async () => {
    try {
      const { data } = await pages.get(slug);
      setForm({
        title: data.title || '',
        slug: data.slug || '',
        content: data.content || '',
        contentType: data.contentType || 'wysiwyg',
        description: data.description || '',
        keywords: (data.keywords || []).join(', '),
        isPublished: data.isPublished || false,
        allowedRoles: data.allowedRoles || [],
        customCss: data.customCss || '',
        customJs: data.customJs || '',
        id: data.id
      });
    } catch (error) {
      toast.error('Страница не найдена');
      navigate('/');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Введите заголовок');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        keywords: form.keywords.split(',').map(k => k.trim()).filter(Boolean)
      };

      if (isNew) {
        const { data } = await pages.create(payload);
        toast.success('Страница создана');
        navigate(`/page/${data.slug}`);
      } else {
        await pages.update(form.id, payload);
        toast.success('Страница сохранена');
        navigate(`/page/${form.slug}`);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const generateSlug = () => {
    const slug = form.title
      .toLowerCase()
      .replace(/[а-яё]/gi, c => {
        const ru = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
        const en = ['a','b','v','g','d','e','yo','zh','z','i','y','k','l','m','n','o','p','r','s','t','u','f','h','c','ch','sh','sch','','y','','e','yu','ya'];
        const i = ru.indexOf(c.toLowerCase());
        return i >= 0 ? en[i] : c;
      })
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    setForm({ ...form, slug });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="page-editor">
      <form onSubmit={handleSubmit}>
        <div className="editor-header">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            <ArrowLeft size={18} />
            Назад
          </button>
          <div className="editor-header-actions">
            <button
              type="button"
              className={`btn btn-ghost ${showSettings ? 'active' : ''}`}
              onClick={() => setShowSettings(!showSettings)}
            >
              <Settings size={18} />
              Настройки
            </button>
            {!isNew && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.open(`/page/${form.slug}`, '_blank')}
              >
                <Eye size={18} />
                Просмотр
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <div className="loading-spinner" style={{width:18,height:18}} /> : <Save size={18} />}
              {isNew ? 'Создать' : 'Сохранить'}
            </button>
          </div>
        </div>

        <div className="editor-body">
          <div className="editor-main">
            <div className="form-group">
              <input
                type="text"
                className="input title-input"
                placeholder="Заголовок страницы"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>

            <div className="editor-type-tabs">
              <button
                type="button"
                className={`editor-type-tab ${form.contentType === 'wysiwyg' ? 'active' : ''}`}
                onClick={() => setForm({ ...form, contentType: 'wysiwyg' })}
              >
                <FileText size={16} />
                Визуальный редактор
              </button>
              <button
                type="button"
                className={`editor-type-tab ${form.contentType === 'html' ? 'active' : ''}`}
                onClick={() => setForm({ ...form, contentType: 'html' })}
              >
                <Code size={16} />
                HTML / CSS / JS
              </button>
            </div>

            {form.contentType === 'wysiwyg' ? (
              <Editor
                content={form.content}
                onChange={(content) => setForm({ ...form, content })}
                placeholder="Начните писать..."
              />
            ) : (
              <div className="html-editor">
                <textarea
                  className="textarea code-textarea"
                  placeholder="<div>Ваш HTML код...</div>"
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  rows={20}
                />
              </div>
            )}
          </div>

          {showSettings && (
            <div className="editor-sidebar">
              <div className="card">
                <div className="card-header"><h4>Настройки страницы</h4></div>
                <div className="card-body">
                  <div className="form-group">
                    <label className="form-label">URL (slug)</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        className="input"
                        placeholder="url-stranitsy"
                        value={form.slug}
                        onChange={(e) => setForm({ ...form, slug: e.target.value })}
                      />
                      <button type="button" className="btn btn-secondary" onClick={generateSlug}>
                        Создать
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Описание</label>
                    <textarea
                      className="textarea"
                      placeholder="Краткое описание страницы"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      rows={3}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Ключевые слова</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="ключ1, ключ2, ключ3"
                      value={form.keywords}
                      onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                    />
                    <small className="text-muted">Через запятую, для поиска</small>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Доступ по ролям</label>
                    <div className="checkbox-list">
                      {allRoles.map(role => (
                        <label key={role.id} className="checkbox-item">
                          <input
                            type="checkbox"
                            checked={form.allowedRoles.includes(role.id)}
                            onChange={(e) => {
                              const newRoles = e.target.checked
                                ? [...form.allowedRoles, role.id]
                                : form.allowedRoles.filter(r => r !== role.id);
                              setForm({ ...form, allowedRoles: newRoles });
                            }}
                          />
                          {role.name}
                        </label>
                      ))}
                    </div>
                    <small className="text-muted">Пусто = доступ всем</small>
                  </div>

                  <div className="form-group">
                    <label className="checkbox-item">
                      <input
                        type="checkbox"
                        checked={form.isPublished}
                        onChange={(e) => setForm({ ...form, isPublished: e.target.checked })}
                      />
                      Опубликовать
                    </label>
                  </div>

                  {form.contentType === 'html' && (
                    <>
                      <div className="form-group">
                        <label className="form-label">Custom CSS</label>
                        <textarea
                          className="textarea code-textarea"
                          placeholder=".my-class { color: red; }"
                          value={form.customCss}
                          onChange={(e) => setForm({ ...form, customCss: e.target.value })}
                          rows={5}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Custom JavaScript</label>
                        <textarea
                          className="textarea code-textarea"
                          placeholder="console.log('Hello');"
                          value={form.customJs}
                          onChange={(e) => setForm({ ...form, customJs: e.target.value })}
                          rows={5}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}