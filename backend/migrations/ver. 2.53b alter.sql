-- ver. 2.53b: Add dateFrom column to promotions table
ALTER TABLE "promotions" ADD COLUMN IF NOT EXISTS "dateFrom" DATE;
