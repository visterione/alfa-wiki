-- Migration: Remove kanban_access settings
-- Description: Удаление настроек kanban_access из таблицы settings, так как теперь доступ управляется через adminAccess.kanban

DELETE FROM settings WHERE key = 'kanban_access';
