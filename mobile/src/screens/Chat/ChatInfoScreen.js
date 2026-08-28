import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  Pressable,
  Linking,
  useWindowDimensions,
} from 'react-native';
import {
  UserPlus,
  UserMinus,
  Pencil,
  Shield,
  ShieldOff,
  VolumeX,
  Volume2,
  LogOut,
  Trash2,
  X,
  Check,
  Search,
  Play,
  Briefcase,
  Building2,
  Mail,
  AtSign,
  Download,
} from 'lucide-react-native';
import {chat as chatApi} from '../../services/api';
import {useAuth} from '../../store/authStore';
import Avatar from '../../components/Avatar';
import LogoLoader from '../../components/LogoLoader';
import {saveAttachment} from '../../services/downloads';
import CONFIG from '../../config';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';

/**
 * Информация о собеседнике или о группе — и общие материалы переписки.
 *
 * Отдельный экран, а не модалка поверх чата: действий много (участники, роли,
 * ограничения, переименование), и в модалке они не помещаются без вложенной
 * прокрутки. Набор возможностей повторяет веб — чтобы одна и та же группа
 * управлялась одинаково с телефона и из браузера.
 *
 * Приватные чаты сюда пускались не сразу: раньше по шапке личной переписки
 * нельзя было даже посмотреть, кем работает собеседник. Теперь экран один на
 * оба вида чата и просто показывает разное: у группы — участников и управление
 * ими, у личной переписки — карточку сотрудника.
 *
 * Галерея чата (медиа, файлы, голосовые, ссылки) жила отдельной кнопкой в
 * шапке и открывалась своей модалкой. Две разные двери к сведениям об одной и
 * той же переписке — лишние: галерея переехала сюда вкладками, а кнопка из
 * шапки убрана.
 */

const MEDIA_TABS = [
  {key: 'media', label: 'Медиа'},
  {key: 'files', label: 'Файлы'},
  {key: 'voice', label: 'Голосовые'},
  {key: 'links', label: 'Ссылки'},
];

const MEDIA_LIMIT = 100;
const MEDIA_COLUMNS = 3;

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function memberCountLabel(n) {
  const tail = n % 100 >= 11 && n % 100 <= 14 ? 0 : n % 10;
  if (tail === 1) return `${n} участник`;
  if (tail >= 2 && tail <= 4) return `${n} участника`;
  return `${n} участников`;
}

