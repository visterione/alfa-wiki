import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  BookOpen, ChevronLeft, ChevronRight, CheckCircle,
  Circle, PlayCircle, ArrowLeft, Award, Lock
} from 'lucide-react';
import { courses } from '../services/api';
import toast from 'react-hot-toast';
import PrintButton from '../components/PrintButton';
import ContentRenderer from '../components/ContentRenderer';
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
    if (course && course.lessons.length > 0 && !currentLesson) {
      // Определяем какой урок показать только если урок еще не загружен
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
    // Проверяем что текущий урок завершен
    if (!isLessonCompleted(currentLesson.id)) {
      toast.error('Пожалуйста, отметьте текущий урок как завершенный');
      return;
    }

    const currentIndex = course.lessons.findIndex(l => l.id === currentLesson.id);

    // Если это последний урок
    if (currentIndex === course.lessons.length - 1) {
      // Если есть вопросы теста - показываем тест
      if (course.testQuestions.length > 0) {
        setShowTest(true);
        return;
      } else {
        // Если вопросов нет - курс просто для ознакомления
        toast.success('Вы завершили просмотр курса!');
        navigate('/courses');
        return;
      }
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

  // Проверка доступности урока: доступен только первый урок или следующий после последнего завершенного
  const isLessonAccessible = (lessonIndex) => {
    // Первый урок всегда доступен
    if (lessonIndex === 0) return true;

    // Проверяем, завершен ли предыдущий урок
    const prevLesson = course.lessons[lessonIndex - 1];
    return isLessonCompleted(prevLesson.id);
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
        <div className="course-view-info">
          <div className="course-view-title-row">
            <button className="btn-back" onClick={() => navigate('/courses')}>
              <ArrowLeft size={20} />
            </button>
            <h1>{course.title}</h1>
          </div>
          <div className="course-view-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${getProgressPercent()}%` }} />
            </div>
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
              const isAccessible = isLessonAccessible(index);

              return (
                <div
                  key={lesson.id}
                  className={`lesson-item ${isCurrent ? 'active' : ''} ${completed ? 'completed' : ''} ${!isAccessible ? 'locked' : ''}`}
                  onClick={() => isAccessible ? loadLesson(lesson.id) : null}
                  style={{ cursor: isAccessible ? 'pointer' : 'not-allowed' }}
                  title={!isAccessible ? 'Завершите предыдущий урок для доступа' : ''}
                >
                  <div className="lesson-item-icon">
                    {!isAccessible ? (
                      <Lock size={18} />
                    ) : completed ? (
                      <CheckCircle size={18} style={{ color: 'var(--primary)' }} />
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2>{currentLesson?.title}</h2>
            </div>
            <PrintButton title={`${course.title} - ${currentLesson?.title}`} />
          </div>

          <div>
            <h2 className="printable-lesson-title">{currentLesson?.title}</h2>
            <div className="lesson-content">
              <ContentRenderer content={lessonContent} />
            </div>
          </div>

          <div className="lesson-navigation">
            <button
              className="btn btn-outline"
              onClick={handlePrevLesson}
              disabled={isFirstLesson}
            >
              Назад
            </button>

            <div className="lesson-navigation-center">
              {!isCurrentCompleted && (
                <button
                  className="btn btn-secondary"
                  onClick={handleCompleteLesson}
                >
                  Завершено
                </button>
              )}
            </div>

            <button
              className="btn btn-primary"
              onClick={handleNextLesson}
              disabled={!isCurrentCompleted}
              title={!isCurrentCompleted ? 'Отметьте текущий урок как завершенный' : ''}
            >
              {isLastLesson ? (
                course.testQuestions.length > 0 ? (
                  <>
                    Перейти к тесту
                    <Award size={18} />
                  </>
                ) : (
                  <>
                    Завершить курс
                    <CheckCircle size={18} />
                  </>
                )
              ) : (
                <>
                  Дальше
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

  // Функция для перемешивания массива (алгоритм Фишера-Йетса)
  const shuffleArray = (array) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const loadTest = async () => {
    try {
      const { data } = await courses.getTest(course.id);

      // Перемешиваем варианты ответов для каждого вопроса
      const questionsWithShuffledOptions = data.map(question => {
        // Создаем массив с индексами и значениями опций
        const indexedOptions = question.options.map((option, index) => ({
          option,
          originalIndex: index
        }));

        // Перемешиваем
        const shuffledIndexedOptions = shuffleArray(indexedOptions);

        return {
          ...question,
          shuffledOptions: shuffledIndexedOptions.map(item => item.option),
          indexMapping: shuffledIndexedOptions.map(item => item.originalIndex)
        };
      });

      setQuestions(questionsWithShuffledOptions);
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
      // Конвертируем перемешанные индексы обратно в оригинальные
      const originalAnswers = {};
      questions.forEach(question => {
        const shuffledIndex = answers[question.id];
        if (shuffledIndex !== undefined) {
          originalAnswers[question.id] = question.indexMapping[shuffledIndex];
        }
      });

      const { data } = await courses.submitTest(course.id, originalAnswers);
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
        <div className="test-header-title-row">
          <button className="btn-back" onClick={onBack}>
            <ArrowLeft size={20} />
          </button>
          <h2>Финальный тест</h2>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting || Object.keys(answers).length < questions.length}
            style={{ marginLeft: 'auto' }}
          >
            {submitting ? (
              <>
                <div className="loading-spinner-small" />
                Отправка...
              </>
            ) : (
              'Завершить'
            )}
          </button>
        </div>
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
              {question.shuffledOptions.map((option, optionIndex) => (
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
    </div>
  );
}