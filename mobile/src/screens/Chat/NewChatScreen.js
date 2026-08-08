import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import {MessageSquare, Users, Check, Search} from 'lucide-react-native';
import {chat as chatApi} from '../../services/api';
import Avatar from '../../components/Avatar';
import UserBadge from '../../components/UserBadge';
import LogoLoader from '../../components/LogoLoader';
import {useAuth} from '../../store/authStore';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';

export default function NewChatScreen({navigation, route}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Панель вкладок на этом экране скрыта, а окно рисуется под системной
  // панелью навигации — на аппаратах с тремя кнопками она перекрывала кнопку
  // создания чата и последнего сотрудника в списке.
  const insets = useSafeAreaInsets();

  const {user} = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState(route?.params?.initialMode || 'private');
  const [roleFilter, setRoleFilter] = useState('');
  const [medCenterFilter, setMedCenterFilter] = useState('');

  useEffect(() => {
    chatApi
      .getUsers()
      .then(res => setUsers(res.data.filter(u => u.id !== user?.id)))
      .catch(err => Alert.alert('Ошибка', err.message))
      .finally(() => setLoading(false));
  }, [user]);

  const toggleSelect = u => {
    setSelected(prev =>
      prev.find(x => x.id === u.id)
        ? prev.filter(x => x.id !== u.id)
        : [...prev, u],
    );
  };

  const startChat = async () => {
    if (selected.length === 0) {
      Alert.alert('Выберите участника');
      return;
    }
    if (mode === 'group' && !groupName.trim()) {
      Alert.alert('Укажите название группы');
      return;
    }
    setCreating(true);
    try {
      if (mode === 'private') {
        const res = await chatApi.startPrivate(selected[0].id);
        navigation.replace('Chat', {
          chatId: res.data.id,
          chatName: res.data.displayName,
          chatType: 'private',
        });
      } else {
        const res = await chatApi.createGroup(
          groupName.trim(),
          selected.map(u => u.id),
        );
        navigation.replace('Chat', {
          chatId: res.data.id,
          chatName: res.data.name,
          chatType: 'group',
        });
      }
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.error || err.message);
    } finally {
      setCreating(false);
    }
  };

  const getRoleNames = u => [...new Set([u.role?.name, ...(u.roles || []).map(r => r.name)].filter(Boolean))];
  const roles = [...new Set(users.flatMap(getRoleNames))].sort();
  const medCenters = [...new Set(users.flatMap(u => (u.medCenters || []).map(mc => mc.name)).filter(Boolean))].sort();
  const query = search.trim().toLowerCase();
  const filtered = users.filter(u => {
    const searchable = [
      u.displayName, u.username, u.position, ...getRoleNames(u), u.chatBadge?.label,
      ...(u.medCenters || []).map(mc => mc.name),
    ].filter(Boolean).join(' ').toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (roleFilter && !getRoleNames(u).includes(roleFilter)) return false;
    if (medCenterFilter && !(u.medCenters || []).some(mc => mc.name === medCenterFilter)) return false;
    return true;
  });

  return (
    <View style={styles.container}>
      {/* Mode tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, mode === 'private' && styles.tabActive]}
          onPress={() => {setMode('private'); setSelected([]);}}>
          <MessageSquare
            size={16}
            color={mode === 'private' ? c.primary : c.textSecondary}
            style={{marginRight: 7}}
          />
          <Text style={[styles.tabText, mode === 'private' && styles.tabTextActive]}>
            Личный чат
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, mode === 'group' && styles.tabActive]}
          onPress={() => {setMode('group'); setSelected([]);}}>
          <Users
            size={16}
            color={mode === 'group' ? c.primary : c.textSecondary}
            style={{marginRight: 7}}
          />
          <Text style={[styles.tabText, mode === 'group' && styles.tabTextActive]}>
            Группа
          </Text>
        </TouchableOpacity>
      </View>

      {/* Group name input */}
      {mode === 'group' && (
        <View style={styles.groupNameWrap}>
          <TextInput
            style={styles.groupNameInput}
            placeholder="Название группы *"
            placeholderTextColor={c.textTertiary}
            value={groupName}
            onChangeText={setGroupName}
          />
        </View>
      )}

      {/* Hint */}
      <Text style={styles.hint}>
        {mode === 'private'
          ? 'Выберите одного сотрудника'
          : `Выберите участников (выбрано: ${selected.length})`}
      </Text>

      {/* Search */}
      <View style={styles.searchWrap}>
        <View style={styles.searchInner}>
          <Search size={15} color={c.textTertiary} style={{marginRight: 8}} />
          <TextInput
            style={styles.searchInput}
            placeholder="Поиск сотрудников..."
            placeholderTextColor={c.textTertiary}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      {(roles.length > 0 || medCenters.length > 0) && (
        <View style={styles.filters}>
          {roles.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              <TouchableOpacity style={[styles.filterChip, !roleFilter && styles.filterChipActive]} onPress={() => setRoleFilter('')}><Text style={[styles.filterText, !roleFilter && styles.filterTextActive]}>Все роли</Text></TouchableOpacity>
              {roles.map(role => <TouchableOpacity key={role} style={[styles.filterChip, roleFilter === role && styles.filterChipActive]} onPress={() => setRoleFilter(roleFilter === role ? '' : role)}><Text style={[styles.filterText, roleFilter === role && styles.filterTextActive]}>{role}</Text></TouchableOpacity>)}
            </ScrollView>
          )}
          {medCenters.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              <TouchableOpacity style={[styles.filterChip, !medCenterFilter && styles.filterChipActive]} onPress={() => setMedCenterFilter('')}><Text style={[styles.filterText, !medCenterFilter && styles.filterTextActive]}>Все медцентры</Text></TouchableOpacity>
              {medCenters.map(mc => <TouchableOpacity key={mc} style={[styles.filterChip, medCenterFilter === mc && styles.filterChipActive]} onPress={() => setMedCenterFilter(medCenterFilter === mc ? '' : mc)}><Text style={[styles.filterText, medCenterFilter === mc && styles.filterTextActive]}>{mc}</Text></TouchableOpacity>)}
            </ScrollView>
          )}
        </View>
      )}

      {/* Users list */}
      {loading ? (
        <View style={styles.center}>
          <LogoLoader width={96} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          contentContainerStyle={{paddingBottom: insets.bottom}}
          keyExtractor={(item, index) => item.id?.toString() || `user_${index}`}
          renderItem={({item}) => {
            const isSelected = !!selected.find(x => x.id === item.id);
            const disabled = mode === 'private' && selected.length === 1 && !isSelected;
            return (
              <TouchableOpacity
                style={[
                  styles.userItem,
                  isSelected && styles.userItemSelected,
                  disabled && styles.userItemDisabled,
                ]}
                onPress={() => {
                  if (mode === 'private') {
                    setSelected(isSelected ? [] : [item]);
                  } else {
                    toggleSelect(item);
                  }
                }}
                disabled={disabled}
                activeOpacity={0.7}>
                <Avatar uri={item.avatar} size={44} />
                <View style={styles.userInfo}>
                  <View style={styles.userNameRow}>
                    <Text style={styles.userName}>{item.displayName || item.username}</Text>
                    <UserBadge badge={item.chatBadge} size={16} />
                  </View>
                  <Text style={styles.userPosition} numberOfLines={1}>
                    {[getRoleNames(item).join(', '), item.position, (item.medCenters || []).map(mc => mc.name).join(', ')].filter(Boolean).join(' · ') || `@${item.username}`}
                  </Text>
                </View>
                {isSelected && <Check size={18} color={c.primary} />}
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>Нет сотрудников</Text>
            </View>
          }
        />
      )}

      {/* Create button */}
      {selected.length > 0 && (
        <View style={[styles.createBar, {paddingBottom: Math.max(insets.bottom, 24)}]}>
          <TouchableOpacity
            onPress={startChat}
            disabled={creating}
            activeOpacity={0.85}
            style={styles.createBtnWrap}>
            <LinearGradient
              colors={creating ? ['#93C5FD', '#93C5FD'] : [c.primary, c.secondary]}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={styles.createBtn}>
              {creating ? (
                <LogoLoader width={52} color="#FFFFFF" />
              ) : (
                <Text style={styles.createBtnText} numberOfLines={1}>
                  {mode === 'private'
                    ? 'Начать чат'
                    : `Создать группу (${selected.length})`}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgPrimary},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40},

  // Tabs
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: c.borderLight,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {borderBottomColor: c.primary},
  tabText: {fontSize: 14, color: c.textSecondary, fontFamily: font.medium},
  tabTextActive: {color: c.primary, fontFamily: font.semiBold},

  // Group name
  groupNameWrap: {paddingHorizontal: 16, paddingTop: 14},
  groupNameInput: {
    height: 48,
    backgroundColor: c.bgSecondary,
    borderWidth: 1.5,
    borderColor: c.border,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: font.regular,
    color: c.textPrimary,
  },

  // Hint
  hint: {
    fontSize: 12,
    color: c.textTertiary,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    fontFamily: font.medium,
  },

  // Search
  searchWrap: {
    paddingHorizontal: 16,
    paddingVertical: 10,
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
  searchInput: {flex: 1, fontSize: 15, fontFamily: font.regular, color: c.textPrimary},

  filters: {paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: c.borderLight},
  filterRow: {paddingHorizontal: 12, paddingVertical: 3},
  filterChip: {paddingHorizontal: 11, paddingVertical: 6, marginHorizontal: 3, borderRadius: 14, backgroundColor: c.bgSecondary, borderWidth: 1, borderColor: c.border},
  filterChipActive: {backgroundColor: c.primary, borderColor: c.primary},
  filterText: {fontSize: 12, color: c.textSecondary, fontFamily: font.medium},
  filterTextActive: {color: '#FFFFFF'},

  // User items
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userItemSelected: {backgroundColor: c.primaryLight},
  userItemDisabled: {opacity: 0.35},
  userInfo: {flex: 1, marginLeft: 13},
  userNameRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  userName: {fontSize: 15, color: c.textPrimary, fontFamily: font.medium},
  userPosition: {fontSize: 12, fontFamily: font.regular, color: c.textSecondary, marginTop: 2},
  separator: {height: 1, backgroundColor: c.borderLight, marginLeft: 73},
  emptyText: {fontSize: 15, fontFamily: font.regular, color: c.textTertiary},

  // Create button
  createBar: {
    flexShrink: 0,
    paddingTop: 10,
    paddingHorizontal: 16,
    backgroundColor: c.bgPrimary,
    borderTopWidth: 1,
    borderTopColor: c.borderLight,
  },
  createBtnWrap: {width: '100%'},
  createBtn: {
    borderRadius: radius.lg,
    paddingVertical: 15,
    alignItems: 'center',
  },
  createBtnText: {color: '#FFFFFF', fontSize: 15, fontFamily: font.semiBold},
});
