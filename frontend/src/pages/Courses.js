import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Medal } from 'lucide-react';
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
    if (course.userProgress.completedAt) return 'completed';
    if (course.userProgress.completedLessons > 0) return 'in_progress';
    return 'not_started';
  };

  if (loading) {
    return (
      <div className="page-container courses-page">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="page-container courses-page">
      <div className="page-header">
        <div>
          <h1>Курсы и обучение</h1>
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
            const progress = getProgressPercent(course);

            return (
              <div
                key={course.id}
                className="course-card"
                onClick={() => handleCourseClick(course.id)}
              >
                <div className="course-card-header">
                  <h3 className="course-title">{course.title}</h3>
                </div>

                <div className="course-card-body">
                  {course.description && (
                    <p className="course-description">{course.description}</p>
                  )}
                </div>

                {status !== 'not_started' && (
                  <div className="course-card-footer">
                    {course.userProgress.completedLessons > 0 && (
                      <>
                        <div className="course-progress-bar">
                          <div
                            className="course-progress-fill"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="course-progress-value">{progress}%</span>
                      </>
                    )}
                    <Medal
                      size={22}
                      className={`course-medal course-medal--${status}`}
                    />
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