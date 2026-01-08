const express = require('express');
const { body, validationResult } = require('express-validator');
const { Course, Lesson, TestQuestion, CourseProgress, User } = require('../models');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// USER ROUTES - Просмотр и прохождение курсов
// ═══════════════════════════════════════════════════════════════

// Получить список всех опубликованных курсов
router.get('/', authenticate, async (req, res) => {
  try {
    const courses = await Course.findAll({
      where: { isPublished: true },
      include: [
        { 
          model: User, 
          as: 'creator', 
          attributes: ['id', 'username', 'displayName'] 
        },
        {
          model: Lesson,
          as: 'lessons',
          attributes: ['id'],
          separate: true
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Добавляем информацию о прогрессе для текущего пользователя
    const coursesWithProgress = await Promise.all(
      courses.map(async (course) => {
        const progress = await CourseProgress.findOne({
          where: { 
            userId: req.user.id, 
            courseId: course.id 
          }
        });

        const courseData = course.toJSON();
        courseData.lessonsCount = courseData.lessons.length;
        delete courseData.lessons;

        if (progress) {
          courseData.userProgress = {
            completedLessons: progress.completedLessons.length,
            currentLessonId: progress.currentLessonId,
            testScore: progress.testScore,
            completedAt: progress.completedAt,
            isCompleted: !!progress.completedAt
          };
        } else {
          courseData.userProgress = {
            completedLessons: 0,
            currentLessonId: null,
            testScore: null,
            completedAt: null,
            isCompleted: false
          };
        }

        return courseData;
      })
    );

    res.json(coursesWithProgress);
  } catch (error) {
    console.error('Get courses error:', error);
    res.status(500).json({ error: 'Failed to get courses' });
  }
});

// Получить информацию о курсе с уроками
router.get('/:id', authenticate, async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id, {
      include: [
        { 
          model: User, 
          as: 'creator', 
          attributes: ['id', 'username', 'displayName'] 
        },
        {
          model: Lesson,
          as: 'lessons',
          attributes: ['id', 'title', 'sortOrder'],
          separate: true,
          order: [['sortOrder', 'ASC']]
        },
        {
          model: TestQuestion,
          as: 'testQuestions',
          attributes: ['id', 'question', 'options', 'sortOrder'],
          separate: true,
          order: [['sortOrder', 'ASC']]
        }
      ]
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (!course.isPublished && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Course not published' });
    }

    // Получаем прогресс пользователя
    const progress = await CourseProgress.findOne({
      where: { 
        userId: req.user.id, 
        courseId: course.id 
      }
    });

    const courseData = course.toJSON();
    
    if (progress) {
      courseData.userProgress = {
        completedLessons: progress.completedLessons,
        currentLessonId: progress.currentLessonId,
        testScore: progress.testScore,
        testAttempts: progress.testAttempts,
        completedAt: progress.completedAt
      };
    } else {
      courseData.userProgress = {
        completedLessons: [],
        currentLessonId: null,
        testScore: null,
        testAttempts: 0,
        completedAt: null
      };
    }

    res.json(courseData);
  } catch (error) {
    console.error('Get course error:', error);
    res.status(500).json({ error: 'Failed to get course' });
  }
});

// Получить урок
router.get('/:courseId/lessons/:lessonId', authenticate, async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;

    const course = await Course.findByPk(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (!course.isPublished && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Course not published' });
    }

    const lesson = await Lesson.findOne({
      where: { id: lessonId, courseId }
    });

    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    res.json(lesson);
  } catch (error) {
    console.error('Get lesson error:', error);
    res.status(500).json({ error: 'Failed to get lesson' });
  }
});

// Отметить урок как завершенный
router.post('/:courseId/lessons/:lessonId/complete', authenticate, async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;

    // Проверяем существование курса и урока
    const course = await Course.findByPk(courseId);
    if (!course || !course.isPublished) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const lesson = await Lesson.findOne({
      where: { id: lessonId, courseId }
    });
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Найти или создать прогресс
    let progress = await CourseProgress.findOne({
      where: { userId: req.user.id, courseId }
    });

    if (!progress) {
      progress = await CourseProgress.create({
        userId: req.user.id,
        courseId,
        completedLessons: [],
        currentLessonId: lessonId
      });
    }

    // Добавляем урок в завершенные, если его там еще нет
    if (!progress.completedLessons.includes(lessonId)) {
      const updated = await CourseProgress.findByPk(progress.id);
      const completedLessons = [...updated.completedLessons, lessonId];
      await updated.update({ 
        completedLessons,
        currentLessonId: lessonId 
      });
      progress = updated;
    }

    res.json({ 
      success: true, 
      completedLessons: progress.completedLessons 
    });
  } catch (error) {
    console.error('Complete lesson error:', error);
    res.status(500).json({ error: 'Failed to complete lesson' });
  }
});

