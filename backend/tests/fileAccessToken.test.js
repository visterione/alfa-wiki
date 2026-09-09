'use strict';

/**
 * Токен доступа к вложениям (ver. 7.27, стабилизирован в 8.10).
 *
 * Токен подставляется в адрес картинки (?t=…), поэтому его нестабильность — это
 * нестабильность адреса. Пока он выдавался с точностью до миллисекунды,
 * открытая линия, перечитывающая состояние раз в пять минут, каждый раз меняла
 * src у всех вложений: браузер выбрасывал их из кэша и качал заново, а со
 * стороны это выглядело как «картинки пропали и через пару минут вернулись».
 *
 * Отсюда и тест: свойство неочевидное, ломается молча и проявляется не в коде,
 * а в поведении чужого кэша.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const fileAccess = require('../services/fileAccess');

test('два вызова подряд дают один и тот же токен', () => {
  assert.equal(fileAccess.issueToken('user-1'), fileAccess.issueToken('user-1'));
});

test('у разных людей токены разные', () => {
  assert.notEqual(fileAccess.issueToken('user-1'), fileAccess.issueToken('user-2'));
});

test('округление вверх не укорачивает жизнь токена', () => {
  const exp = Number(fileAccess.issueToken('user-1').split('.')[1]);
  const left = exp - Date.now();

  // Не меньше заявленных суток и не больше суток плюс шаг округления: первое
  // важно, чтобы токен не протух раньше обещанного, второе — чтобы шаг случайно
  // не вырос до недели.
  assert.ok(left >= fileAccess.TOKEN_TTL_MS, `осталось ${left} мс`);
  assert.ok(left <= fileAccess.TOKEN_TTL_MS + fileAccess.TOKEN_BUCKET_MS, `осталось ${left} мс`);
});

test('токен по-прежнему проверяется и подделка не проходит', () => {
  const token = fileAccess.issueToken('user-1');
  assert.equal(fileAccess.verifyToken(token), 'user-1');

  // Чужой идентификатор с чужой подписью: округление границы ничего не
  // ослабляет, подпись всё так же не сходится.
  const [, exp, sig] = token.split('.');
  assert.equal(fileAccess.verifyToken(`user-2.${exp}.${sig}`), null);
  assert.equal(fileAccess.verifyToken(`user-1.${Number(exp) + 1}.${sig}`), null);
  assert.equal(fileAccess.verifyToken('мусор'), null);
});

test('короткий срок жизни не округляется до длинного', () => {
  // Округление добавляет к сроку до шести часов, и для токена, выписанного на
  // минуту, это было бы не «стабильный адрес», а молча продлённый доступ.
  // Ровно на этом ловится ошибка: сначала округлялось всё подряд, и токен,
  // выданный с отрицательным сроком, оказывался действительным до ближайшей
  // шестичасовой границы.
  assert.equal(fileAccess.verifyToken(fileAccess.issueToken('user-1', -1000)), null);

  const minute = Number(fileAccess.issueToken('user-1', 60_000).split('.')[1]);
  assert.ok(minute - Date.now() <= 60_000, 'минутный токен должен жить минуту');
});
