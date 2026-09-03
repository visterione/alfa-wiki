import React, {useCallback, useEffect, useState} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import {launchImageLibrary} from 'react-native-image-picker';
import {Bot, Camera, Check, Search, X} from 'lucide-react-native';
import {chat as chatApi} from '../../services/api';
import Avatar from '../../components/Avatar';
import UserBadge from '../../components/UserBadge';
import LogoLoader from '../../components/LogoLoader';
import AvatarCropper, {CroppedThumb} from '../../components/AvatarCropper';
import {useAuth} from '../../store/authStore';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';

/**
 * Создание группы — два шага, как в мессенджерах, к которым все привыкли.
 *
 * Раньше это была вторая вкладка «нового чата»: одно окно, где название,
 * участники и фильтры лежали вперемешку, аватар выбрать было негде, а бота
 * можно было добавить только в уже созданную группу — то есть создать её,
 * открыть, зайти в «Добавить участника» и найти его там.
 *
 * Здесь порядок обратный привычному экрану списка: сначала собираем состав
 * (шаг «members»), потом даём группе лицо и имя (шаг «about»). Так последним
 * действием остаётся ввод названия, и клавиатура открывается ровно один раз —
 * при наборе имени, а не поверх списка сотрудников.
 *
 * Боты стоят отдельным разделом в конце списка: их немного, они не сотрудники,
 * и в общем перечне их искали бы среди сотен людей. Сервер их в /chat/users не
 * отдаёт вовсе, так что список приходится запрашивать вторым вызовом.
 *
 * Аватар уходит на сервер отдельным запросом уже после создания: до появления
 * группы её и загружать некуда. Если картинка не долетит — группа всё равно
 * создана, и мы говорим об этом прямо, а не откатываем всё сделанное.
 */
