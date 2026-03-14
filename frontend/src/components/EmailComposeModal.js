import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, FileText, Send, Plus, Edit, Trash2, Save, Star, Table2, Code2, AlignLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import Editor from './Editor';
import { email, roles as rolesApi, media } from '../services/api';
import { BASE_URL } from '../services/api';
import './EmailComposeModal.css';

const EmailComposeModal = ({ onClose }) => {
  // States
  const [subject, setSubject] = useState('');
  const [htmlContent, setHtmlContent] = useState('');
  const [recipients, setRecipients] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showRecipientPicker, setShowRecipientPicker] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [templateForm, setTemplateForm] = useState({ name: '', subject: '', htmlContent: '', isPublic: true });

  // Favorites
  const [favoriteRecipients, setFavoriteRecipients] = useState([]); // [{id, email, displayName}]
  const [favoriteTemplateIds, setFavoriteTemplateIds] = useState([]); // [templateId, ...]


  const fileInputRef = useRef(null);
  const excelInputRef = useRef(null);
  const recipientPickerRef = useRef(null);
  const [importingExcel, setImportingExcel] = useState(false);

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  // Close recipient picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (recipientPickerRef.current && !recipientPickerRef.current.contains(event.target)) {
        setShowRecipientPicker(false);
      }
    };

    if (showRecipientPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showRecipientPicker]);

  const loadData = async () => {
    try {
      const [templatesRes, usersRes, rolesRes, favRecipientsRes, favTemplatesRes] = await Promise.all([
        email.getTemplates(),
        email.getUsers(),
        rolesApi.list(),
        email.getFavoriteRecipients(),
        email.getFavoriteTemplates()
      ]);

      setTemplates(templatesRes.data);
      setAllUsers(usersRes.data);
      setRoles(rolesRes.data);
      setFavoriteRecipients(favRecipientsRes.data);
      setFavoriteTemplateIds(favTemplatesRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Ошибка загрузки данных');
    }
  };

  // Editor modes
  const [editorMode, setEditorMode] = useState('wysiwyg'); // 'wysiwyg' | 'html'
  const [templateEditorMode, setTemplateEditorMode] = useState('wysiwyg');

  // Template management
  const [editorKey, setEditorKey] = useState(0);

  const applyTemplate = (template) => {
    setSubject(template.subject);
    setHtmlContent(template.htmlContent);
    setEditorKey(prev => prev + 1);
    setShowTemplates(false);
    toast.success('Шаблон применен');
  };

  const openTemplateManager = (template = null) => {
    if (template) {
      setEditingTemplate(template);
      setTemplateForm({
        name: template.name,
        subject: template.subject,
        htmlContent: template.htmlContent,
        isPublic: template.isPublic
      });
    } else {
      setEditingTemplate(null);
      setTemplateForm({ name: '', subject: '', htmlContent: '', isPublic: true });
    }
    setTemplateEditorMode('wysiwyg');
    setShowTemplateManager(true);
  };

  const saveTemplate = async () => {
    if (!templateForm.name.trim() || !templateForm.subject.trim()) {
      toast.error('Заполните название и тему шаблона');
      return;
    }

    try {
      if (editingTemplate) {
        await email.updateTemplate(editingTemplate.id, templateForm);
        toast.success('Шаблон обновлен');
      } else {
        await email.createTemplate(templateForm);
        toast.success('Шаблон создан');
      }
      setShowTemplateManager(false);
      loadData();
    } catch (error) {
      console.error('Error saving template:', error);
      toast.error('Ошибка сохранения шаблона');
    }
  };

  const deleteTemplate = async (templateId) => {
    if (!window.confirm('Удалить этот шаблон?')) return;

    try {
      await email.deleteTemplate(templateId);
      toast.success('Шаблон удален');
      loadData();
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Ошибка удаления шаблона');
    }
  };

  const toggleFavoriteTemplate = async (templateId, e) => {
    e.stopPropagation();
    try {
      const { data } = await email.toggleFavoriteTemplate(templateId);
      if (data.favorited) {
        setFavoriteTemplateIds(prev => [...prev, templateId]);
      } else {
        setFavoriteTemplateIds(prev => prev.filter(id => id !== templateId));
      }
    } catch (error) {
      console.error('Error toggling favorite template:', error);
      toast.error('Ошибка обновления избранного');
    }
  };

  // Recipient management
  const addRecipient = (recipientData) => {
    // recipientData: { email, displayName, userId? }
    if (recipients.find(r => r.email === recipientData.email)) {
      return; // Already added
    }

    setRecipients(prev => [...prev, {
      userId: recipientData.userId || null,
      email: recipientData.email,
      displayName: recipientData.displayName || recipientData.email
    }]);
  };

  const addUserRecipient = (user) => {
    addRecipient({
      userId: user.id,
      email: user.email,
      displayName: user.displayName || user.username
    });
  };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Parse and add one or multiple emails from the search field (supports comma-separated list)
  const addEmailsFromQuery = (raw) => {
    const parts = raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    const valid = parts.filter(e => emailRegex.test(e));
    const invalid = parts.filter(e => !emailRegex.test(e));

    valid.forEach(e => addRecipient({ email: e, displayName: e }));

    if (valid.length > 0) setUserSearchQuery('');
    if (invalid.length > 0 && parts.length > 1) {
      toast.error(`Некорректные адреса: ${invalid.join(', ')}`);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      setShowRecipientPicker(false);
      return;
    }
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = userSearchQuery.trim().replace(/,$/, '');
      if (val) addEmailsFromQuery(val);
    }
  };

  const handleSearchChange = (e) => {
    const val = e.target.value;
    // Auto-parse when user pastes comma-separated list
    if (val.includes(',') || val.includes(';')) {
      addEmailsFromQuery(val);
    } else {
      setUserSearchQuery(val);
    }
  };

  const removeRecipient = (recipientEmail) => {
    setRecipients(recipients.filter(r => r.email !== recipientEmail));
  };

  const toggleRoleFilter = async (roleId) => {
    if (selectedRoles.includes(roleId)) {
      setSelectedRoles(selectedRoles.filter(r => r !== roleId));
    } else {
      setSelectedRoles([...selectedRoles, roleId]);

      try {
        const res = await email.getUsersByRole(roleId);
        const newRecipients = res.data
          .filter(u => !recipients.find(r => r.email === u.email))
          .map(u => ({
            userId: u.id,
            email: u.email,
            displayName: u.displayName || u.username
          }));

        setRecipients(prev => [...prev, ...newRecipients]);

        if (newRecipients.length > 0) {
          toast.success(`Добавлено ${newRecipients.length} получателей`);
        }
      } catch (error) {
        console.error('Error loading role users:', error);
        toast.error('Ошибка загрузки пользователей по роли');
      }
    }
  };

  // Favorite recipients
  const addFavoriteRecipient = async (recipientEmail, displayName) => {
    try {
      const { data } = await email.addFavoriteRecipient({ email: recipientEmail, displayName });
      setFavoriteRecipients(prev => {
        if (prev.find(f => f.email === recipientEmail)) return prev;
        return [...prev, data];
      });
      toast.success('Добавлено в избранное');
    } catch (error) {
      console.error('Error adding favorite recipient:', error);
      toast.error('Ошибка добавления в избранное');
    }
  };

  const removeFavoriteRecipient = async (favId, e) => {
    e.stopPropagation();
    try {
      await email.removeFavoriteRecipient(favId);
      setFavoriteRecipients(prev => prev.filter(f => f.id !== favId));
    } catch (error) {
      console.error('Error removing favorite recipient:', error);
      toast.error('Ошибка удаления из избранного');
    }
  };

  const isRecipientFavorite = (recipientEmail) => {
    return favoriteRecipients.some(f => f.email === recipientEmail);
  };

  const getFavoriteId = (recipientEmail) => {
    return favoriteRecipients.find(f => f.email === recipientEmail)?.id;
  };

  const toggleFavoriteRecipient = async (recipientEmail, displayName, e) => {
    e.stopPropagation();
    const favId = getFavoriteId(recipientEmail);
    if (favId) {
      await removeFavoriteRecipient(favId, e);
    } else {
      await addFavoriteRecipient(recipientEmail, displayName);
    }
  };

  // Excel import
  const handleExcelImport = async (e) => {
    const file = e.target.files?.[0];
    if (!excelInputRef.current) return;
    excelInputRef.current.value = '';
    if (!file) return;

    setImportingExcel(true);
    try {
      const { data } = await email.parseExcel(file);
      if (!data.emails || data.emails.length === 0) {
        toast.error('Email-адреса в файле не найдены');
        return;
      }

      let added = 0;
      data.emails.forEach(emailAddr => {
        if (!recipients.find(r => r.email === emailAddr)) {
          setRecipients(prev => [...prev, { email: emailAddr, displayName: emailAddr, userId: null }]);
          added++;
        }
      });

      toast.success(`Добавлено ${added} из ${data.count} адресов из файла`);
    } catch (error) {
      console.error('Error importing Excel:', error);
      toast.error('Ошибка разбора файла');
    } finally {
      setImportingExcel(false);
    }
  };

  // File attachments
  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    if (attachments.length + files.length > 10) {
      toast.error('Максимум 10 файлов');
      return;
    }

    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`Файл ${file.name} слишком большой (макс. 50MB)`);
          continue;
        }

        const { data } = await media.upload(file);
        setAttachments(prev => [...prev, {
          id: data.id,
          name: data.originalName,
          path: data.path,
          thumbnailPath: data.thumbnailPath,
          mimeType: data.mimeType,
          size: data.size
        }]);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Ошибка загрузки файла');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index) => {
    setAttachments(attachments.filter((_, i) => i !== index));
  };

  // Send email
  const handleSend = async () => {
    if (!subject.trim()) {
      toast.error('Введите тему письма');
      return;
    }

    if (recipients.length === 0) {
      toast.error('Выберите получателей');
      return;
    }

    if (!htmlContent.trim() || htmlContent === '<p></p>') {
      toast.error('Введите текст письма');
      return;
    }

    setSending(true);
    try {
      const { data } = await email.send({
        subject,
        htmlContent,
        recipients,
        attachments
      });

      toast.success(`✅ Отправлено: ${data.sent} писем`);
      if (data.failed > 0) {
        toast.error(`⚠️ Ошибок: ${data.failed}`);
      }

      onClose();
    } catch (error) {
      console.error('Error sending email:', error);
      toast.error('Ошибка отправки рассылки');
    } finally {
      setSending(false);
    }
  };

  // Filter users by search - show favorites first, then rest
  const filteredUsers = allUsers.filter(user => {
    const searchLower = userSearchQuery.toLowerCase();
    return (
      (user.displayName && user.displayName.toLowerCase().includes(searchLower)) ||
      user.username.toLowerCase().includes(searchLower) ||
      (user.email && user.email.toLowerCase().includes(searchLower))
    );
  });

  // Favorites that don't appear in allUsers (external addresses)
  const filteredFavoriteRecipients = favoriteRecipients.filter(fav => {
    if (!userSearchQuery) return true;
    const q = userSearchQuery.toLowerCase();
    return fav.email.toLowerCase().includes(q) || (fav.displayName && fav.displayName.toLowerCase().includes(q));
  });

  // External favorites (not in allUsers)
  const externalFavorites = filteredFavoriteRecipients.filter(
    fav => !allUsers.find(u => u.email === fav.email)
  );

  // Sort allUsers: favorites first
  const sortedUsers = [
    ...filteredUsers.filter(u => isRecipientFavorite(u.email)),
    ...filteredUsers.filter(u => !isRecipientFavorite(u.email))
  ];

  // Sort templates: favorites first
  const sortedTemplates = [
    ...templates.filter(t => favoriteTemplateIds.includes(t.id)),
    ...templates.filter(t => !favoriteTemplateIds.includes(t.id))
  ];

  // Helpers
  const getFileIcon = (mimeType) => {
    if (mimeType?.startsWith('image/')) return '🖼️';
    if (mimeType?.startsWith('video/')) return '🎥';
    if (mimeType?.includes('pdf')) return '📄';
    if (mimeType?.includes('word') || mimeType?.includes('document')) return '📝';
    if (mimeType?.includes('sheet') || mimeType?.includes('excel')) return '📊';
    return '📎';
  };

  const fixUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    return `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  return (
    <div className="modal-overlay email-compose-modal" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2>Новое письмо</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {/* To: Recipients */}
          <div className="email-field-row" style={{ position: 'relative' }} ref={recipientPickerRef}>
            <div className="email-field-label">Кому:</div>
            <div className="email-field-content">
              <div className="email-recipients-chips">
                {recipients.map(r => {
                  const isFav = isRecipientFavorite(r.email);
                  return (
                    <div key={r.email} className="email-recipient-chip">
                      <button
                        className={`chip-star-btn ${isFav ? 'active' : ''}`}
                        onClick={(e) => toggleFavoriteRecipient(r.email, r.displayName, e)}
                        title={isFav ? 'Убрать из избранного' : 'Добавить в избранное'}
                      >
                        <Star size={11} />
                      </button>
                      {r.displayName}
                      <button onClick={() => removeRecipient(r.email)}>
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
                <button
                  className="btn-add-recipients"
                  onClick={() => setShowRecipientPicker(!showRecipientPicker)}
                >
                  + Добавить получателей
                </button>
              </div>

              {/* Recipient Picker Dropdown */}
              {showRecipientPicker && (
                <div className="email-recipient-picker">
                  <div className="email-recipient-picker-header">
                    <input
                      type="text"
                      className="email-recipient-search"
                      placeholder="Поиск, email или список через запятую..."
                      value={userSearchQuery}
                      onChange={handleSearchChange}
                      onKeyDown={handleSearchKeyDown}
                      autoFocus
                    />
                    <button
                      className="btn-icon-sm"
                      style={{ marginTop: '6px', flexShrink: 0 }}
                      onClick={() => excelInputRef.current?.click()}
                      disabled={importingExcel}
                      title="Импорт из Excel"
                    >
                      {importingExcel ? '...' : <Table2 size={15} />}
                    </button>
                    <input
                      ref={excelInputRef}
                      type="file"
                      hidden
                      accept=".xlsx,.xls,.csv"
                      onChange={handleExcelImport}
                    />
                    <button
                      className="btn-icon-sm"
                      style={{ marginTop: '6px', marginLeft: 'auto', display: 'flex' }}
                      onClick={() => setShowRecipientPicker(false)}
                      title="Закрыть"
                    >
                      <X size={15} />
                    </button>
                  </div>

                  {/* Role Filters */}
                  {roles.length > 0 && (
                    <div className="email-role-filters">
                      {roles.map(role => (
                        <div key={role.id} className="email-role-filter-item">
                          <input
                            type="checkbox"
                            id={`role-${role.id}`}
                            checked={selectedRoles.includes(role.id)}
                            onChange={() => toggleRoleFilter(role.id)}
                          />
                          <label htmlFor={`role-${role.id}`}>{role.name}</label>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* External favorites (not in user list) */}
                  {externalFavorites.length > 0 && (
                    <>
                      <div className="email-picker-section-label">Избранные адреса</div>
                      {externalFavorites.map(fav => (
                        <div
                          key={fav.id}
                          className="email-user-item"
                          onClick={() => addRecipient({ email: fav.email, displayName: fav.displayName })}
                        >
                          <div className="email-user-name">
                            <Star size={12} className="email-fav-star filled" style={{ color: '#FF9500', marginRight: 4, flexShrink: 0 }} />
                            {fav.displayName || fav.email}
                          </div>
                          <div className="email-user-actions">
                            <div className="email-user-email">{fav.email}</div>
                            <button
                              className="btn-icon-sm email-star-btn active"
                              onClick={(e) => removeFavoriteRecipient(fav.id, e)}
                              title="Убрать из избранного"
                            >
                              <Star size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {sortedUsers.length > 0 && <div className="email-picker-section-label">Пользователи системы</div>}
                    </>
                  )}

                  {/* Users List */}
                  <div className="email-users-list">
                    {sortedUsers.length === 0 && externalFavorites.length === 0 ? (
                      <div style={{ padding: '12px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                        {userSearchQuery
                          ? emailRegex.test(userSearchQuery.trim())
                            ? <span>Нажмите <strong>Enter</strong>, чтобы добавить «{userSearchQuery.trim()}»</span>
                            : 'Пользователи не найдены'
                          : 'Начните вводить имя или email'
                        }
                      </div>
                    ) : (
                      sortedUsers.map(user => {
                        const isFav = isRecipientFavorite(user.email);
                        return (
                          <div
                            key={user.id}
                            className="email-user-item"
                            onClick={() => addUserRecipient(user)}
                          >
                            <div className="email-user-name">
                              {isFav && <Star size={12} style={{ color: '#FF9500', marginRight: 4, flexShrink: 0 }} />}
                              {user.displayName || user.username}
                            </div>
                            <div className="email-user-actions">
                              <div className="email-user-email">{user.email}</div>
                              <button
                                className={`btn-icon-sm email-star-btn ${isFav ? 'active' : ''}`}
                                onClick={(e) => toggleFavoriteRecipient(user.email, user.displayName || user.username, e)}
                                title={isFav ? 'Убрать из избранного' : 'Добавить в избранное'}
                              >
                                <Star size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Subject */}
          <div className="email-field-row">
            <div className="email-field-label">Тема:</div>
            <div className="email-field-content">
              <input
                type="text"
                className="email-field-input"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Введите тему письма"
              />
            </div>
          </div>

          {/* Editor */}
          <div className="email-editor-container">
            <div className="email-editor-mode-toggle">
              <button
                className={`email-mode-btn ${editorMode === 'wysiwyg' ? 'active' : ''}`}
                onClick={() => { if (editorMode !== 'wysiwyg') { setEditorKey(k => k + 1); setEditorMode('wysiwyg'); } }}
                title="Визуальный редактор"
              >
                <AlignLeft size={13} /> Визуально
              </button>
              <button
                className={`email-mode-btn ${editorMode === 'html' ? 'active' : ''}`}
                onClick={() => setEditorMode('html')}
                title="Редактировать HTML"
              >
                <Code2 size={13} /> HTML
              </button>
            </div>
            {editorMode === 'wysiwyg' ? (
              <Editor
                key={editorKey}
                content={htmlContent}
                onChange={setHtmlContent}
                placeholder="Введите текст письма..."
              />
            ) : (
              <textarea
                className="email-html-textarea"
                value={htmlContent}
                onChange={e => setHtmlContent(e.target.value)}
                placeholder="Вставьте HTML-код письма..."
              />
            )}
          </div>
        </div>

        {/* Attachments Preview (if any) */}
        {attachments.length > 0 && (
          <div className="email-attachments-preview">
            {attachments.map((att, idx) => (
              <div key={idx} className="email-attachment-item">
                {att.mimeType?.startsWith('image/') ? (
                  <img src={fixUrl(att.thumbnailPath || att.path)} alt={att.name} />
                ) : (
                  <div className="email-attachment-file-icon">
                    <span style={{ fontSize: '32px' }}>{getFileIcon(att.mimeType)}</span>
                  </div>
                )}
                <button
                  className="email-attachment-remove"
                  onClick={() => removeAttachment(idx)}
                >
                  <X size={12} />
                </button>
                <div className="email-attachment-name">{att.name}</div>
              </div>
            ))}
          </div>
        )}

        {/* Footer Toolbar */}
        <div className="email-compose-footer">
          <div className="email-footer-actions">
            {/* Templates */}
            <div className="email-templates-dropdown">
              <button
                className={`btn-icon-toolbar ${showTemplates ? 'active' : ''}`}
                onClick={() => setShowTemplates(!showTemplates)}
                title="Шаблоны"
              >
                <FileText size={18} />
              </button>

              {showTemplates && (
                <div className="email-templates-list">
                  <div className="email-templates-header">
                    Шаблоны
                    <button
                      className="btn-icon-sm"
                      onClick={() => openTemplateManager()}
                      title="Создать шаблон"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  {sortedTemplates.length === 0 ? (
                    <div className="email-templates-empty">
                      Нет шаблонов.{' '}
                      <button className="link-button" onClick={() => openTemplateManager()}>
                        Создать
                      </button>
                    </div>
                  ) : (
                    sortedTemplates.map(template => {
                      const isFavTemplate = favoriteTemplateIds.includes(template.id);
                      return (
                        <div key={template.id} className="email-template-item-wrapper">
                          <div
                            className="email-template-item"
                            onClick={() => applyTemplate(template)}
                          >
                            <div className="email-template-name">
                              {isFavTemplate && <Star size={11} style={{ color: '#FF9500', marginRight: 4, flexShrink: 0 }} />}
                              {template.name}
                            </div>
                            <div className="email-template-subject">{template.subject}</div>
                          </div>
                          <div className="email-template-actions">
                            <button
                              className={`btn-icon-sm ${isFavTemplate ? 'email-star-btn active' : 'email-star-btn'}`}
                              onClick={(e) => toggleFavoriteTemplate(template.id, e)}
                              title={isFavTemplate ? 'Убрать из избранного' : 'В избранное'}
                            >
                              <Star size={13} />
                            </button>
                            <button
                              className="btn-icon-sm"
                              onClick={(e) => { e.stopPropagation(); openTemplateManager(template); }}
                              title="Редактировать"
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              className="btn-icon-sm"
                              onClick={(e) => { e.stopPropagation(); deleteTemplate(template.id); }}
                              title="Удалить"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Attach Files */}
            <button
              className="btn-icon-toolbar"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Прикрепить файлы"
            >
              <Upload size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={handleFileSelect}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
            />
          </div>

          {/* Send Button */}
          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={sending || uploading}
          >
            {sending ? 'Отправка...' : <><Send size={16} /> Отправить</>}
          </button>
        </div>
      </div>

      {/* Template Manager Modal */}
      {showTemplateManager && (
        <div className="modal-overlay email-compose-modal" onClick={() => setShowTemplateManager(false)} style={{ zIndex: 10001 }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '800px' }}>
            <div className="modal-header">
              <h2>{editingTemplate ? 'Редактировать шаблон' : 'Новый шаблон'}</h2>
              <button className="modal-close" onClick={() => setShowTemplateManager(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {/* Template Name */}
              <div className="email-field-row">
                <div className="email-field-label">Название:</div>
                <div className="email-field-content">
                  <input
                    type="text"
                    className="email-field-input"
                    value={templateForm.name}
                    onChange={e => setTemplateForm({ ...templateForm, name: e.target.value })}
                    placeholder="Приветственное письмо"
                  />
                </div>
              </div>

              {/* Subject */}
              <div className="email-field-row">
                <div className="email-field-label">Тема:</div>
                <div className="email-field-content">
                  <input
                    type="text"
                    className="email-field-input"
                    value={templateForm.subject}
                    onChange={e => setTemplateForm({ ...templateForm, subject: e.target.value })}
                    placeholder="Введите тему письма"
                  />
                </div>
              </div>

              {/* Editor */}
              <div className="email-editor-container">
                <div className="email-editor-mode-toggle">
                  <button
                    className={`email-mode-btn ${templateEditorMode === 'wysiwyg' ? 'active' : ''}`}
                    onClick={() => setTemplateEditorMode('wysiwyg')}
                    title="Визуальный редактор"
                  >
                    <AlignLeft size={13} /> Визуально
                  </button>
                  <button
                    className={`email-mode-btn ${templateEditorMode === 'html' ? 'active' : ''}`}
                    onClick={() => setTemplateEditorMode('html')}
                    title="Редактировать HTML"
                  >
                    <Code2 size={13} /> HTML
                  </button>
                </div>
                {templateEditorMode === 'wysiwyg' ? (
                  <Editor
                    content={templateForm.htmlContent}
                    onChange={(content) => setTemplateForm({ ...templateForm, htmlContent: content })}
                    placeholder="Введите текст шаблона..."
                  />
                ) : (
                  <textarea
                    className="email-html-textarea"
                    value={templateForm.htmlContent}
                    onChange={e => setTemplateForm({ ...templateForm, htmlContent: e.target.value })}
                    placeholder="Вставьте HTML-код шаблона..."
                  />
                )}
              </div>

              {/* Public Template Checkbox */}
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  <input
                    type="checkbox"
                    checked={templateForm.isPublic}
                    onChange={e => setTemplateForm({ ...templateForm, isPublic: e.target.checked })}
                  />
                  Публичный шаблон (доступен всем пользователям)
                </label>
              </div>
            </div>

            <div className="email-compose-footer">
              <div className="email-footer-actions"></div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-ghost" onClick={() => setShowTemplateManager(false)}>
                  Отмена
                </button>
                <button className="btn btn-primary" onClick={saveTemplate}>
                  <Save size={16} /> {editingTemplate ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailComposeModal;
