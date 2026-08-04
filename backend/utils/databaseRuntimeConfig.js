'use strict';

function envInteger(env, name, fallback, min, max) {
  const parsed = Number.parseInt(env[name], 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function buildDatabaseRuntimeConfig(env = process.env) {
  const max = envInteger(env, 'DB_POOL_MAX', 10, 1, 200);
  const min = Math.min(envInteger(env, 'DB_POOL_MIN', 0, 0, 200), max);
  const statementTimeout = envInteger(env, 'DB_STATEMENT_TIMEOUT_MS', 0, 0, 600_000);

  return {
    pool: {
      max,
      min,
      acquire: envInteger(env, 'DB_POOL_ACQUIRE_MS', 30_000, 1_000, 300_000),
      idle: envInteger(env, 'DB_POOL_IDLE_MS', 10_000, 1_000, 300_000),
      evict: envInteger(env, 'DB_POOL_EVICT_MS', 1_000, 100, 60_000),
    },
    dialectOptions: {
      timezone: 'Etc/GMT',
      application_name: env.DB_APPLICATION_NAME || `alfa-wiki-${env.NODE_ENV || 'development'}`,
      keepAlive: true,
      connectionTimeoutMillis: envInteger(env, 'DB_CONNECT_TIMEOUT_MS', 10_000, 1_000, 120_000),
      ...(statementTimeout > 0 ? { statement_timeout: statementTimeout } : {}),
    },
    readinessTimeoutMs: envInteger(env, 'DB_READINESS_TIMEOUT_MS', 3_000, 500, 30_000),
  };
}

function getPoolStats(pool, configuredPool) {
  return {
    size: Number(pool?.size ?? pool?._count ?? 0),
    available: Number(pool?.available ?? pool?._availableObjects?.length ?? 0),
    using: Number(pool?.using ?? pool?._inUseObjects?.length ?? 0),
    waiting: Number(pool?.waiting ?? pool?._pendingAcquires?.length ?? 0),
    max: configuredPool.max,
    min: configuredPool.min,
  };
}

module.exports = { envInteger, buildDatabaseRuntimeConfig, getPoolStats };
