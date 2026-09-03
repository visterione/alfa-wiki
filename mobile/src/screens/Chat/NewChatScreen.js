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
import {Search} from 'lucide-react-native';
import {chat as chatApi} from '../../services/api';
import Avatar from '../../components/Avatar';
import UserBadge from '../../components/UserBadge';
import LogoLoader from '../../components/LogoLoader';
import {useAuth} from '../../store/authStore';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';

/**
 * Личная переписка: выбрать человека — и всё.
 *
 * До ver. 7.75 этот экран открывался с двумя вкладками, «Личный чат» и
 * «Группа», и первый шаг создания любого чата был одинаков — выбрать, что
 * именно создаёшь. Но это два разных дела: в личный чат уходишь одним касанием
 * по имени, а группу собираешь. Вкладки уравнивали их в правах и заставляли
 * выбирать режим даже того, кто просто хотел написать коллеге.
 *
 * Теперь группа живёт в NewGroupScreen, а здесь нет ни выбора, ни кнопки
 * подтверждения: касание по сотруднику сразу открывает переписку. Промежуточное
 * состояние «выбран один человек, нажмите Начать чат» ничего не решало —
 * отменить выбор и так можно кнопкой «назад».
 */
export default function NewChatScreen({navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  // Панель вкладок на этом экране скрыта, а окно рисуется под системной
  // панелью навигации — на аппаратах с тремя кнопками она перекрывала
  // последнего сотрудника в списке.
  const insets = useSafeAreaInsets();

  const {user} = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [opening, setOpening] = useState(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [medCenterFilter, setMedCenterFilter] = useState('');

  useEffect(() => {
    chatApi
      .getUsers()
      .then(res => setUsers(res.data.filter(u => u.id !== user?.id)))
      .catch(err => Alert.alert('Ошибка', err.message))
      .finally(() => setLoading(false));
  }, [user]);

  const startChat = async target => {
    // Двойное касание по строке успевало создать два запроса, пока шёл первый
    if (opening) return;
    setOpening(target.id);
    try {
      const res = await chatApi.startPrivate(target.id);
      navigation.replace('Chat', {
        chatId: res.data.id,
        chatName: res.data.displayName,
        chatType: 'private',
      });
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.error || err.message);
      setOpening(null);
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

      {loading ? (
        <View style={styles.center}>
          <LogoLoader width={96} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          contentContainerStyle={{paddingBottom: insets.bottom}}
          keyExtractor={(item, index) => item.id?.toString() || `user_${index}`}
          renderItem={({item}) => (
            <TouchableOpacity
              style={[styles.userItem, opening === item.id && styles.userItemBusy]}
              onPress={() => startChat(item)}
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
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>Нет сотрудников</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgPrimary},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40},

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
  userItemBusy: {backgroundColor: c.primaryLight},
  userInfo: {flex: 1, marginLeft: 13},
  userNameRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  userName: {fontSize: 15, color: c.textPrimary, fontFamily: font.medium},
  userPosition: {fontSize: 12, fontFamily: font.regular, color: c.textSecondary, marginTop: 2},
  separator: {height: 1, backgroundColor: c.borderLight, marginLeft: 73},
  emptyText: {fontSize: 15, fontFamily: font.regular, color: c.textTertiary},
});
