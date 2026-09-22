const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stripQuotedText, htmlToPlain, buildPreview, sanitizeEmailHtml,
} = require('../services/mail/parse');

// ── Цитаты ────────────────────────────────────────────────────────────────

test('отрезается цитата Gmail с переносом вступления', () => {
  const body = [
    'Добрый день! Договор подписали, скан во вложении.',
    '',
    'В пн, 12 июн. 2023 г. в 14:32,',
    'Иван Петров <ivan@company.ru> написал(а):',
    '',
    '> Направляем вам договор на согласование.',
    '> Ждём подписанный скан.',
  ].join('\n');

  assert.equal(stripQuotedText(body), 'Добрый день! Договор подписали, скан во вложении.');
});

test('отрезается шапка процитированного письма из Outlook', () => {
  const body = [
    'Согласовано, можно оплачивать.',
    '',
    'От: Бухгалтерия <buh@alfa.ru>',
    'Отправлено: 3 марта 2024 г. 9:15',
    'Кому: Директор',
    'Тема: Счёт 451',
    '',
    'Прошу согласовать счёт.',
  ].join('\n');

  assert.equal(stripQuotedText(body), 'Согласовано, можно оплачивать.');
});

test('одинокая строка «От:» в живом тексте не считается цитатой', () => {
  // Без блока-шапки это просто предложение, и резать по нему нельзя.
  const body = 'От: кого ждать документы, мы так и не поняли. Уточните, пожалуйста.';
  assert.equal(stripQuotedText(body), body);
});

test('подпись после «-- » отбрасывается', () => {
  const body = 'Жалоба принята, разберёмся.\n\n-- \nС уважением, Мария\nАльфа, регистратура';
  assert.equal(stripQuotedText(body), 'Жалоба принята, разберёмся.');
});

test('английское вступление к цитате тоже режется', () => {
  const body = 'Thanks, received.\n\nOn Mon, Jun 12, 2023 at 2:32 PM John Smith <j@x.com> wrote:\n\n> Please find attached.';
  assert.equal(stripQuotedText(body), 'Thanks, received.');
});

test('ответ снизу не превращается в пустоту', () => {
  // Так пишут реже, но пишут. Вырезать всё и оставить пустой текст — значит
  // потерять письмо для поиска целиком, это хуже лишней цитаты.
  const body = [
    '> Подскажите, работает ли клиника 9 мая?',
    '> Спасибо.',
    '',
    'Девятого мая работаем с 9 до 15.',
  ].join('\n');

  const out = stripQuotedText(body);
  assert.match(out, /Девятого мая работаем/);
  assert.doesNotMatch(out, /Подскажите/);
});

test('письмо без цитат остаётся целым', () => {
  const body = 'Направляем гарантийное письмо по договору 451\nза пациента Иванову М. П.';
  assert.equal(stripQuotedText(body), body);
});

test('пустой и мусорный вход не роняют разбор', () => {
  assert.equal(stripQuotedText(''), '');
  assert.equal(stripQuotedText(null), '');
  assert.equal(stripQuotedText(undefined), '');
});

// ── HTML в текст ──────────────────────────────────────────────────────────

test('текст из HTML не слипается и не содержит разметки', () => {
  const html = '<div><p>Здравствуйте,</p><p>во вложении <b>претензия</b>.</p></div>';
  const text = htmlToPlain(html);
  assert.match(text, /Здравствуйте,/);
  assert.match(text, /во вложении претензия\./);
  assert.doesNotMatch(text, /[<>]/);
  // Абзацы должны разделиться, иначе «Здравствуйтево» попало бы в индекс.
  assert.doesNotMatch(text, /Здравствуйте,во/);
});

test('стили и скрипты не попадают в индекс', () => {
  const html = '<style>.x{display:none}</style><script>alert(1)</script><p>Текст письма</p>';
  assert.equal(htmlToPlain(html), 'Текст письма');
});

test('мнемоники раскрываются', () => {
  assert.equal(htmlToPlain('<p>ООО&nbsp;&laquo;Ромашка&raquo; &mdash; счёт &#8470;&nbsp;451</p>'),
    'ООО «Ромашка» — счёт № 451'.replace(/ /g, ' '));
});

// ── Превью ────────────────────────────────────────────────────────────────

test('превью режется по границе слова', () => {
  const text = 'Направляем гарантийное письмо по договору номер четыреста пятьдесят один за пациента';
  const preview = buildPreview(text, 40);
  assert.ok(preview.length <= 41, 'не длиннее заданного');
  assert.ok(preview.endsWith('…'));
  // Режем по пробелу: последнее слово должно остаться целым, а не оборваться
  // посередине — «четыреста пятьде…» в списке читается как ошибка.
  assert.equal(preview, 'Направляем гарантийное письмо по…');
});

test('короткий текст остаётся без многоточия', () => {
  assert.equal(buildPreview('Спасибо, получили.', 100), 'Спасибо, получили.');
});

// ── Очистка HTML ──────────────────────────────────────────────────────────

test('скрипты и обработчики вырезаются', () => {
  const { html } = sanitizeEmailHtml('<p onclick="steal()">Привет</p><script>alert(1)</script>');
  assert.doesNotMatch(html, /script/i);
  assert.doesNotMatch(html, /onclick/i);
  assert.match(html, /Привет/);
});

test('внешние картинки не загружаются сами', () => {
  // Картинка в пиксель — это отчёт отправителю о том, что письмо открыли.
  const { html, blockedImages } = sanitizeEmailHtml('<img src="https://tracker.example/p.gif?id=42">');
  assert.equal(blockedImages, 1);
  assert.doesNotMatch(html, /(^|[^-])src="https/, 'обычного src остаться не должно');
  assert.match(html, /data-mail-src="https:\/\/tracker\.example/);
});

test('картинки самого письма остаются', () => {
  const { html, blockedImages } = sanitizeEmailHtml('<img src="cid:logo123">');
  assert.equal(blockedImages, 0);
  assert.match(html, /src="cid:logo123"/);
});

test('ссылки открываются безопасно', () => {
  const { html } = sanitizeEmailHtml('<a href="https://example.com">сайт</a>');
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
});

test('javascript в ссылке не выживает', () => {
  const { html } = sanitizeEmailHtml('<a href="javascript:alert(1)">клик</a>');
  assert.doesNotMatch(html, /javascript:/i);
});

test('вёрстка письма таблицами сохраняется', () => {
  // Половина деловой почты свёрстана таблицами, и ломать их нельзя.
  const { html } = sanitizeEmailHtml('<table><tr><td style="color:#333">Ячейка</td></tr></table>');
  assert.match(html, /<table>/);
  assert.match(html, /<td style="color:#333">Ячейка<\/td>/);
});
