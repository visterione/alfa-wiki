import React, { useState } from 'react';
import { BarChart3, Check } from 'lucide-react';

export default function PollMessage({ message, onVote }) {
  const poll = message.poll;
  const [saving, setSaving] = useState(false);
  if (!poll) return null;
  const selected = poll.myOptionIds || [];
  const maxVotes = Math.max(1, ...poll.options.map(option => option.count || 0));

  const choose = async (optionId) => {
    if (poll.closedAt || saving) return;
    const next = poll.multipleChoice
      ? (selected.includes(optionId) ? selected.filter(id => id !== optionId) : [...selected, optionId])
      : (selected.includes(optionId) ? [] : [optionId]);
    setSaving(true);
    try { await onVote(next); } finally { setSaving(false); }
  };

  return (
    <div className="chat-poll">
      <div className="chat-poll-title"><BarChart3 size={18} /><span>{poll.question}</span></div>
      <div className="chat-poll-kind">{poll.anonymous ? 'Анонимный опрос' : 'Открытый опрос'}{poll.multipleChoice ? ' · несколько ответов' : ''}</div>
      <div className="chat-poll-options">
        {poll.options.map(option => {
          const active = selected.includes(option.id);
          const width = poll.totalVoters ? Math.max(3, ((option.count || 0) / maxVotes) * 100) : 0;
          return (
            <button key={option.id} type="button" className={`chat-poll-option${active ? ' active' : ''}`} onClick={() => choose(option.id)} disabled={saving || Boolean(poll.closedAt)}>
              <span className="chat-poll-progress" style={{ width: `${width}%` }} />
              <span className="chat-poll-check">{active && <Check size={14} />}</span>
              <span className="chat-poll-option-text">{option.text}</span>
              <strong>{option.count || 0}</strong>
            </button>
          );
        })}
      </div>
      <div className="chat-poll-footer">Проголосовали: {poll.totalVoters || 0}{poll.closedAt ? ' · опрос завершён' : ''}</div>
    </div>
  );
}
