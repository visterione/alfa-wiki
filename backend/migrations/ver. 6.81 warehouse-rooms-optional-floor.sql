-- Кабинеты небольших медцентров могут существовать без искусственных корпуса
-- и этажа. Медцентр поэтому хранится напрямую, а этаж становится необязательным.
BEGIN;

ALTER TABLE warehouse_rooms
  ADD COLUMN IF NOT EXISTS "medCenterId" UUID;

UPDATE warehouse_rooms r
   SET "medCenterId" = b."medCenterId"
  FROM warehouse_floors f
  JOIN warehouse_buildings b ON b.id = f."buildingId"
 WHERE r."floorId" = f.id
   AND r."medCenterId" IS NULL;

ALTER TABLE warehouse_rooms
  ALTER COLUMN "medCenterId" SET NOT NULL,
  ALTER COLUMN "floorId" DROP NOT NULL;

ALTER TABLE warehouse_rooms
  DROP CONSTRAINT IF EXISTS "warehouse_rooms_floorId_fkey";
ALTER TABLE warehouse_rooms
  ADD CONSTRAINT "warehouse_rooms_floorId_fkey"
  FOREIGN KEY ("floorId") REFERENCES warehouse_floors(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE warehouse_rooms
  DROP CONSTRAINT IF EXISTS "warehouse_rooms_medCenterId_fkey";
ALTER TABLE warehouse_rooms
  ADD CONSTRAINT "warehouse_rooms_medCenterId_fkey"
  FOREIGN KEY ("medCenterId") REFERENCES med_centers(id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS warehouse_rooms_medcenter_idx
  ON warehouse_rooms ("medCenterId");

COMMIT;
