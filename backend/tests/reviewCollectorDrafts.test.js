const test = require('node:test');
const assert = require('node:assert/strict');
const { clearDrafts } = require('../services/reviewCollector/drafts');
const { mergeReply } = require('../services/reviewCollector/ingest');

const withDrafts = { direct: { placeId: 'p' }, drafts: { items: ['a', 'b'], at: '2026-09-26' }, draftsPending: true };

test('clearDrafts убирает черновики и не трогает остальное', () => {
  const next = clearDrafts(withDrafts);
  assert.equal(next.drafts, undefined);
  assert.equal(next.draftsPending, undefined);
  assert.deepEqual(next.direct, { placeId: 'p' });
});

test('ответ, пришедший с площадки, убирает черновики', () => {
  const next = mergeReply(withDrafts, { text: 'Спасибо!', state: 'published' });
  assert.equal(next.replyText, 'Спасибо!');
  assert.equal(next.drafts, undefined);
});

test('без ответа черновики остаются', () => {
  const next = mergeReply(withDrafts, null);
  assert.deepEqual(next.drafts, withDrafts.drafts);
});

test('варианты с пометками (парсер 0.50) и старые строки приводятся к одному виду', () => {
  const { normalizeDraft } = require('../services/reviewCollector/drafts');
  assert.deepEqual(normalizeDraft('Текст'), { text: 'Текст', notes: [] });
  assert.deepEqual(
    normalizeDraft({ text: 'Текст', notes: ['обещает скидку', 42, ''] }),
    { text: 'Текст', notes: ['обещает скидку'] },
  );
  assert.equal(normalizeDraft({ text: '  ' }), null);
  assert.equal(normalizeDraft(null), null);
});
