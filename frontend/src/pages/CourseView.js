import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  BookOpen, ChevronLeft, ChevronRight, CheckCircle, 
  Circle, PlayCircle, ArrowLeft, Award
} from 'lucide-react';
import { courses } from '../services/api';
import toast from 'react-hot-toast';
import './CourseView.css';

export default function CourseView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState(null);
  const [currentLesson, setCurrentLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lessonContent, setLessonContent] = useState('');
  const [showTest, setShowTest] = useState(false);

  useEffect(() => {
    loadCourse();
  }, [id]);

  useEffect(() => {
    if (course && course.lessons.length > 0) {
      // Определяем какой урок показать
      let lessonToShow = null;
      
      if (course.userProgress.currentLessonId) {
        lessonToShow = course.lessons.find(l => l.id === course.userProgress.currentLessonId);
      }
      
      if (!lessonToShow) {
        lessonToShow = course.lessons[0];
      }

      loadLesson(lessonToShow.id);
    }
  }, [course]);

  const loadCourse = async () => {
    try {
      const { data } = await courses.get(id);
      setCourse(data);
    } catch (error) {
      console.error('Load course error:', error);
      toast.error('Ошибка загрузки курса');
      navigate('/courses');
    } finally {
      setLoading(false);
    }
  };

  const loadLesson = async (lessonId) => {
    try {
      const { data } = await courses.getLesson(id, lessonId);
      setCurrentLesson(data);
      setLessonContent(data.content || '<p>Урок пока не содержит материалов</p>');
      setShowTest(false);
      
      // Обновляем текущий урок в прогрессе
      await courses.setCurrentLesson(id, lessonId);
    } catch (error) {
      console.error('Load lesson error:', error);
      toast.error('Ошибка загрузки урока');
    }
  };

  const handleCompleteLesson = async () => {
    try {
      await courses.completeLesson(id, currentLesson.id);
      
      // Обновляем локальный прогресс
      setCourse(prev => ({
        ...prev,
        userProgress: {
          ...prev.userProgress,
          completedLessons: [...new Set([...prev.userProgress.completedLessons, currentLesson.id])]
        }
      }));

      toast.success('Урок отмечен как завершенный');
    } catch (error) {
      console.error('Complete lesson error:', error);
      toast.error('Ошибка сохранения прогресса');
    }
  };

  const handleNextLesson = async () => {
    const currentIndex = course.lessons.findIndex(l => l.id === currentLesson.id);
    
    // Отмечаем текущий урок как завершенный
    if (!isLessonCompleted(currentLesson.id)) {
      await handleCompleteLesson();
    }

    // Если это последний урок - показываем тест
    if (currentIndex === course.lessons.length - 1) {
      setShowTest(true);
      return;
    }

    // Переходим к следующему уроку
    const nextLesson = course.lessons[currentIndex + 1];
    loadLesson(nextLesson.id);
  };

  const handlePrevLesson = () => {
    const currentIndex = course.lessons.findIndex(l => l.id === currentLesson.id);
    if (currentIndex > 0) {
      const prevLesson = course.lessons[currentIndex - 1];
      loadLesson(prevLesson.id);
    }
  };

  const isLessonCompleted = (lessonId) => {
    return course.userProgress.completedLessons.includes(lessonId);
  };

  const getProgressPercent = () => {
    if (!course || !course.lessons.length) return 0;
    return Math.round((course.userProgress.completedLessons.length / course.lessons.length) * 100);
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!course) {
    return null;
  }

  if (showTest) {
    return <CourseTest course={course} onBack={() => setShowTest(false)} onComplete={loadCourse} />;
  }

  const currentIndex = course.lessons.findIndex(l => l.id === currentLesson?.id);
  const isFirstLesson = currentIndex === 0;
  const isLastLesson = currentIndex === course.lessons.length - 1;
  const isCurrentCompleted = isLessonCompleted(currentLesson?.id);

  return (
    <div className="course-view-container">
      {/* Header с прогрессом */}
      <div className="course-view-header">
        <button className="btn-back" onClick={() => navigate('/courses')}>
          <ArrowLeft size={20} />
          К списку курсов
        </button>
        <div className="course-view-info">
          <h1>{course.title}</h1>
          <div className="course-view-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${getProgressPercent()}%` }} />
            </div>
            <span className="progress-text">
              {course.userProgress.completedLessons.length} из {course.lessons.length} уроков пройдено
            </span>
          </div>
        </div>
      </div>

      <div className="course-view-layout">
        {/* Sidebar с уроками */}
        <div className="course-sidebar">
          <div className="course-sidebar-header">
            <BookOpen size={18} />
            <span>Программа курса</span>
          </div>
          <div className="course-lessons-list">
            {course.lessons.map((lesson, index) => {
              const completed = isLessonCompleted(lesson.id);
              const isCurrent = currentLesson?.id === lesson.id;

              return (
                <div
                  key={lesson.id}
                  className={`lesson-item ${isCurrent ? 'active' : ''} ${completed ? 'completed' : ''}`}
                  onClick={() => loadLesson(lesson.id)}
                >
                  <div className="lesson-item-icon">
                    {completed ? (
                      <CheckCircle size={18} />
                    ) : isCurrent ? (
                      <PlayCircle size={18} />
                    ) : (
                      <Circle size={18} />
                    )}
                  </div>
                  <div className="lesson-item-content">
                    <div className="lesson-item-number">Урок {index + 1}</div>
                    <div className="lesson-item-title">{lesson.title}</div>
                  </div>
                </div>
              );
            })}
            {course.testQuestions.length > 0 && (
              <div
                className={`lesson-item ${showTest ? 'active' : ''}`}
                onClick={() => setShowTest(true)}
              >
                <div className="lesson-item-icon">
                  <Award size={18} />
                </div>
                <div className="lesson-item-content">
                  <div className="lesson-item-number">Финальный тест</div>
                  <div className="lesson-item-title">
                    {course.testQuestions.length} {course.testQuestions.length === 1 ? 'вопрос' : 'вопросов'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Основной контент */}
        <div className="course-content">
          <div className="lesson-header">
            <h2>{currentLesson?.title}</h2>
            {isCurrentCompleted && (
              <div className="lesson-completed-badge">
                <CheckCircle size={16} />
                Завершено
              </div>
            )}
          </div>

          <div 
            className="lesson-content"
            dangerouslySetInnerHTML={{ __html: lessonContent }}
          />

          <div className="lesson-navigation">
            <button
              className="btn btn-outline"
              onClick={handlePrevLesson}
              disabled={isFirstLesson}
            >
              <ChevronLeft size={18} />
              Предыдущий урок
            </button>

            <div className="lesson-navigation-center">
              {!isCurrentCompleted && (
                <button
                  className="btn btn-secondary"
                  onClick={handleCompleteLesson}
                >
                  <CheckCircle size={18} />
                  Отметить как завершенный
                </button>
              )}
            </div>

            <button
              className="btn btn-primary"
              onClick={handleNextLesson}
            >
              {isLastLesson ? (
                <>
                  Перейти к тесту
                  <Award size={18} />
                </>
              ) : (
                <>
                  Следующий урок
                  <ChevronRight size={18} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Компонент теста
function CourseTest({ course, onBack, onComplete }) {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadTest();
  }, []);

  const loadTest = async () => {
    try {
      const { data } = await courses.getTest(course.id);
      setQuestions(data);
    } catch (error) {
      console.error('Load test error:', error);
      toast.error('Ошибка загрузки теста');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    // Проверяем что все вопросы отвечены
    if (Object.keys(answers).length < questions.length) {
      toast.error('Ответьте на все вопросы');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await courses.submitTest(course.id, answers);
      setResult(data);
      
      if (data.passed) {
        toast.success('Поздравляем! Вы успешно прошли тест!');
      } else {
        toast.error('Тест не пройден. Попробуйте еще раз.');
      }
      
      onComplete();
    } catch (error) {
      console.error('Submit test error:', error);
      toast.error('Ошибка отправки теста');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async () => {
    try {
      await courses.resetProgress(course.id);
      window.location.reload();
    } catch (error) {
      console.error('Reset error:', error);
      toast.error('Ошибка сброса прогресса');
    }
  };

  if (loading) {
    return (
      <div className="course-test-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (result) {
    return (
      <div className="course-test-container">
        <div className="test-result-card">
          <div className={`test-result-icon ${result.passed ? 'success' : 'failure'}`}>
            {result.passed ? <CheckCircle size={64} /> : <Award size={64} />}
          </div>
          
          <h2>{result.passed ? 'Тест пройден!' : 'Тест не пройден'}</h2>
          
          <div className="test-result-score">
            <div className="test-result-score-value">{result.score}%</div>
            <div className="test-result-score-label">
              {result.correctCount} из {result.totalQuestions} правильных ответов
            </div>
          </div>

          {result.passed ? (
            <p className="test-result-message">
              Поздравляем! Вы успешно завершили курс "{course.title}".
              Минимальный проходной балл: 80%
            </p>
          ) : (
            <p className="test-result-message">
              К сожалению, вы не набрали минимальный проходной балл (80%).
              Пройдите курс заново и попробуйте еще раз.
            </p>
          )}

          <div className="test-result-details">
            <h3>Результаты по вопросам:</h3>
            {questions.map((q, index) => {
              const res = result.results[q.id];
              return (
                <div key={q.id} className={`question-result ${res.correct ? 'correct' : 'incorrect'}`}>
                  <div className="question-result-header">
                    {res.correct ? <CheckCircle size={18} /> : <Circle size={18} />}
                    <span>Вопрос {index + 1}</span>
                  </div>
                  <div className="question-result-text">{q.question}</div>
                  {!res.correct && (
                    <div className="question-result-answer">
                      Ваш ответ: {q.options[res.userAnswer]}<br/>
                      Правильный ответ: {q.options[res.correctAnswer]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="test-result-actions">
            {result.passed ? (
              <button className="btn btn-primary" onClick={onBack}>
                Вернуться к курсу
              </button>
            ) : (
              <>
                <button className="btn btn-outline" onClick={onBack}>
                  Вернуться к урокам
                </button>
                <button className="btn btn-primary" onClick={handleRetry}>
                  Пройти курс заново
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="course-test-container">
      <div className="test-header">
        <button className="btn-back" onClick={onBack}>
          <ArrowLeft size={20} />
          Вернуться к урокам
        </button>
        <h2>Финальный тест</h2>
        <p>Ответьте на все вопросы. Минимальный проходной балл: 80%</p>
      </div>

      <div className="test-questions">
        {questions.map((question, index) => (
          <div key={question.id} className="test-question">
            <div className="test-question-header">
              <span className="test-question-number">Вопрос {index + 1}</span>
              <span className="test-question-required">*</span>
            </div>
            <div className="test-question-text">{question.question}</div>
            <div className="test-question-options">
              {question.options.map((option, optionIndex) => (
                <label key={optionIndex} className="test-option">
                  <input
                    type="radio"
                    name={`question-${question.id}`}
                    checked={answers[question.id] === optionIndex}
                    onChange={() => setAnswers(prev => ({ ...prev, [question.id]: optionIndex }))}
                  />
                  <span className="test-option-text">{option}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="test-footer">
        <button
          className="btn btn-primary btn-lg"
          onClick={handleSubmit}
          disabled={submitting || Object.keys(answers).length < questions.length}
        >
          {submitting ? (
            <>
              <div className="loading-spinner-small" />
              Отправка...
            </>
          ) : (
            'Завершить тест'
          )}
        </button>
      </div>
    </div>
  );
}