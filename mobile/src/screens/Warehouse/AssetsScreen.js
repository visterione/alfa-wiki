/**
 * Всё оборудование сети — список с поиском.
 *
 * До сих пор до карточки прибора можно было добраться только через кабинет или
 * сканированием этикетки. Оба пути предполагают, что человек знает, где вещь
 * стоит, — а спрашивают обычно наоборот: «где у нас второй тонометр». Поиск по
 * наименованию, инвентарному и серийному номеру считает сервер, поэтому ищется
 * по всей сети, а не по загруженной странице.
 *
 * Зона ответственности учитывается там же: человек без своих кабинетов сети не
 * увидит, и это не недоделка мобилки, а то же правило, что в вебе.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {View, Text, FlatList, TextInput, Pressable, StyleSheet, ActivityIndicator} from 'react-native';
import {Search, ChevronRight} from 'lucide-react-native';

import {warehouse as warehouseApi} from '../../services/api';
import LogoLoader from '../../components/LogoLoader';
import {useTabBarInset} from '../../navigation/tabBarLayout';
import {radius, font} from '../../theme';
import {useThemedStyles, useTheme} from '../../store/settingsStore';
import {ASSET_STATUS, statusColor, roomText} from './warehouseMeta';

const PAGE = 50;

// Статусы, по которым отбирают чаще всего. Полный список есть в карточке, а
// здесь фильтр — это способ быстро выделить проблемное, а не справочник.
const FILTERS = [
  {key: '', label: 'Все'},
  {key: 'in_use', label: 'В работе'},
  {key: 'repair', label: 'В ремонте'},
  {key: 'maintenance', label: 'На ТО'},
  {key: 'storage', label: 'На хранении'},
];

export default function WarehouseAssetsScreen({navigation}) {
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const tabInset = useTabBarInset();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // Каждый ответ помечается своим номером: при быстром наборе ответы приходят
  // не в том порядке, в каком ушли, и поздний ответ на старый запрос затирал бы
  // свежий результат.
  const request = useRef(0);

  const load = useCallback((page = 1) => {
    const mine = request.current + 1;
    request.current = mine;
    if (page > 1) setLoadingMore(true);

    return warehouseApi.assets({q: q.trim(), status, page, limit: PAGE})
      .then(({data}) => {
        if (request.current !== mine) return;
        setTotal(data.total || 0);
        setItems(prev => (page > 1 ? [...(prev || []), ...(data.items || [])] : (data.items || [])));
      })
      .catch(() => request.current === mine && setItems([]))
      .finally(() => request.current === mine && setLoadingMore(false));
  }, [q, status]);

  // Поиск с задержкой: запрос на каждую букву — это запрос на каждую букву
  useEffect(() => {
    const timer = setTimeout(() => load(1), q ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  return (
    <View style={styles.root}>
      <View style={styles.search}>
        <Search size={15} color={c.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={q}
          onChangeText={setQ}
          placeholder="Наименование, инв. или серийный номер"
          placeholderTextColor={c.textTertiary}
          autoCorrect={false}
        />
      </View>

      <View style={styles.filters}>
        {FILTERS.map(filter => (
          <Pressable
            key={filter.key || 'all'}
            style={[styles.chip, status === filter.key && styles.chipOn]}
            onPress={() => setStatus(filter.key)}>
            <Text style={[styles.chipText, status === filter.key && styles.chipTextOn]}>
              {filter.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {!items ? <LogoLoader /> : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, {paddingBottom: tabInset + 24}]}
          keyboardShouldPersistTaps="handled"
          // Дозагрузка по мере прокрутки: карточек в сети тысячи, и отдать их
          // одним куском значит держать телефон занятым секунды
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (loadingMore || items.length >= total) return;
            load(Math.floor(items.length / PAGE) + 1);
          }}
          ListHeaderComponent={
            <Text style={styles.total}>
              Найдено: {total}
            </Text>
          }
          ListEmptyComponent={<Text style={styles.none}>Ничего не нашлось</Text>}
          ListFooterComponent={loadingMore
            ? <ActivityIndicator size="small" color={c.textTertiary} style={styles.more} />
            : null}
          renderItem={({item}) => (
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('WarehouseAsset', {assetId: item.id})}>
              <View style={[styles.dot, {backgroundColor: statusColor(c, item.status)}]} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {item.inventoryNumber} · {ASSET_STATUS[item.status] || item.status}
                </Text>
                <Text style={styles.rowWhere} numberOfLines={1}>{roomText(item.room)}</Text>
              </View>
              <ChevronRight size={16} color={c.textTertiary} />
            </Pressable>
          )}
        />
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
  dot: {width: 8, height: 8, borderRadius: 4},
  rowText: {flex: 1},
  rowTitle: {fontFamily: font.medium, fontSize: 14, color: c.textPrimary, lineHeight: 19},
  rowSub: {fontFamily: font.regular, fontSize: 11, color: c.textSecondary, marginTop: 2},
  rowWhere: {fontFamily: font.regular, fontSize: 11, color: c.textTertiary, marginTop: 1},
  none: {fontFamily: font.regular, fontSize: 13, color: c.textTertiary, textAlign: 'center', marginTop: 30},
  more: {marginVertical: 16},
});
