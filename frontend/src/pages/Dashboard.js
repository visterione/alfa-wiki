import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  MessageCircle, Send, Search, User, CheckCheck, ArrowLeft, UserPlus, Users,
  MoreVertical, LogOut, X, Check, Paperclip, Image, FileText, File, Download,
  Camera, UserMinus, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Film, Eye,
  Edit2, Trash2, Smile, Mail, Bot, CornerUpLeft, Pin, PinOff, Pencil, Shield, ShieldOff, VolumeX, Volume2, Mic,
  Bold, Italic, Underline, Strikethrough, Code, EyeOff, Link2, BarChart3, PlusCircle,
  CheckCircle, Copy, Clock, AlertCircle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { chat, users as usersApi, media, BASE_URL } from '../services/api';
import ChatInviteModal from './ChatInviteModal';
import { format, isToday, isYesterday, isThisYear } from 'date-fns';
import { ru } from 'date-fns/locale';
import toast from 'react-hot-toast';
import EmojiPicker, { Categories } from 'emoji-picker-react';
import ChatNotification from '../components/ChatNotification';
import MessageReactions from '../components/chat/MessageReactions';
import ReactionMenu from '../components/chat/ReactionMenu';
import ReactionDetailsModal from '../components/chat/ReactionDetailsModal';
import VoiceMessage from '../components/chat/VoiceMessage';
import UserBadge from '../components/chat/UserBadge';
import PollMessage from '../components/chat/PollMessage';
import EmailComposeModal from '../components/EmailComposeModal';
import { renderRichHtml, stripFormatting, toggleMarkup } from '../utils/richText';
import './Dashboard.css';

const formatMemberCount = count => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'участник'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'участника'
    : 'участников';
  return `${count} ${word}`;
};

/**
 * Сколько колонок у альбома вложений.
 *
 * Двойки и четвёрки раскладываются на две колонки — так плитки крупнее и
 * ровно заполняют строки. Всё остальное на три: у пяти и семи снимков ряд
 * всё равно не сойдётся ровно, и выбор между «неполная строка из двух» и
 * «неполная строка из трёх» решается в пользу более мелких плиток — их
 * помещается больше, а ради чего плитка и заводилась.
 */
