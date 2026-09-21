'use strict';

/**
 * Группа ВКонтакте для канала Notify (ver. 8.51).
 *
 * Поле было числовым — id группы, — и это оказалось неудачно. Во Fromni в той
 * же настройке вводили ссылку (https://vk.com/3k_anapa), и человек, который
 * переносит настройку филиала, держит в руках именно ссылку. Требовать от него
 * превратить её в число значит просить проделать вручную то, что умеет код, и
 * ровно в тот момент, когда цена опечатки выше всего: неверный id не выдаёт
 * себя ничем — уведомление просто уходит не туда или никуда.
 *
 * Поэтому храним то, что человек ввёл, а разбираем при отправке. Два исхода:
 *
 *   id         — в ссылке было число (vk.com/club123456789) или его ввели
 *                прямо; такую группу Имобис понимает наверняка;
 *   screenName — короткий адрес (vk.com/3k_anapa). Превратить его в id без
 *                токена ВК нам нечем, поэтому отдаём как есть и полагаемся на
 *                Имобис. Если он короткие адреса не принимает, это будет видно
 *                в первой же проверке отправки: текст отказа от их API мы
 *                кладём в журнал целиком, не сворачивая в «HTTP 400».
 */

// Числовые формы короткого адреса: club, public и event — это одно и то же
// сообщество, отличается только вид ссылки.
const NUMERIC_PREFIX = /^(?:club|public|event)(\d+)$/i;

/**
 * @param {string|number|null} raw то, что вписали в карточке филиала
 * @returns {{id: number|null, screenName: string|null}|null} null — поле пустое
 */
function parse(raw) {
  if (raw === null || raw === undefined) return null;

  let value = String(raw).trim();
  if (!value) return null;

  // Число целиком — так поле хранилось до 8.51, и такие значения должны
  // продолжать работать без миграции.
  if (/^\d+$/.test(value)) return { id: Number(value), screenName: null };

  // Из ссылки берём последний значимый сегмент. Заодно отсекаем параметры и
  // якорь: скопированная из браузера ссылка нередко тащит за собой ?from=…
  value = value
    .replace(/^https?:\/\//i, '')
    // Хост снимаем вместе с косой чертой или без неё: одно «vk.com» без пути —
    // это не группа, и стать коротким адресом оно не должно.
    .replace(/^(?:m\.)?vk\.(?:com|ru)(?:\/|$)/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/^@/, '');

  if (!value) return null;

  // Ссылка могла быть с путём (vk.com/club123/posts) — берём первый сегмент:
  // сообщество задаёт именно он.
  value = value.split('/')[0];
  if (!value) return null;

  if (/^\d+$/.test(value)) return { id: Number(value), screenName: null };

  const numeric = value.match(NUMERIC_PREFIX);
  if (numeric) return { id: Number(numeric[1]), screenName: null };

  return { id: null, screenName: value };
}

/** Что передать Имобису в поле group: число, если оно известно, иначе адрес. */
function forImobis(raw) {
  const parsed = parse(raw);
  if (!parsed) return null;
  return parsed.id !== null ? parsed.id : parsed.screenName;
}

/** Как показать значение человеку, не переписывая введённое. */
function label(raw) {
  const parsed = parse(raw);
  if (!parsed) return '';
  return parsed.id !== null ? String(parsed.id) : parsed.screenName;
}

module.exports = { parse, forImobis, label };
