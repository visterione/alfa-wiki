'use strict';

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parsePagination(query = {}, { defaultLimit = 50, maxLimit = 500, maxOffset = 1_000_000 } = {}) {
  return {
    limit: boundedInteger(query.limit, defaultLimit, 1, maxLimit),
    offset: boundedInteger(query.offset, 0, 0, maxOffset),
  };
}

module.exports = { boundedInteger, parsePagination };
