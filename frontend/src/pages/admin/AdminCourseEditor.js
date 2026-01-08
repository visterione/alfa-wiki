import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Save, ArrowLeft, Plus, Edit, Trash2, GripVertical,
  BookOpen, FileText, HelpCircle, ChevronDown, ChevronUp
} from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { courses } from '../../services/api';
import Editor from '../../components/Editor';
import toast from 'react-hot-toast';
import './AdminCourseEditor.css';

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
    isPublished: false
  });

  const [lessons, setLessons] = useState([]);
  const [questions, setQuestions] = useState([]);

  // Modals
  const [lessonModal, setLessonModal] = useState(null);
  const [questionModal, setQuestionModal] = useState(null);

  useEffect(() => {
    if (!isNew) {
      loadCourse();
    }
  }, [id]);

  const loadCourse = async () => {
    try {
      const { data } = await courses.adminGet(id);
      setForm({
        title: data.title,
        description: data.description || '',
        icon: data.icon || 'book-open',
        estimatedDuration: data.estimatedDuration || '',
        isPublished: data.isPublished
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
          К списку курсов
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
                    Опубликованные курсы доступны всем пользователям
                  </p>
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
                <button
                  className="btn btn-primary"
                  onClick={() => setLessonModal({ title: '', content: '' })}
                >
                  <Plus size={18} />
                  Добавить урок
                </button>
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