// Обновить текущий урок
router.post('/:courseId/current-lesson', authenticate, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { lessonId } = req.body;

    let progress = await CourseProgress.findOne({
      where: { userId: req.user.id, courseId }
    });

    if (!progress) {
      progress = await CourseProgress.create({
        userId: req.user.id,
        courseId,
        completedLessons: [],
        currentLessonId: lessonId
      });
    } else {
      await progress.update({ currentLessonId: lessonId });
    }

    res.json({ success: true, currentLessonId: lessonId });
  } catch (error) {
    console.error('Update current lesson error:', error);
    res.status(500).json({ error: 'Failed to update current lesson' });
  }
});

// Получить вопросы теста
router.get('/:courseId/test', authenticate, async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await Course.findByPk(courseId);
    if (!course || !course.isPublished) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const questions = await TestQuestion.findAll({
      where: { courseId },
      attributes: ['id', 'question', 'options', 'sortOrder'],
      order: [['sortOrder', 'ASC']]
    });

    res.json(questions);
  } catch (error) {
    console.error('Get test error:', error);
    res.status(500).json({ error: 'Failed to get test' });
  }
});

// Отправить ответы на тест
router.post('/:courseId/test/submit', authenticate, async (req, res) => {
  try {
    const { courseId } = req.params;
    const { answers } = req.body; // { questionId: selectedOptionIndex, ... }

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Invalid answers format' });
    }

    const course = await Course.findByPk(courseId);
    if (!course || !course.isPublished) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Получаем все вопросы с правильными ответами
    const questions = await TestQuestion.findAll({
      where: { courseId },
      attributes: ['id', 'correctAnswer']
    });

    // Проверяем ответы
    let correctCount = 0;
    const results = {};

    questions.forEach(q => {
      const userAnswer = answers[q.id];
      const isCorrect = userAnswer === q.correctAnswer;
      if (isCorrect) correctCount++;
      
      results[q.id] = {
        correct: isCorrect,
        userAnswer,
        correctAnswer: q.correctAnswer
      };
    });

    const score = Math.round((correctCount / questions.length) * 100);
    const passed = score >= 80;

    // Обновляем прогресс
    let progress = await CourseProgress.findOne({
      where: { userId: req.user.id, courseId }
    });

    if (!progress) {
      progress = await CourseProgress.create({
        userId: req.user.id,
        courseId,
        completedLessons: [],
        testScore: score,
        testAttempts: 1,
        completedAt: passed ? new Date() : null
      });
    } else {
      await progress.update({
        testScore: score,
        testAttempts: progress.testAttempts + 1,
        completedAt: passed ? (progress.completedAt || new Date()) : progress.completedAt
      });
    }

    res.json({
      score,
      passed,
      correctCount,
      totalQuestions: questions.length,
      results
    });
  } catch (error) {
    console.error('Submit test error:', error);
    res.status(500).json({ error: 'Failed to submit test' });
  }
});

