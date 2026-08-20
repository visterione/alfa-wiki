import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Plus, FileText } from 'lucide-react';
import { courses } from '../../services/api';
import Editor from '../../components/Editor';
import toast from 'react-hot-toast';
import './AdminLessonEditor.css';

/**
 * Полноэкранный редактор урока.
 *
 * Раньше урок правили в модалке внутри AdminCourseEditor. Модалка ограничивала
 * редактор по высоте, и как только в урок вставляли картинку, содержимое
 * переставало помещаться: прокручивалось всё тело модалки вместе с панелью
 * инструментов, и форматировать текст было нечем. Здесь высоту держит сама
 * страница, прокручивается только полотно редактора, а панель остаётся на месте
 * при любом объёме урока.
 */
export default function AdminLessonEditor() {
  const { courseId, lessonId } = useParams();
  const navigate = useNavigate();
  const isNew = lessonId === 'new';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [courseTitle, setCourseTitle] = useState('');
  const [lessons, setLessons] = useState([]);
  const [form, setForm] = useState({ id: null, title: '', content: '' });
  const [dirty, setDirty] = useState(false);

  // Что было в уроке на момент загрузки или последнего сохранения — по этому
  // снимку и считается «есть несохранённое», иначе первый же onChange от
  // редактора (он приходит и на установке содержимого) помечал бы урок грязным.
  const initialRef = useRef({ title: '', content: '' });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const { data } = await courses.adminGet(courseId);
        if (cancelled) return;

        setCourseTitle(data.title || '');
        setLessons(data.lessons || []);

        const lesson = isNew ? null : (data.lessons || []).find(l => l.id === lessonId);
        if (!isNew && !lesson) {
          toast.error('Урок не найден');
          navigate(`/admin/courses/${courseId}/edit?tab=lessons`, { replace: true });
          return;
        }

        initialRef.current = { title: lesson?.title || '', content: lesson?.content || '' };
        setForm({ id: lesson?.id || null, ...initialRef.current });
        setDirty(false);
      } catch (error) {
        console.error('Load lesson error:', error);
        if (!cancelled) {
          toast.error('Ошибка загрузки урока');
          navigate('/admin/courses');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [courseId, lessonId]);

  // Tiptap регистрирует onUpdate один раз при создании редактора, поэтому
  // содержимое приходит в замыкание первого рендера. Обновляем состояние только
  // функционально — иначе правка текста затирала бы уже введённое название.
  const patchForm = useCallback((patch) => {
    setForm(prev => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    setDirty(
      form.title !== initialRef.current.title || form.content !== initialRef.current.content
    );
  }, [form]);

  // Предупреждаем о несохранённом при закрытии вкладки: уроки длинные, потерять
  // час работы из-за случайного Cmd+W обиднее всего.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const handleSave = useCallback(async () => {
    if (!form.title.trim()) {
      toast.error('Введите название урока');
      return;
    }

    setSaving(true);
    try {
      const payload = { title: form.title, content: form.content };

      if (form.id) {
        await courses.updateLesson(form.id, payload);
        initialRef.current = payload;
        setDirty(false);
        setLessons(prev => prev.map(l => (l.id === form.id ? { ...l, title: form.title } : l)));
        toast.success('Урок сохранён');
      } else {
        const { data } = await courses.createLesson(courseId, payload);
        initialRef.current = payload;
        setDirty(false);
        toast.success('Урок создан');
        // Переходим на адрес созданного урока, чтобы повторное сохранение шло в
        // update, а не плодило копии.
        navigate(`/admin/courses/${courseId}/lessons/${data.id}/edit`, { replace: true });
      }
    } catch (error) {
      console.error('Save lesson error:', error);
      toast.error('Ошибка сохранения урока');
    } finally {
      setSaving(false);
    }
  }, [form, courseId, navigate]);

  // Ctrl/Cmd+S — привычное сохранение: тянуться мышью к кнопке через каждый
  // абзац неудобно.
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'ы')) {
        e.preventDefault();
        if (!saving) handleSave();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleSave, saving]);

  const leaveGuard = () => !dirty || window.confirm('Есть несохранённые изменения. Уйти со страницы?');

  const goBack = () => {
    if (leaveGuard()) navigate(`/admin/courses/${courseId}/edit?tab=lessons`);
  };

  const openLesson = (id) => {
    if (id === form.id) return;
    if (leaveGuard()) navigate(`/admin/courses/${courseId}/lessons/${id}/edit`);
  };

  const createLesson = () => {
    if (isNew) return;
    if (leaveGuard()) navigate(`/admin/courses/${courseId}/lessons/new/edit`);
  };

  if (loading) {
    return (
      <div className="lesson-editor lesson-editor--loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="lesson-editor">
      <div className="lesson-editor-header">
        <button type="button" className="lesson-editor-back" onClick={goBack} title="К списку уроков">
          <ArrowLeft size={20} />
        </button>

        <div className="lesson-editor-titlebox">
          <div className="lesson-editor-course">{courseTitle}</div>
          <input
            type="text"
            className="input lesson-editor-title"
            placeholder="Название урока"
            value={form.title}
            onChange={e => patchForm({ title: e.target.value })}
          />
        </div>

        <div className="lesson-editor-actions">
          <span className={`lesson-editor-status${dirty ? ' dirty' : ''}`}>
            {dirty ? 'Не сохранено' : 'Всё сохранено'}
          </span>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <div className="loading-spinner-small" /> : <Save size={18} />}
            {isNew ? 'Создать' : 'Сохранить'}
          </button>
        </div>
      </div>

      <div className="lesson-editor-body">
        <aside className="lesson-editor-list">
          <div className="lesson-editor-list-header">
            <span>Уроки курса</span>
            <button type="button" className="lesson-editor-add" onClick={createLesson} title="Новый урок">
              <Plus size={16} />
            </button>
          </div>
          <div className="lesson-editor-list-items">
            {lessons.map((lesson, index) => (
              <button
                type="button"
                key={lesson.id}
                className={`lesson-editor-list-item${lesson.id === form.id ? ' active' : ''}`}
                onClick={() => openLesson(lesson.id)}
              >
                <span className="lesson-editor-list-num">{index + 1}</span>
                <span className="lesson-editor-list-title">{lesson.title}</span>
              </button>
            ))}
            {isNew && (
              <div className="lesson-editor-list-item active">
                <span className="lesson-editor-list-num"><FileText size={13} /></span>
                <span className="lesson-editor-list-title">{form.title || 'Новый урок'}</span>
              </div>
            )}
          </div>
        </aside>

        <div className="lesson-editor-main">
          {/* key по уроку: tiptap принимает содержимое только при создании,
              без пересоздания переключение уроков показывало бы прошлый текст. */}
          <Editor
            key={lessonId}
            content={form.content}
            onChange={content => patchForm({ content })}
            placeholder="Начните писать содержание урока..."
          />
        </div>
      </div>
    </div>
  );
}
