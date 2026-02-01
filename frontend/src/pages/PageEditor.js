import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Save, ArrowLeft, Eye, Code, FileText, Settings, Clock, Grid } from 'lucide-react';
import { pages, roles } from '../services/api';
import Editor from '../components/Editor';
import CodeEditor from '../components/CodeEditor';
import SpreadsheetEditor from '../components/SpreadsheetEditor';
import IconPicker from '../components/IconPicker';
import PageHistoryModal from '../components/PageHistoryModal';
import toast from 'react-hot-toast';
import './PageEditor.css';

export default function PageEditor() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const isNew = !slug || slug === 'new';

  const spreadsheetRef = useRef(null);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [allRoles, setAllRoles] = useState([]);
  
  const [form, setForm] = useState({
    title: '',
    slug: '',
    icon: '',
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
        icon: data.icon || '',
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

    // Если редактируем таблицу, сохраняем изменения принудительно
    if (form.contentType === 'spreadsheet' && spreadsheetRef.current) {
      spreadsheetRef.current.forceSave();
      // Небольшая задержка чтобы onChange успел обновить form.content
      await new Promise(resolve => setTimeout(resolve, 100));
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
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowHistory(true)}
                >
                  <Clock size={18} />
                  Журнал изменений
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => window.open(`/page/${form.slug}`, '_blank')}
                >
                  <Eye size={18} />
                  Просмотр
                </button>
              </>
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
              <button
                type="button"
                className={`editor-type-tab ${form.contentType === 'spreadsheet' ? 'active' : ''}`}
                onClick={() => setForm({ ...form, contentType: 'spreadsheet' })}
              >
                <Grid size={16} />
                Таблица (Excel)
              </button>
            </div>

            {form.contentType === 'wysiwyg' ? (
              <Editor
                content={form.content}
                onChange={(content) => setForm({ ...form, content })}
                placeholder="Начните писать..."
              />
            ) : form.contentType === 'spreadsheet' ? (
              <SpreadsheetEditor
                ref={spreadsheetRef}
                content={form.content}
                onChange={(content) => setForm({ ...form, content })}
                pageId={form.id}
              />
            ) : (
              <div className="html-editor">
                <CodeEditor
                  value={form.content}
                  onChange={(content) => setForm({ ...form, content })}
                  language="html"
                  placeholder="<div>Ваш HTML код...</div>"
                  height="500px"
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
                    <label className="form-label">Эмодзи страницы</label>
                    <IconPicker
                      value={form.icon}
                      onChange={(icon) => setForm({ ...form, icon })}
                      placeholder="Выберите эмодзи"
                    />
                    <small className="text-muted">Отображается в меню и проводнике. Цветной эмодзи вместо иконки</small>
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
                        <CodeEditor
                          value={form.customCss}
                          onChange={(customCss) => setForm({ ...form, customCss })}
                          language="css"
                          placeholder=".my-class { color: red; }"
                          height="150px"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Custom JavaScript</label>
                        <CodeEditor
                          value={form.customJs}
                          onChange={(customJs) => setForm({ ...form, customJs })}
                          language="javascript"
                          placeholder="console.log('Hello');"
                          height="150px"
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

      {/* Модальное окно истории */}
      {showHistory && form.id && (
        <PageHistoryModal
          pageId={form.id}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}