// Сбросить прогресс курса
router.post('/:courseId/reset', authenticate, async (req, res) => {
  try {
    const { courseId } = req.params;

    const progress = await CourseProgress.findOne({
      where: { userId: req.user.id, courseId }
    });

    if (progress) {
      await progress.update({
        completedLessons: [],
        currentLessonId: null,
        testScore: null,
        testAttempts: 0,
        completedAt: null
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Reset course error:', error);
    res.status(500).json({ error: 'Failed to reset course' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES - Управление курсами
// ═══════════════════════════════════════════════════════════════

// Получить все курсы (включая неопубликованные) для админа
router.get('/admin/all', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const courses = await Course.findAll({
      include: [
        { 
          model: User, 
          as: 'creator', 
          attributes: ['id', 'username', 'displayName'] 
        },
        {
          model: Lesson,
          as: 'lessons',
          attributes: ['id'],
          separate: true
        },
        {
          model: TestQuestion,
          as: 'testQuestions',
          attributes: ['id'],
          separate: true
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    const coursesWithStats = courses.map(course => {
      const data = course.toJSON();
      data.lessonsCount = data.lessons.length;
      data.questionsCount = data.testQuestions.length;
      delete data.lessons;
      delete data.testQuestions;
      return data;
    });

    res.json(coursesWithStats);
  } catch (error) {
    console.error('Get all courses error:', error);
    res.status(500).json({ error: 'Failed to get courses' });
  }
});

// Создать курс
router.post('/admin', authenticate, requirePermission('pages', 'admin'), [
  body('title').notEmpty().withMessage('Title is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, description, icon, estimatedDuration, isPublished } = req.body;

    const course = await Course.create({
      title,
      description,
      icon: icon || 'book-open',
      estimatedDuration,
      isPublished: isPublished || false,
      createdBy: req.user.id
    });

    res.status(201).json(course);
  } catch (error) {
    console.error('Create course error:', error);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

// Обновить курс
router.put('/admin/:id', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const { title, description, icon, estimatedDuration, isPublished } = req.body;

    await course.update({
      title: title !== undefined ? title : course.title,
      description: description !== undefined ? description : course.description,
      icon: icon !== undefined ? icon : course.icon,
      estimatedDuration: estimatedDuration !== undefined ? estimatedDuration : course.estimatedDuration,
      isPublished: isPublished !== undefined ? isPublished : course.isPublished
    });

    res.json(course);
  } catch (error) {
    console.error('Update course error:', error);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

// Удалить курс
router.delete('/admin/:id', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    await course.destroy();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete course error:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// Получить курс для редактирования (со всеми данными)
router.get('/admin/:id/edit', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const course = await Course.findByPk(req.params.id, {
      include: [
        { 
          model: User, 
          as: 'creator', 
          attributes: ['id', 'username', 'displayName'] 
        },
        {
          model: Lesson,
          as: 'lessons',
          separate: true,
          order: [['sortOrder', 'ASC']]
        },
        {
          model: TestQuestion,
          as: 'testQuestions',
          separate: true,
          order: [['sortOrder', 'ASC']]
        }
      ]
    });

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json(course);
  } catch (error) {
    console.error('Get course for edit error:', error);
    res.status(500).json({ error: 'Failed to get course' });
  }
});

// Создать урок
router.post('/admin/:courseId/lessons', authenticate, requirePermission('pages', 'admin'), [
  body('title').notEmpty().withMessage('Title is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { courseId } = req.params;
    const { title, content, sortOrder } = req.body;

    const course = await Course.findByPk(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Если sortOrder не указан, ставим в конец
    let order = sortOrder;
    if (order === undefined) {
      const maxLesson = await Lesson.findOne({
        where: { courseId },
        order: [['sortOrder', 'DESC']]
      });
      order = maxLesson ? maxLesson.sortOrder + 1 : 0;
    }

    const lesson = await Lesson.create({
      courseId,
      title,
      content: content || '',
      sortOrder: order
    });

    res.status(201).json(lesson);
  } catch (error) {
    console.error('Create lesson error:', error);
    res.status(500).json({ error: 'Failed to create lesson' });
  }
});

// Обновить урок
router.put('/admin/lessons/:id', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const lesson = await Lesson.findByPk(req.params.id);
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    const { title, content, sortOrder } = req.body;

    await lesson.update({
      title: title !== undefined ? title : lesson.title,
      content: content !== undefined ? content : lesson.content,
      sortOrder: sortOrder !== undefined ? sortOrder : lesson.sortOrder
    });

    res.json(lesson);
  } catch (error) {
    console.error('Update lesson error:', error);
    res.status(500).json({ error: 'Failed to update lesson' });
  }
});

// Удалить урок
router.delete('/admin/lessons/:id', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const lesson = await Lesson.findByPk(req.params.id);
    if (!lesson) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    await lesson.destroy();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete lesson error:', error);
    res.status(500).json({ error: 'Failed to delete lesson' });
  }
});

// Переупорядочить уроки
router.post('/admin/:courseId/lessons/reorder', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { lessonIds } = req.body; // Массив ID в новом порядке

    if (!Array.isArray(lessonIds)) {
      return res.status(400).json({ error: 'Invalid lesson IDs format' });
    }

    // Обновляем sortOrder для каждого урока
    for (let i = 0; i < lessonIds.length; i++) {
      await Lesson.update(
        { sortOrder: i },
        { where: { id: lessonIds[i], courseId } }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Reorder lessons error:', error);
    res.status(500).json({ error: 'Failed to reorder lessons' });
  }
});

// Создать вопрос теста
router.post('/admin/:courseId/questions', authenticate, requirePermission('pages', 'admin'), [
  body('question').notEmpty().withMessage('Question is required'),
  body('options').isArray({ min: 2 }).withMessage('At least 2 options required'),
  body('correctAnswer').isInt({ min: 0 }).withMessage('Valid correct answer required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { courseId } = req.params;
    const { question, options, correctAnswer, sortOrder } = req.body;

    const course = await Course.findByPk(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (correctAnswer >= options.length) {
      return res.status(400).json({ error: 'Invalid correct answer index' });
    }

    // Если sortOrder не указан, ставим в конец
    let order = sortOrder;
    if (order === undefined) {
      const maxQuestion = await TestQuestion.findOne({
        where: { courseId },
        order: [['sortOrder', 'DESC']]
      });
      order = maxQuestion ? maxQuestion.sortOrder + 1 : 0;
    }

    const testQuestion = await TestQuestion.create({
      courseId,
      question,
      options,
      correctAnswer,
      sortOrder: order
    });

    res.status(201).json(testQuestion);
  } catch (error) {
    console.error('Create question error:', error);
    res.status(500).json({ error: 'Failed to create question' });
  }
});

// Обновить вопрос теста
router.put('/admin/questions/:id', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const testQuestion = await TestQuestion.findByPk(req.params.id);
    if (!testQuestion) {
      return res.status(404).json({ error: 'Question not found' });
    }

    const { question, options, correctAnswer, sortOrder } = req.body;

    if (correctAnswer !== undefined && options && correctAnswer >= options.length) {
      return res.status(400).json({ error: 'Invalid correct answer index' });
    }

    await testQuestion.update({
      question: question !== undefined ? question : testQuestion.question,
      options: options !== undefined ? options : testQuestion.options,
      correctAnswer: correctAnswer !== undefined ? correctAnswer : testQuestion.correctAnswer,
      sortOrder: sortOrder !== undefined ? sortOrder : testQuestion.sortOrder
    });

    res.json(testQuestion);
  } catch (error) {
    console.error('Update question error:', error);
    res.status(500).json({ error: 'Failed to update question' });
  }
});

// Удалить вопрос теста
router.delete('/admin/questions/:id', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const testQuestion = await TestQuestion.findByPk(req.params.id);
    if (!testQuestion) {
      return res.status(404).json({ error: 'Question not found' });
    }

    await testQuestion.destroy();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete question error:', error);
    res.status(500).json({ error: 'Failed to delete question' });
  }
});

// Переупорядочить вопросы
router.post('/admin/:courseId/questions/reorder', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { questionIds } = req.body;

    if (!Array.isArray(questionIds)) {
      return res.status(400).json({ error: 'Invalid question IDs format' });
    }

    for (let i = 0; i < questionIds.length; i++) {
      await TestQuestion.update(
        { sortOrder: i },
        { where: { id: questionIds[i], courseId } }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Reorder questions error:', error);
    res.status(500).json({ error: 'Failed to reorder questions' });
  }
});

// Получить статистику по курсу
router.get('/admin/:courseId/stats', authenticate, requirePermission('pages', 'admin'), async (req, res) => {
  try {
    const { courseId } = req.params;

    const course = await Course.findByPk(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Получаем всех пользователей с прогрессом по этому курсу
    const progressRecords = await CourseProgress.findAll({
      where: { courseId },
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id', 'username', 'displayName', 'avatar'] 
        }
      ],
      order: [['completedAt', 'DESC NULLS LAST']]
    });

    // Получаем общее количество уроков
    const lessonsCount = await Lesson.count({ where: { courseId } });

    const stats = progressRecords.map(progress => ({
      user: progress.user,
      completedLessons: progress.completedLessons.length,
      totalLessons: lessonsCount,
      progressPercent: lessonsCount > 0 
        ? Math.round((progress.completedLessons.length / lessonsCount) * 100)
        : 0,
      testScore: progress.testScore,
      testAttempts: progress.testAttempts,
      completedAt: progress.completedAt,
      isCompleted: !!progress.completedAt,
      startedAt: progress.createdAt
    }));

    res.json(stats);
  } catch (error) {
    console.error('Get course stats error:', error);
    res.status(500).json({ error: 'Failed to get course stats' });
  }
});

module.exports = router;