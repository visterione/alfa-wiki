'use strict';

/**
 * Коды задач: РЕМ-42, у части — РЕМ-42/2.
 *
 * Код нужен для одного: чтобы о задаче можно было говорить вслух и в переписке.
 * Поэтому у него два свойства, и оба важнее удобства реализации.
 *
 * Первое: код не меняется никогда. Переименовали проект, перенесли задачу в
 * другой — код прежний. Он записывается в tasks.code в момент создания и дальше
 * живёт сам по себе, а не вычисляется из текущего проекта. Иначе ссылка в
 * сообщении полугодовой давности однажды начнёт открывать не то.
 *
 * Второе: номера не повторяются даже после смены ключа проекта. Счётчики лежат
 * в отдельной таблице по префиксу, а не в строке проекта: если ключ РЕМ когда-то
 * освободится и достанется другому проекту, нумерация продолжится с того места,
 * где остановилась, и старые РЕМ-1..РЕМ-5 не получат двойников.
 *
 * Задача без проекта тоже получает код — с общим префиксом ЗАД. Таких у нас
 * заметная часть, и оставлять их без кода значит иметь два разных языка для
 * одних и тех же задач.
 */

const NO_PROJECT_PREFIX = 'ЗАД';
const KEY_MIN = 2;
const KEY_MAX = 6;

/** Буквы и цифры, всё остальное — разделители. Кириллица наравне с латиницей. */
const LETTERS = /[A-Za-zА-Яа-яЁё0-9]+/g;

function words(name) {
  return String(name || '').match(LETTERS) || [];
}

/**
 * «Ремонт МЦ-04» → РЕМ, «IT» → IT, «Он» + «боарды» → ОНБ.
 *
 * Берутся первые буквы первого слова — так код читается как сокращение
 * названия, а не как аббревиатура из инициалов: РЕМ узнаётся в разговоре, а РМ
 * приходится расшифровывать. Если первого слова не хватает, добираем из
 * следующих.
 */
function suggestKey(name, length = 3) {
  const parts = words(name);
  if (!parts.length) return '';
  let key = '';
  for (const part of parts) {
    key += part;
    if (key.length >= length) break;
  }
  return key.slice(0, Math.max(length, KEY_MIN)).toUpperCase();
}

/** Приводит введённый вручную ключ к каноническому виду или возвращает ''. */
function normalizeKey(value) {
  return (String(value || '').match(LETTERS) || []).join('').slice(0, KEY_MAX).toUpperCase();
}

function isValidKey(value) {
  const key = String(value || '');
  return key.length >= KEY_MIN && key.length <= KEY_MAX && normalizeKey(key) === key;
}

/**
 * Ключ, которого ещё нет: сначала длиннее, потом с цифрой.
 *
 * «Обслуживание» и «Обследования» дают одинаковые ОБС, и молча выдать второй
 * проект тем же ключом нельзя — коды перемешаются. Сначала пробуем удлинить до
 * ОБСЛ и ОБСЛЕ, и только когда и это совпало, дописываем цифру.
 */
function uniqueKey(name, taken = []) {
  const busy = new Set(taken.filter(Boolean).map(key => String(key).toUpperCase()));
  for (let length = 3; length <= KEY_MAX; length += 1) {
    const key = suggestKey(name, length);
    if (key && !busy.has(key)) return key;
    // Название короче текущей длины — удлинять уже нечем.
    if (key && key.length < length) break;
  }
  const base = suggestKey(name, 3) || NO_PROJECT_PREFIX;
  for (let n = 2; n < 100; n += 1) {
    const key = `${base.slice(0, KEY_MAX - String(n).length)}${n}`;
    if (!busy.has(key)) return key;
  }
  return `${base.slice(0, 2)}${Date.now().toString().slice(-3)}`;
}

/**
 * Следующий номер для префикса — одним атомарным оператором.
 *
 * `SELECT max(...) + 1` здесь неприменим: две задачи, созданные в одну секунду,
 * получили бы один код. INSERT ... ON CONFLICT DO UPDATE делает и выдачу, и
 * заведение счётчика для нового префикса за одну операцию, и параллельные
 * транзакции выстраиваются на блокировке строки счётчика.
 */
async function nextNumber(sequelize, prefix, transaction) {
  const [rows] = await sequelize.query(
    `INSERT INTO task_code_counters (prefix, next) VALUES (:prefix, 2)
     ON CONFLICT (prefix) DO UPDATE SET next = task_code_counters.next + 1
     RETURNING next - 1 AS number`,
    { replacements: { prefix }, transaction }
  );
  return Number(rows[0].number);
}

/** Выдать код: «РЕМ-42». */
async function issue(sequelize, prefix, transaction) {
  const clean = normalizeKey(prefix) || NO_PROJECT_PREFIX;
  const number = await nextNumber(sequelize, clean, transaction);
  return `${clean}-${number}`;
}

/** Код части: «РЕМ-42/2». Нумерация внутри задачи, с единицы. */
function partCode(code, index) {
  if (!code) return '';
  return `${code}/${Number(index) + 1}`;
}

module.exports = {
  NO_PROJECT_PREFIX,
  KEY_MIN,
  KEY_MAX,
  suggestKey,
  normalizeKey,
  isValidKey,
  uniqueKey,
  nextNumber,
  issue,
  partCode,
};
