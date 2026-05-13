import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Save, ArrowLeft, Plus, Edit, Trash2, GripVertical,
  BookOpen, FileText, HelpCircle, ChevronDown, X as XIcon, Search, Printer
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { courses, roles as rolesApi, users } from '../../services/api';
import Editor from '../../components/Editor';
import toast from 'react-hot-toast';
import '../Admin.css';
import './AdminCourseEditor.css';

// Компонент для множественного выбора (из AdminUsers)
function MultiSelect({ label, placeholder, value, onChange, options, optionKey = 'id', optionLabel = 'name', optionDescription = null, disabledOptions = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const selectedItems = options.filter(opt => value.includes(opt[optionKey]));

  const toggleOption = (optId) => {
    // Не позволяем изменять отключенные опции
    if (disabledOptions.includes(optId)) {
      return;
    }

    if (value.includes(optId)) {
      onChange(value.filter(id => id !== optId));
    } else {
      onChange([...value, optId]);
    }
  };

  const removeItem = (optId, e) => {
    e.stopPropagation();

    // Не позволяем удалять отключенные опции
    if (disabledOptions.includes(optId)) {
      return;
    }

    onChange(value.filter(id => id !== optId));
  };

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div className="multi-select" ref={dropdownRef}>
        <div
          className={`multi-select-trigger ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
        >
          {selectedItems.length === 0 ? (
            <span className="multi-select-placeholder">{placeholder}</span>
          ) : (
            <div className="multi-select-values">
              {selectedItems.map(item => {
                const isDisabled = disabledOptions.includes(item[optionKey]);
                return (
                  <span key={item[optionKey]} className="multi-select-value">
                    {item[optionLabel]}
                    {!isDisabled && (
                      <button onClick={(e) => removeItem(item[optionKey], e)} type="button">
                        <XIcon size={12} />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          <ChevronDown size={18} className={`multi-select-chevron ${isOpen ? 'open' : ''}`} />
        </div>

        {isOpen && (
          <div className="multi-select-dropdown">
            {options.map(option => {
              const isDisabled = disabledOptions.includes(option[optionKey]);
              const isChecked = value.includes(option[optionKey]);
              return (
                <div
                  key={option[optionKey]}
                  className={`multi-select-option ${isDisabled ? 'disabled' : ''}`}
                  onClick={() => toggleOption(option[optionKey])}
                  style={isDisabled ? { cursor: 'not-allowed' } : {}}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={() => {}}
                    style={isDisabled && isChecked ? { opacity: 1 } : {}}
                  />
                  <div className="multi-select-option-label">
                    <div>{option[optionLabel]}</div>
                    {optionDescription && option[optionDescription] && (
                      <div className="multi-select-option-desc">{option[optionDescription]}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Единый контрол доступа: роли + медцентры + пользователи с поиском
function AccessPicker({
  roleIds, onChangeRoles, roles, disabledRoles = [],
  medCenterIds, onChangeMedCenters, medCenters,
  userIds, onChangeUsers, users
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && searchRef.current) searchRef.current.focus();
  }, [isOpen]);

  const q = search.toLowerCase();
  const filteredRoles = roles.filter(r => r.name.toLowerCase().includes(q));
  const filteredMedCenters = medCenters.filter(m => m.displayName.toLowerCase().includes(q));
  const filteredUsers = users.filter(u =>
    (u.displayName || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q)
  );

  const totalSelected = roleIds.length + medCenterIds.length + userIds.length;

  const toggleRole = (id) => {
    if (disabledRoles.includes(id)) return;
    onChangeRoles(roleIds.includes(id) ? roleIds.filter(x => x !== id) : [...roleIds, id]);
  };
  const toggleMedCenter = (id) => {
    onChangeMedCenters(medCenterIds.includes(id) ? medCenterIds.filter(x => x !== id) : [...medCenterIds, id]);
  };
  const toggleUser = (id) => {
    onChangeUsers(userIds.includes(id) ? userIds.filter(x => x !== id) : [...userIds, id]);
  };

  const removeChip = (type, id, e) => {
    e.stopPropagation();
    if (type === 'role' && !disabledRoles.includes(id)) toggleRole(id);
    else if (type === 'mc') toggleMedCenter(id);
    else if (type === 'user') toggleUser(id);
  };

  const selectedRoles = roles.filter(r => roleIds.includes(r.id));
  const selectedMedCenters = medCenters.filter(m => medCenterIds.includes(m.id));
  const selectedUsers = users.filter(u => userIds.includes(u.id));
  const noResults = filteredRoles.length === 0 && filteredMedCenters.length === 0 && filteredUsers.length === 0;

  return (
    <div className="access-picker" ref={dropdownRef}>
      <div
        className={`multi-select-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {totalSelected === 0 ? (
          <span className="multi-select-placeholder">Нет ограничений — курс доступен всем</span>
        ) : (
          <div className="multi-select-values">
            {selectedRoles.map(r => (
              <span key={r.id} className="access-chip access-chip--role">
                {r.name}
                {!disabledRoles.includes(r.id) && (
                  <button type="button" onClick={(e) => removeChip('role', r.id, e)}><XIcon size={11} /></button>
                )}
              </span>
            ))}
            {selectedMedCenters.map(m => (
              <span key={m.id} className="access-chip access-chip--mc">
                {m.displayName}
                <button type="button" onClick={(e) => removeChip('mc', m.id, e)}><XIcon size={11} /></button>
              </span>
            ))}
            {selectedUsers.map(u => (
              <span key={u.id} className="access-chip access-chip--user">
                {u.displayName || u.username}
                <button type="button" onClick={(e) => removeChip('user', u.id, e)}><XIcon size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <ChevronDown size={18} className={`multi-select-chevron ${isOpen ? 'open' : ''}`} />
      </div>

      {isOpen && (
        <div className="access-picker-dropdown">
          <div className="access-picker-search">
            <Search size={14} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Поиск..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>

          {filteredRoles.length > 0 && (
            <div className="access-picker-group">
              <div className="access-picker-group-header">Роли</div>
              {filteredRoles.map(r => {
                const isDisabled = disabledRoles.includes(r.id);
                return (
                  <div
                    key={r.id}
                    className={`multi-select-option ${isDisabled ? 'disabled' : ''}`}
                    onClick={() => toggleRole(r.id)}
                    style={isDisabled ? { cursor: 'not-allowed' } : {}}
                  >
                    <input type="checkbox" checked={roleIds.includes(r.id)} disabled={isDisabled} onChange={() => {}} />
                    <div className="multi-select-option-label">
                      <div>{r.name}</div>
                      {r.description && <div className="multi-select-option-desc">{r.description}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filteredMedCenters.length > 0 && (
            <div className="access-picker-group">
              <div className="access-picker-group-header">Медцентры</div>
              {filteredMedCenters.map(m => (
                <div key={m.id} className="multi-select-option" onClick={() => toggleMedCenter(m.id)}>
                  <input type="checkbox" checked={medCenterIds.includes(m.id)} onChange={() => {}} />
                  <div className="multi-select-option-label">{m.displayName}</div>
                </div>
              ))}
            </div>
          )}

          {filteredUsers.length > 0 && (
            <div className="access-picker-group">
              <div className="access-picker-group-header">Пользователи</div>
              {filteredUsers.map(u => (
                <div key={u.id} className="multi-select-option" onClick={() => toggleUser(u.id)}>
                  <input type="checkbox" checked={userIds.includes(u.id)} onChange={() => {}} />
                  <div className="multi-select-option-label">
                    <div>{u.displayName || u.username}</div>
                    {u.username && u.displayName && (
                      <div className="multi-select-option-desc">{u.username}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {noResults && (
            <div className="access-picker-empty">Ничего не найдено</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminCourseEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [activeTab, setActiveTab] = useState('info');
  
  // Course data
  const [form, setForm] = useState({
    title: '',
    description: '',
    icon: 'book-open',
    estimatedDuration: '',
    isPublished: false,
    allowedRoleIds: [],
    allowedMedCenterIds: [],
    allowedUserIds: []
  });

  const [lessons, setLessons] = useState([]);
  const [questions, setQuestions] = useState([]);

  // Access control lists
  const [availableRoles, setAvailableRoles] = useState([]);
  const [availableMedCenters, setAvailableMedCenters] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);

  // Admin role ID (всегда должна быть выбрана)
  const [adminRoleId, setAdminRoleId] = useState(null);

  // Modals
  const [lessonModal, setLessonModal] = useState(null);
  const [questionModal, setQuestionModal] = useState(null);

  useEffect(() => {
    loadRolesAndMedCenters();
    if (!isNew) {
      loadCourse();
    }
  }, [id]);

  // Автоматически добавляем роль администратора в выбранные роли
  useEffect(() => {
    if (adminRoleId && !form.allowedRoleIds.includes(adminRoleId)) {
      setForm(prev => {
        // Проверяем еще раз, чтобы избежать лишних обновлений
        if (!prev.allowedRoleIds.includes(adminRoleId)) {
          return {
            ...prev,
            allowedRoleIds: [...prev.allowedRoleIds, adminRoleId]
          };
        }
        return prev;
      });
    }
  }, [adminRoleId, form.allowedRoleIds]);

  const loadRolesAndMedCenters = async () => {
    try {
      const [rolesRes, medCentersRes, usersRes] = await Promise.all([
        rolesApi.list(),
        users.getMedCenters(),
        users.listBasic()
      ]);
      const roles = rolesRes.data || [];
      setAvailableRoles(roles);
      setAvailableMedCenters(medCentersRes.data || []);
      setAvailableUsers(usersRes.data || []);

      // Находим роль администратора
      const adminRole = roles.find(r => r.name === 'Администратор');
      if (adminRole) {
        setAdminRoleId(adminRole.id);
      }
    } catch (error) {
      console.error('Load roles/medcenters error:', error);
      toast.error('Ошибка загрузки данных для контроля доступа');
    }
  };

  const loadCourse = async () => {
    try {
      const { data } = await courses.adminGet(id);
      setForm({
        title: data.title,
        description: data.description || '',
        icon: data.icon || 'book-open',
        estimatedDuration: data.estimatedDuration || '',
        isPublished: data.isPublished,
        allowedRoleIds: data.allowedRoles?.map(r => r.id) || [],
        allowedMedCenterIds: data.allowedMedCenters?.map(m => m.id) || [],
        allowedUserIds: data.allowedUsers?.map(u => u.id) || []
      });
      setLessons(data.lessons || []);
      setQuestions(data.testQuestions || []);
    } catch (error) {
      console.error('Load course error:', error);
      toast.error('Ошибка загрузки курса');
      navigate('/admin/courses');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCourse = async () => {
    if (!form.title.trim()) {
      toast.error('Введите название курса');
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        const { data } = await courses.create(form);
        toast.success('Курс создан');
        navigate(`/admin/courses/${data.id}/edit`);
      } else {
        await courses.update(id, form);
        toast.success('Курс сохранен');
        loadCourse();
      }
    } catch (error) {
      console.error('Save course error:', error);
      toast.error('Ошибка сохранения курса');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveLesson = async (lessonData) => {
    try {
      if (lessonData.id) {
        await courses.updateLesson(lessonData.id, lessonData);
        toast.success('Урок сохранен');
      } else {
        await courses.createLesson(id, lessonData);
        toast.success('Урок создан');
      }
      loadCourse();
      setLessonModal(null);
    } catch (error) {
      console.error('Save lesson error:', error);
      toast.error('Ошибка сохранения урока');
    }
  };

  const handleDeleteLesson = async (lesson) => {
    if (!window.confirm(`Удалить урок "${lesson.title}"?`)) {
      return;
    }

    try {
      await courses.deleteLesson(lesson.id);
      toast.success('Урок удален');
      loadCourse();
    } catch (error) {
      console.error('Delete lesson error:', error);
      toast.error('Ошибка удаления урока');
    }
  };

  const handleLessonDragEnd = async (result) => {
    if (!result.destination) return;

    const items = Array.from(lessons);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);

    setLessons(items);

    try {
      await courses.reorderLessons(id, items.map(l => l.id));
    } catch (error) {
      console.error('Reorder lessons error:', error);
      toast.error('Ошибка изменения порядка');
      loadCourse();
    }
  };

  const handlePrintAllLessons = () => {
    if (lessons.length === 0) {
      toast.error('Нет уроков для печати');
      return;
    }

    const win = window.open('', '_blank');
    if (!win) {
      toast.error('Браузер заблокировал открытие окна');
      return;
    }

    const lessonsHtml = lessons.map((lesson, index) => `
      <div class="lesson-block${index > 0 ? ' page-break' : ''}">
        <h2 class="lesson-title">Урок ${index + 1}. ${lesson.title || ''}</h2>
        <div class="lesson-content">${lesson.content || ''}</div>
      </div>
    `).join('');

    win.document.write(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>${form.title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; background: #fff; padding: 0; }
    .course-title { font-size: 22pt; font-weight: 700; margin-bottom: 6px; }
    .course-meta { font-size: 10pt; color: #555; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 2px solid #000; }
    .lesson-block { margin-bottom: 32px; }
    .page-break { page-break-before: always; padding-top: 0; }
    .lesson-title { font-size: 16pt; font-weight: 600; margin-bottom: 16px; padding-bottom: 6px; border-bottom: 1px solid #ccc; }
    .lesson-content { line-height: 1.6; }
    .lesson-content h1, .lesson-content h2, .lesson-content h3 { margin: 16px 0 8px; font-weight: 600; }
    .lesson-content p { margin-bottom: 8px; }
    .lesson-content ul, .lesson-content ol { margin: 8px 0 8px 24px; }
    .lesson-content li { margin-bottom: 4px; }
    .lesson-content table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    .lesson-content th, .lesson-content td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
    .lesson-content th { background: #f0f0f0; font-weight: 600; }
    .lesson-content img { max-width: 100%; height: auto; }
    .lesson-content pre, .lesson-content code { font-family: monospace; background: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
    .lesson-content pre { padding: 10px; white-space: pre-wrap; word-break: break-word; }
    .lesson-content blockquote { border-left: 3px solid #ccc; padding-left: 12px; color: #555; margin: 8px 0; }
    @media print {
      @page { size: A4 portrait; margin: 15mm; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .page-break { page-break-before: always !important; }
    }
  </style>
</head>
<body>
  <div class="course-title">${form.title}</div>
  ${form.description ? `<div class="course-meta">${form.description}</div>` : ''}
  ${lessonsHtml}
  <script>
    window.onload = function() {
      window.print();
      window.onafterprint = function() { window.close(); };
    };
  </script>
</body>
</html>`);
    win.document.close();
  };

  const handleSaveQuestion = async (questionData) => {
    try {
      if (questionData.id) {
        await courses.updateQuestion(questionData.id, questionData);
        toast.success('Вопрос сохранен');
      } else {
        await courses.createQuestion(id, questionData);
        toast.success('Вопрос создан');
      }
      loadCourse();
      setQuestionModal(null);
    } catch (error) {
      console.error('Save question error:', error);
      toast.error('Ошибка сохранения вопроса');
    }
  };

  const handleDeleteQuestion = async (question) => {
    if (!window.confirm('Удалить этот вопрос?')) {
      return;
    }

    try {
      await courses.deleteQuestion(question.id);
      toast.success('Вопрос удален');
      loadCourse();
    } catch (error) {
      console.error('Delete question error:', error);
      toast.error('Ошибка удаления вопроса');
    }
  };

  const handleQuestionDragEnd = async (result) => {
    if (!result.destination) return;

    const items = Array.from(questions);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);

    setQuestions(items);

    try {
      await courses.reorderQuestions(id, items.map(q => q.id));
    } catch (error) {
      console.error('Reorder questions error:', error);
      toast.error('Ошибка изменения порядка');
      loadCourse();
    }
  };

  if (loading) {
    return (
      <div className="admin-page">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <button className="btn-back" onClick={() => navigate('/admin/courses')}>
          <ArrowLeft size={20} />
        </button>
        <div className="admin-header-actions">
          <button 
            className="btn btn-primary"
            onClick={handleSaveCourse}
            disabled={saving}
          >
            {saving ? <div className="loading-spinner-small" /> : <Save size={18} />}
            Сохранить
          </button>
        </div>
      </div>

      <div className="course-editor">
        <div className="course-editor-tabs">
          <button
            className={`tab ${activeTab === 'info' ? 'active' : ''}`}
            onClick={() => setActiveTab('info')}
          >
            <BookOpen size={18} />
            Информация о курсе
          </button>
          <button
            className={`tab ${activeTab === 'lessons' ? 'active' : ''}`}
            onClick={() => setActiveTab('lessons')}
            disabled={isNew}
          >
            <FileText size={18} />
            Уроки ({lessons.length})
          </button>
          <button
            className={`tab ${activeTab === 'test' ? 'active' : ''}`}
            onClick={() => setActiveTab('test')}
            disabled={isNew}
          >
            <HelpCircle size={18} />
            Тест ({questions.length})
          </button>
        </div>

        <div className="course-editor-content">
          {activeTab === 'info' && (
            <div className="editor-section">
              <h2>Основная информация</h2>
              
              <div className="form-group">
                <label className="form-label">Название курса *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Введите название курса"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Описание</label>
                <textarea
                  className="input"
                  rows={4}
                  placeholder="Краткое описание курса"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Примерная длительность (минуты)</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="60"
                    value={form.estimatedDuration}
                    onChange={e => setForm({ ...form, estimatedDuration: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    <input
                      type="checkbox"
                      checked={form.isPublished}
                      onChange={e => setForm({ ...form, isPublished: e.target.checked })}
                      style={{ marginRight: 8 }}
                    />
                    Опубликовать курс
                  </label>
                  <p className="form-help">
                    Опубликованные курсы доступны пользователям с правами доступа
                  </p>
                </div>
              </div>

              <div className="access-control-section">
                <h3>Контроль доступа</h3>
                <p className="form-help" style={{ marginBottom: '12px' }}>
                  Роли и медцентры работают по правилу И. Конкретный пользователь получает доступ независимо от роли/медцентра.
                </p>
                <div className="form-group">
                  <label className="form-label">Кто имеет доступ</label>
                  <AccessPicker
                    roles={availableRoles}
                    roleIds={form.allowedRoleIds}
                    onChangeRoles={(v) => setForm({ ...form, allowedRoleIds: v })}
                    disabledRoles={adminRoleId ? [adminRoleId] : []}
                    medCenters={availableMedCenters}
                    medCenterIds={form.allowedMedCenterIds}
                    onChangeMedCenters={(v) => setForm({ ...form, allowedMedCenterIds: v })}
                    users={availableUsers}
                    userIds={form.allowedUserIds}
                    onChangeUsers={(v) => setForm({ ...form, allowedUserIds: v })}
                  />
                </div>
              </div>

              {isNew && (
                <div className="info-box">
                  <p>После создания курса вы сможете добавить уроки и тестовые вопросы</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'lessons' && (
            <div className="editor-section">
              <div className="section-header">
                <h2>Уроки курса</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {lessons.length > 0 && (
                    <button
                      className="btn btn-outline"
                      onClick={handlePrintAllLessons}
                      title="Распечатать все уроки как один PDF"
                    >
                      <Printer size={18} />
                      Печать всего курса
                    </button>
                  )}
                  <button
                    className="btn btn-primary"
                    onClick={() => setLessonModal({ title: '', content: '' })}
                  >
                    <Plus size={18} />
                    Добавить урок
                  </button>
                </div>
              </div>

              {lessons.length === 0 ? (
                <div className="empty-state">
                  <FileText size={48} style={{ opacity: 0.3 }} />
                  <h3>Нет уроков</h3>
                  <p>Добавьте первый урок для этого курса</p>
                </div>
              ) : (
                <DragDropContext onDragEnd={handleLessonDragEnd}>
                  <Droppable droppableId="lessons">
                    {(provided) => (
                      <div
                        className="lessons-list"
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                      >
                        {lessons.map((lesson, index) => (
                          <Draggable
                            key={lesson.id}
                            draggableId={lesson.id}
                            index={index}
                          >
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={`lesson-card ${snapshot.isDragging ? 'dragging' : ''}`}
                              >
                                <div
                                  className="lesson-drag-handle"
                                  {...provided.dragHandleProps}
                                >
                                  <GripVertical size={20} />
                                </div>
                                <div className="lesson-card-content">
                                  <div className="lesson-number">Урок {index + 1}</div>
                                  <div className="lesson-title">{lesson.title}</div>
                                </div>
                                <div className="lesson-card-actions">
                                  <button
                                    className="btn btn-icon"
                                    onClick={() => setLessonModal(lesson)}
                                  >
                                    <Edit size={18} />
                                  </button>
                                  <button
                                    className="btn btn-icon btn-danger"
                                    onClick={() => handleDeleteLesson(lesson)}
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )}
            </div>
          )}

          {activeTab === 'test' && (
            <div className="editor-section">
              <div className="section-header">
                <h2>Тестовые вопросы</h2>
                <button
                  className="btn btn-primary"
                  onClick={() => setQuestionModal({ 
                    question: '', 
                    options: ['', ''], 
                    correctAnswer: 0 
                  })}
                >
                  <Plus size={18} />
                  Добавить вопрос
                </button>
              </div>

              <div className="info-box">
                <p>Минимальный проходной балл: 80%. Пользователи смогут пересдавать тест неограниченное количество раз.</p>
              </div>

              {questions.length === 0 ? (
                <div className="empty-state">
                  <HelpCircle size={48} style={{ opacity: 0.3 }} />
                  <h3>Нет вопросов</h3>
                  <p>Добавьте тестовые вопросы для проверки знаний</p>
                </div>
              ) : (
                <DragDropContext onDragEnd={handleQuestionDragEnd}>
                  <Droppable droppableId="questions">
                    {(provided) => (
                      <div
                        className="questions-list"
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                      >
                        {questions.map((question, index) => (
                          <Draggable
                            key={question.id}
                            draggableId={question.id}
                            index={index}
                          >
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={`question-card ${snapshot.isDragging ? 'dragging' : ''}`}
                              >
                                <div
                                  className="question-drag-handle"
                                  {...provided.dragHandleProps}
                                >
                                  <GripVertical size={20} />
                                </div>
                                <div className="question-card-content">
                                  <div className="question-number">Вопрос {index + 1}</div>
                                  <div className="question-text">{question.question}</div>
                                  <div className="question-options">
                                    {question.options.map((opt, i) => (
                                      <div 
                                        key={i} 
                                        className={`question-option ${i === question.correctAnswer ? 'correct' : ''}`}
                                      >
                                        {opt}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <div className="question-card-actions">
                                  <button
                                    className="btn btn-icon"
                                    onClick={() => setQuestionModal(question)}
                                  >
                                    <Edit size={18} />
                                  </button>
                                  <button
                                    className="btn btn-icon btn-danger"
                                    onClick={() => handleDeleteQuestion(question)}
                                  >
                                    <Trash2 size={18} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )}
            </div>
          )}
        </div>
      </div>

      {lessonModal && (
        <LessonModal
          lesson={lessonModal}
          onSave={handleSaveLesson}
          onClose={() => setLessonModal(null)}
        />
      )}

      {questionModal && (
        <QuestionModal
          question={questionModal}
          onSave={handleSaveQuestion}
          onClose={() => setQuestionModal(null)}
        />
      )}
    </div>
  );
}

// Модальное окно редактирования урока
function LessonModal({ lesson, onSave, onClose }) {
  const [form, setForm] = useState({
    id: lesson.id || null,
    title: lesson.title || '',
    content: lesson.content || ''
  });

  const handleSubmit = () => {
    if (!form.title.trim()) {
      toast.error('Введите название урока');
      return;
    }

    onSave(form);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{lesson.id ? 'Редактировать урок' : 'Новый урок'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Название урока *</label>
            <input
              type="text"
              className="input"
              placeholder="Введите название урока"
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Содержание урока</label>
            <Editor
              content={form.content}
              onChange={content => setForm({ ...form, content })}
              placeholder="Начните писать содержание урока..."
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={handleSubmit}>
            <Save size={18} />
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// Модальное окно редактирования вопроса
function QuestionModal({ question, onSave, onClose }) {
  const [form, setForm] = useState({
    id: question.id || null,
    question: question.question || '',
    options: question.options || ['', ''],
    correctAnswer: question.correctAnswer || 0
  });

  const addOption = () => {
    if (form.options.length >= 10) {
      toast.error('Максимум 10 вариантов ответа');
      return;
    }
    setForm({ ...form, options: [...form.options, ''] });
  };

  const removeOption = (index) => {
    if (form.options.length <= 2) {
      toast.error('Минимум 2 варианта ответа');
      return;
    }
    const newOptions = form.options.filter((_, i) => i !== index);
    setForm({ 
      ...form, 
      options: newOptions,
      correctAnswer: form.correctAnswer >= newOptions.length ? 0 : form.correctAnswer
    });
  };

  const updateOption = (index, value) => {
    const newOptions = [...form.options];
    newOptions[index] = value;
    setForm({ ...form, options: newOptions });
  };

  const handleSubmit = () => {
    if (!form.question.trim()) {
      toast.error('Введите текст вопроса');
      return;
    }

    if (form.options.some(opt => !opt.trim())) {
      toast.error('Заполните все варианты ответа');
      return;
    }

    onSave(form);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-medium" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{question.id ? 'Редактировать вопрос' : 'Новый вопрос'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Текст вопроса *</label>
            <textarea
              className="input"
              rows={3}
              placeholder="Введите текст вопроса"
              value={form.question}
              onChange={e => setForm({ ...form, question: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Варианты ответа *</label>
            {form.options.map((option, index) => (
              <div key={index} className="option-input-group">
                <label className="option-label">
                  <input
                    type="radio"
                    name="correct"
                    checked={form.correctAnswer === index}
                    onChange={() => setForm({ ...form, correctAnswer: index })}
                  />
                  <span className="option-radio-label">Правильный</span>
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder={`Вариант ${index + 1}`}
                  value={option}
                  onChange={e => updateOption(index, e.target.value)}
                />
                {form.options.length > 2 && (
                  <button
                    className="btn btn-icon btn-danger"
                    onClick={() => removeOption(index)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
            {form.options.length < 10 && (
              <button className="btn btn-outline btn-sm" onClick={addOption}>
                <Plus size={16} />
                Добавить вариант
              </button>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={handleSubmit}>
            <Save size={18} />
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}