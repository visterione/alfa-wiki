import React, {useEffect, useState, useCallback, useRef} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  RefreshControl,
  Modal,
  Pressable,
  Alert,
  AppState,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Search, Pin, PinOff, Volume2, VolumeX, Trash2, X} from 'lucide-react-native';
import {chat as chatApi} from '../../services/api';
import SocketService from '../../services/socket';
import {useAuth} from '../../store/authStore';
import Avatar from '../../components/Avatar';
import LogoLoader from '../../components/LogoLoader';
import VoiceMiniPlayer from '../../components/VoiceMiniPlayer';
import {radius, shadow, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {setUnreadTotal} from '../../store/unreadStore';
import {setMutedChats} from '../../services/notifications';
import {stripFormatting} from '../../utils/richText';

/**
 * Текст превью последнего сообщения.
 *
 * Поле lastMessage приезжает в двух видах, и это не случайность:
 *   - GET /api/chat отдаёт СТРОКУ — в БД Chat.lastMessage это TEXT,
 *     бэкенд заранее кладёт туда готовое превью;
 *   - событие сокета new_message приносит ОБЪЕКТ сообщения.
 * Раньше рендер умел только второй вариант, поэтому после загрузки списка
 * превью было пустым и появлялось лишь когда прилетало новое сообщение.
 */
function messagePreview(lastMessage) {
  if (!lastMessage) return '';
  // Превью — простой текст в одну строку, форматированию тут места нет:
  // разметку ботов (*жирный*, [подпись](ссылка)) снимаем, оставляя читаемое
  if (typeof lastMessage === 'string') return stripFormatting(lastMessage);

  const text = lastMessage.content?.trim();
  if (text) return stripFormatting(text);

  const attachments = lastMessage.attachments;
  if (attachments?.length) {
    if (lastMessage.type === 'voice' || attachments[0]?.kind === 'voice') {
      return '🎤 Голосовое сообщение';
    }
    const allImages = attachments.every(a => a.mimeType?.startsWith('image/'));
    const suffix = attachments.length > 1 ? ` (${attachments.length})` : '';
    return allImages ? `📷 Фото${suffix}` : `📎 Файл${suffix}`;
  }
  return '';
}

function ChatItem({item, onPress, onLongPress, currentUserId}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  const unread = item.unreadCount > 0;
  const preview = messagePreview(item.lastMessage);

  // Автор последнего сообщения отдельной строкой — только в группах.
  // В личной переписке он и так очевиден: либо собеседник, либо вы.
  // Своё сообщение помечаем «Вы» — видно, ждёт ли чат ответа от вас.
  const sender = item.type === 'group' ? item.lastMessageSender : null;
  const senderLabel = sender
    ? (String(sender.id) === String(currentUserId) ? 'Вы' : sender.displayName)
    : null;

  return (
    <TouchableOpacity
      style={styles.chatItem}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={350}
      activeOpacity={0.7}>
      <Avatar
        uri={item.type === 'private' ? (item.otherUser?.avatar || item.avatar) : item.avatar}
        isGroup={item.type === 'group'}
        size={52}
      />
      <View style={styles.chatInfo}>
        <View style={styles.chatHeader}>
          <Text style={[styles.chatName, unread && styles.chatNameBold]} numberOfLines={1}>
            {item.displayName || 'Чат'}
          </Text>
          {/* Значки состояния — те же признаки, что в вебе */}
          {item.isPinned && <Pin size={13} color={c.textTertiary} style={styles.chatFlag} />}
          {item.isNotificationMuted && (
            <VolumeX size={13} color={c.textTertiary} style={styles.chatFlag} />
          )}
          {item.lastMessageAt && (
            <Text style={styles.chatTime}>{formatTime(item.lastMessageAt)}</Text>
          )}
        </View>
        {senderLabel && (
          <Text style={styles.senderLine} numberOfLines={1}>{senderLabel}</Text>
        )}

        <View style={styles.chatFooter}>
          <Text
            style={[styles.lastMessage, unread && styles.lastMessageBold]}
            numberOfLines={1}>
            {preview}
          </Text>
          {unread && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {item.unreadCount > 99 ? '99+' : item.unreadCount}
              </Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Порядок чатов: закреплённые сверху по своему порядку, остальные по свежести.
 *
 * Раньше сервер поднимал наверх «ассистента», причём этим флагом помечался
 * любой чат с ботом. Служебные чаты висели выше закреплённых, и закрепление
 * ничего не решало. Теперь исключение ровно одно — закрепление, и оно в руках
 * пользователя.
 *
 * Порядок повторяет веб: там закреплённые тоже выносятся наверх на клиенте.
 */
function sortChats(list) {
  const byDate = (a, b) => {
    const dateA = a.lastMessageAt ? new Date(a.lastMessageAt) : new Date(0);
    const dateB = b.lastMessageAt ? new Date(b.lastMessageAt) : new Date(0);
    return dateB - dateA;
  };

  const pinned = list
    .filter(ch => ch.isPinned)
    .sort((a, b) => (a.pinnedOrder ?? 0) - (b.pinnedOrder ?? 0));

  const rest = list.filter(ch => !ch.isPinned).sort(byDate);

  return [...pinned, ...rest];
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ChatListScreen({navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Панель лежит поверх экрана, иначе последний чат в списке уходит под неё
  const tabInset = useTabBarInset();

  const {user} = useAuth();
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const initialLoadDone = useRef(false);
  // Чат, по которому открыто меню действий (длинное нажатие)
  const [menuChat, setMenuChat] = useState(null);

  const loadChats = useCallback(async () => {
    try {
      const res = await chatApi.list();
      // Порядок сервера здесь не годится: закреплённые он ставит ниже ботов.
      // Раскладываем сами, как это делает веб.
      setChats(sortChats(res.data || []));
    } catch (err) {
      console.warn('[ChatList] load error:', err.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!initialLoadDone.current) {
        // First load — show spinner until data arrives
        loadChats().finally(() => {
          setLoading(false);
          initialLoadDone.current = true;
        });
      } else {
        // Subsequent focus — refresh silently without clearing the list
        setLoading(false);
        loadChats();
      }
    }, [loadChats]),
  );

  // Счётчик на центральной кнопке панели: пока открыты настройки или профиль,
  // списка чатов не видно, и это единственный признак нового сообщения.
  //
  // Заглушённые чаты не считаем. Боты пишут постоянно, и с ними счётчик навсегда
  // застревал бы на «99+» — то есть перестал бы что-либо сообщать. Заглушить чат
  // и означает «не дёргай меня по нему».
  useEffect(() => {
    setUnreadTotal(chats.reduce(
      (sum, ch) => sum + (ch.isNotificationMuted ? 0 : ch.unreadCount || 0),
      0,
    ));

    // Отсюда же кормим уведомления списком заглушённых. Список чатов —
    // единственное место, где эти флаги вообще приходят с сервера, а на iOS
    // уведомление рисуется из сокета и само о них не знает. Эффект висит на
    // chats, поэтому переключение «Заглушить» подхватывается сразу: оно
    // меняет тот же массив.
    setMutedChats(chats.filter(ch => ch.isNotificationMuted).map(ch => ch.id));
  }, [chats]);

  // Сбрасываем при выходе из аккаунта — экран живёт ровно пока есть сессия
  useEffect(() => () => setUnreadTotal(0), []);

  /**
   * Возврат из фона.
   *
   * Сокет на это время рвётся, и сообщения, пришедшие пока приложение было
   * свёрнуто, в список не попадают: они доставляются пушем, а тот ленту не
   * трогает. Без перезагрузки человек видел бы устаревший список и неверный
   * счётчик до тех пор, пока не переключит вкладку.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') loadChats();
    });
    return () => sub.remove();
  }, [loadChats]);

  useEffect(() => {
    SocketService.on('chatlist:new_message', 'new_message', data => {
      const incomingChatId = data.chat?.id ?? data.chatId;

      setChats(prev => {
        const known = prev.some(c => String(c.id) === String(incomingChatId));

        // Первое сообщение от нового собеседника — такого чата в списке ещё нет.
        // Раньше здесь был просто map, и строка не появлялась до перефокуса экрана.
        if (!known) {
          loadChats();
          return prev;
        }

        const updated = prev.map(c =>
          String(c.id) === String(incomingChatId)
            ? {
                ...c,
                lastMessage: data.message,
                lastMessageAt: data.message.createdAt,
                // Иначе третья строка показывала бы автора предыдущего
                // сообщения до следующей перезагрузки списка
                lastMessageSender: data.message.sender
                  ? {
                      id: data.message.sender.id,
                      displayName: data.message.sender.displayName || data.message.sender.username,
                    }
                  : c.lastMessageSender,
                unreadCount:
                  String(data.message.senderId) !== String(user?.id)
                    ? (c.unreadCount || 0) + 1
                    : c.unreadCount,
              }
            : c,
        );
        return sortChats(updated);
      });
    });
    return () => SocketService.off('chatlist:new_message');
  }, [user, loadChats]);

  // ── Действия над чатом ─────────────────────────────────────────────────────
  // Меняем состояние на месте и тут же отправляем на сервер: ждать ответа,
  // чтобы перерисовать галочку, — значит показывать залипшую кнопку.
  const applyLocally = (chatId, patch) => {
    setChats(prev => sortChats(prev.map(ch =>
      String(ch.id) === String(chatId) ? {...ch, ...patch} : ch,
    )));
  };

  const togglePin = async chat => {
    const next = !chat.isPinned;
    setMenuChat(null);
    applyLocally(chat.id, {isPinned: next});
    try {
      await chatApi.pinChat(chat.id, next);
      loadChats();
    } catch {
      applyLocally(chat.id, {isPinned: !next});
      Alert.alert('Не получилось', 'Не удалось изменить закрепление');
    }
  };

  const toggleMute = async chat => {
    const next = !chat.isNotificationMuted;
    setMenuChat(null);
    applyLocally(chat.id, {isNotificationMuted: next});
    try {
      await chatApi.muteChat(chat.id, next);
    } catch {
      applyLocally(chat.id, {isNotificationMuted: !next});
      Alert.alert('Не получилось', 'Не удалось изменить уведомления');
    }
  };

  const removeChat = chat => {
    setMenuChat(null);
    Alert.alert(
      'Удалить чат?',
      'Переписка исчезнет из списка, но не удалится у собеседника. Чат вернётся, когда придёт новое сообщение.',
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            setChats(prev => prev.filter(ch => String(ch.id) !== String(chat.id)));
            try {
              await chatApi.hideChat(chat.id, true);
            } catch {
              loadChats();
              Alert.alert('Не получилось', 'Не удалось удалить чат');
            }
          },
        },
      ],
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadChats();
    setRefreshing(false);
  };

  // Debounced backend search when query is long enough
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const res = await chatApi.search(q);
        setSearchResults(res.data);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const filteredChats = search.trim().length >= 2 ? searchResults : chats;

  const openChat = chat => {
    navigation.navigate('Chat', {
      chatId: chat.id,
      chatName: chat.displayName || chat.name,
      chatAvatar: chat.type === 'private' ? (chat.otherUser?.avatar || chat.avatar) : chat.avatar,
      chatType: chat.type,
      otherUserId: chat.otherUser?.id,
      otherUserIsOnline: chat.otherUser?.isOnline ?? false,
      // Для галочек «доставлено/прочитано» в чате
      otherMemberLastReadAt: chat.otherMemberLastReadAt ?? null,
      otherUserLastSeen: chat.otherUser?.lastSeen ?? null,
      groupMembers: chat.type === 'group' ? (chat.members || []) : [],
    });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <LogoLoader width={96} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBox}>
        <View style={styles.searchInner}>
          <Search size={16} color={c.textTertiary} style={{marginRight: 8}} />
          <TextInput
            style={styles.searchInput}
            placeholder="Поиск чатов..."
            placeholderTextColor={c.textTertiary}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      <FlatList
        data={filteredChats}
        contentContainerStyle={{paddingBottom: tabInset}}
        keyExtractor={(item, index) => item.id?.toString() || `chat_${index}`}
        renderItem={({item}) => (
          <ChatItem
            item={item}
            onPress={openChat}
            onLongPress={setMenuChat}
            currentUserId={user?.id}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            {searching
              ? <LogoLoader width={64} />
              : <Text style={styles.emptyText}>
                  {search.trim().length >= 2 ? 'Ничего не найдено' : 'Нет чатов'}
                </Text>
            }
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* Действия над чатом по долгому нажатию: те же три, что в вебе */}
      <Modal
        transparent
        visible={!!menuChat}
        animationType="fade"
        onRequestClose={() => setMenuChat(null)}>
        <Pressable style={styles.menuOverlay} onPress={() => setMenuChat(null)}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle} numberOfLines={1}>
              {menuChat?.displayName || 'Чат'}
            </Text>

            <TouchableOpacity style={styles.menuItem} onPress={() => togglePin(menuChat)}>
              {menuChat?.isPinned
                ? <PinOff size={20} color={c.textPrimary} />
                : <Pin size={20} color={c.textPrimary} />}
              <Text style={styles.menuItemText}>
                {menuChat?.isPinned ? 'Открепить' : 'Закрепить'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={() => toggleMute(menuChat)}>
              {menuChat?.isNotificationMuted
                ? <Volume2 size={20} color={c.textPrimary} />
                : <VolumeX size={20} color={c.textPrimary} />}
              <Text style={styles.menuItemText}>
                {menuChat?.isNotificationMuted ? 'Включить уведомления' : 'Заглушить'}
              </Text>
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={() => removeChat(menuChat)}>
              <Trash2 size={20} color={c.error} />
              <Text style={[styles.menuItemText, styles.menuItemDanger]}>Удалить чат</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuCancel} onPress={() => setMenuChat(null)}>
              <X size={18} color={c.textSecondary} />
              <Text style={styles.menuCancelText}>Отмена</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Голосовое, запущенное в каком-то чате, продолжает играть — отсюда им
          можно управлять, не возвращаясь в переписку */}
      <VoiceMiniPlayer />
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgPrimary},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},

  searchBox: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: c.bgPrimary,
    borderBottomWidth: 1,
    borderBottomColor: c.borderLight,
  },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bgSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: font.regular,
    color: c.textPrimary,
  },

  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    // Три строки вместо двух — и заодно крупнее: прежний размер был мелковат
    paddingVertical: 11,
  },
  chatInfo: {flex: 1, marginLeft: 13, justifyContent: 'center'},
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  chatName: {fontSize: 16, color: c.textPrimary, flex: 1, marginRight: 8, fontFamily: font.medium},
  chatNameBold: {fontFamily: font.semiBold},
  chatTime: {fontSize: 12, color: c.textTertiary, fontFamily: font.regular},
  chatFlag: {marginRight: 5},

  menuOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end'},
  menuSheet: {
    backgroundColor: c.bgPrimary,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingTop: 14, paddingBottom: 28, paddingHorizontal: 8,
  },
  menuTitle: {
    fontSize: 13, fontFamily: font.medium, color: c.textSecondary,
    paddingHorizontal: 14, marginBottom: 8,
  },
  menuItem: {flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14},
  menuItemText: {fontSize: 15.5, fontFamily: font.regular, color: c.textPrimary, marginLeft: 14},
  menuItemDanger: {color: c.error},
  menuDivider: {height: 1, backgroundColor: c.borderLight, marginVertical: 4, marginHorizontal: 14},
  menuCancel: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, marginTop: 6,
    backgroundColor: c.bgSecondary, borderRadius: radius.lg, marginHorizontal: 6,
  },
  menuCancelText: {fontSize: 15, fontFamily: font.medium, color: c.textSecondary, marginLeft: 8},
  chatFooter: {flexDirection: 'row', alignItems: 'center'},
  senderLine: {fontSize: 13.5, color: c.textSecondary, fontFamily: font.medium, marginBottom: 1},
  lastMessage: {fontSize: 14.5, color: c.textSecondary, flex: 1, fontFamily: font.regular},
  lastMessageBold: {color: c.textPrimary, fontFamily: font.medium},
  badge: {
    backgroundColor: c.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {color: '#FFFFFF', fontSize: 11, fontFamily: font.semiBold},
  separator: {height: 1, backgroundColor: c.borderLight, marginLeft: 81},
  empty: {paddingTop: 60, alignItems: 'center'},
  emptyText: {fontSize: 15, color: c.textTertiary, fontFamily: font.regular},

});
