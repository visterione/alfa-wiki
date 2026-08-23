/**
 * Остатки материалов по всей сети.
 *
 * Отвечает на вопрос «где ещё есть», который в кабинете возникает постоянно:
 * перчатки кончились здесь — надо понять, у кого взять. Из карточки кабинета
 * этого не видно, там показан только свой остаток.
 *
 * Сервер отдаёт остатки без постраничности, зато с зоной ответственности:
 * человек видит те кабинеты, за которые отвечает. Поэтому поиск и фильтры
 * считаются на клиенте — список уже здесь, и второй заход на сервер за тем же
 * самым был бы платой ни за что.
 */
import React, {useCallback, useMemo, useState} from 'react';
import {View, Text, FlatList, TextInput, Pressable, StyleSheet, RefreshControl} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Search, Pencil} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {useWarehouseCan} from '../../store/warehouseStore';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {qtyText, dateText, roomText} from './warehouseMeta';

// Отбор по тому, что требует действия. «Просрочено» и «ниже минимума» — это
// работа, а не свойство позиции, и ради них список и открывают чаще всего.
const FILTERS = [
  {key: '', label: 'Все'},
  {key: 'expired', label: 'Просрочено'},
  {key: 'below', label: 'Ниже минимума'},
  {key: 'expiring', label: 'Истекает'},
];

export default function WarehouseStockScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const canEdit = useWarehouseCan('canManageCatalog');
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => warehouseApi.stock({includeZero: 'false'})
    .then(({data}) => setRows(Array.isArray(data) ? data : (data?.items || [])))
    .catch(() => setRows([]))
    .finally(() => setRefreshing(false)), []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || [])
      .filter((row) => {
        if (filter === 'expired') return row.expired;
        if (filter === 'expiring') return row.expiringSoon;
        if (filter === 'below') return row.stockStatus === 'below';
        return true;
      })
      .filter(row => !needle
        || String(row.nomenclature?.name || '').toLowerCase().includes(needle)
        || String(row.nomenclature?.code || '').toLowerCase().includes(needle));
  }, [rows, q, filter]);

  if (!rows) return <LogoLoader />;

  return (
    <View style={styles.root}>
      <View style={styles.search}>
        <Search size={15} color={c.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Наименование или код"
          placeholderTextColor={c.textTertiary}
          autoCorrect={false}
        />
      </View>

      <View style={styles.filters}>
        {FILTERS.map(item => (
          <Pressable
            key={item.key || 'all'}
            style={[styles.chip, filter === item.key && styles.chipOn]}
            onPress={() => setFilter(item.key)}>
            <Text style={[styles.chipText, filter === item.key && styles.chipTextOn]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, {paddingBottom: tabInset + 24}]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={c.textTertiary}
          />
        }
        ListHeaderComponent={<Text style={styles.total}>Позиций: {items.length}</Text>}
        ListEmptyComponent={<Text style={styles.none}>Ничего не нашлось</Text>}
        renderItem={({item}) => (
          <Pressable
            style={styles.row}
            disabled={!canEdit}
            onPress={() => navigation.navigate('WarehouseMaterialEdit', {
              nomenclatureId: item.nomenclature?.id,
              name: item.nomenclature?.name,
            })}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={2}>{item.nomenclature?.name}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {[
                  roomText(item.storage?.room),
                  item.storage?.name,
                  item.batch?.batchNumber && `партия ${item.batch.batchNumber}`,
                  item.batch?.expiryDate && `до ${dateText(item.batch.expiryDate)}`,
                ].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Text
              style={[
                styles.qty,
                item.expired && {color: c.error},
                item.stockStatus === 'below' && {color: c.warning},
              ]}>
              {qtyText(item.quantity)} {item.nomenclature?.unit}
            </Text>
            {canEdit && <Pencil size={14} color={c.textTertiary} />}
          </Pressable>
        )}
      />
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
  filters: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 16, marginBottom: 10},
  chip: {
    paddingHorizontal: 11,
    height: 30,
    borderRadius: 15,
    backgroundColor: c.bgPrimary,
    justifyContent: 'center',
  },
  chipOn: {backgroundColor: c.primary},
  chipText: {fontFamily: font.medium, fontSize: 12, color: c.textSecondary},
  chipTextOn: {color: '#FFFFFF'},
  list: {paddingHorizontal: 16},
  total: {fontFamily: font.regular, fontSize: 12, color: c.textTertiary, marginBottom: 8},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.bgPrimary,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 6,
  },
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary, lineHeight: 19},
  rowSub: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 2},
  qty: {fontFamily: font.semiBold, fontSize: 14, color: c.textPrimary},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', marginTop: 30},
});
