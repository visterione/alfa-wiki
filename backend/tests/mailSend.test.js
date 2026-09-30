const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRecipients, validateRecipients, withSignature, MAX_RECIPIENTS,
} = require('../services/mail/send');

test('получатели принимаются и объектом, и строкой', () => {
  // Интерфейс отдаёт объекты, а адрес, подставленный из старой переписки,
  // приезжает строкой. Ломаться на этом нельзя.
  const list = normalizeRecipients([
    'urist@company.ru',
    { address: 'buh@company.ru', name: 'Бухгалтерия' },
    { email: 'info@alfa.ru' },
    null,
    '',
  ]);

  assert.equal(list.length, 3);
  assert.equal(list[0].address, 'urist@company.ru');
  assert.equal(list[1].name, 'Бухгалтерия');
  assert.equal(list[2].address, 'info@alfa.ru');
});

test('письмо без получателей не отправляется', () => {
  assert.throws(() => validateRecipients({ toList: [], ccList: [], bccList: [] }), /ни один получатель/);
});

test('копия и скрытая копия считаются получателями', () => {
  const out = validateRecipients({ toList: [], ccList: ['a@b.ru'], bccList: [] });
  assert.equal(out.cc.length, 1);
});

test('неверный адрес отбивается с указанием, какой именно', () => {
  assert.throws(
    () => validateRecipients({ toList: ['ok@mail.ru', 'без-собаки'], ccList: [], bccList: [] }),
    /без-собаки/
  );
});

test('слишком много получателей — это уже рассылка', () => {
  // У рассылок свой модуль: там отписка, разбивка по дням и учёт суточного
  // предела. Пускать такое через почтовый клиент значит однажды выжечь лимит
  // хостинга и оставить сеть без исходящей почты.
  const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@mail.ru`);
  assert.throws(() => validateRecipients({ toList: many, ccList: [], bccList: [] }), /рассылка/);
});

test('ровно предел получателей ещё проходит', () => {
  const many = Array.from({ length: MAX_RECIPIENTS }, (_, i) => `u${i}@mail.ru`);
  const out = validateRecipients({ toList: many, ccList: [], bccList: [] });
  assert.equal(out.to.length, MAX_RECIPIENTS);
});

test('подпись отделяется разделителем по стандарту', () => {
  const { html, text } = withSignature('<p>Ответ</p>', 'Ответ', 'Регистратура «Альфа»<br>+7 900 000-00-00');

  // Две черты и пробел — по ним почтовые клиенты отличают подпись от текста и
  // не тащат её в цитату при ответе.
  assert.match(text, /\n-- \n/);
  assert.match(html, /-- <br>/);
  assert.match(text, /Регистратура «Альфа»/);
  assert.match(text, /\+7 900 000-00-00/, 'в текстовой версии разметка должна исчезнуть, а данные остаться');
});

test('пустая подпись ничего не добавляет', () => {
  const { html, text } = withSignature('<p>Ответ</p>', 'Ответ', '   ');
  assert.equal(html, '<p>Ответ</p>');
  assert.equal(text, 'Ответ');
});

test('в исходящем письме внешние картинки цитаты снова настоящие (ver. 9.11)', () => {
  const { restoreQuotedImages } = require('../services/mail/send');
  const html = '<img alt="лого" data-mail-src="https://x.ru/logo.png"><img src="cid:a1"><p>data-mail-src="https://y.ru" в тексте</p>';
  const out = restoreQuotedImages(html);

  assert.match(out, /<img alt="лого" src="https:\/\/x\.ru\/logo\.png">/);
  assert.match(out, /src="cid:a1"/, 'cid-картинки не трогаем');
  assert.match(out, /<p>data-mail-src=/, 'текст письма без пробела перед атрибутом не меняется');
  assert.equal(restoreQuotedImages('<img data-mail-src="javascript:alert(1)">'), '<img data-mail-src="javascript:alert(1)">',
    'возвращаем только http(s)');
});

test('захват черновика понимает ответ Model.update — [число строк] (ver. 9.12)', async () => {
  // В 9.11 здесь бралось второе значение массива, оно всегда undefined, и ни
  // одно письмо не уходило. Проверяем на настоящей форме ответа Sequelize.
  const { MailDraft } = require('../models');
  const { claimDraft } = require('../services/mail/send');
  const original = MailDraft.update;
  try {
    let where = null;
    MailDraft.update = async (values, options) => { where = options.where; return [1]; };
    assert.equal(await claimDraft('d1'), true, 'одна изменённая строка — захватили');
    assert.deepEqual(where.status, ['draft', 'error'], 'захватываем только черновик или неудавшееся');

    MailDraft.update = async () => [0];
    assert.equal(await claimDraft('d1'), false, 'ноль строк — письмо уже отправляет кто-то другой');
  } finally {
    MailDraft.update = original;
  }
});
