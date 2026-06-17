-- ver. 5.25: Add costPrice (себестоимость) to partner_service_cache
ALTER TABLE partner_service_cache
  ADD COLUMN IF NOT EXISTS "costPrice" DECIMAL(10, 2);
