/**
 * Вступление в группу по пригласительной ссылке (ver. 7.58).
 *
 * Лежит внутри ProtectedRoute по замыслу: ссылка рассчитана на сотрудников, и
 * незалогиненного портал уводит на вход, а после входа возвращает сюда же
 * (см. App.js, ProtectedRoute запоминает location). Поэтому отдельной
 * авторизации здесь нет — до этого кода доходят уже вошедшие.
 *
 * Экран-подтверждение, а не молчаливое вступление по открытию адреса. Ссылку
 * пересылают, и человек нередко открывает её, не зная, во что его зовут:
 * название группы и число участников он должен увидеть ДО того, как окажется
 * внутри чужой переписки.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Users, ArrowRight, Link2Off } from 'lucide-react';
import toast from 'react-hot-toast';

import { chat as chatApi, BASE_URL } from '../services/api';
import './ChatJoin.css';

function memberCountLabel(n) {
  const tail = n % 100 >= 11 && n % 100 <= 14 ? 0 : n % 10;
  if (tail === 1) return `${n} участник`;
  if (tail >= 2 && tail <= 4) return `${n} участника`;
  return `${n} участников`;
}

function avatarUrl(avatar) {
  if (!avatar) return null;
  if (avatar.startsWith('http')) {
    try {
      return `${BASE_URL}${new URL(avatar).pathname}`;
    } catch {
      return null;
    }
  }
  return `${BASE_URL}/${avatar.replace(/^\/+/, '')}`;
}

export default function ChatJoin() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    chatApi.previewInvite(token)
      .then(({ data }) => { if (!cancelled) setInfo(data); })
      .catch((e) => {
        if (!cancelled) setError(e.response?.data?.error || 'Ссылка недействительна');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  // Переписку открываем на главной: мессенджер и есть домашняя страница
  // портала, и отдельного адреса у чата нет
  const openChat = useCallback((chatId) => {
    navigate('/', { replace: true, state: { openChatId: chatId } });
  }, [navigate]);

  const join = async () => {
    setJoining(true);
    try {
      const { data } = await chatApi.joinByInvite(token);
      toast.success(data.joined ? 'Вы в группе' : 'Вы уже состоите в этой группе');
      openChat(data.chatId);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось вступить');
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="chat-join">
        <div className="chat-join-card"><div className="loading-spinner" /></div>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="chat-join">
        <div className="chat-join-card">
          <div className="chat-join-icon is-dead"><Link2Off size={28} /></div>
          <h1>Ссылка не работает</h1>
          {/* Не уточняем, почему именно: группы могло не быть никогда, а могли
              и отозвать ссылку — по разнице ответов о существовании закрытой
              группы можно было бы узнать, не входя в неё */}
          <p>Приглашение отозвали или срок его действия истёк. Попросите новую ссылку у администратора группы.</p>
          <button className="btn btn-secondary" onClick={() => navigate('/', { replace: true })}>
            К переписке
          </button>
        </div>
      </div>
    );
  }

  const avatar = avatarUrl(info.avatar);

  return (
    <div className="chat-join">
      <div className="chat-join-card">
        <div className="chat-join-avatar">
          {avatar ? <img src={avatar} alt="" /> : <Users size={30} />}
        </div>

        <h1>{info.name || 'Группа'}</h1>
        <p className="chat-join-meta">{memberCountLabel(info.memberCount)}</p>

        {info.isMember ? (
          <>
            <p>Вы уже состоите в этой группе.</p>
            <button className="btn btn-primary" onClick={() => openChat(info.chatId)}>
              Открыть переписку <ArrowRight size={16} />
            </button>
          </>
        ) : (
          <>
            <p>Вас приглашают вступить в группу. Переписка станет видна сразу после вступления.</p>
            <button className="btn btn-primary" disabled={joining} onClick={join}>
              {joining ? 'Вступаем…' : 'Вступить в группу'}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/', { replace: true })}>
              Не сейчас
            </button>
          </>
        )}
      </div>
    </div>
  );
}
