-- Добавление контроля доступа к курсам по ролям и медцентрам
-- Правило "И" - пользователь должен иметь И подходящую роль, И подходящий медцентр

-- Создание таблицы связи курсов с ролями
CREATE TABLE IF NOT EXISTS course_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "courseId" UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  "roleId" UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("courseId", "roleId")
);

-- Создание индексов для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_course_roles_course ON course_roles("courseId");
CREATE INDEX IF NOT EXISTS idx_course_roles_role ON course_roles("roleId");

-- Создание таблицы связи курсов с медцентрами
CREATE TABLE IF NOT EXISTS course_medcenters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "courseId" UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  "medCenterId" UUID NOT NULL REFERENCES med_centers(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("courseId", "medCenterId")
);

-- Создание индексов для оптимизации запросов
CREATE INDEX IF NOT EXISTS idx_course_medcenters_course ON course_medcenters("courseId");
CREATE INDEX IF NOT EXISTS idx_course_medcenters_medcenter ON course_medcenters("medCenterId");

-- Комментарии для документации
COMMENT ON TABLE course_roles IS 'Связь курсов с ролями для контроля доступа. Если таблица пустая для курса - доступен всем.';
COMMENT ON TABLE course_medcenters IS 'Связь курсов с медцентрами для контроля доступа. Если таблица пустая для курса - доступен всем.';
COMMENT ON COLUMN course_roles."courseId" IS 'ID курса';
COMMENT ON COLUMN course_roles."roleId" IS 'ID роли, которая имеет доступ к курсу';
COMMENT ON COLUMN course_medcenters."courseId" IS 'ID курса';
COMMENT ON COLUMN course_medcenters."medCenterId" IS 'ID медцентра, пользователи которого имеют доступ к курсу';
