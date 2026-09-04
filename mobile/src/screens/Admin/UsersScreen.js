/**
 * Пользователи портала — мобильный вид админского раздела (ver. 7.77).
 *
 * ── Почему список людей, а не таблица ────────────────────────────────────────
 *
 * В вебе это таблица «Пользователь / Email / Роли / Медцентры». Те же четыре
 * колонки на телефоне — строка с аватаром и подписью под именем, ровно как в
 * выборе собеседника (Chat/NewChatScreen): один и тот же человек обязан
 * выглядеть одинаково там, где ему пишут, и там, где его завели.
 *
 * Значки справа показывают только необычное: администратор, выключенная 2FA,
 * отключённая учётная запись. Ряд из трёх галочек у каждого второго
 * превратился бы в узор, который перестают замечать.
 *
 * ── Отбор двумя кнопками, а не рядами «чипов» ────────────────────────────────
 *
 * Сначала роли и медцентры стояли двумя горизонтальными лентами кнопок под
 * поиском. Ролей в сети три десятка, медцентров — десяток: ленты занимали треть
 * экрана, прокручивались вбок мимо нужного и всё равно показывали по три
 * названия за раз. Теперь это две кнопки у поиска, и каждая открывает список
 * целиком — выбранное видно по цвету кнопки, а не по тому, докрутил ли ты
 * ленту до отмеченного.
 */
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, Pressable, Modal, ScrollView,
  StyleSheet, useWindowDimensions,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Search, Crown, ShieldOff, UserX, Users as UsersIcon, Building2, Check,
} from 'lucide-react-native';

import {users as usersApi} from '../../services/api';
import Avatar from '../../components/Avatar';
import UserBadge from '../../components/UserBadge';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useTheme, useThemedStyles} from '../../store/settingsStore';
import {roleNames, medCenterNames, whoText} from './usersMeta';

