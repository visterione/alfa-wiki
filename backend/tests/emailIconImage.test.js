'use strict';

/**
 * Иконки писем (ver. 8.53).
 *
 * Маршрут /api/email/icon — единственный в разделе рассылок без проверки входа:
 * по нему ходит прокси Gmail, у которого токена нет и быть не может. Значит,
 * всё, что пришло из адреса, обязано быть проверено до того, как попадёт в имя
 * файла или в разметку SVG. Проверки ниже — про это и про совпадение адреса с
 * именем файла: разойдись они, картинка рисовалась бы заново на каждый запрос.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const icons = require('../services/emailIconImage');

test('иконка не из набора не даёт ни адреса, ни файла', async () => {
  assert.equal(icons.normalize({ key: 'нет-такой' }), null);
  assert.equal(icons.iconUrl({ key: 'нет-такой' }, 'https://wiki.example.ru'), '');
  assert.equal(await icons.iconFile({ key: 'нет-такой' }), null);
});

test('в имя файла не уходит ничего, кроме проверенных значений', () => {
  // Попытка выйти каталогом вверх и подсунуть свой цвет разбивается о то, что
  // имя берётся из набора, а цвет обязан быть шестнадцатеричным.
  assert.equal(icons.normalize({ key: '../../etc/passwd' }), null);
  const p = icons.normalize({ key: 'check', color: 'red; url(http://зло)', bg: '../x' });
  assert.equal(p.color, '#1C1C1E');
  assert.equal(p.bg, null);
});

test('размер зажат в вилку, а не берётся из адреса как есть', () => {
  assert.equal(icons.normalize({ key: 'check', size: 9000 }).size, icons.MAX_SIZE);
  assert.equal(icons.normalize({ key: 'check', size: -5 }).size, 12);
  assert.equal(icons.normalize({ key: 'check', size: 'сорок' }).size, 28);
});

test('адрес описывает картинку целиком — по нему её и кэшируют', () => {
  const url = icons.iconUrl({ key: 'heart-pulse', size: 32, color: '#0A84FF', bg: '#EAF4FF' }, 'https://wiki.example.ru/');
  assert.equal(url, 'https://wiki.example.ru/api/email/icon/heart-pulse.png?size=32&color=0A84FF&bg=EAF4FF');
  // Без подложки её нет и в адресе: иначе у одной иконки два адреса на одну картинку.
  const plain = icons.iconUrl({ key: 'heart-pulse', size: 32, color: '#0A84FF' }, 'https://wiki.example.ru');
  assert.equal(plain, 'https://wiki.example.ru/api/email/icon/heart-pulse.png?size=32&color=0A84FF');
});

test('в SVG уезжает выбранный цвет, а подложка становится кружком', () => {
  const withBg = icons.buildSvg(icons.normalize({ key: 'check', size: 40, color: '#0A84FF', bg: '#EAF4FF' }));
  // Скругление по умолчанию — половина стороны, то есть круг.
  assert.match(withBg, /<rect x="0" y="0" width="24" height="24" rx="12" ry="12" fill="#EAF4FF"\/>/);
  assert.match(withBg, /stroke="#0A84FF"/);
  // PNG рисуется вдвое крупнее: на экране с двойной плотностью иконка ровно по
  // размеру выглядит замыленной.
  assert.match(withBg, /width="80" height="80"/);

  const plain = icons.buildSvg(icons.normalize({ key: 'check', size: 40, color: '#0A84FF' }));
  assert.doesNotMatch(plain, /<rect/);
});

test('форма подложки задаётся одним скруглением — от круга до квадрата', () => {
  const svg = (radius) => icons.buildSvg(icons.normalize({ key: 'check', size: 40, color: '#000', bg: '#EEE', radius }));
  assert.match(svg(50), /rx="12" ry="12"/);
  assert.match(svg(25), /rx="6" ry="6"/);
  assert.match(svg(0), /rx="0" ry="0"/);
});

test('доля иконки в подложке ужимает глиф и ставит его в середину', () => {
  const svg = icons.buildSvg(icons.normalize({ key: 'check', size: 40, color: '#000', bg: '#EEE', scale: 50 }));
  // Половина стороны, значит по 6 единиц поля с каждой стороны от 24.
  assert.match(svg, /transform="translate\(6 6\) scale\(0\.5\)"/);

  // Без подложки ужимать нечего: глиф и есть картинка целиком.
  const plain = icons.normalize({ key: 'check', size: 40, color: '#000', scale: 50 });
  assert.equal(plain.scale, 100);
  assert.doesNotMatch(icons.buildSvg(plain), /transform=/);
});

test('толщина линии берётся из настройки и зажата в вилку', () => {
  assert.match(icons.buildSvg(icons.normalize({ key: 'check', size: 40, stroke: 1.25 })), /stroke-width="1\.25"/);
  assert.equal(icons.normalize({ key: 'check', stroke: 99 }).stroke, 4);
  assert.equal(icons.normalize({ key: 'check', stroke: 'толсто' }).stroke, 2);
});

test('оформление целиком входит в имя файла — иначе кэш отдаст чужую картинку', () => {
  const name = (p) => icons.fileNameOf(icons.normalize({ key: 'check', size: 40, color: '#000000', bg: '#EEEEEE', ...p }));
  const base = name({});
  assert.notEqual(name({ radius: 0 }), base);
  assert.notEqual(name({ scale: 80 }), base);
  assert.notEqual(name({ stroke: 1.5 }), base);
  // Точка в имени файла не нужна: она читается как расширение.
  assert.match(name({ stroke: 1.5 }), /-w1_5\.png$/);
});

test('умолчания не попадают в адрес, но подставляются при разборе', () => {
  // Каждая иконка везёт свою ссылку в письме, а Gmail режет письмо по весу.
  const short = icons.iconUrl({ key: 'check', size: 28, color: '#1C1C1E', bg: '#EEEEEE', radius: 50, scale: 58, stroke: 2 }, 'https://w.ru');
  assert.equal(short, 'https://w.ru/api/email/icon/check.png?size=28&color=1C1C1E&bg=EEEEEE');

  const long = icons.iconUrl({ key: 'check', size: 28, color: '#1C1C1E', bg: '#EEEEEE', radius: 10, scale: 80, stroke: 1.5 }, 'https://w.ru');
  assert.match(long, /radius=10&scale=80&stroke=1\.5/);

  // Разбор короткого адреса даёт те же параметры, что и длинного с умолчаниями,
  // значит и файл на диске у них один.
  assert.equal(
    icons.fileNameOf(icons.normalize({ key: 'check', size: 28, color: '1C1C1E', bg: 'EEEEEE' })),
    icons.fileNameOf(icons.normalize({ key: 'check', size: 28, color: '1C1C1E', bg: 'EEEEEE', radius: 50, scale: 58, stroke: 2 })),
  );
});

test('скругление и доля без подложки в адрес не едут', () => {
  // Рисовать им нечего, а в адресе они плодили бы разные ссылки на одну картинку.
  const url = icons.iconUrl({ key: 'check', size: 28, color: '#1C1C1E', radius: 0, scale: 40 }, 'https://w.ru');
  assert.equal(url, 'https://w.ru/api/email/icon/check.png?size=28&color=1C1C1E');
});

test('в наборе весь lucide, а не выжимка', () => {
  const { ICONS } = require('../services/emailIcons');
  assert.ok(Object.keys(ICONS).length > 1300, `иконок всего ${Object.keys(ICONS).length}`);
  // Отобранные никуда не делись и лежат под своими именами.
  ['stethoscope', 'test-tubes', 'badge-check', 'sparkles', 'map-pin'].forEach((k) => {
    assert.ok(ICONS[k], `нет иконки ${k}`);
  });
});

test('нарисованная иконка остаётся на диске и второй раз не рисуется', async () => {
  const params = { key: 'mail', size: 24, color: '#1C1C1E' };
  const first = await icons.iconFile(params);
  const stat = require('fs').statSync(first);
  const again = await icons.iconFile(params);
  assert.equal(again, first);
  assert.equal(require('fs').statSync(again).mtimeMs, stat.mtimeMs);
  assert.match(first, /mail-24-1C1C1E-w2\.png$/);
});

test('пустой параметр в адресе — это «не задано», а не ноль', () => {
  // Number('') и Number(null) дают ноль, а не NaN: без отдельной проверки
  // незаданное скругление делало круглую подложку квадратной, а незаданная
  // толщина линии — самой тонкой из возможных.
  const p = icons.normalize({ key: 'check', size: '', color: '#000', bg: '#EEE', radius: '', scale: null, stroke: undefined });
  assert.equal(p.size, 28);
  assert.equal(p.radius, 50);
  assert.equal(p.scale, 58);
  assert.equal(p.stroke, 2);
});

test('ноль, заданный явно, остаётся нулём', () => {
  // Квадратная подложка — это радиус 0, и отличать его от «не задано» надо.
  assert.equal(icons.normalize({ key: 'check', bg: '#EEE', radius: 0 }).radius, 0);
  assert.equal(icons.normalize({ key: 'check', bg: '#EEE', radius: '0' }).radius, 0);
});