export default function ChatInfoScreen({route, navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const {user} = useAuth();
  const {width} = useWindowDimensions();
  const {chatId} = route.params;

  const [chat, setChat] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [selected, setSelected] = useState([]);

  // Общие материалы переписки
  const [mediaTab, setMediaTab] = useState('media');
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(true);

  // Данные чата берём из общего списка: отдельного эндпоинта «дай один чат»
  // на бэкенде нет, а список уже отдаёт и members, и otherUser целиком
  const load = useCallback(async () => {
    try {
      const res = await chatApi.list();
      const found = (res.data || []).find(ch => String(ch.id) === String(chatId));
      setChat(found ?? null);
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить данные чата');
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => { load(); }, [load]);

  const isPrivate = chat?.type === 'private';
  const other = chat?.otherUser ?? null;

  const members = useMemo(() => chat?.members ?? [], [chat]);
  const myMembership = members.find(m => String(m.userId) === String(user?.id));
  const isAdmin = myMembership?.role === 'admin';
  const isCreator = String(chat?.createdBy) === String(user?.id);

  // Должности и медцентра в списке чатов нет — за ними идём в справочник
  // сотрудников. Тот же запрос обслуживает добавление участников в группу,
  // так что второго обращения к сети это не стоит.
  const profile = useMemo(
    () => (other ? users.find(u => String(u.id) === String(other.id)) ?? null : null),
    [users, other],
  );

  useEffect(() => {
    if (!isPrivate || users.length) return;
    chatApi.getUsers().then(res => setUsers(res.data || [])).catch(() => {});
  }, [isPrivate, users.length]);

  useEffect(() => {
    if (!chat) return;
    navigation.setOptions({
      title: isPrivate
        ? (chat.displayName || 'Собеседник')
        : (chat.displayName || 'Информация о группе'),
    });
  }, [navigation, chat, isPrivate]);

  // ── Общие материалы ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setMediaLoading(true);
    setMediaItems([]);
    chatApi.getChatMedia(chatId, mediaTab, {limit: MEDIA_LIMIT})
      .then(({data}) => { if (!cancelled) setMediaItems(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setMediaItems([]); })
      .finally(() => { if (!cancelled) setMediaLoading(false); });
    return () => { cancelled = true; };
  }, [chatId, mediaTab]);

  // Возврат в переписку к нужному сообщению. Экран чата остался в стеке под
  // нами, поэтому не открываем второй, а возвращаемся в него с параметром:
  // merge сохраняет остальные (chatId, имя, аватар), а nonce нужен, чтобы
  // повторный переход к тому же сообщению тоже сработал.
  const jumpToMessage = messageId => {
    navigation.navigate({
      name: 'Chat',
      params: {jumpToMessageId: messageId, jumpNonce: Date.now()},
      merge: true,
    });
  };

  // ── Действия ───────────────────────────────────────────────────────────────
  const guard = async (fn, errorText) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      Alert.alert('Не получилось', e?.response?.data?.error || errorText);
    } finally {
      setBusy(false);
    }
  };

  const rename = () => {
    const name = renameValue.trim();
    if (!name) return;
    setRenameOpen(false);
    guard(() => chatApi.renameGroup(chatId, name), 'Не удалось переименовать группу');
  };

  const toggleRole = member => {
    const next = member.role === 'admin' ? 'member' : 'admin';
    guard(
      () => chatApi.setMemberRole(chatId, member.userId, next),
      'Не удалось изменить роль',
    );
  };

  const toggleReadOnly = member => {
    guard(
      () => chatApi.setMemberReadOnly(chatId, member.userId, !member.isReadOnly),
      'Не удалось изменить ограничение',
    );
  };

  const removeMember = member => {
    const name = member.user?.displayName || member.user?.username || 'участника';
    Alert.alert('Удалить из группы?', `${name} потеряет доступ к переписке.`, [
      {text: 'Отмена', style: 'cancel'},
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => guard(
          () => chatApi.removeMember(chatId, member.userId),
          'Не удалось удалить участника',
        ),
      },
    ]);
  };

  const openAddMembers = async () => {
    setSelected([]);
    setUserSearch('');
    setAddOpen(true);
    try {
      const res = await chatApi.getUsers();
      setUsers(res.data || []);
    } catch {
      setUsers([]);
    }
  };

  const confirmAdd = () => {
    if (!selected.length) return;
    setAddOpen(false);
    guard(
      () => chatApi.bulkAddMembers(chatId, selected),
      'Не удалось добавить участников',
    );
  };

  const leave = () => {
    Alert.alert('Покинуть группу?', 'Переписка исчезнет из списка чатов.', [
      {text: 'Отмена', style: 'cancel'},
      {
        text: 'Покинуть',
        style: 'destructive',
        onPress: async () => {
          try {
            await chatApi.leave(chatId);
            // Возвращаемся к списку: чата у нас больше нет
            navigation.popToTop();
          } catch {
            Alert.alert('Не получилось', 'Не удалось покинуть группу');
          }
        },
      },
    ]);
  };

  const deleteGroup = () => {
    Alert.alert(
      'Удалить группу?',
      'Группа исчезнет у всех участников без возможности восстановить.',
      [
        {text: 'Отмена', style: 'cancel'},
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              await chatApi.deleteGroup(chatId);
              navigation.popToTop();
            } catch {
              Alert.alert('Не получилось', 'Не удалось удалить группу');
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <LogoLoader width={96} />
      </View>
    );
  }

  if (!chat) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Чат не найден</Text>
      </View>
    );
  }

  const alreadyIn = new Set(members.map(m => String(m.userId)));
  const candidates = users
    .filter(u => !alreadyIn.has(String(u.id)))
    .filter(u => {
      const q = userSearch.trim().toLowerCase();
      if (!q) return true;
      return (u.displayName || u.username || '').toLowerCase().includes(q);
    });

  // Сведения о сотруднике одной таблицей: пустые строки не показываем, иначе
  // у половины карточек висели бы прочерки
  const facts = isPrivate ? [
    {key: 'position', Icon: Briefcase, label: 'Должность', value: profile?.position},
    {
      key: 'medCenters',
      Icon: Building2,
      label: 'Медцентр',
      value: (profile?.medCenters || []).map(m => m.displayName || m.name).join(', '),
    },
    {key: 'email', Icon: Mail, label: 'Почта', value: profile?.email},
    {key: 'username', Icon: AtSign, label: 'Логин', value: other?.username},
  ].filter(f => f.value) : [];

  // Ширина ячейки сетки: три в ряд с полями по краям карточки
  const cellSize = Math.floor((width - 24 - 4) / MEDIA_COLUMNS);

  const header = (
    <View>
      {/* Шапка чата */}
      <View style={styles.header}>
        <Avatar uri={isPrivate ? other?.avatar : chat.avatar} isGroup={!isPrivate} size={84} />
        <Text style={styles.groupName}>{chat.displayName || chat.name}</Text>
        <Text style={styles.groupMeta}>
          {isPrivate
            ? (other?.isOnline ? 'онлайн' : 'офлайн')
            : memberCountLabel(members.length)}
        </Text>

        {!isPrivate && isAdmin && (
          <TouchableOpacity
            style={styles.renameBtn}
            onPress={() => {
              setRenameValue(chat.name || chat.displayName || '');
              setRenameOpen(true);
            }}>
            <Pencil size={15} color={c.primary} />
            <Text style={styles.renameBtnText}>Переименовать</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Карточка сотрудника — только в личной переписке */}
      {isPrivate && facts.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>О сотруднике</Text>
          </View>
          <View style={styles.card}>
            {facts.map((fact, i) => (
              <View key={fact.key}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.factRow}>
                  <fact.Icon size={19} color={c.textTertiary} />
                  <View style={styles.factText}>
                    <Text style={styles.factLabel}>{fact.label}</Text>
                    <Text style={styles.factValue}>{fact.value}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Участники — только в группе */}
      {!isPrivate && (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Участники</Text>
            {isAdmin && (
              <TouchableOpacity style={styles.addBtn} onPress={openAddMembers}>
                <UserPlus size={16} color={c.primary} />
                <Text style={styles.addBtnText}>Добавить</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.card}>
            {members.map((m, i) => {
              const isMe = String(m.userId) === String(user?.id);
              const memberIsCreator = String(chat.createdBy) === String(m.userId);
              return (
                <View key={m.userId}>
                  {i > 0 && <View style={styles.divider} />}
                  <View style={styles.memberRow}>
                    <Avatar uri={m.user?.avatar} size={42} />
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {m.user?.displayName || m.user?.username}
                        {isMe ? ' (вы)' : ''}
                      </Text>
                      <View style={styles.memberTags}>
                        {memberIsCreator && <Text style={styles.tag}>Создатель</Text>}
                        {!memberIsCreator && m.role === 'admin' && <Text style={styles.tag}>Админ</Text>}
                        {m.isReadOnly && <Text style={[styles.tag, styles.tagMuted]}>Только чтение</Text>}
                      </View>
                    </View>

                    {/* Управлять можно чужими записями и только админам.
                        Создателя не трогаем: снять с него права некому. */}
                    {isAdmin && !isMe && !memberIsCreator && (
                      <View style={styles.memberActions}>
                        <TouchableOpacity style={styles.iconBtn} onPress={() => toggleRole(m)}>
                          {m.role === 'admin'
                            ? <ShieldOff size={18} color={c.textSecondary} />
                            : <Shield size={18} color={c.textSecondary} />}
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.iconBtn} onPress={() => toggleReadOnly(m)}>
                          {m.isReadOnly
                            ? <Volume2 size={18} color={c.textSecondary} />
                            : <VolumeX size={18} color={c.textSecondary} />}
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.iconBtn} onPress={() => removeMember(m)}>
                          <UserMinus size={18} color={c.error} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Опасные действия — в личной переписке ни выйти, ни удалить нельзя */}
      {!isPrivate && (
        <View style={styles.section}>
          <View style={styles.card}>
            <TouchableOpacity style={styles.dangerRow} onPress={leave}>
              <LogOut size={19} color={c.error} />
              <Text style={styles.dangerText}>Покинуть группу</Text>
            </TouchableOpacity>
            {isCreator && (
              <>
                <View style={styles.divider} />
                <TouchableOpacity style={styles.dangerRow} onPress={deleteGroup}>
                  <Trash2 size={19} color={c.error} />
                  <Text style={styles.dangerText}>Удалить группу</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      )}

      {/* Общие материалы */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Общие материалы</Text>
        </View>
        <View style={styles.mediaTabs}>
          {MEDIA_TABS.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.mediaTab, mediaTab === tab.key && styles.mediaTabActive]}
              onPress={() => setMediaTab(tab.key)}>
              <Text style={[styles.mediaTabText, mediaTab === tab.key && styles.mediaTabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {mediaLoading && (
        <View style={styles.mediaPlaceholder}><LogoLoader width={80} /></View>
      )}
      {!mediaLoading && mediaItems.length === 0 && (
        <View style={styles.mediaPlaceholder}>
          <Text style={styles.emptyText}>Здесь пока пусто</Text>
        </View>
      )}
    </View>
  );

  const renderMedia = ({item}) => {
    const att = item.attachment || {};

    if (mediaTab === 'media') {
      const uri = CONFIG.fileUrl(att.thumbnailUrl || att.thumbnailPath || att.url || att.path);
      return (
        <TouchableOpacity
          style={[styles.mediaCell, {width: cellSize, height: cellSize}]}
          onPress={() => jumpToMessage(item.messageId)}>
          {att.mimeType?.startsWith('video/')
            ? <View style={styles.mediaCellVideo}><Play size={20} color={c.textTertiary} /></View>
            : <Image source={{uri}} style={styles.mediaCellImage} />}
        </TouchableOpacity>
      );
    }

    const isLink = mediaTab === 'links';
    const name = att.name || att.filename || 'Файл';
    const title = isLink
      ? (item.urls?.[0] || item.content)
      : att.kind === 'voice' ? 'Голосовое сообщение' : name;

    return (
      <View style={styles.mediaRow}>
        <TouchableOpacity
          style={styles.mediaRowBody}
          onPress={() => {
            if (isLink && item.urls?.[0]) {
              Linking.openURL(item.urls[0]).catch(() => {});
              return;
            }
            jumpToMessage(item.messageId);
          }}>
          <Text style={[styles.mediaRowTitle, isLink && styles.mediaRowLink]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.mediaRowMeta} numberOfLines={1}>
            {[item.senderName, new Date(item.createdAt).toLocaleDateString('ru-RU'), formatFileSize(att.size)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </TouchableOpacity>

        {/* Скачать можно прямо отсюда: ради одного файла возвращаться в
            переписку и искать там сообщение — лишний путь */}
        {mediaTab === 'files' && (
          <TouchableOpacity
            style={styles.mediaRowDownload}
            hitSlop={8}
            onPress={() => saveAttachment({
              url: CONFIG.fileUrl(att.url || att.path),
              name,
              mimeType: att.mimeType,
            })}>
            <Download size={18} color={c.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        // Смена числа колонок на лету не поддерживается — список пересоздаём
        key={mediaTab === 'media' ? 'grid' : 'rows'}
        numColumns={mediaTab === 'media' ? MEDIA_COLUMNS : 1}
        data={mediaLoading ? [] : mediaItems}
        keyExtractor={(item, idx) => `${item.messageId}:${idx}`}
        renderItem={renderMedia}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        columnWrapperStyle={mediaTab === 'media' ? styles.mediaGridRow : undefined}
      />

      {/* Переименование */}
      <Modal transparent visible={renameOpen} animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setRenameOpen(false)}>
          <Pressable style={styles.modalCard}>
            <Text style={styles.modalTitle}>Переименовать группу</Text>
            <TextInput
              style={styles.input}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Название группы"
              placeholderTextColor={c.textTertiary}
              autoFocus
              maxLength={100}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalBtn} onPress={() => setRenameOpen(false)}>
                <Text style={styles.modalBtnText}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnPrimary]} onPress={rename}>
                <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>Сохранить</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Добавление участников */}
      <Modal transparent visible={addOpen} animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.sheetOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.modalTitle}>Добавить участников</Text>
              <TouchableOpacity onPress={() => setAddOpen(false)}>
                <X size={22} color={c.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchBox}>
              <Search size={16} color={c.textTertiary} />
              <TextInput
                style={styles.searchInput}
                value={userSearch}
                onChangeText={setUserSearch}
                placeholder="Поиск по имени..."
                placeholderTextColor={c.textTertiary}
              />
            </View>

            <ScrollView style={styles.candidates}>
              {candidates.map(u => {
                const picked = selected.includes(u.id);
                return (
                  <TouchableOpacity
                    key={u.id}
                    style={styles.candidateRow}
                    onPress={() => setSelected(prev =>
                      picked ? prev.filter(id => id !== u.id) : [...prev, u.id],
                    )}>
                    <Avatar uri={u.avatar} size={36} />
                    <Text style={styles.candidateName} numberOfLines={1}>
                      {u.displayName || u.username}
                    </Text>
                    {picked && <Check size={20} color={c.primary} />}
                  </TouchableOpacity>
                );
              })}
              {candidates.length === 0 && (
                <Text style={styles.emptyText}>Некого добавить</Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.confirmBtn, !selected.length && styles.confirmBtnOff]}
              onPress={confirmAdd}
              disabled={!selected.length}>
              <Text style={styles.confirmBtnText}>
                {selected.length ? `Добавить (${selected.length})` : 'Выберите участников'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgSecondary},
  content: {paddingBottom: 40},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bgSecondary},

  header: {alignItems: 'center', paddingVertical: 22, backgroundColor: c.bgPrimary},
  groupName: {fontSize: 19, fontFamily: font.semiBold, color: c.textPrimary, marginTop: 12, textAlign: 'center', paddingHorizontal: 24},
  groupMeta: {fontSize: 13.5, fontFamily: font.regular, color: c.textSecondary, marginTop: 3},
  renameBtn: {flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingVertical: 7, paddingHorizontal: 14, borderRadius: radius.lg, backgroundColor: c.primaryLight},
  renameBtnText: {fontSize: 14, fontFamily: font.medium, color: c.primary, marginLeft: 7},

  section: {marginTop: 20},
  sectionHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, marginBottom: 8},
  sectionTitle: {fontSize: 13, fontFamily: font.medium, color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4},
  addBtn: {flexDirection: 'row', alignItems: 'center'},
  addBtnText: {fontSize: 14, fontFamily: font.medium, color: c.primary, marginLeft: 5},

  card: {backgroundColor: c.bgPrimary, marginHorizontal: 12, borderRadius: radius.lg, overflow: 'hidden'},
  divider: {height: 1, backgroundColor: c.borderLight, marginLeft: 66},

  factRow: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12},
  factText: {flex: 1, marginLeft: 14},
  factLabel: {fontSize: 12, fontFamily: font.regular, color: c.textTertiary},
  factValue: {fontSize: 15, fontFamily: font.regular, color: c.textPrimary, marginTop: 2},

  memberRow: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10},
  memberInfo: {flex: 1, marginLeft: 12, marginRight: 8},
  memberName: {fontSize: 15, fontFamily: font.regular, color: c.textPrimary},
  memberTags: {flexDirection: 'row', marginTop: 3, flexWrap: 'wrap'},
  tag: {
    fontSize: 11, fontFamily: font.medium, color: c.primary,
    backgroundColor: c.primaryLight, paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 8, marginRight: 5, overflow: 'hidden',
  },
  tagMuted: {color: c.textSecondary, backgroundColor: c.bgTertiary},
  memberActions: {flexDirection: 'row'},
  iconBtn: {padding: 7},

  dangerRow: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15},
  dangerText: {fontSize: 15.5, fontFamily: font.regular, color: c.error, marginLeft: 13},

  // Общие материалы
  mediaTabs: {flexDirection: 'row', marginHorizontal: 12, backgroundColor: c.bgPrimary, borderRadius: radius.lg, padding: 4},
  mediaTab: {flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.md},
  mediaTabActive: {backgroundColor: c.primaryLight},
  mediaTabText: {fontSize: 13, fontFamily: font.medium, color: c.textSecondary},
  mediaTabTextActive: {color: c.primary},
  mediaPlaceholder: {alignItems: 'center', justifyContent: 'center', paddingVertical: 34},
  mediaGridRow: {paddingHorizontal: 12, gap: 2},
  mediaCell: {marginTop: 2, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: c.bgTertiary},
  mediaCellImage: {width: '100%', height: '100%'},
  mediaCellVideo: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  mediaRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 12, marginTop: 2, paddingHorizontal: 14, paddingVertical: 11,
    backgroundColor: c.bgPrimary, borderRadius: radius.md,
  },
  mediaRowBody: {flex: 1},
  mediaRowTitle: {fontSize: 14.5, fontFamily: font.medium, color: c.textPrimary},
  mediaRowLink: {color: c.primary},
  mediaRowMeta: {fontSize: 12, fontFamily: font.regular, color: c.textTertiary, marginTop: 2},
  mediaRowDownload: {padding: 6, marginLeft: 8},

  emptyText: {fontSize: 14, fontFamily: font.regular, color: c.textTertiary, textAlign: 'center', paddingVertical: 24},

  modalOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28},
  modalCard: {width: '100%', backgroundColor: c.bgPrimary, borderRadius: radius.xl, padding: 20},
  modalTitle: {fontSize: 17, fontFamily: font.semiBold, color: c.textPrimary},
  input: {
    marginTop: 14, backgroundColor: c.bgSecondary, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 15,
    fontFamily: font.regular, color: c.textPrimary,
  },
  modalActions: {flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16},
  modalBtn: {paddingVertical: 9, paddingHorizontal: 16, borderRadius: radius.md, marginLeft: 8},
  modalBtnPrimary: {backgroundColor: c.primary},
  modalBtnText: {fontSize: 15, fontFamily: font.medium, color: c.textSecondary},
  modalBtnTextPrimary: {color: '#FFFFFF'},

  sheetOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end'},
  sheet: {
    backgroundColor: c.bgPrimary, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingTop: 16, paddingHorizontal: 16, paddingBottom: 24, maxHeight: '82%',
  },
  sheetHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  searchBox: {
    flexDirection: 'row', alignItems: 'center', marginTop: 14,
    backgroundColor: c.bgSecondary, borderRadius: radius.lg, paddingHorizontal: 12, paddingVertical: 9,
  },
  searchInput: {flex: 1, marginLeft: 8, fontSize: 15, fontFamily: font.regular, color: c.textPrimary, padding: 0},
  candidates: {marginTop: 12},
  candidateRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 9},
  candidateName: {flex: 1, marginLeft: 12, fontSize: 15, fontFamily: font.regular, color: c.textPrimary},
  confirmBtn: {
    marginTop: 12, backgroundColor: c.primary, borderRadius: radius.lg,
    paddingVertical: 14, alignItems: 'center',
  },
  confirmBtnOff: {backgroundColor: c.bgTertiary},
  confirmBtnText: {fontSize: 15.5, fontFamily: font.semiBold, color: '#FFFFFF'},
});
