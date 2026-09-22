const test = require('node:test');
const assert = require('node:assert/strict');
const {
  hasRealAttachments, countRealAttachments, threadKeyOf, parseReferences, folderOrder,
} = require('../services/mail/sync');

// Структура письма в том виде, в каком её отдаёт imapflow в bodyStructure.
const plainLetter = { type: 'text/plain' };

const letterWithPdf = {
  type: 'multipart/mixed',
  childNodes: [
    { type: 'text/plain' },
    { type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: 'претензия.pdf' } },
  ],
};

const newsletterWithInlineImages = {
  type: 'multipart/related',
  childNodes: [
    { type: 'text/html' },
    { type: 'image/png', disposition: 'inline', id: '<logo>' },
    { type: 'image/png', disposition: 'inline', id: '<banner>' },
  ],
};

test('скрепка появляется только у настоящих вложений', () => {
  assert.equal(hasRealAttachments(plainLetter), false);
  assert.equal(hasRealAttachments(letterWithPdf), true);
  // Картинки вёрстки — не вложения. Иначе скрепка висела бы у каждой рассылки.
  assert.equal(hasRealAttachments(newsletterWithInlineImages), false);
  assert.equal(hasRealAttachments(null), false);
});

test('вложения считаются на любой глубине', () => {
  const forwarded = {
    type: 'multipart/mixed',
    childNodes: [
      { type: 'text/plain' },
      {
        type: 'message/rfc822',
        childNodes: [
          { type: 'multipart/mixed', childNodes: [
            { type: 'text/plain' },
            { type: 'application/pdf', disposition: 'attachment' },
            { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', disposition: 'attachment' },
          ] },
        ],
      },
    ],
  };
  assert.equal(countRealAttachments(forwarded), 2, 'пересланное письмо не прячет свои вложения');
  assert.equal(countRealAttachments(letterWithPdf), 1);
  assert.equal(countRealAttachments(newsletterWithInlineImages), 0);
});

test('корень цепочки берётся из References', () => {
  // Первый идентификатор в References — самое начало ветки.
  assert.equal(
    threadKeyOf('<msg3@x>', ['<msg1@x>', '<msg2@x>'], '<msg2@x>'),
    '<msg1@x>'
  );
});

test('без References корнем становится письмо, на которое отвечают', () => {
  assert.equal(threadKeyOf('<msg2@x>', null, '<msg1@x>'), '<msg1@x>');
});

test('первое письмо ветки само себе корень', () => {
  assert.equal(threadKeyOf('<msg1@x>', null, null), '<msg1@x>');
  assert.equal(threadKeyOf(null, null, null), null);
});

test('References разбирается из сырого заголовка с переносами', () => {
  // Длинный References почтовые серверы переносят по строкам — это норма.
  const header = Buffer.from('References: <a@x.ru>\r\n <b@x.ru>\r\n\t<c@x.ru>\r\n', 'utf8');
  assert.deepEqual(parseReferences(header), ['<a@x.ru>', '<b@x.ru>', '<c@x.ru>']);
});

test('пустой References не ломает разбор', () => {
  assert.equal(parseReferences(null), null);
  assert.equal(parseReferences(Buffer.from('References: \r\n')), null);
});

test('References обрезается, а не растёт бесконечно', () => {
  // В длинных ветках заголовок разрастается до сотен идентификаторов, и целиком
  // он нам не нужен — корень всё равно первый.
  const many = Array.from({ length: 80 }, (_, i) => `<m${i}@x>`).join(' ');
  assert.equal(parseReferences(Buffer.from(`References: ${many}`)).length, 50);
});

test('папки выстраиваются как в почтовом клиенте', () => {
  const order = [
    { path: 'Личное', specialUse: undefined },
    { path: 'Trash', specialUse: '\\Trash' },
    { path: 'INBOX', specialUse: undefined },
    { path: 'Спам', specialUse: '\\Junk' },
    { path: 'Отправленные', specialUse: '\\Sent' },
  ].sort((a, b) => folderOrder(a) - folderOrder(b)).map((f) => f.path);

  assert.deepEqual(order, ['INBOX', 'Отправленные', 'Личное', 'Спам', 'Trash']);
});
