/**
 * ver. 6.49 — реестр сессий (user_sessions).
 *
 * Исполняет backend/migrations/ver. 6.49 user-sessions.sql. Скрипт идемпотентен
 * (всё через IF NOT EXISTS), так что повторный запуск безопасен.
 *
 *   node scripts/migrate-user-sessions.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../models');

async function runMigration() {
  try {
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected to database');

    console.log('🔄 Creating user_sessions table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId"         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform         VARCHAR(10) NOT NULL DEFAULT 'web' CHECK (platform IN ('web', 'mobile', 'desktop')),
        "deviceName"     VARCHAR(200),
        ip               VARCHAR(64),
        "userAgent"      VARCHAR(512),
        "lastActivityAt" TIMESTAMPTZ,
        "expiresAt"      TIMESTAMPTZ NOT NULL,
        "revokedAt"      TIMESTAMPTZ,
        "revokedReason"  VARCHAR(20) CHECK ("revokedReason" IN ('logout', 'logout_all', 'admin', 'password_change')),
        "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✅ user_sessions table created');

    console.log('🔄 Creating indexes...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS user_sessions_user_idx        ON user_sessions ("userId");
      CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx ON user_sessions ("userId", "revokedAt");
      CREATE INDEX IF NOT EXISTS user_sessions_expires_idx     ON user_sessions ("expiresAt");
    `);
    console.log('✅ Indexes created');

    // Колонка появилась ещё в add-user-lastseen.sql, но на части окружений её
    // могли не накатить — presence пишет в неё на каждом heartbeat, и без неё
    // сервер начнёт сыпать ошибками в лог.
    console.log('🔄 Ensuring users."lastSeen" exists...');
    await sequelize.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastSeen" TIMESTAMPTZ;
    `);
    console.log('✅ users."lastSeen" ready');

    const [[{ count }]] = await sequelize.query('SELECT COUNT(*)::int AS count FROM user_sessions;');
    console.log(`\nℹ️  Сейчас в реестре сессий: ${count}`);
    console.log('   Пусто — это нормально: строки появятся при следующих входах.');
    console.log('   Уже выданные токены идут без sid и работают до истечения');
    console.log('   (веб — 7 дней, мобилки — 365). См. ALLOW_LEGACY_TOKENS.\n');

    console.log('🎉 Migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
