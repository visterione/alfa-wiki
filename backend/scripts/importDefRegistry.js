'use strict';

/**
 * Справочник операторов из выписки реестра DEF-9xx (ver. 9.34).
 *
 * Выписка — таблица Минцифры «код, от, до, ёмкость, оператор, регион», около
 * восьми тысяч диапазонов и почти сотня юрлиц. Журналу рассылки столько не
 * нужно: диаграмме операторов SMS хватает брендов, которые человек узнаёт по
 * логотипу. Скрипт сводит юрлица к брендам, склеивает соседние диапазоны одного
 * бренда и пишет компактный CSV рядом с сервисом определения оператора.
 *
 * Регион отбрасывается: диаграмма отвечает «каким операторам уходят SMS», а не
 * «куда», и восемь тысяч строк ради неё портал держал бы в памяти зря.
 *
 * Запуск из папки backend:
 *   npm run operators:import -- ~/Downloads/Kody_DEF-9kh.htm
 *
 * Принимается и HTML-выписка (как её выкладывает МТС), и CSV Минцифры с теми же
 * столбцами через «;». После загрузки — перезапуск портала.
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'services', 'notifications', 'mobile-operators.csv');

// Юрлицо → бренд. Всё, чего здесь нет, уходит в «Прочие»: следующий по
// ёмкости после этих восьми держит доли процента номеров. Т2 в реестре
// записан двумя юрлицами — питерский «Теле2» исторически отдельный.
const BRANDS = [
  [/Мобильные ТелеСистемы/i, 'МТС'],
  [/Вымпел-Коммуникации/i, 'Билайн'],
  [/МегаФон/i, 'МегаФон'],
  [/Т2 Мобайл|Теле2/i, 'Т2'],
  [/Скартел/i, 'Yota'],
  [/Ростелеком/i, 'Ростелеком'],
  [/Сбербанк-Телеком/i, 'СберМобайл'],
  [/Тинькофф Мобайл|Т-Мобайл/i, 'Т-Мобайл']
];
const OTHER = 'Прочие';

const brandOf = (legal) => (BRANDS.find(([re]) => re.test(legal)) || [null, OTHER])[1];

function decode(text) {
  return text
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** Строки [код, от, до, оператор] из HTML-таблицы или CSV через «;». */
function readRows(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (/<td/i.test(raw)) {
    const rows = [];
    for (const tr of raw.split(/<tr[\s>]/i).slice(1)) {
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
        .map(m => decode(m[1].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim());
      if (/^9\d\d$/.test(cells[0])) rows.push([cells[0], cells[1], cells[2], cells[4]]);
    }
    return rows;
  }
  return raw.split(/\r?\n/)
    .map(line => line.split(';').map(c => c.replace(/^"|"$/g, '').trim()))
    .filter(c => /^9\d\d$/.test(c[0]))
    .map(c => [c[0], c[1], c[2], c[4]]);
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Укажите файл выписки: npm run operators:import -- путь/к/DEF-9xx.htm');
    process.exit(1);
  }
  const rows = readRows(path.resolve(file.replace(/^~/, process.env.HOME || '')));
  if (rows.length < 1000) {
    // В настоящей выписке их тысячи. Сотня-другая — значит, разобрали не ту
    // таблицу, и перезаписывать рабочий справочник таким нельзя.
    console.error(`В файле нашлось только ${rows.length} диапазонов — похоже, это не выписка DEF-9xx. Справочник не тронут.`);
    process.exit(1);
  }

  const ranges = rows
    .map(([code, from, to, legal]) => ({ code, from: Number(from), to: Number(to), brand: brandOf(legal) }))
    .filter(r => Number.isFinite(r.from) && Number.isFinite(r.to))
    .sort((a, b) => a.code.localeCompare(b.code) || a.from - b.from);

  // Соседние диапазоны одного бренда — в один: регионы разделять незачем.
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && last.code === r.code && last.brand === r.brand && r.from === last.to + 1) last.to = r.to;
    else merged.push({ ...r });
  }

  const pad = (n) => String(n).padStart(7, '0');
  const csv = ['code,from,to,operator']
    .concat(merged.map(r => `${r.code},${pad(r.from)},${pad(r.to)},${r.brand}`))
    .join('\n') + '\n';
  fs.writeFileSync(OUT, csv);

  const share = {};
  for (const r of ranges) share[r.brand] = (share[r.brand] || 0) + (r.to - r.from + 1);
  const total = Object.values(share).reduce((a, b) => a + b, 0);
  console.log(`Диапазонов в выписке ${rows.length}, после склейки ${merged.length} → ${path.relative(process.cwd(), OUT)}`);
  for (const [brand, n] of Object.entries(share).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${brand.padEnd(11)} ${(n / total * 100).toFixed(1)}% номеров`);
  }
  console.log('Перезапустите портал, чтобы справочник подхватился.');
}

main();
