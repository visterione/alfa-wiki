/**
 * Прямая миграция для создания таблиц курсов
 * Удаляет существующие таблицы и создает заново
 * 
 * Запуск: node scripts/migrateCoursesDirect.js
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Dropping existing tables...');
    await sequelize.query('DROP TABLE IF EXISTS course_progress CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS test_questions CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS lessons CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS courses CASCADE;');
    console.log('✅ Tables dropped');

    console.log('🔄 Creating courses table...');
    await sequelize.query(`
      CREATE TABLE courses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        icon VARCHAR(50) DEFAULT 'book-open',
        "estimatedDuration" INTEGER,
        "createdBy" UUID REFERENCES users(id) ON DELETE SET NULL,
        "isPublished" BOOLEAN DEFAULT FALSE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Courses table created');

    console.log('🔄 Creating lessons table...');
    await sequelize.query(`
      CREATE TABLE lessons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "courseId" UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        "sortOrder" INTEGER DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Lessons table created');

    console.log('🔄 Creating test_questions table...');
    await sequelize.query(`
      CREATE TABLE test_questions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "courseId" UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        options JSONB NOT NULL,
        "correctAnswer" INTEGER NOT NULL,
        "sortOrder" INTEGER DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ Test questions table created');

    console.log('🔄 Creating course_progress table...');
    await sequelize.query(`
      CREATE TABLE course_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "courseId" UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        "completedLessons" JSONB DEFAULT '[]'::jsonb,
        "currentLessonId" UUID REFERENCES lessons(id) ON DELETE SET NULL,
        "testScore" INTEGER,
        "testAttempts" INTEGER DEFAULT 0,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE("userId", "courseId")
      );
    `);
    console.log('✅ Course progress table created');

    console.log('🔄 Creating indexes...');
    await sequelize.query('CREATE INDEX idx_courses_title ON courses(title);');
    await sequelize.query('CREATE INDEX idx_courses_published ON courses("isPublished");');
    await sequelize.query('CREATE INDEX idx_lessons_course ON lessons("courseId");');
    await sequelize.query('CREATE INDEX idx_lessons_sort ON lessons("sortOrder");');
    await sequelize.query('CREATE INDEX idx_questions_course ON test_questions("courseId");');
    await sequelize.query('CREATE INDEX idx_questions_sort ON test_questions("sortOrder");');
    await sequelize.query('CREATE INDEX idx_progress_completed ON course_progress("completedAt");');
    console.log('✅ Indexes created');

    console.log('\n🎉 Migration completed successfully!\n');
    console.log('═══════════════════════════════════════════════════');
    console.log('  Таблицы созданы:');
    console.log('  - courses');
    console.log('  - lessons');
    console.log('  - test_questions');
    console.log('  - course_progress');
    console.log('');
    console.log('  Следующие шаги:');
    console.log('  1. Зарегистрируйте роут в server.js:');
    console.log('     const coursesRoutes = require("./routes/courses");');
    console.log('     app.use("/api/courses", coursesRoutes);');
    console.log('  2. Перезапустите сервер');
    console.log('═══════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();