function serializePollMessage(message, viewerId) {
  const data = typeof message?.toJSON === 'function' ? message.toJSON() : { ...message };
  if (data.type !== 'poll' || !data.poll) return data;
  const raw = data.poll;
  const votes = raw.votes && typeof raw.votes === 'object' ? raw.votes : {};
  const viewerKey = String(viewerId);
  data.poll = {
    question: raw.question,
    multipleChoice: Boolean(raw.multipleChoice),
    anonymous: raw.anonymous !== false,
    closedAt: raw.closedAt || null,
    totalVoters: Object.keys(votes).length,
    myOptionIds: Array.isArray(votes[viewerKey]) ? votes[viewerKey] : [],
    options: (raw.options || []).map(option => {
      const voterIds = Object.entries(votes)
        .filter(([, optionIds]) => Array.isArray(optionIds) && optionIds.includes(option.id))
        .map(([userId]) => userId);
      return {
        id: option.id,
        text: option.text,
        count: voterIds.length,
        ...(raw.anonymous === false ? { voterIds } : {})
      };
    })
  };
  return data;
}

function applyVote(poll, userId, requestedOptionIds) {
  if (poll.closedAt) throw Object.assign(new Error('Опрос завершён'), { status: 400 });
  const ids = [...new Set((requestedOptionIds || []).map(String))];
  const validIds = new Set((poll.options || []).map(option => String(option.id)));
  if (ids.some(id => !validIds.has(id))) throw Object.assign(new Error('Неизвестный вариант ответа'), { status: 400 });
  if (!poll.multipleChoice && ids.length > 1) throw Object.assign(new Error('Можно выбрать только один вариант'), { status: 400 });
  const votes = { ...(poll.votes || {}) };
  if (ids.length) votes[String(userId)] = ids;
  else delete votes[String(userId)];
  return { ...poll, votes };
}

module.exports = { serializePollMessage, applyVote };
