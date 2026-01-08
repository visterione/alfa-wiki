import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Clock, CheckCircle, PlayCircle, RotateCcw } from 'lucide-react';
import { courses } from '../services/api';
import toast from 'react-hot-toast';
import './Courses.css';

export default function Courses() {
  const navigate = useNavigate();
  const [coursesList, setCoursesList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCourses();
  }, []);

  const loadCourses = async () => {
    try {
      const { data } = await courses.list();
      setCoursesList(data);
    } catch (error) {
      console.error('Load courses error:', error);
      toast.error('Ошибка загрузки курсов');
    } finally {
      setLoading(false);
    }
  };

  const handleCourseClick = (courseId) => {
    navigate(`/courses/${courseId}`);
  };

  const getProgressPercent = (course) => {
    if (!course.lessonsCount) return 0;
    return Math.round((course.userProgress.completedLessons / course.lessonsCount) * 100);
  };

  const getCourseStatus = (course) => {
    if (course.userProgress.completedAt) {
      return { text: 'Завершен', icon: CheckCircle, color: 'success' };
    }
    if (course.userProgress.completedLessons > 0) {
      return { text: 'В процессе', icon: PlayCircle, color: 'info' };
    }
    return { text: 'Не начат', icon: BookOpen, color: 'default' };
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Курсы и обучение</h1>
          <p className="page-description">
            Учебные материалы для сотрудников медицинского центра
          </p>
        </div>
      </div>

      {coursesList.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={48} style={{ opacity: 0.3 }} />
          <h3>Нет доступных курсов</h3>
          <p>Курсы появятся здесь после публикации</p>
        </div>
      ) : (
        <div className="courses-grid">
          {coursesList.map((course) => {
            const status = getCourseStatus(course);
            const StatusIcon = status.icon;
            const progress = getProgressPercent(course);

            return (
              <div
                key={course.id}
                className="course-card"
                onClick={() => handleCourseClick(course.id)}
              >
                <div className="course-card-header">
                  <div className="course-icon">
                    <BookOpen size={24} />
                  </div>
                  <div className={`course-status status-${status.color}`}>
                    <StatusIcon size={14} />
                    {status.text}
                  </div>
                </div>

                <div className="course-card-body">
                  <h3 className="course-title">{course.title}</h3>
                  {course.description && (
                    <p className="course-description">{course.description}</p>
                  )}

                  <div className="course-meta">
                    <div className="course-meta-item">
                      <BookOpen size={14} />
                      <span>{course.lessonsCount} {course.lessonsCount === 1 ? 'урок' : course.lessonsCount < 5 ? 'урока' : 'уроков'}</span>
                    </div>
                    {course.estimatedDuration && (
                      <div className="course-meta-item">
                        <Clock size={14} />
                        <span>~{course.estimatedDuration} мин</span>
                      </div>
                    )}
                  </div>

                  {course.userProgress.completedLessons > 0 && (
                    <div className="course-progress-section">
                      <div className="course-progress-header">
                        <span className="course-progress-label">Прогресс</span>
                        <span className="course-progress-value">{progress}%</span>
                      </div>
                      <div className="course-progress-bar">
                        <div
                          className="course-progress-fill"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {course.userProgress.testScore !== null && (
                    <div className="course-test-result">
                      <span>Результат теста:</span>
                      <strong className={course.userProgress.testScore >= 80 ? 'text-success' : 'text-danger'}>
                        {course.userProgress.testScore}%
                      </strong>
                    </div>
                  )}
                </div>

                <div className="course-card-footer">
                  {course.userProgress.completedAt ? (
                    <div className="course-completed-badge">
                      <CheckCircle size={16} />
                      Пройден {new Date(course.userProgress.completedAt).toLocaleDateString()}
                    </div>
                  ) : course.userProgress.completedLessons > 0 ? (
                    <button className="btn btn-primary btn-sm">
                      Продолжить
                    </button>
                  ) : (
                    <button className="btn btn-outline btn-sm">
                      Начать курс
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}