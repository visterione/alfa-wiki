import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MessageCircle, Send, Search, User, CheckCheck, ArrowLeft, UserPlus, Users,
  MoreVertical, LogOut, X, Check, Paperclip, Image, FileText, File, Download,
  Camera, UserMinus, ChevronLeft, ChevronRight, ZoomIn, ZoomOut
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { chat, users as usersApi, media, BASE_URL } from '../services/api';
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
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const activeChatRef = useRef(null);

  useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);

  const loadChats = useCallback(async () => {
    try {
      const { data } = await chat.list();
      setChats(data);
    } catch (e) { console.error('Failed to load chats:', e); }
    finally { setLoading(false); }
  }, []);

  const refreshActiveChat = useCallback(async () => {
    if (!activeChatRef.current) return;
    try {
      const { data } = await chat.list();
      setChats(data);
      const updated = data.find(c => c.id === activeChatRef.current.id);
      if (updated) setActiveChat(updated);
    } catch (e) { console.error('Failed to refresh chat:', e); }
  }, []);

  const loadMessages = useCallback(async (chatId) => {
    try {
      const { data } = await chat.getMessages(chatId);
      setMessages(data);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e) { console.error('Failed to load messages:', e); }
  }, []);

  useEffect(() => {
    loadChats();
    const interval = setInterval(() => {
      if (activeChatRef.current) loadMessages(activeChatRef.current.id);
      loadChats();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadChats, loadMessages]);

  const loadUsers = async () => {
    try {
      const { data } = await usersApi.list();
      setUsersList(data.filter(u => u.id !== user.id && u.isActive));
    } catch (e) { console.error('Failed to load users:', e); }
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
    if (attachments.length + files.length > 10) { toast.error('Максимум 10 файлов'); return; }
    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > 50 * 1024 * 1024) { toast.error(`Файл ${file.name} слишком большой`); continue; }
        const { data } = await media.upload(file);
        setAttachments(prev => [...prev, { id: data.id, name: data.originalName, path: data.path, thumbnailPath: data.thumbnailPath, mimeType: data.mimeType, size: data.size }]);
      }
    } catch (e) { toast.error('Ошибка загрузки файла'); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const removeAttachment = (index) => setAttachments(prev => prev.filter((_, i) => i !== index));

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if ((!newMessage.trim() && attachments.length === 0) || !activeChat || sending) return;
    setSending(true);
    try {
      await chat.sendMessage(activeChat.id, newMessage.trim() || '', attachments);
      setNewMessage(''); setAttachments([]);
      await loadMessages(activeChat.id);
      await loadChats();
    } catch (e) { toast.error('Ошибка отправки'); }
    finally { setSending(false); }
  };

  const handleStartNewChat = async (targetUser) => {
    try {
      const { data } = await chat.startPrivate(targetUser.id);
      setShowNewChat(false);
      setActiveChat({ ...data, displayName: targetUser.displayName || targetUser.username, avatar: targetUser.avatar });
      await loadChats(); await loadMessages(data.id);
    } catch (e) { toast.error('Ошибка создания чата'); }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) { toast.error('Введите название группы'); return; }
    try {
      const { data } = await chat.createGroup(groupName.trim(), selectedUsers.map(u => u.id));
      setShowNewGroup(false); setGroupName(''); setSelectedUsers([]);
      setActiveChat({ ...data, displayName: data.name });
      await loadChats(); await loadMessages(data.id);
      toast.success('Группа создана');
    } catch (e) { toast.error('Ошибка создания группы'); }
  };

  const handleAddMember = async (targetUser) => {
    if (!activeChat) return;
    try {
      await chat.addMember(activeChat.id, targetUser.id);
      setShowAddMember(false);
      toast.success('Участник добавлен');
      await refreshActiveChat(); await loadMessages(activeChat.id);
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка'); }
  };

  const handleKickMember = async (memberId) => {
    if (!activeChat || !window.confirm('Исключить участника из группы?')) return;
    try {
      await chat.removeMember(activeChat.id, memberId);
      toast.success('Участник исключён');
      await refreshActiveChat(); await loadMessages(activeChat.id);
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка'); }
  };

  const handleLeaveChat = async () => {
    if (!activeChat || !window.confirm('Покинуть чат?')) return;
    try {
      await chat.leave(activeChat.id);
      setActiveChat(null); setShowChatInfo(false);
      await loadChats();
      toast.success('Вы покинули чат');
    } catch (e) { toast.error('Ошибка'); }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeChat) return;
    if (!file.type.startsWith('image/')) { toast.error('Выберите изображение'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Максимальный размер 5MB'); return; }
    setAvatarUploading(true);
    try {
      const { data } = await chat.updateAvatar(activeChat.id, file);
      setActiveChat(prev => ({ ...prev, avatar: data.avatar }));
      await refreshActiveChat();
      toast.success('Фото группы обновлено');
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка загрузки'); }
    finally { setAvatarUploading(false); if (avatarInputRef.current) avatarInputRef.current.value = ''; }
  };

  const handleDeleteAvatar = async () => {
    if (!activeChat || !window.confirm('Удалить фото группы?')) return;
    try {
      await chat.deleteAvatar(activeChat.id);
      setActiveChat(prev => ({ ...prev, avatar: null }));
      await refreshActiveChat();
      toast.success('Фото группы удалено');
    } catch (e) { toast.error('Ошибка'); }
  };

  const toggleUserSelection = (u) => {
    if (selectedUsers.find(s => s.id === u.id)) setSelectedUsers(selectedUsers.filter(s => s.id !== u.id));
    else setSelectedUsers([...selectedUsers, u]);
  };

  const getAvatarUrl = (avatarPath) => {
    if (!avatarPath) return null;
    if (avatarPath.startsWith('http://localhost')) return `${BASE_URL}/${avatarPath.replace(/^http:\/\/localhost:\d+\//, '')}`;
    if (avatarPath.startsWith('http')) return avatarPath;
    return `${BASE_URL}/${avatarPath}`;
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (mimeType) => {
    if (mimeType?.startsWith('image/')) return <Image size={20} />;
    if (mimeType?.includes('pdf')) return <FileText size={20} />;
    return <File size={20} />;
  };

  const filteredChats = chats.filter(c => c.displayName?.toLowerCase().includes(searchQuery.toLowerCase()));

  const formatTime = (date) => {
    if (!date) return '';
    const d = new Date(date);
    return d.toDateString() === new Date().toDateString() ? format(d, 'HH:mm') : format(d, 'd MMM', { locale: ru });
  };

  const availableUsersToAdd = activeChat?.type === 'group' ? usersList.filter(u => !activeChat.members?.find(m => m.userId === u.id)) : [];
  const fixUrl = (urlOrPath) => getAvatarUrl(urlOrPath);
  const getChatAvatar = (c) => c ? getAvatarUrl(c.avatar) : null;
  const isGroupCreator = activeChat?.type === 'group' && activeChat?.createdBy === user.id;

  const openLightbox = (images, idx = 0) => { setLightboxImages(images); setLightboxIndex(idx); setLightboxZoom(1); setLightboxOpen(true); };
  const closeLightbox = () => { setLightboxOpen(false); setLightboxImages([]); setLightboxIndex(0); setLightboxZoom(1); };

  useEffect(() => {
    const handleKey = (e) => {
      if (!lightboxOpen) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') { setLightboxIndex(i => i > 0 ? i - 1 : lightboxImages.length - 1); setLightboxZoom(1); }
      if (e.key === 'ArrowRight') { setLightboxIndex(i => i < lightboxImages.length - 1 ? i + 1 : 0); setLightboxZoom(1); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxOpen, lightboxImages.length]);

  const renderAttachments = (msgAttachments, isOwn) => {
    if (!msgAttachments || msgAttachments.length === 0) return null;
    const imageAtts = msgAttachments.filter(a => a.mimeType?.startsWith('image/')).map(a => fixUrl(a.url || a.path));
    return (
      <div className="message-attachments">
        {msgAttachments.map((att, idx) => {
          const url = fixUrl(att.url || att.path);
          const thumbUrl = fixUrl(att.thumbnailUrl || att.thumbnailPath);
          if (att.mimeType?.startsWith('image/')) {
            return <div key={idx} className="attachment-image" onClick={() => openLightbox(imageAtts, imageAtts.indexOf(url))}><img src={thumbUrl || url} alt={att.name} /></div>;
          }
          return (
            <a key={idx} href={url} className={`attachment-file ${isOwn ? 'own' : ''}`} onClick={(e) => { e.preventDefault(); const link = document.createElement('a'); link.href = url; link.download = att.name || 'file'; document.body.appendChild(link); link.click(); document.body.removeChild(link); }}>
              <div className="attachment-file-icon">{getFileIcon(att.mimeType)}</div>
              <div className="attachment-file-info"><div className="attachment-file-name">{att.name}</div><div className="attachment-file-size">{formatFileSize(att.size)}</div></div>
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
        <div className={`chat-sidebar ${activeChat ? 'mobile-hidden' : ''}`}>
          <div className="chat-sidebar-header">
            <h2><MessageCircle size={20} /> Сообщения</h2>
            <div className="chat-sidebar-actions">
              <button className="btn-icon-chat" onClick={() => { setShowNewGroup(true); loadUsers(); setSelectedUsers([]); setGroupName(''); }} title="Создать группу"><Users size={20} /></button>
              <button className="btn-icon-chat" onClick={() => { setShowNewChat(true); loadUsers(); }} title="Новый чат"><UserPlus size={20} /></button>
            </div>
          </div>
          <div className="chat-search"><Search size={18} /><input placeholder="Поиск..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>
          <div className="chat-list">
            {loading ? <div className="chat-loading"><div className="loading-spinner" /></div> : filteredChats.length > 0 ? filteredChats.map(c => (
              <div key={c.id} className={`chat-item ${activeChat?.id === c.id ? 'active' : ''}`} onClick={() => handleSelectChat(c)}>
                <div className={`chat-item-avatar ${c.type === 'group' ? 'group' : ''}`}>
                  {getChatAvatar(c) ? <img src={getChatAvatar(c)} alt="" /> : (c.type === 'group' ? <Users size={24} /> : <User size={24} />)}
                </div>
                <div className="chat-item-content">
                  <div className="chat-item-header"><span className="chat-item-name">{c.displayName}</span><span className="chat-item-time">{formatTime(c.lastMessageAt)}</span></div>
                  <div className="chat-item-preview">{c.type === 'group' && <span className="chat-type-badge">Группа · </span>}{c.lastMessage || 'Нет сообщений'}</div>
                </div>
              </div>
            )) : <div className="chat-empty"><MessageCircle size={48} /><p>Нет чатов</p><button className="btn btn-primary btn-sm" onClick={() => { setShowNewChat(true); loadUsers(); }}>Начать общение</button></div>}
          </div>
        </div>

        <div className={`chat-main ${activeChat ? 'active' : ''}`}>
          {activeChat ? (
            <>
              <div className="chat-main-header">
                <button className="mobile-back btn-icon-chat" onClick={() => setActiveChat(null)}><ArrowLeft size={20} /></button>
                <div className={`chat-main-avatar ${activeChat.type === 'group' ? 'group' : ''}`} onClick={() => activeChat.type === 'group' && setShowChatInfo(true)} style={{ cursor: activeChat.type === 'group' ? 'pointer' : 'default' }}>
                  {getChatAvatar(activeChat) ? <img src={getChatAvatar(activeChat)} alt="" /> : (activeChat.type === 'group' ? <Users size={24} /> : <User size={24} />)}
                </div>
                <div className="chat-main-info" onClick={() => activeChat.type === 'group' && setShowChatInfo(true)} style={{ cursor: activeChat.type === 'group' ? 'pointer' : 'default' }}>
                  <div className="chat-main-name">{activeChat.displayName}</div>
                  <div className="chat-main-status">{activeChat.type === 'group' ? `${activeChat.members?.length || 0} участников` : ''}</div>
                </div>
                {activeChat.type === 'group' && <button className="btn-icon-chat" onClick={() => setShowChatInfo(true)}><MoreVertical size={20} /></button>}
              </div>
              <div className="chat-messages">
                {messages.length > 0 ? messages.map((msg, idx) => {
                  const isOwn = msg.senderId === user.id;
                  const showAvatar = !isOwn && (idx === 0 || messages[idx-1].senderId !== msg.senderId);
                  if (msg.type === 'system') return <div key={msg.id} className="message-system">{msg.content}</div>;
                  const hasAttachments = msg.attachments && msg.attachments.length > 0;
                  const hasText = msg.content && !msg.content.startsWith('📎') && !msg.content.startsWith('📷');
                  return (
                    <div key={msg.id} className={`message ${isOwn ? 'own' : ''}`}>
                      {!isOwn && showAvatar && <div className="message-avatar">{getAvatarUrl(msg.sender?.avatar) ? <img src={getAvatarUrl(msg.sender.avatar)} alt="" /> : <User size={16} />}</div>}
                      <div className={`message-bubble ${!showAvatar && !isOwn ? 'no-avatar' : ''} ${hasAttachments ? 'has-attachments' : ''}`}>
                        {!isOwn && showAvatar && activeChat.type === 'group' && <div className="message-sender">{msg.sender?.displayName || msg.sender?.username}</div>}
                        {renderAttachments(msg.attachments, isOwn)}
                        {hasText && <div className="message-content">{msg.content}</div>}
                        <div className="message-meta"><span className="message-time">{format(new Date(msg.createdAt), 'HH:mm')}</span>{isOwn && <span className="message-status"><CheckCheck size={14} /></span>}</div>
                      </div>
                    </div>
                  );
                }) : <div className="chat-no-messages"><p>Нет сообщений</p><span>Напишите первое сообщение</span></div>}
                <div ref={messagesEndRef} />
              </div>
              {attachments.length > 0 && (
                <div className="attachments-preview">
                  {attachments.map((att, idx) => (
                    <div key={idx} className="attachment-preview-item">
                      {att.mimeType?.startsWith('image/') ? <img src={fixUrl(att.thumbnailPath || att.path)} alt={att.name} /> : <div className="attachment-preview-file">{getFileIcon(att.mimeType)}</div>}
                      <button className="attachment-remove" onClick={() => removeAttachment(idx)}><X size={14} /></button>
                      <div className="attachment-preview-name">{att.name}</div>
                    </div>
                  ))}
                </div>
              )}
              <form className="chat-input" onSubmit={handleSendMessage}>
                <input type="file" ref={fileInputRef} hidden multiple onChange={handleFileSelect} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar" />
                <button type="button" className="btn-icon-chat" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Прикрепить файл">{uploading ? <div className="loading-spinner" style={{width: 20, height: 20}} /> : <Paperclip size={20} />}</button>
                <input placeholder="Введите сообщение..." value={newMessage} onChange={(e) => setNewMessage(e.target.value)} />
                <button type="submit" className="btn btn-primary btn-icon" disabled={(!newMessage.trim() && attachments.length === 0) || sending}><Send size={20} /></button>
              </form>
            </>
          ) : <div className="chat-placeholder"><MessageCircle size={64} /><h3>Alfa Чат</h3><p>Выберите чат или начните новый</p></div>}
        </div>

        {showChatInfo && activeChat?.type === 'group' && (
          <div className="chat-info-panel">
            <div className="chat-info-header"><h3>Информация о группе</h3><button className="btn-icon-chat" onClick={() => setShowChatInfo(false)}><X size={20} /></button></div>
            <div className="chat-info-body">
              <div className="chat-info-avatar-wrapper">
                <div className="chat-info-avatar">{getChatAvatar(activeChat) ? <img src={getChatAvatar(activeChat)} alt="" /> : <Users size={48} />}</div>
                {isGroupCreator && (
                  <div className="chat-info-avatar-actions">
                    <input type="file" ref={avatarInputRef} hidden accept="image/*" onChange={handleAvatarChange} />
                    <button className="btn btn-sm btn-ghost" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>{avatarUploading ? <div className="loading-spinner" style={{width: 16, height: 16}} /> : <Camera size={16} />}{activeChat.avatar ? 'Изменить' : 'Добавить фото'}</button>
                    {activeChat.avatar && <button className="btn btn-sm btn-ghost text-danger" onClick={handleDeleteAvatar}><X size={16} /> Удалить</button>}
                  </div>
                )}
              </div>
              <div className="chat-info-name">{activeChat.displayName}</div>
              <div className="chat-info-meta">{activeChat.members?.length || 0} участников</div>
              <div className="chat-info-section">
                <div className="chat-info-section-header"><span>Участники</span>{isGroupCreator && <button className="btn btn-ghost btn-sm" onClick={() => { setShowAddMember(true); loadUsers(); }}><UserPlus size={16} /> Добавить</button>}</div>
                <div className="chat-info-members">
                  {activeChat.members?.map(m => (
                    <div key={m.id} className="chat-member-item">
                      <div className="chat-member-avatar">{getAvatarUrl(m.user?.avatar) ? <img src={getAvatarUrl(m.user.avatar)} alt="" /> : <User size={18} />}</div>
                      <div className="chat-member-info"><div className="chat-member-name">{m.user?.displayName || m.user?.username}{m.userId === user.id && <span className="you-badge">Вы</span>}</div>{m.role === 'admin' && <span className="admin-badge">Админ</span>}</div>
                      {isGroupCreator && m.userId !== user.id && m.role !== 'admin' && <button className="btn-icon-chat btn-kick" onClick={() => handleKickMember(m.userId)} title="Исключить"><UserMinus size={16} /></button>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="chat-info-actions"><button className="btn btn-danger" onClick={handleLeaveChat}><LogOut size={18} /> Покинуть группу</button></div>
            </div>
          </div>
        )}
      </div>

      {lightboxOpen && (
        <div className="lightbox-overlay" onClick={closeLightbox}>
          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <button className="lightbox-close" onClick={closeLightbox}><X size={24} /></button>
            {lightboxImages.length > 1 && (
              <>
                <button className="lightbox-nav lightbox-prev" onClick={() => { setLightboxIndex(i => i > 0 ? i - 1 : lightboxImages.length - 1); setLightboxZoom(1); }}><ChevronLeft size={32} /></button>
                <button className="lightbox-nav lightbox-next" onClick={() => { setLightboxIndex(i => i < lightboxImages.length - 1 ? i + 1 : 0); setLightboxZoom(1); }}><ChevronRight size={32} /></button>
              </>
            )}
            <div className="lightbox-image-wrapper" style={{ transform: `scale(${lightboxZoom})` }}><img src={lightboxImages[lightboxIndex]} alt="" /></div>
            <div className="lightbox-controls">
              <button onClick={() => setLightboxZoom(z => Math.max(0.5, z - 0.25))}><ZoomOut size={20} /></button>
              <span>{Math.round(lightboxZoom * 100)}%</span>
              <button onClick={() => setLightboxZoom(z => Math.min(3, z + 0.25))}><ZoomIn size={20} /></button>
              {lightboxImages.length > 1 && <span className="lightbox-counter">{lightboxIndex + 1} / {lightboxImages.length}</span>}
              <a href={lightboxImages[lightboxIndex]} download className="lightbox-download"><Download size={20} /></a>
            </div>
          </div>
        </div>
      )}

      {showNewChat && (
        <div className="modal-overlay" onClick={() => setShowNewChat(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Новый чат</h2><button className="btn-icon-chat" onClick={() => setShowNewChat(false)}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="user-list">
                {usersList.length > 0 ? usersList.map(u => (
                  <div key={u.id} className="user-item" onClick={() => handleStartNewChat(u)}>
                    <div className="user-item-avatar">{getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={20} />}</div>
                    <div className="user-item-info"><div className="user-item-name">{u.displayName || u.username}</div><div className="user-item-role">{u.role === 'admin' ? 'Администратор' : 'Пользователь'}</div></div>
                  </div>
                )) : <div className="empty-state">Нет доступных пользователей</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {showNewGroup && (
        <div className="modal-overlay" onClick={() => setShowNewGroup(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Создать группу</h2><button className="btn-icon-chat" onClick={() => setShowNewGroup(false)}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Название группы</label>
                <input type="text" className="input" placeholder="Введите название..." value={groupName} onChange={(e) => setGroupName(e.target.value)} />
              </div>
              {selectedUsers.length > 0 && (
                <div className="selected-users">
                  <label className="form-label">Выбранные участники ({selectedUsers.length})</label>
                  <div className="selected-users-list">
                    {selectedUsers.map(u => (
                      <div key={u.id} className="selected-user-chip">
                        {u.displayName || u.username}
                        <button onClick={() => toggleUserSelection(u)}><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Добавить участников</label>
                <div className="user-list">
                  {usersList.map(u => (
                    <div key={u.id} className={`user-item selectable ${selectedUsers.find(s => s.id === u.id) ? 'selected' : ''}`} onClick={() => toggleUserSelection(u)}>
                      <div className="user-item-avatar">{getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={20} />}</div>
                      <div className="user-item-info"><div className="user-item-name">{u.displayName || u.username}</div></div>
                      <div className="user-item-check">{selectedUsers.find(s => s.id === u.id) && <Check size={18} />}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowNewGroup(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={handleCreateGroup} disabled={!groupName.trim()}>Создать</button>
            </div>
          </div>
        </div>
      )}

      {showAddMember && (
        <div className="modal-overlay" onClick={() => setShowAddMember(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Добавить участника</h2><button className="btn-icon-chat" onClick={() => setShowAddMember(false)}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="user-list">
                {availableUsersToAdd.length > 0 ? availableUsersToAdd.map(u => (
                  <div key={u.id} className="user-item" onClick={() => handleAddMember(u)}>
                    <div className="user-item-avatar">{getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={20} />}</div>
                    <div className="user-item-info"><div className="user-item-name">{u.displayName || u.username}</div></div>
                  </div>
                )) : <div className="empty-state">Нет доступных пользователей</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}