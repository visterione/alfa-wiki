'use strict';

/**
 * Оператор связи по номеру телефона (ver. 9.34).
 *
 * Нужен диаграмме операторов SMS над журналом рассылки. Отчёт о доставке
 * Имобиса оператора не называет, а краткий отчёт кабинета называет, но приходит
 * на следующий день — и диаграмма, открытая «за сегодня», была пустой ровно
 * тогда, когда на неё смотрят. Поэтому оператор определяется у себя, по номеру.
 *
 * Справочник — mobile-operators.csv рядом с этим файлом: диапазоны номеров из
 * выписки реестра DEF-9xx, сведённые к брендам (собирается командой
 * npm run operators:import, см. scripts/importDefRegistry.js). Именно
 * диапазоны, а не один код: Yota, СберМобайл, Т-Мобайл живут на номерах внутри
 * кодов большой четвёрки, и по коду их не отличить. Первый справочник заказчика
 * был по кодам — такой файл тоже читается: строка без диапазона покрывает код
 * целиком.
 *
 * Номер, перенесённый к другому оператору с сохранением, считается за того, кому
 * диапазон выделен: базы переносов у нас нет. Для доли на диаграмме это
 * терпимая погрешность — заказчик называет аналитику формальной.
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'mobile-operators.csv');
const OTHER = 'Прочие';
const WHOLE = [0, 9999999];

/** Код → диапазоны [от, до, оператор], отсортированные по началу. */
function load() {
  const byCode = new Map();
  const lines = fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  const head = lines[0].split(',').map(s => s.trim().toLowerCase());
  const ranged = head.includes('from');
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(s => (s || '').trim());
    const code = cells[0];
    if (!/^9\d\d$/.test(code)) continue;
    const [from, to] = ranged ? [Number(cells[1]), Number(cells[2])] : WHOLE;
    const operator = ranged ? cells[3] : cells[1];
    if (!operator || !Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push([from, to, operator]);
  }
  for (const list of byCode.values()) list.sort((a, b) => a[0] - b[0]);
  return byCode;
}

let byCode = null;

/**
 * Оператор номера или null, если номер не российский мобильный: на диаграмме
 * операторов SMS ему не место, а «Прочие» — это мобильный номер вне брендов
 * справочника.
 */
function operatorOf(phone) {
  if (!byCode) byCode = load();
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && /^[78]/.test(digits)) digits = digits.slice(1);
  if (digits.length !== 10 || digits[0] !== '9') return null;

  const list = byCode.get(digits.slice(0, 3));
  if (!list) return OTHER;
  const n = Number(digits.slice(3));
  // Двоичный поиск: в коде бывает до сотни диапазонов, а номеров за месяц —
  // десятки тысяч.
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [from, to, operator] = list[mid];
    if (n < from) hi = mid - 1;
    else if (n > to) lo = mid + 1;
    else return operator;
  }
  return OTHER;
}

module.exports = { operatorOf, OTHER };
