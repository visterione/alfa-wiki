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
