'use strict';

/**
 * Отделения, на которые заполняется порционное требование.
 *
 * Здесь только значения по умолчанию: название отделения и список палат
 * администратор правит на самой странице, и правка ложится в настройку
 * mealDepartments (routes/meal-requirements.js). Захардкоженный список палат
 * пришлось бы менять выкатом каждый раз, когда в отделении откроют ещё одну.
 *
 * Ключ отделения задаётся атрибутом data-department у вики-страницы: буфет один
 * на всю больницу, а страницы у отделений разные, со своими ролями.
 */

function range(from, to) {
  const out = [];
  for (let n = from; n <= to; n++) out.push(String(n));
  return out;
}

const DEFAULT_DEPARTMENTS = {
  therapy: { key: 'therapy', title: 'Терапевтическое отделение', rooms: range(301, 311) },
  gynecology: { key: 'gynecology', title: 'Гинекологическое отделение', rooms: [] },
  surgery: { key: 'surgery', title: 'Хирургическое отделение', rooms: [] }
};

/**
 * Палаты из того, что ввёл человек: «301-311», «301, 302, 305-307», список
 * строками. Диапазон разворачиваем сами — набирать одиннадцать номеров руками
 * никто не станет, а ошибётся при этом каждый второй.
 */
function parseRooms(input) {
  const parts = Array.isArray(input)
    ? input
    : String(input || '').split(/[,;\n]+/);

  const rooms = [];
  parts.forEach(part => {
    const piece = String(part).trim();
    if (!piece) return;

    const range2 = piece.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
    if (range2) {
      const from = Number(range2[1]);
      const to = Number(range2[2]);
      // Обратный диапазон («311-301») — почти наверняка опечатка, а не намерение
      if (to >= from && to - from <= 200) {
        for (let n = from; n <= to; n++) rooms.push(String(n));
        return;
      }
    }
    rooms.push(piece.slice(0, 20));
  });

  // Повторы намеренно оставляем. В двухместной палате медсёстры пишут каждого
  // пациента отдельной строкой — иначе на два имени в одной ячейке приходится
  // один стол, и в буфете не разобрать, кому какой. Так что «309, 309» — это
  // не опечатка, а две койки, и порядок строк задаёт администратор.
  return rooms.slice(0, 200);
}

function getDefaultDepartment(key) {
  return DEFAULT_DEPARTMENTS[String(key || '').trim()] || null;
}

module.exports = { DEFAULT_DEPARTMENTS, getDefaultDepartment, parseRooms };
