import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BookOpen, Plus, Edit, Trash2, Eye, EyeOff, 
  Users, BarChart3, ChevronDown, ChevronUp 
} from 'lucide-react';
import { courses } from '../../services/api';
import toast from 'react-hot-toast';
import './AdminCourses.css';

export default function AdminCourses() {
  const navigate = useNavigate();
  const [coursesList, setCoursesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedStats, setExpandedStats] = useState({});
  const [statsData, setStatsData] = useState({});
  const [loadingStats, setLoadingStats] = useState({});

  useEffect(() => {
    loadCourses();
  }, []);

  const loadCourses = async () => {
    try {
      const { data } = await courses.adminList();
      setCoursesList(data);
    } catch (error) {
      console.error('Load courses error:', error);
      toast.error('Ошибка загрузки курсов');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    navigate('/admin/courses/new/edit');
  };

  const handleEdit = (courseId) => {
    navigate(`/admin/courses/${courseId}/edit`);
  };

  const handleDelete = async (course) => {
    if (!window.confirm(`Удалить курс "${course.title}"?`)) {
      return;
    }

    try {
      await courses.delete(course.id);
      toast.success('Курс удален');
      loadCourses();
    } catch (error) {
      console.error('Delete course error:', error);
      toast.error('Ошибка удаления курса');
    }
  };

  const toggleStats = async (courseId) => {
    const isExpanded = expandedStats[courseId];
    
    setExpandedStats(prev => ({
      ...prev,
      [courseId]: !isExpanded
    }));

    // Загружаем статистику если еще не загружена
    if (!isExpanded && !statsData[courseId]) {
      setLoadingStats(prev => ({ ...prev, [courseId]: true }));
      try {
        const { data } = await courses.getStats(courseId);
        setStatsData(prev => ({ ...prev, [courseId]: data }));
      } catch (error) {
        console.error('Load stats error:', error);
        toast.error('Ошибка загрузки статистики');
      } finally {
        setLoadingStats(prev => ({ ...prev, [courseId]: false }));
      }
    }
  };

  const togglePublish = async (course) => {
    try {
      await courses.update(course.id, { isPublished: !course.isPublished });
      toast.success(course.isPublished ? 'Курс снят с публикации' : 'Курс опубликован');
      loadCourses();
    } catch (error) {
      console.error('Toggle publish error:', error);
      toast.error('Ошибка изменения статуса');
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
        <div>
          <h1>Курсы и обучение</h1>
          <p className="admin-description">Управление учебными курсами и статистика прохождения</p>
        </div>
        <button className="btn btn-primary" onClick={handleCreate}>
          <Plus size={18} />
          Создать курс
        </button>
      </div>

      {coursesList.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={48} style={{ opacity: 0.3 }} />
          <h3>Нет курсов</h3>
          <p>Создайте первый курс для обучения сотрудников</p>
          <button className="btn btn-primary" onClick={handleCreate}>
            <Plus size={18} />
            Создать курс
          </button>
        </div>
      ) : (
        <div className="admin-courses-list">
          {coursesList.map(course => {
            const isExpanded = expandedStats[course.id];
            const stats = statsData[course.id] || [];
            const isLoadingStats = loadingStats[course.id];

            return (
              <div key={course.id} className="admin-course-card">
                <div className="admin-course-header">
                  <div className="admin-course-info">
                    <div className="admin-course-title-row">
                      <h3>{course.title}</h3>
                      {course.isPublished ? (
                        <span className="badge badge-success">Опубликован</span>
                      ) : (
                        <span className="badge badge-secondary">Черновик</span>
                      )}
                    </div>
                    {course.description && (
                      <p className="admin-course-description">{course.description}</p>
                    )}
                    <div className="admin-course-meta">
                      <span>{course.lessonsCount} {course.lessonsCount === 1 ? 'урок' : 'уроков'}</span>
                      <span>•</span>
                      <span>{course.questionsCount} {course.questionsCount === 1 ? 'вопрос' : 'вопросов'}</span>
                      {course.estimatedDuration && (
                        <>
                          <span>•</span>
                          <span>~{course.estimatedDuration} мин</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="admin-course-actions">
                    <button
                      className="btn btn-icon"
                      onClick={() => togglePublish(course)}
                      title={course.isPublished ? 'Снять с публикации' : 'Опубликовать'}
                    >
                      {course.isPublished ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                    <button
                      className="btn btn-icon"
                      onClick={() => handleEdit(course.id)}
                      title="Редактировать"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      className="btn btn-icon btn-danger"
                      onClick={() => handleDelete(course)}
                      title="Удалить"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <div className="admin-course-stats-toggle">
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => toggleStats(course.id)}
                  >
                    <BarChart3 size={16} />
                    Статистика прохождения
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                {isExpanded && (
                  <div className="admin-course-stats">
                    {isLoadingStats ? (
                      <div className="loading-spinner-small" />
                    ) : stats.length === 0 ? (
                      <div className="stats-empty">
                        <Users size={24} style={{ opacity: 0.3 }} />
                        <p>Пока никто не начал этот курс</p>
                      </div>
                    ) : (
                      <div className="stats-table-wrapper">
                        <table className="stats-table">
                          <thead>
                            <tr>
                              <th>Пользователь</th>
                              <th>Прогресс</th>
                              <th>Результат теста</th>
                              <th>Попыток</th>
                              <th>Статус</th>
                              <th>Дата</th>
                            </tr>
                          </thead>
                          <tbody>
                            {stats.map(stat => (
                              <tr key={stat.user.id}>
                                <td>
                                  <div className="stats-user">
                                    {stat.user.avatar && (
                                      <img src={stat.user.avatar} alt="" className="stats-avatar" />
                                    )}
                                    <div>
                                      <div className="stats-user-name">
                                        {stat.user.displayName || stat.user.username}
                                      </div>
                                      <div className="stats-user-username">{stat.user.username}</div>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <div className="stats-progress">
                                    <div className="stats-progress-bar">
                                      <div 
                                        className="stats-progress-fill"
                                        style={{ width: `${stat.progressPercent}%` }}
                                      />
                                    </div>
                                    <span className="stats-progress-text">
                                      {stat.completedLessons}/{stat.totalLessons}
                                    </span>
                                  </div>
                                </td>
                                <td>
                                  {stat.testScore !== null ? (
                                    <span className={`stats-score ${stat.testScore >= 80 ? 'success' : 'danger'}`}>
                                      {stat.testScore}%
                                    </span>
                                  ) : (
                                    <span className="text-muted">—</span>
                                  )}
                                </td>
                                <td>
                                  {stat.testAttempts > 0 ? stat.testAttempts : '—'}
                                </td>
                                <td>
                                  {stat.isCompleted ? (
                                    <span className="badge badge-success">Завершен</span>
                                  ) : stat.completedLessons > 0 ? (
                                    <span className="badge badge-info">В процессе</span>
                                  ) : (
                                    <span className="badge badge-secondary">Начат</span>
                                  )}
                                </td>
                                <td className="text-muted">
                                  {stat.completedAt 
                                    ? new Date(stat.completedAt).toLocaleDateString()
                                    : new Date(stat.startedAt).toLocaleDateString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}