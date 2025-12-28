import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MessageCircle, Send, Search, User, CheckCheck, ArrowLeft, UserPlus
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { chat, users as usersApi } from '../services/api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import './Dashboard.css';

export default function Dashboard() {
  const { user } = useAuth();
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const messagesEndRef = useRef(null);

  const loadChats = useCallback(async () => {
    try {
      const { data } = await chat.list();
      setChats(data);
    } catch (e) {
      console.error('Failed to load chats:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (chatId) => {
    try {
      const { data } = await chat.getMessages(chatId);
      setMessages(data);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  }, []);

  useEffect(() => {
    loadChats();
    const interval = setInterval(() => {
      if (activeChat) loadMessages(activeChat.id);
      loadChats();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadChats, loadMessages, activeChat]);

  const loadUsers = async () => {
    try {
      const { data } = await usersApi.list();
      setUsersList(data.filter(u => u.id !== user.id && u.isActive));
    } catch (e) {
      console.error('Failed to load users:', e);
    }
  };

  const handleSelectChat = async (chatItem) => {
    setActiveChat(chatItem);
    await loadMessages(chatItem.id);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeChat || sending) return;

    setSending(true);
    try {
      await chat.sendMessage(activeChat.id, newMessage.trim());
      setNewMessage('');
      await loadMessages(activeChat.id);
      await loadChats();
    } catch (e) {
      toast.error('Ошибка отправки');
    } finally {
      setSending(false);
    }
  };

  const handleStartNewChat = async (targetUser) => {
    try {
      const { data } = await chat.startPrivate(targetUser.id);
      setShowNewChat(false);
      setActiveChat(data);
      await loadMessages(data.id);
      await loadChats();
    } catch (e) {
      toast.error('Ошибка создания чата');
    }
  };

  const filteredChats = chats.filter(c => 
    c.displayName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatTime = (date) => {
    if (!date) return '';
    const d = new Date(date);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    return isToday ? format(d, 'HH:mm') : format(d, 'd MMM', { locale: ru });
  };

  return (
    <div className="dashboard-chat-wrapper">
      <div className="alfa-chat">
        {/* Sidebar */}
        <div className={`chat-sidebar ${activeChat ? 'mobile-hidden' : ''}`}>
          <div className="chat-sidebar-header">
            <h2><MessageCircle size={20} /> Сообщения</h2>
            <button 
              className="btn-icon-chat" 
              onClick={() => { setShowNewChat(true); loadUsers(); }}
              title="Новый чат"
            >
              <UserPlus size={20} />
            </button>
          </div>
          
          <div className="chat-search">
            <Search size={18} />
            <input 
              placeholder="Поиск..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="chat-list">
            {loading ? (
              <div className="chat-loading"><div className="loading-spinner" /></div>
            ) : filteredChats.length > 0 ? (
              filteredChats.map(c => (
                <div 
                  key={c.id} 
                  className={`chat-item ${activeChat?.id === c.id ? 'active' : ''}`}
                  onClick={() => handleSelectChat(c)}
                >
                  <div className="chat-item-avatar">
                    {c.avatar ? <img src={c.avatar} alt="" /> : <User size={24} />}
                  </div>
                  <div className="chat-item-content">
                    <div className="chat-item-header">
                      <span className="chat-item-name">{c.displayName}</span>
                      <span className="chat-item-time">{formatTime(c.lastMessageAt)}</span>
                    </div>
                    <div className="chat-item-preview">
                      {c.lastMessage || 'Нет сообщений'}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="chat-empty">
                <MessageCircle size={48} />
                <p>Нет чатов</p>
                <button className="btn btn-primary btn-sm" onClick={() => { setShowNewChat(true); loadUsers(); }}>
                  Начать общение
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Main Chat Area */}
        <div className={`chat-main ${activeChat ? 'active' : ''}`}>
          {activeChat ? (
            <>
              <div className="chat-main-header">
                <button className="mobile-back btn-icon-chat" onClick={() => setActiveChat(null)}>
                  <ArrowLeft size={20} />
                </button>
                <div className="chat-main-avatar">
                  {activeChat.avatar ? <img src={activeChat.avatar} alt="" /> : <User size={24} />}
                </div>
                <div className="chat-main-info">
                  <div className="chat-main-name">{activeChat.displayName}</div>
                  <div className="chat-main-status">
                    {activeChat.type === 'group' ? `${activeChat.members?.length || 0} участников` : 'В сети'}
                  </div>
                </div>
              </div>

              <div className="chat-messages">
                {messages.length > 0 ? (
                  messages.map((msg, idx) => {
                    const isOwn = msg.senderId === user.id;
                    const showAvatar = !isOwn && (idx === 0 || messages[idx-1].senderId !== msg.senderId);
                    
                    if (msg.type === 'system') {
                      return <div key={msg.id} className="message-system">{msg.content}</div>;
                    }
                    
                    return (
                      <div key={msg.id} className={`message ${isOwn ? 'own' : ''}`}>
                        {!isOwn && showAvatar && (
                          <div className="message-avatar">
                            {msg.sender?.avatar ? <img src={msg.sender.avatar} alt="" /> : <User size={16} />}
                          </div>
                        )}
                        <div className={`message-bubble ${!showAvatar && !isOwn ? 'no-avatar' : ''}`}>
                          {!isOwn && showAvatar && activeChat.type === 'group' && (
                            <div className="message-sender">{msg.sender?.displayName || msg.sender?.username}</div>
                          )}
                          <div className="message-content">{msg.content}</div>
                          <div className="message-meta">
                            <span className="message-time">{format(new Date(msg.createdAt), 'HH:mm')}</span>
                            {isOwn && (
                              <span className="message-status">
                                <CheckCheck size={14} />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="chat-no-messages">
                    <p>Нет сообщений</p>
                    <span>Напишите первое сообщение</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <form className="chat-input" onSubmit={handleSendMessage}>
                <input 
                  placeholder="Введите сообщение..." 
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                />
                <button type="submit" className="btn btn-primary btn-icon" disabled={!newMessage.trim() || sending}>
                  <Send size={20} />
                </button>
              </form>
            </>
          ) : (
            <div className="chat-placeholder">
              <MessageCircle size={64} />
              <h3>Alfa Чат</h3>
              <p>Выберите чат или начните новый</p>
            </div>
          )}
        </div>
      </div>

      {/* Modal: New Chat */}
      {showNewChat && (
        <div className="modal-overlay" onClick={() => setShowNewChat(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Новый чат</h2>
              <button className="modal-close" onClick={() => setShowNewChat(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="user-list">
                {usersList.length > 0 ? usersList.map(u => (
                  <div key={u.id} className="user-item" onClick={() => handleStartNewChat(u)}>
                    <div className="user-item-avatar">
                      {u.avatar ? <img src={u.avatar} alt="" /> : <User size={20} />}
                    </div>
                    <div className="user-item-info">
                      <div className="user-item-name">{u.displayName || u.username}</div>
                      <div className="user-item-username">@{u.username}</div>
                    </div>
                  </div>
                )) : (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
                    Нет доступных пользователей
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}