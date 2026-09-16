'use strict';

/**
 * Зарплата в вакансии (ver. 8.35).
 *
 * Хранится разложенной — вид и две суммы, — а показывается собранной строкой, и
 * собирает её этот модуль. Один раз на весь раздел: список вакансий филиала,
 * страница отклика и таблица в настройке читают одно и то же, поэтому «от
 * 100 000 до 120 000 ₽» выглядит везде одинаково, а не так, как набрал тот, кто
 * заводил вакансию.
 *
 * Здесь же проверка: пара «вид ↔ суммы» осмысленна не сама по себе. Вилка без
 * верхней границы и точная сумма без суммы — это не «наполовину заполнено», это
 * состояние, которое нечем показать. То же условие продублировано проверкой в
 * базе: форма приходит обычным PUT.
 */

const KINDS = {
  none:       { label: 'Не указывать' },
  exact:      { label: 'Фиксированная' },
  range:      { label: 'Вилка' },
  negotiable: { label: 'Договорная' }
};

// Верхняя граница — защита от случайного лишнего нуля, а не от мошенничества:
// миллион в месяц в сети медцентров не платят, а «1000000000» в вакансии
// увидят раньше, чем поправят.
const MAX_AMOUNT = 10000000;

const RUB = '₽';

function amount(value) {
  // Пробелы в разрядах — неразрывные: иначе «100 000» переносится посреди числа.
  return `${new Intl.NumberFormat('ru-RU').format(value)} ${RUB}`;
}

/**
 * Зарплата словами. Возвращает null, когда показывать нечего, — так вызывающему
 * не нужно знать про виды: есть строка — показываем, нет — блока нет вовсе.
 */
function label(vacancy) {
  switch (vacancy?.salaryKind) {
    case 'exact':      return amount(vacancy.salaryFrom);
    case 'range':      return `${new Intl.NumberFormat('ru-RU').format(vacancy.salaryFrom)} — ${amount(vacancy.salaryTo)}`;
    case 'negotiable': return 'По договорённости';
    default:           return null;
  }
}

/**
 * Разбор присланного редактором. Возвращает { errors, salary } — в salary лежат
 * ровно те три поля, которые пойдут в базу.
 *
 * Суммы у видов, где их не бывает, обнуляются, а не сохраняются «на всякий
 * случай»: иначе «Договорная» с забытыми 100 000 внутри однажды покажется
 * вилкой после смены вида.
 */
function parse(raw) {
  const errors = [];
  const kind = String(raw?.salaryKind || 'none');

  if (!KINDS[kind]) return { errors: ['Неизвестный вид зарплаты'], salary: null };
  if (kind === 'none' || kind === 'negotiable') {
    return { errors, salary: { salaryKind: kind, salaryFrom: null, salaryTo: null } };
  }

  const from = Math.round(Number(raw?.salaryFrom));
  const to = Math.round(Number(raw?.salaryTo));

  const good = (value) => Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT;

  if (!good(from)) {
    errors.push(kind === 'range' ? 'Нижняя граница зарплаты не заполнена' : 'Зарплата не заполнена');
    return { errors, salary: null };
  }

  if (kind === 'exact') {
    return { errors, salary: { salaryKind: 'exact', salaryFrom: from, salaryTo: null } };
  }

  if (!good(to)) {
    errors.push('Верхняя граница зарплаты не заполнена');
    return { errors, salary: null };
  }
  if (to <= from) {
    errors.push('Верхняя граница вилки должна быть больше нижней');
    return { errors, salary: null };
  }

  return { errors, salary: { salaryKind: 'range', salaryFrom: from, salaryTo: to } };
}

module.exports = { KINDS, MAX_AMOUNT, label, parse };
