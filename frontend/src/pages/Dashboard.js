import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MessageCircle, Send, Search, User, CheckCheck, ArrowLeft, UserPlus, Users,
  MoreVertical, LogOut, X, Check, Paperclip, Image, FileText, File, Download,
  Camera, UserMinus, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Film, Eye,
  Edit2, Trash2, Smile
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { chat, users as usersApi, media, BASE_URL } from '../services/api';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import EmojiPicker from 'emoji-picker-react';
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
  const [videoPreview, setVideoPreview] = useState({ open: false, url: '', name: '' });
  const [pdfPreview, setPdfPreview] = useState({ open: false, url: '', name: '', blobUrl: '' });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, messageId: null, message: null });
  const [editingMessage, setEditingMessage] = useState(null);
  
  const messagesEndRef = useRef(null);
  const activeChatRef = useRef(null);
  const fileInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const contextMenuRef = useRef(null);
  const messageInputRef = useRef(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);

  const loadChats = useCallback(async () => {
    try {
      const { data } = await chat.list();
      setChats(data);
    } catch (e) { console.error('Failed to load chats:', e); }
    finally { setLoading(false); }
  }, []);

  const loadMessages = useCallback(async (chatId) => {
    try {
      const { data } = await chat.getMessages(chatId);
      setMessages(data);
      setTimeout(scrollToBottom, 100);
      await chat.markAsRead(chatId);
    } catch (e) { console.error('Failed to load messages:', e); }
  }, []);

  const refreshActiveChat = async () => {
    if (!activeChat) return;
    try {
      const { data } = await chat.list();
      const updated = data.find(c => c.id === activeChat.id);
      if (updated) setActiveChat(updated);
    } catch (e) { console.error('Failed to refresh chat:', e); }
  };

  useEffect(() => { loadChats(); loadUsers(); }, [loadChats]);

  useEffect(() => {
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
    setEditingMessage(null);
    setNewMessage('');
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
    
    if (editingMessage) {
      await handleEditMessage();
      return;
    }
    
    setSending(true);
    try {
      await chat.sendMessage(activeChat.id, newMessage.trim() || '', attachments);
      setNewMessage('');
      setAttachments([]);
      await loadMessages(activeChat.id);
      await refreshActiveChat();
    } catch (e) { toast.error('Ошибка отправки'); }
    finally { setSending(false); }
  };

  const handleEditMessage = async () => {
    if (!newMessage.trim()) { toast.error('Введите текст сообщения'); return; }
    setSending(true);
    try {
      await chat.editMessage(activeChat.id, editingMessage.id, newMessage.trim());
      setEditingMessage(null);
      setNewMessage('');
      await loadMessages(activeChat.id);
      toast.success('Сообщение изменено');
    } catch (e) { toast.error('Ошибка редактирования'); }
    finally { setSending(false); }
  };

  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm('Удалить сообщение?')) return;
    try {
      await chat.deleteMessage(activeChat.id, messageId);
      await loadMessages(activeChat.id);
      toast.success('Сообщение удалено');
    } catch (e) { toast.error('Ошибка удаления'); }
  };

  const handleContextMenu = (e, msg) => {
    e.preventDefault();
    if (msg.senderId !== user.id || msg.type === 'system') return;
    
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      messageId: msg.id,
      message: msg
    });
  };

  const handleEmojiClick = (emojiData) => {
    setNewMessage(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
    messageInputRef.current?.focus();
  };

  const startEditMessage = (msg) => {
    setEditingMessage(msg);
    setNewMessage(msg.content);
    setContextMenu({ visible: false, x: 0, y: 0, messageId: null, message: null });
    messageInputRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setNewMessage('');
  };

  // Закрытие контекстного меню при клике вне
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu({ visible: false, x: 0, y: 0, messageId: null, message: null });
      }
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target)) {
        const emojiButton = document.querySelector('.emoji-picker-button');
        if (!emojiButton?.contains(e.target)) {
          setShowEmojiPicker(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const startPrivateChat = async (userId) => {
    try {
      const { data } = await chat.startPrivate(userId);
      await loadChats();
      const fullChat = chats.find(c => c.id === data.id) || { ...data, displayName: usersList.find(u => u.id === userId)?.displayName };
      setActiveChat(fullChat);
      setShowNewChat(false);
      await loadMessages(data.id);
    } catch (e) { toast.error('Ошибка создания чата'); }
  };

  const createGroup = async () => {
    if (!groupName.trim()) { toast.error('Введите название группы'); return; }
    try {
      const { data } = await chat.createGroup(groupName, selectedUsers);
      await loadChats();
      setActiveChat(data);
      setShowNewGroup(false);
      setGroupName('');
      setSelectedUsers([]);
      await loadMessages(data.id);
    } catch (e) { toast.error('Ошибка создания группы'); }
  };

  const addMemberToGroup = async (userId) => {
    try {
      await chat.addMember(activeChat.id, userId);
      await refreshActiveChat();
      setShowAddMember(false);
      toast.success('Участник добавлен');
    } catch (e) { toast.error('Ошибка добавления'); }
  };

  const removeMemberFromGroup = async (userId) => {
    if (!window.confirm('Удалить участника?')) return;
    try {
      await chat.removeMember(activeChat.id, userId);
      await refreshActiveChat();
      toast.success('Участник удалён');
    } catch (e) { toast.error('Ошибка удаления'); }
  };

  const leaveGroup = async () => {
    if (!window.confirm('Покинуть группу?')) return;
    try {
      await chat.leave(activeChat.id);
      setActiveChat(null);
      setShowChatInfo(false);
      await loadChats();
      toast.success('Вы покинули группу');
    } catch (e) { toast.error('Ошибка'); }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      await chat.updateAvatar(activeChat.id, file);
      await refreshActiveChat();
      toast.success('Аватар обновлён');
    } catch (e) { toast.error('Ошибка загрузки'); }
    finally { setAvatarUploading(false); if (avatarInputRef.current) avatarInputRef.current.value = ''; }
  };

  const handleDeleteAvatar = async () => {
    try {
      await chat.deleteAvatar(activeChat.id);
      await refreshActiveChat();
      toast.success('Аватар удалён');
    } catch (e) { toast.error('Ошибка удаления'); }
  };

  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };

  const filteredChats = chats.filter(c => c.displayName?.toLowerCase().includes(searchQuery.toLowerCase()));

  const getAvatarUrl = (avatar) => {
    if (!avatar) return null;
    if (avatar.startsWith('http://localhost')) {
      const p = avatar.replace(/^http:\/\/localhost:\d+\//, '');
      return `${BASE_URL}/${p}`;
    }
    if (avatar.startsWith('http')) return avatar;
    return `${BASE_URL}/${avatar}`;
  };

  const getFileIcon = (mime) => {
    if (mime?.startsWith('image/')) return <Image size={20} />;
    if (mime?.startsWith('video/')) return <Film size={20} />;
    if (mime?.includes('pdf')) return <FileText size={20} />;
    return <File size={20} />;
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    return diffDays === 0 ? format(d, 'HH:mm') : format(d, 'd MMM', { locale: ru });
  };

  const formatDateSeparator = (date) => {
    if (isToday(date)) return 'Сегодня';
    if (isYesterday(date)) return 'Вчера';
    if (isThisYear(date)) return format(date, 'd MMMM', { locale: ru });
    return format(date, 'd MMMM yyyy', { locale: ru });
  };

  const shouldShowDateSeparator = (currentMsg, previousMsg) => {
    if (!previousMsg) return true;
    const currentDate = new Date(currentMsg.createdAt);
    const previousDate = new Date(previousMsg.createdAt);
    return currentDate.toDateString() !== previousDate.toDateString();
  };

  const availableUsersToAdd = activeChat?.type === 'group' ? usersList.filter(u => !activeChat.members?.find(m => m.userId === u.id)) : [];
  const fixUrl = (urlOrPath) => getAvatarUrl(urlOrPath);
  const getChatAvatar = (c) => c ? (c.type === 'group' ? c.avatar : c.otherUser?.avatar) : null;
  const isGroupCreator = activeChat?.type === 'group' && activeChat.createdBy === user.id;

  const openLightbox = (images, index) => { setLightboxImages(images); setLightboxIndex(index); setLightboxOpen(true); setLightboxZoom(1); };
  const closeLightbox = () => { setLightboxOpen(false); setLightboxZoom(1); };
  
  const openPdfPreview = async (url, name) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      setPdfPreview({ open: true, url, name, blobUrl });
    } catch (err) {
      toast.error('Ошибка загрузки PDF');
    }
  };
  
  const closePdfPreview = () => {
    if (pdfPreview.blobUrl) {
      URL.revokeObjectURL(pdfPreview.blobUrl);
    }
    setPdfPreview({ open: false, url: '', name: '', blobUrl: '' });
  };

  const downloadFile = async (e, url, filename) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) { toast.error('Ошибка скачивания'); }
  };

  useEffect(() => {
    if (!lightboxOpen && !videoPreview.open && !pdfPreview.open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') { 
        closeLightbox(); 
        setVideoPreview({ open: false, url: '', name: '' }); 
        closePdfPreview(); 
      }
      if (lightboxOpen && e.key === 'ArrowLeft') { 
        setLightboxIndex(i => i > 0 ? i - 1 : lightboxImages.length - 1); 
        setLightboxZoom(1); 
      }
      if (lightboxOpen && e.key === 'ArrowRight') { 
        setLightboxIndex(i => i < lightboxImages.length - 1 ? i + 1 : 0); 
        setLightboxZoom(1); 
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxOpen, lightboxImages.length, videoPreview.open, pdfPreview.open]);

  const renderAttachments = (msgAttachments, isOwn) => {
    if (!msgAttachments || msgAttachments.length === 0) return null;
    const imageAtts = msgAttachments.filter(a => a.mimeType?.startsWith('image/')).map(a => fixUrl(a.url || a.path));
    
    return (
      <div className="message-attachments">
        {msgAttachments.map((att, idx) => {
          const url = fixUrl(att.url || att.path);
          const thumbUrl = fixUrl(att.thumbnailUrl || att.thumbnailPath);
          
          if (att.mimeType?.startsWith('image/')) {
            return (
              <div key={idx} className="attachment-image" onClick={() => openLightbox(imageAtts, imageAtts.indexOf(url))}>
                <img src={thumbUrl || url} alt={att.name} />
              </div>
            );
          }
          
          if (att.mimeType?.startsWith('video/')) {
            return (
              <div 
                key={idx} 
                className={`attachment-video ${isOwn ? 'own' : ''}`}
                onClick={() => setVideoPreview({ open: true, url, name: att.name })}
              >
                <div className="attachment-video-thumb">
                  <Film size={32} />
                  <div className="attachment-video-play">▶</div>
                </div>
                <div className="attachment-file-info">
                  <div className="attachment-file-name">{att.name}</div>
                  <div className="attachment-file-size">{formatFileSize(att.size)}</div>
                </div>
              </div>
            );
          }
          
          if (att.mimeType?.includes('pdf')) {
            return (
              <div 
                key={idx} 
                className={`attachment-file ${isOwn ? 'own' : ''}`}
                onClick={() => openPdfPreview(url, att.name)}
                style={{ cursor: 'pointer' }}
              >
                <div className="attachment-file-icon"><FileText size={20} /></div>
                <div className="attachment-file-info">
                  <div className="attachment-file-name">{att.name}</div>
                  <div className="attachment-file-size">{formatFileSize(att.size)}</div>
                </div>
                <Eye size={18} />
              </div>
            );
          }
          
          return (
            <div 
              key={idx} 
              className={`attachment-file ${isOwn ? 'own' : ''}`}
              onClick={(e) => downloadFile(e, url, att.name)}
              style={{ cursor: 'pointer' }}
            >
              <div className="attachment-file-icon">{getFileIcon(att.mimeType)}</div>
              <div className="attachment-file-info">
                <div className="attachment-file-name">{att.name}</div>
                <div className="attachment-file-size">{formatFileSize(att.size)}</div>
              </div>
              <Download size={18} />
            </div>
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
            {loading ? <div className="chat-loading"><div className="loading-spinner" /></div> : filteredChats.length > 0 ? filteredChats.map(chatItem => (
              <div key={chatItem.id} className={`chat-item ${activeChat?.id === chatItem.id ? 'active' : ''} ${chatItem.unreadCount > 0 ? 'has-unread' : ''}`} onClick={() => handleSelectChat(chatItem)}>
                <div className="chat-item-avatar">{getChatAvatar(chatItem) ? <img src={getAvatarUrl(getChatAvatar(chatItem))} alt="" /> : (chatItem.type === 'group' ? <Users size={24} /> : <User size={24} />)}</div>
                <div className="chat-item-content">
                  <div className="chat-item-header"><div className="chat-item-name">{chatItem.displayName}</div><div className="chat-item-time">{formatTime(chatItem.lastMessageAt)}</div></div>
                  <div className="chat-item-preview">{chatItem.lastMessage || 'Нет сообщений'}</div>
                </div>
                {chatItem.unreadCount > 0 && <div className="chat-item-unread">{chatItem.unreadCount > 99 ? '99+' : chatItem.unreadCount}</div>}
              </div>
            )) : <div className="chat-empty">Нет чатов</div>}
          </div>
        </div>

        <div className="chat-main">
          {activeChat ? (
            <>
              <div className="chat-main-header">
                <button className="btn-icon-chat mobile-only" onClick={() => setActiveChat(null)}><ArrowLeft size={20} /></button>
                <div className="chat-main-avatar">{getChatAvatar(activeChat) ? <img src={getAvatarUrl(getChatAvatar(activeChat))} alt="" /> : (activeChat.type === 'group' ? <Users size={20} /> : <User size={20} />)}</div>
                <div className="chat-main-info" style={{ cursor: activeChat.type === 'group' ? 'pointer' : 'default' }} onClick={() => activeChat.type === 'group' && setShowChatInfo(true)}>
                  <div className="chat-main-name">{activeChat.displayName}</div>
                  <div className="chat-main-status">{activeChat.type === 'group' ? `${activeChat.members?.length || 0} участников` : ''}</div>
                </div>
                {activeChat.type === 'group' && <button className="btn-icon-chat" onClick={() => setShowChatInfo(true)}><MoreVertical size={20} /></button>}
              </div>
              <div className="chat-messages">
                {messages.length > 0 ? messages.map((msg, idx) => {
                  const isOwn = msg.senderId === user.id;
                  const showAvatar = !isOwn && (idx === 0 || messages[idx-1].senderId !== msg.senderId);
                  const showDateSeparator = shouldShowDateSeparator(msg, messages[idx - 1]);
                  
                  const hasAttachments = msg.attachments && msg.attachments.length > 0;
                  const hasText = msg.content && msg.content !== 'Сообщение удалено';
                  
                  return (
                    <React.Fragment key={msg.id}>
                      {showDateSeparator && (
                        <div className="date-separator">
                          <span>{formatDateSeparator(new Date(msg.createdAt))}</span>
                        </div>
                      )}
                      {msg.type === 'system' ? (
                        <div className="message-system">{msg.content}</div>
                      ) : (
                        <div 
                          className={`message ${isOwn ? 'own' : ''}`}
                          onContextMenu={(e) => handleContextMenu(e, msg)}
                        >
                          {!isOwn && showAvatar && <div className="message-avatar">{getAvatarUrl(msg.sender?.avatar) ? <img src={getAvatarUrl(msg.sender.avatar)} alt="" /> : <User size={16} />}</div>}
                          <div className={`message-bubble ${!showAvatar && !isOwn ? 'no-avatar' : ''} ${hasAttachments ? 'has-attachments' : ''}`}>
                            {!isOwn && showAvatar && activeChat.type === 'group' && <div className="message-sender">{msg.sender?.displayName || msg.sender?.username}</div>}
                            {renderAttachments(msg.attachments, isOwn)}
                            {hasText && <div className="message-content">{msg.content}</div>}
                            <div className="message-meta">
                              <span className="message-time">{format(new Date(msg.createdAt), 'HH:mm')}</span>
                              {msg.isEdited && <span className="message-edited">изменено</span>}
                              {isOwn && <span className="message-status"><CheckCheck size={14} /></span>}
                            </div>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
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
              {editingMessage && (
                <div className="editing-message-banner">
                  <div className="editing-message-info">
                    <Edit2 size={16} />
                    <span>Редактирование сообщения</span>
                  </div>
                  <button onClick={cancelEdit}><X size={16} /></button>
                </div>
              )}
              <form className="chat-input" onSubmit={handleSendMessage}>
                <input type="file" ref={fileInputRef} hidden multiple onChange={handleFileSelect} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar" />
                {!editingMessage && (
                  <button type="button" className="btn-icon-chat" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Прикрепить файл">
                    {uploading ? <div className="loading-spinner" style={{width: 20, height: 20}} /> : <Paperclip size={20} />}
                  </button>
                )}
                <div className="chat-input-wrapper">
                  <input 
                    ref={messageInputRef}
                    placeholder={editingMessage ? "Введите новый текст..." : "Введите сообщение..."} 
                    value={newMessage} 
                    onChange={(e) => setNewMessage(e.target.value)} 
                  />
                  <button 
                    type="button" 
                    className="btn-icon-chat emoji-picker-button" 
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    title="Эмодзи"
                  >
                    <Smile size={20} />
                  </button>
                </div>
                <button type="submit" className="btn btn-primary btn-icon" disabled={(!newMessage.trim() && attachments.length === 0) || sending}>
                  <Send size={20} />
                </button>
              </form>
              {showEmojiPicker && (
                <div className="emoji-picker-container" ref={emojiPickerRef}>
                  <EmojiPicker 
                    onEmojiClick={handleEmojiClick}
                    width="100%"
                    height={350}
                    searchPlaceholder="Поиск эмодзи..."
                    previewConfig={{ showPreview: false }}
                  />
                </div>
              )}
            </>
          ) : <div className="chat-placeholder"><MessageCircle size={64} /><h3>Alfa Чат</h3><p>Выберите чат или начните новый</p></div>}
        </div>

        {showChatInfo && activeChat?.type === 'group' && (
          <div className="chat-info-panel">
            <div className="chat-info-header"><h3>Информация о группе</h3><button className="btn-icon-chat" onClick={() => setShowChatInfo(false)}><X size={20} /></button></div>
            <div className="chat-info-body">
              <div className="chat-info-avatar-wrapper">
                <div className="chat-info-avatar">{getChatAvatar(activeChat) ? <img src={getAvatarUrl(getChatAvatar(activeChat))} alt="" /> : <Users size={48} />}</div>
                {isGroupCreator && (
                  <div className="chat-info-avatar-actions">
                    <input type="file" ref={avatarInputRef} hidden accept="image/*" onChange={handleAvatarChange} />
                    <button className="btn btn-sm btn-ghost" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>{avatarUploading ? <div className="loading-spinner" style={{width: 16, height: 16}} /> : <Camera size={16} />}{activeChat.avatar ? 'Изменить' : 'Добавить'}</button>
                    {activeChat.avatar && <button className="btn btn-sm btn-ghost text-danger" onClick={handleDeleteAvatar}><X size={16} /> Удалить</button>}
                  </div>
                )}
              </div>
              <div className="chat-info-name">{activeChat.displayName}</div>
              <div className="chat-info-section">
                <div className="chat-info-section-header"><span>Участники ({activeChat.members?.length || 0})</span>{isGroupCreator && <button className="btn btn-sm btn-ghost" onClick={() => { setShowAddMember(true); loadUsers(); }}><UserPlus size={16} /> Добавить</button>}</div>
                <div className="chat-members-list">
                  {activeChat.members?.map(m => (
                    <div key={m.userId} className="chat-member-item">
                      <div className="chat-member-avatar">{getAvatarUrl(m.user?.avatar) ? <img src={getAvatarUrl(m.user.avatar)} alt="" /> : <User size={20} />}</div>
                      <div className="chat-member-info">
                        <div className="chat-member-name">{m.user?.displayName || m.user?.username}{m.userId === activeChat.createdBy && <span className="chat-member-badge">Создатель</span>}</div>
                      </div>
                      {isGroupCreator && m.userId !== user.id && <button className="btn-icon-chat sm" onClick={() => removeMemberFromGroup(m.userId)}><UserMinus size={16} /></button>}
                    </div>
                  ))}
                </div>
              </div>
              <button className="btn btn-ghost text-danger" onClick={leaveGroup}><LogOut size={16} /> Покинуть группу</button>
            </div>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu.visible && (
        <div 
          ref={contextMenuRef}
          className="message-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button onClick={() => { startEditMessage(contextMenu.message); }}>
            <Edit2 size={16} />
            Редактировать
          </button>
          <button onClick={() => { handleDeleteMessage(contextMenu.messageId); setContextMenu({ visible: false, x: 0, y: 0, messageId: null, message: null }); }} className="danger">
            <Trash2 size={16} />
            Удалить
          </button>
        </div>
      )}

      {/* Modals */}
      {showNewChat && (
        <div className="modal-overlay" onClick={() => setShowNewChat(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Новый чат</h2><button className="modal-close" onClick={() => setShowNewChat(false)}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="user-list">
                {usersList.map(u => (
                  <div key={u.id} className="user-item" onClick={() => startPrivateChat(u.id)}>
                    <div className="user-item-avatar">{getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={24} />}</div>
                    <div className="user-item-info"><div className="user-item-name">{u.displayName || u.username}</div><div className="user-item-username">@{u.username}</div></div>
                  </div>
                ))}
                {usersList.length === 0 && <div className="text-muted text-center">Нет пользователей</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {showNewGroup && (
        <div className="modal-overlay" onClick={() => setShowNewGroup(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Создать группу</h2><button className="modal-close" onClick={() => setShowNewGroup(false)}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="form-group"><label className="form-label">Название группы</label><input className="input" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Название группы" /></div>
              <div className="form-group"><label className="form-label">Участники</label>
                <div className="user-list">
                  {usersList.map(u => (
                    <div key={u.id} className={`user-item ${selectedUsers.includes(u.id) ? 'selected' : ''}`} onClick={() => toggleUserSelection(u.id)}>
                      <div className="user-item-avatar">{getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={24} />}</div>
                      <div className="user-item-info"><div className="user-item-name">{u.displayName || u.username}</div><div className="user-item-username">@{u.username}</div></div>
                      {selectedUsers.includes(u.id) && <Check size={20} />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setShowNewGroup(false)}>Отмена</button><button className="btn btn-primary" onClick={createGroup} disabled={!groupName.trim() || selectedUsers.length === 0}>Создать</button></div>
          </div>
        </div>
      )}

      {showAddMember && (
        <div className="modal-overlay" onClick={() => setShowAddMember(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Добавить участника</h2><button className="modal-close" onClick={() => setShowAddMember(false)}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="user-list">
                {availableUsersToAdd.map(u => (
                  <div key={u.id} className="user-item" onClick={() => addMemberToGroup(u.id)}>
                    <div className="user-item-avatar">{getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={24} />}</div>
                    <div className="user-item-info"><div className="user-item-name">{u.displayName || u.username}</div><div className="user-item-username">@{u.username}</div></div>
                  </div>
                ))}
                {availableUsersToAdd.length === 0 && <div className="text-muted text-center">Нет доступных пользователей</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox для изображений */}
      {lightboxOpen && (
        <div className="lightbox-overlay" onClick={closeLightbox}>
          <button className="lightbox-close" onClick={closeLightbox}><X size={24} /></button>
          {lightboxImages.length > 1 && (
            <>
              <button className="lightbox-prev" onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i > 0 ? i - 1 : lightboxImages.length - 1); setLightboxZoom(1); }}><ChevronLeft size={32} /></button>
              <button className="lightbox-next" onClick={(e) => { e.stopPropagation(); setLightboxIndex(i => i < lightboxImages.length - 1 ? i + 1 : 0); setLightboxZoom(1); }}><ChevronRight size={32} /></button>
            </>
          )}
          <div className="lightbox-controls">
            <button onClick={(e) => { e.stopPropagation(); setLightboxZoom(z => Math.max(0.5, z - 0.25)); }}><ZoomOut size={20} /></button>
            <span>{Math.round(lightboxZoom * 100)}%</span>
            <button onClick={(e) => { e.stopPropagation(); setLightboxZoom(z => Math.min(3, z + 0.25)); }}><ZoomIn size={20} /></button>
            {lightboxImages.length > 1 && <span className="lightbox-counter">{lightboxIndex + 1} / {lightboxImages.length}</span>}
            <button className="lightbox-download" onClick={(e) => { e.stopPropagation(); downloadFile(e, lightboxImages[lightboxIndex], `image-${lightboxIndex + 1}.jpg`); }}><Download size={20} /></button>
          </div>
          <img 
            src={lightboxImages[lightboxIndex]} 
            alt="" 
            onClick={(e) => e.stopPropagation()} 
            style={{ transform: `scale(${lightboxZoom})`, maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', transition: 'transform 0.2s' }} 
          />
        </div>
      )}

      {/* Video Preview */}
      {videoPreview.open && (
        <div className="modal-overlay" onClick={() => setVideoPreview({ open: false, url: '', name: '' })}>
          <div className="media-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="media-preview-header">
              <div className="media-preview-title">{videoPreview.name}</div>
              <div className="media-preview-actions">
                <button onClick={() => setVideoPreview({ open: false, url: '', name: '' })}><X size={20} /></button>
              </div>
            </div>
            <div style={{ padding: 20, background: 'black', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <video controls autoPlay style={{ maxWidth: '100%', maxHeight: 'calc(90vh - 60px)' }}><source src={videoPreview.url} /></video>
            </div>
          </div>
        </div>
      )}

      {/* PDF Preview */}
      {pdfPreview.open && (
        <div className="modal-overlay" onClick={closePdfPreview}>
          <div className="media-preview-modal pdf-modal" onClick={e => e.stopPropagation()}>
            <div className="media-preview-header">
              <div className="media-preview-title">{pdfPreview.name}</div>
              <div className="media-preview-actions">
                <button onClick={(e) => { e.stopPropagation(); downloadFile(e, pdfPreview.url, pdfPreview.name); }}><Download size={20} /></button>
                <button onClick={closePdfPreview}><X size={20} /></button>
              </div>
            </div>
            <embed src={pdfPreview.blobUrl} type="application/pdf" style={{ width: '100%', height: 'calc(100% - 60px)', border: 'none' }} />
          </div>
        </div>
      )}
    </div>
  );
}