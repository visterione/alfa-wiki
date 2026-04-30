-- ver. 3.49: Add phone, position, bio to Users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS position VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bio TEXT;
