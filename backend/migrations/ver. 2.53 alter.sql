-- ver. 2.53: Add promotions table and canManagePromotions permission
CREATE TABLE IF NOT EXISTS "promotions" (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  "medCenter" VARCHAR(50) NOT NULL,
  "dateFrom" DATE,
  deadline DATE,
  "createdBy" UUID,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_med_center ON "promotions"("medCenter");
CREATE INDEX IF NOT EXISTS idx_promotions_deadline ON "promotions"(deadline);

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "canManagePromotions" BOOLEAN NOT NULL DEFAULT FALSE;
