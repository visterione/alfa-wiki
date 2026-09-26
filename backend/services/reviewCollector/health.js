'use strict';

/**
 * Требует ли учётка площадки внимания человека (ver. 8.87).
 *
 * Проблемы Альфа Парсера не должны проглатываться молча: закончилась сессия,
 * сменили пароль, площадка отдаёт ошибки — и отзывы перестают приходить без
 * единого сигнала. Отсюда и треугольник на кнопке «Площадки».
 *
 * Отдельно ловим случай, о котором парсер сам не скажет, — когда молчит он
 * сам: упал, сервер выключен, ключ отозван. Статус учётки тогда застывает на
 * «Работает». Парсер отчитывается после каждого сбора (раз в 30 минут), так
 * что три часа тишины у учётки, которая должна собирать, — это уже сбой, а
 * не задержка: запас на полный проход по истории и на перезапуск.
 */

const SILENT_AFTER_H = 3;

const PROBLEMS = {
  needs_login: 'Нужен вход',
  bad_password: 'Неверный пароль',
  error: 'Ошибка',
  silent: 'Нет связи с парсером',
};

function isCollecting(account) {
  return (account.places || []).some(p => p.mode !== 'off' && p.boardId);
}

/** Ключ проблемы учётки или null. */
function accountProblem(account, now = Date.now()) {
  if (!account.isEnabled) return null;
  if (PROBLEMS[account.status]) return account.status;
  if (!isCollecting(account)) return null;
  const lastContact = new Date(account.statusAt || account.createdAt).getTime();
  if (now - lastContact > SILENT_AFTER_H * 3600 * 1000) return 'silent';
  return null;
}

function problemLabel(key) {
  return PROBLEMS[key] || null;
}

module.exports = { accountProblem, problemLabel, SILENT_AFTER_H };
