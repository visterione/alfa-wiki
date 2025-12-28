import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MessageCircle, Send, Search, User, CheckCheck, ArrowLeft, UserPlus, Users,
  MoreVertical, LogOut, X, Check, Paperclip, Image, FileText, File, Download
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { chat, users as usersApi, media } from '../services/api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import './Dashboard.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

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
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

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
    setShowChatInfo(false);
    setAttachments([]);
    await loadMessages(chatItem.id);
  };

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    // Limit to 10 files
    if (attachments.length + files.length > 10) {
      toast.error('Максимум 10 файлов');
      return;
    }

    setUploading(true);
    try {
      for (const file of files) {
        // Check file size (max 50MB)
        if (file.size > 50 * 1024 * 1024) {
          toast.error(`Файл ${file.name} слишком большой (макс. 50MB)`);
          continue;
        }

        const { data } = await media.upload(file);
        const attachment = {
          id: data.id,
          name: data.originalName,
          path: data.path,
          thumbnailPath: data.thumbnailPath,
          mimeType: data.mimeType,
          size: data.size,
          url: `${API_URL}/${data.path}`,
          thumbnailUrl: data.thumbnailPath ? `${API_URL}/${data.thumbnailPath}` : null
        };
        setAttachments(prev => [...prev, attachment]);
      }
    } catch (e) {
      toast.error('Ошибка загрузки файла');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if ((!newMessage.trim() && attachments.length === 0) || !activeChat || sending) return;

    setSending(true);
    try {
      const messageType = attachments.length > 0 
        ? (attachments.every(a => a.mimeType?.startsWith('image/')) ? 'image' : 'file')
        : 'text';
      
      await chat.sendMessage(
        activeChat.id, 
        newMessage.trim() || (attachments.length > 0 ? `📎 ${attachments.length} файл(ов)` : ''),
        attachments
      );
      setNewMessage('');
      setAttachments([]);
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

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      toast.error('Введите название группы');
      return;
    }
    if (selectedUsers.length === 0) {
      toast.error('Добавьте хотя бы одного участника');
      return;
    }

    try {
      const { data } = await chat.createGroup(groupName.trim(), selectedUsers.map(u => u.id));
      setShowNewGroup(false);
      setGroupName('');
      setSelectedUsers([]);
      setActiveChat({ ...data, displayName: data.name });
      await loadMessages(data.id);
      await loadChats();
      toast.success('Группа создана');
    } catch (e) {
      toast.error('Ошибка создания группы');
    }
  };

  const handleAddMember = async (targetUser) => {
    if (!activeChat) return;
    try {
      await chat.addMember(activeChat.id, targetUser.id);
      toast.success(`${targetUser.displayName || targetUser.username} добавлен`);
      setShowAddMember(false);
      await loadMessages(activeChat.id);
      await loadChats();
      const updatedChats = await chat.list();
      const updated = updatedChats.data.find(c => c.id === activeChat.id);
      if (updated) setActiveChat(updated);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Ошибка');
    }
  };

  const handleLeaveChat = async () => {
    if (!activeChat) return;
    if (!window.confirm('Покинуть этот чат?')) return;
    
    try {
      await chat.leave(activeChat.id);
      setActiveChat(null);
      setShowChatInfo(false);
      await loadChats();
      toast.success('Вы покинули чат');
    } catch (e) {
      toast.error('Ошибка');
    }
  };

  const toggleUserSelection = (u) => {
    if (selectedUsers.find(s => s.id === u.id)) {
      setSelectedUsers(selectedUsers.filter(s => s.id !== u.id));
    } else {
      setSelectedUsers([...selectedUsers, u]);
    }
  };

  const getAvatarUrl = (avatarPath) => {
    if (!avatarPath) return null;
    if (avatarPath.startsWith('http')) return avatarPath;
    return `${API_URL}/${avatarPath}`;
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (mimeType) => {
    if (mimeType?.startsWith('image/')) return <Image size={20} />;
    if (mimeType?.includes('pdf')) return <FileText size={20} />;
    return <File size={20} />;
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

  const availableUsersToAdd = activeChat?.type === 'group' 
    ? usersList.filter(u => !activeChat.members?.find(m => m.userId === u.id))
    : [];

  // Render message attachments
  const renderAttachments = (msgAttachments, isOwn) => {
    if (!msgAttachments || msgAttachments.length === 0) return null;

    return (
      <div className="message-attachments">
        {msgAttachments.map((att, idx) => {
          const url = att.url || `${API_URL}/${att.path}`;
          const thumbUrl = att.thumbnailUrl || (att.thumbnailPath ? `${API_URL}/${att.thumbnailPath}` : null);
          
          if (att.mimeType?.startsWith('image/')) {
            return (
              <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="attachment-image">
                <img src={thumbUrl || url} alt={att.name} />
              </a>
            );
          }
          
          return (
            <a key={idx} href={url} download={att.name} className={`attachment-file ${isOwn ? 'own' : ''}`}>
              <div className="attachment-file-icon">{getFileIcon(att.mimeType)}</div>
              <div className="attachment-file-info">
                <div className="attachment-file-name">{att.name}</div>
                <div className="attachment-file-size">{formatFileSize(att.size)}</div>
              </div>
              <Download size={18} />
            </a>
          );
        })}
      </div>
    );
  };

  return (
    <div className="dashboard-chat-wrapper">
      <div className="alfa-chat">
        {/* Sidebar */}
        <div className={`chat-sidebar ${activeChat ? 'mobile-hidden' : ''}`}>
          <div className="chat-sidebar-header">
            <h2><MessageCircle size={20} /> Сообщения</h2>
            <div className="chat-sidebar-actions">
              <button 
                className="btn-icon-chat" 
                onClick={() => { setShowNewGroup(true); loadUsers(); setSelectedUsers([]); setGroupName(''); }}
                title="Создать группу"
              >
                <Users size={20} />
              </button>
              <button 
                className="btn-icon-chat" 
                onClick={() => { setShowNewChat(true); loadUsers(); }}
                title="Новый чат"
              >
                <UserPlus size={20} />
              </button>
            </div>
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
                  <div className={`chat-item-avatar ${c.type === 'group' ? 'group' : ''}`}>
                    {c.type === 'group' ? (
                      <Users size={24} />
                    ) : getAvatarUrl(c.avatar) ? (
                      <img src={getAvatarUrl(c.avatar)} alt="" />
                    ) : (
                      <User size={24} />
                    )}
                  </div>
                  <div className="chat-item-content">
                    <div className="chat-item-header">
                      <span className="chat-item-name">{c.displayName}</span>
                      <span className="chat-item-time">{formatTime(c.lastMessageAt)}</span>
                    </div>
                    <div className="chat-item-preview">
                      {c.type === 'group' && <span className="chat-type-badge">Группа · </span>}
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
                <div 
                  className={`chat-main-avatar ${activeChat.type === 'group' ? 'group' : ''}`}
                  onClick={() => activeChat.type === 'group' && setShowChatInfo(true)}
                  style={{ cursor: activeChat.type === 'group' ? 'pointer' : 'default' }}
                >
                  {activeChat.type === 'group' ? (
                    <Users size={24} />
                  ) : getAvatarUrl(activeChat.avatar) ? (
                    <img src={getAvatarUrl(activeChat.avatar)} alt="" />
                  ) : (
                    <User size={24} />
                  )}
                </div>
                <div 
                  className="chat-main-info"
                  onClick={() => activeChat.type === 'group' && setShowChatInfo(true)}
                  style={{ cursor: activeChat.type === 'group' ? 'pointer' : 'default' }}
                >
                  <div className="chat-main-name">{activeChat.displayName}</div>
                  <div className="chat-main-status">
                    {activeChat.type === 'group' 
                      ? `${activeChat.members?.length || 0} участников` 
                      : 'В сети'}
                  </div>
                </div>
                {activeChat.type === 'group' && (
                  <button className="btn-icon-chat" onClick={() => setShowChatInfo(true)}>
                    <MoreVertical size={20} />
                  </button>
                )}
              </div>

              <div className="chat-messages">
                {messages.length > 0 ? (
                  messages.map((msg, idx) => {
                    const isOwn = msg.senderId === user.id;
                    const showAvatar = !isOwn && (idx === 0 || messages[idx-1].senderId !== msg.senderId);
                    
                    if (msg.type === 'system') {
                      return <div key={msg.id} className="message-system">{msg.content}</div>;
                    }
                    
                    const hasAttachments = msg.attachments && msg.attachments.length > 0;
                    const hasText = msg.content && !msg.content.startsWith('📎');
                    
                    return (
                      <div key={msg.id} className={`message ${isOwn ? 'own' : ''}`}>
                        {!isOwn && showAvatar && (
                          <div className="message-avatar">
                            {getAvatarUrl(msg.sender?.avatar) ? (
                              <img src={getAvatarUrl(msg.sender.avatar)} alt="" />
                            ) : (
                              <User size={16} />
                            )}
                          </div>
                        )}
                        <div className={`message-bubble ${!showAvatar && !isOwn ? 'no-avatar' : ''} ${hasAttachments ? 'has-attachments' : ''}`}>
                          {!isOwn && showAvatar && activeChat.type === 'group' && (
                            <div className="message-sender">{msg.sender?.displayName || msg.sender?.username}</div>
                          )}
                          {renderAttachments(msg.attachments, isOwn)}
                          {hasText && <div className="message-content">{msg.content}</div>}
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

              {/* Attachments Preview */}
              {attachments.length > 0 && (
                <div className="attachments-preview">
                  {attachments.map((att, idx) => (
                    <div key={idx} className="attachment-preview-item">
                      {att.mimeType?.startsWith('image/') ? (
                        <img src={att.thumbnailUrl || att.url} alt={att.name} />
                      ) : (
                        <div className="attachment-preview-file">
                          {getFileIcon(att.mimeType)}
                        </div>
                      )}
                      <button className="attachment-remove" onClick={() => removeAttachment(idx)}>
                        <X size={14} />
                      </button>
                      <div className="attachment-preview-name">{att.name}</div>
                    </div>
                  ))}
                </div>
              )}

              <form className="chat-input" onSubmit={handleSendMessage}>
                <input 
                  type="file"
                  ref={fileInputRef}
                  hidden
                  multiple
                  onChange={handleFileSelect}
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
                />
                <button 
                  type="button" 
                  className="btn-icon-chat"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Прикрепить файл"
                >
                  {uploading ? <div className="loading-spinner" style={{width: 20, height: 20}} /> : <Paperclip size={20} />}
                </button>
                <input 
                  placeholder="Введите сообщение..." 
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                />
                <button 
                  type="submit" 
                  className="btn btn-primary btn-icon" 
                  disabled={(!newMessage.trim() && attachments.length === 0) || sending}
                >
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

        {/* Side Panel: Chat Info */}
        {showChatInfo && activeChat?.type === 'group' && (
          <div className="chat-info-panel">
            <div className="chat-info-header">
              <h3>Информация о группе</h3>
              <button className="btn-icon-chat" onClick={() => setShowChatInfo(false)}>
                <X size={20} />
              </button>
            </div>
            
            <div className="chat-info-body">
              <div className="chat-info-avatar">
                <Users size={48} />
              </div>
              <div className="chat-info-name">{activeChat.displayName}</div>
              <div className="chat-info-meta">{activeChat.members?.length || 0} участников</div>

              <div className="chat-info-section">
                <div className="chat-info-section-header">
                  <span>Участники</span>
                  <button 
                    className="btn btn-ghost btn-sm" 
                    onClick={() => { setShowAddMember(true); loadUsers(); }}
                  >
                    <UserPlus size={16} /> Добавить
                  </button>
                </div>
                <div className="chat-info-members">
                  {activeChat.members?.map(m => (
                    <div key={m.id} className="chat-member-item">
                      <div className="chat-member-avatar">
                        {getAvatarUrl(m.user?.avatar) ? (
                          <img src={getAvatarUrl(m.user.avatar)} alt="" />
                        ) : (
                          <User size={18} />
                        )}
                      </div>
                      <div className="chat-member-info">
                        <div className="chat-member-name">
                          {m.user?.displayName || m.user?.username}
                          {m.userId === user.id && <span className="you-badge">Вы</span>}
                        </div>
                        {m.role === 'admin' && <span className="admin-badge">Админ</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="chat-info-actions">
                <button className="btn btn-danger" onClick={handleLeaveChat}>
                  <LogOut size={18} /> Покинуть группу
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal: New Private Chat */}
      {showNewChat && (
        <div className="modal-overlay" onClick={() => setShowNewChat(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Новый чат</h2>
              <button className="btn-icon-chat" onClick={() => setShowNewChat(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="user-list">
                {usersList.length > 0 ? usersList.map(u => (
                  <div key={u.id} className="user-item" onClick={() => handleStartNewChat(u)}>
                    <div className="user-item-avatar">
                      {getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={20} />}
                    </div>
                    <div className="user-item-info">
                      <div className="user-item-name">{u.displayName || u.username}</div>
                      <div className="user-item-username">@{u.username}</div>
                    </div>
                  </div>
                )) : (
                  <div className="empty-state">Нет доступных пользователей</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Group */}
      {showNewGroup && (
        <div className="modal-overlay" onClick={() => setShowNewGroup(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Создать группу</h2>
              <button className="btn-icon-chat" onClick={() => setShowNewGroup(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Название группы</label>
                <input 
                  className="input" 
                  placeholder="Введите название..."
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                />
              </div>

              {selectedUsers.length > 0 && (
                <div className="selected-users">
                  <label className="form-label">Выбрано: {selectedUsers.length}</label>
                  <div className="selected-users-list">
                    {selectedUsers.map(u => (
                      <div key={u.id} className="selected-user-chip">
                        <span>{u.displayName || u.username}</span>
                        <button onClick={() => toggleUserSelection(u)}><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Добавить участников</label>
                <div className="user-list">
                  {usersList.map(u => {
                    const isSelected = selectedUsers.find(s => s.id === u.id);
                    return (
                      <div 
                        key={u.id} 
                        className={`user-item selectable ${isSelected ? 'selected' : ''}`} 
                        onClick={() => toggleUserSelection(u)}
                      >
                        <div className="user-item-avatar">
                          {getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={20} />}
                        </div>
                        <div className="user-item-info">
                          <div className="user-item-name">{u.displayName || u.username}</div>
                          <div className="user-item-username">@{u.username}</div>
                        </div>
                        <div className="user-item-check">
                          {isSelected && <Check size={18} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowNewGroup(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={handleCreateGroup}>
                <Users size={18} /> Создать группу
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Member to Group */}
      {showAddMember && (
        <div className="modal-overlay" onClick={() => setShowAddMember(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Добавить участника</h2>
              <button className="btn-icon-chat" onClick={() => setShowAddMember(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="user-list">
                {availableUsersToAdd.length > 0 ? availableUsersToAdd.map(u => (
                  <div key={u.id} className="user-item" onClick={() => handleAddMember(u)}>
                    <div className="user-item-avatar">
                      {getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={20} />}
                    </div>
                    <div className="user-item-info">
                      <div className="user-item-name">{u.displayName || u.username}</div>
                      <div className="user-item-username">@{u.username}</div>
                    </div>
                  </div>
                )) : (
                  <div className="empty-state">Все пользователи уже в группе</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}