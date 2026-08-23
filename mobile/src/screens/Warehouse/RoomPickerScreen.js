/**
 * Кабинеты — медцентр → корпус → этаж → кабинеты.
 *
 * ── Корпус выпадающим списком, а не отдельным шагом ──────────────────────────
 *
 * Спуск был четырёхэкранным: медцентр, корпус, этаж, кабинет. Корпус при этом
 * почти всегда один-два, и отдельный экран под выбор из двух строк — самый
 * дорогой способ задать самый простой вопрос. Теперь корпус выбирается прямо на
 * экране медцентра, а под ним сразу лежат этажи выбранного корпуса. Экранов
 * стало три, и на среднем видно и корпус, и этажи разом.
 *
 * ── Почему не один список ────────────────────────────────────────────────────
 *
 * Первая версия показывала все доступные кабинеты подряд, разбив их подписями
 * уровней. На сети из шести медцентров это километровый столбец, в котором
 * номер 305 встречается в каждом здании: чтобы найти нужный, приходилось
 * прокручивать мимо всех остальных и сверять, под каким заголовком ты сейчас
 * находишься. Спуск по дереву, как в вебе, отсекает лишнее сразу: три нажатия
 * вместо прокрутки, и на каждом шаге видно, куда идёшь.
 *
 * Пустые ветки и уровни без выбора экран не показывает — см. locationTree.js.
 *
 * ── Поиск ────────────────────────────────────────────────────────────────────
 *
 * Поиск ищет по тому поддереву, в котором стоишь: на первом экране — по всей
 * сети, внутри корпуса — по корпусу. Так он остаётся быстрым путём для того,
 * кто номер знает, и не подсовывает чужой этаж тому, кто уже спустился.
 *
 * ── Печать этикеток на двери ─────────────────────────────────────────────────
 *
 * Кнопка принтера в шапке разворачивает текущее поддерево в плоский список с
 * галочками — этажами, как раньше. Маркировка дверей это обход коридора, и
 * отмечать надо сразу этаж целиком; стоя на корпусе, можно отметить и весь
 * корпус.
 */
import React, {useCallback, useLayoutEffect, useMemo, useState} from 'react';
import {View, Text, Image, FlatList, Pressable, StyleSheet, TextInput} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Check, Search, Printer, ChevronRight, ChevronDown, X, Building2, Layers, MapPin,
} from 'lucide-react-native';

import CONFIG from '../../config';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {useWarehouseCan, getLocationTree, loadLocationTree} from '../../store/warehouseStore';
import {roomMatches} from './warehouseMeta';
import {ROOT_KEY, buildNodes, leavesOf, resolveNode} from './locationTree';

const LEVEL_ICON = {mc: MapPin, building: Building2, floor: Layers};

