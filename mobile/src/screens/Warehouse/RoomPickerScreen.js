/**
 * Кабинеты — медцентр → кабинеты, этажи лентой сверху.
 *
 * ── Как спуск дошёл до одного шага ───────────────────────────────────────────
 *
 * Сначала он был четырёхэкранным: медцентр, корпус, этаж, кабинет. Корпус при
 * этом почти всегда один-два, и отдельный экран под выбор из двух строк — самый
 * дорогой способ задать самый простой вопрос, поэтому корпус переехал в
 * выпадающий список на экране медцентра.
 *
 * В ver. 7.48 корпуса убраны совсем: уровень не проходил никто — человек знает
 * свой этаж, а корпус вспоминает не всегда.
 *
 * В ver. 7.50 исчез и шаг этажа. Кабинеты медцентра показываются сразу, все, с
 * заголовками этажей, а лента этажей сверху сужает список одним касанием — как
 * вертикальный переключатель на карте в вебе. Прежний выпадающий список стоил
 * двух касаний (раскрыть, выбрать) и по умолчанию прятал все этажи, кроме
 * первого: чтобы просто посмотреть, что есть в медцентре, приходилось обойти
 * список этажей по одному.
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
 * сети, внутри этажа — по этажу. Так он остаётся быстрым путём для того, кто
 * номер знает, и не подсовывает чужой этаж тому, кто уже спустился.
 *
 * ── Печать этикеток на двери ─────────────────────────────────────────────────
 *
 * Кнопка принтера в шапке разворачивает текущее поддерево в плоский список с
 * галочками — этажами, как раньше. Маркировка дверей это обход коридора, и
 * отмечать надо сразу этаж целиком; стоя на медцентре, можно отметить и все
 * его этажи разом.
 */
import React, {useCallback, useLayoutEffect, useMemo, useState} from 'react';
import {View, Text, Image, FlatList, Pressable, StyleSheet, TextInput} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {
  Check, Search, Printer, ChevronRight, X, Layers, MapPin,
  Package, Boxes,
} from 'lucide-react-native';

import CONFIG from '../../config';
import LogoLoader from '../../components/LogoLoader';
import GlassBar from '../../components/GlassBar';
import FloorSwitch from './FloorSwitch';
import {radius, font, glassSurface, glassOverlay, accentShadow} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {
  useWarehouseCan, getLocationTree, loadLocationTree, useWarehouseMedCenter,
} from '../../store/warehouseStore';
import MedCenterSwitch from './MedCenterSwitch';
import {roomMatches, roomHeadText, roomSubText} from './warehouseMeta';
import {ROOT_KEY, buildNodes, leavesOf, resolveNode} from './locationTree';

const LEVEL_ICON = {mc: MapPin, floor: Layers};

