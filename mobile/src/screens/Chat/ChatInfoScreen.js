import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  Pressable,
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
} from 'lucide-react-native';
import {chat as chatApi} from '../../services/api';
import {useAuth} from '../../store/authStore';
import Avatar from '../../components/Avatar';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';

/**
 * Информация о группе и управление ею.
 *
 * Отдельный экран, а не модалка поверх чата: действий много (участники, роли,
 * ограничения, переименование), и в модалке они не помещаются без вложенной
 * прокрутки. Набор возможностей повторяет веб — чтобы одна и та же группа
 * управлялась одинаково с телефона и из браузера.
 */

export default function ChatInfoScreen({route, navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const {user} = useAuth();
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

  // Данные группы берём из общего списка чатов: отдельного эндпоинта «дай один
  // чат с участниками» на бэкенде нет, а список уже отдаёт members целиком
  const load = useCallback(async () => {
    try {
      const res = await chatApi.list();
      const found = (res.data || []).find(ch => String(ch.id) === String(chatId));
      setChat(found ?? null);
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить данные группы');
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => { load(); }, [load]);

  const members = chat?.members ?? [];
  const myMembership = members.find(m => String(m.userId) === String(user?.id));
  const isAdmin = myMembership?.role === 'admin';
  const isCreator = String(chat?.createdBy) === String(user?.id);

  useEffect(() => {
    navigation.setOptions({title: chat?.displayName || 'Информация о группе'});
  }, [navigation, chat]);

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
        <Text style={styles.emptyText}>Группа не найдена</Text>
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Шапка группы */}
      <View style={styles.header}>
        <Avatar uri={chat.avatar} isGroup size={84} />
        <Text style={styles.groupName}>{chat.displayName || chat.name}</Text>
        <Text style={styles.groupMeta}>
          {members.length} {members.length === 1 ? 'участник' : members.length < 5 ? 'участника' : 'участников'}
        </Text>

        {isAdmin && (
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

      {/* Участники */}
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

      {/* Опасные действия */}
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
    </ScrollView>
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
