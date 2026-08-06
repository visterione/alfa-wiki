const test = require('node:test');
const assert = require('node:assert/strict');
const { serializePollMessage, applyVote } = require('../utils/chatPoll');

const poll = {
  question: 'Куда?',
  options: [{ id: 'a', text: 'А' }, { id: 'b', text: 'Б' }],
  multipleChoice: false,
  anonymous: true,
  votes: { u1: ['a'], u2: ['b'] },
  closedAt: null
};

test('anonymous poll returns counts and current choice without exposing voters', () => {
  const message = serializePollMessage({ type: 'poll', poll }, 'u1');
  assert.deepEqual(message.poll.myOptionIds, ['a']);
  assert.equal(message.poll.totalVoters, 2);
  assert.equal(message.poll.options[0].count, 1);
  assert.equal('voterIds' in message.poll.options[0], false);
});

test('open poll exposes voter ids by option', () => {
  const message = serializePollMessage({ type: 'poll', poll: { ...poll, anonymous: false } }, 'u3');
  assert.deepEqual(message.poll.options[1].voterIds, ['u2']);
});

test('single-choice poll rejects multiple options', () => {
  assert.throws(() => applyVote(poll, 'u1', ['a', 'b']), /только один/);
});

test('vote can be changed and retracted without mutating source poll', () => {
  const changed = applyVote(poll, 'u1', ['b']);
  assert.deepEqual(changed.votes.u1, ['b']);
  assert.deepEqual(poll.votes.u1, ['a']);
  const retracted = applyVote(changed, 'u1', []);
  assert.equal(retracted.votes.u1, undefined);
});
