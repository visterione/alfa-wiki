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

test('доля ответа из черновика: дословно — 1, поправленный падеж — почти 1, своё — около 0', () => {
  const { draftShare } = require('../services/reviewCollector/drafts');
  const draft = 'Благодарим вас за подробный отзыв о приёме у Ольги Алексеевны. '
    + 'Нам очень приятно, что вы остались довольны вниманием и подробными объяснениями врача.';
  assert.equal(draftShare(draft, draft), 1);
  const fixed = draft.replace('довольны вниманием', 'довольна вниманием');
  assert.ok(draftShare(fixed, draft) > 0.8);
  const own = 'Спасибо, что нашли время написать. Передадим Ольге Алексеевне ваши тёплые слова, '
    + 'она будет рада узнать, что лечение помогло.';
  assert.ok(draftShare(own, draft) < 0.1);
  assert.equal(draftShare('', draft), 0);
});

test('ближайший вариант ищется во всех показанных наборах', () => {
  const { closestDraft } = require('../services/reviewCollector/drafts');
  const batches = [
    { items: [{ text: 'Первый набор, первый вариант ответа клиники.' }] },
    { items: [{ text: 'Совсем другой текст.' }, { text: 'Второй набор, второй вариант ответа клиники.' }] },
  ];
  const best = closestDraft('Второй набор, второй вариант ответа клиники.', batches);
  assert.deepEqual([best.bestBatch, best.bestIndex, best.fromDraft], [1, 1, 1]);
  assert.deepEqual(closestDraft('Своё', []), { fromDraft: 0, bestBatch: null, bestIndex: null });
});
