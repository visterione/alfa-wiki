-- Migration: add course_users table for individual user access control
-- Run: psql -U <user> -d <db> -f add-course-user-access.sql

CREATE TABLE IF NOT EXISTS course_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "courseId" UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT course_users_unique UNIQUE ("courseId", "userId")
);

CREATE INDEX IF NOT EXISTS idx_course_users_course ON course_users("courseId");
CREATE INDEX IF NOT EXISTS idx_course_users_user ON course_users("userId");
