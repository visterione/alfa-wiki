'use strict';

/**
 * Разбирает обязательный закрытый диапазон дат из query-параметров.
 * Возвращает ошибку, которую route может безопасно отдать как HTTP 400.
 */
function parseRequiredDateRange(query = {}) {
  const { date_from: dateFrom, date_to: dateTo } = query;

  if (!dateFrom || !dateTo) {
    return { error: 'date_from и date_to обязательны' };
  }

  const start = new Date(dateFrom);
  const end = new Date(dateTo);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return { error: 'date_from и date_to должны быть корректными датами ISO' };
  }

  if (start > end) {
    return { error: 'date_from не может быть позже date_to' };
  }

  return { start, end };
}

module.exports = { parseRequiredDateRange };

