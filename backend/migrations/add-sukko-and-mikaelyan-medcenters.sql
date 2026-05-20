-- Добавление медцентров "Сукко" и "ИП Микаелян"

ALTER TYPE "enum_med_centers_name" ADD VALUE IF NOT EXISTS 'Сукко';
ALTER TYPE "enum_med_centers_name" ADD VALUE IF NOT EXISTS 'ИП Микаелян';

ALTER TYPE "enum_accreditations_medCenter" ADD VALUE IF NOT EXISTS 'Сукко';
ALTER TYPE "enum_accreditations_medCenter" ADD VALUE IF NOT EXISTS 'ИП Микаелян';

INSERT INTO med_centers (id, name, "displayName", description, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'Сукко',       'МЦ Сукко',    'Медицинский центр Сукко', NOW(), NOW()),
  (gen_random_uuid(), 'ИП Микаелян', 'ИП Микаелян', 'ИП Микаелян',             NOW(), NOW())
ON CONFLICT (name) DO NOTHING;
