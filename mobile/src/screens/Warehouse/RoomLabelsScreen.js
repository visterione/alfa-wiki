/**
 * Выбор кабинетов под этикетки на двери.
 *
 * Единственный экран мобилки, где кабинеты показаны списком, а не по одному
 * после сканирования. Так и задумано: маркировка дверей — это обход этажа, и
 * отмечать нужно сразу этаж целиком, а не подходить к каждой двери с телефоном,
 * чтобы узнать её номер.
 *
 * Поэтому и группировка по этажам, и отметка целым этажом одним нажатием: за
 * один заход печатают ленту на весь коридор и потом идут её клеить.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {View, Text, FlatList, Pressable, StyleSheet, TextInput} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Check, Search, Printer} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';

export default function WarehouseRoomLabelsScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(() => new Set());
  const [q, setQ] = useState('');

  useFocusEffect(useCallback(() => {
    let alive = true;
    warehouseApi.tree()
      .then(({data}) => alive && setTree(data))
      .catch(() => alive && setTree(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []));

  // Дерево медцентр → корпус → этаж разворачиваем в плоский список с
  // заголовками: вложенные списки на телефоне читаются хуже, чем один столбец с
  // подписями уровней, а выбирают здесь всё равно этажами.
  const rows = useMemo(() => {
    if (!tree) return [];
    const needle = q.trim().toLowerCase();
    const matches = room => !needle
      || String(room.number).toLowerCase().includes(needle)
      || (room.name || '').toLowerCase().includes(needle);

    const out = [];
    for (const mc of tree.medCenters || []) {
      const groups = [];
      for (const building of mc.buildings || []) {
        for (const floor of building.floors || []) {
          const rooms = (floor.rooms || []).filter(matches);
          if (rooms.length) {
            groups.push({
              key: `f${floor.id}`,
              title: [building.name, floor.name || `${floor.number} этаж`].filter(Boolean).join(' · '),
              rooms,
            });
          }
        }
      }
      const loose = (mc.rooms || []).filter(matches);
      if (loose.length) groups.push({key: `mc${mc.id}`, title: 'Без этажа', rooms: loose});
      if (!groups.length) continue;

      out.push({type: 'mc', key: `mc-${mc.id}`, title: mc.name});
      for (const group of groups) {
        out.push({type: 'group', key: `g-${group.key}`, title: group.title, ids: group.rooms.map(r => r.id)});
        for (const room of group.rooms) out.push({type: 'room', key: `r-${room.id}`, room});
      }
    }
    return out;
  }, [tree, q]);

  const toggle = ids => setChecked(prev => {
    const next = new Set(prev);
    // Группа переключается целиком: отмечена не вся — доотмечаем, отмечена
    // полностью — снимаем. Иначе нажатие по наполовину отмеченному этажу
    // снимало бы то, что только что отметили руками.
    const all = ids.every(id => next.has(id));
    for (const id of ids) { if (all) next.delete(id); else next.add(id); }
    return next;
  });

  if (loading) return <LogoLoader />;

  return (
    <View style={styles.root}>
      <View style={styles.search}>
        <Search size={15} color={c.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Номер или название кабинета"
          placeholderTextColor={c.textTertiary}
          autoCorrect={false}
        />
      </View>

      <FlatList
        data={rows}
        keyExtractor={item => item.key}
        contentContainerStyle={{paddingHorizontal: 16, paddingBottom: tabInset + (checked.size ? 96 : 24)}}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text style={styles.none}>
            {q ? 'Ничего не нашлось' : 'Кабинетов в вашей зоне ответственности нет'}
          </Text>
        }
        renderItem={({item}) => {
          if (item.type === 'mc') return <Text style={styles.mc}>{item.title}</Text>;
          if (item.type === 'group') {
            const all = item.ids.every(id => checked.has(id));
            return (
              <Pressable style={styles.group} onPress={() => toggle(item.ids)}>
                <Text style={styles.groupText}>{item.title}</Text>
                <Text style={styles.groupAction}>{all ? 'снять' : `все ${item.ids.length}`}</Text>
              </Pressable>
            );
          }
          const on = checked.has(item.room.id);
          return (
            <Pressable style={styles.row} onPress={() => toggle([item.room.id])}>
              <View style={[styles.box, on && styles.boxOn]}>
                {on && <Check size={13} color="#FFFFFF" />}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Кабинет {item.room.number}</Text>
                {Boolean(item.room.name) && (
                  <Text style={styles.rowSub} numberOfLines={1}>{item.room.name}</Text>
                )}
              </View>
            </Pressable>
          );
        }}
      />

      {checked.size > 0 && (
        <View style={[styles.bar, {paddingBottom: tabInset + 12}]}>
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
  mc: {
    fontFamily: font.semiBold,
    fontSize: 15,
    color: c.textPrimary,
    marginTop: 18,
    marginBottom: 4,
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    marginTop: 6,
  },
  groupText: {flex: 1, fontFamily: font.medium, fontSize: 12, color: c.textSecondary},
  groupAction: {fontFamily: font.medium, fontSize: 12, color: c.primary},
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