export default function WarehouseRoomPickerScreen({route, navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const canPrint = useWarehouseCan('canPrintLabels');
  const {medCenterId} = useWarehouseMedCenter();
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
  // Выбранный этаж на экране медцентра. Ключ, а не индекс: дерево
  // перечитывается по таймеру кэша, и порядок веток от этого не гарантирован.
  const [floorKey, setFloorKey] = useState(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    loadLocationTree().then(data => alive && setNodes(buildNodes(data)));
    return () => { alive = false; };
  }, []));

  /**
   * Уровень, на котором выбирать не из чего, пропускается. Спуск идёт до
   * первого настоящего выбора, поэтому «единственный корпус» и «единственный
   * этаж» не превращаются в два экрана с одной строкой.
   *
   * Выбранный в шапке склада медцентр пропускает и свой уровень: экран
   * открывается сразу на его кабинетах. Это то же правило, только вопрос задан
   * заранее и один раз на весь раздел, а не при каждом заходе в кабинеты.
   * Спуск с корня остаётся живым для режима «вся сеть» и для случая, когда
   * выбранного медцентра в дереве уже нет: resolveNode тогда сам вернётся к
   * корню, а не покажет пустоту.
   */
  const startKey = nodeKey === ROOT_KEY && medCenterId ? `mc:${medCenterId}` : nodeKey;
  const node = useMemo(() => resolveNode(nodes, startKey), [nodes, startKey]);

  /**
   * Этажи медцентра — лентой сверху, а не отдельным шагом.
   *
   * «Склады» и «Без этажа» попадают в ленту наравне с этажами: это такие же
   * ответы на вопрос «где искать», и выносить их отдельной строкой значило бы
   * спрашивать дважды.
   */
  const floors = node?.kind === 'mc' ? node.children : null;
  const floor = floors ? (floors.find(item => item.key === floorKey) || floors[0]) : null;
  /**
   * Что показывает список. Обычно — выбранный этаж, но поиск и отбор под печать
   * всегда идут по всему медцентру: человек, набирающий номер кабинета, ищет
   * его в здании, а не на текущем этаже, и «не нашлось» из-за невыбранного
   * этажа он прочитает как «такого кабинета нет».
   */
  const listNode = (q.trim() || picking) ? node : (floor || node);

  const groups = useMemo(() => {
    if (!listNode) return [];
    const needle = q.trim().toLowerCase();
    return leavesOf(listNode)
      .map(leaf => ({leaf, rooms: leaf.rooms.filter(room => roomMatches(room, needle))}))
      .filter(group => group.rooms.length);
  }, [listNode, q]);

  const hasRooms = Boolean(listNode?.counts?.rooms);
  /**
   * Спуск остался только на первом экране — там выбирают медцентр. Дальше
   * показываются кабинеты, а этаж это фильтр над ними, а не уровень: именно из
   * этого и складывалась лишняя работа, на которую жаловались.
   */
  const flat = node?.kind !== 'root' || Boolean(q.trim()) || picking;

  useLayoutEffect(() => {
    const printer = canPrint && hasRooms ? (
      <Pressable
        onPress={() => { setPicking(v => !v); setChecked(new Set()); }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={picking ? 'Выйти из отбора' : 'Печать этикеток на двери'}>
        {picking
          ? <X size={21} color="#FFFFFF" />
          : <Printer size={20} color="#FFFFFF" />}
      </Pressable>
    ) : null;

    navigation.setOptions({
      title: picking ? 'Этикетки на двери' : (node?.title || 'Кабинеты'),
      // Переключатель медцентров соседствует с принтером, а не заменяет его:
      // это разные вещи — что показывать и что делать с показанным. Во время
      // отбора под печать он убирается, иначе смена медцентра посреди обхода
      // этажа обнулила бы уже отмеченные двери.
      headerRight: () => (
        <View style={styles.headerActions}>
          {!picking && <MedCenterSwitch />}
          {printer}
        </View>
      ),
    });
  }, [navigation, picking, canPrint, hasRooms, node, styles]);

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
  /**
   * Заголовок группы не нужен, когда группа единственная и в переключателе уже
   * написано то же самое, — «3 этаж» над списком повторял бы нажатую кнопку.
   *
   * Но у этажа бывает имя, и тогда заголовок обязателен: после отказа от
   * корпусов у медцентра встречаются два четвёртых этажа, в переключателе оба
   * выглядят как «4», и различает их только название.
   */
  const single = groups.length === 1 && !picking;
  const named = single && groups[0].leaf.title !== `${groups[0].leaf.short} этаж`;
  const withHeaders = !single || named;

  const items = flat
    ? groups.flatMap(({leaf, rooms}) => [
      ...(withHeaders
        ? [{type: 'group', key: `g-${leaf.key}`, title: leaf.path || leaf.title, ids: rooms.map(r => r.id)}]
        : []),
      ...rooms.map(room => ({type: 'room', key: `r-${room.id}`, room})),
    ])
    : (listNode?.children || []).map(child => ({type: 'node', key: `n-${child.key}`, node: child}));

  return (
    <View style={styles.root}>
      {/* Панель этажей — как кнопки лифта. Отбор под печать её прячет: там
          отмечают целыми этажами, и список идёт по всему медцентру. */}
      {!picking && (
        <FloorSwitch floors={floors} value={floor?.key} onChange={setFloorKey} />
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
                <Counts styles={styles} c={c} counts={item.node.counts} />
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
                {/* В заголовке только номер, название — подписью снизу. Через
                    тире оно шло бы вторым разом подряд: «Каб. 415 — Архив», а
                    под ним «Архив». */}
                <Text style={styles.rowTitle}>{roomHeadText(room)}</Text>
                {Boolean(roomSubText(room)) && (
                  <Text style={styles.rowSub} numberOfLines={1}>{roomSubText(room)}</Text>
                )}
              </View>
              {/* Сколько в кабинете имущества — дерево знает это и так. Числа
                  два, потому что вопрос два: оборудование считается карточками,
                  материалы — позициями на остатке. */}
              {!picking && (
                <Counts
                  styles={styles}
                  c={c}
                  counts={{
                    assets: room.counters?.assets || 0,
                    materials: room.counters?.positions || 0,
                  }}
                />
              )}
              {!picking && <ChevronRight size={16} color={c.textTertiary} />}
            </Pressable>
          );
        }}
      />

      {picking && checked.size > 0 && (
        <GlassBar style={[styles.bar, {paddingBottom: insets.bottom + 12}]}>
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
        </GlassBar>
      )}
    </View>
  );
}

/**
 * Пара счётчиков со значками: оборудование и материалы.
 *
 * Значки, а не подписи: в строке списка на подписи нет места, а Package и Boxes
 * повторяют те же значки, которыми эти два вида помечены в размещении и в
 * карточке кабинета. Ноль не показывается вовсе — строка с «0» сообщает ровно
 * столько же, сколько её отсутствие, но занимает место и притягивает взгляд.
 */
function Counts({styles, c, counts}) {
  if (!counts?.assets && !counts?.materials) return null;

  return (
    <View style={styles.counts}>
      {counts.assets > 0 && (
        <View style={styles.count}>
          <Package size={12} color={c.textTertiary} />
          <Text style={styles.countText}>{counts.assets}</Text>
        </View>
      )}
      {counts.materials > 0 && (
        <View style={styles.count}>
          <Boxes size={12} color={c.textTertiary} />
          <Text style={styles.countText}>{counts.materials}</Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = c => StyleSheet.create({
  headerActions: {flexDirection: 'row', alignItems: 'center', gap: 12},
  // Верхний отступ живёт на экране, а не на первом элементе: первым бывает и
  // переключатель этажей, и поиск, и отступ должен быть одинаковым в обоих
  // случаях. Дальше интервалы идут сверху вниз — каждый элемент отодвигает
  // следующий.
  root: {flex: 1, paddingTop: 12},
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...glassSurface(c),
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 42,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  searchInput: {flex: 1, color: c.textPrimary, fontFamily: font.regular, fontSize: 14},
  list: {paddingHorizontal: 16, paddingTop: 6},

  level: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...glassSurface(c),
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

  levelTitle: {fontFamily: font.semiBold, fontSize: 15, color: c.textPrimary},
  counts: {alignItems: 'flex-end', gap: 2},
  count: {flexDirection: 'row', alignItems: 'center', gap: 4},
  countText: {fontFamily: font.medium, fontSize: 12, color: c.textTertiary, minWidth: 18, textAlign: 'right'},

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
    ...glassSurface(c),
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
    ...glassOverlay(c),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: c.primary,
    ...accentShadow(c.primary),
  },
  buttonText: {fontFamily: font.semiBold, fontSize: 15, color: '#FFFFFF'},
});