export default function WarehouseRoomPickerScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const canPrint = useWarehouseCan('canPrintLabels');
  const nodeKey = route.params?.nodeKey ?? ROOT_KEY;

  // Дерево берётся из кэша прямо в начальном состоянии, а не после запроса:
  // спуск по уровням это переходы между экранами одного и того же стека, и
  // индикатор загрузки, мигающий на каждом шаге, превращал бы их в ожидание.
  const [nodes, setNodes] = useState(() => {
    const cached = getLocationTree();
    return cached ? buildNodes(cached) : null;
  });
  const [picking, setPicking] = useState(false);
  const [checked, setChecked] = useState(() => new Set());
  const [q, setQ] = useState('');
  // Выбранный корпус на экране медцентра. Ключ, а не индекс: дерево
  // перечитывается по таймеру кэша, и порядок веток от этого не гарантирован.
  const [branchKey, setBranchKey] = useState(null);
  const [branchOpen, setBranchOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    let alive = true;
    loadLocationTree().then(data => alive && setNodes(buildNodes(data)));
    return () => { alive = false; };
  }, []));

  // Уровень, на котором выбирать не из чего, пропускается. Спуск идёт до
  // первого настоящего выбора, поэтому «единственный корпус» и «единственный
  // этаж» не превращаются в два экрана с одной строкой.
  const node = useMemo(() => resolveNode(nodes, nodeKey), [nodes, nodeKey]);

  /**
   * Корпуса медцентра. На его экране они не отдельный шаг, а выпадающий список
   * сверху: под ним сразу лежат этажи выбранного корпуса.
   *
   * Ветка «Без корпуса» попадает сюда наравне с корпусами — это такой же вариант
   * ответа на вопрос «где искать», и выносить его отдельной строкой значило бы
   * спрашивать дважды.
   */
  const branches = node?.kind === 'mc' ? node.children : null;
  const branch = branches
    ? (branches.find(item => item.key === branchKey) || branches[0])
    : null;
  // Ниже по экрану всё считается от того узла, чьё содержимое показано: на
  // медцентре это выбранный корпус, в остальных случаях сам узел.
  const listNode = branch || node;

  const groups = useMemo(() => {
    if (!listNode) return [];
    const needle = q.trim().toLowerCase();
    return leavesOf(listNode)
      .map(leaf => ({leaf, rooms: leaf.rooms.filter(room => roomMatches(room, needle))}))
      .filter(group => group.rooms.length);
  }, [listNode, q]);

  const hasRooms = Boolean(listNode?.count);
  // Плоский список вместо спуска — когда ищут или отбирают под печать: и то и
  // другое про кабинеты, а не про то, где они лежат.
  const flat = Boolean(q.trim()) || picking || !listNode?.children;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: picking ? 'Этикетки на двери' : (node?.title || 'Кабинеты'),
      headerRight: canPrint && hasRooms ? () => (
        <Pressable
          onPress={() => { setPicking(v => !v); setChecked(new Set()); }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={picking ? 'Выйти из отбора' : 'Печать этикеток на двери'}>
          {picking
            ? <X size={21} color="#FFFFFF" />
            : <Printer size={20} color="#FFFFFF" />}
        </Pressable>
      ) : undefined,
    });
  }, [navigation, picking, canPrint, hasRooms, node]);

  const toggle = ids => setChecked((prev) => {
    const next = new Set(prev);
    // Этаж переключается целиком: отмечен не весь — доотмечаем, отмечен
    // полностью — снимаем. Иначе нажатие по наполовину отмеченному этажу
    // снимало бы то, что только что отметили руками.
    const all = ids.every(id => next.has(id));
    for (const id of ids) { if (all) next.delete(id); else next.add(id); }
    return next;
  });

  if (!nodes) return <LogoLoader />;

  // Строки списка собираются заранее: у групп и кабинетов разная разметка, а
  // FlatList должен получить один массив, иначе прокрутка пойдёт по вложенным
  // спискам и перестанет быть непрерывной.
  const items = flat
    ? groups.flatMap(({leaf, rooms}) => [
      // Заголовок группы не нужен, когда группа единственная и без отбора:
      // он повторял бы заголовок экрана
      ...(groups.length > 1 || picking
        ? [{type: 'group', key: `g-${leaf.key}`, title: leaf.path || leaf.title, ids: rooms.map(r => r.id)}]
        : []),
      ...rooms.map(room => ({type: 'room', key: `r-${room.id}`, room})),
    ])
    : (listNode?.children || []).map(child => ({type: 'node', key: `n-${child.key}`, node: child}));

  return (
    <View style={styles.root}>
      {/* Корпус — выпадающим списком, а не отдельным экраном. Показывается
          только когда есть из чего выбирать: единственный корпус мы и так
          пропускаем (см. resolveNode). */}
      {branches?.length > 1 && (
        <View style={styles.branchWrap}>
          <Pressable style={styles.branch} onPress={() => setBranchOpen(v => !v)}>
            <Building2 size={17} color={c.primary} />
            <View style={styles.rowText}>
              <Text style={styles.branchTitle}>{branch.title}</Text>
              {Boolean(branch.subtitle) && (
                <Text style={styles.rowSub} numberOfLines={1}>{branch.subtitle}</Text>
              )}
            </View>
            <Text style={styles.branchCount}>{branch.count}</Text>
            <ChevronDown
              size={16}
              color={c.textTertiary}
              style={branchOpen ? styles.branchArrowOpen : null}
            />
          </Pressable>

          {branchOpen && (
            <View style={styles.branchList}>
              {branches.map(item => (
                <Pressable
                  key={item.key}
                  style={styles.branchOption}
                  onPress={() => { setBranchKey(item.key); setBranchOpen(false); }}>
                  <Text
                    style={[
                      styles.branchOptionText,
                      item.key === branch.key && styles.branchOptionOn,
                    ]}
                    numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.branchCount}>{item.count}</Text>
                  {item.key === branch.key && <Check size={14} color={c.primary} />}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

      {hasRooms && (
        <View style={styles.search}>
          <Search size={15} color={c.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder={node?.kind === 'root' ? 'Кабинет по всей сети' : 'Кабинет'}
            placeholderTextColor={c.textTertiary}
            autoCorrect={false}
          />
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={item => item.key}
        contentContainerStyle={[
          styles.list,
          {paddingBottom: insets.bottom + (picking && checked.size ? 92 : 24)},
        ]}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.none}>
            {q.trim() ? 'Ничего не нашлось' : 'Кабинетов в вашей зоне ответственности нет'}
          </Text>
        }
        renderItem={({item}) => {
          if (item.type === 'node') {
            const Icon = LEVEL_ICON[item.node.kind] || Layers;
            const logo = item.node.logoUrl ? CONFIG.fileUrl(item.node.logoUrl) : null;
            return (
              <Pressable
                style={styles.level}
                onPress={() => navigation.push('WarehouseRooms', {nodeKey: item.node.key})}>
                {/* Знак медцентра вместо общей иконки: их пять, они похожи по
                    названию и различаются как раз знаком и адресом. */}
                {logo ? (
                  <Image source={{uri: logo}} style={styles.levelLogo} resizeMode="contain" />
                ) : (
                  <View style={styles.levelIcon}>
                    <Icon size={19} color={c.primary} />
                  </View>
                )}
                <View style={styles.rowText}>
                  <Text style={styles.levelTitle}>{item.node.title}</Text>
                  {Boolean(item.node.subtitle) && (
                    <Text style={styles.rowSub} numberOfLines={1}>{item.node.subtitle}</Text>
                  )}
                </View>
                <Text style={styles.levelCount}>{item.node.count}</Text>
                <ChevronRight size={16} color={c.textTertiary} />
              </Pressable>
            );
          }

          if (item.type === 'group') {
            if (!picking) return <Text style={styles.groupPlain}>{item.title}</Text>;
            const all = item.ids.every(id => checked.has(id));
            return (
              <Pressable style={styles.group} onPress={() => toggle(item.ids)}>
                <Text style={styles.groupText}>{item.title}</Text>
                <Text style={styles.groupAction}>{all ? 'снять' : `все ${item.ids.length}`}</Text>
              </Pressable>
            );
          }

          const {room} = item;
          const on = checked.has(room.id);
          return (
            <Pressable
              style={styles.row}
              onPress={() => (picking
                ? toggle([room.id])
                : navigation.navigate('WarehouseRoom', {roomId: room.id}))}>
              {picking && (
                <View style={[styles.box, on && styles.boxOn]}>
                  {on && <Check size={13} color="#FFFFFF" />}
                </View>
              )}
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Кабинет {room.number}</Text>
                {Boolean(room.name) && (
                  <Text style={styles.rowSub} numberOfLines={1}>{room.name}</Text>
                )}
              </View>
              {/* Сколько в кабинете оборудования — единственная цифра, которую
                  дерево знает и так. Она отвечает на «тот ли это кабинет»
                  раньше, чем его откроешь. */}
              {!picking && Boolean(room.counters?.assets) && (
                <Text style={styles.rowCount}>{room.counters.assets}</Text>
              )}
              {!picking && <ChevronRight size={16} color={c.textTertiary} />}
            </Pressable>
          );
        }}
      />

      {picking && checked.size > 0 && (
        <View style={[styles.bar, {paddingBottom: insets.bottom + 12}]}>
          <Pressable
            style={styles.button}
            onPress={() => navigation.navigate('WarehouseLabelPrint', {
              kind: 'room',
              ids: [...checked],
              title: 'Этикетки на двери',
            })}>
            <Printer size={17} color="#FFFFFF" />
            <Text style={styles.buttonText}>Печать · {checked.size}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  root: {flex: 1, backgroundColor: c.bgSecondary},
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 42,
    margin: 16,
    marginBottom: 10,
  },
  searchInput: {flex: 1, color: c.textPrimary, fontFamily: font.regular, fontSize: 14},
  list: {paddingHorizontal: 16, paddingTop: 6},

  level: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
  },
  levelIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Знак на белом: логотипы нарисованы под светлую подложку и на тёмной теме
  // сливаются с фоном
  levelLogo: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF',
  },
  branchWrap: {paddingHorizontal: 16, marginBottom: 8},
  branch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  branchTitle: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary},
  branchCount: {fontFamily: font.medium, fontSize: 12, color: c.textTertiary},
  branchArrowOpen: {transform: [{rotate: '180deg'}]},
  branchList: {
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    marginTop: 6,
    overflow: 'hidden',
  },
  branchOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  branchOptionText: {flex: 1, fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  branchOptionOn: {color: c.primary},
  levelTitle: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  // Число кабинетов в ветке: без него нельзя отличить корпус на два кабинета от
  // корпуса на сорок, а решение «куда идти» принимается именно по нему
  levelCount: {fontFamily: font.semiBold, fontSize: 13, color: c.textTertiary},

  group: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    marginTop: 6,
  },
  groupText: {flex: 1, fontFamily: font.medium, fontSize: 12, color: c.textSecondary},
  groupAction: {fontFamily: font.medium, fontSize: 12, color: c.primary},
  groupPlain: {
    fontFamily: font.medium,
    fontSize: 12,
    color: c.textSecondary,
    marginTop: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 6,
  },
  box: {
    width: 21,
    height: 21,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: {backgroundColor: c.primary, borderColor: c.primary},
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary},
  rowSub: {fontFamily: font.regular, fontSize: 12, color: c.textSecondary, marginTop: 2},
  rowCount: {fontFamily: font.medium, fontSize: 12, color: c.textTertiary},
  none: {
    fontFamily: font.regular,
    fontSize: 13,
    color: c.textTertiary,
    textAlign: 'center',
    marginTop: 40,
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: c.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.primary,
  },
  buttonText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
});
