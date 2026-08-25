/**
 * Замечание главврача.
 *
 * Показывается облачком с аватаркой, а не жёлтой плашкой: это сообщение от
 * человека, который анкету читал, и выполняют его охотнее, чем безымянное
 * «нужно поправить» от системы.
 */

import React, { useState } from 'react';
import { BASE_URL } from '../../services/api';
import './Anketa.css';

export default function RevisionNote({ note, author, at }) {
  const [failed, setFailed] = useState(false);
  const src = !failed && author?.avatar ? avatarUrl(author.avatar) : null;

  return (
    <div className="ank__msg">
      <div className="ank__msg-av">
        {src
          ? <img src={src} alt="" onError={() => setFailed(true)} />
          : <span>{initials(author?.name)}</span>}
      </div>

      <div className="ank__msg-body">
        <div className="ank__msg-who">
          {author?.name || 'Главврач'}
          {author?.position && <small>{author.position}</small>}
        </div>
        <div className="ank__msg-bubble">{note}</div>
        {at && <time className="ank__msg-time">{when(at)}</time>}
      </div>
    </div>
  );
}

function avatarUrl(value) {
  if (/^data:|^blob:/.test(value)) return value;
  if (/^https?:\/\//.test(value)) return value;
  return `${BASE_URL}/${String(value).replace(/^\//, '')}`;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

function when(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}
