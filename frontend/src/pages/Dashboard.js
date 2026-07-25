import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  MessageCircle, Send, Search, User, CheckCheck, ArrowLeft, UserPlus, Users,
  MoreVertical, LogOut, X, Check, Paperclip, Image, FileText, File, Download,
  Camera, UserMinus, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Film, Eye,
  Edit2, Trash2, Smile, Mail, Bot, CornerUpLeft, Pin, PinOff, Pencil, Shield, ShieldOff, VolumeX, Volume2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { chat, users as usersApi, media, BASE_URL } from '../services/api';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import EmojiPicker, { Categories } from 'emoji-picker-react';
import ChatNotification from '../components/ChatNotification';
import MessageReactions from '../components/chat/MessageReactions';
import ReactionMenu from '../components/chat/ReactionMenu';
import ReactionDetailsModal from '../components/chat/ReactionDetailsModal';
import EmailComposeModal from '../components/EmailComposeModal';
import './Dashboard.css';

export default function Dashboard() {
  const { user } = useAuth();
  const { socket, notifications, removeNotification, userStatuses, setMutedChatIds } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  // Время последнего прочтения собеседника (для статуса сообщений)
  const [otherLastReadAt, setOtherLastReadAt] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showEmailCompose, setShowEmailCompose] = useState(false);
  // Мобильное меню действий (заменяет chat-sidebar-header на телефонах)
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [usersList, setUsersList] = useState([]);
  const [botsList, setBotsList] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [addMemberSearchQuery, setAddMemberSearchQuery] = useState('');
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
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, messageId: null, message: null, isOwnMessage: false });
  const [chatContextMenu, setChatContextMenu] = useState({ visible: false, x: 0, y: 0, chatId: null, chat: null });
  const [editingMessage, setEditingMessage] = useState(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const [searchQueryForChat, setSearchQueryForChat] = useState('');
  const [searchMatches, setSearchMatches] = useState([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [reactionMenu, setReactionMenu] = useState(null);
  const [reactionDetailsModal, setReactionDetailsModal] = useState(null);
  const [forwardMode, setForwardMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState([]);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardSearchQuery, setForwardSearchQuery] = useState('');
  const [replyingToMessage, setReplyingToMessage] = useState(null);
  const [showRenameGroup, setShowRenameGroup] = useState(false);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [quickAddRoleFilter, setQuickAddRoleFilter] = useState('');
  const [quickAddMedCenterFilter, setQuickAddMedCenterFilter] = useState('');

  const messagesEndRef = useRef(null);
  const activeChatRef = useRef(null);
  const fileInputRef = useRef(null);
  const avatarInputRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const contextMenuRef = useRef(null);
  const chatContextMenuRef = useRef(null);
  const messageInputRef = useRef(null);
  const draggedPinnedId = useRef(null);
  const dragOverPinnedId = useRef(null);
  const chatMenuRef = useRef(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => { activeChatRef.current = activeChat; }, [activeChat]);

  // На мобильном кнопка «Сообщения» в сайдбаре должна возвращать из открытого
  // чата к списку чатов (на десктопе поведение не меняем — там список и чат видны сразу).
  useEffect(() => {
    const goHome = () => { if (window.innerWidth <= 768) setActiveChat(null); };
    window.addEventListener('messenger-go-home', goHome);
    return () => window.removeEventListener('messenger-go-home', goHome);
  }, []);

  // Закрытие мобильного меню действий по клику вне его
  useEffect(() => {
    if (!showChatMenu) return;
    const onDown = (e) => { if (chatMenuRef.current && !chatMenuRef.current.contains(e.target)) setShowChatMenu(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showChatMenu]);

  const loadChats = useCallback(async () => {
    try {
      const { data } = await chat.list();
      setChats(data);
      setMutedChatIds(data.filter(c => c.isNotificationMuted).map(c => c.id));
    } catch (e) { console.error('Failed to load chats:', e); }
    finally { setLoading(false); }
  }, [setMutedChatIds]);

  const loadMessages = useCallback(async (chatId, shouldScroll = false) => {
    try {
      const { data } = await chat.getMessages(chatId);

      // ✅ ВРЕМЕННАЯ ОТЛАДКА - потом удали
      console.log('=== ВСЕ СООБЩЕНИЯ ===');
      data.forEach(msg => {
        console.log({
          id: msg.id,
          type: msg.type,
          content: msg.content.substring(0, 50),
          senderId: msg.senderId
        });
      });

      setMessages(data);
      if (shouldScroll) {
        setTimeout(scrollToBottom, 100);
      }
      await chat.markAsRead(chatId);
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  }, []);

  const refreshActiveChat = async () => {
    if (!activeChat) return;
    try {
      const { data } = await chat.list();
      const updated = data.find(c => c.id === activeChat.id);
      if (updated) setActiveChat(updated);
    } catch (e) { console.error('Failed to refresh chat:', e); }
  };

  useEffect(() => { loadChats(); loadUsers(); loadBots(); }, [loadChats]);

  // Open specific chat when navigating from a native desktop notification click
  useEffect(() => {
    const openChatId = location.state?.openChatId;
    if (!openChatId || chats.length === 0) return;
    const chatItem = chats.find(c => c.id === openChatId);
    if (chatItem) {
      handleSelectChat(chatItem);
      // Clear state so re-renders don't re-trigger
      navigate('/', { replace: true, state: {} });
    }
  }, [location.state?.openChatId, chats]);

  // Find all matching messages when search query is set
  useEffect(() => {
    if (!searchQueryForChat || messages.length === 0) {
      setSearchMatches([]);
      setCurrentMatchIndex(0);
      setHighlightedMessageId(null);
      return;
    }

    const searchLower = searchQueryForChat.toLowerCase();

    // Ищем ВСЕ сообщения с совпадениями
    const foundMessages = messages.filter(msg => {
      if (msg.type === 'system') return false;

      // Поиск по содержимому
      if (msg.content?.toLowerCase().includes(searchLower)) return true;

      // Поиск по названиям файлов
      if (msg.attachments && msg.attachments.length > 0) {
        return msg.attachments.some(att =>
          att.name?.toLowerCase().includes(searchLower)
        );
      }

      return false;
    });

    setSearchMatches(foundMessages);

    if (foundMessages.length > 0) {
      setCurrentMatchIndex(0);
      setHighlightedMessageId(foundMessages[0].id);

      // Wait for DOM to update, then scroll to first match
      setTimeout(() => {
        const messageElement = document.getElementById(`message-${foundMessages[0].id}`);
        if (messageElement) {
          messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [messages, searchQueryForChat]);

  // Scroll to current match when index changes
  const scrollToMatch = useCallback((index) => {
    if (searchMatches.length === 0) return;

    const match = searchMatches[index];
    if (!match) return;

    setHighlightedMessageId(match.id);
    setCurrentMatchIndex(index);

    setTimeout(() => {
      const messageElement = document.getElementById(`message-${match.id}`);
      if (messageElement) {
        messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
  }, [searchMatches]);

  const goToNextMatch = () => {
    if (searchMatches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
    scrollToMatch(nextIndex);
  };

  const goToPrevMatch = () => {
    if (searchMatches.length === 0) return;
    const prevIndex = currentMatchIndex === 0 ? searchMatches.length - 1 : currentMatchIndex - 1;
    scrollToMatch(prevIndex);
  };

  const closeSearch = () => {
    setSearchQueryForChat('');
    setSearchMatches([]);
    setCurrentMatchIndex(0);
    setHighlightedMessageId(null);
  };

  // Keyboard navigation for search
  useEffect(() => {
    if (searchMatches.length === 0) return;

    const handleKeyDown = (e) => {
      // F3 or Ctrl+G - next match
      if (e.key === 'F3' || (e.ctrlKey && e.key === 'g')) {
        e.preventDefault();
        if (e.shiftKey) {
          goToPrevMatch();
        } else {
          goToNextMatch();
        }
      }
      // Escape - close search
      if (e.key === 'Escape') {
        closeSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchMatches.length, currentMatchIndex]);

  // Listen for new messages from Socket.IO context
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (data) => {
      console.log('New message received in Dashboard:', data);

      // Update chats list
      loadChats();

      // If the message is for the active chat, update messages
      if (activeChatRef.current && data.message.chatId === activeChatRef.current.id) {
        loadMessages(activeChatRef.current.id, true); // Прокручиваем при новом сообщении
      }
      // Note: Notification is handled by SocketContext and shown in Layout
    };

    socket.on('new_message', handleNewMessage);

    const handleReactionUpdate = (data) => {
      if (data.chatId === activeChatRef.current?.id) {
        // Update reactions for the specific message
        setMessages(prev => prev.map(msg =>
          msg.id === data.messageId
            ? { ...msg, reactions: data.reactions }
            : msg
        ));
      }
    };

    socket.on('message_reaction_updated', handleReactionUpdate);

    const handleMessagesRead = (data) => {
      if (data.chatId === activeChatRef.current?.id && data.readBy !== user?.id) {
        setOtherLastReadAt(data.lastReadAt);
      }
    };
    socket.on('messages_read', handleMessagesRead);

    const handleMemberUpdated = ({ chatId, userId, isReadOnly }) => {
      if (activeChatRef.current?.id === chatId) {
        setActiveChat(prev => ({
          ...prev,
          members: prev.members?.map(m => m.userId === userId ? { ...m, isReadOnly } : m)
        }));
        // Если заглушка применена к текущему пользователю
        if (userId === user?.id && isReadOnly) {
          toast('Администратор ограничил вам отправку сообщений', { icon: '🔇' });
        }
      }
    };
    socket.on('member_updated', handleMemberUpdated);

    const handleGroupDeleted = ({ chatId }) => {
      setChats(prev => prev.filter(c => c.id !== chatId));
      if (activeChatRef.current?.id === chatId) {
        setActiveChat(null);
        setShowChatInfo(false);
        setMessages([]);
        toast('Группа была удалена создателем', { icon: 'ℹ️' });
      }
    };
    socket.on('group_deleted', handleGroupDeleted);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('message_reaction_updated', handleReactionUpdate);
      socket.off('messages_read', handleMessagesRead);
      socket.off('group_deleted', handleGroupDeleted);
      socket.off('member_updated', handleMemberUpdated);
    };
  }, [socket, loadChats, loadMessages, user?.id]);

  // Обновляем otherLastReadAt при открытии/смене чата
  useEffect(() => {
    if (!activeChat || !user?.id) {
      setOtherLastReadAt(null);
      return;
    }
    // Берём из данных чата (уже есть otherMemberLastReadAt из бэкенда)
    if (activeChat.otherMemberLastReadAt !== undefined) {
      setOtherLastReadAt(activeChat.otherMemberLastReadAt);
    } else {
      // Fallback: ищем в members
      const other = activeChat.members?.find(m => m.userId !== user.id);
      setOtherLastReadAt(other?.lastReadAt || null);
    }
  }, [activeChat?.id, user?.id]);

  // Polling fallback (reduced frequency since we have Socket.IO)
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeChatRef.current) loadMessages(activeChatRef.current.id, false); // НЕ прокручиваем при автообновлении
      loadChats();
    }, 10000); // Increased from 5s to 10s since Socket.IO handles real-time updates
    return () => clearInterval(interval);
  }, [loadChats, loadMessages]);

  const loadUsers = async () => {
    try {
      const { data } = await chat.getUsers();
      setUsersList(data.filter(u => u.id !== user.id && u.isActive));
    } catch (e) { console.error('Failed to load users:', e); }
  };

  const loadBots = async () => {
    try {
      const { data } = await chat.getBots();
      setBotsList(data);
    } catch (e) { console.error('Failed to load bots:', e); }
  };

  const handleNotificationClick = async (notification) => {
    removeNotification(notification.id);

    // Find the chat in the list
    const chatItem = chats.find(c => c.id === notification.chat.id);
    if (chatItem) {
      await handleSelectChat(chatItem);
    } else {
      // Reload chats if not found
      await loadChats();
      const updatedChats = chats.find(c => c.id === notification.chat.id);
      if (updatedChats) {
        await handleSelectChat(updatedChats);
      }
    }
  };

  const handleSelectChat = async (chatItem, searchTerm = '') => {
    setActiveChat(chatItem);
    setShowChatInfo(false);
    setAttachments([]);
    setEditingMessage(null);
    setReplyingToMessage(null);
    setNewMessage('');
    setSearchQueryForChat(searchTerm);
    setHighlightedMessageId(null);
    await loadMessages(chatItem.id, true); // Прокручиваем при выборе чата
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
      await chat.sendMessage(activeChat.id, newMessage.trim() || '', attachments, replyingToMessage?.id || null);
      setNewMessage('');
      setAttachments([]);
      setReplyingToMessage(null);
      await loadMessages(activeChat.id, true); // Прокручиваем после отправки
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
      await loadMessages(activeChat.id, false); // НЕ прокручиваем после редактирования
      await loadChats();
      toast.success('Сообщение изменено');
    } catch (e) { toast.error('Ошибка редактирования'); }
    finally { setSending(false); }
  };

  const handleDeleteMessage = async (messageId) => {
    if (!window.confirm('Удалить сообщение?')) return;
    try {
      await chat.deleteMessage(activeChat.id, messageId);
      await loadMessages(activeChat.id, false); // НЕ прокручиваем после удаления
      await loadChats();
      toast.success('Сообщение удалено');
    } catch (e) { toast.error('Ошибка удаления'); }
  };

  const handleContextMenu = (e, msg) => {
    e.preventDefault();
    if (msg.type === 'system') return;

    // Открываем единое контекстное меню с реакциями и опциями редактирования/удаления
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      messageId: msg.id,
      message: msg,
      isOwnMessage: msg.senderId === user.id
    });
  };

  // Reactions handlers
  const handleAddReaction = async (messageId, emoji) => {
    try {
      await chat.addReaction(activeChat.id, messageId, emoji);
      setReactionMenu(null);
    } catch (error) {
      console.error('Failed to add reaction:', error);
      toast.error('Не удалось добавить реакцию');
    }
  };

  const handleReactionClick = async (messageId, emoji, hasReacted) => {
    try {
      if (hasReacted) {
        await chat.removeReaction(activeChat.id, messageId);
      } else {
        await chat.addReaction(activeChat.id, messageId, emoji);
      }
    } catch (error) {
      console.error('Failed to toggle reaction:', error);
      toast.error('Ошибка при изменении реакции');
    }
  };

  const handleShowReactionDetails = async (messageId) => {
    try {
      const { data } = await chat.getReactionDetails(activeChat.id, messageId);
      setReactionDetailsModal({ messageId, reactions: data.reactions });
    } catch (error) {
      console.error('Failed to load reaction details:', error);
      toast.error('Не удалось загрузить детали реакций');
    }
  };

  const handleEmojiClick = (emojiData) => {
    setNewMessage(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
    messageInputRef.current?.focus();
  };

  const startEditMessage = (msg) => {
    setEditingMessage(msg);
    setNewMessage(msg.content);
    setContextMenu({ visible: false, x: 0, y: 0, messageId: null, message: null, isOwnMessage: false });
    messageInputRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setNewMessage('');
  };

  const startReply = (msg) => {
    setReplyingToMessage(msg);
    setEditingMessage(null);
    setNewMessage('');
    setContextMenu({ visible: false, x: 0, y: 0, messageId: null, message: null, isOwnMessage: false });
    messageInputRef.current?.focus();
  };

  const cancelReply = () => setReplyingToMessage(null);

  const scrollToMessage = (messageId) => {
    const el = document.getElementById(`message-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMessageId(messageId);
      setTimeout(() => setHighlightedMessageId(null), 2000);
    }
  };

  const startForwardMode = (msg) => {
    setForwardMode(true);
    setSelectedMessages([msg.id]);
    setContextMenu({ visible: false, x: 0, y: 0, messageId: null, message: null, isOwnMessage: false });
  };

  const cancelForwardMode = () => {
    setForwardMode(false);
    setSelectedMessages([]);
  };

  const toggleMessageSelection = (msgId) => {
    if (!forwardMode) return;
    setSelectedMessages(prev =>
      prev.includes(msgId) ? prev.filter(id => id !== msgId) : [...prev, msgId]
    );
  };

  const handleForwardSend = async (targetChatId) => {
    if (selectedMessages.length === 0) return;
    try {
      await chat.forwardMessages(targetChatId, selectedMessages);
      toast.success(`Переслано в чат`);
      setShowForwardModal(false);
      cancelForwardMode();
      // If forwarding to active chat, reload messages
      if (activeChat && targetChatId === activeChat.id) {
        await loadMessages(activeChat.id, true);
      }
      await loadChats();
    } catch (e) {
      toast.error('Ошибка пересылки');
    }
  };

  // Закрытие контекстного меню при клике вне
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu({ visible: false, x: 0, y: 0, messageId: null, message: null, isOwnMessage: false });
      }
      if (chatContextMenuRef.current && !chatContextMenuRef.current.contains(e.target)) {
        setChatContextMenu({ visible: false, x: 0, y: 0, chatId: null, chat: null });
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

  // Корректировка позиции контекстного меню чтобы не выходило за границы экрана
  useEffect(() => {
    if (contextMenu.visible && contextMenuRef.current) {
      const menu = contextMenuRef.current;
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = contextMenu.x;
      let newY = contextMenu.y;

      // Если выходит за правый край - показываем слева от курсора
      if (rect.right > viewportWidth - 10) {
        newX = viewportWidth - rect.width - 10;
      }
      // Если выходит за нижний край - показываем выше
      if (rect.bottom > viewportHeight - 10) {
        newY = viewportHeight - rect.height - 10;
      }

      if (newX !== contextMenu.x || newY !== contextMenu.y) {
        menu.style.left = `${newX}px`;
        menu.style.top = `${newY}px`;
      }
    }
  }, [contextMenu.visible, contextMenu.x, contextMenu.y]);

  const startPrivateChat = async (userId) => {
    try {
      const { data } = await chat.startPrivate(userId);
      await loadChats();
      const fullChat = chats.find(c => c.id === data.id) || { ...data, displayName: usersList.find(u => u.id === userId)?.displayName };
      setActiveChat(fullChat);
      setShowNewChat(false);
      await loadMessages(data.id, true); // Прокручиваем при создании чата
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
      await loadMessages(data.id, true); // Прокручиваем при создании группы
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

  const bulkAddMembersToGroup = async (userIds) => {
    if (!userIds.length) return;
    try {
      const { data } = await chat.bulkAddMembers(activeChat.id, userIds);
      await refreshActiveChat();
      await loadChats();
      setShowAddMember(false);
      toast.success(`Добавлено участников: ${data.added}`);
    } catch (e) { toast.error('Ошибка добавления'); }
  };

  const handleRenameGroup = async () => {
    if (!renameGroupValue.trim()) return;
    try {
      await chat.renameGroup(activeChat.id, renameGroupValue.trim());
      setActiveChat(prev => ({ ...prev, name: renameGroupValue.trim(), displayName: renameGroupValue.trim() }));
      await loadChats();
      setShowRenameGroup(false);
      toast.success('Группа переименована');
    } catch (e) { toast.error('Ошибка переименования'); }
  };

  const removeMemberFromGroup = async (userId) => {
    if (!window.confirm('Удалить участника?')) return;
    try {
      await chat.removeMember(activeChat.id, userId);
      await refreshActiveChat();
      toast.success('Участник удалён');
    } catch (e) { toast.error('Ошибка удаления'); }
  };

  const toggleMemberAdmin = async (userId, currentRole) => {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    const label = newRole === 'admin' ? 'назначить администратором' : 'снять права администратора';
    if (!window.confirm(`Вы уверены, что хотите ${label}?`)) return;
    try {
      await chat.setMemberRole(activeChat.id, userId, newRole);
      await refreshActiveChat();
      toast.success(newRole === 'admin' ? 'Права администратора выданы' : 'Права администратора сняты');
    } catch (e) { toast.error('Ошибка изменения прав'); }
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

  const toggleMemberReadOnly = async (userId, currentVal) => {
    const newVal = !currentVal;
    try {
      await chat.setMemberReadOnly(activeChat.id, userId, newVal);
      setActiveChat(prev => ({
        ...prev,
        members: prev.members.map(m => m.userId === userId ? { ...m, isReadOnly: newVal } : m)
      }));
      toast.success(newVal ? 'Заглушка включена' : 'Заглушка снята');
    } catch (e) { toast.error('Ошибка изменения настройки'); }
  };

  const deleteGroup = async () => {
    if (!window.confirm(`Удалить группу "${activeChat.name || activeChat.displayName}"? Это действие необратимо — чат пропадёт у всех участников.`)) return;
    try {
      await chat.deleteGroup(activeChat.id);
      setActiveChat(null);
      setShowChatInfo(false);
      await loadChats();
      toast.success('Группа удалена');
    } catch (e) { toast.error('Ошибка удаления группы'); }
  };

  const handleChatContextMenu = (e, chatItem) => {
    e.preventDefault();
    e.stopPropagation();

    setChatContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      chatId: chatItem.id,
      chat: chatItem
    });
  };

  const handleHideChat = async () => {
    const { chatId } = chatContextMenu;
    if (!chatId) return;

    setChatContextMenu({ visible: false, x: 0, y: 0, chatId: null, chat: null });

    try {
      await chat.hideChat(chatId, true);

      // Если скрываем активный чат, сбрасываем его
      if (activeChat && activeChat.id === chatId) {
        setActiveChat(null);
      }

      await loadChats();
      toast.success('Чат скрыт');
    } catch (e) {
      console.error('Hide chat error:', e);
      toast.error('Ошибка скрытия чата');
    }
  };

  const handlePinChat = async () => {
    const { chatId, chat: chatItem } = chatContextMenu;
    if (!chatId) return;
    setChatContextMenu({ visible: false, x: 0, y: 0, chatId: null, chat: null });
    try {
      const newPinned = !chatItem.isPinned;
      await chat.pinChat(chatId, newPinned);
      await loadChats();
      toast.success(newPinned ? 'Чат закреплён' : 'Чат откреплён');
    } catch (e) {
      toast.error('Ошибка');
    }
  };

  const handleMuteChat = async () => {
    const { chatId, chat: chatItem } = chatContextMenu;
    if (!chatId) return;
    setChatContextMenu({ visible: false, x: 0, y: 0, chatId: null, chat: null });
    try {
      const newMuted = !chatItem.isNotificationMuted;
      await chat.muteChat(chatId, newMuted);
      await loadChats();
      toast.success(newMuted ? 'Уведомления отключены' : 'Уведомления включены');
    } catch (e) {
      toast.error('Ошибка');
    }
  };

  const handlePinnedDragStart = (e, chatId) => {
    draggedPinnedId.current = chatId;
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.classList.add('dragging');
  };

  const handlePinnedDragOver = (e, chatId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverPinnedId.current = chatId;
  };

  const handlePinnedDrop = async (e, targetChatId) => {
    e.preventDefault();
    const fromId = draggedPinnedId.current;
    if (!fromId || fromId === targetChatId) return;

    const pinnedChats = chats.filter(c => c.isPinned);
    const fromIndex = pinnedChats.findIndex(c => c.id === fromId);
    const toIndex = pinnedChats.findIndex(c => c.id === targetChatId);
    if (fromIndex === -1 || toIndex === -1) return;

    const reordered = [...pinnedChats];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    // Optimistic update
    const newOrder = reordered.map(c => c.id);
    setChats(prev => {
      const nonPinned = prev.filter(c => !c.isPinned);
      const updatedPinned = reordered.map((c, i) => ({ ...c, pinnedOrder: i }));
      return [...updatedPinned, ...nonPinned];
    });

    try {
      await chat.reorderPinnedChats(newOrder);
    } catch (e) {
      await loadChats(); // rollback
    }
  };

  const handlePinnedDragEnd = (e) => {
    draggedPinnedId.current = null;
    dragOverPinnedId.current = null;
    e.currentTarget.classList.remove('dragging');
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      await chat.updateAvatar(activeChat.id, file);
      await refreshActiveChat();
      toast.success('Аватар обновлён');
    } catch (e) { toast.error(e.response?.data?.error || 'Ошибка загрузки'); }
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

  // Поиск по чатам (название чата или содержимое сообщений)
  useEffect(() => {
    const performSearch = async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }

      setSearching(true);
      try {
        // Ищем по содержимому сообщений через API
        const { data } = await chat.search(searchQuery);
        setSearchResults(data);
      } catch (e) {
        console.error('Search error:', e);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    };

    const debounceTimeout = setTimeout(performSearch, 300);
    return () => clearTimeout(debounceTimeout);
  }, [searchQuery]);

  // Фильтруем чаты: если есть поисковый запрос, показываем результаты поиска по сообщениям + фильтр по названию
  const filteredChats = searchQuery.trim()
    ? [
        // Чаты, найденные по содержимому сообщений
        ...searchResults,
        // Чаты, найденные по названию (но не дублируем те, что уже есть в searchResults)
        ...chats.filter(c =>
          c.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) &&
          !searchResults.find(r => r.id === c.id)
        )
      ]
    : chats;

  const uniqueRoles = [...new Set(usersList.map(u => u.role?.name).filter(Boolean))].sort();
  const uniqueMedCenters = [...new Set(usersList.flatMap(u => (u.medCenters || []).map(m => m.name)).filter(Boolean))].sort();

  const matchesQuickFilters = (u) => {
    if (quickAddRoleFilter && u.role?.name !== quickAddRoleFilter) return false;
    if (quickAddMedCenterFilter && !(u.medCenters || []).some(m => m.name === quickAddMedCenterFilter)) return false;
    return true;
  };

  const filteredUsers = usersList.filter(u => {
    const displayName = (u.displayName || u.username || '').toLowerCase();
    return displayName.includes(userSearchQuery.toLowerCase()) && matchesQuickFilters(u);
  });

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

  // Converts markdown [text](url) links and bare https:// URLs to <a> tags.
  // Internal links (starting with /) are handled via data attribute for SPA navigation.
  const linkifyContent = (text) => {
    if (!text) return '';
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Markdown links: [text](url)
    const withMarkdown = escaped.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g,
      (_, label, url) => {
        const isInternal = url.startsWith('/');
        return isInternal
          ? `<a href="${url}" data-internal="1" class="chat-link">${label}</a>`
          : `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link">${label}</a>`;
      }
    );
    // Bare https:// URLs (not already inside an href)
    const withBare = withMarkdown.replace(
      /(?<!href=")(https?:\/\/[^\s<]+)/g,
      (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-link">${url}</a>`
    );
    // Жирный: *текст* → <strong>текст</strong> (без переноса строки внутри)
    const withBold = withBare.replace(
      /\*(\S(?:[^*\n]*\S)?)\*/g,
      '<strong>$1</strong>'
    );
    // Preserve newlines as <br>
    return withBold.replace(/\n/g, '<br>');
  };

  const handleMessageContentClick = (e) => {
    const link = e.target.closest('a[data-internal]');
    if (link) {
      e.preventDefault();
      navigate(link.getAttribute('href'));
    }
  };

  const shouldShowDateSeparator = (currentMsg, previousMsg) => {
    if (!previousMsg) return true;
    const currentDate = new Date(currentMsg.createdAt);
    const previousDate = new Date(previousMsg.createdAt);
    return currentDate.toDateString() !== previousDate.toDateString();
  };

  const availableUsersToAdd = activeChat?.type === 'group'
    ? usersList.filter(u => {
        const isNotMember = !activeChat.members?.find(m => m.userId === u.id);
        const displayName = (u.displayName || u.username || '').toLowerCase();
        const matchesSearch = displayName.includes(addMemberSearchQuery.toLowerCase());
        return isNotMember && matchesSearch && matchesQuickFilters(u);
      })
    : [];

  const availableBotsToAdd = activeChat?.type === 'group'
    ? botsList.filter(b => {
        const isNotMember = !activeChat.members?.find(m => m.userId === b.id);
        const displayName = (b.displayName || b.username || '').toLowerCase();
        const matchesSearch = displayName.includes(addMemberSearchQuery.toLowerCase());
        return isNotMember && matchesSearch;
      })
    : [];
  const fixUrl = (urlOrPath) => getAvatarUrl(urlOrPath);
  const getChatAvatar = (c) => c ? (c.type === 'group' ? c.avatar : c.otherUser?.avatar) : null;
  const isGroupCreator = activeChat?.type === 'group' && activeChat.createdBy === user.id;
  const currentMembership = activeChat?.type === 'group' ? activeChat.members?.find(m => m.userId === user.id) : null;
  const isGroupAdmin = isGroupCreator || currentMembership?.role === 'admin';

  // Форматирование времени последнего визита
  const formatLastSeen = (lastSeenStr) => {
    if (!lastSeenStr) return 'был(а) давно';
    const d = new Date(lastSeenStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'только что';
    if (diffMin < 60) return `был(а) ${diffMin} мин назад`;
    if (isToday(d)) return `был(а) сегодня в ${format(d, 'HH:mm')}`;
    if (isYesterday(d)) return `был(а) вчера в ${format(d, 'HH:mm')}`;
    return `был(а) ${format(d, 'd MMM в HH:mm', { locale: ru })}`;
  };

  // Статус сообщения для own-сообщений в приватных чатах
  const getMsgStatus = (msg) => {
    if (activeChat?.type !== 'private') return 'sent';
    if (otherLastReadAt && new Date(msg.createdAt) <= new Date(otherLastReadAt)) return 'read';
    const otherId = activeChat?.otherUser?.id;
    const st = userStatuses[otherId];
    const otherOnline = activeChat?.otherUser?.isOnline || st?.isOnline;
    const lastSeenTs = st?.lastSeen || activeChat?.otherUser?.lastSeen;
    if (otherOnline || (lastSeenTs && new Date(msg.createdAt) < new Date(lastSeenTs))) return 'delivered';
    return 'sent';
  };

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
              <button className="btn-icon-chat" onClick={() => setShowEmailCompose(true)} title="Email-рассылка"><Mail size={20} /></button>
              <button className="btn-icon-chat" onClick={() => { setShowNewGroup(true); loadUsers(); setSelectedUsers([]); setGroupName(''); setQuickAddRoleFilter(''); setQuickAddMedCenterFilter(''); }} title="Создать группу"><Users size={20} /></button>
              <button className="btn-icon-chat" onClick={() => { setShowNewChat(true); loadUsers(); }} title="Новый чат"><UserPlus size={20} /></button>
            </div>
          </div>
          <div className="chat-search-row">
            <div className="chat-search"><Search size={18} /><input placeholder="Поиск по чатам, сообщениям и файлам..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>
            {/* Мобильное меню действий — заменяет chat-sidebar-header (скрыто на десктопе через CSS) */}
            <div className="chat-search-menu" ref={chatMenuRef}>
              <button type="button" className="btn-icon-chat chat-search-menu-btn" onClick={() => setShowChatMenu(v => !v)} title="Действия" aria-label="Действия"><MoreVertical size={20} /></button>
              {showChatMenu && (
                <div className="chat-search-menu-dropdown">
                  <button type="button" onClick={() => { setShowChatMenu(false); setShowNewChat(true); loadUsers(); }}><UserPlus size={18} /> Новый чат</button>
                  <button type="button" onClick={() => { setShowChatMenu(false); setShowNewGroup(true); loadUsers(); setSelectedUsers([]); setGroupName(''); setQuickAddRoleFilter(''); setQuickAddMedCenterFilter(''); }}><Users size={18} /> Создать группу</button>
                  <button type="button" onClick={() => { setShowChatMenu(false); setShowEmailCompose(true); }}><Mail size={18} /> Email-рассылка</button>
                </div>
              )}
            </div>
          </div>
          <div className="chat-list">
            {(loading || searching) ? <div className="chat-loading"><div className="loading-spinner" /></div> : (() => {
              const renderChatItem = (chatItem, { draggable: isDraggable = false, searchTerm = '' } = {}) => (
                <div
                  key={chatItem.id}
                  className={`chat-item ${activeChat?.id === chatItem.id ? 'active' : ''} ${chatItem.unreadCount > 0 ? 'has-unread' : ''} ${chatItem.isPinned && !searchQuery.trim() ? 'pinned' : ''} ${chatItem.isNotificationMuted ? 'muted' : ''}`}
                  onClick={() => handleSelectChat(chatItem, searchTerm)}
                  onContextMenu={(e) => handleChatContextMenu(e, chatItem)}
                  draggable={isDraggable}
                  onDragStart={isDraggable ? (e) => handlePinnedDragStart(e, chatItem.id) : undefined}
                  onDragOver={isDraggable ? (e) => handlePinnedDragOver(e, chatItem.id) : undefined}
                  onDrop={isDraggable ? (e) => handlePinnedDrop(e, chatItem.id) : undefined}
                  onDragEnd={isDraggable ? handlePinnedDragEnd : undefined}
                >
                  <div className="chat-item-avatar-wrap">
                    <div className="chat-item-avatar">{getChatAvatar(chatItem) ? <img src={getAvatarUrl(getChatAvatar(chatItem))} alt="" /> : (chatItem.type === 'group' ? <Users size={24} /> : <User size={24} />)}</div>
                    {chatItem.type === 'private' && (chatItem.otherUser?.isOnline || userStatuses[chatItem.otherUser?.id]?.isOnline) && (
                      <span className="chat-item-status-dot" />
                    )}
                  </div>
                  <div className="chat-item-content">
                    <div className="chat-item-name">{chatItem.displayName}</div>
                    <div className="chat-item-preview">{chatItem.lastMessage || 'Нет сообщений'}</div>
                  </div>
                  <div className="chat-item-right">
                    <div className="chat-item-time">{formatTime(chatItem.lastMessageAt)}</div>
                    <div className="chat-item-right-meta">
                      {chatItem.isPinned && !searchQuery.trim() && <span className="chat-item-pin-icon"><Pin size={12} /></span>}
                      {chatItem.isNotificationMuted && <span className="chat-item-mute-icon"><VolumeX size={12} /></span>}
                      {chatItem.unreadCount > 0 && <div className="chat-item-unread">{chatItem.unreadCount > 99 ? '99+' : chatItem.unreadCount}</div>}
                    </div>
                  </div>
                </div>
              );

              if (searchQuery.trim()) {
                // В режиме поиска — показываем все результаты без разделения
                if (filteredChats.length === 0) return <div className="chat-empty">Нет чатов</div>;
                return filteredChats.map(chatItem => {
                  const foundByMessage = searchResults.find(r => r.id === chatItem.id);
                  return renderChatItem(chatItem, { searchTerm: foundByMessage ? searchQuery : '' });
                });
              }

              // Обычный режим: закреплённые → разделитель → остальные
              const pinnedChats = chats.filter(c => c.isPinned).sort((a, b) => (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0));
              const regularChats = chats.filter(c => !c.isPinned);

              if (chats.length === 0) return <div className="chat-empty">Нет чатов</div>;

              return (
                <>
                  {pinnedChats.map(chatItem => renderChatItem(chatItem, { draggable: true }))}
                  {pinnedChats.length > 0 && regularChats.length > 0 && (
                    <div className="chat-list-divider"><span>Все чаты</span></div>
                  )}
                  {regularChats.map(chatItem => renderChatItem(chatItem))}
                </>
              );
            })()}
          </div>
        </div>

        <div className={`chat-main ${activeChat ? '' : 'mobile-hidden'}`}>
          {activeChat ? (
            <>
              <div className="chat-main-header">
                <button className="btn-icon-chat mobile-only" onClick={() => setActiveChat(null)}><ArrowLeft size={20} /></button>
                <div className="chat-main-avatar">{getChatAvatar(activeChat) ? <img src={getAvatarUrl(getChatAvatar(activeChat))} alt="" /> : (activeChat.type === 'group' ? <Users size={20} /> : <User size={20} />)}</div>
                <div className="chat-main-info" style={{ cursor: activeChat.type === 'group' ? 'pointer' : 'default' }} onClick={() => activeChat.type === 'group' && setShowChatInfo(true)}>
                  <div className="chat-main-name">{activeChat.displayName}</div>
                  <div className="chat-main-status">
                    {activeChat.type === 'group'
                      ? `${activeChat.members?.length || 0} участников`
                      : (() => {
                          const otherId = activeChat.otherUser?.id;
                          const st = userStatuses[otherId];
                          const isOnline = activeChat.otherUser?.isOnline || st?.isOnline;
                          const lastSeen = st?.lastSeen || activeChat.otherUser?.lastSeen;
                          return isOnline
                            ? <><span className="online-dot" />В сети</>
                            : <span className="last-seen-text">{formatLastSeen(lastSeen)}</span>;
                        })()
                    }
                  </div>
                </div>
                {activeChat.type === 'group' && <button className="btn-icon-chat" onClick={() => setShowChatInfo(true)}><MoreVertical size={20} /></button>}
              </div>
              {searchMatches.length > 0 && (
                <div className="chat-search-bar">
                  <div className="chat-search-info">
                    <Search size={16} />
                    <span>{currentMatchIndex + 1} из {searchMatches.length}</span>
                  </div>
                  <div className="chat-search-controls">
                    <button className="btn-icon-chat sm" onClick={goToPrevMatch} title="Предыдущее"><ChevronLeft size={18} /></button>
                    <button className="btn-icon-chat sm" onClick={goToNextMatch} title="Следующее"><ChevronRight size={18} /></button>
                    <button className="btn-icon-chat sm" onClick={closeSearch} title="Закрыть поиск"><X size={18} /></button>
                  </div>
                </div>
              )}
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
                          className={`message-row ${forwardMode ? 'forward-mode' : ''} ${selectedMessages.includes(msg.id) ? 'selected-for-forward' : ''}`}
                          onClick={() => forwardMode && toggleMessageSelection(msg.id)}
                        >
                          {forwardMode && (
                            <div className={`forward-radio ${selectedMessages.includes(msg.id) ? 'checked' : ''}`} />
                          )}
                          <div
                            id={`message-${msg.id}`}
                            className={`message ${isOwn ? 'own' : ''} ${highlightedMessageId === msg.id ? 'highlighted' : ''}`}
                            onContextMenu={(e) => !forwardMode && handleContextMenu(e, msg)}
                          >
                            {!isOwn && showAvatar && <div className="message-avatar" style={msg.sender?.id ? { cursor: 'pointer' } : {}} onClick={msg.sender?.id ? (e) => { e.stopPropagation(); navigate(`/users/${msg.sender.id}`); } : undefined}>{getAvatarUrl(msg.sender?.avatar) ? <img src={getAvatarUrl(msg.sender.avatar)} alt="" /> : <User size={16} />}</div>}
                            <div className={`message-bubble ${!showAvatar && !isOwn ? 'no-avatar' : ''} ${hasAttachments ? 'has-attachments' : ''}`}>
                              {!isOwn && showAvatar && activeChat.type === 'group' && <div className="message-sender" style={msg.sender?.id ? { cursor: 'pointer' } : {}} onClick={msg.sender?.id ? (e) => { e.stopPropagation(); navigate(`/users/${msg.sender.id}`); } : undefined}>{msg.sender?.displayName || msg.sender?.username}</div>}
                              {msg.replyTo && (
                                <div className="reply-quote" onClick={() => scrollToMessage(msg.replyTo.id)}>
                                  <div className="reply-quote-sender">{msg.replyTo.sender?.displayName || msg.replyTo.sender?.username}</div>
                                  <div className="reply-quote-content">{msg.replyTo.content?.substring(0, 100)}{msg.replyTo.content?.length > 100 ? '...' : ''}</div>
                                </div>
                              )}
                              {msg.forwardedFrom && (
                                <div className="forwarded-from-banner">
                                  <Send size={12} />
                                  <span>Переслано от <strong>{msg.forwardedFrom.senderName}</strong></span>
                                </div>
                              )}
                              {renderAttachments(msg.attachments, isOwn)}
                              {hasText && (
                                <div
                                  className="message-content"
                                  onClick={handleMessageContentClick}
                                  dangerouslySetInnerHTML={{ __html: linkifyContent(msg.content) }}
                                />
                              )}
                              <div className="message-meta">
                                <span className="message-time">{format(new Date(msg.createdAt), 'HH:mm')}</span>
                                {msg.isEdited && <span className="message-edited">изменено</span>}
                                {isOwn && (() => {
                                  const st = getMsgStatus(msg);
                                  const stClass = st === 'read' ? ' message-status--read' : st === 'delivered' ? ' message-status--delivered' : '';
                                  return (
                                    <span className={`message-status${stClass}`}>
                                      {st === 'read'
                                        ? <CheckCheck size={14} />
                                        : <Check size={14} />
                                      }
                                    </span>
                                  );
                                })()}
                              </div>
                              <MessageReactions
                                reactions={msg.reactions}
                                onReactionClick={(emoji, hasReacted) => handleReactionClick(msg.id, emoji, hasReacted)}
                                onShowDetails={() => handleShowReactionDetails(msg.id)}
                              />
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
              {replyingToMessage && !editingMessage && (
                <div className="reply-banner">
                  <div className="reply-banner-info">
                    <CornerUpLeft size={16} />
                    <span>Ответ <strong>{replyingToMessage.sender?.displayName || replyingToMessage.sender?.username || ''}</strong>{replyingToMessage.content ? `: ${replyingToMessage.content.substring(0, 60)}${replyingToMessage.content.length > 60 ? '...' : ''}` : ''}</span>
                  </div>
                  <button onClick={cancelReply}><X size={16} /></button>
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
              {forwardMode && (
                <div className="forward-action-bar">
                  <div className="forward-action-info">
                    <Send size={16} />
                    <span>Выбрано: <strong>{selectedMessages.length}</strong></span>
                  </div>
                  <div className="forward-action-buttons">
                    <button className="btn btn-ghost" onClick={cancelForwardMode}>Отмена</button>
                    <button
                      className="btn btn-primary"
                      disabled={selectedMessages.length === 0}
                      onClick={() => { setForwardSearchQuery(''); setShowForwardModal(true); }}
                    >
                      Переслать <Send size={16} />
                    </button>
                  </div>
                </div>
              )}
              {currentMembership?.isReadOnly ? null : (
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
              )}
              {showEmojiPicker && (
                <div className="emoji-picker-container" ref={emojiPickerRef}>
                  <EmojiPicker
                    onEmojiClick={handleEmojiClick}
                    width="100%"
                    height={350}
                    searchPlaceholder="Поиск эмодзи..."
                    previewConfig={{ showPreview: false }}
                    categories={[
                      { category: Categories.SUGGESTED,       name: 'Часто используемые' },
                      { category: Categories.SMILEYS_PEOPLE,  name: 'Смайлики и люди' },
                      { category: Categories.ANIMALS_NATURE,  name: 'Животные и природа' },
                      { category: Categories.FOOD_DRINK,      name: 'Еда и напитки' },
                      { category: Categories.TRAVEL_PLACES,   name: 'Путешествия и места' },
                      { category: Categories.ACTIVITIES,      name: 'Активности' },
                      { category: Categories.OBJECTS,         name: 'Объекты' },
                      { category: Categories.SYMBOLS,         name: 'Символы' },
                      { category: Categories.FLAGS,           name: 'Флаги' },
                    ]}
                  />
                </div>
              )}
            </>
          ) : <div className="chat-placeholder"><MessageCircle size={64} /><h3>Альфа Чат</h3><p>Выберите чат или начните новый</p></div>}
        </div>

        {showChatInfo && activeChat?.type === 'group' && (
          <div className="chat-info-panel">
            <div className="chat-info-header"><h3>Информация о группе</h3><button className="btn-icon-chat" onClick={() => setShowChatInfo(false)}><X size={20} /></button></div>
            <div className="chat-info-body">
              <div className="chat-info-avatar-wrapper">
                <div className="chat-info-avatar">{getChatAvatar(activeChat) ? <img src={getAvatarUrl(getChatAvatar(activeChat))} alt="" /> : <Users size={48} />}</div>
                {isGroupAdmin && (
                  <div className="chat-info-avatar-actions">
                    <input type="file" ref={avatarInputRef} hidden accept="image/*" onChange={handleAvatarChange} />
                    <button className="btn btn-sm btn-ghost" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>{avatarUploading ? <div className="loading-spinner" style={{width: 16, height: 16}} /> : <Camera size={16} />}{activeChat.avatar ? 'Изменить' : 'Добавить'}</button>
                    {activeChat.avatar && <button className="btn btn-sm btn-ghost text-danger" onClick={handleDeleteAvatar}><X size={16} /> Удалить</button>}
                  </div>
                )}
              </div>
              <div className="chat-info-name" style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                {activeChat.displayName}
                {isGroupAdmin && (
                  <button className="btn-icon-chat sm" title="Переименовать" onClick={() => { setRenameGroupValue(activeChat.name || activeChat.displayName || ''); setShowRenameGroup(true); }}>
                    <Pencil size={14} />
                  </button>
                )}
              </div>
              <div className="chat-info-section">
                <div className="chat-info-section-header"><span>Участники ({activeChat.members?.length || 0})</span>{isGroupAdmin && <button className="btn btn-sm btn-ghost" onClick={() => { setShowAddMember(true); setQuickAddRoleFilter(''); setQuickAddMedCenterFilter(''); loadUsers(); loadBots(); }}><UserPlus size={16} /> Добавить</button>}</div>
                <div className="chat-members-list">
                  {activeChat.members?.map(m => {
                    const isCreatorMember = m.userId === activeChat.createdBy;
                    const isAdminMember = m.role === 'admin';
                    return (
                      <div key={m.userId} className="chat-member-item">
                        <div className="chat-member-avatar" style={m.userId ? { cursor: 'pointer' } : {}} onClick={m.userId ? () => navigate(`/users/${m.userId}`) : undefined}>{getAvatarUrl(m.user?.avatar) ? <img src={getAvatarUrl(m.user.avatar)} alt="" /> : <User size={20} />}</div>
                        <div className="chat-member-info">
                          <div className="chat-member-name" style={m.userId ? { cursor: 'pointer' } : {}} onClick={m.userId ? () => navigate(`/users/${m.userId}`) : undefined}>{m.user?.displayName || m.user?.username}</div>
                          {isCreatorMember && <div className="chat-member-badge" style={{ alignSelf: 'flex-start', marginTop: '2px' }}>Создатель</div>}
                          {!isCreatorMember && isAdminMember && <div className="chat-member-badge" style={{ alignSelf: 'flex-start', marginTop: '2px' }}>Админ</div>}
                        </div>
                        {m.userId !== user.id && (
                          <div className="chat-member-actions">
                            {isGroupAdmin && !isCreatorMember && (
                              <button
                                className={`btn-icon-chat sm${m.isReadOnly ? ' active' : ''}`}
                                title={m.isReadOnly ? 'Снять заглушку' : 'Включить заглушку (только чтение)'}
                                onClick={() => toggleMemberReadOnly(m.userId, m.isReadOnly)}
                                style={m.isReadOnly ? { color: 'var(--primary)' } : {}}
                              >
                                {m.isReadOnly ? <VolumeX size={16} /> : <Volume2 size={16} />}
                              </button>
                            )}
                            {isGroupCreator && !isCreatorMember && (
                              <button
                                className="btn-icon-chat sm"
                                title={isAdminMember ? 'Снять права администратора' : 'Назначить администратором'}
                                onClick={() => toggleMemberAdmin(m.userId, m.role)}
                              >
                                {isAdminMember ? <ShieldOff size={16} /> : <Shield size={16} />}
                              </button>
                            )}
                            {isGroupAdmin && !isCreatorMember && (
                              <button className="btn-icon-chat sm" title="Удалить из группы" onClick={() => removeMemberFromGroup(m.userId)}>
                                <UserMinus size={16} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <button className="btn btn-ghost text-danger" onClick={leaveGroup}><LogOut size={16} /> Покинуть группу</button>
              {isGroupCreator && (
                <button className="btn btn-ghost text-danger" onClick={deleteGroup} style={{ marginTop: '8px' }}><Trash2 size={16} /> Удалить группу</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Context Menu for Messages */}
      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="message-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {/* Реакции */}
          <div className="context-menu-reactions">
            {['👍', '👎', '❤️', '😂', '😮', '🎉', '🔥'].map(emoji => (
              <button
                key={emoji}
                className="context-menu-reaction-btn"
                onClick={() => {
                  handleAddReaction(contextMenu.messageId, emoji);
                  setContextMenu({ visible: false, x: 0, y: 0, messageId: null, message: null, isOwnMessage: false });
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
          {/* Ответить */}
          <div className="context-menu-divider" />
          <button onClick={() => { startReply(contextMenu.message); }}>
            <CornerUpLeft size={16} />
            Ответить
          </button>
          {/* Переслать */}
          <div className="context-menu-divider" />
          <button onClick={() => { startForwardMode(contextMenu.message); }}>
            <Send size={16} />
            Переслать
          </button>
          {/* Опции редактирования/удаления (только для своих сообщений) */}
          {contextMenu.isOwnMessage && (
            <>
              <div className="context-menu-divider" />
              {!contextMenu.message?.forwardedFrom && (
                <button onClick={() => { startEditMessage(contextMenu.message); }}>
                  <Edit2 size={16} />
                  Редактировать
                </button>
              )}
              <button onClick={() => { handleDeleteMessage(contextMenu.messageId); setContextMenu({ visible: false, x: 0, y: 0, messageId: null, message: null, isOwnMessage: false }); }} className="danger">
                <Trash2 size={16} />
                Удалить
              </button>
            </>
          )}
        </div>
      )}

      {/* Context Menu for Chats */}
      {chatContextMenu.visible && (
        <div
          ref={chatContextMenuRef}
          className="message-context-menu"
          style={{ top: chatContextMenu.y, left: chatContextMenu.x }}
        >
          <button onClick={handlePinChat}>
            {chatContextMenu.chat?.isPinned ? <PinOff size={16} /> : <Pin size={16} />}
            {chatContextMenu.chat?.isPinned ? 'Открепить' : 'Закрепить'}
          </button>
          <button onClick={handleMuteChat}>
            {chatContextMenu.chat?.isNotificationMuted ? <Volume2 size={16} /> : <VolumeX size={16} />}
            {chatContextMenu.chat?.isNotificationMuted ? 'Включить уведомления' : 'Заглушить'}
          </button>
          <button onClick={handleHideChat}>
            <X size={16} />
            Удалить чат
          </button>
        </div>
      )}

      {/* Modals */}
      {showNewChat && (
        <div className="modal-overlay" onClick={() => { setShowNewChat(false); setUserSearchQuery(''); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Новый чат</h2><button className="modal-close" onClick={() => { setShowNewChat(false); setUserSearchQuery(''); }}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="chat-search" style={{ marginBottom: '16px' }}>
                <Search size={18} />
                <input
                  placeholder="Поиск по ФИО..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                />
              </div>
              <div className="user-list">
                {filteredUsers.map(u => (
                  <div key={u.id} className="user-item" onClick={() => startPrivateChat(u.id)}>
                    <div className="user-item-avatar">{getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={24} />}</div>
                    <div className="user-item-info"><div className="user-item-name">{u.displayName || u.username}</div><div className="user-item-username">@{u.username}</div></div>
                  </div>
                ))}
                {filteredUsers.length === 0 && <div className="text-muted text-center">Нет пользователей</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {showNewGroup && (
        <div className="modal-overlay" onClick={() => { setShowNewGroup(false); setUserSearchQuery(''); setQuickAddRoleFilter(''); setQuickAddMedCenterFilter(''); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Создать группу</h2><button className="modal-close" onClick={() => { setShowNewGroup(false); setUserSearchQuery(''); setQuickAddRoleFilter(''); setQuickAddMedCenterFilter(''); }}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="form-group"><label className="form-label">Название группы</label><input className="input" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Название группы" /></div>
              <div className="form-group"><label className="form-label">Участники {selectedUsers.length > 0 && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({selectedUsers.length} выбрано)</span>}</label>
                <div className="chat-search" style={{ marginBottom: '8px' }}>
                  <Search size={18} />
                  <input
                    placeholder="Поиск по ФИО..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <select className="input" style={{ flex: 1, minWidth: 0 }} value={quickAddRoleFilter} onChange={e => setQuickAddRoleFilter(e.target.value)}>
                    <option value="">Все роли</option>
                    {uniqueRoles.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select className="input" style={{ flex: 1, minWidth: 0 }} value={quickAddMedCenterFilter} onChange={e => setQuickAddMedCenterFilter(e.target.value)}>
                    <option value="">Все медцентры</option>
                    {uniqueMedCenters.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={() => {
                      const ids = filteredUsers.map(u => u.id);
                      setSelectedUsers(prev => [...new Set([...prev, ...ids])]);
                    }}
                    disabled={filteredUsers.length === 0}
                    title="Выбрать всех подходящих"
                  >
                    <Check size={14} /> Выбрать всех
                  </button>
                </div>
                <div className="user-list">
                  {filteredUsers.map(u => (
                    <div key={u.id} className={`user-item ${selectedUsers.includes(u.id) ? 'selected' : ''}`} onClick={() => toggleUserSelection(u.id)}>
                      <div className="user-item-avatar">{getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={24} />}</div>
                      <div className="user-item-info">
                        <div className="user-item-name">{u.displayName || u.username}</div>
                        <div className="user-item-username">
                          {u.role?.name && <span style={{ marginRight: '6px' }}>{u.role.name}</span>}
                          {(u.medCenters || []).map(m => m.name).join(', ')}
                        </div>
                      </div>
                      {selectedUsers.includes(u.id) && <Check size={20} />}
                    </div>
                  ))}
                  {filteredUsers.length === 0 && <div className="text-muted text-center">Нет пользователей</div>}
                </div>
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-ghost" onClick={() => { setShowNewGroup(false); setUserSearchQuery(''); setQuickAddRoleFilter(''); setQuickAddMedCenterFilter(''); }}>Отмена</button><button className="btn btn-primary" onClick={createGroup} disabled={!groupName.trim() || selectedUsers.length === 0}>Создать</button></div>
          </div>
        </div>
      )}

      {showAddMember && (
        <div className="modal-overlay" onClick={() => { setShowAddMember(false); setAddMemberSearchQuery(''); setQuickAddRoleFilter(''); setQuickAddMedCenterFilter(''); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Добавить участника</h2><button className="modal-close" onClick={() => { setShowAddMember(false); setAddMemberSearchQuery(''); setQuickAddRoleFilter(''); setQuickAddMedCenterFilter(''); }}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="chat-search" style={{ marginBottom: '8px' }}>
                <Search size={18} />
                <input
                  placeholder="Поиск по ФИО..."
                  value={addMemberSearchQuery}
                  onChange={(e) => setAddMemberSearchQuery(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <select className="input" style={{ flex: 1, minWidth: 0 }} value={quickAddRoleFilter} onChange={e => setQuickAddRoleFilter(e.target.value)}>
                  <option value="">Все роли</option>
                  {uniqueRoles.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select className="input" style={{ flex: 1, minWidth: 0 }} value={quickAddMedCenterFilter} onChange={e => setQuickAddMedCenterFilter(e.target.value)}>
                  <option value="">Все медцентры</option>
                  {uniqueMedCenters.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <button
                  className="btn btn-sm btn-primary"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={() => bulkAddMembersToGroup(availableUsersToAdd.map(u => u.id))}
                  disabled={availableUsersToAdd.length === 0}
                  title="Добавить всех подходящих"
                >
                  <UserPlus size={14} /> Добавить всех ({availableUsersToAdd.length})
                </button>
              </div>
              <div className="user-list">
                {availableUsersToAdd.map(u => (
                  <div key={u.id} className="user-item" onClick={() => addMemberToGroup(u.id)}>
                    <div className="user-item-avatar">{getAvatarUrl(u.avatar) ? <img src={getAvatarUrl(u.avatar)} alt="" /> : <User size={24} />}</div>
                    <div className="user-item-info">
                      <div className="user-item-name">{u.displayName || u.username}</div>
                      <div className="user-item-username">
                        {u.role?.name && <span style={{ marginRight: '6px' }}>{u.role.name}</span>}
                        {(u.medCenters || []).map(m => m.name).join(', ')}
                      </div>
                    </div>
                  </div>
                ))}
                {availableBotsToAdd.length > 0 && (
                  <>
                    <div className="user-list-section-title" style={{ padding: '8px 0 4px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Боты</div>
                    {availableBotsToAdd.map(b => (
                      <div key={b.id} className="user-item" onClick={() => addMemberToGroup(b.id)}>
                        <div className="user-item-avatar">{getAvatarUrl(b.avatar) ? <img src={getAvatarUrl(b.avatar)} alt="" /> : <Bot size={24} />}</div>
                        <div className="user-item-info"><div className="user-item-name">{b.displayName || b.username}</div><div className="user-item-username">@{b.username} · бот</div></div>
                      </div>
                    ))}
                  </>
                )}
                {availableUsersToAdd.length === 0 && availableBotsToAdd.length === 0 && <div className="text-muted text-center">Нет доступных пользователей</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {showRenameGroup && (
        <div className="modal-overlay" onClick={() => setShowRenameGroup(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Переименовать группу</h2><button className="modal-close" onClick={() => setShowRenameGroup(false)}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Новое название</label>
                <input
                  className="input"
                  value={renameGroupValue}
                  onChange={e => setRenameGroupValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRenameGroup()}
                  autoFocus
                  placeholder="Название группы"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowRenameGroup(false)}>Отмена</button>
              <button className="btn btn-primary" onClick={handleRenameGroup} disabled={!renameGroupValue.trim()}>Сохранить</button>
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

      {/* Reaction Menu */}
      {reactionMenu && (
        <ReactionMenu
          x={reactionMenu.x}
          y={reactionMenu.y}
          onSelect={(emoji) => handleAddReaction(reactionMenu.messageId, emoji)}
          onClose={() => setReactionMenu(null)}
        />
      )}

      {/* Reaction Details Modal */}
      {reactionDetailsModal && (
        <ReactionDetailsModal
          reactions={reactionDetailsModal.reactions}
          onClose={() => setReactionDetailsModal(null)}
        />
      )}

      {/* Forward Modal */}
      {showForwardModal && (
        <div className="modal-overlay" onClick={() => setShowForwardModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Переслать в чат</h2>
              <button className="modal-close" onClick={() => setShowForwardModal(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="chat-search" style={{ marginBottom: '16px' }}>
                <Search size={18} />
                <input
                  placeholder="Поиск чата..."
                  value={forwardSearchQuery}
                  onChange={e => setForwardSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="user-list">
                {chats
                  .filter(c => c.displayName?.toLowerCase().includes(forwardSearchQuery.toLowerCase()))
                  .map(c => (
                    <div key={c.id} className="user-item" onClick={() => handleForwardSend(c.id)}>
                      <div className="user-item-avatar">
                        {getChatAvatar(c)
                          ? <img src={getAvatarUrl(getChatAvatar(c))} alt="" />
                          : (c.type === 'group' ? <Users size={24} /> : <User size={24} />)}
                      </div>
                      <div className="user-item-info">
                        <div className="user-item-name">{c.displayName}</div>
                        <div className="user-item-username">{c.type === 'group' ? `${c.members?.length || 0} участников` : 'Личный чат'}</div>
                      </div>
                    </div>
                  ))}
                {chats.filter(c => c.displayName?.toLowerCase().includes(forwardSearchQuery.toLowerCase())).length === 0 && (
                  <div className="text-muted text-center">Нет чатов</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Email Compose Modal */}
      {showEmailCompose && (
        <EmailComposeModal onClose={() => setShowEmailCompose(false)} />
      )}

      {/* Chat Notifications - Show only for non-active chats */}
      <div className="chat-notifications-container">
        {notifications
          .filter(n => !activeChat || n.chat.id !== activeChat.id)
          .map(notification => (
            <ChatNotification
              key={notification.id}
              notification={notification}
              onClose={() => removeNotification(notification.id)}
              onClick={() => handleNotificationClick(notification)}
            />
          ))}
      </div>
    </div>
  );
}