export default function NewGroupScreen({navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const {user} = useAuth();
  const [step, setStep] = useState('members');
  const [users, setUsers] = useState([]);
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState('');
  // Снимок, выбранная в нём область и его размеры ходят вместе: без рамки
  // сервер обрежет по центру, без размеров нечем показать предпросмотр
  const [avatar, setAvatar] = useState(null);
  const [cropping, setCropping] = useState(null);
  const [creating, setCreating] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [medCenterFilter, setMedCenterFilter] = useState('');

  useEffect(() => {
    Promise.all([chatApi.getUsers(), chatApi.getBots()])
      .then(([usersRes, botsRes]) => {
        setUsers(usersRes.data.filter(u => u.id !== user?.id));
        setBots(botsRes.data.map(b => ({...b, isBot: true})));
      })
      .catch(err => Alert.alert('Ошибка', err.message))
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    navigation.setOptions({
      title: step === 'members' ? 'Новая группа' : 'Название группы',
    });
  }, [navigation, step]);

  // «Назад» со второго шага возвращает к составу, а не закрывает экран целиком:
  // иначе случайное касание стрелки стирало бы весь набранный список
  useEffect(() => {
    if (step !== 'about') return undefined;
    const unsubscribe = navigation.addListener('beforeRemove', e => {
      if (e.data.action.type !== 'GO_BACK') return;
      e.preventDefault();
      setStep('members');
    });
    return unsubscribe;
  }, [navigation, step]);

  const toggleSelect = u => {
    setSelected(prev =>
      prev.find(x => x.id === u.id)
        ? prev.filter(x => x.id !== u.id)
        : [...prev, u],
    );
  };

  const pickAvatar = useCallback(() => {
    launchImageLibrary({mediaType: 'photo', selectionLimit: 1, includeBase64: false}, res => {
      if (res.didCancel || res.errorCode) return;
      const asset = res.assets?.[0];
      if (!asset) return;
      // Тот же предел, что и у маршрута загрузки: отказать до отправки честнее,
      // чем после минуты ожидания на мобильном интернете
      if (asset.fileSize > 5 * 1024 * 1024) {
        Alert.alert('Ошибка', 'Максимальный размер файла 5MB');
        return;
      }
      // Сразу в окно обрезки: вертикальный снимок иначе попал бы в кружок
      // серединой кадра, и понятно это стало бы только после загрузки
      setCropping(asset);
    });
  }, []);

  const createGroup = async () => {
    if (!groupName.trim()) {
      Alert.alert('Укажите название группы');
      return;
    }
    setCreating(true);
    try {
      const res = await chatApi.createGroup(
        groupName.trim(),
        selected.map(u => u.id),
      );

      if (avatar) {
        try {
          await chatApi.updateGroupAvatar(res.data.id, avatar.asset, avatar.crop);
        } catch {
          Alert.alert('Группа создана', 'Но фото загрузить не удалось — его можно поставить в настройках группы');
        }
      }

      navigation.replace('Chat', {
        chatId: res.data.id,
        chatName: res.data.name,
        chatType: 'group',
      });
    } catch (err) {
      Alert.alert('Ошибка', err.response?.data?.error || err.message);
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

  // Фильтры по роли и медцентру к ботам неприменимы — ни того, ни другого у них
  // нет, и включённый фильтр просто прятал бы весь раздел
  const filteredBots = bots.filter(b => {
    if (roleFilter || medCenterFilter) return false;
    if (!query) return true;
    return [b.displayName, b.username].filter(Boolean).join(' ').toLowerCase().includes(query);
  });

  const renderRow = (item, isBot) => {
    const isSelected = !!selected.find(x => x.id === item.id);
    return (
      <TouchableOpacity
        style={[styles.userItem, isSelected && styles.userItemSelected]}
        onPress={() => toggleSelect(item)}
        activeOpacity={0.7}>
        {isBot && !item.avatar ? (
          <View style={styles.botStub}><Bot size={22} color={c.textSecondary} /></View>
        ) : (
          <Avatar uri={item.avatar} size={44} />
        )}
        <View style={styles.userInfo}>
          <View style={styles.userNameRow}>
            <Text style={styles.userName}>{item.displayName || item.username}</Text>
            <UserBadge badge={item.chatBadge} size={16} />
          </View>
          <Text style={styles.userPosition} numberOfLines={1}>
            {isBot
              ? `@${item.username} · бот`
              : [getRoleNames(item).join(', '), item.position, (item.medCenters || []).map(mc => mc.name).join(', ')].filter(Boolean).join(' · ') || `@${item.username}`}
          </Text>
        </View>
        {isSelected && <Check size={18} color={c.primary} />}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <LogoLoader width={96} />
      </View>
    );
  }

  if (step === 'about') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.aboutContent}>
          <View style={styles.aboutHead}>
            <TouchableOpacity
              // Касание по самому кружку возвращает в окно обрезки: поправить
              // область — дело более частое, чем выбрать другой снимок
              onPress={() => (avatar ? setCropping(avatar.asset) : pickAvatar())}
              activeOpacity={0.8}>
              {avatar ? (
                // CroppedThumb, а не Avatar: снимок ещё не на сервере (Avatar
                // достроил бы file:// до адреса портала и получил битую ссылку),
                // и показать нужно ровно выбранную область
                <CroppedThumb
                  uri={avatar.asset.uri}
                  crop={avatar.crop}
                  source={avatar.source}
                  size={92}
                />
              ) : (
                <LinearGradient
                  colors={[c.primary, c.secondary]}
                  start={{x: 0, y: 0}}
                  end={{x: 1, y: 1}}
                  style={styles.avatarPick}>
                  <Camera size={30} color="#FFFFFF" />
                </LinearGradient>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={pickAvatar} activeOpacity={0.7}>
              <Text style={styles.avatarHint}>
                {avatar ? 'Изменить фото' : 'Добавить фото'}
              </Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.groupNameInput}
            placeholder="Название группы"
            placeholderTextColor={c.textTertiary}
            value={groupName}
            onChangeText={setGroupName}
            autoFocus
            returnKeyType="done"
          />

          <Text style={styles.sectionTitle}>
            Участники: {selected.length}
          </Text>
          {selected.map(m => (
            <View key={m.id} style={styles.memberRow}>
              {m.isBot && !m.avatar ? (
                <View style={styles.botStubSm}><Bot size={18} color={c.textSecondary} /></View>
              ) : (
                <Avatar uri={m.avatar} size={36} />
              )}
              <Text style={styles.memberName} numberOfLines={1}>
                {m.displayName || m.username}
                {m.isBot ? ' · бот' : ''}
              </Text>
              <TouchableOpacity
                onPress={() => setSelected(prev => prev.filter(x => x.id !== m.id))}
                hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
                <X size={16} color={c.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>

        <View style={[styles.createBar, {paddingBottom: Math.max(insets.bottom, 24)}]}>
          <TouchableOpacity
            onPress={createGroup}
            disabled={creating || !groupName.trim()}
            activeOpacity={0.85}>
            <LinearGradient
              colors={groupName.trim() && !creating ? [c.primary, c.secondary] : [c.border, c.border]}
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={styles.createBtn}>
              {creating ? (
                <LogoLoader width={52} color="#FFFFFF" />
              ) : (
                <Text style={styles.createBtnText}>Создать группу</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <AvatarCropper
          visible={!!cropping}
          asset={cropping}
          onCancel={() => setCropping(null)}
          onDone={({crop, source}) => {
            setAvatar({asset: cropping, crop, source});
            setCropping(null);
          }}
        />
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      {selected.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipsWrap}>
          {selected.map(m => (
            <TouchableOpacity
              key={m.id}
              style={styles.chip}
              onPress={() => toggleSelect(m)}
              activeOpacity={0.7}>
              <Text style={styles.chipText} numberOfLines={1}>
                {m.displayName || m.username}
              </Text>
              <X size={13} color={c.primary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

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

      <FlatList
        data={filtered}
        contentContainerStyle={{paddingBottom: selected.length > 0 ? 0 : insets.bottom}}
        keyExtractor={(item, index) => item.id?.toString() || `user_${index}`}
        renderItem={({item}) => renderRow(item, false)}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          filteredBots.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyText}>Нет сотрудников</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          filteredBots.length > 0 ? (
            <View>
              <Text style={styles.listSection}>Боты</Text>
              {filteredBots.map(b => (
                <View key={b.id}>{renderRow(b, true)}</View>
              ))}
            </View>
          ) : null
        }
      />

      <View style={[styles.createBar, {paddingBottom: Math.max(insets.bottom, 24)}]}>
        <TouchableOpacity
          onPress={() => setStep('about')}
          disabled={selected.length === 0}
          activeOpacity={0.85}>
          <LinearGradient
            colors={selected.length > 0 ? [c.primary, c.secondary] : [c.border, c.border]}
            start={{x: 0, y: 0}}
            end={{x: 1, y: 0}}
            style={styles.createBtn}>
            <Text style={styles.createBtnText} numberOfLines={1}>
              {selected.length > 0 ? `Далее (${selected.length})` : 'Выберите участников'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgPrimary},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40},

  // Выбранные — строкой чипов над поиском, чтобы состав был виден, пока листаешь
  chipsWrap: {flexGrow: 0, borderBottomWidth: 1, borderBottomColor: c.borderLight},
  chips: {paddingHorizontal: 12, paddingVertical: 9, gap: 6},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 190,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: c.primaryLight,
  },
  chipText: {flexShrink: 1, fontSize: 13, fontFamily: font.medium, color: c.primary},

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
  listSection: {
    fontSize: 12,
    fontFamily: font.semiBold,
    color: c.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userItemSelected: {backgroundColor: c.primaryLight},
  userInfo: {flex: 1, marginLeft: 13},
  userNameRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  userName: {fontSize: 15, color: c.textPrimary, fontFamily: font.medium},
  userPosition: {fontSize: 12, fontFamily: font.regular, color: c.textSecondary, marginTop: 2},
  separator: {height: 1, backgroundColor: c.borderLight, marginLeft: 73},
  emptyText: {fontSize: 15, fontFamily: font.regular, color: c.textTertiary},
  // Заглушка бота отличается от человеческой значком: в списке из людей и ботов
  // одинаковый серый кружок не давал бы их различить
  botStub: {width: 44, height: 44, borderRadius: 22, backgroundColor: c.bgTertiary, alignItems: 'center', justifyContent: 'center'},
  botStubSm: {width: 36, height: 36, borderRadius: 18, backgroundColor: c.bgTertiary, alignItems: 'center', justifyContent: 'center'},

  // Второй шаг
  aboutContent: {padding: 16, paddingBottom: 32},
  aboutHead: {alignItems: 'center', gap: 8, paddingVertical: 12},
  avatarPick: {width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center'},
  avatarHint: {fontSize: 13, fontFamily: font.medium, color: c.primary},
  groupNameInput: {
    height: 48,
    marginTop: 12,
    backgroundColor: c.bgSecondary,
    borderWidth: 1.5,
    borderColor: c.border,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: font.regular,
    color: c.textPrimary,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: font.semiBold,
    color: c.textTertiary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingTop: 22,
    paddingBottom: 8,
  },
  memberRow: {flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7},
  memberName: {flex: 1, fontSize: 14, fontFamily: font.medium, color: c.textPrimary},

  // Кнопка шага
  createBar: {
    flexShrink: 0,
    paddingTop: 10,
    paddingHorizontal: 16,
    backgroundColor: c.bgPrimary,
    borderTopWidth: 1,
    borderTopColor: c.borderLight,
  },
  createBtn: {
    borderRadius: radius.lg,
    paddingVertical: 15,
    alignItems: 'center',
  },
  createBtnText: {color: '#FFFFFF', fontSize: 15, fontFamily: font.semiBold},
});
