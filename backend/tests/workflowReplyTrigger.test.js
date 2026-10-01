const test = require('node:test');
const assert = require('node:assert/strict');
const { isReplyPublished } = require('../services/workflowEngine');
const { mergeReply, replyMeta } = require('../services/reviewCollector/ingest');

test('ответ в очереди парсера ещё не опубликован', () => {
  assert.equal(isReplyPublished({ replyText: 'Спасибо', replySending: true }), false);
});

test('ответ на модерации площадки считается данным', () => {
  assert.equal(isReplyPublished(replyMeta({ text: 'Спасибо', state: 'moderation' })), true);
});

test('отклонённый и неотправленный ответы воронку не запускают', () => {
  assert.equal(isReplyPublished(replyMeta({ text: 'Спасибо', state: 'rejected' })), false);
  assert.equal(isReplyPublished({ replyText: 'Спасибо', replyFailed: true }), false);
});

test('сбор с площадки опередил очередь: переход видит сбор', () => {
  const sending = { replyText: 'Спасибо', replySending: true };
  const synced = mergeReply(sending, { text: 'Спасибо', state: 'published' });
  assert.equal(isReplyPublished(sending), false);
  assert.equal(isReplyPublished(synced), true);
});