function albumColumns(count) {
  return count === 2 || count === 4 ? 2 : 3;
}

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
  const [chatCommands, setChatCommands] = useState([]);
  const [commandSelection, setCommandSelection] = useState(0);
  const [mentionTargets, setMentionTargets] = useState([]);
  const [selectedMentions, setSelectedMentions] = useState([]);
  const [mentionSelection, setMentionSelection] = useState(0);
  const [isMessageInputFocused, setIsMessageInputFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  // Запись голосового
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const voiceRecorderRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceTimerRef = useRef(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showChatInfo, setShowChatInfo] = useState(false);
  // Пригласительная ссылка группы (ver. 7.58) — своя модалка, см. ChatInviteModal
  const [showInviteLink, setShowInviteLink] = useState(false);
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
  // Токен доступа к вложениям чата. Живёт сутки, обновляется по таймеру:
  // без него сервер отдаёт по ссылке на файл 401 (см. backend/services/fileAccess.js)
  const [fileToken, setFileToken] = useState(null);
  // Режим выделения. Раньше он назывался forwardMode и умел ровно одно —
  // набрать сообщения для пересылки. Теперь это общий режим: из него можно и
  // переслать, и скопировать, и удалить пачкой (ver. 7.29).
  const [selectionMode, setSelectionMode] = useState(false);
  // Якорь для выделения диапазона по Shift+клику — id последнего отмеченного
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [selectedMessages, setSelectedMessages] = useState([]);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardSearchQuery, setForwardSearchQuery] = useState('');
  const [replyingToMessage, setReplyingToMessage] = useState(null);
  const [showRenameGroup, setShowRenameGroup] = useState(false);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [quickAddRoleFilter, setQuickAddRoleFilter] = useState('');
  const [quickAddMedCenterFilter, setQuickAddMedCenterFilter] = useState('');
  const [showPollEditor, setShowPollEditor] = useState(false);
  /**
   * Меню под скрепкой (ver. 7.58).
   *
   * Опрос переехал сюда с отдельной кнопки. Он нужен раз в месяц, а место в
   * строке ввода занимал постоянно — и только в группах, из-за чего панель у
   * группы и у личной переписки была разной ширины. Заодно так же устроена
   * мобилка: там скрепка давно открывает список «Галерея / Камера / Файл /
   * Опрос», и два клиента перестали расходиться в том, где искать опрос.
   */
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuRef = useRef(null);
  const [pollDraft, setPollDraft] = useState({ question: '', options: ['', ''], multipleChoice: false, anonymous: true });

  // В поле ввода что-то выделено — показываем панель форматирования
  const [hasSelection, setHasSelection] = useState(false);
  // Кнопка под сообщением, которая сейчас выполняется: «<messageId>:<actionId>»
  const [runningAction, setRunningAction] = useState(null);

  const messagesEndRef = useRef(null);
  // Лента истории: до ver. 7.30 веб грузил последние 50 сообщений и на этом
  // всё — до более старых нельзя было добраться вообще никак, хотя в мобилке
  // подгрузка была с самого начала.
  const messagesScrollRef = useRef(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Закреплённые сообщения чата (ver. 7.33). В шапке показывается одно —
  // pinnedIndex говорит какое; по нажатию лента листает их по кругу.
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [pinnedIndex, setPinnedIndex] = useState(0);
  // Галерея чата (ver. 7.35). Данные берутся с сервера, а не из загруженной
  // ленты: раньше «медиа чата» показывало только то, что успело подгрузиться.
  // Позже галерея переехала из отдельной модалки в боковую панель чата и делит
  // её с составом участников — как в Telegram: отдельная кнопка с модалкой на
  // каждый раздел рвала один и тот же экран «о чём этот чат» надвое. infoTab
  // говорит, что открыто сейчас: 'members' | 'media' | 'files' | 'voice' | 'links'.
  const [infoTab, setInfoTab] = useState('members');
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);

  /**
   * Дата, висящая над лентой во время прокрутки (ver. 7.58, как в мобилке).
   *
   * Разделители отвечают на вопрос «где кончился день», но пока пролистываешь
   * месяц переписки, ближайший из них давно уехал за верхний край, и понять,
   * какой день перед глазами, нельзя. Поэтому дата текущего дня дублируется
   * капсулой поверх ленты — и уходит через полторы секунды после того, как
   * прокрутка остановилась, чтобы не закрывать собой сообщения при чтении.
   */
  const [floatingDate, setFloatingDate] = useState('');
  const [floatingDateOn, setFloatingDateOn] = useState(false);
  const floatingDateTimer = useRef(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
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

  useEffect(() => {
    let cancelled = false;
    if (!activeChat?.id) {
      setChatCommands([]);
      return undefined;
    }
    chat.getCommands(activeChat.id)
      .then(({ data }) => { if (!cancelled) setChatCommands(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setChatCommands([]); });
    return () => { cancelled = true; };
  }, [activeChat?.id]);

  useEffect(() => {
    let cancelled = false;
    setSelectedMentions([]);
    if (!activeChat?.id || activeChat.type !== 'group') {
      setMentionTargets([]);
      return undefined;
    }
    chat.getMentionTargets(activeChat.id)
      .then(({ data }) => { if (!cancelled) setMentionTargets(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setMentionTargets([]); });
    return () => { cancelled = true; };
  }, [activeChat?.id, activeChat?.type]);

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

  // Превью сообщения для строки чата — тот же текст, что кладёт сервер в
  // chats.lastMessage. Нужен, чтобы обновлять список без перезагрузки с сервера.
  const pluralMessages = (n) => {
    const tail = n % 100 >= 11 && n % 100 <= 14 ? 0 : n % 10;
    if (tail === 1) return 'сообщение';
    if (tail >= 2 && tail <= 4) return 'сообщения';
    return 'сообщений';
  };

  const messagePreview = (msg) => {
    const text = (msg.content || '').trim();
    if (text) return text;
    const atts = msg.attachments || [];
    if (atts.length === 0) return '';
    if (atts.length === 1 && atts[0]?.kind === 'voice') return '🎤 Голосовое сообщение';
    const suffix = atts.length > 1 ? ` (${atts.length})` : '';
    return atts.every(a => a.mimeType?.startsWith('image/')) ? `📷 Фото${suffix}` : `📎 Файл${suffix}`;
  };

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
      setMessages(data);
      setHasOlderMessages(data.length >= 50);
      if (shouldScroll) {
        setTimeout(scrollToBottom, 100);
      }
      await chat.markAsRead(chatId);
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  }, []);

  // Подгрузка более старых сообщений. Курсор — пара (createdAt, id) самого
  // старого загруженного: одной метки времени мало, сообщения одной
  // миллисекунды на стыке страниц терялись.
  const loadOlderMessages = useCallback(async () => {
    const container = messagesScrollRef.current;
    const oldest = messages[0];
    if (!activeChat || !oldest || loadingOlder || !hasOlderMessages) return;

    setLoadingOlder(true);
    try {
      const { data } = await chat.getMessages(activeChat.id, {
        limit: 50,
        before: oldest.createdAt,
        beforeId: oldest.id
      });
      if (data.length < 50) setHasOlderMessages(false);
      if (data.length === 0) return;

      // Высоту запоминаем до вставки: без поправки лента прыгает на добавленную
      // высоту, и человек оказывается там, откуда только что уехал
      const previousHeight = container?.scrollHeight || 0;
      setMessages(prev => {
        const known = new Set(prev.map(m => m.id));
        return [...data.filter(m => !known.has(m.id)), ...prev];
      });
      requestAnimationFrame(() => {
        if (container) container.scrollTop += container.scrollHeight - previousHeight;
      });
    } catch (e) {
      console.error('Failed to load older messages:', e);
    } finally {
      setLoadingOlder(false);
    }
  }, [activeChat, messages, loadingOlder, hasOlderMessages]);

  /**
   * Какой день сейчас вверху ленты.
   *
   * Считаем по самим разделителям, а не по сообщениям: у разделителя дата уже
   * посчитана и подписана (data-date), а обходить сообщения пришлось бы каждое
   * и заново приводить их createdAt к дню. Разделителей на экране единицы, и
   * цикл по ним дешевле любого другого способа.
   *
   * Берём последний разделитель, ушедший за верхний край: он и открывает тот
   * день, что виден сейчас. Если ни один ещё не ушёл — значит виден самый
   * первый день переписки.
   */
  // Переключили чат — меню закрываем: оно относилось к прошлой переписке,
  // а в личной его и вовсе не рисуют
  useEffect(() => { setAttachMenuOpen(false); }, [activeChat?.id]);

  // Меню закрывается кликом мимо и клавишей Escape — как любое всплывающее
  // окно в портале. Без этого оно оставалось висеть над строкой ввода.
  useEffect(() => {
    if (!attachMenuOpen) return undefined;
    const onDocumentClick = (e) => {
      if (!attachMenuRef.current?.contains(e.target)) setAttachMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setAttachMenuOpen(false); };
    document.addEventListener('mousedown', onDocumentClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [attachMenuOpen]);

  const updateFloatingDate = () => {
    const root = messagesScrollRef.current;
    if (!root) return;
    const separators = root.querySelectorAll('.date-separator');
    if (!separators.length) return;

    const edge = root.getBoundingClientRect().top + 12;
    let current = separators[0];
    for (const separator of separators) {
      if (separator.getBoundingClientRect().top > edge) break;
      current = separator;
    }
    setFloatingDate(current.dataset.date || '');
  };

  const handleMessagesScroll = (e) => {
    if (e.target.scrollTop < 120) loadOlderMessages();

    updateFloatingDate();
    setFloatingDateOn(true);
    clearTimeout(floatingDateTimer.current);
    floatingDateTimer.current = setTimeout(() => setFloatingDateOn(false), 1500);
  };

  useEffect(() => () => clearTimeout(floatingDateTimer.current), []);

  const MEDIA_TABS = [
    { key: 'media', label: 'Медиа' },
    { key: 'files', label: 'Файлы' },
    { key: 'voice', label: 'Голосовые' },
    { key: 'links', label: 'Ссылки' },
  ];

  const loadChatMedia = async (kind, chatId) => {
    setMediaLoading(true);
    setMediaItems([]);
    try {
      const { data } = await chat.getChatMedia(chatId, kind, { limit: 100 });
      // Пока грузили, пользователь мог уйти на другую вкладку или в другой чат —
      // тогда ответ уже не о том, что на экране, и подставлять его нельзя
      if (activeChatRef.current?.id !== chatId) return;
      setMediaItems(data);
    } catch {
      toast.error('Не удалось загрузить');
    } finally {
      setMediaLoading(false);
    }
  };

  // Переход из галереи к самому сообщению. Пока панель стоит рядом с
  // перепиской, закрывать её незачем; на узком экране она лежит поверх чата —
  // там без закрытия результат прыжка просто не увидеть.
  const revealMessageFromInfo = (messageId) => {
    if (window.innerWidth < 1280) setShowChatInfo(false);
    scrollToMessage(messageId);
  };

  const selectInfoTab = (tab) => {
    setInfoTab(tab);
    if (tab === 'members') {
      setMediaItems([]);
      return;
    }
    loadChatMedia(tab, activeChat.id);
  };

  // Единая точка входа в боковую панель: и клик по шапке, и кнопка галереи.
  // Вкладка по умолчанию зависит от типа чата — у группы это состав участников,
  // у переписки один на один участников нет, и первым осмысленным экраном
  // оказывается галерея.
  const openChatInfo = (tab) => {
    setShowChatInfo(true);
    selectInfoTab(tab || (activeChat?.type === 'group' ? 'members' : 'media'));
  };

  const loadPinned = useCallback(async (chatId) => {
    try {
      const { data } = await chat.getPinned(chatId);
      setPinnedMessages(data);
      setPinnedIndex(0);
    } catch { setPinnedMessages([]); }
  }, []);

  // Закрепить может не каждый: в группе — админ, в личной переписке — оба.
  // Те же правила на сервере, в services/messagePermissions.js.
  const canPinHere = () => {
    if (!activeChat) return false;
    if (user.isAdmin) return true;
    if (activeChat.type === 'private') return true;
    return isGroupAdmin;
  };

  const togglePin = async (msg, pin) => {
    try {
      await chat.pinMessage(activeChat.id, msg.id, pin);
      toast.success(pin ? 'Сообщение закреплено' : 'Сообщение откреплено');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось изменить закрепление');
    }
  };

  const refreshActiveChat = async () => {
    if (!activeChat) return;
    try {
      const { data } = await chat.list();
      const updated = data.find(c => c.id === activeChat.id);
      if (updated) setActiveChat(updated);
    } catch (e) { console.error('Failed to refresh chat:', e); }
  };

  useEffect(() => { loadChats(); loadUsers(); loadBots(); }, [loadChats]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const { data } = await chat.getFileToken();
        if (!cancelled) setFileToken(data.token);
      } catch {
        // Молча: без токена не покажутся вложения, но сам чат работает
      }
    };
    refresh();
    // Обновляем заранее, до истечения суток: вкладку мессенджера держат
    // открытой сутками, и просроченный токен ломал бы картинки на ровном месте
    const timer = setInterval(refresh, 6 * 60 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

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

    // Входящее сообщение правит состояние на месте.
    //
    // Раньше здесь стояли loadChats() и loadMessages(): одно сообщение в группе
    // на полсотни человек означало полсотни полных загрузок списка чатов со
    // всеми участниками плюс полсотни перезагрузок истории по пятьдесят
    // сообщений. Всё это ради одной новой строки.
    const handleNewMessage = (data) => {
      const message = data.message;
      if (!message) return;
      const incomingChatId = message.chatId || data.chat?.id;
      const isActive = activeChatRef.current?.id === incomingChatId;

      setChats(prev => {
        // Первое сообщение от нового собеседника — такого чата в списке ещё нет,
        // и собрать его строку из payload нельзя: нет ни участников, ни аватара
        if (!prev.some(c => c.id === incomingChatId)) {
          loadChats();
          return prev;
        }
        return prev.map(c => c.id !== incomingChatId ? c : {
          ...c,
          lastMessage: messagePreview(message),
          lastMessageAt: message.createdAt,
          // Открытый чат читается тут же — счётчик в нём наращивать незачем
          unreadCount: isActive || message.senderId === user?.id
            ? c.unreadCount
            : (c.unreadCount || 0) + 1
        });
      });

      if (isActive) {
        setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, message]);
        setTimeout(scrollToBottom, 50);
        chat.markAsRead(incomingChatId).catch(() => {});
      }
      // Note: Notification is handled by SocketContext and shown in Layout
    };

    socket.on('new_message', handleNewMessage);

    const handleReactionUpdate = (data) => {
      if (data.chatId === activeChatRef.current?.id) {
        // Сервер шлёт один общий список поставивших, «моя ли реакция» считаем
        // здесь: раньше он персонализировал payload и рассылал его каждому
        // участнику отдельно (см. reactionsPayload в backend/routes/chat.js)
        const reactions = (data.reactions || []).map(r => ({
          ...r,
          hasReacted: (r.users || []).some(u => u.id === user?.id)
        }));
        setMessages(prev => prev.map(msg =>
          msg.id === data.messageId ? { ...msg, reactions } : msg
        ));
      }
    };

    socket.on('message_reaction_updated', handleReactionUpdate);

    const handlePollUpdated = ({ chatId, message }) => {
      if (chatId === activeChatRef.current?.id) {
        setMessages(prev => prev.map(msg => msg.id === message.id ? message : msg));
      }
    };
    socket.on('poll_updated', handlePollUpdated);

    // Обычное удаление показывает заглушку; администратор убирает сообщение и
    // ссылки ответов на него целиком у всех, кто держит чат открытым.
    // Удаление всегда стирает сообщение — заглушек «Сообщение удалено» больше
    // нет (ver. 7.29). Разница только в охвате: scope 'all' приходит всем
    // участникам, scope 'me' — только на другие устройства того, кто удалил.
    const handleMessagesDeleted = ({ chatId, messageIds, lastMessage, lastMessageAt }) => {
      const ids = messageIds || [];
      // Превью приходит вместе с событием — пересчитывать его перезагрузкой
      // всего списка чатов не из чего
      if (lastMessage !== undefined) {
        setChats(prev => prev.map(c => c.id === chatId
          ? { ...c, lastMessage, lastMessageAt }
          : c));
      }
      if (chatId === activeChatRef.current?.id) {
        setMessages(prev => prev
          .filter(msg => !ids.includes(msg.id))
          .map(msg => ids.includes(msg.replyTo?.id) ? { ...msg, replyTo: null, replyToId: null } : msg));
        // Удалённое не должно остаться висеть в шапке
        setPinnedMessages(prev => prev.filter(m => !ids.includes(m.id)));
      }
    };
    socket.on('messages_deleted', handleMessagesDeleted);

    // Правку чужого сообщения веб раньше вообще не показывал: сервер такого
    // события не слал, а клиент его не ждал (ver. 7.28)
    const handleMessageEdited = ({ chatId, messageId, content }) => {
      if (chatId !== activeChatRef.current?.id) return;
      setMessages(prev => prev.map(msg =>
        msg.id === messageId ? { ...msg, content, isEdited: true } : msg
      ));
    };
    socket.on('message_edited', handleMessageEdited);

    const handlePinChanged = ({ chatId, messageId, pinned, message }) => {
      if (chatId !== activeChatRef.current?.id) return;
      setPinnedMessages(prev => {
        const without = prev.filter(m => m.id !== messageId);
        // Свежезакреплённое встаёт первым — в шапке всегда последнее закрепление
        return pinned && message ? [message, ...without] : without;
      });
      setPinnedIndex(0);
      setMessages(prev => prev.map(m => m.id === messageId
        ? { ...m, pinnedAt: pinned ? (message?.pinnedAt || new Date().toISOString()) : null }
        : m));
    };
    socket.on('message_pin_changed', handlePinChanged);

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
      socket.off('poll_updated', handlePollUpdated);
      socket.off('messages_deleted', handleMessagesDeleted);
      socket.off('message_edited', handleMessageEdited);
      socket.off('message_pin_changed', handlePinChanged);
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
    setMediaItems([]);
    setAttachments([]);
    setEditingMessage(null);
    setReplyingToMessage(null);
    setNewMessage('');
    setSearchQueryForChat(searchTerm);
    setHighlightedMessageId(null);
    setPinnedMessages([]);
    await loadMessages(chatItem.id, true); // Прокручиваем при выборе чата
    loadPinned(chatItem.id);
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

  // ── Голосовые сообщения ──────────────────────────────────────────────────
  //
  // MediaRecorder в Chrome и Firefox пишет webm/opus, в Safari — mp4/aac.
  // Разбираться в этом клиенту не нужно: что получилось, то и отправляем,
  // а сервер приводит запись к единому формату (backend/services/voiceService.js).
  const startRecording = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      voiceChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) voiceChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        // Дорожку обязательно закрываем, иначе индикатор записи в браузере
        // продолжает гореть и микрофон остаётся занятым
        stream.getTracks().forEach(t => t.stop());
      };

      voiceRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecordSeconds(0);
      voiceTimerRef.current = setInterval(() => {
        setRecordSeconds(prev => {
          if (prev >= 300) { stopRecording(true); return prev; }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      toast.error('Нет доступа к микрофону');
    }
  };

  const finishRecording = (send) => {
    const recorder = voiceRecorderRef.current;
    if (!recorder) return;
    if (voiceTimerRef.current) { clearInterval(voiceTimerRef.current); voiceTimerRef.current = null; }

    const handleStop = async () => {
      const chunks = voiceChunksRef.current;
      voiceChunksRef.current = [];
      voiceRecorderRef.current = null;
      setRecording(false);

      if (!send || chunks.length === 0) { setRecordSeconds(0); return; }

      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      // Меньше секунды — почти всегда случайный тап, а не сообщение
      if (blob.size < 1200) { setRecordSeconds(0); return; }

      try {
        setSending(true);
        const ext = (recorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
        const { data: att } = await chat.uploadVoice(blob, `voice.${ext}`, recordSeconds);
        await chat.sendMessage(activeChat.id, '', [att], replyingToMessage?.id || null);
        setReplyingToMessage(null);
        loadMessages(activeChat.id, true);
        loadChats();
      } catch (err) {
        toast.error('Не удалось отправить голосовое');
      } finally {
        setSending(false);
        setRecordSeconds(0);
      }
    };

    recorder.addEventListener('stop', handleStop, { once: true });
    if (recorder.state !== 'inactive') recorder.stop();
    else handleStop();
  };

  const stopRecording = (send = true) => finishRecording(send);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if ((!newMessage.trim() && attachments.length === 0) || !activeChat || sending) return;
    
    if (editingMessage) {
      await handleEditMessage();
      return;
    }
    
    // Оптимистичная отправка (ver. 7.34): сообщение появляется в ленте сразу,
    // с часиками вместо галочки, и подменяется ответом сервера. Раньше между
    // нажатием и появлением строки был поход на сервер, и на плохой связи
    // казалось, что нажатие не сработало — люди отправляли повторно.
    const payload = {
      content: newMessage.trim() || '',
      attachments,
      replyToId: replyingToMessage?.id || null,
      mentions: selectedMentions.filter(item => newMessage.includes(`@${item.label}`)),
    };
    const optimistic = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chatId: activeChat.id,
      senderId: user.id,
      content: payload.content,
      type: payload.attachments.length > 0
        ? (payload.attachments.every(a => a.mimeType?.startsWith('image/')) ? 'image' : 'file')
        : 'text',
      attachments: payload.attachments,
      createdAt: new Date().toISOString(),
      sender: { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, chatBadge: user.chatBadge },
      replyTo: replyingToMessage || null,
      replyToId: payload.replyToId,
      reactions: [],
      pending: true,
      draft: payload,
    };

    setMessages(prev => [...prev, optimistic]);
    setNewMessage('');
    setSelectedMentions([]);
    setAttachments([]);
    setReplyingToMessage(null);
    setChats(prev => prev.map(c => c.id !== activeChat.id ? c : {
      ...c,
      lastMessage: messagePreview(optimistic),
      lastMessageAt: optimistic.createdAt
    }));
    setTimeout(scrollToBottom, 50);

    await deliverMessage(activeChat.id, optimistic);
  };

  // Собственно доставка. Вынесена отдельно, потому что тем же путём идёт
  // повторная попытка по кнопке «повторить» у неудавшегося сообщения.
  const deliverMessage = async (chatId, optimistic) => {
    const { content, attachments: files, replyToId, mentions } = optimistic.draft;
    try {
      const { data: sent } = await chat.sendMessage(chatId, content, files, replyToId, mentions);
      setMessages(prev => prev.map(m => m.id === optimistic.id ? sent : m));
      setChats(prev => prev.map(c => c.id !== chatId ? c : {
        ...c,
        lastMessage: messagePreview(sent),
        lastMessageAt: sent.createdAt
      }));
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === optimistic.id
        ? { ...m, pending: false, failed: true }
        : m));
      toast.error('Сообщение не отправлено');
    }
  };

  const retrySend = async (msg) => {
    if (!msg.draft) return;
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, failed: false, pending: true } : m));
    await deliverMessage(msg.chatId, msg);
  };

  const createPoll = async () => {
    const options = pollDraft.options.map(value => value.trim()).filter(Boolean);
    if (!pollDraft.question.trim() || options.length < 2) {
      toast.error('Укажите вопрос и минимум два варианта ответа');
      return;
    }
    try {
      const { data } = await chat.createPoll(activeChat.id, { ...pollDraft, question: pollDraft.question.trim(), options });
      setMessages(prev => [...prev, data]);
      setShowPollEditor(false);
      setPollDraft({ question: '', options: ['', ''], multipleChoice: false, anonymous: true });
      await refreshActiveChat();
    } catch (e) { toast.error(e.response?.data?.error || 'Не удалось создать опрос'); }
  };

  const votePoll = async (messageId, optionIds) => {
    try {
      const { data } = await chat.votePoll(activeChat.id, messageId, optionIds);
      setMessages(prev => prev.map(msg => msg.id === messageId ? data : msg));
    } catch (e) { toast.error(e.response?.data?.error || 'Не удалось сохранить голос'); }
  };

  const handleEditMessage = async () => {
    if (!newMessage.trim()) { toast.error('Введите текст сообщения'); return; }
    setSending(true);
    try {
      const { data: edited } = await chat.editMessage(activeChat.id, editingMessage.id, newMessage.trim());
      setEditingMessage(null);
      setNewMessage('');
      // Обновление состояния асинхронно, поэтому «было ли оно последним»
      // спрашиваем у messages текущего рендера, а не изнутри setMessages
      const wasLast = messages[messages.length - 1]?.id === edited.id;
      setMessages(prev => prev.map(m => m.id === edited.id ? { ...m, ...edited } : m));
      // Превью в списке правим, только если менялось последнее сообщение чата
      if (wasLast) {
        setChats(prev => prev.map(c => c.id === activeChat.id
          ? { ...c, lastMessage: messagePreview(edited) }
          : c));
      }
      toast.success('Сообщение изменено');
    } catch (e) { toast.error('Ошибка редактирования'); }
    finally { setSending(false); }
  };

  /**
   * Нажатие кнопки под сообщением бота. От нажавшего сервер ставит 👍 — по нему
   * в чате и видно, что заявку уже взяли.
   *
   * Создание пациента переспрашиваем: в МИС оно необратимо, а кнопку в общем
   * чате видят все. Переход на страницу реестра — без вопросов.
   */
  const handleMessageAction = async (msg, action) => {
    if (runningAction) return;

    if (action.kind === 'api' && !window.confirm(`${action.label}?`)) return;

    setRunningAction(`${msg.id}:${action.id}`);
    try {
      const { data } = await chat.runMessageAction(activeChat.id, msg.id, action.id);
      if (action.kind === 'link' && action.url) {
        navigate(action.url);
      } else {
        toast.success(data.result ? `Готово: ${data.result}` : 'Готово');
      }
    } catch (e) {
      toast.error(e.response?.data?.error || 'Не удалось выполнить действие');
    } finally {
      setRunningAction(null);
    }
  };

  const closeContextMenu = () =>
    setContextMenu({ visible: false, x: 0, y: 0, messageId: null, message: null, isOwnMessage: false, canDelete: false });

  const handleContextMenu = (e, msg) => {
    e.preventDefault();
    if (msg.type === 'system') return;

    // Открываем единое контекстное меню с реакциями и опциями редактирования/удаления
    const isOwnMessage = msg.senderId === user.id;
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      messageId: msg.id,
      message: msg,
      isOwnMessage,
      // Удалить может каждый: как минимум «у себя». Стереть у всех разрешит
      // или не разрешит сервер — правила в canDeleteForAll (ver. 7.29)
      canDelete: true
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

  // ── Форматирование текста в поле ввода ──────────────────────────────────
  // Панель показывается над полем, пока в нём что-то выделено, — как в Telegram.
  // Горячие клавиши те же: Ctrl+B/I/U и Ctrl+Shift+X/P/M

  const FORMAT_BUTTONS = [
    { d: '*',  icon: Bold,          title: 'Жирный (Ctrl+B)' },
    { d: '_',  icon: Italic,        title: 'Курсив (Ctrl+I)' },
    { d: '__', icon: Underline,     title: 'Подчёркнутый (Ctrl+U)' },
    { d: '~',  icon: Strikethrough, title: 'Зачёркнутый (Ctrl+Shift+X)' },
    { d: '||', icon: EyeOff,        title: 'Спойлер (Ctrl+Shift+P)' },
    { d: '`',  icon: Code,          title: 'Моноширинный (Ctrl+Shift+M)' },
  ];

  const commandMatch = !editingMessage && newMessage.match(/^[\\/]([^\s]*)$/);
  const commandQuery = commandMatch?.[1]?.toLowerCase() || '';
  const visibleCommands = commandMatch
    ? chatCommands.filter(item => item.command.toLowerCase().includes(commandQuery)).slice(0, 8)
    : [];
  const showCommandMenu = isMessageInputFocused && visibleCommands.length > 0;
  const mentionMatch = !editingMessage && activeChat?.type === 'group' && newMessage.match(/(?:^|\s)@([^@\n]*)$/);
  const mentionQuery = mentionMatch?.[1]?.trim().toLowerCase() || '';
  const visibleMentions = mentionMatch
    ? mentionTargets.filter(item => item.label.toLowerCase().includes(mentionQuery)).slice(0, 8)
    : [];
  const showMentionMenu = isMessageInputFocused && !showCommandMenu && visibleMentions.length > 0;

  useEffect(() => {
    setCommandSelection(0);
  }, [commandQuery, activeChat?.id]);

  useEffect(() => { setMentionSelection(0); }, [mentionQuery, activeChat?.id]);

  const chooseCommand = (item) => {
    setNewMessage(`${item.insertText}${item.usage ? ' ' : ''}`);
    setCommandSelection(0);
    requestAnimationFrame(() => messageInputRef.current?.focus());
  };

  const chooseMention = (item) => {
    const matchIndex = newMessage.lastIndexOf('@');
    const prefix = matchIndex >= 0 ? newMessage.slice(0, matchIndex) : newMessage;
    setNewMessage(`${prefix}@${item.label} `);
    setSelectedMentions(prev => prev.some(m => m.targetId === item.targetId) ? prev : [...prev, item]);
    setMentionSelection(0);
    requestAnimationFrame(() => messageInputRef.current?.focus());
  };

  const applyFormat = (delimiter) => {
    const input = messageInputRef.current;
    if (!input) return;

    const { selectionStart: start, selectionEnd: end } = input;
    if (start === end) return;

    const next = toggleMarkup(newMessage, start, end, delimiter);
    setNewMessage(next.text);
    // Выделение возвращаем после перерисовки: React ставит каретку в конец поля
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(next.start, next.end);
      setHasSelection(next.end > next.start);
    });
  };

  const applyLink = () => {
    const input = messageInputRef.current;
    if (!input) return;

    const { selectionStart: start, selectionEnd: end } = input;
    if (start === end) return;

    const url = window.prompt('Адрес ссылки:', 'https://');
    if (!url || url === 'https://') return;

    const label = newMessage.slice(start, end);
    const text = `${newMessage.slice(0, start)}[${label}](${url})${newMessage.slice(end)}`;
    setNewMessage(text);
    requestAnimationFrame(() => {
      input.focus();
      const caret = start + label.length + url.length + 4;
      input.setSelectionRange(caret, caret);
      setHasSelection(false);
    });
  };

  const handleInputKeyDown = (e) => {
    if (showMentionMenu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        setMentionSelection(index => (index + direction + visibleMentions.length) % visibleMentions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        chooseMention(visibleMentions[mentionSelection] || visibleMentions[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        return;
      }
    }
    if (showCommandMenu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        setCommandSelection(index => (index + direction + visibleCommands.length) % visibleCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        chooseCommand(visibleCommands[commandSelection] || visibleCommands[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setNewMessage('');
        return;
      }
    }
    if (!e.ctrlKey && !e.metaKey) return;

    const key = e.key.toLowerCase();
    const delimiter = e.shiftKey
      ? { x: '~', p: '||', m: '`' }[key]
      : { b: '*', i: '_', u: '__', k: 'link' }[key];
    if (!delimiter) return;

    e.preventDefault();
    if (delimiter === 'link') applyLink();
    else applyFormat(delimiter);
  };

  // Пересчитываем по любому событию, способному сдвинуть выделение: у input нет
  // отдельного события «выделение изменилось» для клавиатуры
  const syncSelection = (e) => setHasSelection(e.target.selectionEnd > e.target.selectionStart);

  const startEditMessage = (msg) => {
    setEditingMessage(msg);
    setNewMessage(msg.content);
    closeContextMenu();
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
    closeContextMenu();
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

  const startSelection = (msg) => {
    setSelectionMode(true);
    setSelectedMessages([msg.id]);
    setSelectionAnchor(msg.id);
    closeContextMenu();
  };

  const cancelSelection = () => {
    setSelectionMode(false);
    setSelectedMessages([]);
    setSelectionAnchor(null);
  };

  const toggleMessageSelection = (msgId, extendRange = false) => {
    if (!selectionMode) return;

    // Shift+клик отмечает всё между якорем и текущим сообщением. Ради этого
    // режим и затевался: разгрести завал поштучно — как раз то, что неудобно.
    if (extendRange && selectionAnchor && selectionAnchor !== msgId) {
      const from = messages.findIndex(m => m.id === selectionAnchor);
      const to = messages.findIndex(m => m.id === msgId);
      if (from !== -1 && to !== -1) {
        const range = messages
          .slice(Math.min(from, to), Math.max(from, to) + 1)
          .map(m => m.id);
        setSelectedMessages(prev => [...new Set([...prev, ...range])]);
        setSelectionAnchor(msgId);
        return;
      }
    }

    setSelectedMessages(prev =>
      prev.includes(msgId) ? prev.filter(id => id !== msgId) : [...prev, msgId]
    );
    setSelectionAnchor(msgId);
  };

  // Те же правила, что на сервере (canDeleteForAll в backend/routes/chat.js):
  // клиент лишь решает, показывать ли кнопку, а разрешает всё равно сервер.
  const DELETE_FOR_ALL_WINDOW_MS = 48 * 60 * 60 * 1000;

  const canDeleteForAll = (msg) => {
    if (!msg || msg.type === 'system') return false;
    if (user.isAdmin) return true;
    if (activeChat?.type === 'group' && isGroupAdmin) return true;
    if (msg.senderId !== user.id) return false;
    return Date.now() - new Date(msg.createdAt).getTime() <= DELETE_FOR_ALL_WINDOW_MS;
  };

  const selectedMessageObjects = () => messages.filter(m => selectedMessages.includes(m.id));

  const handleCopySelected = async () => {
    const text = selectedMessageObjects()
      .map(m => stripFormatting(m.content || '') || '')
      .filter(Boolean)
      .join('\n');
    if (!text) { toast.error('В выделенном нет текста'); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(selectedMessages.length > 1 ? 'Сообщения скопированы' : 'Сообщение скопировано');
      cancelSelection();
    } catch { toast.error('Буфер обмена недоступен'); }
  };

  // Диалог удаления один и тот же для пачки и для одного сообщения из
  // контекстного меню — правила и текст не должны расходиться
  const openDeleteDialog = (msgs) => {
    if (msgs.length === 0) return;
    setDeleteDialog({ ids: msgs.map(m => m.id), canAll: msgs.every(canDeleteForAll), count: msgs.length });
  };

  const handleDeleteSelected = async (scope) => {
    const ids = deleteDialog?.ids || [];
    if (ids.length === 0) return;
    try {
      await chat.deleteMessages(activeChat.id, ids, scope);
      // Своё же удаление сокетом обратно не прилетает — убираем сразу
      setMessages(prev => prev
        .filter(m => !ids.includes(m.id))
        .map(m => ids.includes(m.replyTo?.id) ? { ...m, replyTo: null, replyToId: null } : m));
      setDeleteDialog(null);
      cancelSelection();
      toast.success(scope === 'all' ? 'Удалено у всех' : 'Удалено у вас');
      // Превью в списке чатов после удаления «у всех» пересчитывает сервер и
      // присылает сокетом; при удалении «у себя» оно не меняется
      if (scope === 'me') await loadChats();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Ошибка удаления');
    }
  };

  const handleForwardSend = async (targetChatId) => {
    if (selectedMessages.length === 0) return;
    try {
      await chat.forwardMessages(targetChatId, selectedMessages);
      toast.success(`Переслано в чат`);
      setShowForwardModal(false);
      cancelSelection();
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
        closeContextMenu();
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

  const getUserRoleNames = (u) => [...new Set([u.role?.name, ...(u.roles || []).map(r => r.name)].filter(Boolean))];
  const uniqueRoles = [...new Set(usersList.flatMap(getUserRoleNames))].sort();
  const uniqueMedCenters = [...new Set(usersList.flatMap(u => (u.medCenters || []).map(m => m.name)).filter(Boolean))].sort();

  const matchesQuickFilters = (u) => {
    if (quickAddRoleFilter && !getUserRoleNames(u).includes(quickAddRoleFilter)) return false;
    if (quickAddMedCenterFilter && !(u.medCenters || []).some(m => m.name === quickAddMedCenterFilter)) return false;
    return true;
  };

  const filteredUsers = usersList.filter(u => {
    const displayName = (u.displayName || u.username || '').toLowerCase();
    return displayName.includes(userSearchQuery.toLowerCase()) && matchesQuickFilters(u);
  });

  const activeGroupMembers = activeChat?.type === 'group' ? (activeChat.members || []) : [];
  const activeGroupOnlineCount = activeGroupMembers.filter(member => {
    const liveStatus = userStatuses[member.userId];
    return liveStatus ? Boolean(liveStatus.isOnline) : Boolean(member.user?.isOnline);
  }).length;

  const getAvatarUrl = (avatar) => {
    if (!avatar) return null;
    if (avatar.startsWith('http://localhost')) {
      const p = avatar.replace(/^http:\/\/localhost:\d+\//, '');
      return withFileToken(`${BASE_URL}/${p}`);
    }
    if (avatar.startsWith('http')) return withFileToken(avatar);
    // Ведущий слэш срезаем: с ним получалось «//uploads/...», а такой путь мимо
    // express.static и мимо location /uploads в nginx — файл скачивался битым
    return withFileToken(`${BASE_URL}/${avatar.replace(/^\/+/, '')}`);
  };

  // Вложения чата отдаются только участникам, и подтверждает право токен в
  // query. Аватарок и картинок вики это не касается — они открыты как прежде.
  function withFileToken(url) {
    if (!fileToken || !url.includes('/uploads/chat-attachments/')) return url;
    return `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(fileToken)}`;
  }

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

  const handleMessageContentClick = (e) => {
    // Спойлер открывается по клику и обратно не закрывается — как в Telegram
    const spoiler = e.target.closest('.chat-spoiler');
    if (spoiler && !spoiler.classList.contains('revealed')) {
      e.preventDefault();
      spoiler.classList.add('revealed');
      return;
    }

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
    // Сообщение ещё в пути или не ушло вовсе — это важнее всех остальных
    // состояний: до ver. 7.34 его просто не было видно, пока сервер не ответит
    if (msg.failed) return 'failed';
    if (msg.pending) return 'pending';
    if (activeChat?.type !== 'private') return 'sent';
    if (otherLastReadAt && new Date(msg.createdAt) <= new Date(otherLastReadAt)) return 'read';
    const otherId = activeChat?.otherUser?.id;
    const st = userStatuses[otherId];
    const otherOnline = activeChat?.otherUser?.isOnline || st?.isOnline;
    const lastSeenTs = st?.lastSeen || activeChat?.otherUser?.lastSeen;
    if (otherOnline || (lastSeenTs && new Date(msg.createdAt) < new Date(lastSeenTs))) return 'delivered';
    return 'sent';
  };

  const chatMedia = [...messages].reverse().flatMap(msg => (msg.attachments || []).map((att, idx) => ({
    key: `${msg.id}:${idx}`,
    url: fixUrl(att.url || att.path),
    name: att.name || att.filename || '',
    mimeType: att.mimeType || '',
    messageId: msg.id,
  })).filter(att => att.url && /^(image|video)\//.test(att.mimeType)));
  const openLightbox = (key) => {
    const index = chatMedia.findIndex(item => item.key === key);
    setLightboxImages(chatMedia);
    setLightboxIndex(index >= 0 ? index : 0);
    setLightboxOpen(true);
    setLightboxZoom(1);
  };
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

  const renderAttachments = (msgAttachments, isOwn, msgId) => {
    if (!msgAttachments || msgAttachments.length === 0) return null;

    // Голосовое всегда приходит одним вложением и рисуется плеером,
    // а не карточкой файла
    const voice = msgAttachments.length === 1 && msgAttachments[0]?.kind === 'voice'
      ? msgAttachments[0]
      : null;
    if (voice) {
      return (
        <div className="message-attachments">
          <VoiceMessage
            url={fixUrl(voice.url || voice.path)}
            duration={voice.duration}
            messageId={msgId}
            isOwn={isOwn}
          />
        </div>
      );
    }
    /**
     * Снимки и видео, отправленные разом, показываем плиткой (ver. 7.58).
     *
     * Раньше каждое вложение рисовалось во всю ширину пузырька и вставало под
     * предыдущим: десять фотографий давали три тысячи пикселей высоты, и
     * переписка после одной такой отправки пролистывалась минуту. Сообщение при
     * этом всегда было одно — цепочки не было, была очень длинная картинка.
     *
     * Одиночный снимок остаётся как был: плитка нужна там, где надо сравнить
     * количество и выбрать, а один снимок хочется видеть целиком.
     *
     * Индекс сохраняем исходный: по нему открывается просмотрщик
     * (openLightbox по ключу `${msgId}:${idx}`), и после фильтрации он обязан
     * указывать на то же вложение, что и до неё.
     */
    const indexed = msgAttachments.map((att, idx) => ({ att, idx }));
    const isVisual = (att) => att.mimeType?.startsWith('image/') || att.mimeType?.startsWith('video/');
    const visuals = indexed.filter(({ att }) => isVisual(att));
    const others = indexed.filter(({ att }) => !isVisual(att));
    const asAlbum = visuals.length > 1;

    const renderOne = (att, idx) => {
      const url = fixUrl(att.url || att.path);
      const thumbUrl = fixUrl(att.thumbnailUrl || att.thumbnailPath);
      // filename — вложения заявок с сайта, отправленные до перехода на name
      const name = att.name || att.filename;

      if (att.mimeType?.startsWith('image/')) {
        return (
          <div key={idx} className="attachment-image" onClick={() => openLightbox(`${msgId}:${idx}`)}>
            <img src={thumbUrl || url} alt={name} />
          </div>
        );
      }
          
      if (att.mimeType?.startsWith('video/')) {
        return (
          <div 
            key={idx} 
            className={`attachment-video ${isOwn ? 'own' : ''}`}
            onClick={() => openLightbox(`${msgId}:${idx}`)}
          >
            <div className="attachment-video-thumb">
              <Film size={32} />
              <div className="attachment-video-play">▶</div>
            </div>
            <div className="attachment-file-info">
              <div className="attachment-file-name">{name}</div>
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
            onClick={() => openPdfPreview(url, name)}
            style={{ cursor: 'pointer' }}
          >
            <div className="attachment-file-icon"><FileText size={20} /></div>
            <div className="attachment-file-info">
              <div className="attachment-file-name">{name}</div>
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
          onClick={(e) => downloadFile(e, url, name)}
          style={{ cursor: 'pointer' }}
        >
          <div className="attachment-file-icon">{getFileIcon(att.mimeType)}</div>
          <div className="attachment-file-info">
            <div className="attachment-file-name">{name}</div>
            <div className="attachment-file-size">{formatFileSize(att.size)}</div>
          </div>
          <Download size={18} />
        </div>
      );
    };

    return (
      <div className="message-attachments">
        {asAlbum && (
          <div className={`message-album cols-${albumColumns(visuals.length)}`}>
            {visuals.map(({ att, idx }) => {
              const url = fixUrl(att.url || att.path);
              const thumbUrl = fixUrl(att.thumbnailUrl || att.thumbnailPath);
              const name = att.name || att.filename;
              const isVideo = att.mimeType?.startsWith('video/');
              const preview = thumbUrl || (isVideo ? null : url);
              return (
                <div
                  key={idx}
                  className="message-album-tile"
                  onClick={() => openLightbox(`${msgId}:${idx}`)}
                  title={name}
                >
                  {/* У видео превью есть не всегда — тогда плитка остаётся
                      заглушкой со значком, а не битой картинкой */}
                  {preview
                    ? <img src={preview} alt={name} loading="lazy" />
                    : <span className="message-album-stub"><Film size={22} /></span>}
                  {isVideo && <span className="message-album-play">▶</span>}
                </div>
              );
            })}
          </div>
        )}
        {!asAlbum && visuals.map(({ att, idx }) => renderOne(att, idx))}
        {others.map(({ att, idx }) => renderOne(att, idx))}
      </div>
    );
  };

  // Кнопки под сообщением бота: создать пациента в МИС, открыть реестр справок.
  // Что заявку уже взяли, видно по 👍 — его ставит сервер от нажавшего
  const renderMessageActions = (msg) => {
    if (!msg.actions?.length) return null;

    return (
      <div className="message-actions">
        {msg.actions.map(action => {
          const busy = runningAction === `${msg.id}:${action.id}`;

          return (
            <button
              key={action.id}
              className="message-action-btn"
              disabled={busy}
              onClick={() => handleMessageAction(msg, action)}
            >
              {busy && <div className="loading-spinner" style={{ width: 14, height: 14 }} />}
              {action.label}
            </button>
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
                    <div className="chat-item-preview">{stripFormatting(chatItem.lastMessage) || 'Нет сообщений'}</div>
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
              // Порядок держим здесь, а не полагаемся на ответ сервера: список
              // теперь правится на месте по событиям сокета, и чат с новым
              // сообщением обязан всплыть наверх без перезагрузки (ver. 7.28)
              const regularChats = chats.filter(c => !c.isPinned).sort((a, b) => {
                const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
                const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
                return bt - at;
              });

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
                <div className="chat-main-info" style={{ cursor: 'pointer' }} onClick={() => showChatInfo ? setShowChatInfo(false) : openChatInfo()}>
                  <div className="chat-main-name">{activeChat.displayName}</div>
                  <div className="chat-main-status">
                    {activeChat.type === 'group'
                      ? `${formatMemberCount(activeGroupMembers.length)} · ${activeGroupOnlineCount} онлайн`
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
                {/* Кнопки «Медиа» здесь больше нет (ver. 7.58): в панель ведёт
                    сама шапка, а открывается панель на той вкладке, ради которой
                    в неё чаще всего и заходят — в группе на участниках, в личной
                    переписке на медиа (openChatInfo без аргумента). Отдельная
                    кнопка вела ровно туда же, только другой дверью. */}
                {activeChat.type === 'group' && <button className="btn-icon-chat" title="Информация о группе" onClick={() => openChatInfo('members')}><MoreVertical size={20} /></button>}
              </div>
              {/* Шапка закреплённых. Показываем одно сообщение из списка —
                  нажатие уводит к нему в ленте и переключает на следующее. */}
              {pinnedMessages.length > 0 && (() => {
                const pinned = pinnedMessages[pinnedIndex % pinnedMessages.length];
                if (!pinned) return null;
                return (
                  <div className="chat-pinned-bar">
                    <Pin size={16} className="chat-pinned-icon" />
                    <div
                      className="chat-pinned-content"
                      onClick={() => {
                        scrollToMessage(pinned.id);
                        if (pinnedMessages.length > 1) setPinnedIndex(i => (i + 1) % pinnedMessages.length);
                      }}
                    >
                      <div className="chat-pinned-title">
                        Закреплённое
                        {pinnedMessages.length > 1 && ` ${pinnedIndex % pinnedMessages.length + 1} из ${pinnedMessages.length}`}
                      </div>
                      <div className="chat-pinned-text">
                        {stripFormatting(pinned.content) || messagePreview(pinned) || 'Вложение'}
                      </div>
                    </div>
                    {canPinHere() && (
                      <button
                        className="btn-icon-chat"
                        title="Открепить"
                        onClick={() => togglePin(pinned, false)}
                      >
                        <PinOff size={16} />
                      </button>
                    )}
                  </div>
                );
              })()}
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
              <div className="chat-messages" ref={messagesScrollRef} onScroll={handleMessagesScroll}>
                {/* Капсула прилипает к верху ленты и не занимает места в
                    потоке (height: 0), поэтому сообщения под ней не сдвигаются.
                    Касания не перехватывает: под ней живая переписка. */}
                <div className="chat-date-float" aria-hidden="true">
                  <span className={floatingDateOn ? 'is-on' : ''}>{floatingDate}</span>
                </div>
                {loadingOlder && <div className="chat-messages-older"><div className="loading-spinner" /></div>}
                {messages.length > 0 ? messages.map((msg, idx) => {
                  const isOwn = msg.senderId === user.id;
                  const showAvatar = !isOwn && (idx === 0 || messages[idx-1].senderId !== msg.senderId);
                  const showDateSeparator = shouldShowDateSeparator(msg, messages[idx - 1]);
                  
                  const hasAttachments = msg.attachments && msg.attachments.length > 0;
                  const hasText = msg.type !== 'poll' && msg.content && msg.content !== 'Сообщение удалено';
                  
                  return (
                    <React.Fragment key={msg.id}>
                      {showDateSeparator && (
                        // data-date читает плавающая капсула: дата тут уже
                        // посчитана, и считать её второй раз незачем
                        <div className="date-separator" data-date={formatDateSeparator(new Date(msg.createdAt))}>
                          <span>{formatDateSeparator(new Date(msg.createdAt))}</span>
                        </div>
                      )}
                      {msg.type === 'system' ? (
                        <div className="message-system">{msg.content}</div>
                      ) : (
                        <div
                          className={`message-row ${selectionMode ? 'selection-mode' : ''} ${selectedMessages.includes(msg.id) ? 'selected-for-action' : ''}`}
                          onClick={(e) => selectionMode && toggleMessageSelection(msg.id, e.shiftKey)}
                        >
                          {selectionMode && (
                            <div className={`selection-check ${selectedMessages.includes(msg.id) ? 'checked' : ''}`} />
                          )}
                          <div
                            id={`message-${msg.id}`}
                            className={`message ${isOwn ? 'own' : ''} ${highlightedMessageId === msg.id ? 'highlighted' : ''}`}
                            onContextMenu={(e) => !selectionMode && handleContextMenu(e, msg)}
                          >
                            {!isOwn && showAvatar && <div className="message-avatar" style={msg.sender?.id ? { cursor: 'pointer' } : {}} onClick={msg.sender?.id ? (e) => { e.stopPropagation(); navigate(`/users/${msg.sender.id}`); } : undefined}>{getAvatarUrl(msg.sender?.avatar) ? <img src={getAvatarUrl(msg.sender.avatar)} alt="" /> : <User size={16} />}</div>}
                            <div className={`message-bubble ${!showAvatar && !isOwn ? 'no-avatar' : ''} ${hasAttachments ? 'has-attachments' : ''}`}>
                              {!isOwn && showAvatar && activeChat.type === 'group' && <div className="message-sender" style={msg.sender?.id ? { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 } : {}} onClick={msg.sender?.id ? (e) => { e.stopPropagation(); navigate(`/users/${msg.sender.id}`); } : undefined}><span>{msg.sender?.displayName || msg.sender?.username}</span><UserBadge badge={msg.sender?.chatBadge} size={14} /></div>}
                              {msg.replyTo && (
                                <div className="reply-quote" onClick={() => scrollToMessage(msg.replyTo.id)}>
                                  <div className="reply-quote-sender">{msg.replyTo.sender?.displayName || msg.replyTo.sender?.username}</div>
                                  <div className="reply-quote-content">{stripFormatting(msg.replyTo.content).substring(0, 100)}{stripFormatting(msg.replyTo.content).length > 100 ? '...' : ''}</div>
                                </div>
                              )}
                              {msg.forwardedFrom && (
                                <div className="forwarded-from-banner">
                                  <Send size={12} />
                                  <span>Переслано от <strong>{msg.forwardedFrom.senderName}</strong></span>
                                </div>
                              )}
                              {renderAttachments(msg.attachments, isOwn, msg.id)}
                              {msg.type === 'poll' && <PollMessage message={msg} onVote={optionIds => votePoll(msg.id, optionIds)} />}
                              {hasText && (
                                <div
                                  className="message-content"
                                  onClick={handleMessageContentClick}
                                  dangerouslySetInnerHTML={{ __html: renderRichHtml(msg.content) }}
                                />
                              )}
                              {renderMessageActions(msg)}
                              <div className="message-meta">
                                <span className="message-time">{format(new Date(msg.createdAt), 'HH:mm')}</span>
                                {msg.isEdited && <span className="message-edited">изменено</span>}
                                {isOwn && (() => {
                                  const st = getMsgStatus(msg);
                                  if (st === 'pending') {
                                    return <span className="message-status message-status--pending"><Clock size={13} /></span>;
                                  }
                                  if (st === 'failed') {
                                    return (
                                      <button
                                        type="button"
                                        className="message-status message-status--failed"
                                        title="Не отправлено — нажмите, чтобы повторить"
                                        onClick={(e) => { e.stopPropagation(); retrySend(msg); }}
                                      >
                                        <AlertCircle size={13} /> повторить
                                      </button>
                                    );
                                  }
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
                    <span>Ответ <strong>{replyingToMessage.sender?.displayName || replyingToMessage.sender?.username || ''}</strong>{replyingToMessage.content ? `: ${stripFormatting(replyingToMessage.content).substring(0, 60)}${stripFormatting(replyingToMessage.content).length > 60 ? '...' : ''}` : ''}</span>
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
              {selectionMode && (
                <div className="selection-action-bar">
                  <div className="selection-action-info">
                    <CheckCircle size={16} />
                    <span>Выбрано: <strong>{selectedMessages.length}</strong></span>
                    {/* Про Shift пишем прямо в панели: сам по себе он не находится */}
                    <span className="selection-action-hint">Shift+клик — диапазон</span>
                  </div>
                  <div className="selection-action-buttons">
                    <button className="btn btn-ghost" onClick={cancelSelection}>Отмена</button>
                    <button
                      className="btn btn-ghost"
                      disabled={selectedMessages.length === 0}
                      onClick={handleCopySelected}
                      title="Скопировать текст выделенного"
                    >
                      <Copy size={16} /> Копировать
                    </button>
                    <button
                      className="btn btn-danger"
                      disabled={selectedMessages.length === 0}
                      onClick={() => openDeleteDialog(selectedMessageObjects())}
                    >
                      <Trash2 size={16} /> Удалить
                    </button>
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
                  {recording ? (
                    <>
                      <button type="button" className="btn-icon-chat" onClick={() => stopRecording(false)} title="Отменить запись">
                        <Trash2 size={20} />
                      </button>
                      <div className="voice-recorder">
                        <span className="voice-recorder-dot" />
                        <span className="voice-recorder-time">
                          {`${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, '0')}`}
                        </span>
                        <span className="voice-recorder-hint">Идёт запись — нажмите, чтобы отправить</span>
                      </div>
                      <button type="button" className="btn btn-primary btn-icon" onClick={() => stopRecording(true)} disabled={sending} title="Отправить">
                        <Send size={20} />
                      </button>
                    </>
                  ) : (
                    <>
                      {!editingMessage && (
                        <div className="chat-attach" ref={attachMenuRef}>
                          {/* В личной переписке прикреплять нечего, кроме файла,
                              и меню из одного пункта было бы лишним нажатием —
                              там скрепка сразу открывает выбор файла. */}
                          <button
                            type="button"
                            className="btn-icon-chat"
                            onClick={() => {
                              if (activeChat.type === 'group') setAttachMenuOpen(open => !open);
                              else fileInputRef.current?.click();
                            }}
                            disabled={uploading}
                            title={activeChat.type === 'group' ? 'Прикрепить' : 'Прикрепить файл'}
                          >
                            {uploading ? <div className="loading-spinner" style={{width: 20, height: 20}} /> : <Paperclip size={20} />}
                          </button>

                          {attachMenuOpen && activeChat.type === 'group' && (
                            <div className="chat-attach-menu" role="menu">
                              <button type="button" role="menuitem" onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}>
                                <Paperclip size={18} /> Файл
                              </button>
                              <button type="button" role="menuitem" onClick={() => { setAttachMenuOpen(false); setShowPollEditor(true); }}>
                                <BarChart3 size={18} /> Опрос
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="chat-input-wrapper">
                        {showCommandMenu && (
                          <div className="command-suggestions" role="listbox">
                            {visibleCommands.map((item, index) => (
                              <button
                                key={`${item.botUsername}:${item.command}`}
                                type="button"
                                className={index === commandSelection ? 'active' : ''}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => chooseCommand(item)}
                                role="option"
                                aria-selected={index === commandSelection}
                              >
                                <span className="command-suggestions-name">{item.insertText}{item.usage ? ` ${item.usage}` : ''}</span>
                                <span className="command-suggestions-description">{item.description}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {showMentionMenu && (
                          <div className="command-suggestions" role="listbox">
                            {visibleMentions.map((item, index) => (
                              <button
                                key={item.targetId}
                                type="button"
                                className={index === mentionSelection ? 'active' : ''}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => chooseMention(item)}
                                role="option"
                                aria-selected={index === mentionSelection}
                              >
                                <span className="command-suggestions-name">@{item.label}</span>
                                <span className="command-suggestions-description">
                                  {item.type === 'user' ? 'Сотрудник' : item.type === 'role' ? `Роль · ${item.count} чел.` : `Медцентр · ${item.count} чел.`}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {hasSelection && (
                          // onMouseDown гасим: без него нажатие уводит фокус из поля
                          // и выделение, к которому применяется разметка, пропадает
                          <div className="format-toolbar" onMouseDown={(e) => e.preventDefault()}>
                            {FORMAT_BUTTONS.map(({ d, icon: Icon, title }) => (
                              <button key={d} type="button" title={title} onClick={() => applyFormat(d)}>
                                <Icon size={16} />
                              </button>
                            ))}
                            <button type="button" title="Ссылка (Ctrl+K)" onClick={applyLink}>
                              <Link2 size={16} />
                            </button>
                          </div>
                        )}
                        <input
                          ref={messageInputRef}
                          placeholder={editingMessage ? "Введите новый текст..." : "Введите сообщение..."}
                          value={newMessage}
                          onChange={(e) => { setNewMessage(e.target.value); syncSelection(e); }}
                          onKeyDown={handleInputKeyDown}
                          onSelect={syncSelection}
                          onFocus={() => setIsMessageInputFocused(true)}
                          onBlur={() => { setHasSelection(false); setIsMessageInputFocused(false); }}
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
                      {/* Пусто — микрофон, есть что отправить — самолётик. Как в Telegram */}
                      {!editingMessage && !newMessage.trim() && attachments.length === 0 ? (
                        <button type="button" className="btn btn-primary btn-icon" onClick={startRecording} title="Записать голосовое">
                          <Mic size={20} />
                        </button>
                      ) : (
                        <button type="submit" className="btn btn-primary btn-icon" disabled={(!newMessage.trim() && attachments.length === 0) || sending}>
                          <Send size={20} />
                        </button>
                      )}
                    </>
                  )}
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

        {showChatInfo && activeChat && (
          <div className="chat-info-panel">
            <div className="chat-info-header">
              <h3>{activeChat.type === 'group' ? 'Информация о группе' : 'Информация о чате'}</h3>
              <button className="btn-icon-chat" onClick={() => setShowChatInfo(false)}><X size={20} /></button>
            </div>
            <div className="chat-info-body">
              <div className="chat-info-profile">
                <div className="chat-info-avatar-wrapper">
                  <div className="chat-info-avatar">{getChatAvatar(activeChat) ? <img src={getAvatarUrl(getChatAvatar(activeChat))} alt="" /> : (activeChat.type === 'group' ? <Users size={48} /> : <User size={48} />)}</div>
                  {isGroupAdmin && (
                    <div className="chat-info-avatar-actions">
                      <input type="file" ref={avatarInputRef} hidden accept="image/*" onChange={handleAvatarChange} />
                      <button className="btn btn-sm btn-ghost" onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>{avatarUploading ? <div className="loading-spinner" style={{width: 16, height: 16}} /> : <Camera size={16} />}{activeChat.avatar ? 'Изменить' : 'Добавить'}</button>
                      {activeChat.avatar && <button className="btn btn-sm btn-ghost text-danger" onClick={handleDeleteAvatar}><X size={16} /> Удалить</button>}
                    </div>
                  )}
                </div>
                <div className="chat-info-name">
                  {activeChat.displayName}
                  {isGroupAdmin && (
                    <button className="btn-icon-chat sm" title="Переименовать" onClick={() => { setRenameGroupValue(activeChat.name || activeChat.displayName || ''); setShowRenameGroup(true); }}>
                      <Pencil size={14} />
                    </button>
                  )}
                </div>
                <div className="chat-info-subtitle">
                  {activeChat.type === 'group'
                    ? `${formatMemberCount(activeGroupMembers.length)} · ${activeGroupOnlineCount} онлайн`
                    : (() => {
                        const otherId = activeChat.otherUser?.id;
                        const st = userStatuses[otherId];
                        const isOnline = activeChat.otherUser?.isOnline || st?.isOnline;
                        const lastSeen = st?.lastSeen || activeChat.otherUser?.lastSeen;
                        return isOnline ? 'В сети' : formatLastSeen(lastSeen);
                      })()
                  }
                </div>
                {activeChat.type !== 'group' && activeChat.otherUser?.id && (
                  <button className="btn btn-sm btn-ghost" onClick={() => navigate(`/users/${activeChat.otherUser.id}`)}>
                    <User size={16} /> Открыть профиль
                  </button>
                )}
              </div>

              {/* Вкладки в духе Telegram: состав группы и вся её галерея живут в
                  одной панели, а не в панели и модалке по отдельности */}
              <div className="chat-info-tabs">
                {(activeChat.type === 'group' ? [{ key: 'members', label: 'Участники' }, ...MEDIA_TABS] : MEDIA_TABS).map(tab => (
                  <button
                    key={tab.key}
                    className={`chat-info-tab ${infoTab === tab.key ? 'active' : ''}`}
                    onClick={() => selectInfoTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="chat-info-tab-content">
                {infoTab === 'members' && activeChat.type === 'group' && (
                  <div className="chat-info-section">
                    <div className="chat-info-section-header">
                      <span>Участники ({activeChat.members?.length || 0})</span>
                      {isGroupAdmin && (
                        <span style={{ display: 'flex', gap: 4 }}>
                          {/* Ссылка стоит рядом с «Добавить», а не в общих настройках
                              группы: оба ответа на один вопрос «как сюда позвать
                              человека», и выбирать между ними надо не переходя
                              в другое место */}
                          <button className="btn btn-sm btn-ghost" onClick={() => setShowInviteLink(true)}>
                            <Link2 size={16} /> Ссылка
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => { setShowAddMember(true); setQuickAddRoleFilter(''); setQuickAddMedCenterFilter(''); loadUsers(); loadBots(); }}>
                            <UserPlus size={16} /> Добавить
                          </button>
                        </span>
                      )}
                    </div>
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
                )}

                {infoTab !== 'members' && mediaLoading && <div className="chat-loading"><div className="loading-spinner" /></div>}
                {infoTab !== 'members' && !mediaLoading && mediaItems.length === 0 && (
                  <div className="text-muted text-center">Здесь пока пусто</div>
                )}

                {!mediaLoading && infoTab === 'media' && (
                  <div className="media-grid">
                    {mediaItems.map((item, idx) => {
                      const att = item.attachment || {};
                      const url = fixUrl(att.url || att.path);
                      const thumb = fixUrl(att.thumbnailUrl || att.thumbnailPath) || url;
                      const isVideo = att.mimeType?.startsWith('video/');
                      return (
                        <div
                          key={`${item.messageId}:${idx}`}
                          className="media-grid-item"
                          title={format(new Date(item.createdAt), 'dd.MM.yyyy HH:mm')}
                          onClick={() => revealMessageFromInfo(item.messageId)}
                        >
                          {isVideo ? <div className="media-grid-video"><Film size={22} /></div> : <img src={thumb} alt="" />}
                        </div>
                      );
                    })}
                  </div>
                )}

                {!mediaLoading && (infoTab === 'files' || infoTab === 'voice') && (
                  <div className="media-list">
                    {mediaItems.map((item, idx) => {
                      const att = item.attachment || {};
                      const url = fixUrl(att.url || att.path);
                      const name = att.kind === 'voice'
                        ? 'Голосовое сообщение'
                        : (att.name || att.filename || 'Файл');
                      return (
                        <div key={`${item.messageId}:${idx}`} className="media-list-item">
                          <div className="media-list-icon">{getFileIcon(att.mimeType)}</div>
                          <div className="media-list-info">
                            <div className="media-list-name">{name}</div>
                            <div className="media-list-meta">
                              {item.senderName} · {format(new Date(item.createdAt), 'dd.MM.yyyy')}
                              {att.size ? ` · ${formatFileSize(att.size)}` : ''}
                            </div>
                          </div>
                          <button
                            className="btn-icon-chat"
                            title="Показать в переписке"
                            onClick={() => revealMessageFromInfo(item.messageId)}
                          >
                            <CornerUpLeft size={16} />
                          </button>
                          <a className="btn-icon-chat" href={url} target="_blank" rel="noreferrer" title="Открыть">
                            <Download size={16} />
                          </a>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!mediaLoading && infoTab === 'links' && (
                  <div className="media-list">
                    {mediaItems.map(item => (
                      <div key={item.messageId} className="media-list-item">
                        <div className="media-list-icon"><Link2 size={20} /></div>
                        <div className="media-list-info">
                          {item.urls.map(url => (
                            <a key={url} className="media-list-link" href={url} target="_blank" rel="noreferrer">{url}</a>
                          ))}
                          <div className="media-list-meta">
                            {item.senderName} · {format(new Date(item.createdAt), 'dd.MM.yyyy')}
                          </div>
                        </div>
                        <button
                          className="btn-icon-chat"
                          title="Показать в переписке"
                          onClick={() => revealMessageFromInfo(item.messageId)}
                        >
                          <CornerUpLeft size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {activeChat.type === 'group' && (
              <div className="chat-info-actions">
                <button className="btn btn-sm btn-ghost text-danger" onClick={leaveGroup}><LogOut size={16} /> Покинуть группу</button>
                {isGroupCreator && (
                  <button className="btn btn-sm btn-ghost text-danger" onClick={deleteGroup}><Trash2 size={16} /> Удалить группу</button>
                )}
              </div>
            )}
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
                  closeContextMenu();
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
          <button onClick={() => { startSelection(contextMenu.message); }}>
            <CheckCircle size={16} />
            Выбрать
          </button>
          {canPinHere() && contextMenu.message?.type !== 'system' && (
            <button onClick={() => { togglePin(contextMenu.message, !contextMenu.message?.pinnedAt); closeContextMenu(); }}>
              {contextMenu.message?.pinnedAt ? <PinOff size={16} /> : <Pin size={16} />}
              {contextMenu.message?.pinnedAt ? 'Открепить' : 'Закрепить'}
            </button>
          )}
          <button onClick={() => { startSelection(contextMenu.message); setForwardSearchQuery(''); setShowForwardModal(true); }}>
            <Send size={16} />
            Переслать
          </button>
          {/* Редактирование — только своё; удаление — своё либо любое, если админ */}
          {contextMenu.canDelete && (
            <>
              <div className="context-menu-divider" />
              {contextMenu.isOwnMessage && !contextMenu.message?.forwardedFrom && contextMenu.message?.type !== 'poll' && (
                <button onClick={() => { startEditMessage(contextMenu.message); }}>
                  <Edit2 size={16} />
                  Редактировать
                </button>
              )}
              <button onClick={() => { openDeleteDialog([contextMenu.message]); closeContextMenu(); }} className="danger">
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
      {showPollEditor && (
        <div className="modal-overlay" onClick={() => setShowPollEditor(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Новый опрос</h2><button className="modal-close" onClick={() => setShowPollEditor(false)}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Вопрос</label>
                <input className="input" maxLength={300} value={pollDraft.question} onChange={e => setPollDraft({...pollDraft, question: e.target.value})} placeholder="Что нужно решить?" autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Варианты ответа</label>
                <div style={{ display: 'grid', gap: 8 }}>
                  {pollDraft.options.map((option, index) => (
                    <div key={index} style={{ display: 'flex', gap: 8 }}>
                      <input className="input" maxLength={100} value={option} onChange={e => setPollDraft({...pollDraft, options: pollDraft.options.map((value, i) => i === index ? e.target.value : value)})} placeholder={`Вариант ${index + 1}`} />
                      {pollDraft.options.length > 2 && <button type="button" className="btn-icon-chat" onClick={() => setPollDraft({...pollDraft, options: pollDraft.options.filter((_, i) => i !== index)})}><X size={18} /></button>}
                    </div>
                  ))}
                </div>
                {pollDraft.options.length < 10 && <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => setPollDraft({...pollDraft, options: [...pollDraft.options, '']})}><PlusCircle size={16} /> Добавить вариант</button>}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><input type="checkbox" checked={pollDraft.multipleChoice} onChange={e => setPollDraft({...pollDraft, multipleChoice: e.target.checked})} /> Несколько вариантов ответа</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={pollDraft.anonymous} onChange={e => setPollDraft({...pollDraft, anonymous: e.target.checked})} /> Анонимное голосование</label>
            </div>
            <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setShowPollEditor(false)}>Отмена</button><button className="btn btn-primary" onClick={createPoll}>Создать опрос</button></div>
          </div>
        </div>
      )}

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
                    <div className="user-item-info">
                      <div className="user-item-name" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span>{u.displayName || u.username}</span><UserBadge badge={u.chatBadge} /></div>
                      <div className="user-item-username">{u.role?.name || u.position || `@${u.username}`}</div>
                    </div>
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
                        <div className="user-item-name" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span>{u.displayName || u.username}</span><UserBadge badge={u.chatBadge} /></div>
                        <div className="user-item-username">
                          {getUserRoleNames(u).length > 0 && <span style={{ marginRight: '6px' }}>{getUserRoleNames(u).join(', ')}</span>}
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

      {showInviteLink && activeChat && (
        <ChatInviteModal chatId={activeChat.id} onClose={() => setShowInviteLink(false)} />
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
                      <div className="user-item-name" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span>{u.displayName || u.username}</span><UserBadge badge={u.chatBadge} /></div>
                      <div className="user-item-username">
                        {getUserRoleNames(u).length > 0 && <span style={{ marginRight: '6px' }}>{getUserRoleNames(u).join(', ')}</span>}
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
            <button className="lightbox-download" onClick={(e) => { e.stopPropagation(); downloadFile(e, lightboxImages[lightboxIndex]?.url, lightboxImages[lightboxIndex]?.name || `media-${lightboxIndex + 1}`); }}><Download size={20} /></button>
          </div>
          {lightboxImages[lightboxIndex]?.mimeType?.startsWith('video/') ? (
            <video key={lightboxImages[lightboxIndex].key} src={lightboxImages[lightboxIndex].url} controls autoPlay onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '82vh' }} />
          ) : (
            <img
              src={lightboxImages[lightboxIndex]?.url}
              alt={lightboxImages[lightboxIndex]?.name || ''}
              onClick={(e) => e.stopPropagation()}
              style={{ transform: `scale(${lightboxZoom})`, maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', transition: 'transform 0.2s' }}
            />
          )}
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

      {/* Диалог удаления — один на пачку и на одно сообщение */}
      {deleteDialog && (
        <div className="modal-overlay" onClick={() => setDeleteDialog(null)}>
          <div className="modal modal-narrow" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{deleteDialog.count > 1 ? `Удалить ${deleteDialog.count} ${pluralMessages(deleteDialog.count)}?` : 'Удалить сообщение?'}</h2>
              <button className="modal-close" onClick={() => setDeleteDialog(null)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p className="delete-dialog-text">
                «У себя» — {deleteDialog.count > 1 ? 'сообщения пропадут' : 'сообщение пропадёт'} только из вашей переписки,
                у остальных {deleteDialog.count > 1 ? 'они останутся' : 'оно останется'} на месте.
              </p>
              {!deleteDialog.canAll && (
                <p className="delete-dialog-note">
                  Удалить у всех нельзя: чужие сообщения и свои старше двух суток стирает только администратор.
                </p>
              )}
              <div className="delete-dialog-actions">
                <button className="btn btn-ghost" onClick={() => setDeleteDialog(null)}>Отмена</button>
                <button className="btn btn-ghost" onClick={() => handleDeleteSelected('me')}>Удалить у себя</button>
                {deleteDialog.canAll && (
                  <button className="btn btn-danger" onClick={() => handleDeleteSelected('all')}>Удалить у всех</button>
                )}
              </div>
            </div>
          </div>
        </div>
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