export default function AdminUsersScreen({navigation}) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Панель вкладок на этом экране скрыта, а окно рисуется под системной
  // панелью навигации — на аппаратах с тремя кнопками она перекрывала бы
  // последнюю строку списка
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();

  const [list, setList] = useState(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [medCenterFilter, setMedCenterFilter] = useState('');
  // Какой список раскрыт и на какой высоте: выпадающий список рисуется в
  // модальном слое, а тот ничего не знает о раскладке экрана под ним
  const [menu, setMenu] = useState(null);
  const [anchor, setAnchor] = useState(0);
  const tools = useRef(null);

  // Перечитываем на каждом возвращении: сюда приходят из формы заведения и
  // правки, и человек, которого только что завели, обязан быть в списке —
  // иначе первое, что видит администратор после сохранения, это его отсутствие
  useFocusEffect(useCallback(() => {
    let alive = true;
    usersApi.list()
      .then(({data}) => {
        if (!alive) return;
        setFailed(false);
        setList(data || []);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setList([]);
      });
    return () => { alive = false; };
  }, []));

  const roles = useMemo(
    () => [...new Set((list || []).flatMap(roleNames))].sort((a, b) => a.localeCompare(b, 'ru')),
    [list],
  );
  const medCenters = useMemo(
    () => [...new Set((list || []).flatMap(medCenterNames))]
      .sort((a, b) => a.localeCompare(b, 'ru')),
    [list],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (list || [])
      .filter((user) => {
        if (query) {
          const haystack = [
            user.displayName, user.username, user.email, user.position, user.specialty,
            ...roleNames(user), ...medCenterNames(user),
          ].filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        if (roleFilter && !roleNames(user).includes(roleFilter)) return false;
        if (medCenterFilter && !medCenterNames(user).includes(medCenterFilter)) return false;
        return true;
      })
      .sort((a, b) => (a.displayName || a.username || '')
        .localeCompare(b.displayName || b.username || '', 'ru'));
  }, [list, search, roleFilter, medCenterFilter]);

  // Список раскрывается точно под строкой поиска, поэтому её низ измеряется в
  // координатах окна: у модального слоя своя система координат, и высоту шапки
  // навигатора он не знает
  const openMenu = (which) => {
    tools.current?.measureInWindow((x, y, w, h) => setAnchor(y + h + 6));
    setMenu(which);
  };

  const options = menu === 'roles' ? roles : medCenters;
  const chosen = menu === 'roles' ? roleFilter : medCenterFilter;
  const choose = (value) => {
    if (menu === 'roles') setRoleFilter(value);
    else setMedCenterFilter(value);
    setMenu(null);
  };

  if (!list) return <LogoLoader />;

  return (
    <View style={styles.container}>
      <View style={styles.tools} ref={tools}>
        <View style={styles.search}>
          <Search size={15} color={c.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Имя, логин, почта, должность"
            placeholderTextColor={c.textTertiary}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
        </View>
        <FilterButton
          styles={styles}
          icon={UsersIcon}
          on={Boolean(roleFilter)}
          label="Отбор по ролям"
          color={c}
          onPress={() => openMenu('roles')}
        />
        <FilterButton
          styles={styles}
          icon={Building2}
          on={Boolean(medCenterFilter)}
          label="Отбор по медцентрам"
          color={c}
          onPress={() => openMenu('medCenters')}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={{paddingBottom: insets.bottom + 16}}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <Text style={styles.total}>
            {`Всего: ${list.length}`}
            {filtered.length !== list.length ? ` · найдено: ${filtered.length}` : ''}
            {roleFilter ? ` · ${roleFilter}` : ''}
            {medCenterFilter ? ` · ${medCenterFilter}` : ''}
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.empty}>
              {failed ? 'Список не загрузился' : 'Никого не нашлось'}
            </Text>
          </View>
        }
        renderItem={({item}) => (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('AdminUser', {
              userId: item.id,
              title: item.displayName || item.username,
            })}>
            <Avatar uri={item.avatar} size={44} />
            <View style={styles.rowBody}>
              {/* Метка из переписки стоит сразу за именем — там же, где её
                  видят в чатах: администратор проверяет её по списку, а не
                  заходя в каждую карточку */}
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.displayName || item.username}
                </Text>
                <UserBadge badge={item.chatBadge} size={15} />
              </View>
              <Text style={styles.who} numberOfLines={1}>{whoText(item)}</Text>
            </View>
            <View style={styles.flags}>
              {item.isAdmin && <Crown size={15} color={c.warning} />}
              {!item.twoFactorEnabled && <ShieldOff size={15} color={c.textTertiary} />}
              {!item.isActive && <UserX size={15} color={c.error} />}
            </View>
          </TouchableOpacity>
        )}
      />

      <Modal
        transparent
        visible={Boolean(menu)}
        animationType="fade"
        onRequestClose={() => setMenu(null)}>
        <Pressable style={styles.backdrop} onPress={() => setMenu(null)} />
        <View style={[styles.dropdown, {top: anchor, maxHeight: height - anchor - 80}]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <DropRow
              styles={styles}
              color={c}
              label={menu === 'roles' ? 'Все роли' : 'Все медцентры'}
              on={!chosen}
              onPress={() => choose('')}
            />
            {options.map(option => (
              <DropRow
                key={option}
                styles={styles}
                color={c}
                label={option}
                on={chosen === option}
                onPress={() => choose(chosen === option ? '' : option)}
              />
            ))}
            {!options.length && (
              <Text style={styles.dropEmpty}>
                {menu === 'roles' ? 'Роли никому не назначены' : 'Медцентры никому не назначены'}
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function FilterButton({styles, icon: Icon, on, label, color, onPress}) {
  return (
    <Pressable
      style={[styles.filterBtn, on && styles.filterBtnOn]}
      accessibilityLabel={label}
      onPress={onPress}>
      <Icon size={18} color={on ? '#FFFFFF' : color.textSecondary} />
    </Pressable>
  );
}

function DropRow({styles, color, label, on, onPress}) {
  return (
    <Pressable style={styles.dropRow} onPress={onPress}>
      <Text style={[styles.dropText, on && styles.dropTextOn]} numberOfLines={1}>{label}</Text>
      {on ? <Check size={16} color={color.primary} /> : null}
    </Pressable>
  );
}

const makeStyles = c => StyleSheet.create({
  container: {flex: 1, backgroundColor: c.bgPrimary},
  center: {alignItems: 'center', justifyContent: 'center', padding: 40},

  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.borderLight,
  },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.bgSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {flex: 1, fontSize: 15, fontFamily: font.regular, color: c.textPrimary},
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: c.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnOn: {backgroundColor: c.primary},

  total: {
    fontSize: 12,
    fontFamily: font.regular,
    color: c.textTertiary,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  row: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12},
  rowBody: {flex: 1, marginLeft: 13, marginRight: 8},
  // flexShrink — длинное имя не должно выталкивать метку за край строки
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  name: {fontSize: 15, fontFamily: font.medium, color: c.textPrimary, flexShrink: 1},
  who: {fontSize: 12, fontFamily: font.regular, color: c.textSecondary, marginTop: 2},
  flags: {flexDirection: 'row', alignItems: 'center', gap: 6},
  separator: {height: 1, backgroundColor: c.borderLight, marginLeft: 73},
  empty: {fontSize: 15, fontFamily: font.regular, color: c.textTertiary},

  // Затемнение под списком ловит нажатие «мимо»: без него закрыть список можно
  // было бы только выбрав что-нибудь
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)'},
  dropdown: {
    position: 'absolute',
    right: 12,
    left: 60,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
    overflow: 'hidden',
    // Тень, а не одна рамка: список лежит поверх строк, и без высоты он
    // читается как часть списка под ним
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 6},
    elevation: 8,
  },
  dropRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.borderLight,
  },
  dropText: {flex: 1, fontSize: 14.5, fontFamily: font.regular, color: c.textPrimary},
  dropTextOn: {fontFamily: font.semiBold, color: c.primary},
  dropEmpty: {
    fontSize: 14,
    fontFamily: font.regular,
    color: c.textTertiary,
    padding: 16,
  },
});
