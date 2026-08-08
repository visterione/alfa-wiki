/**
 * Разбор HTML уроков. Единственная часть раздела курсов, которую можно
 * проверить без экрана: дальше идут уже компоненты.
 */
import {parseHtml, htmlToPlainText} from '../src/utils/html';

describe('parseHtml', () => {
  it('разбирает абзацы, заголовки и выравнивание', () => {
    const blocks = parseHtml('<h2 style="text-align: center">Шапка</h2><p>Текст</p>');
    expect(blocks).toEqual([
      {type: 'heading', level: 2, align: 'center', runs: [{text: 'Шапка'}]},
      {type: 'paragraph', align: null, runs: [{text: 'Текст'}]},
    ]);
  });

  it('держит оформление кусков строки, в том числе вложенное', () => {
    const [block] = parseHtml('<p>а <strong>б <em>в</em></strong> <a href="https://x.ru">г</a></p>');
    expect(block.runs).toEqual([
      {text: 'а '},
      {bold: true, text: 'б '},
      {bold: true, italic: true, text: 'в'},
      {text: ' '},
      {link: 'https://x.ru', text: 'г'},
    ]);
  });

  it('нумерует пункты списка и считает вложенность', () => {
    const blocks = parseHtml(
      '<ol><li><p>Раз</p><ul><li><p>Вложенный</p></li></ul></li><li><p>Два</p></li></ol>',
    );
    expect(blocks.map(b => [b.type, b.ordered, b.index, b.depth])).toEqual([
      ['list-item', true, 1, 0],
      ['list-item', false, 1, 1],
      ['list-item', true, 2, 0],
    ]);
  });

  it('содержимое цитаты не превращается в обычные абзацы', () => {
    const blocks = parseHtml('<blockquote><p>раз</p><p>два</p></blockquote><p>после</p>');
    expect(blocks.map(b => b.type)).toEqual(['quote', 'quote', 'paragraph']);
  });

  it('в блоке кода пробелы и переводы строк сохраняются', () => {
    const [block] = parseHtml('<pre><code>if (a) {\n  b();\n}</code></pre>');
    expect(block).toEqual({type: 'code', text: 'if (a) {\n  b();\n}'});
  });

  it('вне блока кода переводы строк разметки не попадают в текст', () => {
    const [block] = parseHtml('<p>первая\n    вторая</p>');
    expect(block.runs).toEqual([{text: 'первая вторая'}]);
  });

  it('достаёт медиа с размерами', () => {
    const blocks = parseHtml(
      '<img src="/uploads/a.png" width="640" height="480" alt="Схема">' +
        '<video src="/uploads/v.mp4" poster="/uploads/p.jpg"></video>' +
        '<div data-youtube-video><iframe src="https://www.youtube.com/embed/abc123"></iframe></div>',
    );
    expect(blocks).toEqual([
      {type: 'image', src: '/uploads/a.png', alt: 'Схема', width: 640, height: 480},
      {type: 'video', src: '/uploads/v.mp4', poster: '/uploads/p.jpg'},
      {type: 'embed', src: 'https://www.youtube.com/embed/abc123'},
    ]);
  });

  it('собирает таблицу построчно', () => {
    const [table] = parseHtml(
      '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr>' +
        '<tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>',
    );
    expect(table.type).toBe('table');
    expect(table.rows.map(row => row.map(cell => cell.runs[0].text))).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
    expect(table.rows[0][0].header).toBe(true);
  });

  it('раскрывает сущности', () => {
    const [block] = parseHtml('<p>&laquo;Альфа&raquo; &amp; K&#176;</p>');
    expect(block.runs[0].text).toBe('«Альфа» & K°');
  });

  it('переживает пустой и мусорный ввод', () => {
    expect(parseHtml('')).toEqual([]);
    expect(parseHtml(null)).toEqual([]);
    expect(parseHtml('<p>текст</b></p></div>')).toEqual([
      {type: 'paragraph', align: null, runs: [{text: 'текст'}]},
    ]);
  });
});

describe('htmlToPlainText', () => {
  it('снимает разметку', () => {
    expect(htmlToPlainText('<h1>Раз</h1><p>Два <b>три</b></p>')).toBe('Раз\nДва три');
  });
});
