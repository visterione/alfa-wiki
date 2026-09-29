'use strict';

/**
 * Проверки выгрузки вики для печати (ver. 8.99).
 *
 * Главное здесь — не вёрстка документа, а то, что в него не попадает лишнее.
 * Выгрузка собирает сотни страниц за один запрос, и любая дыра в правилах
 * доступа превращается в способ унести всё закрытое разом: страницу из
 * закрытой папки, вложение чужого чата по ссылке из html-страницы, файл за
 * пределами uploads по относительному пути.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { folderChainChecker } = require('../utils/pageAccess');
const { Converter, parseColor, resolveUploadPath, resolveHref, buildPrintDocument } = require('../services/wikiDocx');
const { orderEntries } = require('../routes/print-export');

const HR = 'role-hr';
const folders = [
  { id: 'root-open', parentId: null, allowedRoles: [] },
  { id: 'root-closed', parentId: null, allowedRoles: [HR] },
  { id: 'child-open', parentId: 'root-closed', allowedRoles: [] },
  { id: 'loop-a', parentId: 'loop-b', allowedRoles: [] },
  { id: 'loop-b', parentId: 'loop-a', allowedRoles: [] },
];

test('закрытая папка закрывает вложенные, даже если у них роли не заданы', () => {
  const ok = folderChainChecker(folders, [], false);
  assert.equal(ok(null), true);
  assert.equal(ok('root-open'), true);
  assert.equal(ok('root-closed'), false);
  assert.equal(ok('child-open'), false);

  const hr = folderChainChecker(folders, [HR], false);
  assert.equal(hr('child-open'), true);
});

test('неизвестная папка и цикл в parentId считаются закрытыми', () => {
  const ok = folderChainChecker(folders, [], false);
  assert.equal(ok('no-such-folder'), false);
  assert.equal(ok('loop-a'), false);
});

test('картинки из закрытых частей uploads и из-за его пределов не читаются', () => {
  assert.equal(resolveUploadPath('/uploads/chat-attachments/a.png'), null);
  assert.equal(resolveUploadPath('/uploads/vacancies/1/passport.jpg'), null);
  assert.equal(resolveUploadPath('https://wiki.example.ru/uploads/open-line/x.jpg'), null);
  assert.equal(resolveUploadPath('/uploads/../.env'), null);
  assert.equal(resolveUploadPath('/uploads/%2e%2e/.env'), null);
  assert.equal(resolveUploadPath('https://evil.example/etc/passwd'), null);

  const ok = resolveUploadPath('/uploads/2026-07/pic.png?v=2');
  assert.equal(ok, path.resolve(__dirname, '..', 'uploads', '2026-07', 'pic.png'));
  // Страницы, скопированные с боя, несут полный адрес — файл при этом наш.
  assert.equal(resolveUploadPath('https://wiki.example.ru/uploads/2026-07/pic.png'), ok);
});

test('внутренние ссылки становятся полными только при известном адресе портала', () => {
  assert.equal(resolveHref('/page/rules', 'https://wiki.example.ru/'), 'https://wiki.example.ru/page/rules');
  assert.equal(resolveHref('/page/rules', ''), null);
  assert.equal(resolveHref('javascript:alert(1)', 'https://x'), null);
  assert.equal(resolveHref('#top', 'https://x'), null);
  assert.equal(resolveHref('mailto:hr@alfa.ru', ''), 'mailto:hr@alfa.ru');
});

test('цвета: неразборчивое и прозрачное не красит текст', () => {
  assert.equal(parseColor('#e03e2d'), 'E03E2D');
  assert.equal(parseColor('#abc'), 'AABBCC');
  assert.equal(parseColor('rgb(255, 0, 16)'), 'FF0010');
  assert.equal(parseColor('rgba(0,0,0,0)'), null);
  assert.equal(parseColor('var(--text-primary)'), null);
});

test('из html-страницы уходят скрипты, стили, кнопки и скрытое', () => {
  const converter = new Converter({ images: new Map(), baseUrl: '' });
  const blocks = converter.convert(`
    <style>.a{color:red}</style><script>window.secret = 1</script>
    <div><h1>Прайс</h1><button>Купить</button><div style="display:none">служебное</div>
    <p hidden>тоже служебное</p><p>Цена <b>1000</b></p></div>`);
  const xml = JSON.stringify(blocks);
  assert.match(xml, /Прайс/);
  assert.match(xml, /Цена/);
  for (const leaked of ['secret', 'color:red', 'Купить', 'служебное']) {
    assert.doesNotMatch(xml, new RegExp(leaked));
  }
});

test('порядок: страницы раздела до подразделов, номера в названиях по числу', () => {
  const entries = orderEntries(
    [
      { id: 'p1', title: '10. Десятая', folderId: 'f1' },
      { id: 'p2', title: '2. Вторая', folderId: 'f1' },
      { id: 'p3', title: 'Введение', folderId: null },
      { id: 'p4', title: 'Шаблон', folderId: 'f2' },
    ],
    [{ id: 'f1', title: 'Кадры', parentId: null }, { id: 'f2', title: 'Бланки', parentId: 'f1' }],
  );
  assert.deepEqual(entries.map(e => `${e.level}:${e.title}`), [
    '0:Введение', '0:Кадры', '1:2. Вторая', '1:10. Десятая', '1:Бланки', '2:Шаблон',
  ]);
});

test('документ собирается и это zip с document.xml', async () => {
  const buffer = await buildPrintDocument({
    siteName: 'Альфа',
    generatedBy: 'Тест',
    entries: [
      { kind: 'folder', title: 'Кадры', level: 0 },
      {
        kind: 'page', title: 'Правила', level: 1, updatedAt: new Date(),
        contentHtml: '<ol><li><p>Один</p><ul><li>вложенный</li></ul></li></ol><table><tr><td></td></tr></table>',
      },
    ],
  });
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.includes(Buffer.from('word/document.xml')));
});

test('снимок из браузера подменяет разметку только html-страницы', () => {
  const entries = orderEntries(
    [
      { id: 'h', title: 'Услуги', folderId: null, contentType: 'html', content: '<div id="app"></div>' },
      { id: 'w', title: 'Правила', folderId: null, contentType: 'wysiwyg', content: '<p>из базы</p>' },
    ],
    [],
    { h: '<table><tr><td>КТ</td></tr></table>', w: '<p>подмена</p>' },
  );
  const byTitle = Object.fromEntries(entries.map(e => [e.title, e]));
  assert.match(byTitle['Услуги'].contentHtml, /КТ/);
  assert.ok(byTitle['Услуги'].dataAt instanceof Date);
  assert.equal(byTitle['Правила'].contentHtml, '<p>из базы</p>');
  assert.equal(byTitle['Правила'].dataAt, null);
});

test('сетка карточек из снимка ложится таблицей без рамок', async () => {
  const buffer = await buildPrintDocument({
    siteName: 'Альфа',
    entries: [{
      kind: 'page', title: 'Врачи', level: 0, updatedAt: new Date(), dataAt: new Date(),
      contentHtml: '<table data-print-layout="grid"><tbody><tr><td>Иванов</td><td>Петров</td></tr></tbody></table>'
        + '<img src="data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22/%3E">',
    }],
  });
  const JSZip = require('jszip');
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  assert.match(xml, /<w:tblBorders><w:top w:val="none"/);
  assert.match(xml, /данные на/);
  // SVG, закодированный в адрес, — картинка, а не пометка «[Изображение]».
  assert.doesNotMatch(xml, /\[Изображение/);
});

test('разрыв страницы, ширина ячейки и hideMeta из снимка доходят до Word', async () => {
  const buffer = await buildPrintDocument({
    siteName: 'Альфа',
    entries: [{
      kind: 'page', title: 'Терапевты', level: 0, updatedAt: new Date(), dataAt: new Date(), hideMeta: true,
      contentHtml: '<div><table data-print-layout="grid"><tbody><tr><td>Иванов</td><td style="width:120px">фото</td></tr></tbody></table></div>'
        + '<div style="page-break-before:always"><p>Петров</p></div>',
    }],
  });
  const JSZip = require('jszip');
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  assert.doesNotMatch(xml, /Обновлено|данные на/);
  assert.match(xml, /<w:tcW w:type="dxa" w:w="1800"\/>/);
  const petrov = xml.indexOf('Петров');
  const paragraphStart = xml.lastIndexOf('<w:p>', petrov);
  assert.match(xml.slice(paragraphStart, petrov), /<w:pageBreakBefore\/>/);
});

test('вместо титула плашка с датой, а подписи выгрузившего нет', async () => {
  const buffer = await buildPrintDocument({
    siteName: 'Альфа',
    generatedBy: 'Иванов',
    generatedAt: new Date(2026, 8, 29),
    entries: [{ kind: 'folder', title: 'Кадры', level: 0 }],
  });
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const styles = await zip.file('word/styles.xml').async('string');
  assert.match(xml, /Материалы для печати от 29\.09\.2026/);
  assert.doesNotMatch(xml, /Выгрузил|Страниц:|Иванов/);
  assert.doesNotMatch(xml, /<w:titlePg/);
  // Папки первого уровня в оглавлении — жирные и акцентного цвета.
  assert.match(styles, /w:styleId="TOC1"[\s\S]*?<w:b\/>[\s\S]*?<w:color w:val="007AFF"\/>/);
});
